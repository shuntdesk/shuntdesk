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
    return (await r.json()).result?.[addr] || null;
  } catch (e) { return null; }
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
  if (cmd === 'start' || cmd === 'help') return reply(`<b>Shuntdesk</b> · every token rides the line\n\nAsk anything about Shuntdesk, a token, the crew desk or what just launched. Or use:\n\n/check <code>0x…</code> what Shuntdesk knows about a Robinhood Chain token\n/daily today's daily shift in the Yard\n/new tokens that just graduated from Pons\n/desk the crew's public paper desk\n/report the last 24 hours\n\n${site}`);
  // anything that is not a command, or a token address with a question around it, goes to the conductor
  const question = clean.replace(/^\/\w+\s*/, '').replace(/0x[0-9a-fA-F]{40}/, '').trim();
  if (!cmd && (!found || question.length > 3)) return reply(await tgAsk(st, env, chat, clean, found ? found[0].toLowerCase() : null));
  if (cmd === 'desk') {
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
const CODEX_SHARE = { looks: 80, launch: 90, candles: 60, replay: 40, push: 50 };
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
    if (isAddr(token)) { g.rows.push({ token, block: parseInt(l.blockNumber, 16), t: t || now }); if (now - (t || now) < 30 * 60000) (st.handQ = st.handQ || []).push(token); }   // fresh ones go to Same Hand
  }
  g.block = to; g.rows = g.rows.sort((a, b) => b.block - a.block).slice(0, 40);
}

// Launch facts from Codex for launchpad tokens: snipers, bundles, insiders, the developer's share, curve progress.
// Shared by every visitor for ten minutes, with its own daily ceiling inside the same free allowance.
const launches = new Map();
async function launch(env, addr) {
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
    return path.startsWith('/api/') || path === '/mcp' ? env.DESK.get(env.DESK.idFromName('main')).fetch(request) : env.ASSETS.fetch(request);
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
      if (url.pathname === '/api/rugs') return json({ rows: rugs(st) });
      if (url.pathname === '/api/play') return json({ trains: playTrains(st) });
      if (url.pathname === '/api/daily') {
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
    try { await handAlert(st, env); } catch (e) { st.handLast = { t: Date.now(), why: String(e.message || e).slice(0, 120) }; }
    if (st.handQ?.length > 20) st.handQ = st.handQ.slice(-20);
    seasonRoll(st); await save(env, st);
  }
};
