// Shuntdesk backend. One module, written for Cloudflare Workers (fetch + scheduled) and run
// locally by dev/serve.mjs with a file in place of KV.
//
// What it holds: the shared crew desk (paper money), the record of how verdicts turned out,
// a self-reported leaderboard, and the conductor (a language model that explains, never trades).
//
// Where verdicts come from: the seven checks run in visitors' browsers and the result is posted here.
// The server does not take that on trust. It re-reads price, liquidity and pool age, runs its own
// security reading (GoPlus: sell test, taxes, owner powers, holder concentration), and only lets the
// crew trade a ticket its own reading agrees with. What it cannot repeat is the funder tracing, so a
// ticket can still be wrong about wallet groups. Paper money only, 4% of equity per position, one
// position per token, rate-limited per address.
import { FEE, MAX_IMPACT, impact, fill, value } from '../site/assets/trade.js';
import { sameHand } from '../site/assets/hand.js';

const DS = 'https://api.dexscreener.com';
// some data services turn away requests that do not say who is asking
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; Shuntdesk/1.0; +https://shuntdesk.com)' };
const START = 10000, HOUR = 3600000;
// the desk's record in storage. Changing the name starts a new desk from zero (v2: reset before launch, 2026-10-14).
const STATE = 'state-v2';
const fresh = () => ({ cash: START, pos: [], hist: [], log: [], curve: [], verdicts: [], board: {}, rate: {}, said: {}, brief: null, ai: { day: '', n: 0 }, seq: 1, updated: 0, grads: null, season: null, seasons: [] });

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } });
// One copy of the state in memory, shared by every request this instance serves. Requests overlap while they
// wait on other services; if each worked on its own copy, the last to save would wipe out the others' changes.
let mem = null;
const load = async env => mem || (mem = await env.KV.get(STATE).then(s => s ? Object.assign(fresh(), JSON.parse(s)) : fresh()));
const save = async (env, st) => { st.updated = Date.now(); await env.KV.put(STATE, JSON.stringify(st)); };
const isAddr = a => /^0x[0-9a-fA-F]{40}$/.test(a || '');
const zoneFor = liq => liq >= 250000 ? { zone: 1, max: 100 } : liq >= 40000 ? { zone: 2, max: 25 } : { zone: 3, max: 5 };
const sig = n => n >= 1 ? n.toFixed(4) : n.toPrecision(4);
const money = n => Math.round(n).toLocaleString('en-US');
const num = (v, lo = 0, hi = 1e12) => { const n = Number(v); return n >= lo && n <= hi ? n : 0; };
const word = (v, n = 14) => String(v ?? '').replace(/[^\w .$%-]/g, '').slice(0, n);

// Prices for the crew come from the chain itself. The aggregators (DexScreener, GeckoTerminal) turn away
// Cloudflare's shared addresses, so the server reads each pool's current price from the pool's own state with a
// plain eth_call, which every node serves. Uniswap v3: slot0() on the pool. Uniswap v4: the pool's slot in the
// PoolManager, read with extsload. Pools quoted in WETH or native ETH are converted with the ETH price read the
// same way from the deepest WETH / USDG pool. The public node comes first; a keyed one stands behind it.
const RPCS = ['https://rpc.mainnet.chain.robinhood.com'];
const WETH = '0x0bd7d308f8e1639fab988df18a8011f41eacad73', USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168', ETH0 = '0x0000000000000000000000000000000000000000';
const ETH_REF = { pool: '0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca', q: 'usd', base0: true, d0: 18, d1: 6 };   // WETH / USDG, Uniswap v3
async function rpc(method, params = []) {
  let err;
  for (const url of RPCS) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      if (!r.ok) throw new Error('node said ' + r.status);
      const j = await r.json(); if (j.error) throw new Error(j.error.message); return j.result;
    } catch (e) { err = e; }
  }
  throw err;
}
// keccak-256, needed to find a v4 pool's storage slot
const K_RC = [0x1n, 0x8082n, 0x800000000000808an, 0x8000000080008000n, 0x808bn, 0x80000001n, 0x8000000080008081n, 0x8000000000008009n, 0x8an, 0x88n, 0x80008009n, 0x8000000an, 0x8000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n, 0x800an, 0x800000008000000an, 0x8000000080008081n, 0x8000000000008080n, 0x80000001n, 0x8000000080008008n];
const K_ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14], M64 = (1n << 64n) - 1n;
const rol = (v, n) => n ? ((v << BigInt(n)) | (v >> BigInt(64 - n))) & M64 : v;
export function keccak256(hexIn) {
  const src = (hexIn.match(/../g) || []).map(b => parseInt(b, 16)), rate = 136, p = new Uint8Array(Math.ceil((src.length + 1) / rate) * rate);
  p.set(src); p[src.length] ^= 0x01; p[p.length - 1] ^= 0x80;
  const s = new Array(25).fill(0n);
  for (let o = 0; o < p.length; o += rate) {
    for (let i = 0; i < 17; i++) { let w = 0n; for (let b = 7; b >= 0; b--) w = (w << 8n) | BigInt(p[o + i * 8 + b]); s[i] ^= w; }
    for (let r = 0; r < 24; r++) {
      const C = [0, 1, 2, 3, 4].map(x => s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20]);
      for (let x = 0; x < 5; x++) { const D = C[(x + 4) % 5] ^ rol(C[(x + 1) % 5], 1); for (let y = 0; y < 25; y += 5) s[x + y] ^= D; }
      const B = new Array(25);
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) B[y + 5 * ((2 * x + 3 * y) % 5)] = rol(s[x + 5 * y], K_ROT[x + 5 * y]);
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) s[x + 5 * y] = B[x + 5 * y] ^ (~B[(x + 1) % 5 + 5 * y] & M64 & B[(x + 2) % 5 + 5 * y]);
      s[0] ^= K_RC[r];
    }
  }
  let out = ''; for (let i = 0; i < 4; i++) for (let b = 0; b < 8; b++) out += ((s[i] >> BigInt(8 * b)) & 0xffn).toString(16).padStart(2, '0');
  return out;
}
// the pool's current sqrtPriceX96
async function sqrtPrice(m) {
  if (m.pool.length === 42) return BigInt('0x' + (await rpc('eth_call', [{ to: m.pool, data: '0x3850c7bd' }, 'latest'])).slice(2, 66));   // slot0()
  const slot = keccak256(m.pool.slice(2) + '6'.padStart(64, '0'));                                                                        // _pools[poolId], slot 6
  return BigInt(await rpc('eth_call', [{ to: m.mgr, data: '0x1e2eaeaf' + slot }, 'latest'])) & ((1n << 160n) - 1n);                      // extsload(slot): low 160 bits
}
async function poolRatio(m) {
  const s = await sqrtPrice(m); if (!s) return 0;
  const r = Number(s * s * 10n ** 18n / (1n << 192n)) / 1e18 * 10 ** (m.d0 - m.d1);
  return m.base0 ? r : 1 / r;   // quote tokens per base token
}
let ethCache = { v: 0, t: 0 };
async function ethUsd() {
  if (Date.now() - ethCache.t < 45000 && ethCache.v) return ethCache.v;
  const v = await poolRatio(ETH_REF); if (v) ethCache = { v, t: Date.now() };
  return ethCache.v;
}
// a pool's price in USD, right now
async function chainPrice(m) { const r = await poolRatio(m); return r ? r * (m.q === 'eth' ? await ethUsd() : 1) : 0; }// what the server needs to price a pool, built from the token, the pool the browser named, and GoPlus's own list of the token's pools
async function poolMeta(addr, pool, quote, gp) {
  const hit = (gp?.dex || []).find(d => String(d.pair || '').toLowerCase() === pool);
  if (!hit) return { why: 'the pool is not one GoPlus lists for this token' };
  const q = quote === WETH || quote === ETH0 ? 'eth' : quote === USDG ? 'usd' : null;
  if (!q) return { why: 'the pool is not quoted in ETH or USDG' };
  const dBase = parseInt(await rpc('eth_call', [{ to: addr, data: '0x313ce567' }, 'latest']), 16), dQuote = q === 'usd' ? 6 : 18, base0 = BigInt(addr) < BigInt(quote);
  const mgr = String(hit.pool_manager || '').toLowerCase();
  if (pool.length === 66 && !isAddr(mgr)) return { why: 'no pool manager known for this v4 pool' };
  return { m: { pool, q, base0, d0: base0 ? dBase : dQuote, d1: base0 ? dQuote : dBase, ...(pool.length === 66 ? { mgr } : {}) }, liq: Number(hit.liquidity) || 0 };
}// The server's own security reading (GoPlus), so the crew never trades on the browser's word alone.
let gpToken = { v: '', until: 0 };
async function goplus(env, addr) {
  const headers = { Accept: 'application/json' };
  try {
    if (env.GOPLUS_APP_KEY && env.GOPLUS_APP_SECRET) {   // a key raises the rate limit; without one the call still works
      if (Date.now() > gpToken.until) {
        const time = Math.floor(Date.now() / 1000), raw = new TextEncoder().encode(env.GOPLUS_APP_KEY + time + env.GOPLUS_APP_SECRET);
        const sign = [...new Uint8Array(await crypto.subtle.digest('SHA-1', raw))].map(b => b.toString(16).padStart(2, '0')).join('');
        const t = await (await fetch('https://api.gopluslabs.io/api/v1/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app_key: env.GOPLUS_APP_KEY, time, sign }) })).json();
        if (t.result?.access_token) gpToken = { v: t.result.access_token, until: Date.now() + (t.result.expires_in - 300) * 1000 };
      }
      if (gpToken.v) headers.Authorization = gpToken.v;
    }
    const r = await fetch(`https://api.gopluslabs.io/api/v1/token_security/4663?contract_addresses=${addr}`, { headers });
    const gp = (await r.json()).result?.[addr] || null;
    if (gp?.holders) await walletsNotContracts(gp.holders.slice(0, 20).filter(h => h.is_contract == 1 && h.is_locked != 1), h => h.address, h => { h.is_contract = 0; h.delegated = 1; });
    return gp;
  } catch (e) { return null; }
}
// EIP-7702: a person's wallet that delegates to smart-wallet code carries 23 bytes of code, 0xef0100 and an address,
// and explorers and GoPlus call it a contract. Most large holders on Robinhood Chain are such wallets; counted as
// contracts they drop out of the top ten ($SHUNT read 13.6% that way, 25.5% in truth). They count as wallets.
export const isDelegated = code => /^0xef0100[0-9a-f]{40}$/i.test(String(code || ''));
async function walletsNotContracts(list, addrOf, mark) {
  if (!list.length) return;
  let codes = [];
  try {   // one batched request for all of them, the code of each address
    for (const url of RPCS) {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(list.map((h, i) => ({ jsonrpc: '2.0', id: i, method: 'eth_getCode', params: [String(addrOf(h)).toLowerCase(), 'latest'] }))) });
      const j = await r.json().catch(() => null);
      if (Array.isArray(j)) { codes = list.map((h, i) => j.find(x => x.id === i)?.result); break; }
    }
  } catch (e) {}
  list.forEach((h, i) => { if (isDelegated(codes[i])) mark(h); });
}
// what the server can confirm about a token: red flags, and whether it has enough holders to be called clean
function serverRead(gp) {
  if (!gp) return null;
  const on = k => gp[k] === '1', own = (gp.owner_address || '').toLowerCase(), ownerLive = !!own && !/^0x0{40}$/.test(own) && !own.endsWith('dead');
  const top10 = (gp.holders || []).filter(h => h.is_contract != 1 && h.is_locked != 1).slice(0, 10).reduce((s, h) => s + Number(h.percent) * 100, 0);
  const red = [on('is_honeypot') && 'fails the sell test', on('cannot_sell_all') && 'cannot sell all', Number(gp.sell_tax) > 0.1 && 'sell tax over 10%', on('is_blacklisted') && 'blacklist',
    on('is_mintable') && ownerLive && 'owner can mint', on('hidden_owner') && 'hidden owner', top10 > 50 && `ten wallets hold ${top10.toFixed(0)}%`].filter(Boolean);
  return { red, holders: Number(gp.holder_count) || 0, top10 };
}

const worth = (p, now = Date.now()) => value(p, p.mark || p.entry, p.liq, now);
const equity = st => st.cash + st.pos.reduce((s, p) => s + worth(p).back, 0);
function say(st, who, text) { st.log.unshift([Date.now(), who, text]); st.log = st.log.slice(0, 60); }
function close(st, p, v, why) {
  st.pos = st.pos.filter(x => x.id !== p.id); st.cash += v.back;
  st.hist.unshift({ sym: p.sym, addr: p.addr, side: p.side, lev: p.lev, entry: p.entry, exit: v.exit, pnl: v.net, fees: p.fee0 + v.closeFee + v.borrow, why, t: Date.now(), opened: p.t }); st.hist = st.hist.slice(0, 80);
}
// rate limit: n actions per hour per caller per kind
function allow(st, ip, kind, n) {
  const k = kind + ':' + ip, now = Date.now(), live = (st.rate[k] || []).filter(t => now - t < HOUR);
  if (live.length >= n) { st.rate[k] = live; return false; }
  live.push(now); st.rate[k] = live;
  if (Object.keys(st.rate).length > 600) for (const key of Object.keys(st.rate)) if (!st.rate[key].some(t => now - t < HOUR)) delete st.rate[key];
  return true;
}

// marks every position at the live price, applies the guard's rules, and follows up on past verdicts
async function tick(st) {
  const now = Date.now();
  const due = st.verdicts.filter(v => (!v.p1h && now - v.t >= HOUR) || (!v.p24h && now - v.t >= 24 * HOUR));
  for (const p of [...st.pos]) {
    if (!p.m) continue;
    try { const px = await chainPrice(p.m); if (px) p.mark = px; } catch (e) { continue; }
    const v = worth(p, now);
    if (v.health <= 0.1) { say(st, 'Guard', `${p.sym} ${p.side} liquidated at ${sig(v.exit)}`); close(st, p, v, 'liquidated'); }
    else if (v.health < 0.5) { say(st, 'Guard', `${p.sym} health ${v.health.toFixed(2)}, stop hit, closed at ${sig(v.exit)}`); close(st, p, v, 'stop'); }
    else if (v.health > 1.6) { say(st, 'Guard', `${p.sym} up 60% on collateral, taken at ${sig(v.exit)}`); close(st, p, v, 'target'); }
    else if (now - p.t > 24 * HOUR) { say(st, 'Guard', `${p.sym} held a day, closed at ${sig(v.exit)}`); close(st, p, v, 'a day passed'); }
  }
  for (const v of due.slice(0, 8)) {   // a few per minute keeps each run well inside the request allowance
    if (!v.m) continue;
    let px = 0; try { px = await chainPrice(v.m); } catch (e) {}
    if (!px) continue;
    if (!v.p1h && now - v.t >= HOUR) v.p1h = px;
    if (!v.p24h && now - v.t >= 24 * HOUR) v.p24h = px;
  }
  const last = st.curve[st.curve.length - 1];
  if (!last || now - last[0] >= 10 * 60000) { st.curve.push([now, Math.round(equity(st) * 100) / 100]); st.curve = st.curve.slice(-432); }
}
// did the verdicts hold up? clean should be higher later, danger lower
function record(st) {
  const tally = k => {
    const o = { CLEAN: { n: 0, right: 0 }, DANGER: { n: 0, right: 0 } };
    for (const v of st.verdicts) { const px = v[k]; if (!px || !o[v.verdict]) continue; o[v.verdict].n++; if (v.verdict === 'CLEAN' ? px > v.p0 : px < v.p0) o[v.verdict].right++; }
    return o;
  };
  const count = { CLEAN: 0, RISKY: 0, DANGER: 0 }; st.verdicts.forEach(v => count[v.verdict]++);
  return { count, after1h: tally('p1h'), after24h: tally('p24h'), latest: st.verdicts.slice(0, 30).map(({ m, ...v }) => v) };
}

async function postVerdict(st, env, body, ip) {
  const addr = String(body.addr || '').toLowerCase();
  if (!isAddr(addr) || !['CLEAN', 'RISKY', 'DANGER'].includes(body.verdict)) return { ok: false, why: 'bad request' };
  if (st.verdicts.some(v => v.addr === addr && Date.now() - v.t < 6 * HOUR)) return { ok: true, why: 'already on file' };
  if (!allow(st, ip, 'verdict', 40)) return { ok: false, why: 'slow down' };
  // The browser names the pool it priced the token from. The server checks that pool against GoPlus's list for the
  // token, takes the liquidity from GoPlus, and reads the price itself from the pool's last swap on chain.
  const pool = String(body.pool || '').toLowerCase(), quote = String(body.quote || '').toLowerCase();
  if (!/^0x[0-9a-f]{40}([0-9a-f]{24})?$/.test(pool) || !isAddr(quote)) return { ok: false, why: 'no pool named' };
  let gp = await goplus(env, addr);
  if (!gp) { await new Promise(r => setTimeout(r, 1500)); gp = await goplus(env, addr); }   // it is rate-limited; one more try
  if (!gp) return { ok: true, why: 'not traded: the security service did not answer' };
  let meta; try { meta = await poolMeta(addr, pool, quote, gp); } catch (e) { return { ok: false, why: 'chain not answering: ' + String(e.message || e).slice(0, 90) }; }
  if (!meta.m) return { ok: true, why: 'not traded: ' + meta.why };
  let price = 0; try { price = await chainPrice(meta.m); } catch (e) {}
  if (!price) return { ok: true, why: 'not traded: the pool price could not be read from the chain' };
  const pair = { sym: word(gp.token_symbol || body.sym || addr.slice(0, 6), 12), price, created: num(body.created, 0, 1e14),
    // liquidity: the security service's figure and the browser's often disagree, so the smaller of the two is used.
    // An inflated claim cannot raise it, and a doubtful pool is treated as the thinner one.
    liq: num(body.liq) ? Math.min(meta.liq || num(body.liq), num(body.liq)) : meta.liq };
  // pool age is the one thing taken from the browser: neither GoPlus nor a cheap chain read gives it
  const ageMin = pair.created ? (Date.now() - pair.created) / 60000 : 0, z = zoneFor(pair.liq);
  // a clean ticket needs the server to find no red flag and 50 holders; a danger ticket needs the server to find a red flag.
  // anything the server cannot confirm is filed as risky and not traded.
  const sr = serverRead(gp);
  let verdict = body.verdict, note = '';
  if (verdict === 'CLEAN' && ageMin < 60) { verdict = 'RISKY'; note = 'pool under an hour old'; }
  else if (verdict !== 'RISKY' && !sr) { verdict = 'RISKY'; note = 'server could not check it'; }
  else if (verdict === 'CLEAN' && (sr.red.length || sr.holders < 50)) { verdict = 'RISKY'; note = 'server check found: ' + (sr.red[0] || `only ${sr.holders} holders`); }
  else if (verdict === 'DANGER' && !sr.red.length) { verdict = 'RISKY'; note = 'server check found no red flag'; }
  else if (verdict === 'DANGER') note = 'server confirms: ' + sr.red[0];
  else if (verdict === 'CLEAN') note = 'server check agrees';
  const platform = verdict === 'CLEAN' ? 'long' : verdict === 'DANGER' && pair.liq >= 20000 ? 'short' : 'depot';
  const score = Math.max(0, Math.min(100, Math.round(Number(body.score) || 0)));
  const v = { addr, sym: pair.sym, verdict, score, platform, zone: z.zone, t: Date.now(), p0: pair.price, liq: Math.round(pair.liq), m: { ...meta.m }, tags: (body.tags || []).slice(0, 7).map(t => String(t).slice(0, 18)) };
  st.verdicts.unshift(v); st.verdicts = st.verdicts.slice(0, 300);
  if (verdict !== body.verdict) v.claimed = body.verdict;
  say(st, 'Dispatcher', `${v.sym} ${verdict.toLowerCase()} ${score}, ${platform === 'depot' ? 'to the depot' : 'to the ' + platform + ' desk'}${note ? ' (' + note + ')' : ''}`);
  if (platform === 'depot') return { ok: true, why: verdict !== body.verdict ? 'held back: ' + note : 'filed, no trade' };
  if (st.pos.some(p => p.addr === addr)) return { ok: true, why: 'already held' };
  if (st.pos.length >= 8) { say(st, 'Sizer', 'eight positions open, no room'); return { ok: true, why: 'desk full' }; }
  const lev = z.zone === 1 ? 4 : z.zone === 2 ? 2 : 1;   // the crew stays far under what the zone allows
  // 4% of equity, shrunk if that size would move the pool too far
  let col = Math.min(st.cash / (1 + FEE * lev), Math.max(50, Math.round(equity(st) * 0.04)));
  if (impact(col * lev, pair.liq) > MAX_IMPACT / 2) col = Math.floor(MAX_IMPACT / 2 * pair.liq / 2 / lev);
  if (col < 50) { say(st, 'Sizer', 'pool too thin or cash too low for the smallest size, skipped'); return { ok: true, why: 'skipped, too thin' }; }
  const size = col * lev, entry = fill(pair.price, size, pair.liq, platform === 'long'), fee0 = size * FEE;
  st.cash -= col + fee0;
  st.pos.push({ id: st.seq++, addr, sym: v.sym, side: platform, lev, col, size, entry, fee0, mark: pair.price, liq: pair.liq, m: { ...meta.m }, t: Date.now(), zone: z.zone });
  say(st, 'Sizer', `${money(col)} USDG at ${lev.toFixed(1)}x, zone ${z.zone}`);
  say(st, 'Signal', `${platform} ${v.sym} filled at ${sig(entry)}, ${(impact(size, pair.liq) * 100).toFixed(2)}% from quote, fee ${fee0.toFixed(2)}`);
  return { ok: true, why: 'opened ' + platform };
}

// ---------- the conductor ----------
const RULES = 'You are the conductor at Shuntdesk, a site that runs seven fixed-rule checks on tokens and runs paper (simulated) margin desks on real prices. You explain; you never trade and never advise. Use only the facts given. Plain words, short sentences, no hype, no emoji, no exclamation marks, no price predictions, no telling anyone to buy or sell. If the facts do not answer the question, say so in one sentence.';
// asks the model if a key is configured and the allowances hold; otherwise returns the plain fallback
async function conduct(st, env, ip, key, task, facts, fallback) {
  if (st.said[key]) return st.said[key];
  let out = { text: fallback, by: 'rules' };
  const day = new Date().toISOString().slice(0, 10); if (st.ai.day !== day) st.ai = { day, n: 0 };
  // OpenRouter if its key is set, else Groq; capped at 300 model answers a day so the spend stays in cents
  // Surplus first (inference paid in CREDIT on Robinhood Chain), then OpenRouter, then Groq
  const ai = env.SURPLUS_API_KEY ? { url: 'https://api.surplusllm.com/api/v1/chat/completions', key: env.SURPLUS_API_KEY, model: env.SURPLUS_MODEL || 'anthropic/claude-haiku-5.5', via: 'Surplus' }
    : env.OPENROUTER_API_KEY ? { url: 'https://openrouter.ai/api/v1/chat/completions', key: env.OPENROUTER_API_KEY, model: env.OPENROUTER_MODEL || 'anthropic/claude-haiku-5.5' }
    : env.GROQ_API_KEY ? { url: 'https://api.groq.com/openai/v1/chat/completions', key: env.GROQ_API_KEY, model: env.GROQ_MODEL || 'llama-3.3-70b-versatile' } : null;
  if (ai && st.ai.n < 300 && allow(st, ip, 'ask', 20)) {
    try {
      const r = await fetch(ai.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ai.key },
        // thinking is switched off where the provider allows it: with it on, the whole allowance went to reasoning and the answer came back empty
        body: JSON.stringify({ model: ai.model, temperature: 0.3, max_tokens: 500, ...(ai.via ? {} : env.OPENROUTER_API_KEY ? { reasoning: { enabled: false } } : {}), messages: [{ role: 'system', content: RULES + ' ' + task }, { role: 'user', content: facts }] }) });
      if (r.ok) { const j = await r.json(), t = j.choices?.[0]?.message?.content?.trim(); if (t) { out = { text: t.slice(0, 900), by: 'model', via: ai.via || 'OpenRouter' }; st.ai.n++; } }
      else if (ai.via && env.OPENROUTER_API_KEY) {   // Surplus out of balance or down: the same model through OpenRouter
        const r2 = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.OPENROUTER_API_KEY },
          body: JSON.stringify({ model: env.OPENROUTER_MODEL || 'anthropic/claude-haiku-5.5', temperature: 0.3, max_tokens: 500, reasoning: { enabled: false }, messages: [{ role: 'system', content: RULES + ' ' + task }, { role: 'user', content: facts }] }) });
        if (r2.ok) { const j = await r2.json(), t = j.choices?.[0]?.message?.content?.trim(); if (t) { out = { text: t.slice(0, 900), by: 'model', via: 'OpenRouter' }; st.ai.n++; } }
      }
    } catch (e) {}
  }
  st.said[key] = out;
  const keys = Object.keys(st.said); if (keys.length > 400) keys.slice(0, 100).forEach(k => delete st.said[k]);
  return out;
}
function explain(st, env, b, ip) {
  const steps = (b.steps || []).slice(0, 7), q = String(b.q || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  const facts = `Token ${word(b.sym)}. Verdict ${word(b.verdict)}, score ${num(b.score, 0, 100)}/100, sent to ${word(b.platform)}.\n` + steps.map(s => `${word(s.name)}: ${word(s.tag, 20)}. ${String(s.detail || '').slice(0, 200)}`).join('\n');
  const worst = steps.filter(s => s.status === 'bad' || s.status === 'warn').slice(0, 2).map(s => s.detail).join(' ');
  const where = b.platform === 'long' ? 'the long desk' : b.platform === 'short' ? 'the short desk' : 'the depot, with no trade';
  const plain = `${word(b.sym)} scored ${num(b.score, 0, 100)} out of 100, so the judge called it ${word(b.verdict).toLowerCase()} and sent it to ${where}. ${worst || 'None of the seven stops raised a flag.'} This is a fixed-rule reading of public chain data and it can be wrong.`;
  if (q) return conduct(st, env, ip, `q:${String(b.addr).toLowerCase()}:${num(b.score, 0, 100)}:${q.toLowerCase()}`, 'A visitor asks a question about this ticket. Answer it in at most three sentences from the findings.', facts + '\n\nQuestion: ' + q, 'The conductor can only answer that with its language model, which is not available right now. The findings are all listed in the route above.');
  return conduct(st, env, ip, `v:${String(b.addr).toLowerCase()}:${num(b.score, 0, 100)}`, 'Explain this verdict to an ordinary person in three short sentences. Name the one or two findings that mattered most. End by noting it is a rule-based reading that can be wrong.', facts, plain);
}
function tradeBrief(st, env, b, ip) {
  const side = b.side === 'short' ? 'short' : 'long', lev = num(b.lev, 1, 100), col = num(b.col), size = col * lev, price = num(b.price), liq = num(b.liq);
  if (!price || !col || !liq) return { text: 'Load a token and set a size first.', by: 'rules' };
  const k = impact(size, liq), entry = fill(price, size, liq, side === 'long'), fee = size * FEE, lp = num(b.liqPrice), dist = Math.abs(lp / entry - 1) * 100;
  const facts = `Paper trade, nothing real. ${side.toUpperCase()} ${word(b.sym)} at ${lev}x. Collateral ${col.toFixed(0)} USDG, position size ${size.toFixed(0)} USDG, borrowed ${(size - col).toFixed(0)} USDG. Quoted price ${sig(price)}, expected fill ${sig(entry)} (${(k * 100).toFixed(2)}% price impact because the pool holds ${money(liq)} USD). Fee ${fee.toFixed(2)} USDG to open and about the same to close. Borrow cost 0.02% an hour on the borrowed part. Liquidated near ${sig(lp)}, which is ${dist.toFixed(1)}% ${side === 'long' ? 'below' : 'above'} the fill. Liquidation means 90% of the collateral is gone. Verdict on this token: ${word(b.verdict) || 'not checked yet'}.`;
  const plain = `This ${side} puts ${col.toFixed(0)} USDG of paper collateral behind a ${size.toFixed(0)} USDG position at ${lev}x. It should fill near ${sig(entry)}, ${(k * 100).toFixed(2)}% from the quoted price because of the pool's depth, and costs ${fee.toFixed(2)} USDG to open and about the same to close. A ${dist.toFixed(1)}% move ${side === 'long' ? 'down' : 'up'}, to about ${sig(lp)}, liquidates it.`;
  return conduct(st, env, ip, `t:${word(b.sym)}:${side}:${lev}:${Math.round(col / 25)}:${price.toPrecision(3)}`, 'Explain this paper trade before it is opened, in four short sentences: what is borrowed, what it costs, what a 10% move in each direction does to the collateral, and where it is liquidated. Do not say whether to take it.', facts, plain);
}
// a short spoken summary of the crew desk, rewritten at most every 30 minutes and only when something happened
async function brief(st, env, ip) {
  const now = Date.now(), last = st.log[0]?.[0] || 0;
  if (st.brief && (now - st.brief.t < 30 * 60000 || last <= st.brief.t)) return st.brief;
  const eq = equity(st), wins = st.hist.filter(h => h.pnl > 0).length;
  const plain = st.pos.length || st.hist.length ? `The crew desk is worth ${money(eq)} USDG against a start of ${money(START)}. It holds ${st.pos.length} open position${st.pos.length === 1 ? '' : 's'} and has closed ${st.hist.length}, ${wins} of them at a gain.` : 'The crew desk has not traded yet. It opens a paper position when a visitor runs a ticket that comes back clean, or danger on a pool deep enough to short.';
  if (!st.pos.length && !st.hist.length) return st.brief = { t: now, text: plain, by: 'rules' };
  const facts = `Crew desk, paper money. Equity ${eq.toFixed(2)} USDG, started with ${START}. Free cash ${st.cash.toFixed(2)}.\nOpen: ${st.pos.map(p => { const v = worth(p); return `${p.side} ${p.sym} ${p.lev}x, collateral ${p.col}, result so far ${v.net.toFixed(2)}`; }).join('; ') || 'none'}.\nClosed (latest first): ${st.hist.slice(0, 6).map(h => `${h.side} ${h.sym} ${h.pnl.toFixed(2)} (${h.why})`).join('; ') || 'none'}.\nLog: ${st.log.slice(0, 8).map(l => l[1] + ': ' + l[2]).join(' | ')}`;
  delete st.said['brief'];
  const out = await conduct(st, env, ip, 'brief', 'Give a three-sentence status of the crew desk: how it stands against its start, what it holds, and what happened most recently.', facts, plain);
  delete st.said['brief'];
  return st.brief = { t: now, text: out.text, by: out.by };
}

// Post-mortems: once a crew position is closed, the conductor writes why it made or lost money, from that trade's own
// numbers. It explains after the fact; it never chose the trade. One per alarm run, so the daily allowance stays small.
async function postMortem(st, env) {
  const h = st.hist.find(x => !x.note && Date.now() - x.t < 6 * HOUR); if (!h) return;
  const held = Math.max(1, Math.round((h.t - (h.opened || h.t)) / 60000)), move = h.entry ? (h.exit / h.entry - 1) * 100 : 0;
  const v = st.verdicts.find(x => x.addr === h.addr);
  const facts = `Paper trade by the crew desk. ${h.side.toUpperCase()} ${h.sym} at ${h.lev}x. Entry ${sig(h.entry)}, exit ${sig(h.exit)}, a ${move.toFixed(2)}% price move. Held ${held} minutes. Closed because: ${h.why}. Result ${h.pnl.toFixed(2)} USDG after ${h.fees.toFixed(2)} in fees and borrow.${v ? ` It was opened on a ${v.verdict} ${v.score} verdict${v.tags?.length ? ` (stops: ${v.tags.join(', ')})` : ''}.` : ''}`;
  const plain = `${h.side === 'long' ? 'Long' : 'Short'} ${h.sym} closed ${h.pnl >= 0 ? 'up' : 'down'} ${money(Math.abs(h.pnl))} USDG: the price moved ${move.toFixed(1)}% in ${held} minutes and the guard closed it on ${h.why}.`;
  h.note = await conduct(st, env, 'crew', 'pm:' + h.addr + ':' + h.t, 'Write a two or three sentence post-mortem of this closed paper trade: what the price did, why the guard closed it, and what that says about the verdict it was opened on. No advice, no prediction.', facts, plain);
}
// the report's paragraph, rewritten at most every three hours
async function reportNote(st, env, r) {
  const now = Date.now(); if (st.rnote && now - st.rnote.t < 3 * HOUR) return st.rnote;
  const facts = `Crew desk, paper money, last 24 hours. Equity ${r.equity} USDG (${r.change >= 0 ? '+' : ''}${r.change} in 24 hours, ${r.total >= 0 ? '+' : ''}${r.total} since it started with ${r.start}). Verdicts: ${r.verdicts.CLEAN} clean, ${r.verdicts.RISKY} risky, ${r.verdicts.DANGER} danger. Of ${r.judged} calls checked an hour later, ${r.held} held. Trades closed: ${r.closed}, ${r.wins} in profit. Best: ${r.best ? `${r.best.sym} ${r.best.side} ${r.best.pnl}` : 'none'}. Worst: ${r.worst ? `${r.worst.sym} ${r.worst.side} ${r.worst.pnl}` : 'none'}. Open now: ${r.open}. Tokens that graduated from Pons: ${r.grads}.`;
  const plain = `The crew desk ${r.change >= 0 ? 'gained' : 'lost'} ${money(Math.abs(r.change))} USDG in 24 hours and stands at ${money(r.equity)}. ${r.judged ? `${r.held} of ${r.judged} calls held an hour later.` : 'No call has been checked an hour later yet.'}`;
  delete st.said['rnote'];
  const out = await conduct(st, env, 'crew', 'rnote', 'Write the daily report paragraph for the crew desk in three plain sentences: how it did, how its calls held up, and the one thing that mattered most. Misses are said plainly. No advice.', facts, plain);
  delete st.said['rnote'];
  return st.rnote = { t: now, text: out.text, by: out.by };
}

// ---------- a second read from ChargeAI, an open model for Pons launches served on Surplus ----------
// Shuntdesk's verdict stays its own; this is another model's opinion, shown beside it. The facts sent are the ones the
// browser's checks found, rebuilt here from numbers only. Shared for 30 minutes per token, capped at 200 a day.
const CHARGE = 'launch/charge-ai/charge-30b@9ff2ef1';
const seconds = new Map(); let secondDay = { day: '', n: 0 };
async function secondRead(st, env, b, ip) {
  const addr = String(b.addr || '').toLowerCase(); if (!isAddr(addr)) return { ok: false, why: 'bad address' };
  const hit = seconds.get(addr), now = Date.now(); if (hit && now - hit.t < 30 * 60000) return hit.v;
  if (!env.SURPLUS_API_KEY) return { ok: false, why: 'not set up' };
  const day = new Date().toISOString().slice(0, 10); if (secondDay.day !== day) secondDay = { day, n: 0 };
  if (secondDay.n >= 200 || !allow(st, ip, 'second', 15)) return { ok: false, why: 'busy, try again later' };
  const L = await launch(env, addr).catch(() => null);
  if (!L?.launchpad || L.launchpad !== 'pons') return { ok: false, why: 'ChargeAI reads Pons launches only' };
  const n = (v, d = 1) => Number.isFinite(Number(v)) ? Number(v).toFixed(d) : 'unknown';
  const facts = `Pons launch on Robinhood Chain. Token ${word(b.sym, 12)}, ${addr}. Age ${n(num(b.ageMin, 0, 1e7) / 60, 1)} hours. ${L.graduated ? 'Graduated from the curve.' : `Curve progress ${n(L.progress, 0)}%.`} Holders ${num(b.holders, 0, 1e9)}. Top 10 wallets hold ${n(b.top10)}%. Snipers hold ${n(L.sniperPct)}%, bundlers ${n(L.bundlerPct)}%, insiders ${n(L.insiderPct)}%, developer ${n(L.devPct)}%. Liquidity about $${Math.round(num(b.liq))}.${b.chg != null ? ` Price change 24h ${n(b.chg, 0)}%.` : ''}\nRead this launch.`;
  secondDay.n++;
  let v = { ok: false, why: 'ChargeAI did not answer' };
  try {
    const r = await fetch('https://api.surplusllm.com/api/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.SURPLUS_API_KEY }, body: JSON.stringify({ model: CHARGE, max_tokens: 320, temperature: 0.2, messages: [{ role: 'user', content: facts }] }) });
    const j = await r.json().catch(() => null), t = j?.choices?.[0]?.message?.content;
    // the site carries no emoji, so pictographs in the model's reply are dropped; the words are kept as written
    if (t) v = { ok: true, text: t.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').replace(/[ \t]+\n/g, '\n').trim().slice(0, 900), model: 'ChargeAI (charge-30b)', via: 'Surplus', t: now };
    else if (r.status === 402) v = { ok: false, why: 'the Surplus balance is empty' };
  } catch (e) {}
  seconds.set(addr, { t: now, v }); if (seconds.size > 300) seconds.delete(seconds.keys().next().value);
  return v;
}

// ---------- MCP: the same reads as tools, over Streamable HTTP (JSON responses, no session state) ----------
// Add it to a client as a remote server at https://shuntdesk.com/mcp. Read-only, no key, 120 calls an hour per caller.
const MCP_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const ADDR = { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$', description: 'A token address on Robinhood Chain (chain id 4663)' };
const TOOLS = [
  { name: 'token', title: 'What Shuntdesk knows about one token', p: 'token', description: 'The latest Shuntdesk verdict on a Robinhood Chain token (CLEAN, RISKY or DANGER, scored out of 100) and how its price moved an hour and a day later, a fresh server-side security read (red flags, holders), launch facts for Pons tokens (snipers, bundles, insiders, developer share, curve progress) and the crew desk position. verdict is null when nobody has run the checks yet; the reply carries the link that runs them. A verdict is a rule-based reading and can be wrong. Not advice.', inputSchema: { type: 'object', properties: { address: ADDR }, required: ['address'], additionalProperties: false } },
  { name: 'verdicts', title: 'Latest verdicts', p: 'verdicts', description: 'The 50 latest verdicts Shuntdesk filed, each with its price at the call and an hour and a day later, and how many CLEAN and DANGER calls held an hour later.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'crew_desk', title: 'The crew desk', p: 'desk', description: 'The public paper desk that bets on Shuntdesk verdicts: equity in paper USDG, open positions, and the last 20 closed trades, each with a post-mortem. All money is simulated.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'pons_graduations', title: 'Fresh Pons graduations', p: 'graduated', description: 'Tokens that just completed the Pons bonding curve on Robinhood Chain, read from the Pons V2 factory log.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'daily_report', title: 'Daily report', p: 'report', description: 'The crew desk over the last 24 hours: balance and change, verdict counts, how many calls held, best and worst trade, with a one-paragraph summary.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
];
async function mcp(st, env, request, body, ip) {
  const H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'POST JSON-RPC to this address; this server does not stream' }), { status: 405, headers: { ...H, Allow: 'POST' } });
  const one = async m => {
    if (!m || m.jsonrpc !== '2.0' || typeof m.method !== 'string') return { jsonrpc: '2.0', id: m?.id ?? null, error: { code: -32600, message: 'Invalid request' } };
    if (m.id === undefined) return null;   // a notification (notifications/initialized and the like): nothing to answer
    const ok = result => ({ jsonrpc: '2.0', id: m.id, result }), fail = (code, message) => ({ jsonrpc: '2.0', id: m.id, error: { code, message } });
    if (m.method === 'initialize') {
      const want = m.params?.protocolVersion, v = MCP_VERSIONS.includes(want) ? want : MCP_VERSIONS[0];
      return ok({ protocolVersion: v, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'shuntdesk', title: 'Shuntdesk', version: '1.1.0' },
        instructions: 'Read-only tools for Robinhood Chain tokens from shuntdesk.com. Quote a verdict as a rule-based reading of public data that can be wrong, never as advice, and link https://shuntdesk.com/ticket/?a=<address>.' });
    }
    if (m.method === 'ping') return ok({});
    if (m.method === 'tools/list') return ok({ tools: TOOLS.map(({ p, ...t }) => ({ ...t, annotations: { readOnlyHint: true, openWorldHint: true } })) });
    if (m.method === 'tools/call') {
      const tool = TOOLS.find(t => t.name === m.params?.name); if (!tool) return fail(-32602, 'Unknown tool: ' + String(m.params?.name).slice(0, 40));
      if (!allow(st, ip, 'agent', 120)) return ok({ isError: true, content: [{ type: 'text', text: 'Rate limited: 120 calls an hour.' }] });
      const a = String(m.params?.arguments?.address || '').toLowerCase();
      if (tool.p === 'token' && !isAddr(a)) return ok({ isError: true, content: [{ type: 'text', text: 'address must be 0x followed by 40 hex characters' }] });
      const [code, out] = await agentData(st, env, tool.p, a);
      return ok({ isError: code !== 200, content: [{ type: 'text', text: JSON.stringify(out, null, 1) }], structuredContent: out });
    }
    return fail(-32601, 'Method not found: ' + m.method.slice(0, 40));
  };
  if (!body || (typeof body !== 'object')) return new Response(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }), { status: 400, headers: H });
  const res = Array.isArray(body) ? (await Promise.all(body.slice(0, 20).map(one))).filter(Boolean) : await one(body);
  await save(env, st);
  if (!res || (Array.isArray(res) && !res.length)) return new Response(null, { status: 202, headers: H });
  return new Response(JSON.stringify(res), { status: 200, headers: H });
}

// ---------- rug replay: a token's whole life on one line, with every real event marked ----------
// Launch and graduation from the Pons factory log (Blockscout's index), price history from Codex, the verdict
// Shuntdesk filed at the time if it had one, and the steepest fall. Cached 30 minutes per token, 120 a day.
const replays = new Map(); let replayDay = { day: '', n: 0 };
const word64 = a => '0x' + a.slice(2).padStart(64, '0');
async function ponsEvents(env, addr) {
  const out = {}; if (!env.BLOCKSCOUT_API_KEY) return out;
  for (const [k, t0] of [['launch', T_LAUNCH], ['graduated', T_GRAD]]) {
    try {
      const r = await fetch(`https://api.blockscout.com/4663/api?module=logs&action=getLogs&address=${PONS}&fromBlock=39100000&toBlock=latest&topic0=${t0}&topic1=${word64(addr)}&topic0_1_opr=and&apikey=${env.BLOCKSCOUT_API_KEY}`, { headers: UA });
      const l = (await r.json()).result?.[0];
      if (l) out[k] = { t: parseInt(l.timeStamp, 16) * 1000, block: parseInt(l.blockNumber, 16), by: k === 'launch' ? wordAddr(l.topics[3]) : null };
    } catch (e) {}
  }
  return out;
}
async function replay(st, env, addr) {
  const hit = replays.get(addr), now = Date.now(); if (hit && now - hit.t < 30 * 60000) return hit.v;
  const day = new Date().toISOString().slice(0, 10); if (replayDay.day !== day) replayDay = { day, n: 0 };
  if (!env.CODEX_API_KEY || replayDay.n >= 120) return { ok: false, why: 'busy, try again later' };
  replayDay.n++;
  const [ev, L] = await Promise.all([ponsEvents(env, addr), launch(env, addr).catch(() => null)]);
  // the price line from launch (or 30 days back) to now, at a resolution that keeps it under ~600 bars
  const to = Math.floor(now / 1000), from = Math.max(to - 30 * 86400, ev.launch ? Math.floor(ev.launch.t / 1000) - 600 : to - 30 * 86400), span = to - from;
  const res = span <= 2 * 86400 ? '5' : span <= 7 * 86400 ? '15' : span <= 20 * 86400 ? '60' : '240';
  let bars = [];
  if (await codexOk(env, 'replay')) try {
    const q = `{ getBars(symbol: "${addr}:4663", from: ${from}, to: ${to}, resolution: "${res}", removeLeadingNullValues: true) { t o h l c v } }`;
    const r = await fetch('https://graph.codex.io/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: env.CODEX_API_KEY }, body: JSON.stringify({ query: q }) });
    const b = (await r.json()).data?.getBars;
    if (b) bars = b.t.map((t, i) => ({ t: t * 1000, o: b.o[i], h: b.h[i], l: b.l[i], c: b.c[i], v: b.v?.[i] || 0 })).filter(x => x.c != null && x.o != null);
  } catch (e) {}
  if (!bars.length && !ev.launch) { const v = { ok: false, why: 'no price history found for this token' }; replays.set(addr, { t: now, v }); return v; }
  // the peak, the steepest fall from it, and where the price stands now
  let peak = bars[0] || null; for (const b of bars) if (b.h > peak.h) peak = b;
  let fall = null; if (peak) { let low = peak; for (const b of bars) if (b.t >= peak.t && b.l < low.l) low = b; fall = low !== peak ? { t: low.t, price: low.l, fromPeak: low.l / peak.h - 1 } : null; }
  let drop = null; for (let i = 1; i < bars.length; i++) { const d = bars[i].c / bars[i - 1].c - 1; if (!drop || d < drop.d) drop = { t: bars[i].t, d, from: bars[i - 1].c, to: bars[i].c }; }
  const last = bars[bars.length - 1] || null;
  const vs = st.verdicts.filter(v => v.addr === addr).map(v => ({ t: v.t, verdict: v.verdict, score: v.score, desk: v.platform, claimed: v.claimed || null, price: v.p0, after1h: v.p1h || null, after24h: v.p24h || null, stops: v.tags || [] })).sort((a, b) => a.t - b.t);
  const sym = (await goplus(env, addr).catch(() => null))?.token_symbol || vs[0]?.sym || null;
  const v = { ok: true, token: addr, symbol: sym, res, bars: bars.map(b => [b.t, b.o, b.h, b.l, b.c]), launch: ev.launch || null, graduated: ev.graduated || null,
    peak: peak ? { t: peak.t, price: peak.h } : null, fall, drop: drop && drop.d < -0.2 ? drop : null, now: last ? { t: last.t, price: last.c, fromPeak: peak ? last.c / peak.h - 1 : null } : null,
    verdicts: vs, launchFacts: L?.ok && L.launchpad ? L : null };
  replays.set(addr, { t: now, v }); if (replays.size > 200) replays.delete(replays.keys().next().value);
  return v;
}
// calls on file whose price later fell hard: the replays worth watching
function rugs(st) {
  return st.verdicts.map(v => { const later = v.p24h || v.p1h; return later && v.p0 ? { token: v.addr, symbol: v.sym, verdict: v.verdict, score: v.score, t: v.t, fall: later / v.p0 - 1, after: v.p24h ? '24h' : '1h' } : null; })
    .filter(x => x && x.fall <= -0.5).sort((a, b) => a.fall - b.fall).slice(0, 12);
}

// the yard game's trains: calls on file whose later price is known, with what the ticket showed when it was filed
function playTrains(st) {
  return st.verdicts.filter(v => v.p0 && (v.p1h || v.p24h)).slice(0, 80).map(v => ({ token: v.addr, symbol: v.sym, liq: v.liq, zone: v.zone, score: v.score, verdict: v.verdict, stops: v.tags || [],
    at: new Date(v.t).toISOString(), move1h: v.p1h ? v.p1h / v.p0 - 1 : null, move24h: v.p24h ? v.p24h / v.p0 - 1 : null }));
}

// ---------- the Yard's leaderboard: each shift is scored here, from the calls on file ----------
// The page only says which trains it got and which lever it pulled; the price after comes from the record, so a
// shift cannot claim a read it did not make. Weekly, like the board of desks.
function yardScore(v, call) {
  const later = v.p24h || v.p1h, m = later / v.p0 - 1, fell = m <= -0.02, rose = m >= 0.02;
  const desk = v.verdict === 'CLEAN' ? rose : !rose;
  if (call === 'RIDE') return { right: rose, pts: rose ? 100 : !fell ? 20 : 0, desk };
  if (call === 'SIDING') return { right: !rose, pts: fell ? 100 + Math.round(Math.min(1, -m) * 80) : !rose ? 40 : 0, desk };
  return { right: false, pts: 0, desk };
}
function yardRoll(st) {
  const id = seasonId();
  if (!st.yard) st.yard = { id, rows: {}, past: [] };
  if (st.yard.id !== id) {
    const top = Object.entries(st.yard.rows).sort((a, b) => b[1].pts - a[1].pts)[0];
    st.yard = { id, rows: {}, past: [{ id: st.yard.id, handle: top ? top[0] : null, pts: top ? top[1].pts : 0 }, ...(st.yard.past || [])].slice(0, 8) };
  }
}
function yardView(st, me) {
  yardRoll(st);
  const rows = Object.entries(st.yard.rows).map(([handle, r]) => ({ handle, ...r })).sort((a, b) => b.pts - a.pts || a.t - b.t);
  return { season: st.yard.id, ends: st.yard.id + 7 * 24 * HOUR, rows: rows.slice(0, 30), past: st.yard.past, rank: me ? rows.findIndex(r => r.handle === me) + 1 || null : null, players: rows.length };
}
function yardShift(st, body) {
  const h = String(body?.handle || '').trim().toLowerCase();
  if (!/^[a-z0-9_]{2,16}$/.test(h)) return [400, { ok: false, why: 'handle must be 2 to 16 letters, digits or _' }];
  const calls = Array.isArray(body.calls) ? body.calls.slice(0, 5) : [], seen = new Set();
  let pts = 0, right = 0, read = 0, desk = 0;
  for (const c of calls) {
    const a = String(c?.token || '').toLowerCase(); if (!isAddr(a) || seen.has(a)) continue; seen.add(a);
    const v = st.verdicts.find(x => x.addr === a && x.p0 && (x.p1h || x.p24h)); if (!v) continue;
    const s = yardScore(v, c.call === 'RIDE' || c.call === 'SIDING' ? c.call : null);
    pts += s.pts; read++; if (s.right) right++; if (s.desk) desk++;
  }
  if (!read) return [400, { ok: false, why: 'none of those trains is on file' }];
  yardRoll(st);
  const r = st.yard.rows[h] || { pts: 0, right: 0, read: 0, shifts: 0, beat: 0, best: 0 };
  Object.assign(r, { pts: r.pts + pts, right: r.right + right, read: r.read + read, shifts: r.shifts + 1, beat: r.beat + (right > desk ? 1 : 0), best: Math.max(r.best, pts), t: Date.now() });
  st.yard.rows[h] = r;
  const all = Object.entries(st.yard.rows); if (all.length > 500) all.sort((a, b) => a[1].pts - b[1].pts).slice(0, 100).forEach(([k]) => delete st.yard.rows[k]);
  return [200, { ok: true, shift: { pts, right, read, desk }, ...yardView(st, h) }];
}

// ---------- the Yard's daily shift: the same five trains for everyone, one go each, a board for the day ----------
const YARD_DAY0 = Date.UTC(2026, 9, 16);
function yardDaily(st) {
  const day = new Date().toISOString().slice(0, 10);
  if (st.daily?.day !== day || new Set(st.daily.tokens).size < st.daily.tokens.length) {
    // a fixed pick for the day, made the first time anyone asks: shuffled with the date as the seed
    const seen = new Set(), pool = playTrains(st).filter(t => !seen.has(t.token) && seen.add(t.token)); let seed = [...day].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
    const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;
    const pick = pool.map(t => [rnd(), t]).sort((a, b) => a[0] - b[0]).slice(0, 5).map(x => x[1].token);
    st.daily = { day, tokens: pick, rows: {} };
  }
  return st.daily;
}
function dailyView(st, me) {
  const d = yardDaily(st), seen = new Set(), trains = playTrains(st).filter(t => d.tokens.includes(t.token) && !seen.has(t.token) && seen.add(t.token)).map(({ move1h, move24h, ...t }) => t);
  const rows = Object.entries(d.rows).map(([handle, r]) => ({ handle, ...r })).sort((a, b) => b.right - a.right || b.pts - a.pts || a.t - b.t);
  return { day: d.day, no: Math.floor((Date.UTC(...d.day.split('-').map((v, i) => i === 1 ? v - 1 : +v)) - YARD_DAY0) / 864e5) + 1, trains, rows: rows.slice(0, 30), players: rows.length, rank: me ? rows.findIndex(r => r.handle === me) + 1 || null : null, played: me ? !!d.rows[me] : false };
}
function dailyShift(st, body) {
  const h = String(body?.handle || '').trim().toLowerCase(); if (!/^[a-z0-9_]{2,16}$/.test(h)) return [400, { ok: false, why: 'handle must be 2 to 16 letters, digits or _' }];
  const d = yardDaily(st); if (d.rows[h]) return [409, { ok: false, why: 'already played today', ...dailyView(st, h) }];
  const calls = (Array.isArray(body.calls) ? body.calls : []).filter(c => d.tokens.includes(String(c?.token || '').toLowerCase()));
  if (calls.length < d.tokens.length) return [400, { ok: false, why: 'a daily shift has to call all of today\'s trains' }];
  const [code, out] = yardShift(st, { handle: h, calls }); if (code !== 200) return [code, out];
  d.rows[h] = { pts: out.shift.pts, right: out.shift.right, read: out.shift.read, desk: out.shift.desk, t: Date.now() };
  return [200, { ok: true, shift: out.shift, weekly: { rank: out.rank }, ...dailyView(st, h) }];
}

// ---------- phone alerts: Web Push for watched tokens, sent even when no Shuntdesk tab is open ----------
// A browser subscribes with the site's VAPID key and names the tokens it watches. Every 30 minutes the server prices
// them all in one Codex read and compares with the price and liquidity it saw first. A move of 30% or more queues a
// message and wakes the browser with an empty push; the service worker then fetches the message from the inbox.
// No payload is sent, so nothing has to be encrypted, and the push service only ever sees that something changed.
const PUSH_MOVE = 0.3, PUSH_MAX = 300, PUSH_TOKENS = 12;
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uJson = o => b64u(new TextEncoder().encode(JSON.stringify(o)));
let vapidKey = null;
async function vapidHeader(env, endpoint) {
  if (!vapidKey) vapidKey = await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_PRIVATE), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const u = new URL(endpoint), head = b64uJson({ typ: 'JWT', alg: 'ES256' }), claims = b64uJson({ aud: u.origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'https://shuntdesk.com' });
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, vapidKey, new TextEncoder().encode(head + '.' + claims));
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${env.VAPID_PUBLIC}`;
}
async function wake(env, sub) {
  const r = await fetch(sub.endpoint, { method: 'POST', headers: { TTL: '43200', Urgency: 'normal', Authorization: await vapidHeader(env, sub.endpoint), 'Content-Length': '0' } });
  return r.status;
}
function pushSubscribe(st, b) {
  const ep = String(b?.sub?.endpoint || '');
  if (!/^https:\/\/[^\s]{10,500}$/.test(ep)) return [400, { ok: false, why: 'no push subscription' }];
  const tokens = (Array.isArray(b.tokens) ? b.tokens : []).slice(0, PUSH_TOKENS).map(t => ({ addr: String(t.addr || '').toLowerCase(), sym: word(t.sym, 12) })).filter(t => isAddr(t.addr));
  const P = st.push = st.push || {};
  let id = String(b.id || ''); if (!P[id] || P[id].endpoint !== ep) id = Object.keys(P).find(k => P[k].endpoint === ep) || crypto.randomUUID();
  const old = P[id] || { base: {}, inbox: [], made: Date.now() };
  // a token keeps the baseline it already had; a new one gets its baseline at the next server read
  const base = {}; for (const t of tokens) if (old.base[t.addr]) base[t.addr] = old.base[t.addr];
  P[id] = { endpoint: ep, tokens, base, inbox: old.inbox.slice(0, 10), made: old.made, t: Date.now() };
  const ids = Object.keys(P); if (ids.length > PUSH_MAX) ids.sort((a, z) => P[a].t - P[z].t).slice(0, ids.length - PUSH_MAX).forEach(k => delete P[k]);
  return [200, { ok: true, id, watching: tokens.length }];
}
async function pushTick(st, env) {
  const P = st.push; if (!P || !env.VAPID_PRIVATE || !env.CODEX_API_KEY) return;
  const now = Date.now(); if (now - (st.pushT || 0) < 30 * 60000) return; st.pushT = now;
  const all = [...new Set(Object.values(P).flatMap(s => s.tokens.map(t => t.addr)))].slice(0, 200); if (!all.length) return;
  const px = {};
  for (let i = 0; i < all.length; i += 25) {
    if (!(await codexOk(env, 'push'))) break;
    const q = `{ filterTokens(tokens: [${all.slice(i, i + 25).map(a => `"${a}:4663"`).join(',')}], limit: 25) { results { priceUSD liquidity token { address } } } }`;
    try { const r = await fetch('https://graph.codex.io/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: env.CODEX_API_KEY }, body: JSON.stringify({ query: q }) }); for (const x of (await r.json()).data?.filterTokens?.results || []) px[x.token.address.toLowerCase()] = { p: Number(x.priceUSD) || 0, l: Number(x.liquidity) || 0 }; } catch (e) {}
  }
  let sent = 0;
  for (const [id, s] of Object.entries(P)) {
    const msgs = [];
    for (const t of s.tokens) {
      const now1 = px[t.addr]; if (!now1 || !now1.p) continue;
      const b0 = s.base[t.addr]; if (!b0) { s.base[t.addr] = { p: now1.p, l: now1.l, said: {} }; continue; }
      const said = b0.said || (b0.said = {}), say = (k, text) => { if (now - (said[k] || 0) > 6 * HOUR) { said[k] = now; msgs.push({ t: now, addr: t.addr, sym: t.sym, text }); } };
      if (b0.l && now1.l < b0.l * (1 - PUSH_MOVE)) say('liq', `Liquidity fell ${Math.round((1 - now1.l / b0.l) * 100)}% since you started watching.`);
      if (now1.p < b0.p * (1 - PUSH_MOVE)) say('down', `Price is down ${Math.round((1 - now1.p / b0.p) * 100)}% since you started watching.`);
      if (now1.p > b0.p * (1 + PUSH_MOVE)) say('up', `Price is up ${Math.round((now1.p / b0.p - 1) * 100)}% since you started watching.`);
    }
    if (!msgs.length) continue;
    s.inbox = [...msgs, ...s.inbox].slice(0, 10);
    try { const code = await wake(env, s); if (code === 404 || code === 410) delete P[id]; else sent++; } catch (e) {}
  }
  st.pushLast = { t: now, tokens: all.length, priced: Object.keys(px).length, sent };
}

// ---------- the Telegram bot, @shuntdesk_bot: a webhook that answers in the same request ----------
// Telegram posts each update here with the secret set at setWebhook; the reply goes back as the response body.
const tgEsc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const pct = v => v == null ? '—' : Number(v).toFixed(1) + '%';
// free questions on Telegram: the conductor answers from what Shuntdesk actually holds right now
const ABOUT = 'Shuntdesk (shuntdesk.com) runs seven fixed-rule checks on Robinhood Chain tokens in the browser (sources, gate, scout, tracer, linker, auditor, judge) and gives CLEAN (75+), RISKY (45-74) or DANGER (under 45). The crew desk is a public paper desk: CLEAN calls go long, DANGER calls on pools with $20K+ go short, 4% of equity each, paper money only. Every call is priced again after an hour and a day; the record is on Hugging Face (huggingface.co/datasets/shuntdesk/verdicts). Site pages (links, not bot commands): shuntdesk.com/ticket (run the checks), shuntdesk.com/board (live yard, Pons graduations), shuntdesk.com/desk (your paper desk, 10,000 paper USDG, up to 100x on deep pools), shuntdesk.com/deployer (what a wallet launched on Pons), shuntdesk.com/replay (a token\'s fall with its events), shuntdesk.com/report (daily), shuntdesk.com/agents (JSON API, MCP at shuntdesk.com/mcp). Bot commands: /check 0x..., /new, /desk, /report. Phone alerts for watched tokens. $SHUNT is the project token, CA 0x7e517e779b85895894becad80c9bb69b4cb1c4d6, launched on Pons. No wallet, no key, no account.';
async function tgAsk(st, env, chat, q, addr) {
  const r = report(st), d = await agentData(st, env, 'desk', '').then(x => x[1]);
  let tok = ''; if (addr) { const [code, x] = await agentData(st, env, 'token', addr); if (code === 200) tok = `\nToken asked about: ${x.symbol || addr} (${addr}). Verdict on file: ${x.verdict ? `${x.verdict.verdict} ${x.verdict.score}, ${x.verdict.desk}, filed ${x.verdict.at}` : 'none yet'}. Security read: ${x.serverCheck ? (x.serverCheck.redFlags.join(', ') || 'no red flag') : 'unavailable'}. Launch: ${x.launch?.launchpad ? `${x.launch.launchpad}, snipers ${x.launch.sniperPct}%, bundles ${x.launch.bundlerPct}%, insiders ${x.launch.insiderPct}%, developer ${x.launch.devPct}%${x.launch.graduated ? ', graduated' : ''}` : 'not a launchpad token or unknown'}. Crew position: ${x.crewPosition ? x.crewPosition.side + ' ' + x.crewPosition.leverage + 'x' : 'none'}. Full check: ${x.fullCheck}`; }
  const facts = `${ABOUT}\n\nRight now: crew desk equity ${d.equity} paper USDG (started ${d.start}), ${d.open.length} open: ${d.open.slice(0, 6).map(p => `${p.symbol} ${p.side} ${p.net >= 0 ? '+' : ''}${p.net}`).join(', ') || 'none'}. Last closed: ${d.closed.slice(0, 3).map(h => `${h.symbol} ${h.side} ${h.pnl} (${h.why})`).join('; ') || 'none'}. Last 24h: ${r.verdicts.CLEAN} clean, ${r.verdicts.RISKY} risky, ${r.verdicts.DANGER} danger; ${r.judged ? `${r.held} of ${r.judged} calls held an hour later` : 'none checked an hour later yet'}. Latest calls: ${st.verdicts.slice(0, 6).map(v => `${v.sym} ${v.verdict} ${v.score}`).join(', ') || 'none'}. Pons graduations in the last day: ${(st.grads?.rows || []).length}.${tok}\n\nQuestion: ${q.slice(0, 300)}`;
  const plain = addr ? `I can only answer that with the language model, which is not available right now. Send /check ${addr} for what Shuntdesk knows.` : 'I can only answer that with the language model, which is not available right now. Try /help.';
  const out = await conduct(st, env, 'tg:' + chat, 'tg:' + chat + ':' + q.toLowerCase().slice(0, 120), 'You are answering on Telegram as the Shuntdesk bot. Answer the question in at most four short sentences from the facts only. If the facts do not cover it, say so and point to the right page or command. Never say whether to buy or sell, never predict a price, never promise anything about $SHUNT. Plain text, no markdown, no emoji.', facts, plain);
  return tgEsc(out.text) + (out.by === 'model' ? '\n\n<i>The conductor, a language model, from Shuntdesk\'s own figures. Not advice.</i>' : '');
}
async function telegram(st, env, request, body) {
  if (!env.TELEGRAM_SECRET || request.headers.get('x-telegram-bot-api-secret-token') !== env.TELEGRAM_SECRET) return new Response('forbidden', { status: 403 });
  const msg = body?.message || body?.channel_post; const text = String(msg?.text || '').trim(), chat = msg?.chat?.id;
  if (!chat || !text) return new Response('ok');
  const reply = (html, extra = {}) => new Response(JSON.stringify({ method: 'sendMessage', chat_id: chat, text: html.slice(0, 4000), parse_mode: 'HTML', disable_web_page_preview: true, reply_to_message_id: msg.message_id, ...extra }), { headers: { 'Content-Type': 'application/json' } });
  // the bot's own username, exactly: a loose match on 'shuntdesk' would answer every message that names the X account
  const me = /bot$/i.test(env.TELEGRAM_BOT_NAME || '') ? env.TELEGRAM_BOT_NAME.toLowerCase().replace(/^@/, '') : 'shuntdesk_bot', group = msg.chat.type !== 'private';
  const mentioned = new RegExp('@' + me + '(?![a-z0-9_])', 'i').test(text) || msg.reply_to_message?.from?.username?.toLowerCase() === me;
  const clean = text.replace(new RegExp('@' + me + '(?![a-z0-9_])', 'ig'), '').trim();
  const found = clean.match(/0x[0-9a-fA-F]{40}/), cmd = (clean.match(/^\/(\w+)/)?.[1] || '').toLowerCase();
  if (group && !cmd && !mentioned) return new Response('ok');   // in groups, only speak when spoken to
  // a command meant for another bot (/start@otherbot) is not ours
  const to = clean.match(/^\/\w+@(\w+)/)?.[1]; if (group && cmd && !mentioned && to && to.toLowerCase() !== me) return new Response('ok');
  if (cmd === 'id') return reply(`This chat: <code>${chat}</code> (${tgEsc(msg.chat.type)}${msg.chat.title ? ', ' + tgEsc(msg.chat.title) : ''})`);
  if (!allow(st, 'tg:' + chat, 'tg', 40)) return reply('Slow down a little: 40 questions an hour per chat.');
  const site = 'https://shuntdesk.com', footer = '\n\n<i>A rule-based reading of public data. It can be wrong. Not advice.</i>';
  if (cmd === 'start' || cmd === 'help') return reply(`<b>Shuntdesk</b> · every token rides the line\n\nAsk anything about Shuntdesk, a token, the crew desk or what just launched. Or use:\n\n/check <code>0x…</code> what Shuntdesk knows about a Robinhood Chain token\n/scan <code>0x…</code> Agent Scan: what the contract lets its owner do\n/ledger <code>0x…</code> Dev Ledger: what the launcher did with it\n/devscore <code>0x…</code> Dev Score: every launch by that dev\n/report <code>0x…</code> report a token; the bot reads it\n/spotters who reported what lost half\n/bondgame today's Will it bond?\n/proof everything about $SHUNT you can check\n/alarms on launch alarms in your group (admins)\n
<b>For $SHUNT holders</b>\n/link connect your wallet\n/alarm your own alarms\n/boost burn $SHUNT to boost a full scan\n/watch <code>0x…</code> Tripwire: a private alarm when the owner or the big wallets move\n/daily today's daily shift in the Yard\n/new tokens that just graduated from Pons\n/desk the crew's public paper desk\n/report the last 24 hours\n\n${site}`);
  // anything that is not a command, or a token address with a question around it, goes to the conductor
  const question = clean.replace(/^\/\w+\s*/, '').replace(/0x[0-9a-fA-F]{40}/, '').trim();
  if (!cmd && (!found || question.length > 3)) return reply(await tgAsk(st, env, chat, clean, found ? found[0].toLowerCase() : null));
  if (cmd === 'watch' || cmd === 'unwatch' || cmd === 'watching') {
    if (group) return reply('Tripwire works in a private chat: open @shuntdesk_bot and send /watch there.');
    const T = st.trip || {}, mine = Object.entries(T).filter(([, w]) => w.chats.includes(chat));
    if (cmd === 'watching') return reply(mine.length ? `<b>Tripwire</b> · watching ${mine.length} of ${isHolder(st, chat) ? HOLD_TRIP : 5}\n\n${mine.map(([a, w]) => `• ${tgEsc(w.sym ? '$' + w.sym : a.slice(0, 8))} <code>${a}</code>`).join('\n')}` : 'Nothing on the tripwire. Send /watch <code>0x…</code>');
    if (!found) return reply(`Send /${cmd} followed by a token address: /${cmd} <code>0x…</code>`);
    const a = found[0].toLowerCase();
    if (cmd === 'unwatch') return reply(tripDrop(st, chat, a) ? 'Off the tripwire.' : 'That token was not on your tripwire.');
    const r = await tripAdd(st, env, chat, a);
    if (!r.ok) return reply(tgEsc(r.why));
    if (!r.w) return reply('Already on your tripwire.');
    return reply(`<b>Tripwire set</b> · ${tgEsc(r.w.sym ? '$' + r.w.sym : a.slice(0, 8))}\n\nYou will hear from me when:\n• one of its ${Object.keys(r.w.sels).length} power functions is called (${Object.values(r.w.sels).slice(0, 4).map(tgEsc).join(', ') || 'none found, so this one stays quiet'})\n• the launcher or one of the ${r.w.watch.length} wallets watched moves 0.5% of supply or more out\n\nChecked every three minutes. /watching to see your list, /unwatch <code>${a}</code> to stop.`);
  }
  if (cmd === 'scan' || cmd === 'xray') {
    if (!found) return reply('Send /scan followed by a token address: /scan <code>0x…</code>');
    const a = found[0].toLowerCase(), v = await xray(st, env, a).catch(() => null);
    if (!v?.ok) return reply(tgEsc(v?.why || 'The chain did not answer. Try again in a minute.'));
    const hp = v.powers.filter(p => p.level !== 'info' && p.level !== 'low');
    return reply(`<b>Agent Scan</b> · <code>${a.slice(0, 6)}…${a.slice(-4)}</code>\n${v.functions} functions, ${v.named} named${v.proxy ? ` · behind a ${tgEsc(v.proxy.kind)}` : ''}\n${v.owner ? (v.owner.live ? `Owner <code>${v.owner.address.slice(0, 6)}…${v.owner.address.slice(-4)}</code>` : 'Ownership renounced') : 'No owner() found'} · source ${v.source.verified ? 'verified' : v.source.verified === false ? 'not verified' : 'unknown'}\n\n${hp.length ? hp.slice(0, 8).map(p => `• <code>${tgEsc(p.fn)}</code>: ${tgEsc(p.what)}`).join('\n') : 'No function found that mints, pauses, blocks wallets or changes the tax.'}\n\n${tgEsc(v.summary.text)}\n\n${site}/scan/?a=${a}<i>\nRead from the bytecode. A function that exists may still be guarded. Not advice.</i>`);
  }
  if (cmd === 'link' || cmd === 'holder') {
    if (group) return reply('Holder tools work in a private chat: open @shuntdesk_bot and send /link there.');
    const h = st.holders?.[String(chat)];
    if (cmd === 'holder' && h) return reply(`<b>Holder</b> · <code>${h.w.slice(0, 6)}…${h.w.slice(-4)}</code>\n${Math.round(h.bal).toLocaleString('en-US')} $SHUNT, read ${(m => m < 60 ? Math.round(m) + ' min' : Math.round(m / 60) + ' h')((Date.now() - h.t) / 60000)} ago\n${tierOf(h.bal) ? `Tier: <b>${tierOf(h.bal)}</b>. Holder tools on: /alarm, Tripwire for ${HOLD_TRIP}, /boost, trusted dev alerts${h.bal >= HOLD_PRO ? ', Early Radar' : `. Early Radar opens at ${HOLD_PRO.toLocaleString('en-US')}`}` : `The holder tools open at ${HOLD_MIN.toLocaleString('en-US')} $SHUNT.`}\n\nLink another wallet: /link`);
    const code = crypto.randomUUID().replace(/-/g, '').slice(0, 10); st.links = st.links || {}; st.links[code] = { chat: String(chat), t: Date.now() };
    for (const [k, v] of Object.entries(st.links)) if (Date.now() - v.t > 30 * 60000) delete st.links[k];
    return reply(`<b>Link a $SHUNT wallet</b>\n\nOpen this page, connect the wallet that holds $SHUNT and sign one message. It moves nothing and costs nothing.\n\n${site}/holder/?c=${code}\n\nThe link works for 30 minutes. Holder tools open at ${HOLD_MIN.toLocaleString('en-US')} $SHUNT.`);
  }
  if (cmd === 'alarm') {
    if (group) return reply('Personal alarms work in a private chat.');
    if (!isHolder(st, chat)) return reply(`Personal alarms are for $SHUNT holders (${HOLD_MIN.toLocaleString('en-US')} or more). Send /link to connect your wallet.`);
    const h = st.holders[String(chat)], f = h.f = h.f || { clean: true, flags: false, curve: [] }, arg = clean.replace(/^\/\w+(@\w+)?\s*/, '').trim().toLowerCase();
    if (/^clean\b/.test(arg)) f.clean = !/\boff\b/.test(arg);
    else if (/^flags?\b/.test(arg)) f.flags = !/\boff\b/.test(arg);
    else if (/^curve\b/.test(arg)) { const m = arg.match(/\d{1,2}/g)?.map(Number).filter(v => v >= 5 && v <= 99) || []; if (/\boff\b/.test(arg)) f.curve = []; else if (m.length) f.curve = [...new Set([...f.curve, ...m])].slice(-3); }
    else if (/^early\b/.test(arg)) f.early = !/\boff\b/.test(arg);
    else if (/^dev\b/.test(arg)) f.dev = !/\boff\b/.test(arg);
    else if (/^off\b/.test(arg)) { f.clean = false; f.flags = false; f.curve = []; f.early = false; f.dev = false; }
    return reply(`<b>Your alarms</b>\n\n• clean reads of new tokens: <b>${f.clean ? 'on' : 'off'}</b>\n• new tokens with a red flag: <b>${f.flags ? 'on' : 'off'}</b>\n• Pons curves crossing: <b>${f.curve.length ? f.curve.map(v => v + '%').join(', ') : 'off'}</b>\n• trusted devs and known dumpers launching: <b>${f.dev !== false ? 'on' : 'off'}</b>\n• Early Radar, clean launches minutes old (Pro, ${HOLD_PRO.toLocaleString('en-US')} $SHUNT): <b>${h.bal >= HOLD_PRO ? (f.early !== false ? 'on' : 'off') : 'locked'}</b>\n\nChange: /alarm clean on|off · /alarm flags on|off · /alarm curve 70 · /alarm curve off · /alarm dev on|off · /alarm early on|off · /alarm off\nUp to 40 a day, in this chat.`);
  }
  if (cmd === 'boost') {
    const tk = (clean.match(/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/) || [])[0], tx = (clean.match(/0x[0-9a-fA-F]{64}/) || [])[0];
    if (!tk || !tx) return reply(`<b>Burn to boost</b>\n\nBurn ${BOOST_MIN.toLocaleString('en-US')} $SHUNT or more (send it to 0x000000000000000000000000000000000000dEaD), then send:\n/boost <code>0xTOKEN</code> <code>0xTRANSACTION</code>\n\nThe token gets a full scan (contract, launch, dev wallet, Dev Score, website) said in the Shuntdesk group and every group with alarms on. One burn, one boost.`);
    const from = msg.from?.username ? '@' + msg.from.username : String(msg.from?.first_name || 'a holder').slice(0, 24);
    const r = await boostToken(st, env, tk.toLowerCase(), tx.toLowerCase(), from);
    return reply(r.ok ? r.text : tgEsc(r.why));
  }  if (cmd === 'proof') {
    const [dl, x] = await Promise.all([devLedger(env, SHUNT).catch(() => null), xray(st, env, SHUNT).catch(() => null)]);
    const D = dl?.ok ? dl.ledger : null, n = v => v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : Math.round(v).toLocaleString('en-US');
    return reply(`<b>Proof · $SHUNT</b>\n<code>${SHUNT}</code>\n\n${D ? `Dev wallet bought ${n(D.bought + D.received)}, sold <b>${n(D.sold)}</b>, sent to other wallets ${n(D.toWallets)}, burned <b>${n(D.burned)}</b>, holds ${n(dl.holdsNow ?? 0)} now.\n${dl.burns.count} burns, ${(dl.burns.total / 1e7).toFixed(2)}% of supply in the dead address.\n` : ''}${x?.ok ? `Contract: ${x.functions} functions, ${x.powers.filter(p => p.level === 'high').length ? 'with a power: ' + x.powers.filter(p => p.level === 'high').map(p => p.what).join(', ') : 'no function that mints, pauses, blocks wallets or changes the tax'}${x.proxy ? ', behind a proxy' : ', not a proxy'}.\n` : ''}\nOpen source: github.com/shuntdesk/shuntdesk\nEvery call on record: huggingface.co/datasets/shuntdesk/verdicts\n\n${site}/proof/<i>\nRead from the chain right now. Not advice.</i>`);
  }
  if (cmd === 'report') {
    if (!found) return reply('Send /report followed by a token address: /report <code>0x…</code>');
    const a = found[0].toLowerCase(), from = { id: String(msg.from?.id || chat), name: msg.from?.username ? '@' + msg.from.username : String(msg.from?.first_name || 'someone').slice(0, 24) };
    const r = await reportToken(st, env, a, from);
    return reply(`<b>Report</b> · ${tgEsc(r.sym ? '$' + r.sym : a.slice(0, 8))}\n<code>${a}</code>\n\n${r.fl.length ? `Found:\n${r.fl.slice(0, 8).map(f => '• ' + tgEsc(f)).join('\n')}` : 'Nothing found by the contract scan, the security read, the launch holdings or the dev ledger.'}\n\n${r.first ? `First report of this token: ${tgEsc(from.name)}. It is priced again in 24 hours for the spotters board (/spotters).` : 'Already reported by someone else.'}\n\n${site}/ticket/?a=${a}<i>\nFindings from the chain, not a verdict on anyone. Not advice.</i>`);
  }
  if (cmd === 'spotters') {
    const s = spotters(st).filter(x => x.judged);
    return reply(s.length ? `<b>Top spotters</b> · reports that lost half within a day\n\n${s.slice(0, 10).map((x, i) => `${i + 1}. ${tgEsc(x.name)} · ${x.lostHalf} of ${x.judged}`).join('\n')}\n\nSend /report <code>0x…</code> to add one.` : 'No report has been priced a day later yet. Send /report <code>0x…</code> to start.');
  }
  if (cmd === 'devscore' || cmd === 'score') {
    if (!found) return reply(`Send /${cmd} followed by a launcher wallet or a token: /${cmd} <code>0x…</code>`);
    let w = found[0].toLowerCase(); const code = await rpc('eth_getCode', [w, 'latest']).catch(() => '0x');
    if (code && code !== '0x' && !isDelegated(code)) { const sh = await handWallet(env, w, true).catch(() => null); w = String(sh?.ponsBy || sh?.creator || '').toLowerCase(); if (!isAddr(w)) return reply('Could not find who launched that token.'); }
    const v = await devScore(st, env, w).catch(() => null);
    if (!v?.ok) return reply(tgEsc(v?.why || 'The chain index did not answer. Try again in a minute.'));
    if (!v.launched) return reply(`<code>${w}</code> has no Pons launch on record.`);
    return reply(`<b>Dev Score</b> · <code>${w.slice(0, 6)}…${w.slice(-4)}</code>\n\n${v.launched} Pons launch${v.launched > 1 ? 'es' : ''}${v.read < v.launched ? `, the newest ${v.read} read` : ''}\nDumped (sold or sent away half or more): <b>${v.dumped} of ${v.held}</b>${v.dumpedFirstHour ? `, ${v.dumpedFirstHour} within the first hour` : ''}\nBurned most of it: ${v.burnedMost}\nBonded: ${v.bonded}\n${v.score != null ? `Score: <b>${v.score}</b> of 100, the share of launches not dumped\n` : ''}\n${site}/dev/?w=${w}<i>\nFrom the Pons factory log and the chain index. Not advice.</i>`);
  }
  if (cmd === 'alarms') {
    if (!group) return reply('Add @shuntdesk_bot to your group, then an admin sends /alarms on there. The group gets launch alarms and clean reads for new Pons tokens.');
    const isAdmin = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getChatMember?chat_id=${chat}&user_id=${msg.from?.id}`).then(r => r.json()).then(j => ['creator', 'administrator'].includes(j.result?.status)).catch(() => false);
    if (!isAdmin) return reply('Only a group admin can switch the alarms.');
    const G = st.groups = st.groups || {}, on = !/\boff\b/i.test(clean);
    if (on && !G[chat] && Object.keys(G).length >= 60) return reply('Alarms are full right now. Try again later.');
    G[chat] = { title: String(msg.chat.title || '').slice(0, 60), on, t: Date.now() };
    return reply(on ? 'Launch alarms on for this group: new Pons tokens with a flag, and the ones that read clean. Up to about twenty a day. /alarms off to stop.' : 'Launch alarms off for this group.');
  }
  if (cmd === 'bondgame' || cmd === 'game') {
    const G = await bondGame(st, env).catch(() => null), B = await bondsLoad(env), v = G ? bondGameView(st, null, B) : null;
    if (!v?.ok || !v.tokens.length) return reply('Today\'s curves are not set yet. Try again in a few minutes.');
    return reply(`<b>Will it bond?</b> · ${v.day}\n\n${v.tokens.map((x, i) => `${i + 1}. ${tgEsc(x.symbol)} · ${x.progress ?? x.startProgress}%`).join('\n')}\n\n${v.open ? `Calls close at 12:00 UTC. ${v.players} in so far.` : 'Calls are closed for today; the chain answers at midnight UTC.'}${v.yesterday ? `\nYesterday: ${v.yesterday.tokens.filter(x => x.bonded).length} of ${v.yesterday.tokens.length} bonded.` : ''}\n\nPlay: ${site}/bond-game/`);
  }  if (cmd === 'ledger' || cmd === 'dev') {
    if (!found) return reply(`Send /${cmd} followed by a token address: /${cmd} <code>0x…</code>`);
    const a = found[0].toLowerCase(), v = await devLedger(env, a).catch(() => null);
    if (!v?.ok) return reply(tgEsc(v?.why || 'The chain index did not answer. Try again in a minute.'));
    const L = v.ledger, got = L.bought + L.received, n = x => x >= 1e6 ? (x / 1e6).toFixed(2) + 'M' : Math.round(x).toLocaleString('en-US'), pc = x => got > 0 ? ` (${Math.round(x / got * 100)}%)` : '';
    return reply(`<b>Dev Ledger</b> · <code>${a.slice(0, 6)}…${a.slice(-4)}</code>\nLauncher <code>${v.dev.slice(0, 6)}…${v.dev.slice(-4)}</code>, from the ${tgEsc(v.devFound)}\n\n${L.received ? 'Bought or received' : 'Bought on the curve'}: <b>${n(got)}</b>\nSold into the curve: <b>${n(L.sold)}</b>${pc(L.sold)}\nInto other contracts: ${n(L.toContracts)}${pc(L.toContracts)}\nSent to other wallets: ${n(L.toWallets)}${pc(L.toWallets)}\nBurned: ${n(L.burned)}${pc(L.burned)}\nHolds now: <b>${v.holdsNow == null ? '?' : n(v.holdsNow)}</b>\n\n${v.burns.count ? `${v.burns.count} burns of it in all, ${v.burns.byDev} by the launcher.\n\n` : ''}${site}/ticket/?a=${a}<i>\nEvery transfer in and out of the launcher, from the chain index. "Into other contracts" can be a sale through a router or a deposit. Not advice.</i>`);
  }  if (cmd === 'desk') {
    const [, d] = await agentData(st, env, 'desk', ''), last = d.closed[0];
    return reply(`<b>Crew desk</b> · paper USDG\n\nEquity <b>${money(d.equity)}</b> (${d.equity >= d.start ? '+' : ''}${money(d.equity - d.start)} since ${money(d.start)})\nOpen positions: ${d.open.length}\n${last ? `Last closed: ${tgEsc(last.symbol)} ${last.side} <b>${last.pnl >= 0 ? '+' : ''}${last.pnl}</b> (${tgEsc(last.why)})` : 'No trade closed yet.'}${last?.postMortem ? `\n\n<i>${tgEsc(last.postMortem)}</i>` : ''}\n\n${site}/desk/`);
  }
  if (cmd === 'report') {
    const [, r] = await agentData(st, env, 'report', '');
    return reply(`<b>Daily report</b>\n\nCrew desk ${money(r.equity)} (${r.change >= 0 ? '+' : ''}${money(r.change)} in 24h)\nVerdicts ${r.verdicts.CLEAN} clean · ${r.verdicts.RISKY} risky · ${r.verdicts.DANGER} danger\nHeld an hour later: ${r.judged ? `${r.held} of ${r.judged}` : 'none checked yet'}${r.note?.text ? `\n\n${tgEsc(r.note.text)}` : ''}\n\n${site}/report/`);
  }
  if (cmd === 'daily' || cmd === 'yard') {
    const d = dailyView(st), w = yardView(st);
    const top = (rows, f) => rows.slice(0, 5).map((r, i) => `${i + 1}. ${tgEsc(r.handle)} · ${f(r)}`).join('\n') || 'Nobody yet.';
    return reply(`<b>The Yard · daily #${d.no}</b>\nFive trains, the same for everyone today. ${d.players} played.\n\n${top(d.rows, r => `${r.right}/${r.read} right, ${r.pts} pts`)}\n\n<b>This week</b>\n${top(w.rows, r => `${r.pts} pts`)}\n\nPlay: ${site}/play/`);
  }
  if (cmd === 'new' || cmd === 'graduated') {
    const rows = (st.grads?.rows || []).slice(0, 6);
    return reply(rows.length ? `<b>Fresh off Pons</b>\n\n${rows.map(r => `• <code>${r.token}</code> · ${(m => m < 60 ? Math.max(1, Math.round(m)) + ' min' : (m / 60).toFixed(m < 600 ? 1 : 0) + ' h')((Date.now() - r.t) / 60000)} ago\n  ${site}/ticket/?a=${r.token}`).join('\n')}` : 'No graduation read in the last day yet.');
  }
  if (!found) return reply('Send /check followed by a token address: /check <code>0x…</code>');
  const a = found[0].toLowerCase(), [code, x] = await agentData(st, env, 'token', a);
  if (code !== 200) return reply('Could not read that token right now. Try again in a minute.');
  const v = x.verdict, L = x.launch?.ok && x.launch.launchpad ? x.launch : null, s = x.serverCheck;
  const move = (p, q) => p && q ? `${q >= p ? '+' : ''}${((q / p - 1) * 100).toFixed(1)}%` : '—';
  const lines = [`<b>${tgEsc(x.symbol || a.slice(0, 8))}</b>${x.name ? ' · ' + tgEsc(x.name) : ''}`, `<code>${a}</code>`, ''];
  if (v) lines.push(`Verdict <b>${v.verdict} ${v.score}</b> · ${v.desk === 'depot' ? 'depot, no trade' : v.desk + ' desk'}`, `Filed ${new Date(v.at).toISOString().slice(0, 16).replace('T', ' ')} UTC · price after 1h ${move(v.priceAtVerdict, v.after1h)} · after 24h ${move(v.priceAtVerdict, v.after24h)}`);
  else lines.push('No verdict on file yet: nobody has run the seven checks on it.');
  if (s) lines.push('', s.redFlags.length ? `Security read: <b>${s.redFlags.length} red flag${s.redFlags.length > 1 ? 's' : ''}</b>: ${tgEsc(s.redFlags.slice(0, 3).join(', '))}` : 'Security read: no red flag found by GoPlus.', s.holders ? `Holders: ${Number(s.holders).toLocaleString('en-US')}` : '');
  if (L) lines.push('', `Launch: ${L.launchpad === 'pons' ? 'Pons' : tgEsc(L.launchpad)}${L.graduated ? ', graduated' : L.progress != null ? `, ${Math.round(L.progress)}% to graduation` : ''}`, `Snipers ${pct(L.sniperPct)} · bundles ${pct(L.bundlerPct)} · insiders ${pct(L.insiderPct)} · developer ${pct(L.devPct)}`);
  const dl = await devLedger(env, a).catch(() => null);
  if (dl?.ok) { const D = dl.ledger, got = D.bought + D.received, pc = x => got > 0 ? Math.round(x / got * 100) + '%' : '0'; lines.push('', got > 0 ? `Dev: sold ${pc(D.sold)} into the curve, sent ${pc(D.toWallets)} to other wallets, ${pc(D.toContracts)} into contracts, burned ${pc(D.burned)}. /ledger for more` : 'Dev: never held any of it.'); }
  if (x.crewPosition) lines.push('', `Crew desk holds a <b>${x.crewPosition.side}</b> at ${x.crewPosition.leverage}x.`);
  lines.push('', `Full seven checks: ${x.fullCheck}`);
  return reply(lines.filter((l, i, arr) => !(l === '' && arr[i - 1] === '')).join('\n') + footer);
}

// the agent interface's reads, shared by /api/v1/* and the MCP tools
async function agentData(st, env, p, a) {
  if (p === 'token') { if (!isAddr(a)) return [400, { error: 'pass ?a=0x… a token address on Robinhood Chain' }]; const r = await agentToken(st, env, a); await save(env, st); return [200, r]; }
  if (p === 'verdicts') return [200, { verdicts: st.verdicts.slice(0, 50).map(v => ({ token: v.addr, symbol: v.sym, verdict: v.verdict, score: v.score, desk: v.platform, at: new Date(v.t).toISOString(), priceAtVerdict: v.p0, after1h: v.p1h || null, after24h: v.p24h || null })), record: record(st).after1h }];
  if (p === 'desk') return [200, { paper: true, start: START, equity: Math.round(equity(st) * 100) / 100, cash: Math.round(st.cash * 100) / 100, open: st.pos.map(x => ({ token: x.addr, symbol: x.sym, side: x.side, leverage: x.lev, entry: x.entry, mark: x.mark || x.entry, net: Math.round(worth(x).net * 100) / 100 })), closed: st.hist.slice(0, 20).map(h => ({ token: h.addr, symbol: h.sym, side: h.side, leverage: h.lev, entry: h.entry, exit: h.exit, pnl: Math.round(h.pnl * 100) / 100, why: h.why, postMortem: h.note?.text || null, at: new Date(h.t).toISOString() })) }];
  if (p === 'graduated') return [200, { launchpad: 'pons', tokens: (st.grads?.rows || []).map(r => ({ token: r.token, at: new Date(r.t).toISOString() })) }];
  if (p === 'report') { const r = report(st); r.note = await reportNote(st, env, r); return [200, r]; }
  if (p === 'lookalikes') { if (!isAddr(a)) return [400, { error: 'pass ?a=0x… a token address on Robinhood Chain' }]; return [200, await lookalikes(env, a)]; }
  if (p === 'stocks') return [200, await stockRefs()];
  if (p === 'bonds') return [200, await bondView(env)];
  if (p === 'site') { if (!isAddr(a)) return [400, { error: 'pass ?a=0x… a token address' }]; return [200, await siteCheck(st, env, a)]; }
  if (p === 'radar') return [200, await radarView(env)];
  if (p === 'lab') return [200, await labData(env)];
  if (p === 'wallet') { if (!isAddr(a)) return [400, { error: 'pass ?a=0x… a wallet address' }]; return [200, await walletView(st, env, a)]; }
  if (p === 'devledger' || p === 'ledger') { if (!isAddr(a)) return [400, { error: 'pass ?a=0x… a token address on Robinhood Chain' }]; return [200, await devLedger(env, a)]; }
  if (p === 'xray' || p === 'scan') { if (!isAddr(a)) return [400, { error: 'pass ?a=0x… a token address on Robinhood Chain' }]; return [200, await xray(st, env, a)]; }
  return [404, { error: 'unknown endpoint', see: 'https://shuntdesk.com/llms.txt' }];
}

// ---------- the open record on Hugging Face (huggingface.co/datasets/shuntdesk/verdicts) ----------
// Once a day, the calls made the day before last, each with its price an hour and a day later, go up as one JSONL
// file per day (a call needs a full day before its 24-hour price exists). One commit, through the Hub's commit API.
const HF_REPO = 'shuntdesk/verdicts';
const b64 = s => { const bytes = new TextEncoder().encode(s); let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(bin); };
// Yesterday also goes up once a day as a first version (some 24-hour prices still to come); the next day's run
// writes the same file again with them, so a file is final two days after its date.
async function hfPublish(st, env, force = false) {
  const now = Date.now(), DAY = 24 * HOUR, final = new Date(now - 2 * DAY).toISOString().slice(0, 10), first = new Date(now - DAY).toISOString().slice(0, 10);
  const today = new Date(now).toISOString().slice(0, 10);
  const a = force || st.hf?.day !== final ? await hfDay(st, env, final, 'day') : null;
  const b = force || st.hf?.first !== first ? await hfDay(st, env, first, 'first') : null;
  // today so far, every three hours, so the record is never a day behind
  const c = force || now - (st.hf?.todayT || 0) > 3 * HOUR ? await hfDay(st, env, today, 'today') : null;
  return { final: a, first: b, today: c };
}
async function hfDay(st, env, day, label) {
  const early = label !== 'day';
  if (!env.HF_TOKEN) return { ok: false, why: 'no token' };
  const now = Date.now(), DAY = 24 * HOUR;
  const from = Date.parse(day + 'T00:00:00Z'), to = from + DAY;
  const rows = st.verdicts.filter(v => v.t >= from && v.t < to).sort((a, b) => a.t - b.t).map(v => ({
    time: new Date(v.t).toISOString(), token: v.addr, symbol: v.sym, verdict: v.verdict, score: v.score, claimed: v.claimed || v.verdict, desk: v.platform, zone: v.zone,
    stops: v.tags || [], liquidity_usd: v.liq, price: v.p0, price_1h: v.p1h || null, price_24h: v.p24h || null,
    held_1h: v.p1h && v.verdict !== 'RISKY' ? (v.verdict === 'CLEAN' ? v.p1h > v.p0 : v.p1h < v.p0) : null,
    held_24h: v.p24h && v.verdict !== 'RISKY' ? (v.verdict === 'CLEAN' ? v.p24h > v.p0 : v.p24h < v.p0) : null }));
  const trades = st.hist.filter(h => h.t >= from && h.t < to).map(h => ({ closed: new Date(h.t).toISOString(), opened: new Date(h.opened || h.t).toISOString(), token: h.addr, symbol: h.sym, side: h.side, leverage: h.lev, entry: h.entry, exit: h.exit, pnl_usdg: Math.round(h.pnl * 100) / 100, fees_usdg: Math.round(h.fees * 100) / 100, closed_because: h.why, post_mortem: h.note?.text || null }));
  const files = [[`data/verdicts/${day}.jsonl`, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '')]];
  if (trades.length) files.push([`data/trades/${day}.jsonl`, trades.map(r => JSON.stringify(r)).join('\n') + '\n']);
  const body = [JSON.stringify({ key: 'header', value: { summary: `Calls of ${day}${label === 'today' ? ' (so far today)' : early ? ' (first version, some 24h prices still to come)' : ''}: ${rows.length} verdicts, ${trades.length} crew trades closed` } }),
    ...files.map(([path, text]) => JSON.stringify({ key: 'file', value: { path, encoding: 'base64', content: b64(text) } }))].join('\n');
  const r = await fetch(`https://huggingface.co/api/datasets/${HF_REPO}/commit/main`, { method: 'POST', headers: { Authorization: 'Bearer ' + env.HF_TOKEN, 'Content-Type': 'application/x-ndjson' }, body });
  const out = { ok: r.ok, day, verdicts: rows.length, trades: trades.length, status: r.status };
  if (r.ok) st.hf = { ...(st.hf || {}), ...(label === 'today' ? { todayT: now } : { [label]: day }), t: now }; else out.why = (await r.text()).slice(0, 160);
  return out;
}

// ---------- Shuntdesk for agents: read-only JSON for other programs (documented in /llms.txt) ----------
async function agentToken(st, env, addr) {
  const v = st.verdicts.find(x => x.addr === addr), pos = st.pos.find(p => p.addr === addr);
  let gp = null; try { gp = await goplus(env, addr); } catch (e) {}
  const sr = gp ? serverRead(gp) : null;
  return {
    token: addr, symbol: gp?.token_symbol || v?.sym || null, name: gp?.token_name || null, chain: 'robinhood', chainId: 4663,
    verdict: v ? { verdict: v.verdict, score: v.score, desk: v.platform, zone: v.zone, at: new Date(v.t).toISOString(), stops: v.tags || [], priceAtVerdict: v.p0, after1h: v.p1h || null, after24h: v.p24h || null } : null,
    serverCheck: sr ? { redFlags: sr.red, holders: sr.holders, source: 'GoPlus' } : null,
    launch: await launch(env, addr).catch(() => null),
    crewPosition: pos ? { side: pos.side, leverage: pos.lev, entry: pos.entry, mark: pos.mark || pos.entry, opened: new Date(pos.t).toISOString() } : null,
    fullCheck: `https://shuntdesk.com/ticket/?a=${addr}`,
    note: v ? 'The verdict was filed when someone ran the seven checks on shuntdesk.com; the server re-checked it before the crew traded. It can be wrong. Not advice.' : 'No verdict on file. Open fullCheck to run the seven checks; the verdict is filed for everyone once it runs. Not advice.'
  };
}

// Candles from Codex, for pools too young for the free feed. The key stays here; answers are shared
// between visitors for a minute, and a daily ceiling keeps the free allowance (10,000 a month) intact.
// ---------- Codex: one daily allowance for every feature ----------
// The free plan is 10,000 calls a month, about 330 a day. Each feature has its own share of a 320-call day, so a
// busy page can never use up what the Lookalikes log and the alerts need. The counts live in the desk's state,
// so a restart of the server does not hand the day out a second time.
const CODEX_SHARE = { looks: 70, launch: 130, candles: 40, replay: 30, push: 40 };   // launch facts feed every ticket, so they get the largest share
async function codexOk(env, kind) {
  if (!env.CODEX_API_KEY) return false;
  const st = await load(env), day = new Date().toISOString().slice(0, 10);
  if (st.codex?.day !== day) st.codex = { day, n: {} };
  const n = st.codex.n[kind] || 0; if (n >= CODEX_SHARE[kind]) return false;
  st.codex.n[kind] = n + 1; return true;
}
const bars = new Map();
async function candles(env, addr) {
  const hit = bars.get(addr), now = Date.now();
  if (hit && now - hit.t < 60000) return hit.v;
  if (!env.CODEX_API_KEY) return { rows: [], res: 1 };
  const ask = async (res, secs) => {
    if (!(await codexOk(env, 'candles'))) return [];
    const to = Math.floor(now / 1000), q = `{ getBars(symbol: "${addr}:4663", from: ${to - secs}, to: ${to}, resolution: "${res}", removeLeadingNullValues: true) { t o h l c } }`;
    const r = await fetch('https://graph.codex.io/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: env.CODEX_API_KEY }, body: JSON.stringify({ query: q }) });
    const b = (await r.json()).data?.getBars; if (!b) return [];
    return b.t.map((t, i) => ({ t: t * 1000, o: b.o[i], h: b.h[i], l: b.l[i], c: b.c[i] })).filter(x => x.c != null && x.o != null);
  };
  let res = 5, rows = [];
  try { rows = await ask(5, 36000); if (rows.length < 24) { const one = await ask(1, 7200); if (one.length > rows.length) { rows = one; res = 1; } } } catch (e) {}
  const v = { rows: rows.slice(-120), res };
  bars.set(addr, { t: now, v }); if (bars.size > 300) bars.delete(bars.keys().next().value);
  return v;
}

// New and trending pools, read once on the server with the CoinGecko key and shared by every visitor for a
// minute. The keyless feed allows each visitor only about ten calls a minute, which a busy page runs through.
const lists = new Map();
async function pools(env, kind) {
  // the free CoinGecko plan is 10,000 calls a month, about 330 a day: 6 minutes for new pools and 20 for trending
  // comes to at most 312 calls a day however many people are on the site
  const hit = lists.get(kind), now = Date.now();
  if (hit && now - hit.t < (kind === 'new' ? 360000 : 1200000)) return hit.v;
  let v = { rows: [], source: 'CoinGecko' };
  try {
    const r = await fetch(`https://api.coingecko.com/api/v3/onchain/networks/robinhood/${kind === 'new' ? 'new_pools' : 'trending_pools'}?page=1&include=base_token`, { headers: { Accept: 'application/json', ...(env.COINGECKO_API_KEY ? { 'x-cg-demo-api-key': env.COINGECKO_API_KEY } : {}) } });
    const j = await r.json();
    v.rows = (j.data || []).map(d => {
      const a = d.attributes, id = d.relationships?.base_token?.data?.id || '', tok = (j.included || []).find(i => i.id === id), tx = a.transactions?.h24 || {};
      return { pool: a.address, addr: id.split('_')[1] || '', sym: tok?.attributes?.symbol || a.name.split(' / ')[0], name: tok?.attributes?.name || '', created: Date.parse(a.pool_created_at), liq: Number(a.reserve_in_usd) || 0, fdv: Number(a.fdv_usd) || 0,
        price: Number(a.base_token_price_usd) || 0, tx24: (tx.buys || 0) + (tx.sells || 0), buyers: tx.buyers || 0, sellers: tx.sellers || 0, chg: Number(a.price_change_percentage?.h24) || 0, vol24: Number(a.volume_usd?.h24) || 0 };
    }).filter(x => x.addr);
  } catch (e) {}
  if (v.rows.length) lists.set(kind, { t: now, v }); else if (hit) return hit.v;   // a failed refresh keeps the last good list
  return v;
}

// ---------- Pons: the launchpad most new tokens here come from ----------
// Its V2 factory logs every launch (token, curve, creator) and every graduation (token).
const PONS = '0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e';
const T_LAUNCH = '0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607';
const T_GRAD = '0x0a44ef75df69c534f43cd6c1aa3ef8983065fe5fe79ef9e79f6494e6f258c259';
const hex = n => '0x' + n.toString(16), wordAddr = w => '0x' + String(w).slice(-40).toLowerCase();
// every five minutes, read the graduations since the last read; the first read goes back about a day
async function gradScan(st, env) {
  const g = st.grads = st.grads || { block: 0, rows: [], t: 0 }, now = Date.now();
  if (now - g.t < 5 * 60000) return; g.t = now;
  const head = parseInt(await rpc('eth_blockNumber'), 16), from = g.block ? g.block + 1 : head - 860000;   // about 10 blocks a second
  if (from > head) return;
  const to = Math.min(head, from + 900000);
  // the public node is the only one that serves logs over a wide range (the keyed one allows a few hundred blocks),
  // and from shared Cloudflare addresses it sometimes refuses: ask it directly, a few times, with a pause
  let logs = null, why = '';
  for (let k = 0; k < 3 && !logs; k++) {
    try {
      const r = await fetch(RPCS[0], { method: 'POST', headers: { 'Content-Type': 'application/json', ...UA }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getLogs', params: [{ address: PONS, topics: [T_GRAD], fromBlock: hex(from), toBlock: hex(to) }] }) });
      const j = await r.json().catch(() => null); if (j && Array.isArray(j.result)) logs = j.result; else why = 'node said ' + r.status + (j?.error?.message ? ': ' + j.error.message.slice(0, 80) : '');
    } catch (e) { why = String(e.message || e).slice(0, 80); }
    if (!logs) await new Promise(r => setTimeout(r, 1500));
  }
  // the public node refuses shared Cloudflare addresses at times: the keyed Blockscout index has the same log
  if (!logs && env?.BLOCKSCOUT_API_KEY) try {
    const r = await fetch(`https://api.blockscout.com/4663/api?module=logs&action=getLogs&address=${PONS}&topic0=${T_GRAD}&fromBlock=${from}&toBlock=${to}&apikey=${env.BLOCKSCOUT_API_KEY}`, { headers: UA });
    const j = await r.json(); if (Array.isArray(j.result)) logs = j.result; else if (j.message === 'No records found') logs = []; else why += ' · blockscout: ' + String(j.message || r.status).slice(0, 60);
  } catch (e) { why += ' · blockscout: ' + String(e.message || e).slice(0, 60); }
  if (!logs) { g.err = why; return; }
  g.err = null;
  for (const l of logs.slice(-30)) {
    const token = wordAddr(l.topics[1]); if (g.rows.some(r => r.token === token)) continue;   // the graduation names the token itself
    let t = l.timeStamp ? parseInt(l.timeStamp, 16) * 1000 : 0; if (!t) try { t = parseInt((await rpc('eth_getBlockByNumber', [l.blockNumber, false])).timestamp, 16) * 1000; } catch (e) {}
    if (isAddr(token)) { g.rows.push({ token, block: parseInt(l.blockNumber, 16), t: t || now }); if (now - (t || now) < 30 * 60000) { (st.handQ = st.handQ || []).push(token); (st.xrayQ = st.xrayQ || []).push(token); } }   // fresh ones go to Same Hand and Agent Scan
  }
  g.block = to; g.rows = g.rows.sort((a, b) => b.block - a.block).slice(0, 40);
}

// Launch facts from Codex for launchpad tokens: snipers, bundles, insiders, the developer's share, curve progress.
// Shared by every visitor for ten minutes, with its own daily ceiling inside the same free allowance.
const launches = new Map();
// Curve progress is read from the Pons curve itself, never from Codex: Codex's graduationPercent counts something
// else (it showed 75% for a curve holding 1.95 of the 4.2 ETH it needs, which Pons shows as 46%). Pons counts
// realQuoteReserve against graduationThreshold, and so does this. Kept a minute.
const curves = new Map();
export async function ponsCurve(addr) {
  const hit = curves.get(addr), now = Date.now();
  if (hit && now - hit.t < 60000) return hit.v;
  let v = null;
  try {
    const c = await rpc('eth_call', [{ to: addr, data: '0x' + SEL.curve }, 'latest']);
    const curve = c && c.length >= 66 ? '0x' + c.slice(-40) : null;
    if (curve && !/^0x0{40}$/.test(curve)) {
      const [q, th, g, qr, tr, fb, ct, nat] = await multicall([[curve, SEL.real], [curve, SEL.thr], [curve, SEL.grad], [curve, SEL.qres], [curve, SEL.tres], [curve, SEL.fee], [curve, SEL.ctax], [curve, SEL.nat]]);
      if (q && th && BigInt(th) > 0n) {
        const graduated = !!g && BigInt(g) === 1n, f18 = x => Number(BigInt(x) / 10n ** 12n) / 1e6;
        v = { curve, graduated, progress: graduated ? 100 : Math.min(100, Number(BigInt(q) * 1000000n / BigInt(th)) / 10000), raised: f18(q), need: f18(th) };
        // the curve as a pool, for Exit Door: a constant product over its virtual reserves (the quote reserve counts
        // a phantom amount on top of what was raised), with the fee and the creator's tax taken off every trade.
        // Checked against the curve's own buy and sell answers. Only for curves quoted in native ETH.
        if (!graduated && qr && tr && fb && nat && BigInt(nat) === 1n) {
          const eth = await ethUsd().catch(() => 0);
          if (eth > 0) v.pool = { quoteUsd: f18(qr) * eth, tokens: f18(tr), realUsd: f18(q) * eth, fee: (Number(BigInt(fb)) + (ct ? Number(BigInt(ct)) : 0)) / 10000 };
        }
      }
    }
  } catch (e) {}
  curves.set(addr, { t: now, v }); if (curves.size > 400) curves.delete(curves.keys().next().value);
  return v;
}
async function launch(env, addr) {
  const v = await launchCodex(env, addr);
  if (v.ok && v.launchpad !== 'pons') return v;   // Codex knows it is not a Pons launch
  const c = await ponsCurve(addr);   // and when Codex is out for the day, the chain still answers for the curve
  if (!v.ok) return c ? { ok: true, launchpad: 'pons', progress: c.progress, graduated: c.graduated, raised: c.raised, need: c.need, curve: c.curve, pool: c.pool || null } : v;
  if (!c) return v.launchpad === 'pons' ? { ...v, progress: null } : v;   // a Pons token whose curve could not be read shows no figure rather than Codex's
  return { ...v, ok: true, launchpad: 'pons', progress: c.progress, graduated: c.graduated, raised: c.raised, need: c.need, curve: c.curve, pool: c.pool || null };
}
async function launchCodex(env, addr) {
  const hit = launches.get(addr), now = Date.now();
  if (hit && now - hit.t < 30 * 60000) return hit.v;
  if (!(await codexOk(env, 'launch'))) return hit ? hit.v : { ok: false, why: 'not available right now' };
  let v = { ok: false, why: 'no answer' };
  try {
    const q = `{ filterTokens(tokens: ["${addr}:4663"], limit: 1) { results { priceUSD liquidity holders top10HoldersPercent createdAt sniperCount sniperHeldPercentage bundlerCount bundlerHeldPercentage insiderCount insiderHeldPercentage devHeldPercentage token { symbol launchpad { launchpadName graduationPercent completed completedAt } } } } }`;
    const r = await fetch('https://graph.codex.io/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: env.CODEX_API_KEY }, body: JSON.stringify({ query: q }) });
    const x = (await r.json()).data?.filterTokens?.results?.[0];
    if (x) { const lp = x.token?.launchpad; v = { ok: true, launchpad: lp?.launchpadName || null, progress: lp?.graduationPercent ?? null, graduated: lp ? !!lp.completed : null,
      snipers: x.sniperCount, sniperPct: x.sniperHeldPercentage, bundlers: x.bundlerCount, bundlerPct: x.bundlerHeldPercentage, insiders: x.insiderCount, insiderPct: x.insiderHeldPercentage, devPct: x.devHeldPercentage,
      symbol: x.token?.symbol || null, price: Number(x.priceUSD) || 0, liquidity: Number(x.liquidity) || 0, holders: x.holders ?? null, top10Pct: x.top10HoldersPercent ?? null, created: x.createdAt ? x.createdAt * 1000 : null }; }
    else v = { ok: true, launchpad: null };
  } catch (e) {}
  launches.set(addr, { t: now, v }); if (launches.size > 400) launches.delete(launches.keys().next().value);
  return v;
}

// ---------- Lookalikes: how tokens that looked like this one turned out ----------
// Every hour the server reads from Codex every token on the chain that turned 30 to 90 minutes old in that
// window with 25 holders or more, and keeps how it looked then: liquidity, holders, the ten largest wallets'
// share, snipers, bundles, insiders, the developer's share, the launchpad. An hour and a day later it reads the
// same tokens again. A token asked about is set against that log: the closest ones, and what happened to them.
// The log lives under its own key, apart from the desk, and keeps the newest 6,000 tokens.
const LOOKS = 'looks-v1', LOOK_MAX = 6000, CODEX = 'https://graph.codex.io/graphql';
const LOOK_FIELDS = 'priceUSD liquidity holders top10HoldersPercent sniperHeldPercentage bundlerHeldPercentage insiderHeldPercentage devHeldPercentage createdAt token { address symbol launchpad { launchpadName completed } }';
let looksMem = null;
const looksLoad = async env => looksMem || (looksMem = await env.KV.get(LOOKS).then(s => s ? JSON.parse(s) : { rows: [], cur: 0, t: 0, day: '', n: 0 }));
async function codexAsk(env, L, q) {
  if (!(await codexOk(env, 'looks'))) throw new Error('daily Codex share used up');
  const r = await fetch(CODEX, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: env.CODEX_API_KEY }, body: JSON.stringify({ query: q }) });
  const j = await r.json(); if (j.errors?.length) throw new Error(String(j.errors[0].message).slice(0, 100));
  return j.data?.filterTokens?.results || [];
}
const lookFeat = x => [Number(x.liquidity) || 0, x.holders | 0, Number(x.top10HoldersPercent) || 0, Number(x.sniperHeldPercentage) || 0, Number(x.bundlerHeldPercentage) || 0, Number(x.insiderHeldPercentage) || 0, Number(x.devHeldPercentage) || 0].map(v => Math.round(v * 100) / 100);
// Three reads an hour whatever the traffic: the tokens born in one window, read as they are now, then the same
// window an hour later and a day later. A window is one hour of launches; at most 200 come back per read.
async function looksTick(env) {
  if (!env.CODEX_API_KEY) return;
  const L = await looksLoad(env), now = Date.now(); if (now - L.t < 60 * 60000) return; L.t = now;
  const win = (lo, hi, holders) => codexAsk(env, L, `{ filterTokens(filters: { network: [4663], createdAt: { gt: ${lo}, lte: ${hi} }, holders: { gt: ${holders} } }, rankings: [{ attribute: holders, direction: DESC }], limit: 200) { results { ${LOOK_FIELDS} } } }`);
  try {
    // the newest window: from where the last read stopped to 30 minutes ago, at most three hours back (the very first
    // read takes all three, so the log starts with a few hours of launches). Tokens with 25 holders or more: below
    // that it is mostly test launches nobody bought.
    const hi = Math.floor(now / 1000) - 1800, lo = Math.max(L.cur || hi - 3 * 3600, hi - 3 * 3600);
    if (hi > lo) {
      const have = new Set(L.rows.map(r => r.a));
      for (const x of await win(lo, hi, 24)) {
        const a = String(x.token?.address || '').toLowerCase(), p0 = Number(x.priceUSD) || 0; if (!isAddr(a) || !p0 || have.has(a)) continue;
        L.rows.push({ a, s: word(x.token.symbol, 12), c: (x.createdAt || 0) * 1000, t: now, f: lookFeat(x), pad: word(x.token.launchpad?.launchpadName || '', 12), g: !!x.token.launchpad?.completed, p0, l0: Math.round(Number(x.liquidity) || 0) });
      }
      // follow-ups: the windows read an hour and a day ago, read again now. A token Codex no longer returns is
      // left without a result rather than counted as gone.
      for (const [k, back] of [['1', HOUR], ['24', 24 * HOUR]]) {
        const rows = L.rows.filter(r => r['p' + k] === undefined && now - r.t >= back - 10 * 60000 && now - r.t < back + 3 * HOUR); if (!rows.length) continue;
        const c0 = Math.min(...rows.map(r => r.c)) / 1000 - 1, c1 = Math.max(...rows.map(r => r.c)) / 1000;
        const m = new Map((await win(Math.floor(c0), Math.ceil(c1), 4)).map(x => [String(x.token?.address || '').toLowerCase(), x]));
        for (const r of rows) { const x = m.get(r.a); if (x) { r['p' + k] = Number(x.priceUSD) || 0; r['l' + k] = Math.round(Number(x.liquidity) || 0); } }
      }
      L.cur = hi;
    }
    L.rows = L.rows.filter(r => now - r.t < 60 * 24 * HOUR).slice(-LOOK_MAX); L.err = null;
  } catch (e) { L.err = String(e.message || e).slice(0, 120); }
  await env.KV.put(LOOKS, JSON.stringify(L));
}
// ---------- Radar: every logged token read in full, on its own ----------
// Each token the Lookalikes log takes in is also run through Agent Scan, the server's security read (GoPlus) and
// the launcher's trail (Same Hand), a few a minute, newest first. Nobody has to open a ticket. What it finds is kept
// beside the token's launch figures and its later price, so the rules that make a verdict can be tested against
// what really happened, and the board at /radar/ shows it as it comes in.
async function radarTick(st, env) {
  const L = await looksLoad(env), now = Date.now();
  if (now - (L.rt || 0) < 60000) return; L.rt = now;
  const todo = L.rows.filter(r => r.x === undefined && now - r.t < 6 * HOUR).sort((a, b) => b.t - a.t).slice(0, 3);
  if (!todo.length) return;
  const io = { rpc, wallet: (w, c) => handWallet(env, w, c), launches: async ws => (await handLaunches(env, ws)).launches || {}, pools: async () => ({}) };
  await Promise.all(todo.map(async r => {
    const [x, gp, h, sc] = await Promise.all([xray(st, env, r.a).catch(() => null), goplus(env, r.a).catch(() => null), sameHand(r.a, io).catch(() => null), siteCheck(st, env, r.a, [], { summary: false }).catch(() => null)]);
    r.sc = sc?.ok ? { f: sc.flags.filter(f => f.level !== 'low').map(f => f.text.slice(0, 80)), w: sc.website ? 1 : 0 } : null;
    r.x = x?.ok ? { h: [...new Set(x.powers.filter(p => p.level === 'high').map(p => p.kind))], m: [...new Set(x.powers.filter(p => p.level === 'medium').map(p => p.kind))], o: x.owner ? (x.owner.live ? 1 : 0) : x.roles ? 2 : -1, p: x.proxy ? 1 : 0, n: x.functions } : null;
    const sr = gp ? serverRead(gp) : null;
    r.g = gp ? { hp: gp.is_honeypot === '1' ? 1 : 0, st: gp.sell_tax !== undefined && gp.sell_tax !== '' ? Math.round(Number(gp.sell_tax) * 1000) / 10 : null, red: sr?.red.length || 0, os: gp.is_open_source === '1' ? 1 : gp.is_open_source === '0' ? 0 : null } : null;
    r.sh = h?.ok ? { n: h.launched, w: h.launchers } : null;
  }));
  await launchAlarm(st, env, L, todo).catch(() => 0);
  await env.KV.put(LOOKS, JSON.stringify(L));
}
async function radarView(env) {
  const L = await looksLoad(env), now = Date.now(), mv = (r, k) => r[k] !== undefined && r.p0 ? (r[k] ? r[k] / r.p0 - 1 : -1) : null;
  const flags = r => [...(r.x?.h || []).map(k => ({ mint: 'can mint', upgrade: 'code can be swapped', pause: 'can freeze transfers', block: 'can block wallets', tax: 'can change the tax' }[k] || k)), r.x?.p ? 'proxy' : null, r.g?.hp ? 'sell fails' : null, r.g?.st >= 10 ? `sell tax ${r.g.st}%` : null, r.sh?.n ? `launcher trail: ${r.sh.n} earlier launch${r.sh.n > 1 ? 'es' : ''}` : null, r.f[4] >= 10 ? `bundles ${r.f[4]}%` : null, r.f[3] >= 10 ? `snipers ${r.f[3]}%` : null, r.f[2] >= 50 ? `top 10 hold ${Math.round(r.f[2])}%` : null, ...(r.sc?.f || [])].filter(Boolean);
  const rows = L.rows.filter(r => r.x !== undefined).sort((a, b) => b.t - a.t).slice(0, 80).map(r => ({ token: r.a, symbol: r.s, read: new Date(r.t).toISOString(), launchpad: r.pad || null, liquidity: r.l0, holders: r.f[1], flags: flags(r), move1h: mv(r, 'p1'), move24h: mv(r, 'p24') }));
  const scanned = L.rows.filter(r => r.x !== undefined), withFlag = scanned.filter(r => flags(r).length), judged = s => s.filter(r => r.p1 !== undefined);
  const fell = s => judged(s).filter(r => mv(r, 'p1') <= -0.5).length;
  return { ok: true, logged: L.rows.length, scanned: scanned.length, flagged: withFlag.length,
    record: { flagged: { n: judged(withFlag).length, fellHalf1h: fell(withFlag) }, clean: { n: judged(scanned.filter(r => !flags(r).length)).length, fellHalf1h: fell(scanned.filter(r => !flags(r).length)) } },
    rows, note: 'Every new token on Robinhood Chain with 25 or more holders, read 30 to 90 minutes after launch and scanned on its own: Agent Scan, a GoPlus security read and the launcher trail. Flags are findings, not a verdict. Not advice.' };
}

// ---------- Verdict Lab: every rule set against what really happened ----------
// The Radar log holds each new token as it looked 30 to 90 minutes after launch, what the scans found, and its price
// an hour and a day later. For each rule, the tokens it would catch, and how many of them lost half their price,
// against every token in the log. A token with no price later (its pool gone) counts as lost. This is the record
// the next version of the verdict will be tuned on; the rules shown are candidates, not the verdict itself.
let labMem = { t: 0, v: null };
export function labRules() {
  const has = (r, k) => (r.x?.h || []).includes(k);
  return [
    ['mint', 'Agent Scan: can mint', r => r.x ? has(r, 'mint') : null],
    ['pause', 'Agent Scan: can freeze transfers', r => r.x ? has(r, 'pause') : null],
    ['block', 'Agent Scan: can block wallets', r => r.x ? has(r, 'block') : null],
    ['tax', 'Agent Scan: can change the tax', r => r.x ? has(r, 'tax') : null],
    ['proxy', 'Agent Scan: code can be swapped (proxy)', r => r.x ? !!r.x.p || has(r, 'upgrade') : null],
    ['owner', 'Agent Scan: a live owner', r => r.x ? r.x.o === 1 : null],
    ['honeypot', 'GoPlus: the sell test fails', r => r.g ? !!r.g.hp : null],
    ['selltax', 'GoPlus: sell tax 10% or more', r => r.g && r.g.st != null ? r.g.st >= 10 : null],
    ['red', 'GoPlus: any red flag', r => r.g ? r.g.red > 0 : null],
    ['site', 'Site Check: a flag on the website or links', r => r.sc ? r.sc.f.length > 0 : null],
    ['nosite', 'Site Check: no website at all', r => r.sc ? !r.sc.w : null],
    ['serial', 'Same Hand: the trail launched 5 or more tokens', r => r.sh ? r.sh.n >= 5 : null],
    ['top25', 'Ten largest wallets hold over 25%', r => r.f[2] > 25],
    ['top50', 'Ten largest wallets hold over 50%', r => r.f[2] > 50],
    ['few', 'Under 50 holders', r => r.f[1] < 50],
    ['snipers', 'Launch snipers hold over 5%', r => r.f[3] > 5],
    ['bundles', 'Bundles hold over 5%', r => r.f[4] > 5],
    ['insiders', 'Insiders hold over 5%', r => r.f[5] > 5],
    ['dev', 'The developer holds over 10%', r => r.f[6] > 10],
    ['thin', 'Liquidity under $2,000', r => r.f[0] < 2000],
    // not a warning: the split that explains others. A token still on its curve trades against the curve, a graduated one in a pool
    ['oncurve', 'Still on its Pons curve when logged (a split, not a warning)', r => /^pons/i.test(r.pad || '') && !r.g],
  ];
}
export function labView(rows) {
  const mv = (r, k) => r[k] !== undefined && r.p0 ? (r[k] ? r[k] / r.p0 - 1 : -1) : null;
  const stat = (set, k) => { const s = set.map(r => mv(r, k)).filter(v => v != null); if (!s.length) return { n: 0 }; const srt = [...s].sort((a, b) => a - b);
    return { n: s.length, lostHalf: s.filter(v => v <= -0.5).length, rate: s.filter(v => v <= -0.5).length / s.length, median: srt[Math.floor(srt.length / 2)] }; };
  const base = { h1: stat(rows, 'p1'), h24: stat(rows, 'p24') };
  const rules = labRules().map(([key, label, f]) => {
    const read = rows.filter(r => f(r) !== null), hit = read.filter(r => f(r)), miss = read.filter(r => !f(r));
    const a = { h1: stat(hit, 'p1'), h24: stat(hit, 'p24') }, b = { h1: stat(miss, 'p1'), h24: stat(miss, 'p24') };
    const lift = (x, y) => x.n >= 20 && y.n >= 20 && y.rate > 0 ? x.rate / y.rate : null;
    return { key, rule: label, read: read.length, caught: hit.length, caughtShare: read.length ? hit.length / read.length : 0, caughtThen: a, othersThen: b, lift1h: lift(a.h1, b.h1), lift24h: lift(a.h24, b.h24) };
  });
  return { base, rules };
}
async function labData(env) {
  const now = Date.now(); if (labMem.v && now - labMem.t < 10 * 60000) return labMem.v;
  const L = await looksLoad(env), rows = L.rows.filter(r => r.f && r.p0);
  const v = { ok: true, logged: rows.length, since: rows.length ? new Date(Math.min(...rows.map(r => r.t))).toISOString() : null, scanned: rows.filter(r => r.x !== undefined).length, ...labView(rows),
    note: 'Each new token on Robinhood Chain with 25 or more holders, as it looked 30 to 90 minutes after launch, and its price an hour and a day later. "Lost half" is a fall of 50% or more; a token with no price later counts as lost. Lift is how much more often the tokens a rule catches lost half than the ones it does not, shown once both sides have 20 or more. Past results, not a forecast. The verdict does not use these rules until a change is published.' };
  labMem = { t: now, v }; return v;
}

// distance between two tokens as they looked: liquidity and holders on a log scale, shares in points
const lg = v => Math.log10(Math.max(1, v));
function lookDist(a, ap, b, bp) {
  return Math.abs(lg(a[0]) - lg(b[0])) / 0.35 + Math.abs(lg(a[1] + 1) - lg(b[1] + 1)) / 0.3 + Math.abs(a[2] - b[2]) / 12
    + Math.abs(a[3] - b[3]) / 8 + Math.abs(a[4] - b[4]) / 8 + Math.abs(a[5] - b[5]) / 8 + Math.abs(a[6] - b[6]) / 8 + (ap !== bp ? 1.5 : 0);
}
const median = xs => { const s = [...xs].sort((a, b) => a - b), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
const lookCache = new Map();
async function lookalikes(env, addr) {
  const hit = lookCache.get(addr), now = Date.now(); if (hit && now - hit.t < 10 * 60000) return hit.v;
  const L = await looksLoad(env), x = await launch(env, addr);
  const judged = L.rows.filter(r => r.p1 !== undefined || r.p24 !== undefined);
  const first = L.rows.length ? Math.min(...L.rows.map(r => r.t)) : null, day1 = L.rows.filter(r => r.p24 !== undefined).length;
  const base = { since: first ? new Date(first).toISOString() : null, logged: L.rows.length, judged: judged.length, judgedDay: day1,
    // when the first results come in: an hour after the first read for the hour, a day after it for the day
    firstHour: first && !judged.length ? new Date(first + HOUR + 10 * 60000).toISOString() : null, firstDay: first && !day1 ? new Date(first + 24 * HOUR + 10 * 60000).toISOString() : null };
  if (!x?.ok || x.price == null || !x.symbol) return { ok: false, why: 'Codex has no reading of this token right now', base };
  const me = [x.liquidity || 0, x.holders || 0, x.top10Pct || 0, x.sniperPct || 0, x.bundlerPct || 0, x.insiderPct || 0, x.devPct || 0].map(v => Math.round(Number(v) * 100) / 100), pad = String(x.launchpad || '');
  const near = judged.filter(r => r.a !== addr).map(r => ({ r, d: lookDist(me, pad, r.f, r.pad) })).filter(o => o.d <= 4).sort((a, b) => a.d - b.d).slice(0, 30);
  const mv = (r, k) => r[k] !== undefined && r.p0 ? (r[k] ? r[k] / r.p0 - 1 : -1) : null;
  const day = near.map(o => mv(o.r, 'p24')).filter(v => v != null), hour = near.map(o => mv(o.r, 'p1')).filter(v => v != null);
  const drained = near.filter(o => o.r.l24 !== undefined && o.r.l0 && o.r.l24 < o.r.l0 * 0.2).length;
  const v = {
    ok: true, token: addr, symbol: x.symbol, ageMin: x.created ? Math.round((now - x.created) / 60000) : null,
    looks: { liquidity: me[0], holders: me[1], top10Pct: me[2], sniperPct: me[3], bundlerPct: me[4], insiderPct: me[5], devPct: me[6], launchpad: pad || null },
    matches: near.length, base,
    after1h: hour.length ? { n: hour.length, median: median(hour), fell50: hour.filter(m => m <= -0.5).length, fell: hour.filter(m => m < -0.1).length, rose: hour.filter(m => m > 0.1).length } : null,
    after24h: day.length ? { n: day.length, median: median(day), fell50: day.filter(m => m <= -0.5).length, fell: day.filter(m => m < -0.1).length, rose: day.filter(m => m > 0.1).length, doubled: day.filter(m => m >= 1).length, drained } : null,
    closest: near.slice(0, 8).map(o => ({ token: o.r.a, symbol: o.r.s, read: new Date(o.r.t).toISOString(), liquidity: o.r.l0, holders: o.r.f[1], top10Pct: o.r.f[2], move1h: mv(o.r, 'p1'), move24h: mv(o.r, 'p24'), liquidity24h: o.r.l24 ?? null, distance: Math.round(o.d * 100) / 100 })),
    note: 'Compared with tokens as they stood 30 to 90 minutes after launch, read from Codex. Past results of other tokens, not a forecast. Not advice.'
  };
  lookCache.set(addr, { t: now, v }); if (lookCache.size > 300) lookCache.delete(lookCache.keys().next().value);
  return v;
}

// ---------- Same Hand: the money behind a wallet ----------
// The browser walks the Pons log itself; the money trail comes from here, from the keyed Blockscout index, because
// the public explorer API turns scripts away. For one wallet: who sent it its first funds (a plain transfer or
// one made inside a contract call, whichever came first), and which wallets it sent funds to. A wallet with a
// hundred or more outgoing transfers is marked busy: an exchange, a bridge or a bot, not one person's launches.
const handCache = new Map();
async function handWallet(env, w, wantCreator) {
  const key = w + (wantCreator ? ':c' : ''), hit = handCache.get(key), now = Date.now(); if (hit && now - hit.t < 10 * 60000) return hit.v;
  if (!env.BLOCKSCOUT_API_KEY) return { ok: false, why: 'not available right now' };
  const bs = async q => { const r = await fetch(`https://api.blockscout.com/4663/api?${q}&apikey=${env.BLOCKSCOUT_API_KEY}`, { headers: UA }); const j = await r.json(); return Array.isArray(j.result) ? j.result : []; };
  const [first, inner, out, made] = await Promise.all([
    bs(`module=account&action=txlist&address=${w}&sort=asc&page=1&offset=10`), bs(`module=account&action=txlistinternal&address=${w}&sort=asc&page=1&offset=10`),
    bs(`module=account&action=txlist&address=${w}&sort=desc&page=1&offset=100`), wantCreator ? bs(`module=contract&action=getcontractcreation&contractaddresses=${w}`) : Promise.resolve([])]);
  const inc = [...first.filter(t => String(t.to).toLowerCase() === w && BigInt(t.value || '0') > 0n).map(t => ({ ...t, via: 'transfer' })), ...inner.filter(t => String(t.to).toLowerCase() === w && BigInt(t.value || '0') > 0n).map(t => ({ ...t, via: 'contract call' }))].sort((a, b) => a.timeStamp - b.timeStamp)[0];
  const sent = [...new Set(out.filter(t => String(t.from).toLowerCase() === w && BigInt(t.value || '0') > 0n && !t.contractAddress && t.input === '0x').map(t => String(t.to).toLowerCase()).filter(isAddr))].filter(a => a !== w);
  // asked about a token: who launched it on Pons, from the launch log read from the token's own first block on
  let ponsBy = null;
  if (wantCreator) try {
    const fb = Number(made[0]?.blockNumber) || Math.min(...[first[0]?.blockNumber, inner[0]?.blockNumber].map(Number).filter(n => n > 0));   // the block the token was made in: a Pons token is made inside the launch call
    if (Number.isFinite(fb)) { const r = await fetch(`https://api.blockscout.com/4663/api?module=logs&action=getLogs&address=${PONS}&fromBlock=${Math.max(39100000, fb - 5)}&toBlock=${fb + 200}&topic0=${T_LAUNCH}&topic1=0x${w.slice(2).padStart(64, '0')}&topic0_1_opr=and&apikey=${env.BLOCKSCOUT_API_KEY}`, { headers: UA, signal: AbortSignal.timeout(15000) }); const j = await r.json(); if (Array.isArray(j.result) && j.result[0]) ponsBy = wordAddr(j.result[0].topics[3]); }
  } catch (e) {}
  const v = { ok: true, wallet: w, ponsBy, first: inc ? { from: String(inc.from).toLowerCase(), eth: Number(BigInt(inc.value) / 10n ** 12n) / 1e6, at: Number(inc.timeStamp) * 1000, via: inc.via } : null,
    sent: sent.slice(0, 60), busy: out.length >= 100, creator: made[0]?.contractCreator ? String(made[0].contractCreator).toLowerCase() : null };
  handCache.set(key, { t: now, v }); if (handCache.size > 500) handCache.delete(handCache.keys().next().value);
  return v;
}

// every Pons launch by each of a list of wallets, from the keyed index. The log is read from the wallet's own first
// transaction on, which keeps each query short: over the factory's whole life one query takes about a minute.
const launchesBy = new Map();
async function handLaunches(env, wallets) {
  if (!env.BLOCKSCOUT_API_KEY) return { ok: false, why: 'not available right now' };
  const now = Date.now(), out = {}, todo = wallets.filter(w => { const h = launchesBy.get(w); if (h && now - h.t < 10 * 60000) { out[w] = h.v; return false; } return true; });
  let i = 0;
  await Promise.all([0, 1, 2, 3, 4].map(async () => {
    while (i < todo.length) {
      const w = todo[i++];
      try {
        const first = await fetch(`https://api.blockscout.com/4663/api?module=account&action=txlist&address=${w}&sort=asc&page=1&offset=1&apikey=${env.BLOCKSCOUT_API_KEY}`, { headers: UA }).then(r => r.json());
        const fb = Number(first.result?.[0]?.blockNumber) || 0;
        if (!fb) { if (Array.isArray(first.result)) { out[w] = []; launchesBy.set(w, { t: now, v: [] }); } continue; }
        const r = await fetch(`https://api.blockscout.com/4663/api?module=logs&action=getLogs&address=${PONS}&fromBlock=${Math.max(39100000, fb)}&toBlock=latest&topic0=${T_LAUNCH}&topic3=0x${w.slice(2).padStart(64, '0')}&topic0_3_opr=and&apikey=${env.BLOCKSCOUT_API_KEY}`, { headers: UA, signal: AbortSignal.timeout(20000) });
        const j = await r.json(), rows = Array.isArray(j.result) ? j.result.map(l => ({ token: wordAddr(l.topics[1]), block: parseInt(l.blockNumber, 16), t: l.timeStamp ? parseInt(l.timeStamp, 16) * 1000 : null })) : j.message === 'No records found' ? [] : null;
        if (rows) { out[w] = rows; launchesBy.set(w, { t: now, v: rows }); if (launchesBy.size > 2000) launchesBy.delete(launchesBy.keys().next().value); }
      } catch (e) {}
    }
  }));
  return { ok: true, launches: out };
}

// Each new Pons graduation is run through Same Hand on the server. When the money behind it leads to wallets that
// launched at least two tokens before and some of them are dead, the community group on Telegram hears about it.
// At most six a day, one per minute, so the group is never flooded.
async function handAlert(st, env) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_GROUP) return;
  const q = st.handQ = st.handQ || [], day = new Date().toISOString().slice(0, 10);
  if (st.handDay?.day !== day) st.handDay = { day, n: 0 };
  if (!q.length || st.handDay.n >= 6) return;
  const token = q.shift();
  const L = await looksLoad(env);
  const io = {
    rpc, wallet: (w, c) => handWallet(env, w, c), launches: async ws => (await handLaunches(env, ws)).launches || {},
    // the aggregators turn the server away, so the pools come from Codex, at most 25 of them
    pools: async list => { const out = {}; const got = await codexAsk(env, L, `{ filterTokens(tokens: [${list.slice(0, 25).map(a => `"${a}:4663"`).join(',')}], limit: 25) { results { liquidity token { address symbol } } } }`); for (const x of got) out[String(x.token.address).toLowerCase()] = { sym: x.token.symbol, liq: Number(x.liquidity) || 0 }; return out; },
  };
  const r = await sameHand(token, io).catch(e => ({ ok: false, why: String(e.message || e) }));
  st.handLast = { t: Date.now(), token, ok: r.ok, launched: r.launched ?? null, dead: r.dead ?? null, why: r.why || null };
  if (!r.ok || r.launched < 2 || !r.dead) return;
  const checked = Math.min(r.launched, 25), dead = r.rows.slice(0, 25).filter(x => x.liq < 1000).length, short = a => a.slice(0, 6) + '…' + a.slice(-4);
  const sym = (await launch(env, token).catch(() => null))?.symbol;
  const text = `<b>Same Hand</b> · ${tgEsc(sym ? '$' + sym : short(token))} just graduated on Pons.\n\nThe money behind its launcher leads to wallets that launched ${r.launched} token${r.launched > 1 ? 's' : ''} on Pons before. ${dead} of the ${checked} checked now ${dead === 1 ? 'holds' : 'hold'} under $1K.\n\n${r.chain.map(c => `${c.role} <code>${short(c.addr)}</code>${c.contract ? ' (a contract)' : c.busy ? ' (busy wallet)' : ''}`).join(' ← ')}\n\nshuntdesk.com/hand/?a=${token}\n\n<i>A shared funder is a link, not proof. Not advice.</i>`;
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: env.TELEGRAM_GROUP, text, parse_mode: 'HTML', disable_web_page_preview: true }) });
  if (res.ok) st.handDay.n++; else st.handLast.why = 'telegram said ' + res.status;
}

// ---------- Agent Scan: the contract read down to its functions ----------
// The bytecode comes from the chain, so it works whether or not the source is verified. Every function the
// dispatcher compares against (PUSH4 sel EQ, or PUSH4 sel DUP2 EQ) is a function the contract exposes. Names come
// from the public signature databases (OpenChain, then 4byte); a selector nobody has named stays unknown. A proxy
// is followed to its implementation (EIP-1967, its beacon, EIP-1167). Read-only functions that take no argument
// are called to show the state now. Sourcify says whether the source is verified. Workers AI writes it up; when it
// does not answer, fixed rules do.
const X_IMPL = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc', X_BEACON = '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50';
export function dispatcher(code) {
  const b = (code || '').replace(/^0x/, ''), out = new Set(), at = i => parseInt(b.substr(i * 2, 2), 16), n = b.length / 2;
  for (let i = 0; i < n; i++) {
    const op = at(i);
    if (op === 0x63 && i + 5 < n) {
      const sel = b.substr((i + 1) * 2, 8), nx = at(i + 5), nx2 = at(i + 6);
      if ((nx === 0x14 || (nx >= 0x80 && nx <= 0x8f && nx2 === 0x14)) && sel !== 'ffffffff' && sel !== '00000000') out.add(sel);
    }
    if (op >= 0x60 && op <= 0x7f) i += op - 0x5f;   // skip push data
  }
  return [...out];
}
const sigCache = new Map();
async function sigNames(sels) {
  const want = sels.filter(s => !sigCache.has(s));
  for (let i = 0; i < want.length; i += 60) {
    const part = want.slice(i, i + 60);
    try {
      const j = await (await fetch(`https://api.openchain.xyz/signature-database/v1/lookup?function=${part.map(s => '0x' + s).join(',')}&filter=true`, { headers: UA, signal: AbortSignal.timeout(8000) })).json();
      for (const s of part) { const c = j.result?.function?.['0x' + s] || []; const best = c.find(x => x.hasVerifiedContract) || c[0]; if (best) sigCache.set(s, best.name); }
    } catch (e) {}
  }
  // what OpenChain does not know, 4byte may; a few at most, it is slow
  for (const s of want.filter(s => !sigCache.has(s)).slice(0, 8)) {
    try { const j = await (await fetch(`https://www.4byte.directory/api/v1/signatures/?hex_signature=0x${s}`, { headers: UA, signal: AbortSignal.timeout(6000) })).json(); const r = (j.results || []).sort((a, b) => a.id - b.id)[0]; sigCache.set(s, r ? r.text_signature : null); } catch (e) {}
  }
  if (sigCache.size > 5000) sigCache.clear();
  return Object.fromEntries(sels.map(s => [s, sigCache.get(s) || null]));
}
const STANDARD = /^(name|symbol|decimals|totalSupply|balanceOf|transfer|transferFrom|approve|allowance|increaseAllowance|decreaseAllowance|permit|nonces|DOMAIN_SEPARATOR|eip712Domain|supportsInterface|owner|getOwner)\(/;
const POWERS = [
  ['mint', /^(mint|mintTo|_mint|issue|airdropMint)\w*\(/i, 'high', 'print new tokens'],
  ['upgrade', /^(upgradeTo|upgradeToAndCall|setImplementation|changeImplementation)\(/i, 'high', 'swap the contract for another'],
  ['pause', /^(pause|unpause|setPaused|freeze|unfreeze|setPause)\w*\(/i, 'high', 'freeze or unfreeze transfers'],
  ['block', /(blacklist|blocklist|setBot|addBot|bots?\b|ban\w*|blockAddress|setSniper|addSniper|isBlocked|setBlock)/i, 'high', 'block wallets from selling'],
  ['tax', /^(set|update|change)\w*(fee|tax)\w*\(/i, 'high', 'change the tax'],
  ['limit', /^(set|update|change|remove)\w*(max|limit)\w*\(/i, 'medium', 'change the transaction or wallet limit'],
  ['trading', /^(enable|open|start|set|toggle|disable)\w*trading\w*\(/i, 'medium', 'switch trading on or off'],
  ['drain', /^(withdraw|rescue|sweep|recover|emergency|claimStuck|clearStuck)\w*\(/i, 'medium', 'pull tokens or ETH out of the contract'],
  ['exempt', /^(exclude|include|setExcluded|setExempt|setIsFeeExempt|setWhitelist|whitelist)\w*\(/i, 'medium', 'exempt chosen wallets from fees or limits'],
  ['router', /^(set|update|change)\w*(router|pair|swap|marketing|wallet|receiver)\w*\(/i, 'low', 'change where swaps and fees go'],
  ['ownership', /^(transferOwnership|setOwner|changeOwner)\(/i, 'medium', 'hand control to another wallet'],
  ['renounce', /^renounceOwnership\(/i, 'info', 'give up control for good'],
];
const READS = /^(owner|getOwner|paused|tradingEnabled|tradingOpen|tradingActive|swapEnabled|limitsInEffect|\w*(buy|sell)\w*(fee|tax)\w*|\w*(fee|tax)\w*|max\w*|_max\w*|\w*Limit\w*)\(\)$/i;
async function contractCall(to, sel) { try { const r = await rpc('eth_call', [{ to, data: '0x' + sel }, 'latest']); return r && r.length >= 66 ? r : null; } catch (e) { return null; } }
function decodeWord(hex, name) {
  const w = hex.slice(2, 66), v = BigInt('0x' + w);
  // an address fills most of its 20 bytes; a balance or a count does not, even a large one
  if (/^0{24}/.test(w) && v >= (1n << 120n) && v < (1n << 160n)) return { kind: 'address', v: '0x' + w.slice(24) };
  if ((v === 0n || v === 1n) && /paused|enabled|open|active|effect/i.test(name)) return { kind: 'bool', v: v === 1n };
  return { kind: 'uint', v: v.toString() };
}
const xrays = new Map();
async function xray(st, env, addr) {
  const hit = xrays.get(addr), now = Date.now(); if (hit && now - hit.t < 30 * 60000) return hit.v;
  const code = await rpc('eth_getCode', [addr, 'latest']).catch(() => null);
  if (!code || code === '0x') return { ok: false, why: 'no contract at this address on Robinhood Chain' };
  // a proxy: read the contract behind it
  let impl = null, proxyKind = null;
  const m1167 = code.match(/^0x363d3d373d3d3d363d73([0-9a-f]{40})5af4/i);
  if (m1167) { impl = '0x' + m1167[1].toLowerCase(); proxyKind = 'minimal proxy (EIP-1167)'; }
  if (!impl) { const s = await rpc('eth_getStorageAt', [addr, X_IMPL, 'latest']).catch(() => null); if (s && BigInt(s) !== 0n) { impl = '0x' + s.slice(-40); proxyKind = 'upgradeable proxy (EIP-1967)'; } }
  if (!impl) { const s = await rpc('eth_getStorageAt', [addr, X_BEACON, 'latest']).catch(() => null); if (s && BigInt(s) !== 0n) { const r = await contractCall('0x' + s.slice(-40), '5c60da1b'); if (r) { impl = '0x' + r.slice(-40); proxyKind = 'beacon proxy'; } } }
  const implCode = impl ? await rpc('eth_getCode', [impl, 'latest']).catch(() => null) : null;
  const sels = [...new Set([...dispatcher(code), ...dispatcher(implCode)])];
  const names = await sigNames(sels);
  const fns = sels.map(s => ({ sel: s, name: names[s] })).sort((a, b) => (a.name || '~').localeCompare(b.name || '~'));
  // state now: owner and the no-argument reads
  const readable = fns.filter(f => f.name && READS.test(f.name)).slice(0, 24);
  const state = [];
  for (const f of readable) { const r = await contractCall(addr, f.sel); if (r) state.push({ fn: f.name, ...decodeWord(r, f.name) }); }
  const ownerRead = state.find(s => /^(owner|getOwner)\(\)$/.test(s.fn) && s.kind === 'address');
  const owner = ownerRead ? ownerRead.v : null, ownerLive = !!owner && !/^0x0{40}$/.test(owner) && !owner.endsWith('dead');
  const powers = [];
  for (const f of fns) {
    if (!f.name || STANDARD.test(f.name)) continue;
    const p = POWERS.find(([, re]) => re.test(f.name)); if (!p) continue;
    if (/^(is\w*|get\w*|paused|\w*Enabled|\w*Open|\w*Active|\w*InEffect)\(\)$/i.test(f.name)) continue;   // a getter, not a power
    powers.push({ fn: f.name, sel: f.sel, kind: p[0], level: p[2], what: p[3] });
  }
  // Sourcify: is the source verified there
  let source = { verified: null, by: 'Sourcify' };
  try { const r = await fetch(`https://sourcify.dev/server/v2/contract/4663/${impl || addr}`, { headers: UA, signal: AbortSignal.timeout(7000) }); if (r.status === 404) source.verified = false; else if (r.ok) { const j = await r.json(); source = { verified: true, by: 'Sourcify', match: j.match || j.runtimeMatch || 'match' }; } } catch (e) {}
  // roles: the contract may answer to an admin role rather than (or as well as) an owner
  const roles = fns.some(f => /^(hasRole|grantRole|getRoleAdmin)\(/.test(f.name || ''));
  const known = fns.filter(f => f.name).length, live = powers.filter(p => p.level === 'high' || p.level === 'medium');
  const v = { ok: true, token: addr, t: now, proxy: impl ? { kind: proxyKind, implementation: impl } : null, owner: owner ? { address: owner, live: ownerLive } : null, roles,
    functions: fns.length, named: known, unknown: fns.length - known, powers, state, source,
    list: fns.map(f => ({ sel: f.sel, name: f.name })), note: 'Read from the bytecode on chain. Function names come from public signature databases; a function that exists may still be guarded, and the owner may not be the only role. Not advice.' };
  v.summary = await xrayWords(st, env, v);
  xrays.set(addr, { t: now, v }); if (xrays.size > 300) xrays.delete(xrays.keys().next().value);
  return v;
}
// plain words: Workers AI first, fixed rules when it does not answer
function xrayRules(v) {
  const hi = v.powers.filter(p => p.level === 'high'), md = v.powers.filter(p => p.level === 'medium');
  const who = !v.owner && v.roles ? 'It uses admin roles (AccessControl) instead of a single owner, so whoever holds those roles controls it.' : !v.owner ? 'No owner() function was found, so who controls it is not visible from the bytecode alone.' : v.owner.live ? `An owner is set (${v.owner.address.slice(0, 6)}…${v.owner.address.slice(-4)}).` : 'Ownership is renounced: functions guarded by the owner are locked, unless the contract has another admin role.';
  const can = [...new Set([...hi, ...md].map(p => p.what))];
  return `${v.functions} functions found${v.unknown ? `, ${v.unknown} of them unnamed` : ''}${v.proxy ? `, behind a ${v.proxy.kind}` : ''}. ${who} ${can.length ? `Functions present that can ${can.slice(0, 5).join(', ')}.` : 'No function that mints, pauses, blocks wallets or changes the tax was found.'}${v.proxy ? ' Because it is a proxy, the code behind it can be replaced.' : ''}`;
}
async function xrayWords(st, env, v) {
  const plain = xrayRules(v);
  if (!env.AI) return { text: plain, by: 'rules' };
  const day = new Date().toISOString().slice(0, 10); if (st.xai?.day !== day) st.xai = { day, n: 0 };
  if (st.xai.n >= 200) return { text: plain, by: 'rules' };
  st.xai.n++;
  const control = v.owner ? (v.owner.live ? `an owner wallet is set: ${v.owner.address}` : 'ownership is renounced (owner is the zero or dead address)') : v.roles ? 'admin roles (AccessControl), no single owner' : 'no owner() function was found; who controls it cannot be seen from the bytecode, and it is NOT known to be renounced';
  const facts = [`Control: ${control}`, `Code: ${v.proxy ? `a ${v.proxy.kind}; the code behind it can be replaced` : 'not a proxy; the code is fixed'}`, `Functions found: ${v.functions} (${v.unknown} unnamed)`,
    `Functions that give power: ${v.powers.length ? v.powers.map(p => `${p.fn} can ${p.what}`).join('; ') : 'none found'}`, `State now: ${v.state.length ? v.state.map(s => `${s.fn} = ${s.v}`).join('; ') : 'nothing readable'}`, `Source verified on Sourcify: ${v.source.verified == null ? 'unknown' : v.source.verified ? 'yes' : 'no'}`].join('\n');
  try {
    const r = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', { max_tokens: 260, messages: [
      { role: 'system', content: 'You explain a token contract to someone about to buy it. Use only the facts given. In three to five short sentences: who controls the contract, what that controller can still do (name the functions), and what the current state is (taxes, limits, trading). Say renounced only if the facts say renounced. A function being present does not prove it can be used by anyone; say the controller can use it. Never say whether to buy or sell. Never predict a price. Plain text, no lists, no markdown.' },
      { role: 'user', content: facts }] });
    const text = String(r?.response || '').trim();
    if (text.length > 40) return { text: text.slice(0, 900), by: 'model' };
  } catch (e) {}
  return { text: plain, by: 'rules' };
}
// a fresh graduation with a live owner power gets posted to the group, at most six a day
async function xrayAlert(st, env) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_GROUP) return;
  const q = st.xrayQ = st.xrayQ || [], day = new Date().toISOString().slice(0, 10);
  if (st.xrayDay?.day !== day) st.xrayDay = { day, n: 0 };
  if (!q.length || st.xrayDay.n >= 6) return;
  const token = q.shift(), v = await xray(st, env, token).catch(() => null);
  st.xrayLast = { t: Date.now(), token, ok: !!v?.ok, powers: v?.powers?.length ?? null };
  if (!v?.ok) return;
  const live = v.powers.filter(p => p.level === 'high' && (v.owner?.live || v.proxy || !v.owner));
  if (!live.length) return;
  const sym = (await launch(env, token).catch(() => null))?.symbol, short = a => a.slice(0, 6) + '…' + a.slice(-4);
  const text = `<b>Agent Scan</b> · ${tgEsc(sym ? '$' + sym : short(token))} just graduated on Pons.\n\n${live.slice(0, 5).map(p => `• <code>${tgEsc(p.fn)}</code>: can ${tgEsc(p.what)}`).join('\n')}\n\n${v.owner?.live ? `Owner: <code>${short(v.owner.address)}</code>` : v.owner ? 'Ownership renounced.' : 'No owner() found.'}${v.proxy ? `\nBehind a ${tgEsc(v.proxy.kind)}.` : ''}\n\nshuntdesk.com/scan/?a=${token}\n\n<i>Read from the bytecode. A function that exists may still be guarded. Not advice.</i>`;
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: env.TELEGRAM_GROUP, text, parse_mode: 'HTML', disable_web_page_preview: true }) });
  if (res.ok) st.xrayDay.n++; else st.xrayLast.why = 'telegram said ' + res.status;
}

// ---------- Bond Watch: every token on the Pons curve, read from the curves themselves ----------
// The factory's launch log names each token's curve. Each curve keeps its own state: realQuoteReserve() is the ETH
// raised, graduationThreshold() the ETH it needs to bond, graduated() whether it has. All of them are read in one
// call through Multicall3 every ten minutes. A launch that has raised under 1% six hours in is dropped, so the
// list stays to the ones still moving; the counts of launches and bonds per day come from the logs.
const MC3 = '0xca11bde05977b3631167028862be2a173976ca11', BONDS = 'bonds-v5';
// Pons curve and token selectors: keccak-256 of each signature, worked out once (the test checks them)
const SEL = { real: '4f1f58fd', thr: '8b0bc501', grad: 'e7c2b772', sym: '95d89b41', nat: 'dc08e094', pair: '3de35b79', curve: '7165485d', qres: '9da771f4', tres: 'cbcb3171', fee: '24a9d853', ctax: 'c1bb8901' };
async function selOf(sig) { return keccak256([...new TextEncoder().encode(sig)].map(b => b.toString(16).padStart(2, '0')).join('')).slice(0, 8); }
const mcStat = { req: 0, fail: 0, err: null };   // how the multicalls are going, shown on /api/bonds
async function multicall(calls) {   // calls: [target, selector] → hex result or null
  const out = [];
  // 250 calls a request: a Worker run may make only so many requests, and Bond Watch shares its run with every other job
  for (let i = 0; i < calls.length; i += 250) {
    const part = calls.slice(i, i + 250), n = part.length, w = x => x.toString(16).padStart(64, '0');
    let head = w(32) + w(n), body = '';
    part.forEach(([to, sel], k) => { head += w(n * 32 + k * 160); body += w(BigInt(to)) + w(1) + w(96) + w(4) + sel.padEnd(64, '0'); });
    let r = null;
    mcStat.req++;
    for (let k = 0; k < 2 && !r; k++) { try { r = await rpc('eth_call', [{ to: MC3, data: '0x82ad56cb' + head + body }, 'latest']); } catch (e) { mcStat.err = String(e.message || e).slice(0, 100); if (!k) await new Promise(z => setTimeout(z, 600)); } }   // once more after a pause
    if (!r) mcStat.fail++;
    if (!r) { out.push(...part.map(() => null)); continue; }
    const h = r.slice(2), word = o => BigInt('0x' + h.substr(o * 2, 64)), base = Number(word(32)) === n ? 64 : 64;
    for (let k = 0; k < n; k++) {
      const off = 64 + Number(word(64 + k * 32)), ok = word(off) === 1n, dOff = off + Number(word(off + 32)), len = Number(word(dOff));
      out.push(ok && len ? '0x' + h.substr((dOff + 32) * 2, len * 2) : null);
    }
  }
  return out;
}
const str = hex => { try { if (!hex || hex.length < 130) return null; const h = hex.slice(2), len = parseInt(h.substr(64, 64), 16); return new TextDecoder().decode(new Uint8Array(h.substr(128, len * 2).match(/../g).map(b => parseInt(b, 16)))).replace(/[^\x20-\x7e]/g, '').slice(0, 16); } catch (e) { return null; } };
let bondsMem = null;
const bondsLoad = async env => bondsMem || (bondsMem = await env.KV.get(BONDS).then(s => s ? JSON.parse(s) : { rows: [], block: 0, t: 0, days: [] }));
// ---------- Dev Ledger: what the wallet that launched a token has done with that token ----------
// Every transfer of the token in or out of the launcher, from the keyed Blockscout index, sorted by where it went:
// burned (the zero or dead address), sold into the token's Pons curve, sent into another contract (a pool, a router,
// a locker: the index cannot tell a sale from a deposit there), or sent to other wallets (EIP-7702 wallets count as
// wallets). In: bought from the curve, or received. Plus the burns of the token by anyone. Kept five minutes.
const DEAD = '0x000000000000000000000000000000000000dead', ledgers = new Map();
export async function devLedger(env, token) {
  const hit = ledgers.get(token), now = Date.now(); if (hit && now - hit.t < 5 * 60000) return hit.v;
  if (!env.BLOCKSCOUT_API_KEY) return { ok: false, why: 'not available right now' };
  const bs = async q => { const r = await fetch(`https://api.blockscout.com/4663/api?${q}&apikey=${env.BLOCKSCOUT_API_KEY}`, { headers: UA, signal: AbortSignal.timeout(12000) }); const j = await r.json(); return Array.isArray(j.result) ? j.result : []; };
  const sh = await handWallet(env, token, true).catch(() => null), dev = String(sh?.ponsBy || sh?.creator || '').toLowerCase() || null;
  if (!dev) return { ok: false, why: 'the launcher could not be found' };
  const c = await ponsCurve(token), curve = c?.curve || null;
  const [txs, burns, dec, bal] = await Promise.all([
    bs(`module=account&action=tokentx&contractaddress=${token}&address=${dev}&sort=asc&page=1&offset=1000`),
    bs(`module=account&action=tokentx&contractaddress=${token}&address=${DEAD}&sort=desc&page=1&offset=200`),
    contractCall(token, '313ce567'), contractCall(token, '70a08231' + dev.slice(2).padStart(64, '0'))]);
  const d = dec ? Number(BigInt(dec)) : 18, amt = v => Number(BigInt(v || '0') * 1000n / 10n ** BigInt(d)) / 1000;
  // the other ends: where it sent tokens, and where tokens came from (a router or pool sends what was bought through it)
  const others = [...new Set(txs.map(t => String(t.from).toLowerCase() === dev ? String(t.to).toLowerCase() : String(t.from).toLowerCase()).filter(a => a !== dev && a !== DEAD && !/^0x0{40}$/.test(a) && a !== curve))];
  const codes = {}; await Promise.all(others.slice(0, 40).map(async a => { codes[a] = await rpc('eth_getCode', [a, 'latest']).catch(() => null); }));
  const isPool = a => { const k = codes[a]; return !!k && k !== '0x' && !isDelegated(k); };
  const L = { bought: 0, received: 0, burned: 0, sold: 0, toContracts: 0, toWallets: 0 }, moves = [];
  for (const t of txs) {
    const from = String(t.from).toLowerCase(), to = String(t.to).toLowerCase(), v = amt(t.value), at = Number(t.timeStamp) * 1000;
    if (to === dev) { if (from === curve || isPool(from)) L.bought += v; else L.received += v; continue; }   // from the curve or a contract: bought; from a wallet or a mint: received
    if (from !== dev) continue;
    const kind = to === DEAD || /^0x0{40}$/.test(to) ? 'burned' : to === curve ? 'sold' : isPool(to) ? 'toContracts' : 'toWallets';
    L[kind] += v; moves.push({ kind, amount: v, to, at: new Date(at).toISOString(), tx: t.hash });
  }
  const burnRows = burns.filter(t => String(t.to).toLowerCase() === DEAD);
  const v = { ok: true, token, dev, devFound: sh?.ponsBy ? 'Pons launch log' : 'contract creation', curve, ledger: L, holdsNow: bal ? amt(BigInt(bal).toString()) : null,
    moves: moves.slice(-40).reverse(), partial: txs.length >= 1000,
    burns: { total: burnRows.reduce((s, t) => s + amt(t.value), 0), count: burnRows.length, byDev: burnRows.filter(t => String(t.from).toLowerCase() === dev).length, last: burnRows.slice(0, 12).map(t => ({ amount: amt(t.value), from: String(t.from).toLowerCase(), at: new Date(Number(t.timeStamp) * 1000).toISOString(), tx: t.hash })) },
    note: 'Every transfer of this token in or out of the wallet that launched it, from the chain index. "Into contracts" may be a sale through a router or a deposit: the index cannot tell. Read only. Not advice.' };
  ledgers.set(token, { t: now, v }); if (ledgers.size > 300) ledgers.delete(ledgers.keys().next().value);
  return v;
}
// one Pons log over a wide range: the public node first (the backup node refuses wide ranges), then the keyed index, page by page
async function wideLogs(env, topic0, from, to) {
  let why = '';
  for (let k = 0; k < 3; k++) {
    try {
      const r = await fetch(RPCS[0], { method: 'POST', headers: { 'Content-Type': 'application/json', ...UA }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getLogs', params: [{ address: PONS, topics: [topic0], fromBlock: hex(from), toBlock: hex(to) }] }) });
      const j = await r.json().catch(() => null); if (j && Array.isArray(j.result)) return j.result; why = 'node said ' + r.status;
    } catch (e) { why = String(e.message || e).slice(0, 80); }
    await new Promise(r => setTimeout(r, 1200));
  }
  if (!env?.BLOCKSCOUT_API_KEY) throw new Error(why);
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const r = await fetch(`https://api.blockscout.com/4663/api?module=logs&action=getLogs&address=${PONS}&topic0=${topic0}&fromBlock=${from}&toBlock=${to}&page=${page}&offset=1000&apikey=${env.BLOCKSCOUT_API_KEY}`, { headers: UA });
    const j = await r.json().catch(() => null);
    if (j && Array.isArray(j.result)) { out.push(...j.result); if (j.result.length < 1000) return out; }
    else if (j?.message === 'No records found') return out;
    else throw new Error(why + ' · blockscout: ' + String(j?.message || r.status).slice(0, 60));
  }
  return out;
}
// a log's time. The node's blockTimestamp reads 0 on this chain, so each tick reads the time of two blocks, the head and
// one a week back, and places every block between them at the chain's real pace (a fixed tenth of a second drifts hours
// over a week). The index's timeStamp is used where it is given.
let clock = null;
const logTime = (l, now, head) => { const ts = l.timeStamp ? parseInt(l.timeStamp, String(l.timeStamp).startsWith('0x') ? 16 : 10) : 0; if (ts > 0) return ts * 1000;
  const b = parseInt(l.blockNumber, 16); return clock ? clock.t - (clock.head - b) * clock.rate : now - (head - b) * 100; };
export async function bondTick(env) {
  const B = await bondsLoad(env), now = Date.now(); if (now - B.t < 10 * 60000) return; B.t = now;
  let stage = 'head'; mcStat.req = 0; mcStat.fail = 0; mcStat.err = null;
  try {
    // forward from the last read; on the first read the last 800,000 blocks (about 22 hours). Then one more window
    // back each tick until a week is covered: a week at once is more calls than one tick may make.
    const head = parseInt(await rpc('eth_blockNumber'), 16), first = !B.block, from = first ? head - 799999 : B.block + 1;
    try { const bt = async n => parseInt((await rpc('eth_getBlockByNumber', ['0x' + n.toString(16), false])).timestamp, 16) * 1000, back = 7 * 864000, [t1, t0] = await Promise.all([bt(head), bt(head - back)]); clock = t1 > t0 ? { head, t: t1, rate: (t1 - t0) / back } : null; } catch (e) { clock = null; }
    const wins = []; for (let a = from; a <= head; a += 400000) wins.push([a, Math.min(head, a + 399999)]);
    const floor = first ? from : B.floor || from, back = floor > head - 7 * 864000 ? [Math.max(head - 7 * 864000, floor - 400000), floor - 1] : null;
    if (back) wins.push(back);
    const have = new Set([...B.rows.map(r => r.t0), ...(B.todo || []).map(r => r.t0)]), fresh = [], grads = [];
    // read every window first, count nothing until all of them came back: a failed read leaves the record as it was
    for (const [a, z] of wins) {
      stage = 'launch log';
      const logs = await wideLogs(env, T_LAUNCH, a, z);
      for (const l of logs) { const token = wordAddr(l.topics[1]); if (!have.has(token)) { have.add(token); fresh.push({ t0: token, c: wordAddr(l.topics[2]), by: wordAddr(l.topics[3]), b: parseInt(l.blockNumber, 16), at: logTime(l, now, head) }); } }
      stage = 'bond log';
      grads.push(...await wideLogs(env, T_GRAD, a, z));
    }
    if (first) B.days = [];
    B.floor = back ? back[0] : floor; B.head = head;
    // when each one bonded, from its graduation log's block: a curve first read after it bonded keeps its real time
    B.ga = B.ga || {}; for (const l of grads) B.ga[wordAddr(l.topics[1])] = logTime(l, now, head);
    for (const k in B.ga) if (now - B.ga[k] > 9 * 24 * HOUR) delete B.ga[k];
    // once: the graduation logs of the last week read again, two windows a tick, so bonds recorded before this was kept get their real time
    if (!B.gaDone) { B.gaPos = B.gaPos || head; for (let k = 0; k < 2 && !B.gaDone; k++) { stage = 'bond times'; const z = B.gaPos, a0 = Math.max(head - 7 * 864000, z - 399999); for (const l of await wideLogs(env, T_GRAD, a0, z)) B.ga[wordAddr(l.topics[1])] = logTime(l, now, head); B.gaPos = a0 - 1; if (a0 <= head - 7 * 864000) B.gaDone = 1; } }
    for (const l of grads) { const d = new Date(logTime(l, now, head)).toISOString().slice(0, 10); const day = B.days.find(x => x.d === d) || (B.days.push({ d, l: 0, g: 0 }), B.days.at(-1)); day.g++; }
    stage = 'curves';
    for (const f of fresh) { const d = new Date(f.at).toISOString().slice(0, 10); const day = B.days.find(x => x.d === d) || (B.days.push({ d, l: 0, g: 0 }), B.days.at(-1)); day.l++; }
    B.days = B.days.sort((a, b) => a.d < b.d ? -1 : 1).slice(-14);
    B.block = head;
    // the new ones go in a queue, newest first; each tick reads its threshold, symbol and quote for up to 400 of them,
    // so a first read of a week of launches is done within a few hours and a failed read is tried again, three times
    B.todo = [...fresh, ...(B.todo || [])].sort((a, b) => b.at - a.at);
    const batch = B.todo.splice(0, 400);
    if (batch.length) {
      const res = await multicall(batch.flatMap(f => [[f.c, SEL.thr], [f.t0, SEL.sym], [f.c, SEL.nat], [f.c, SEL.pair], [f.c, SEL.fee], [f.c, SEL.ctax]]));
      // a curve quoted in a token rather than native ETH: name that token, once per token
      const quotes = [...new Set(batch.map((f, i) => res[i * 6 + 2] && BigInt(res[i * 6 + 2]) === 0n && res[i * 6 + 3] ? '0x' + res[i * 6 + 3].slice(-40) : null).filter(a => a && !/^0x0{40}$/.test(a)))];
      const qs = quotes.length ? await multicall(quotes.map(q => [q, SEL.sym])) : [], qsym = Object.fromEntries(quotes.map((q, i) => [q, str(qs[i]) || 'quote']));
      batch.forEach((f, i) => {
        const th = res[i * 6];
        // a read that did not come back is tried again next tick, at the back of the queue; never dropped while it is under a week old
        if (!th) { f.tries = (f.tries || 0) + 1; if (now - f.at < 7 * 24 * HOUR) B.todo.push(f); return; }
        f.th = Number(BigInt(th) / 10n ** 12n) / 1e6; f.s = str(res[i * 6 + 1]) || f.t0.slice(0, 8); f.h = []; delete f.tries; if (res[i * 6 + 4]) f.fee = (Number(BigInt(res[i * 6 + 4])) + (res[i * 6 + 5] ? Number(BigInt(res[i * 6 + 5])) : 0)) / 10000;
        const nat = res[i * 6 + 2], pr = res[i * 6 + 3]; f.u = nat && BigInt(nat) === 0n && pr ? qsym['0x' + pr.slice(-40)] || 'quote' : 'ETH';
        if (f.th > 0) B.rows.push(f);
      });
    }    // every curve still on the board: what it has raised, and whether it bonded
    const live = B.rows.filter(r => !r.g);
    const before = new Map(live.map(r => [r.t0, { p: r.p, n: r.h.length }]));
    const res = await multicall(live.flatMap(r => [[r.c, SEL.real], [r.c, SEL.grad], [r.c, SEL.qres], [r.c, SEL.tres]]));
    // the fee is read once per curve, not every tick: it is set at launch
    const feeless = live.filter(r => r.fee == null), fees = feeless.length ? await multicall(feeless.flatMap(r => [[r.c, SEL.fee], [r.c, SEL.ctax]])) : [];
    feeless.forEach((r, i) => { const fb = fees[i * 2], ct = fees[i * 2 + 1]; if (fb) r.fee = (Number(BigInt(fb)) + (ct ? Number(BigInt(ct)) : 0)) / 10000; });
    live.forEach((r, i) => { const q = res[i * 4], gd = res[i * 4 + 1], qr = res[i * 4 + 2], tr = res[i * 4 + 3]; if (qr && tr) { r.vq = Number(BigInt(qr) / 10n ** 12n) / 1e6; r.vt = Number(BigInt(tr) / 10n ** 12n) / 1e6; } if (q) { const eth = Number(BigInt(q) / 10n ** 12n) / 1e6; r.q = eth; r.p = Math.min(100, eth / r.th * 100); r.h.push([now, Math.round(r.p * 100) / 100]); r.h = r.h.slice(-36); r.max = Math.max(r.max || 0, r.p); } if (gd && BigInt(gd) === 1n) { r.g = B.ga?.[r.t0] || now; r.p = 100; } });
    // keep: every curve still open that has raised 1% or more, however old; a new one for its first six hours;
    // the bonded ones for two days. The largest 2,000 if it ever comes to that.
    // a curve whose progress has not been read yet stays until it is: a failed read is not a curve at 0%
    B.rows = B.rows.filter(r => r.g ? now - r.g < 48 * HOUR : (r.max == null && now - r.at < 7 * 24 * HOUR) || r.max >= 1 || now - r.at < 6 * HOUR).sort((a, b) => (b.p || 0) - (a.p || 0)).slice(0, 2000);
    // bond alerts for the group: a curve seen below 85% that is now at or over it, and a tracked curve that bonded
    const alerts = live.filter(r => { const was = before.get(r.t0); return was && was.n > 0 && was.p != null && ((r.g && was.p < 100) || (!r.g && was.p < 85 && r.p >= 85)); });
    if (alerts.length) await bondAlerts(env, B, alerts, now).catch(() => 0);
    B.err = null;
  } catch (e) { B.err = (stage + ': ' + String(e.message || e)).slice(0, 160); }
  B.mc = { ...mcStat };   // this tick's multicalls: how many went out, how many came back empty, the last error
  await env.KV.put(BONDS, JSON.stringify(B));
}
export async function bondView(env) {
  const B = await bondsLoad(env), now = Date.now();
  const speed = r => { const h = r.h || [], a = h.find(x => now - x[0] <= 65 * 60000) || h[0], z = h.at(-1); if (!a || !z || z[0] === a[0]) return null; return (z[1] - a[1]) / ((z[0] - a[0]) / HOUR); };
  const rows = B.rows.filter(r => !r.g && r.p != null).map(r => { const v = speed(r); return { token: r.t0, symbol: r.s, launcher: r.by, launched: new Date(r.at).toISOString(), progress: Math.round(r.p * 10) / 10, raised: r.q, need: r.th, unit: r.u || 'ETH', perHour: v == null ? null : Math.round(v * 10) / 10, etaHours: v > 0.05 ? Math.round((100 - r.p) / v * 10) / 10 : null, peak: Math.round((r.max || 0) * 10) / 10 }; })
    .sort((a, b) => b.progress - a.progress).slice(0, 80);
  const gt = r => B.ga?.[r.t0] || r.g;   // the graduation log's time where it is known
  const bonded = B.rows.filter(r => r.g).sort((a, b) => gt(b) - gt(a)).slice(0, 20).map(r => ({ token: r.t0, symbol: r.s, bonded: new Date(gt(r)).toISOString(), hoursToBond: Math.round((gt(r) - r.at) / HOUR * 10) / 10 }));
  const days = B.days.slice(-7), L = days.reduce((s, d) => s + d.l, 0), G = days.reduce((s, d) => s + d.g, 0);
  // of the tracked launches that ever reached a mark, how many bonded: a rate that grows as the log does
  const reach = m => { const hit = B.rows.filter(r => (r.max || 0) >= m && now - r.at > 6 * HOUR); return { n: hit.length, bonded: hit.filter(r => r.g).length }; };
  const cover = B.head && B.floor ? Math.round((B.head - B.floor) / 36000) : 0;
  return { ok: true, read: B.t, multicall: B.mc || null, onCurve: B.rows.filter(r => !r.g).length, coverage: { hours: cover, complete: cover >= 167 && !(B.todo || []).length, queued: (B.todo || []).length }, days, week: { launched: L, bonded: G, rate: L ? G / L : null }, reached: { 25: reach(25), 50: reach(50), 75: reach(75) }, rows, bonded, err: B.err || null,
    note: 'Read from each Pons curve on chain: ETH raised against the ETH it needs to bond. The pace is the last hour; an estimate is only that pace carried on. Not advice.' };
}

// ---------- Tripwire: a private alarm on Telegram for one token ----------
// /watch 0x… in a DM to the bot. Every three minutes the server looks at what happened to the token since the last
// look: a transaction that called one of the contract's power functions (the selectors Agent Scan found), and
// tokens leaving the launcher's wallet or one of the largest holders' wallets (Transfer logs). Five tokens a chat,
// 150 tokens in all.
const T_TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
async function tripAdd(st, env, chat, token) {
  const T = st.trip = st.trip || {};
  const mine = Object.entries(T).filter(([, w]) => w.chats.includes(chat));
  if (T[token]?.chats.includes(chat)) return { ok: true, why: 'already watching' };
  const cap = isHolder(st, chat) ? HOLD_TRIP : 5;   // a $SHUNT holder's chat watches more
  if (mine.length >= cap) return { ok: false, why: cap === 5 ? 'five tokens a chat; /unwatch one first, or link a $SHUNT wallet with /link for ' + HOLD_TRIP : HOLD_TRIP + ' tokens a chat; /unwatch one first' };
  if (!T[token] && Object.keys(T).length >= 150) return { ok: false, why: 'the tripwire is full right now' };
  if (!T[token]) {
    const x = await xray(st, env, token).catch(() => null);
    if (!x?.ok) return { ok: false, why: x?.why || 'the contract could not be read' };
    const sels = Object.fromEntries(x.powers.filter(p => p.level !== 'info').map(p => [p.sel, p.fn]));
    // who to watch selling: the launcher, and the ten largest ordinary holders per GoPlus
    const gp = await goplus(env, token).catch(() => null), sh = await handWallet(env, token, true).catch(() => null);
    const watch = [...new Set([sh?.ponsBy, sh?.creator, ...(gp?.holders || []).filter(h => h.is_contract != 1 && h.is_locked != 1).slice(0, 10).map(h => String(h.address).toLowerCase())].filter(isAddr))].slice(0, 12);
    const sup = await contractCall(token, '18160ddd'), head = parseInt(await rpc('eth_blockNumber'), 16);
    T[token] = { chats: [], sym: word(gp?.token_symbol || '', 12) || null, sels, watch, launcher: sh?.ponsBy || sh?.creator || null, supply: sup ? BigInt(sup).toString() : null, block: head, t: Date.now() };
  }
  T[token].chats.push(chat);
  return { ok: true, w: T[token] };
}
function tripDrop(st, chat, token) {
  const T = st.trip || {}; if (!T[token]) return false;
  T[token].chats = T[token].chats.filter(c => c !== chat); if (!T[token].chats.length) delete T[token];
  return true;
}
async function tgSend(env, chat, text) {
  if (!env.TELEGRAM_BOT_TOKEN) return 0;
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }) });
  return r.status;
}
// Tripwire by email (Resend): an address is only used after its owner clicks the link in a confirmation email,
// and every alert carries a link that stops it. Three tokens an address, 300 addresses in all.
const mailOk = e => /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[a-z]{2,}$/i.test(e || '');
async function sendMail(env, to, subject, html) {
  if (!env.RESEND_API_KEY) return 0;
  // Resend turns away a request with no User-Agent, and a Worker's fetch sends none of its own
  const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json', 'User-Agent': 'shuntdesk/1.0 (+https://shuntdesk.com)' }, body: JSON.stringify({ from: env.RESEND_FROM || 'Shuntdesk <alerts@shuntdesk.com>', to: [to], subject, html }) });
  if (r.status >= 300) mailErr = (await r.text().catch(() => '')).slice(0, 160);
  return r.status;
}
let mailErr = '';
async function tripMail(st, env, b, origin) {
  const email = String(b?.email || '').trim().toLowerCase(), token = String(b?.token || '').toLowerCase();
  if (!mailOk(email) || !isAddr(token)) return [400, { ok: false, why: 'an email address and a token address, please' }];
  const M = st.tripMail = st.tripMail || {};
  const mine = Object.values(M).filter(m => m.email === email && m.on);
  if (mine.length >= 3) return [400, { ok: false, why: 'three tokens per address' }];
  if (Object.keys(M).length >= 300) return [400, { ok: false, why: 'email alerts are full right now' }];
  const x = await xray(st, env, token).catch(() => null); if (!x?.ok) return [400, { ok: false, why: x?.why || 'the contract could not be read' }];
  const id = crypto.randomUUID().slice(0, 12), code = crypto.randomUUID().replace(/-/g, '');
  M[id] = { email, token, code, on: false, t: Date.now() };
  const link = `${origin}/api/trip/confirm?id=${id}&c=${code}`;
  const s = await sendMail(env, email, 'Confirm your Shuntdesk tripwire', `<p>Someone asked for Tripwire alerts on <b>${token}</b> to be sent to this address.</p><p><a href="${link}">Confirm and start the alerts</a></p><p>If it was not you, ignore this email and nothing will be sent.</p><p style="color:#888">Shuntdesk · shuntdesk.com · not advice</p>`);
  if (!s || s >= 300) { delete M[id]; return [502, { ok: false, why: `the email could not be sent right now (mail service ${s || 'not set up'}${mailErr ? ': ' + mailErr : ''})` }]; }
  return [200, { ok: true, why: 'check your inbox for the confirmation link' }];
}
async function tripMailLink(st, env, kind, id, c) {
  const m = st.tripMail?.[id]; if (!m || m.code !== c) return 'That link is no longer valid.';
  if (kind === 'off') { delete st.tripMail[id]; return 'Done: no more Tripwire emails for that token.'; }
  if (!m.on) {
    // the token goes on the tripwire with this address as one of its listeners
    const r = await tripAdd(st, env, 'mail:' + id, m.token).catch(() => null);
    if (!r?.ok) return 'The tripwire could not be set right now. Try again later.';
    m.on = true;
  }
  return 'Confirmed. You will get an email when the owner calls a power function, or the launcher or a top holder moves tokens out.';
}
export async function tripTick(st, env) {
  const T = st.trip; if (!T || !Object.keys(T).length) return;
  const now = Date.now(); if (now - (st.tripT || 0) < 3 * 60000) return; st.tripT = now;
  const head = parseInt(await rpc('eth_blockNumber'), 16), short = a => a.slice(0, 6) + '…' + a.slice(-4);
  for (const [token, w] of Object.entries(T)) {
    const from = w.block + 1; if (from > head) continue;
    const say = [];
    // power functions called since the last look
    if (env.BLOCKSCOUT_API_KEY && Object.keys(w.sels).length) try {
      const j = await (await fetch(`https://api.blockscout.com/4663/api?module=account&action=txlist&address=${token}&startblock=${from}&endblock=${head}&sort=asc&page=1&offset=50&apikey=${env.BLOCKSCOUT_API_KEY}`, { headers: UA })).json();
      for (const tx of Array.isArray(j.result) ? j.result : []) {
        const sel = String(tx.input || '').slice(2, 10).toLowerCase();
        if (String(tx.to).toLowerCase() === token && w.sels[sel] && tx.isError !== '1') say.push(`<code>${tgEsc(w.sels[sel])}</code> was just called by <code>${short(String(tx.from).toLowerCase())}</code>`);
      }
    } catch (e) {}
    // tokens leaving the launcher or a top holder
    if (w.watch.length) try {
      const logs = await rpc('eth_getLogs', [{ address: token, topics: [T_TRANSFER, w.watch.map(a => '0x' + a.slice(2).padStart(64, '0'))], fromBlock: hex(Math.max(from, head - 90000)), toBlock: hex(head) }]);
      const out = {}; for (const l of logs || []) { const f = wordAddr(l.topics[1]); out[f] = (out[f] || 0n) + BigInt(l.data); }
      for (const [f, amt] of Object.entries(out)) {
        const share = w.supply ? Number(amt * 100000n / BigInt(w.supply)) / 1000 : null;
        if (share == null || share >= 0.5) say.push(`${f === w.launcher ? 'The launcher' : 'A top-10 holder'} <code>${short(f)}</code> just moved ${share == null ? 'tokens' : share.toFixed(2) + '% of supply'} out`);
      }
    } catch (e) {}
    w.block = head;
    if (!say.length) continue;
    const text = `<b>Tripwire</b> · ${tgEsc(w.sym ? '$' + w.sym : short(token))}\n\n${say.slice(0, 6).map(s => '• ' + s).join('\n')}\n\nshuntdesk.com/scan/?a=${token}\n\n<i>From the chain, as it happened. Not advice. /unwatch ${token} to stop.</i>`;
    for (const c of w.chats) {
      if (String(c).startsWith('mail:')) { const m = st.tripMail?.[String(c).slice(5)]; if (!m) { w.chats = w.chats.filter(x => x !== c); continue; } const off = `https://shuntdesk.com/api/trip/off?id=${String(c).slice(5)}&c=${m.code}`; await sendMail(env, m.email, `Tripwire · ${w.sym ? '$' + w.sym : short(token)}`, text.replace(/\n/g, '<br>').replace(/\/unwatch \S+ to stop\./, `<a href="${off}">Stop these emails</a>.`)).catch(() => 0); continue; }
      const code = await tgSend(env, c, text).catch(() => 0); if (code === 403) w.chats = w.chats.filter(x => x !== c);
    }
    if (!w.chats.length) delete T[token];
  }
}

// ---------- wallet intel: the same wallet off this chain ----------
// For the wallets on a money trail or the owner of a contract: Webacy's risk read (drainers, hacks, mixers,
// sanctions, on Ethereum and Base), and the wallet's history on Ethereum and Arbitrum from Etherscan (the free
// plan does not cover Base or Robinhood Chain): first seen, how many transactions, how many contracts it made.
// Kept a day per wallet, since none of it changes fast and both free plans are small.
const intelCache = new Map();
async function walletIntel(st, env, w) {
  const hit = intelCache.get(w), now = Date.now(); if (hit && now - hit.t < 24 * HOUR) return hit.v;
  const day = new Date().toISOString().slice(0, 10); if (st.intelDay?.day !== day) st.intelDay = { day, n: 0 };
  if (st.intelDay.n >= 300) return { ok: false, why: 'the daily allowance is used up' };
  st.intelDay.n++;
  const risk = async chain => {
    if (!env.WEBACY_API_KEY) return null;
    try { const j = await (await fetch(`https://api.webacy.com/addresses/${w}?chain=${chain}`, { headers: { 'x-api-key': env.WEBACY_API_KEY, Accept: 'application/json' }, signal: AbortSignal.timeout(12000) })).json();
      const tags = [...new Map((j.issues || []).flatMap(i => i.tags || []).map(t => [t.key, { key: t.key, name: t.name, severity: t.severity }])).values()].sort((a, b) => b.severity - a.severity);
      return { overall: j.overallRisk ?? null, tags: tags.filter(t => t.severity >= 1).slice(0, 8) }; } catch (e) { return null; }
  };
  const hist = async chainid => {
    if (!env.ETHERSCAN_API_KEY) return null;
    try {
      const base = `https://api.etherscan.io/v2/api?chainid=${chainid}&module=account&action=txlist&address=${w}&apikey=${env.ETHERSCAN_API_KEY}`;
      // one call at a time, once more after a pause if the free plan's per-second limit answers instead: a refused read
      // is unknown, never "no transactions"
      const get = async q => { for (let k = 0; k < 2; k++) { const j = await (await fetch(base + q)).json(); if (Array.isArray(j.result)) return j.result; if (/no transactions/i.test(j.message || '')) return []; await new Promise(z => setTimeout(z, 1100)); } return null; };
      const first = await get('&page=1&offset=1&sort=asc'); if (first === null) return null; if (!first.length) return { txs: 0 };
      const recent = await get('&page=1&offset=100&sort=desc'); if (recent === null) return { firstSeen: Number(first[0].timeStamp) * 1000, txs: null, made: null };
      return { firstSeen: Number(first[0].timeStamp) * 1000, txs: recent.length >= 100 ? '100+' : recent.length, made: recent.filter(t => t.contractAddress && String(t.from).toLowerCase() === w).length };
    } catch (e) { return null; }
  };
  const [eth, base, [ethH, arbH]] = await Promise.all([risk('eth'), risk('base'), (async () => [await hist(1), await hist(42161)])()]);
  const tags = [...new Map([...(eth?.tags || []), ...(base?.tags || [])].map(t => [t.key, t])).values()].sort((a, b) => b.severity - a.severity);
  const v = { ok: true, wallet: w, risk: eth || base ? { overall: Math.max(eth?.overall || 0, base?.overall || 0), tags } : null, ethereum: ethH, arbitrum: arbH };
  intelCache.set(w, { t: now, v }); if (intelCache.size > 1000) intelCache.delete(intelCache.keys().next().value);
  return v;
}

// ---------- Site Check: the token's website and links, checked ----------
// The links come from the token itself where it keeps them (a Pons token's socials() on chain) and from the pages
// the browser already has (DexScreener's profile). The website then goes through four checks: Google Safe Browsing
// for known phishing and malware, RDAP for how old the domain is, urlscan.io for what the page loads and whether it
// is judged malicious (an earlier scan if there is one, else a new unlisted scan, read on a later call), and Jina
// Reader for what the page says: a request for a seed phrase or a wallet connection, or next to nothing at all.
const BIG = /(^|\.)(x\.com|twitter\.com|t\.me|telegram\.(me|org)|discord\.(gg|com)|github\.com|medium\.com|youtube\.com|instagram\.com|tiktok\.com|linktr\.ee|dexscreener\.com|ponsfamily\.com|pons\.family|robinhood\.com)$/i;
const sites = new Map();
const urlsIn = s => [...new Set((s.match(/https?:\/\/[^\s\x00-\x1f"'<>()\[\]{}|\\^`]+/g) || []).map(u => u.replace(/[.,;:!?·]+$/, '')))].slice(0, 12);
async function siteCheck(st, env, token, extra = [], opts = {}) {
  const now = Date.now(), hit = sites.get(token);
  if (hit && now - hit.t < 6 * HOUR && !hit.v.pending) return hit.v;
  const day = new Date().toISOString().slice(0, 10); if (st.siteDay?.day !== day) st.siteDay = { day, n: 0, scans: 0 };
  // links: on chain first, then what the browser passed
  let onChain = [];
  try { const r = await contractCall(token, await selOf('socials()')); if (r) onChain = urlsIn(new TextDecoder().decode(new Uint8Array(r.slice(2).match(/../g).map(b => parseInt(b, 16))))); } catch (e) {}
  const links = [...new Set([...onChain, ...extra.filter(u => /^https?:\/\/[^\s]{4,300}$/.test(u))])].slice(0, 12);
  const kind = u => { const h = (() => { try { return new URL(u).hostname.toLowerCase(); } catch (e) { return ''; } })(); return /x\.com|twitter\.com/.test(h) ? 'x' : /t\.me|telegram/.test(h) ? 'telegram' : /discord/.test(h) ? 'discord' : /github/.test(h) ? 'github' : BIG.test(h) ? 'other' : 'website'; };
  const L = links.map(u => ({ url: u, kind: kind(u), from: onChain.includes(u) ? 'contract' : 'listing' }));
  const site = L.find(l => l.kind === 'website');
  const v = { ok: true, token, t: now, links: L, website: null, flags: [], pending: false };
  // Safe Browsing on every link
  if (env.SAFE_BROWSING_KEY && L.length) try {
    const r = await (await fetch(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${env.SAFE_BROWSING_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client: { clientId: 'shuntdesk', clientVersion: '1.0' }, threatInfo: { threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'], platformTypes: ['ANY_PLATFORM'], threatEntryTypes: ['URL'], threatEntries: L.map(l => ({ url: l.url })) } }) })).json();
    for (const m of r.matches || []) { const l = L.find(x => x.url === m.threat?.url); if (l) l.threat = m.threatType; v.flags.push({ level: 'high', text: `Google Safe Browsing lists ${m.threat?.url} as ${String(m.threatType).toLowerCase().replace(/_/g, ' ')}` }); }
  } catch (e) {}
  if (site) {
    const u = new URL(site.url), domain = u.hostname.replace(/^www\./, '');
    const w = v.website = { url: site.url, domain };
    // RDAP: when the domain was registered
    try { const j = await (await fetch(`https://rdap.org/domain/${domain}`, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(10000) })).json(); const reg = (j.events || []).find(e => e.eventAction === 'registration')?.eventDate; if (reg) { w.registered = reg; w.ageDays = Math.floor((now - Date.parse(reg)) / 86400000); if (w.ageDays < 14) v.flags.push({ level: w.ageDays < 3 ? 'high' : 'medium', text: `The website's domain was registered ${w.ageDays === 0 ? 'today' : w.ageDays + ' day' + (w.ageDays > 1 ? 's' : '') + ' ago'}` }); } } catch (e) {}
    // urlscan: an earlier scan of the domain, or a new one
    if (env.URLSCAN_API_KEY) try {
      const H = { 'API-Key': env.URLSCAN_API_KEY, 'Content-Type': 'application/json' };
      const U = st.urlscan = st.urlscan || {}, known = U[domain] && now - U[domain].t < 14 * 86400000 ? U[domain].id : null;
      let uuid = hit?.v?.website?.urlscan?.uuid || known;
      if (!uuid) { const s = await (await fetch(`https://urlscan.io/api/v1/search/?q=${encodeURIComponent('page.domain:' + domain)}&size=1`, { headers: H })).json(); const r0 = s.results?.[0]; if (r0 && now - Date.parse(r0.task?.time || 0) < 14 * 86400000) uuid = r0._id; }
      if (!uuid && st.siteDay.scans < 400) { const s = await (await fetch('https://urlscan.io/api/v1/scan/', { method: 'POST', headers: H, body: JSON.stringify({ url: site.url, visibility: 'unlisted', tags: ['shuntdesk'] }) })).json(); if (s.uuid) { uuid = s.uuid; st.siteDay.scans++; } }
      if (uuid) {
        if (!U[domain] || U[domain].id !== uuid) { U[domain] = { id: uuid, t: now }; const ks = Object.keys(U); if (ks.length > 500) delete U[ks[0]]; }
        const r = await fetch(`https://urlscan.io/api/v1/result/${uuid}/`, { headers: H });
        if (r.status === 404) { w.urlscan = { uuid, status: 'scanning' }; v.pending = true; }
        else if (r.ok) { const j = await r.json(), vd = j.verdicts?.overall || {};
          w.urlscan = { uuid, status: 'done', malicious: !!vd.malicious, score: vd.score ?? null, categories: vd.categories || [], requests: j.stats?.resourceStats?.length ?? null, screenshot: `https://urlscan.io/screenshots/${uuid}.png`, report: `https://urlscan.io/result/${uuid}/` };
          if (vd.malicious) v.flags.push({ level: 'high', text: `urlscan.io judges the website malicious${vd.categories?.length ? ' (' + vd.categories.join(', ') + ')' : ''}` }); }
      }
    } catch (e) {}
    // Jina Reader: what the page says
    if (env.JINA_API_KEY) try {
      const r = await fetch('https://r.jina.ai/' + site.url, { headers: { Authorization: 'Bearer ' + env.JINA_API_KEY }, signal: AbortSignal.timeout(20000) });
      if (r.ok) { const text = (await r.text()).slice(0, 60000), words = (text.match(/[A-Za-z]{2,}/g) || []).length, low = text.toLowerCase();
        const has = re => re.test(low);
        w.page = { title: (text.match(/^Title:\s*(.+)$/m)?.[1] || '').slice(0, 120), words,
          seed: has(/seed phrase|recovery phrase|private key|mnemonic|12 words|24 words/), connect: has(/connect (your )?wallet|walletconnect|connect metamask/), claim: has(/claim (your )?(airdrop|tokens|reward)|free (tokens|airdrop)/) };
        if (w.page.seed) v.flags.push({ level: 'high', text: 'The website asks for a seed phrase, recovery phrase or private key' });
        if (w.page.connect && w.page.claim) v.flags.push({ level: 'medium', text: 'The website asks you to connect a wallet to claim tokens' });
        if (words < 60) v.flags.push({ level: 'low', text: 'The website has next to nothing on it' });
        if (env.AI && words >= 60 && opts.summary !== false) try { const a = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', { max_tokens: 120, messages: [{ role: 'system', content: 'Say in two plain sentences what this token website says it is and what it asks the visitor to do. Facts from the text only. No opinion on the token, no advice.' }, { role: 'user', content: text.slice(0, 6000) }] }); const s = String(a?.response || '').trim(); if (s) w.page.summary = s.slice(0, 400); } catch (e) {}
      }
    } catch (e) {}
  }
  if (!L.length) v.flags.push({ level: 'low', text: 'No website or social link found for this token' });
  sites.set(token, { t: now, v }); if (sites.size > 400) sites.delete(sites.keys().next().value);
  return v;
}

// ---------- bond alerts, posted to the community group ----------
// When a Pons curve Shuntdesk has been reading crosses 85%, and when one bonds. Read from the curve, at most twelve a day.
async function bondAlerts(env, B, rows, now) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_GROUP) return;
  const day = new Date(now).toISOString().slice(0, 10); B.al = B.al?.d === day ? B.al : { d: day, n: 0 };
  for (const r of rows) {
    if (B.al.n >= 12) break;
    const h = r.h || [], a = h.find(x => now - x[0] <= 65 * 60000) || h[0], z = h.at(-1), pace = a && z && z[0] > a[0] ? (z[1] - a[1]) / ((z[0] - a[0]) / HOUR) : null;
    const age = ((r.g || now) - r.at) / HOUR, ageTxt = age < 1 ? Math.round(age * 60) + ' min' : age.toFixed(age < 10 ? 1 : 0) + ' h', sym = tgEsc(r.s || r.t0.slice(0, 8));
    const text = r.g
      ? `<b>Bonded on Pons</b> · ${sym}\n<code>${r.t0}</code>\n\nCompleted its curve ${ageTxt} after launch.\n\nhttps://shuntdesk.com/ticket/?a=${r.t0}\n\n<i>Read from the curve contract. Not advice.</i>`
      : `<b>Close to bonding</b> · ${sym}\n<code>${r.t0}</code>\n\n${r.p.toFixed(1)}% of the curve: ${r.q.toFixed(2)} of ${r.th} ${tgEsc(r.u || 'ETH')}${pace != null ? `\nLast hour ${pace >= 0 ? '+' : ''}${pace.toFixed(1)} points${pace > 0.05 ? `, about ${((100 - r.p) / pace).toFixed(1)} h to bond at that pace` : ''}` : ''}\nLaunched ${ageTxt} ago\n\nhttps://shuntdesk.com/bonds\nhttps://shuntdesk.com/ticket/?a=${r.t0}\n\n<i>Read from the curve contract. A pace is only a pace. Not advice.</i>`;
    if (await tgSend(env, env.TELEGRAM_GROUP, text).catch(() => 0) === 200) B.al.n++;
  }
}
// ================= the comeback pack: proof, launch alarms, reports, dev score, caught, will it bond, badge, weekly =================
const SHUNT = '0x7e517e779b85895894becad80c9bb69b4cb1c4d6';
// the liquidity the dev wallet added, each one checked on chain when it was added (pool, price, range, amounts)
const SHUNT_POOLS = [{ dex: 'Uniswap v4', pair: 'ETH / SHUNT', fee: '0.9%', hook: null, range: 'full range', poolId: '0x4e3eb80c7424d8b0a31e601e605033c6c9b207f652acd166d434ac08a2e7cccf', position: 3887075, eth: 0.009917, shunt: 3065658.741, startPrice: 309207317, at: '2026-10-18T18:04:13Z', tx: '0x84878f9a6a216c03277580d13880f733259f090d29caa4218d7aa9783f760390' }];
const ago = ms => { const m = ms / 60000; return m < 60 ? Math.max(1, Math.round(m)) + ' min' : m < 1440 ? (m / 60).toFixed(m < 600 ? 1 : 0) + ' h' : Math.round(m / 1440) + ' d'; };
// what the radar found on one logged token, in words: contract powers, the sell test, and the launch holdings the
// Verdict Lab shows to matter (bundles, snipers, insiders over 5%)
function radarFlags(r) {
  const P = { mint: 'can mint', upgrade: 'code can be swapped', pause: 'can freeze transfers', block: 'can block wallets', tax: 'can change the tax' };
  return [...(r.x?.h || []).map(k => P[k] || k), r.x?.p ? 'behind a proxy' : null, r.g?.hp ? 'the sell test fails' : null, r.g?.st >= 10 ? `sell tax ${r.g.st}%` : null,
    r.f?.[4] > 5 ? `bundles hold ${r.f[4].toFixed(1)}%` : null, r.f?.[3] > 5 ? `snipers hold ${r.f[3].toFixed(1)}%` : null, r.f?.[5] > 5 ? `insiders hold ${r.f[5].toFixed(1)}%` : null].filter(Boolean);
}
const lookMove = (r, k) => r[k] !== undefined && r.p0 ? (r[k] ? r[k] / r.p0 - 1 : -1) : null;

// ---------- Telegram groups that asked for the alarms: the home group, and any group whose admin sent /alarms on ----------
const alarmChats = (st, env) => [...new Set([env.TELEGRAM_GROUP, ...Object.entries(st.groups || {}).filter(([, g]) => g.on).map(([c]) => c)].filter(Boolean).map(String))];
// messages wait in a queue and go out ten a tick: one Worker run may make only so many requests, and it is shared
function tgQueue(st, chats, text) { st.tgQ = st.tgQ || []; for (const c of chats) st.tgQ.push([c, text]); if (st.tgQ.length > 300) st.tgQ = st.tgQ.slice(-300); }
async function tgFlush(st, env) { if (!st.tgQ?.length || !env.TELEGRAM_BOT_TOKEN) return; for (const [c, text] of st.tgQ.splice(0, 10)) { const s = await tgSend(env, c, text).catch(() => 0); if (s === 403 || s === 400) { if (st.groups?.[c]) st.groups[c].on = false; } } }

// ---------- Launch Alarm: each new token the radar scanned, said in the groups when it carries a flag, or reads clean ----------
async function launchAlarm(st, env, L, rows) {
  const chats = alarmChats(st, env); if (!chats.length) return;
  const day = new Date().toISOString().slice(0, 10); L.al = L.al?.d === day ? L.al : { d: day, red: 0, clean: 0 };
  let lab = null;
  for (const r of rows) {
    if (r.x === undefined || r.al) continue; r.al = 1;
    const fl = radarFlags(r), sym = tgEsc(r.s ? '$' + r.s : r.a.slice(0, 8)), age = r.c ? ago(r.t - r.c) + ' after launch' : 'soon after launch';
    const clean = !fl.length && r.x && r.g && !r.g.red && r.f[1] >= 50 && r.sc?.w && !(r.sc.f || []).length;
    let redText = null, cleanText = null;
    if (fl.length) {
      lab = lab || await labData(env).catch(() => null);
      const rule = fl.some(f => f.startsWith('bundles')) ? 'bundles' : fl.some(f => f.startsWith('snipers')) ? 'snipers' : null, R = rule && lab?.rules.find(x => x.key === rule);
      const stat = R && R.caughtThen.h24.n >= 20 ? `\nIn Shuntdesk's record, tokens with ${rule} over 5% lost half their price within a day ${Math.round(R.caughtThen.h24.rate * 100)}% of the time, against ${Math.round(R.othersThen.h24.rate * 100)}% for the rest.\n` : '';
      redText = `<b>Launch alarm</b> · ${sym}\n<code>${r.a}</code>\n\nRead ${age}:\n${fl.map(f => '• ' + tgEsc(f)).join('\n')}\n${stat}\nhttps://shuntdesk.com/ticket/?a=${r.a}\n\n<i>Findings from the chain, not a verdict on anyone. Not advice.</i>`;
    } else if (clean) cleanText = `<b>Clean read</b> · ${sym}\n<code>${r.a}</code>\n\nRead ${age}: no contract power found, the sell test passes, no bundles, snipers or insiders over 5%, a website with nothing flagged, ${r.f[1]} holders.\n\nhttps://shuntdesk.com/ticket/?a=${r.a}\n\n<i>Clean now is not clean forever. Not advice.</i>`;
    let text = null;
    if (redText && L.al.red < 15) { L.al.red++; text = redText; } else if (cleanText && L.al.clean < 6) { L.al.clean++; text = cleanText; }
    // holders who asked get theirs in their own chat, past the group's daily caps
    holderLaunch(st, r, fl, redText, cleanText);
    if (text) tgQueue(st, chats, text);
  }
}

// ---------- /report: anyone sends a token, the bot reads it, and the first reporter is kept for the spotters board ----------
async function reportToken(st, env, a, from) {
  const [x, gp, L, dl] = await Promise.all([xray(st, env, a).catch(() => null), goplus(env, a).catch(() => null), launch(env, a).catch(() => null), devLedger(env, a).catch(() => null)]);
  const sr = gp ? serverRead(gp) : null, fl = [];
  for (const p of (x?.powers || []).filter(p => p.level === 'high')) fl.push(p.what);
  for (const r of sr?.red || []) fl.push(r);
  if (L?.ok) { for (const [k, v] of [['bundles', L.bundlerPct], ['snipers', L.sniperPct], ['insiders', L.insiderPct]]) if (Number(v) > 5) fl.push(`${k} hold ${Number(v).toFixed(1)}%`); }
  if (dl?.ok) { const D = dl.ledger, got = D.bought + D.received; if (got > 0 && (D.sold + D.toWallets) / got >= 0.5) fl.push(`the launcher sold or sent away ${Math.round((D.sold + D.toWallets) / got * 100)}% of what it got`); }
  const price = L?.pool ? L.pool.quoteUsd / L.pool.tokens : Number(L?.price) || 0;
  const R = st.reports = st.reports || {}; let first = false;
  if (!R[a] && price > 0) { R[a] = { by: from.name, id: from.id, t: Date.now(), p0: price, sym: word(gp?.token_symbol || L?.symbol || '', 12) || null }; first = true; const ks = Object.keys(R); if (ks.length > 600) delete R[ks.sort((p, q) => R[p].t - R[q].t)[0]]; }
  return { fl: [...new Set(fl)], sym: word(gp?.token_symbol || L?.symbol || '', 12), first, price, L, dl };
}
// a day after a report, the token is priced again: from its curve when it is on one, else Codex. Five a tick.
async function reportJudge(st, env) {
  const R = st.reports || {}, now = Date.now();
  const due = Object.entries(R).filter(([, r]) => r.p24 === undefined && now - r.t >= 24 * HOUR).slice(0, 5);
  for (const [a, r] of due) { const L = await launch(env, a).catch(() => null); const p = L?.pool ? L.pool.quoteUsd / L.pool.tokens : L?.ok ? Number(L.price) || 0 : null; if (p !== null) r.p24 = p; else if (now - r.t > 3 * 24 * HOUR) r.p24 = 0; }
}
function spotters(st) {
  const by = {};
  for (const r of Object.values(st.reports || {})) { const b = by[r.id] = by[r.id] || { name: r.by, reports: 0, judged: 0, lostHalf: 0 }; b.reports++; if (r.p24 !== undefined) { b.judged++; if (r.p24 <= r.p0 * 0.5) b.lostHalf++; } }
  return Object.values(by).sort((a, b) => b.lostHalf - a.lostHalf || b.reports - a.reports).slice(0, 20);
}

// ---------- the launch index: every Pons launch, by the wallet that launched it ----------
// A wide log query from a Worker is turned away by the public node and slow at the index, so Shuntdesk keeps its own:
// every five minutes it reads the newest launches, and three more windows of 400,000 blocks back, until the factory's first
// block. Stored by launcher, compact: token, curve, block.
const LINDEX = 'lindex-v1'; let lindexMem = null, lindexRead = null;
const lindexLoad = async env => lindexMem || (lindexMem = await env.KV.get(LINDEX).then(s => s ? JSON.parse(s) : { by: {}, n: 0, top: 0, floor: 0 }));
export async function lindexTick(env) {
  const X = await lindexLoad(env), now = Date.now(); if (now - (X.t || 0) < 5 * 60000 - 5000) return; X.t = now;   // every five minutes: the index is a few megabytes to write
  const head = parseInt(await rpc('eth_blockNumber'), 16);
  const add = logs => { for (const l of logs) { const by = wordAddr(l.topics[3]).slice(2), tok = wordAddr(l.topics[1]).slice(2), cur = wordAddr(l.topics[2]).slice(2), b = parseInt(l.blockNumber, 16); const a = X.by[by] = X.by[by] || []; if (!a.some(x => x[0] === tok)) { a.push([tok, cur, b]); X.n++; } } };
  try {
    if (!X.top) { X.top = head - 400000; X.floor = X.top; }
    if (head > X.top) { const z = Math.min(head, X.top + 400000); add(await wideLogs(env, T_LAUNCH, X.top + 1, z)); X.top = z; }
    for (let k = 0; k < 3 && X.floor > PONS_BORN; k++) { const a0 = Math.max(PONS_BORN, X.floor - 400000); add(await wideLogs(env, T_LAUNCH, a0, X.floor - 1)); X.floor = a0; }   // three windows back a run
    X.err = null;
  } catch (e) { X.err = String(e.message || e).slice(0, 120); }
  await env.KV.put(LINDEX, JSON.stringify(X));
}
// ---------- Dev Score: every Pons launch by one wallet, and what the wallet did with each ----------
const scores = new Map(), PONS_BORN = 26841846;   // the block the Pons V2 factory was made in
export async function devScore(st, env, w) {
  const hit = scores.get(w), now = Date.now(); if (hit && now - hit.t < 30 * 60000) return hit.v;
  if (!env.BLOCKSCOUT_API_KEY) return { ok: false, why: 'not available right now' };
  const bs = async q => { const r = await fetch(`https://api.blockscout.com/4663/api?${q}&apikey=${env.BLOCKSCOUT_API_KEY}`, { headers: UA, signal: AbortSignal.timeout(12000) }); const j = await r.json(); return Array.isArray(j.result) ? j.result : []; };
  // the launches, from Shuntdesk's own launch index; it says how far back it reaches while it is still filling
  // read fresh from storage, at most a minute old: the copy in this instance's memory may be one another run is filling
  if (!lindexRead || now - lindexRead.t > 60000) lindexRead = { t: now, v: await env.KV.get(LINDEX).then(s => s ? JSON.parse(s) : { by: {}, floor: 0 }) };
  const X = lindexRead.v, mine = X.by[w.slice(2)] || [], complete = X.floor > 0 && X.floor <= PONS_BORN;
  const logs = mine.map(([tok, cur, b]) => ({ topics: [T_LAUNCH, '0x' + tok.padStart(64, '0'), '0x' + cur.padStart(64, '0')], blockNumber: hex(b) }));
  const missing = complete ? 0 : 1, diag = [];
  const reach = X.floor ? await rpc('eth_getBlockByNumber', [hex(X.floor), false]).then(b => parseInt(b.timestamp, 16) * 1000).catch(() => null) : null;  const launches = logs.map(l => ({ token: wordAddr(l.topics[1]), curve: wordAddr(l.topics[2]), b: parseInt(l.blockNumber, 16), ts: l.timeStamp })).sort((a, b) => b.b - a.b);
  // each launch's time from its own block (the node's log carries no usable time); the newest 15 only
  await Promise.all(launches.slice(0, 15).map(async x => { x.at = x.ts ? parseInt(x.ts, String(x.ts).startsWith('0x') ? 16 : 10) * 1000 : await rpc('eth_getBlockByNumber', [hex(x.b), false]).then(b => parseInt(b.timestamp, 16) * 1000).catch(() => now); }));
  const read = launches.slice(0, 15);
  const [grad, syms] = await Promise.all([multicall(read.map(x => [x.curve, SEL.grad])), multicall(read.map(x => [x.token, SEL.sym]))]);
  const per = await Promise.all(read.map(async (x, i) => {
    const txs = await bs(`module=account&action=tokentx&contractaddress=${x.token}&address=${w}&sort=asc&page=1&offset=500`).catch(() => []);
    let got = 0, sold = 0, away = 0, burned = 0, soldHour = 0, pooled = 0; const awayTo = {};
    for (const t of txs) {
      const f = String(t.from).toLowerCase(), to = String(t.to).toLowerCase(), v = Number(BigInt(t.value || '0') / 10n ** 12n) / 1e6, at = Number(t.timeStamp) * 1000;
      if (to === w) { got += v; continue; } if (f !== w) continue;
      if (to === DEAD || /^0x0{40}$/.test(to)) burned += v; else if (to === x.curve) { sold += v; if (at - x.at < HOUR) soldHour += v; } else { away += v; awayTo[to] = (awayTo[to] || 0) + v; }
    }
    // tokens sent to a contract (a pool, a locker) are liquidity, not a sale: the largest five recipients are checked for code
    for (const [a, v] of Object.entries(awayTo).sort((p, q) => q[1] - p[1]).slice(0, 5)) { const code = await rpc('eth_getCode', [a, 'latest']).catch(() => '0x'); if (code && code !== '0x' && !isDelegated(code)) { pooled += v; away -= v; } }
    const out = sold + away;
    return { token: x.token, symbol: str(syms[i]) || x.token.slice(0, 8), launched: new Date(x.at).toISOString(), bonded: !!grad[i] && BigInt(grad[i]) === 1n,
      got: Math.round(got), sold: Math.round(sold), sentAway: Math.round(away), pooled: Math.round(pooled), burned: Math.round(burned), dumped: got > 0 && out / got >= 0.5, dumpedFirstHour: got > 0 && soldHour / got >= 0.5, burnedMost: got > 0 && burned / got >= 0.5 };
  }));
  const withTokens = per.filter(p => p.got > 0), dumped = withTokens.filter(p => p.dumped).length;
  const v = { ok: true, wallet: w, partial: missing > 0, indexFrom: reach ? new Date(reach).toISOString() : null, launched: launches.length, read: per.length, held: withTokens.length, bonded: per.filter(p => p.bonded).length, dumped, dumpedFirstHour: withTokens.filter(p => p.dumpedFirstHour).length,
    burnedMost: withTokens.filter(p => p.burnedMost).length, score: withTokens.length ? Math.round((1 - dumped / withTokens.length) * 100) : null, launches: per,
    note: 'Every Pons launch by this wallet, from the factory log; the newest 15 read in full. A launch counts as dumped when the wallet sold into the curve or sent to other wallets half or more of what it got; tokens added to a pool or another contract count as liquidity, not as a sale. The score is the share of its launches it did not dump. Read only, from the chain index. Not advice.' };
  // a partial read is kept three minutes, a full one thirty
  scores.set(w, { t: v.partial ? now - 27 * 60000 : now, v }); if (scores.size > 200) scores.delete(scores.keys().next().value);
  return v;
}

// ---------- Caught before the dump: what the radar flagged that then lost half, and what it missed ----------
async function caughtView(env) {
  const L = await looksLoad(env), now = Date.now();
  const scanned = L.rows.filter(r => r.x !== undefined), judged = scanned.filter(r => lookMove(r, 'p1') !== null || lookMove(r, 'p24') !== null);
  const worst = r => Math.min(...['p1', 'p24'].map(k => lookMove(r, k)).filter(v => v !== null));
  const row = r => ({ token: r.a, symbol: r.s, launched: r.c ? new Date(r.c).toISOString() : null, read: new Date(r.t).toISOString(), flags: radarFlags(r), move1h: lookMove(r, 'p1'), move24h: lookMove(r, 'p24'), worst: worst(r) });
  const flagged = judged.filter(r => radarFlags(r).length), clean = judged.filter(r => !radarFlags(r).length);
  const caught = flagged.filter(r => worst(r) <= -0.5), missed = clean.filter(r => worst(r) <= -0.5);
  const week = s => s.filter(r => now - r.t < 7 * 24 * HOUR).length;
  return { ok: true, scanned: scanned.length, judged: judged.length, flagged: flagged.length, caught: caught.length, clean: clean.length, missed: missed.length,
    week: { flagged: week(flagged), caught: week(caught), missed: week(missed) },
    caughtRows: caught.sort((a, b) => b.t - a.t).slice(0, 60).map(row), missedRows: missed.sort((a, b) => b.t - a.t).slice(0, 30).map(row),
    note: 'Every new token the radar scanned, 30 to 90 minutes after launch, and its price an hour and a day later. Caught: it carried a flag when scanned and then lost half or more. Missed: it carried none and lost half anyway. A token with no price later counts as lost. Findings, not verdicts on anyone. Not advice.' };
}

// ---------- Will it bond?: five open Pons curves a day; call each one before 12:00 UTC, the chain answers at midnight ----------
async function bondGame(st, env) {
  const G = st.bg = st.bg || { hist: [] }, now = Date.now(), d = new Date(now).toISOString().slice(0, 10);
  // the day that ended: did each curve bond before midnight UTC?
  if (G.day && G.day.d !== d && !G.day.res) {
    const B = await bondsLoad(env), end = Date.parse(G.day.d + 'T00:00:00Z') + 24 * HOUR;
    const res = await Promise.all(G.day.tokens.map(async t => { const r = B.rows.find(x => x.t0 === t.t); const gt = B.ga?.[t.t] || r?.g; if (gt) return gt <= end; const c = await ponsCurve(t.t).catch(() => null); return c ? c.graduated : false; }));
    const board = {}; for (const [h, e] of Object.entries(G.day.picks)) board[h] = e.p.reduce((s, v, i) => s + (v === res[i] ? 1 : 0), 0);
    G.hist.unshift({ d: G.day.d, tokens: G.day.tokens, res, board }); G.hist = G.hist.slice(0, 14); G.day.res = res;
  }
  if (!G.day || G.day.d !== d) {
    const v = await bondView(env).catch(() => null);
    const pool = (v?.rows || []).filter(r => r.progress >= 20 && r.progress <= 80 && r.unit === 'ETH' && Date.now() - Date.parse(r.launched) < 3 * 24 * HOUR);
    G.day = { d, tokens: pool.slice(0, 5).map(r => ({ t: r.token, s: r.symbol, p0: r.progress })), picks: {} };
  }
  return G;
}
function bondGameView(st, me, B) {
  const G = st.bg || {}, day = G.day; if (!day) return { ok: false, why: 'not set yet' };
  const closes = Date.parse(day.d + 'T12:00:00Z'), live = t => B?.rows.find(r => r.t0 === t.t);
  const week = {}; for (const h of (G.hist || []).slice(0, 7)) for (const [k, p] of Object.entries(h.board)) week[k] = (week[k] || 0) + p;
  return { ok: true, day: day.d, closes: new Date(closes).toISOString(), open: Date.now() < closes, resolves: new Date(Date.parse(day.d + 'T00:00:00Z') + 24 * HOUR).toISOString(),
    tokens: day.tokens.map(t => { const r = live(t); return { token: t.t, symbol: t.s, startProgress: t.p0, progress: r ? Math.round((r.p || 0) * 10) / 10 : null, bonded: !!r?.g }; }),
    players: Object.keys(day.picks).length, mine: me && day.picks[me] ? day.picks[me].p : null,
    yesterday: G.hist?.[0] ? { day: G.hist[0].d, tokens: G.hist[0].tokens.map((t, i) => ({ symbol: t.s, token: t.t, bonded: G.hist[0].res[i] })), mine: me ? G.hist[0].board[me] ?? null : null, players: Object.keys(G.hist[0].board).length } : null,
    board: Object.entries(week).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([h, pts]) => ({ handle: h, pts })),
    note: 'Five open Pons curves a day, between 20% and 80%. Call each one, bond or no bond, before 12:00 UTC; at midnight UTC the curve contracts answer. One point a right call, the board counts the last seven days. No money and no prize. Not advice.' };
}
function bondGamePlay(st, body) {
  const h = String(body?.handle || '').trim().toLowerCase(); if (!/^[a-z0-9_]{2,16}$/.test(h)) return [400, { ok: false, why: 'handle must be 2 to 16 letters, digits or _' }];
  const day = st.bg?.day; if (!day || !day.tokens.length) return [400, { ok: false, why: 'today\'s curves are not set yet' }];
  if (Date.now() >= Date.parse(day.d + 'T12:00:00Z')) return [400, { ok: false, why: 'calls for today closed at 12:00 UTC' }];
  if (day.picks[h]) return [409, { ok: false, why: 'already called today' }];
  const p = Array.isArray(body.picks) ? body.picks.map(v => v === true) : []; if (p.length !== day.tokens.length) return [400, { ok: false, why: 'call every curve' }];
  day.picks[h] = { p, t: Date.now() }; if (Object.keys(day.picks).length > 2000) return [400, { ok: false, why: 'full today' }];
  return [200, { ok: true }];
}

// ---------- the badge: a small image any site can show, the token's latest Shuntdesk read ----------
async function badgeSvg(st, env, a) {
  const v = st.verdicts.find(x => x.addr === a), dl = await devLedger(env, a).catch(() => null), c = await ponsCurve(a).catch(() => null);
  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const col = v ? { CLEAN: '#2ed3a0', RISKY: '#e8c35a', DANGER: '#ff4d5e' }[v.verdict] : '#8d8b86';
  const L = dl?.ok ? dl.ledger : null, got = L ? L.bought + L.received : 0;
  const line2 = [L ? (got > 0 ? `dev sold ${Math.round((L.sold + L.toWallets) / got * 100)}% · burned ${Math.round(L.burned / got * 100)}%` : 'dev never held it') : null, c && !c.graduated ? `curve ${Math.round(c.progress)}%` : c?.graduated ? 'bonded' : null].filter(Boolean).join(' · ') || 'read from the chain';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="340" height="64" viewBox="0 0 340 64"><rect width="340" height="64" rx="10" fill="#060708" stroke="#2b2d30"/><path d="M14 52V38.6L27.2 28.1V21L30.1 18H34.3V31.4L21.1 41.9V49L18.2 52Z" fill="#edebe6"/><text x="46" y="24" font-family="Arial,Helvetica,sans-serif" font-size="10" letter-spacing="1.6" fill="#8d8b86">SCANNED BY SHUNTDESK</text><text x="46" y="42" font-family="Arial,Helvetica,sans-serif" font-size="15" font-weight="700" fill="${col}">${esc(v ? `${v.verdict} ${v.score}` : 'NO VERDICT YET')}</text><text x="46" y="56" font-family="Arial,Helvetica,sans-serif" font-size="10" fill="#bdbbb6">${esc(line2)}</text></svg>`;
}

// ---------- the weekly card's numbers ----------
async function weeklyData(st, env) {
  const [bw, ca, lab, dl] = await Promise.all([bondView(env).catch(() => null), caughtView(env).catch(() => null), labData(env).catch(() => null), devLedger(env, SHUNT).catch(() => null)]);
  const now = Date.now(), wk = 7 * 24 * HOUR, burns = (dl?.burns?.last || []).filter(b => now - Date.parse(b.at) < wk);
  const top = (lab?.rules || []).filter(r => r.lift24h != null && r.key !== 'oncurve').sort((a, b) => b.lift24h - a.lift24h)[0];
  const rep = Object.values(st.reports || {}).filter(r => now - r.t < wk), sp = spotters(st)[0];
  return { ok: true, read: new Date(now).toISOString(), pons: bw ? { launched: bw.week.launched, bonded: bw.week.bonded, rate: bw.week.rate } : null,
    radar: ca ? { flagged: ca.week.flagged, caught: ca.week.caught, missed: ca.week.missed } : null,
    lab: top ? { rule: top.rule, rate: top.caughtThen.h24.rate, others: top.othersThen.h24.rate, lift: top.lift24h } : null,
    shunt: dl?.ok ? { burnedWeek: Math.round(burns.reduce((s, b) => s + b.amount, 0)), burnsWeek: burns.length, burnedAll: Math.round(dl.burns.total), sold: dl.ledger.sold } : null,
    reports: { week: rep.length, topSpotter: sp && sp.lostHalf ? sp : null } };
}

// ================= $SHUNT holders: a wallet tied to a Telegram chat by a signature, its balance read from the chain =================
const HOLD_MIN = 1000000, BOOST_MIN = 500000, HOLD_TRIP = 25;
// secp256k1, only what is needed to find who signed a personal_sign message (no key ever touches the server)
const SP = 2n ** 256n - 2n ** 32n - 977n, SN = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
const GX = 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798n, GY = 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8n;
const md = (a, m = SP) => ((a % m) + m) % m;
const mpow = (b, e, m) => { let r = 1n; b = md(b, m); while (e > 0n) { if (e & 1n) r = r * b % m; b = b * b % m; e >>= 1n; } return r; };
const minv = (a, m) => mpow(a, m - 2n, m);
const jdbl = ([X, Y, Z]) => { if (Z === 0n || Y === 0n) return [0n, 1n, 0n]; const YY = md(Y * Y), S = md(4n * X * YY), M = md(3n * X * X), X2 = md(M * M - 2n * S); return [X2, md(M * (S - X2) - 8n * YY * YY), md(2n * Y * Z)]; };
function jadd(P, Q) {
  if (P[2] === 0n) return Q; if (Q[2] === 0n) return P;
  const [X1, Y1, Z1] = P, [X2, Y2, Z2] = Q, Z1s = md(Z1 * Z1), Z2s = md(Z2 * Z2), U1 = md(X1 * Z2s), U2 = md(X2 * Z1s), S1 = md(Y1 * Z2s * Z2), S2 = md(Y2 * Z1s * Z1);
  if (U1 === U2) return S1 === S2 ? jdbl(P) : [0n, 1n, 0n];
  const H = md(U2 - U1), R = md(S2 - S1), H2 = md(H * H), H3 = md(H2 * H), U1H2 = md(U1 * H2), X3 = md(R * R - H3 - 2n * U1H2);
  return [X3, md(R * (U1H2 - X3) - S1 * H3), md(H * Z1 * Z2)];
}
const jmul = (P, k) => { let R = [0n, 1n, 0n], A = P; while (k > 0n) { if (k & 1n) R = jadd(R, A); A = jdbl(A); k >>= 1n; } return R; };
// the public key behind a signature over a 32-byte digest, as an address; null when the signature does not hold up
export function ecrecoverDigest(digestHex, sigHex) {
  const s0 = String(sigHex).replace(/^0x/, ''); if (s0.length < 130) return null;
  const r = BigInt('0x' + s0.slice(0, 64)), s = BigInt('0x' + s0.slice(64, 128)); let v = parseInt(s0.slice(128, 130), 16); if (v >= 27) v -= 27;
  if (r <= 0n || r >= SN || s <= 0n || s >= SN || (v !== 0 && v !== 1)) return null;
  const y2 = md(r * r * r + 7n); let y = mpow(y2, (SP + 1n) / 4n, SP); if (md(y * y) !== y2) return null; if ((y & 1n) !== BigInt(v)) y = SP - y;
  const e = BigInt('0x' + String(digestHex).replace(/^0x/, '')), ri = minv(r, SN);
  const Q = jadd(jmul([GX, GY, 1n], md(-e * ri, SN)), jmul([r, y, 1n], md(s * ri, SN))); if (Q[2] === 0n) return null;
  const zi = minv(Q[2], SP), zi2 = md(zi * zi), qx = md(Q[0] * zi2), qy = md(Q[1] * zi2 * zi);
  return '0x' + keccak256(qx.toString(16).padStart(64, '0') + qy.toString(16).padStart(64, '0')).slice(24);
}
// what personal_sign signs: the Ethereum prefix, the length in bytes, the message
export function personalDigest(msg) { const b = [...new TextEncoder().encode(msg)], pre = [...new TextEncoder().encode('\x19Ethereum Signed Message:\n' + b.length)]; return keccak256([...pre, ...b].map(x => x.toString(16).padStart(2, '0')).join('')); }
export const holderMessage = code => `Shuntdesk holder link\nCode: ${code}\n\nSigning this proves you hold this wallet. It moves nothing and costs nothing.`;
async function shuntBalance(w) { const r = await contractCall(SHUNT, '70a08231' + w.slice(2).padStart(64, '0')).catch(() => null); return r ? Number(BigInt(r) / 10n ** 15n) / 1e3 : null; }
const isHolder = (st, chat) => { const h = st.holders?.[String(chat)]; return !!h && h.bal >= HOLD_MIN; };
// a link code from the bot, then the signature from the page: the chat gets the wallet, the wallet's balance decides
async function holderVerify(st, env, b) {
  const code = String(b?.code || ''), w = String(b?.address || '').toLowerCase(), L = st.links?.[code];
  if (!L || Date.now() - L.t > 30 * 60000) return [400, { ok: false, why: 'this link has run out: send /link to the bot again' }];
  if (!isAddr(w)) return [400, { ok: false, why: 'no wallet' }];
  const who = ecrecoverDigest(personalDigest(holderMessage(code)), b?.sig);
  if (who !== w) return [400, { ok: false, why: 'the signature is not from that wallet' }];
  const bal = await shuntBalance(w); if (bal === null) return [502, { ok: false, why: 'the chain did not answer, try again' }];
  const H = st.holders = st.holders || {}; const prev = H[L.chat] || {};
  H[L.chat] = { ...prev, w, bal, t: Date.now(), f: prev.f || { clean: true, flags: false, curve: [] } };
  delete st.links[code];
  const ok = bal >= HOLD_MIN, n = v => Math.round(v).toLocaleString('en-US');
  await tgSend(env, L.chat, ok ? `<b>Holder linked</b> · <code>${w.slice(0, 6)}…${w.slice(-4)}</code>\n${n(bal)} $SHUNT\n\nTier: <b>${tierOf(bal)}</b>\n\nYours now:\n• personal alarms in this chat: /alarm\n• trusted devs and known dumpers launching, in this chat\n• Tripwire for up to ${HOLD_TRIP} tokens: /watch\n• burn to boost a full scan: /boost\n${bal >= HOLD_PRO ? '• Early Radar: clean Pons launches, minutes old\n' : `• Early Radar opens at ${HOLD_PRO.toLocaleString('en-US')} $SHUNT (Pro)\n`}\nThe balance is read again every few hours.` : `<b>Wallet linked</b> · <code>${w.slice(0, 6)}…${w.slice(-4)}</code>\n${n(bal)} $SHUNT. The holder tools open at ${n(HOLD_MIN)} $SHUNT.`).catch(() => 0);
  return [200, { ok: true, holder: ok, balance: bal, min: HOLD_MIN }];
}
// balances are read again, five chats a tick, every six hours
async function holderRefresh(st) { const now = Date.now(); for (const h of Object.values(st.holders || {}).filter(h => now - h.t > 6 * HOUR).slice(0, 5)) { const b = await shuntBalance(h.w); if (b !== null) { h.bal = b; h.t = now; } } }
// a holder's own alarms: queued for its chat, at most forty a day
function holderSend(st, chat, text) { const h = st.holders[chat], d = new Date().toISOString().slice(0, 10); h.n = h.d === d ? h.n || 0 : 0; h.d = d; if (h.n >= 40) return; h.n++; tgQueue(st, [chat], text); }
function holderLaunch(st, r, fl, redText, cleanText) {
  for (const [chat, h] of Object.entries(st.holders || {})) { if (h.bal < HOLD_MIN || !h.f) continue; if (fl.length && h.f.flags && redText) holderSend(st, chat, redText); else if (!fl.length && h.f.clean && cleanText) holderSend(st, chat, cleanText); }
}
// curves crossing a holder's own marks, read from Bond Watch's last two reads of each curve
async function holderCurves(st, env) {
  const hs = Object.entries(st.holders || {}).filter(([, h]) => h.bal >= HOLD_MIN && h.f?.curve?.length); if (!hs.length) return;
  const B = await bondsLoad(env); if (st.hcT === B.t) return; st.hcT = B.t;
  for (const r of B.rows.filter(r => !r.g && (r.h || []).length >= 2)) {
    const a = r.h.at(-2)[1], z = r.h.at(-1)[1];
    for (const [chat, h] of hs) for (const m of h.f.curve) if (a < m && z >= m) { const k = r.t0 + ':' + m; h.sent = h.sent || {}; if (h.sent[k]) continue; h.sent[k] = 1;
      holderSend(st, chat, `<b>Your alarm · curve past ${m}%</b> · ${tgEsc(r.s || r.t0.slice(0, 8))}\n<code>${r.t0}</code>\n\n${z.toFixed(1)}% of the curve: ${(r.q || 0).toFixed(2)} of ${r.th} ${tgEsc(r.u || 'ETH')}\n\nhttps://shuntdesk.com/ticket/?a=${r.t0}\n<i>Read from the curve contract. Not advice.</i>`); }
    for (const [, h] of hs) if (h.sent && Object.keys(h.sent).length > 400) h.sent = {};
  }
}
// burn to boost: a burn of $SHUNT to the dead address, sent with a token, buys that token a full scan said in the groups
async function boostToken(st, env, token, tx, from) {
  const B = st.boosts = st.boosts || {}; if (B[tx]) return { ok: false, why: 'that burn has already boosted a token' };
  const rc = await rpc('eth_getTransactionReceipt', [tx]).catch(() => null); if (!rc || rc.status !== '0x1') return { ok: false, why: 'that transaction is not on chain, or it failed' };
  const TR = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', dead = '0x' + DEAD.slice(2).padStart(64, '0');
  const burned = rc.logs.filter(l => l.address.toLowerCase() === SHUNT && l.topics[0] === TR && l.topics[2]?.toLowerCase() === dead).reduce((s, l) => s + Number(BigInt(l.data) / 10n ** 15n) / 1e3, 0);
  if (burned < BOOST_MIN) return { ok: false, why: `that transaction burns ${Math.round(burned).toLocaleString('en-US')} $SHUNT; a boost takes ${BOOST_MIN.toLocaleString('en-US')} sent to 0x…dEaD` };
  const blk = await rpc('eth_getBlockByNumber', [rc.blockNumber, false]).catch(() => null); if (blk && Date.now() - parseInt(blk.timestamp, 16) * 1000 > 48 * HOUR) return { ok: false, why: 'that burn is older than two days' };
  B[tx] = { token, by: from, t: Date.now(), burned }; const ks = Object.keys(B); if (ks.length > 2000) delete B[ks[0]];
  const [x, sc, dl, L] = await Promise.all([xray(st, env, token).catch(() => null), siteCheck(st, env, token, [], { summary: false }).catch(() => null), devLedger(env, token).catch(() => null), launch(env, token).catch(() => null)]);
  const ds = dl?.ok ? await devScore(st, env, dl.dev).catch(() => null) : null;
  const D = dl?.ok ? dl.ledger : null, got = D ? D.bought + D.received : 0, pc = v => got > 0 ? Math.round(v / got * 100) + '%' : '0%', n = v => Math.round(v).toLocaleString('en-US');
  const powers = (x?.powers || []).filter(p => p.level === 'high').map(p => p.what);
  const lines = [
    `<b>Boosted scan</b> · ${tgEsc(L?.symbol ? '$' + L.symbol : token.slice(0, 8))}`, `<code>${token}</code>`, '',
    x?.ok ? `Contract: ${x.functions} functions, ${powers.length ? 'powers: ' + tgEsc(powers.join(', ')) : 'none that mint, pause, block wallets or change the tax'}${x.proxy ? ', behind a proxy' : ''}` : 'Contract: could not be read',
    L?.ok && L.launchpad ? `Launch: ${L.launchpad === 'pons' ? 'Pons' : tgEsc(L.launchpad)}${L.graduated ? ', bonded' : L.progress != null ? `, ${Math.round(L.progress)}% of the curve` : ''} · bundles ${pct(L.bundlerPct)} · snipers ${pct(L.sniperPct)}` : null,
    D ? `Dev wallet: sold ${pc(D.sold)}, sent to wallets ${pc(D.toWallets)}, burned ${pc(D.burned)}, holds ${n(dl.holdsNow ?? 0)}` : null,
    ds?.ok && ds.launched ? `Dev Score: ${ds.score ?? '—'} · ${ds.launched} launches, ${ds.dumped} dumped${ds.dumpedFirstHour ? `, ${ds.dumpedFirstHour} in the first hour` : ''}` : null,
    sc?.ok ? (sc.flags.filter(f => f.level !== 'low').length ? `Site: ${tgEsc(sc.flags.filter(f => f.level !== 'low').map(f => f.text).slice(0, 2).join('; '))}` : sc.website ? 'Site: nothing flagged' : 'Site: no website found') : null,
    '', `Boosted by ${tgEsc(from)}, who burned ${n(burned)} $SHUNT: https://robinhoodchain.blockscout.com/tx/${tx}`, `https://shuntdesk.com/ticket/?a=${token}`, '<i>Findings from the chain, not a verdict on anyone. Not advice.</i>'].filter(l => l !== null);
  const text = lines.join('\n'); tgQueue(st, alarmChats(st, env), text);
  return { ok: true, text };
}

// ---------- Early Radar (Pro holders) and Trusted Dev Alert (all holders): new Pons launches, read minutes after launch ----------
// A minute's launches from the factory log go in a queue; three minutes after each launch the contract, the sell test,
// the curve and the launcher's record are read, two a minute. A launcher with two or more launches before gets its
// Dev Score (one a minute, kept six hours): a clean record or a record of dumping is said to the holders who asked.
const HOLD_PRO = 5000000;
const tierOf = bal => bal >= HOLD_PRO ? 'Pro' : bal >= HOLD_MIN ? 'Holder' : null;
export async function earlyFeed(st, env) {
  if (!Object.values(st.holders || {}).some(h => h.bal >= HOLD_MIN)) return;   // nobody to tell
  const E = st.early = st.early || { block: 0, q: [], t: 0 }, now = Date.now(); if (now - E.t < 55000) return; E.t = now;
  const head = parseInt(await rpc('eth_blockNumber'), 16), from = E.block ? E.block + 1 : head - 1200; if (from > head) return;
  const logs = await wideLogs(env, T_LAUNCH, from, Math.min(head, from + 20000)); E.block = Math.min(head, from + 20000);
  for (const l of logs) E.q.push({ t: wordAddr(l.topics[1]), c: wordAddr(l.topics[2]), by: wordAddr(l.topics[3]), at: logTime(l, now, head) });
  E.q = E.q.filter(x => now - x.at < 30 * 60000).slice(-80);
}
export async function earlyTick(st, env) {
  const E = st.early; if (!E?.q?.length) return;
  const now = Date.now(), due = E.q.filter(x => now - x.at >= 3 * 60000).slice(0, 2); let scored = false;
  for (const x of due) { E.q = E.q.filter(y => y !== x); scored = await earlyRead(st, env, x, !scored).catch(() => scored) || scored; }
}
async function earlyRead(st, env, x, mayScore) {
  const [xr, gp, c, sy] = await Promise.all([xray(st, env, x.t).catch(() => null), goplus(env, x.t).catch(() => null), ponsCurve(x.t).catch(() => null), contractCall(x.t, SEL.sym).catch(() => null)]);
  const sym = tgEsc(str(sy) ? '$' + str(sy) : x.t.slice(0, 8)), mins = Math.max(1, Math.round((Date.now() - x.at) / 60000)), sr = gp ? serverRead(gp) : null;
  if (!lindexRead || Date.now() - lindexRead.t > 60000) lindexRead = { t: Date.now(), v: await env.KV.get(LINDEX).then(s => s ? JSON.parse(s) : { by: {} }) };
  const prior = (lindexRead.v.by[x.by.slice(2)] || []).filter(([tok]) => tok !== x.t.slice(2)).length;
  const R = st.devRec = st.devRec || {}; let rec = R[x.by] && Date.now() - R[x.by].t < 6 * HOUR ? R[x.by] : null, scored = false;
  if (!rec && prior >= 2 && mayScore) { const d = await devScore(st, env, x.by).catch(() => null); if (d?.ok) { rec = R[x.by] = { t: Date.now(), score: d.score, launched: d.launched, held: d.held, dumped: d.dumped, dfh: d.dumpedFirstHour, bonded: d.bonded }; scored = true; const ks = Object.keys(R); if (ks.length > 500) delete R[ks[0]]; } }
  const powers = (xr?.powers || []).filter(p => p.level === 'high').map(p => p.what), flags = [...powers, ...(sr?.red || [])];
  const who = rec ? `${rec.launched} Pons launches, ${rec.dumped} dumped${rec.dfh ? ` (${rec.dfh} in the first hour)` : ''}, ${rec.bonded} bonded · Dev Score ${rec.score ?? '—'}` : prior ? `${prior} Pons launch${prior > 1 ? 'es' : ''} before this one` : 'its first Pons launch on record';
  const link = `https://shuntdesk.com/ticket/?a=${x.t}`;
  const early = `<b>Early read</b> · ${sym} · ${mins} min after launch\n<code>${x.t}</code>\n\n${flags.length ? `Found:\n${flags.slice(0, 6).map(f => '• ' + tgEsc(f)).join('\n')}` : xr?.ok ? 'No function that mints, pauses, blocks wallets or changes the tax.' + (sr ? ' The sell test passes.' : ' The security read is not ready yet.') : 'The contract could not be read yet.'}\n${c ? `Curve ${c.progress.toFixed(1)}%: ${c.raised.toFixed(3)} of ${c.need} ETH\n` : ''}Launcher <code>${x.by.slice(0, 6)}…${x.by.slice(-4)}</code>: ${who}\n\n${link}\n<i>An early read is only that: holders, bundles and the website come later. Not advice.</i>`;
  const trusted = rec && rec.held >= 3 && rec.dumped === 0 && (rec.score ?? 0) >= 80, dumper = rec && rec.dfh >= 1;
  const devText = trusted ? `<b>Trusted dev launched</b> · ${sym}\n<code>${x.t}</code>\n\nThe launcher <code>${x.by.slice(0, 6)}…${x.by.slice(-4)}</code> has ${rec.launched} Pons launches on record and dumped none of them; ${rec.bonded} bonded. Dev Score ${rec.score}.\n\n${link}\nshuntdesk.com/dev/?w=${x.by}\n<i>A clean past is not a promise. Not advice.</i>`
    : dumper ? `<b>Known dumper launched</b> · ${sym}\n<code>${x.t}</code>\n\nThe launcher <code>${x.by.slice(0, 6)}…${x.by.slice(-4)}</code> has ${rec.launched} Pons launches on record: ${rec.dumped} dumped, ${rec.dfh} within the first hour. Dev Score ${rec.score ?? '—'}.\n\n${link}\nshuntdesk.com/dev/?w=${x.by}\n<i>From the chain, not a verdict on anyone. Not advice.</i>` : null;
  // the last twenty reads, kept to see what the radar saw and why it spoke or stayed quiet
  st.earlyLast = [{ t: x.t, sym: str(sy) || null, min: mins, flags: flags.length, read: !!xr?.ok, sell: !!sr, curve: c ? Math.round(c.progress * 10) / 10 : null, prior, rec: rec ? { score: rec.score, launched: rec.launched, dumped: rec.dumped } : null, early: !flags.length && !!xr?.ok && !!c && c.progress >= 3, dev: trusted ? 'trusted' : dumper ? 'dumper' : null }, ...(st.earlyLast || [])].slice(0, 20);
  for (const [chat, h] of Object.entries(st.holders || {})) {
    // an early read goes out only for a launch with nothing found and buyers already in: a hundred launch an hour
    if (h.bal >= HOLD_PRO && h.f?.early !== false && !flags.length && xr?.ok && c && c.progress >= 3) holderSend(st, chat, early);
    if (devText && h.bal >= HOLD_MIN && h.f?.dev !== false) holderSend(st, chat, devText);
  }
  return scored;
}

// ---------- the daily line, posted to the community group at 13:00 UTC ----------
// The site's own numbers for the last day, so the group hears from the line every day: the crew desk, the calls,
// what the radar found, and the Pons curves closest to bonding. Once a day, nothing invented.
async function groupDigest(st, env) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_GROUP) return;
  const now = new Date(), day = now.toISOString().slice(0, 10);
  if (now.getUTCHours() < 13 || st.digestDay === day) return;
  st.digestDay = day;
  const r = report(st), rd = await radarView(env).catch(() => null), bw = await bondView(env).catch(() => null);
  const near = (bw?.rows || []).slice(0, 3).map(b => `${tgEsc(b.symbol)} ${b.progress}%`).join(' · ');
  // the radar's day before yesterday, now that a day has passed: what it flagged, and how many of those lost half
  const LK = await looksLoad(env).catch(() => null), now0 = Date.now(), win = (LK?.rows || []).filter(x => x.x !== undefined && now0 - x.t >= 24 * HOUR && now0 - x.t < 48 * HOUR && lookMove(x, 'p24') !== null);
  const fl = win.filter(x => radarFlags(x).length), lost = fl.filter(x => lookMove(x, 'p24') <= -0.5), miss = win.filter(x => !radarFlags(x).length && lookMove(x, 'p24') <= -0.5);
  const caughtLine = fl.length ? `<b>Caught</b> ${fl.length} flagged a day ago, ${lost.length} of them lost half since${miss.length ? ` · ${miss.length} with no flag lost half too` : ''}\n` : '';
  const reps = Object.values(st.reports || {}).filter(x => now0 - x.t < 24 * HOUR).length, game = st.bg?.hist?.[0];
  const extra = `${reps ? `<b>Reports</b> ${reps} tokens sent with /report in the last day\n` : ''}${game && game.d === new Date(now0 - 24 * HOUR).toISOString().slice(0, 10) ? `<b>Will it bond?</b> ${game.res.filter(Boolean).length} of ${game.res.length} bonded yesterday, ${Object.keys(game.board).length} played\n` : ''}`;
  const y = bw?.days?.at(-2);
  const text = `<b>The daily line</b> · ${day}\n\n<b>Crew desk</b> ${money(r.equity)} paper USDG (${r.change >= 0 ? '+' : ''}${money(r.change)} in 24h)\n<b>Calls</b> ${r.verdicts.CLEAN} clean · ${r.verdicts.RISKY} risky · ${r.verdicts.DANGER} danger${r.judged ? `, ${r.held} of ${r.judged} held an hour later` : ''}\n${rd ? `<b>Radar</b> ${rd.scanned} new tokens scanned so far, ${rd.flagged} with a flag\n` : ''}${y ? `<b>Pons</b> ${y.l.toLocaleString('en-US')} launched yesterday, ${y.g} bonded\n` : ''}${near ? `<b>Closest to bonding</b> ${near}\n` : ''}${caughtLine}${extra}\nshuntdesk.com/caught · shuntdesk.com/bonds · shuntdesk.com/bond-game\n\n<i>The site's own figures. Not advice.</i>`;
  await tgSend(env, env.TELEGRAM_GROUP, text).catch(() => 0);
}

// ---------- Wallet X-ray: what a wallet holds, read only ----------
// Every ERC-20 a wallet holds (the keyed Blockscout index), with what Shuntdesk already knows of each: the verdict
// on file, where it stands on the Pons curve, and whether it copies the name of a real token from another address
// (a USDG or a stock ticker that is not the real contract). Prices and the way out are worked in the browser.
const REAL = { USDG: USDG, WETH: WETH, NVDA: '0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec', TSLA: '0x322f0929c4625ed5bad873c95208d54e1c003b2d', AAPL: '0xaf3d76f1834a1d425780943c99ea8a608f8a93f9', META: '0xc0d6457c16cc70d6790dd43521c899c87ce02f35', GOOGL: '0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3', AMZN: '0x12f190a9f9d7d37a250758b26824b97ce941bf54', MSFT: '0xe93237c50d904957cf27e7b1133b510c669c2e74', AMD: '0x86923f96303d656e4aa86d9d42d1e57ad2023fdc', COIN: '0x6330d8c3178a418788df01a47479c0ce7ccf450b', PLTR: '0x894e1ec2d74ffe5aef8dc8a9e84686accb964f2a', MSTR: '0xec262a75e413fafd0df80480274532c79d42da09', SPY: '0x117cc2133c37b721f49de2a7a74833232b3b4c0c', QQQ: '0xd5f3879160bc7c32ebb4dc785f8a4f505888de68', SHUNT: '0x7e517e779b85895894becad80c9bb69b4cb1c4d6' };
async function walletView(st, env, w) {
  if (!env.BLOCKSCOUT_API_KEY) return { ok: false, why: 'not available right now' };
  const j = await (await fetch(`https://api.blockscout.com/4663/api?module=account&action=tokenlist&address=${w}&apikey=${env.BLOCKSCOUT_API_KEY}`, { headers: UA, signal: AbortSignal.timeout(12000) })).json();
  if (!Array.isArray(j.result)) return j.message === 'No tokens found' ? { ok: true, wallet: w, tokens: [] } : { ok: false, why: 'the explorer did not answer' };
  const B = await bondsLoad(env), eth = await ethUsd().catch(() => 0);
  const tokens = j.result.filter(t => /20/.test(t.type || '') && BigInt(t.balance || '0') > 0n).slice(0, 80).map(t => {
    const a = String(t.contractAddress).toLowerCase(), sym = word(t.symbol, 14), real = REAL[String(t.symbol || '').toUpperCase()];
    const v = st.verdicts.find(x => x.addr === a), b = B.rows.find(r => r.t0 === a), x = xrays.get(a)?.v;
    return { token: a, symbol: sym, name: word(t.name, 30), decimals: Number(t.decimals) || 0, balance: String(t.balance),
      impostor: !!real && real !== a ? real : null,
      verdict: v ? { verdict: v.verdict, score: v.score, at: new Date(v.t).toISOString(), after1h: v.p1h && v.p0 ? v.p1h / v.p0 - 1 : null } : null,
      // a token still on its curve has no market price elsewhere: the curve itself prices it and takes the sale
      curve: b ? { progress: Math.round((b.p || 0) * 10) / 10, bonded: !!b.g, pool: !b.g && b.u === 'ETH' && b.vq && b.vt && b.fee != null && eth ? { quoteUsd: b.vq * eth, tokens: b.vt, realUsd: (b.q || 0) * eth, fee: b.fee } : null } : null,
      powers: x ? x.powers.filter(p => p.level === 'high').map(p => p.what) : null };
  });
  return { ok: true, wallet: w, tokens, note: 'Read only. Balances from the explorer; nothing is connected or signed. Not advice.' };
}

// ---------- stock tokens against the stock itself ----------
// The reference is Yahoo Finance's public chart feed: the last regular close and the latest trade in any session
// (pre-market and after-hours included). It can lag by a few minutes. The chain prices are read in the browser.
const STOCK_SYMS = ['NVDA', 'TSLA', 'AAPL', 'META', 'GOOGL', 'AMZN', 'MSFT', 'AMD', 'COIN', 'PLTR', 'MSTR', 'SPY', 'QQQ'];
let stockMem = { t: 0, v: null };
async function stockRefs() {
  const now = Date.now(); if (stockMem.v && now - stockMem.t < 60000) return stockMem.v;
  const rows = {};
  await Promise.all(STOCK_SYMS.map(async s => {
    try {
      // two hosts serve the same feed; the second answers when the first turns a request away
      let res = null;
      for (const host of ['query1', 'query2']) { try { const r = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${s}?interval=1m&range=1d&includePrePost=true`, { headers: { Accept: 'application/json', ...UA } }); res = (await r.json()).chart?.result?.[0]; if (res?.meta) break; } catch (e) {} }
      const m = res?.meta; if (!m) return;
      const ts = res.timestamp || [], c = res.indicators?.quote?.[0]?.close || []; let i = c.length - 1; while (i >= 0 && c[i] == null) i--;
      const P = m.currentTradingPeriod || {}, n = now / 1000, inP = k => P[k] && n >= P[k].start && n < P[k].end;
      const session = inP('regular') ? 'regular' : inP('pre') ? 'pre' : inP('post') ? 'post' : 'closed';
      rows[s] = { last: i >= 0 ? c[i] : m.regularMarketPrice, lastAt: i >= 0 ? ts[i] * 1000 : (m.regularMarketTime || 0) * 1000, close: session === 'regular' ? m.previousClose ?? m.chartPreviousClose : m.regularMarketPrice, closeAt: session === 'regular' ? null : (m.regularMarketTime || 0) * 1000, session };
    } catch (e) {}
  }));
  const v = { source: 'Yahoo Finance', read: now, rows };
  if (Object.keys(rows).length) stockMem = { t: now, v }; else if (stockMem.v) return stockMem.v;
  return v;
}

// ---------- the daily report: the last 24 hours of the crew desk, from its own state ----------
function report(st) {
  const now = Date.now(), DAY = 24 * HOUR, eq = equity(st);
  const past = st.curve.find(p => now - p[0] <= DAY), eq0 = past ? past[1] : START;
  const v = st.verdicts.filter(x => now - x.t < DAY), count = { CLEAN: 0, RISKY: 0, DANGER: 0 }; v.forEach(x => count[x.verdict]++);
  // calls priced again an hour later, among the last two days: did they hold?
  const judged = st.verdicts.filter(x => x.p1h && now - x.t < 2 * DAY && (x.verdict === 'CLEAN' || x.verdict === 'DANGER'));
  const held = judged.filter(x => x.verdict === 'CLEAN' ? x.p1h > x.p0 : x.p1h < x.p0).length;
  const closed = st.hist.filter(h => now - h.t < DAY).sort((a, b) => b.pnl - a.pnl), trim = h => h && { sym: h.sym, side: h.side, pnl: Math.round(h.pnl * 100) / 100, why: h.why };
  return { t: now, equity: Math.round(eq * 100) / 100, change: Math.round((eq - eq0) * 100) / 100, start: START, total: Math.round((eq - START) * 100) / 100,
    verdicts: count, judged: judged.length, held, closed: closed.length, wins: closed.filter(h => h.pnl > 0).length,
    best: trim(closed[0]), worst: trim(closed.length > 1 ? closed[closed.length - 1] : null), open: st.pos.length,
    grads: (st.grads?.rows || []).filter(r => now - r.t < DAY).length };
}

// ---------- weekly seasons on the board of desks: Monday 00:00 UTC to Monday ----------
const seasonId = (t = Date.now()) => { const d = new Date(t), back = (d.getUTCDay() + 6) % 7; return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back); };
function boardRows(st) {
  const rows = Object.entries(st.board).map(([h, r]) => ({ handle: h, pnl: r.pnl ?? r.equity - START, equity: r.equity, trades: r.trades, wins: r.wins, busts: r.busts || 0, t: r.t, crew: false }));
  const eq = Math.round(equity(st) * 100) / 100;
  rows.push({ handle: 'THE CREW', pnl: Math.round((eq - (st.season?.crew0 ?? START)) * 100) / 100, equity: eq, trades: st.hist.length, wins: st.hist.filter(h => h.pnl > 0).length, t: st.updated, crew: true });
  return rows.sort((a, b) => b.pnl - a.pnl);
}
// a new week: the best desk of the one that ended goes on record, and every desk starts the season from zero
function seasonRoll(st) {
  const id = seasonId();
  if (st.season?.id === id) return;
  if (st.season?.id) {
    const top = boardRows(st).find(r => !r.crew && r.trades > 0);
    st.seasons = [{ id: st.season.id, handle: top ? top.handle : null, pnl: top ? top.pnl : 0 }, ...(st.seasons || [])].slice(0, 8);
  }
  st.season = { id, crew0: Math.round(equity(st) * 100) / 100 }; st.board = {};
}
function boardView(st) {
  seasonRoll(st);
  return { season: st.season.id, ends: st.season.id + 7 * 24 * HOUR, past: st.seasons || [], rows: boardRows(st).slice(0, 50) };
}

// On Cloudflare everything under /api/ runs inside one Durable Object: a single instance with its own storage,
// so there is exactly one copy of the desk, and an alarm marks it every minute without a cron trigger.
// (Workers KV would not do: its free plan allows 1,000 writes a day and the desk writes more often than that.)
export class Desk {
  constructor(ctx, env) { this.ctx = ctx; this.env = { ...env, KV: { get: async k => (await ctx.storage.get(k)) ?? null, put: (k, v) => ctx.storage.put(k, v) } }; }
  async fetch(request) {
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + 60000);
    return api.fetch(request, this.env);
  }
  async alarm() { try { await api.scheduled({}, this.env); } finally { await this.ctx.storage.setAlarm(Date.now() + 60000); } }
}
export default {
  async fetch(request, env) {
    const u = new URL(request.url), path = u.pathname;
    // pages that moved: the manifesto became the docs, the fine print became privacy and terms
    const moved = { '/manifesto': '/docs/', '/manifesto/': '/docs/', '/fine-print': '/terms/', '/fine-print/': '/terms/' }[path];
    if (moved) return Response.redirect(new URL(moved, u).href, 301);
    if (!env.DESK) return api.fetch(request, env);   // local server: no Durable Object, a file stands in
    // one address: www and plain http both go to https://shuntdesk.com (a desk kept in the browser belongs to one origin)
    if (u.hostname === 'www.shuntdesk.com' || (u.hostname === 'shuntdesk.com' && u.protocol === 'http:')) return Response.redirect('https://shuntdesk.com' + u.pathname + u.search, 301);
    return path.startsWith('/api/') || path.startsWith('/badge/') || path === '/mcp' ? env.DESK.get(env.DESK.idFromName('main')).fetch(request) : env.ASSETS.fetch(request);
  },
  scheduled(event, env) { return env.DESK ? undefined : api.scheduled(event, env); }
};

// the keyed node, when one is configured, stands behind the public one
const useEnv = env => { if (env.ALCHEMY_RPC_URL && !RPCS.includes(env.ALCHEMY_RPC_URL)) RPCS.push(env.ALCHEMY_RPC_URL); };
const api = {
  async fetch(request, env) {
    useEnv(env);
    const url = new URL(request.url), ip = request.headers.get('cf-connecting-ip') || 'local';
    if (request.method === 'OPTIONS') return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Authorization', 'Access-Control-Allow-Methods': 'GET, POST' } });
    try {
      // what the server itself can reach right now: one read of each outside service, nothing stored
      if (url.pathname === '/api/health') {
        const st0 = await load(env).catch(() => null);
        const T = '0x39dbed3a2bd333467115de45665cc57f813c4571', probe = async (u, h) => { try { const r = await fetch(u, { headers: { Accept: 'application/json', ...UA, ...h } }); return r.status; } catch (e) { return 'unreachable'; } };
        return json({ dexscreener: await probe(DS + '/tokens/v1/robinhood/' + T), dexscreenerNoAgent: await (async () => { try { return (await fetch(DS + '/tokens/v1/robinhood/' + T)).status; } catch (e) { return 'unreachable'; } })(), goplus: await probe('https://api.gopluslabs.io/api/v1/token_security/4663?contract_addresses=' + T), geckoterminal: await probe('https://api.geckoterminal.com/api/v2/networks/robinhood/tokens/' + T), yahoo: await probe('https://query1.finance.yahoo.com/v8/finance/chart/TSLA?interval=1m&range=1d'), looks: await looksLoad(env).then(L => ({ logged: L.rows.length, judged: L.rows.filter(r => r.p1 !== undefined).length, err: L.err || null })).catch(e => String(e.message || e)), handLast: st0?.handLast || null, codexToday: st0?.codex || null, rpc: await (async () => { try { return (await fetch('https://rpc.mainnet.chain.robinhood.com', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' })).status; } catch (e) { return 'unreachable'; } })(), chain: await (async () => { const o = { nodes: RPCS.length }; for (const [k, fn] of [['ethUsd', () => poolRatio(ETH_REF)], ['decimals', () => rpc('eth_call', [{ to: T, data: '0x313ce567' }, 'latest'])]]) { try { o[k] = String(await fn()).slice(0, 12); } catch (e) { o[k] = 'ERR ' + String(e.message || e).slice(0, 60); } } return o; })(), keys: { openrouter: !!env.OPENROUTER_API_KEY, goplus: !!env.GOPLUS_APP_KEY, codex: !!env.CODEX_API_KEY, coingecko: !!env.COINGECKO_API_KEY } });
      }
      if (url.pathname === '/api/candles') { const a = (url.searchParams.get('a') || '').toLowerCase(); return isAddr(a) ? json(await candles(env, a)) : json({ rows: [], res: 1 }, 400); }
      if (url.pathname === '/api/pools') return json(await pools(env, url.searchParams.get('kind') === 'new' ? 'new' : 'trending'));
      if (url.pathname === '/api/launch') { const a = (url.searchParams.get('a') || '').toLowerCase(); return isAddr(a) ? json(await launch(env, a)) : json({ ok: false, why: 'bad address' }, 400); }
      if (url.pathname === '/api/stocks') return json(await stockRefs());
      if (url.pathname === '/api/bonds') return json(await bondView(env));
      if (url.pathname === '/api/lab') return json(await labData(env));
      if (url.pathname === '/api/ledger') { const a = (url.searchParams.get('a') || '').toLowerCase(); if (!isAddr(a)) return json({ ok: false, why: 'bad address' }, 400); return json(await devLedger(env, a)); }
      if (url.pathname === '/api/radar') return json(await radarView(env));
      if (url.pathname === '/api/hand/launches') { const ws = [...new Set((url.searchParams.get('w') || '').toLowerCase().split(',').filter(isAddr))].slice(0, 40); return ws.length ? json(await handLaunches(env, ws)) : json({ ok: false, why: 'pass ?w= up to 40 wallets, comma separated' }, 400); }
      if (url.pathname === '/api/hand') { const w = (url.searchParams.get('w') || '').toLowerCase(); return isAddr(w) ? json(await handWallet(env, w, url.searchParams.get('creator') === '1')) : json({ ok: false, why: 'bad address' }, 400); }
      if (url.pathname === '/api/looks') { const a = (url.searchParams.get('a') || '').toLowerCase(); return isAddr(a) ? json(await lookalikes(env, a)) : json({ ok: false, why: 'bad address' }, 400); }
      const st = await load(env);
      const body = request.method === 'POST' ? await request.json().catch(() => ({})) : null;
      if (url.pathname === '/api/desk') {
        const pos = st.pos.map(p => { const v = worth(p), { m, ...rest } = p; return { ...rest, net: v.net, health: v.health }; });
        return json({ start: START, equity: Math.round(equity(st) * 100) / 100, cash: Math.round(st.cash * 100) / 100, pos, hist: st.hist.slice(0, 20), log: st.log.slice(0, 30), curve: st.curve, updated: st.updated, record: record(st) });
      }
      if (url.pathname === '/api/verdict' && body) { const r = await postVerdict(st, env, body, ip); await save(env, st); return json(r); }
      if (url.pathname === '/api/second' && body) { const r = await secondRead(st, env, body, ip); await save(env, st); return json(r); }
      if (url.pathname === '/api/explain' && body) { const r = await explain(st, env, body, ip); await save(env, st); return json(r); }
      if (url.pathname === '/api/trade' && body) { const r = await tradeBrief(st, env, body, ip); await save(env, st); return json(r); }
      if (url.pathname === '/api/grads') return json({ rows: (st.grads?.rows || []).map(({ token, t, block }) => ({ token, t, block })), read: st.grads?.t || 0, err: st.grads?.err || null });
      if (url.pathname === '/api/dataset') return json({ repo: 'https://huggingface.co/datasets/' + HF_REPO, published: st.hf || null, last: st.hfLast || null });
      if (url.pathname === '/api/report') { const r = report(st), had = st.rnote?.t; r.note = await reportNote(st, env, r); if (r.note.t !== had) await save(env, st); return json(r); }
      // the agent interface: read-only, CORS open, 120 calls an hour per caller
      if (url.pathname.startsWith('/api/v1/')) {
        if (!allow(st, ip, 'agent', 120)) return json({ error: 'rate limited: 120 calls an hour' }, 429);
        const [code, out] = await agentData(st, env, url.pathname.slice(8), (url.searchParams.get('a') || '').toLowerCase());
        return json(out, code);
      }
      if (url.pathname === '/mcp' || url.pathname === '/api/mcp') return mcp(st, env, request, body, ip);
      if (url.pathname === '/api/replay') { const a = (url.searchParams.get('a') || '').toLowerCase(); if (!isAddr(a)) return json({ ok: false, why: 'bad address' }, 400); if (!allow(st, ip, 'replay', 30)) return json({ ok: false, why: 'slow down' }, 429); const r = await replay(st, env, a); await save(env, st); return json(r); }
      if (url.pathname === '/api/wallet') { const a = (url.searchParams.get('w') || '').toLowerCase(); if (!isAddr(a)) return json({ ok: false, why: 'bad address' }, 400); if (!allow(st, ip, 'wallet', 30)) return json({ ok: false, why: 'slow down: 30 wallets an hour' }, 429); return json(await walletView(st, env, a)); }
      if (url.pathname === '/api/intel') { const ws = [...new Set((url.searchParams.get('w') || '').toLowerCase().split(',').filter(isAddr))].slice(0, 4); if (!ws.length) return json({ ok: false, why: 'pass ?w= up to 4 wallets' }, 400); if (!allow(st, ip, 'intel', 60)) return json({ ok: false, why: 'slow down' }, 429); const out = {}; for (const a of ws) out[a] = await walletIntel(st, env, a); await save(env, st); return json({ ok: true, wallets: out }); }
      if (url.pathname === '/api/trip/email' && body) { if (!allow(st, ip, 'tripmail', 5)) return json({ ok: false, why: 'slow down' }, 429); const [code, out] = await tripMail(st, env, body, url.origin); await save(env, st); return json(out, code); }
      if (url.pathname === '/api/trip/confirm' || url.pathname === '/api/trip/off') { const msg = await tripMailLink(st, env, url.pathname.endsWith('off') ? 'off' : 'on', url.searchParams.get('id') || '', url.searchParams.get('c') || ''); await save(env, st); return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Tripwire</title><body style="background:#060708;color:#edebe6;font:16px system-ui;padding:60px 24px;text-align:center"><p>${msg}</p><p><a style="color:#2ed3a0" href="/">shuntdesk.com</a></p>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }); }
      if (url.pathname === '/api/site') { const a = (url.searchParams.get('a') || '').toLowerCase(); if (!isAddr(a)) return json({ ok: false, why: 'bad address' }, 400); if (!sites.has(a) && !allow(st, ip, 'site', 40)) return json({ ok: false, why: 'slow down: 40 sites an hour' }, 429); const extra = (url.searchParams.get('u') || '').split(' ').filter(Boolean).slice(0, 6); const r = await siteCheck(st, env, a, extra); await save(env, st); return json(r); }
      if (url.pathname === '/api/xray') { const a = (url.searchParams.get('a') || '').toLowerCase(); if (!isAddr(a)) return json({ ok: false, why: 'bad address' }, 400); if (!xrays.has(a) && !allow(st, ip, 'xray', 40)) return json({ ok: false, why: 'slow down: 40 scans an hour' }, 429); const r = await xray(st, env, a); await save(env, st); return json(r); }
      if (url.pathname === '/api/rugs') return json({ rows: rugs(st) });
      if (url.pathname === '/api/play') return json({ trains: playTrains(st) });
      if (url.pathname === '/api/proof') { const [dl, x, L] = await Promise.all([devLedger(env, SHUNT).catch(() => null), xray(st, env, SHUNT).catch(() => null), launch(env, SHUNT).catch(() => null)]);
        const rec = record(st); return json({ ok: true, token: SHUNT, ledger: dl?.ok ? dl : null, contract: x?.ok ? { functions: x.functions, named: x.named, unknown: x.unknown, proxy: !!x.proxy, owner: x.owner, powers: x.powers.filter(p => p.level === 'high').map(p => p.what), verified: x.source?.verified ?? null } : null,
          curve: L?.launchpad === 'pons' ? { progress: L.progress, graduated: L.graduated, raised: L.raised, need: L.need, holders: L.holders ?? null } : null,
          record: { calls: st.verdicts.length, clean: rec.after24h.CLEAN, danger: rec.after24h.DANGER }, pools: SHUNT_POOLS, links: { source: 'https://github.com/shuntdesk/shuntdesk', data: 'https://huggingface.co/datasets/shuntdesk/verdicts', x: 'https://x.com/shuntdesk', telegram: 'https://t.me/shuntdesk' } }); }
      if (url.pathname === '/api/holder' && body) { if (!allow(st, ip, 'holder', 20)) return json({ ok: false, why: 'slow down' }, 429); const [code, out] = await holderVerify(st, env, body); await save(env, st); return json(out, code); }
      if (url.pathname === '/api/holder') return json({ ok: true, message: holderMessage(String(url.searchParams.get('c') || '')), min: HOLD_MIN, pro: HOLD_PRO, boost: BOOST_MIN, trip: HOLD_TRIP });
      if (url.pathname === '/api/caught') return json(await caughtView(env));
      if (url.pathname === '/api/weekly') return json(await weeklyData(st, env));
      if (url.pathname === '/api/devscore') { const w = (url.searchParams.get('w') || '').toLowerCase(); if (!isAddr(w)) return json({ ok: false, why: 'bad address' }, 400); if (!scores.has(w) && !allow(st, ip, 'devscore', 30)) return json({ ok: false, why: 'slow down: 30 an hour' }, 429); return json(await devScore(st, env, w)); }
      if (url.pathname === '/api/bondgame') {
        await bondGame(st, env);
        if (body) { if (!allow(st, ip, 'bondgame', 10)) return json({ ok: false, why: 'slow down' }, 429); const [code, out] = bondGamePlay(st, body); await save(env, st); return json({ ...out, ...bondGameView(st, String(body.handle || '').toLowerCase(), await bondsLoad(env)) }, code); }
        await save(env, st); return json(bondGameView(st, String(url.searchParams.get('me') || '').toLowerCase(), await bondsLoad(env)));
      }
      if (url.pathname.startsWith('/badge/')) { const a = url.pathname.slice(7).replace(/\.svg$/, '').toLowerCase(); if (!isAddr(a)) return new Response('not found', { status: 404 });
        return new Response(await badgeSvg(st, env, a), { headers: { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=600', 'Access-Control-Allow-Origin': '*' } }); }      if (url.pathname === '/api/daily') {
        if (body) { if (!allow(st, ip, 'daily', 10)) return json({ ok: false, why: 'slow down' }, 429); const [code, out] = dailyShift(st, body); if (code === 200) await save(env, st); return json(out, code); }
        const v = dailyView(st, String(url.searchParams.get('me') || '').toLowerCase()); await save(env, st); return json(v);
      }
      if (url.pathname === '/api/yard') {
        if (body) { if (!allow(st, ip, 'yard', 20)) return json({ ok: false, why: 'slow down: 20 shifts an hour' }, 429); const [code, out] = yardShift(st, body); if (code === 200) await save(env, st); return json(out, code); }
        return json(yardView(st, String(url.searchParams.get('me') || '').toLowerCase()));
      }
      if (url.pathname === '/api/push/key') return json({ key: env.VAPID_PUBLIC || null });
      if (url.pathname === '/api/push/sub' && body) { if (!allow(st, ip, 'push', 30)) return json({ ok: false, why: 'slow down' }, 429); const [code, out] = pushSubscribe(st, body); await save(env, st); return json(out, code); }
      if (url.pathname === '/api/push/inbox') { const s = st.push?.[url.searchParams.get('id') || '']; if (!s) return json({ messages: [] }); const out = s.inbox; s.inbox = []; await save(env, st); return json({ messages: out }); }
      if (url.pathname === '/api/tg' && body) { const r = await telegram(st, env, request, body); await save(env, st); return r; }
      if (url.pathname === '/api/brief') { const had = st.brief?.t; const r = await brief(st, env, ip); if (r.t !== had) await save(env, st); return json(r); }
      if (url.pathname === '/api/board') {
        if (body) {
          const h = String(body.handle || '').trim().toLowerCase();
          if (!/^[a-z0-9_]{2,16}$/.test(h) || h === 'the_crew') return json({ ok: false, why: 'handle must be 2 to 16 letters, digits or _' }, 400);
          if (!allow(st, ip, 'board', 30)) return json({ ok: false, why: 'slow down' }, 429);
          const eq = Number(body.equity); if (!(eq >= 0 && eq < 1e8)) return json({ ok: false, why: 'bad equity' }, 400);
          seasonRoll(st);
          // the season's result: what the desk made since this week began (sent by the page, so self-reported like the rest)
          const pnl = body.season === st.season.id && Number.isFinite(Number(body.pnl)) ? Math.max(-1e8, Math.min(1e8, Number(body.pnl))) : eq - START;
          st.board[h] = { equity: Math.round(eq * 100) / 100, pnl: Math.round(pnl * 100) / 100, trades: Math.max(0, body.trades | 0), wins: Math.max(0, body.wins | 0), busts: Math.max(0, body.busts | 0), t: Date.now() };
          const all = Object.entries(st.board); if (all.length > 500) all.sort((a, b) => a[1].t - b[1].t).slice(0, 100).forEach(([k]) => delete st.board[k]);
          await save(env, st);
        }
        return json(boardView(st));
      }
      return json({ error: 'not found' }, 404);
    } catch (e) { return json({ error: String(e.message || e) }, 500); }
  },
  async scheduled(event, env) {
    useEnv(env); const st = await load(env); await tick(st);
    try { await postMortem(st, env); } catch (e) {}
    try { await pushTick(st, env); } catch (e) { st.pushLast = { t: Date.now(), error: String(e.message || e).slice(0, 120) }; }
    try { if (new Date().getUTCHours() >= 1) { const r = await hfPublish(st, env); if (r.final || r.first || r.today) st.hfLast = { t: Date.now(), ...r }; } } catch (e) { st.hfLast = { t: Date.now(), error: String(e.message || e).slice(0, 160) }; }   // once a day, after 01:00 UTC
    try { await gradScan(st, env); } catch (e) { st.grads = { ...(st.grads || { rows: [] }), err: String(e.message || e).slice(0, 120) }; }   // the graduation feed is extra: a failed read never stops the desk
    try { await looksTick(env); } catch (e) {}
    try { await bondTick(env); } catch (e) {}
    try { await lindexTick(env); } catch (e) {}
    try { await radarTick(st, env); } catch (e) {}
    try { await groupDigest(st, env); } catch (e) {}
    try { await reportJudge(st, env); } catch (e) {}
    try { await bondGame(st, env); } catch (e) {}
    try { await holderRefresh(st); } catch (e) {}
    try { await holderCurves(st, env); } catch (e) {}
    try { await earlyFeed(st, env); } catch (e) {}
    try { await earlyTick(st, env); } catch (e) {}
    try { await tgFlush(st, env); } catch (e) {}
    try { await handAlert(st, env); } catch (e) { st.handLast = { t: Date.now(), why: String(e.message || e).slice(0, 120) }; }
    try { await tripTick(st, env); } catch (e) { st.tripLast = { t: Date.now(), why: String(e.message || e).slice(0, 120) }; }
    try { await xrayAlert(st, env); } catch (e) { st.xrayLast = { t: Date.now(), why: String(e.message || e).slice(0, 120) }; }
    if (st.xrayQ?.length > 20) st.xrayQ = st.xrayQ.slice(-20);
    if (st.handQ?.length > 20) st.handQ = st.handQ.slice(-20);
    seasonRoll(st); await save(env, st);
  }
};
