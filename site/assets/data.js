// Data layer. Every call goes straight from the visitor's browser to a free public API.
// No server, no key. GeckoTerminal is rate-limited hard, so its calls are queued.

const GT = 'https://api.geckoterminal.com/api/v2/networks/robinhood';
const DS = 'https://api.dexscreener.com';
const BS = 'https://robinhoodchain.blockscout.com/api/v2';
const RPCS = ['https://rpc.mainnet.chain.robinhood.com', 'https://robinhood-rpc.publicnode.com'];
export const EXPLORER = 'https://robinhoodchain.blockscout.com';

const mem = new Map();
async function getJSON(url, ttl = 60, ms = 9000) {
  const key = 'sd.c.' + url, now = Date.now();
  if (mem.has(url)) return mem.get(url);
  try { const c = JSON.parse(sessionStorage.getItem(key)); if (c && now - c.t < ttl * 1000) return c.v; } catch (e) {}
  const p = fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(ms) }).then(async r => {
    if (!r.ok) throw new Error(r.status + ' ' + new URL(url).hostname);
    const v = await r.json();
    try { sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), v })); } catch (e) {}
    return v;
  }).finally(() => setTimeout(() => mem.delete(url), 50));
  mem.set(url, p);
  return p;
}
let gtChain = Promise.resolve();
function gt(path, ttl = 90) {
  const run = gtChain.then(() => getJSON(GT + path, ttl));
  gtChain = run.catch(() => {}).then(() => new Promise(r => setTimeout(r, 2300)));
  return run;
}
// the official endpoint drops connections now and then, so calls fall through to a second public one
let rpcAt = 0;
export async function rpc(method, params = []) {
  let err;
  for (let n = 0; n < RPCS.length; n++) {
    const url = RPCS[(rpcAt + n) % RPCS.length];
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(6000) });
      const j = await r.json();
      if (j.error) { if (j.error.code === 3) throw Object.assign(new Error(j.error.message), { revert: true }); throw new Error(j.error.message); }
      rpcAt = (rpcAt + n) % RPCS.length;
      return j.result;
    } catch (e) { err = e; if (e.revert) throw e; }
  }
  throw err;
}
export const blockNumber = async () => parseInt(await rpc('eth_blockNumber'), 16);
// Blockscout's v2 API, path after /api/v2, kept for five minutes
export const blockscout = path => getJSON(BS + path, 300, 8000);

const ZERO = '0x0000000000000000000000000000000000000000', DEAD = '0x000000000000000000000000000000000000dead';
export const isAddr = a => /^0x[0-9a-fA-F]{40}$/.test((a || '').trim());

function fromGtPool(d, inc) {
  const a = d.attributes, id = d.relationships?.base_token?.data?.id || '', tok = (inc || []).find(i => i.id === id);
  const tx = a.transactions?.h24 || {};
  return {
    pool: a.address, addr: id.split('_')[1] || '', sym: tok?.attributes?.symbol || a.name.split(' / ')[0], name: tok?.attributes?.name || '',
    created: Date.parse(a.pool_created_at), liq: Number(a.reserve_in_usd) || 0, fdv: Number(a.fdv_usd) || 0, price: Number(a.base_token_price_usd) || 0,
    tx24: (tx.buys || 0) + (tx.sells || 0), buyers: tx.buyers || 0, sellers: tx.sellers || 0, chg: Number(a.price_change_percentage?.h24) || 0
  };
}
function fromDsPair(p) {
  const t = p.txns?.h24 || {};
  const links = [...(p.info?.websites || []).map(w => w.url), ...(p.info?.socials || []).map(s => s.url)].filter(u => /^https?:\/\//.test(u || '')).slice(0, 6);
  return { links, pool: p.pairAddress, addr: p.baseToken.address.toLowerCase(), sym: p.baseToken.symbol, name: p.baseToken.name, created: p.pairCreatedAt || 0, liq: p.liquidity?.usd || 0, fdv: p.fdv || 0, price: Number(p.priceUsd) || 0, tx24: (t.buys || 0) + (t.sells || 0), buyers: t.buys || 0, sellers: t.sells || 0, chg: p.priceChange?.h24 || 0, vol24: p.volume?.h24 || 0, url: p.url, dex: p.dexId, quote: p.quoteToken.address.toLowerCase(), quoteSym: p.quoteToken.symbol, native: Number(p.priceNative) || 0 };
}

// newest pools on the chain; falls back to DexScreener's latest profiles when GeckoTerminal says no
export async function newPools() {
  // newest pools must be fresh, so the keyless feed is asked first, straight from the browser; the site's own
  // server (one keyed read shared by all visitors, a few minutes old) covers the times that feed says no
  try {
    const j = await gt('/new_pools?page=1&include=base_token', 75);
    const rows = j.data.map(d => fromGtPool(d, j.included)).filter(r => r.addr);
    if (rows.length) return { rows, source: 'GeckoTerminal' };
  } catch (e) {}
  try { const j = await api('pools?kind=new'); if (j?.rows?.length) return { rows: j.rows, source: j.source }; } catch (e) {}
  const prof = await getJSON(DS + '/token-profiles/latest/v1', 75);
  const addrs = [...new Set(prof.filter(p => p.chainId === 'robinhood').map(p => p.tokenAddress))].slice(0, 30);
  const map = await prices(addrs);
  return { rows: Object.values(map).sort((a, b) => b.created - a.created), source: 'DexScreener' };
}
export async function trending() {
  try { const s = await api('pools?kind=trending'); if (s?.rows?.length) return s.rows; } catch (e) {}
  const j = await gt('/trending_pools?page=1&include=base_token', 180);
  return j.data.map(d => fromGtPool(d, j.included)).filter(r => r.addr);
}
// tokens that just graduated from the Pons curve (read on the server from the factory's own log), with their pools
// one read shared by every caller on the page for a minute (the landing asks for it twice at once)
let gradMemo = null;
export function graduates() {
  if (gradMemo && Date.now() - gradMemo.t < 60000) return gradMemo.p;
  const p = readGraduates().then(r => { if (!r.length) gradMemo = null; return r; }, e => { gradMemo = null; throw e; });
  gradMemo = { t: Date.now(), p }; return p;
}
async function readGraduates() {
  let g = { rows: [] }; try { g = await api('grads'); } catch (e) {}
  // the server could not read the log just now: read the last day of graduations from this browser instead
  if (!g.rows || !g.rows.length) try {
    const head = parseInt(await rpc('eth_blockNumber'), 16);
    const logs = await rpc('eth_getLogs', [{ address: '0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e', topics: ['0x0a44ef75df69c534f43cd6c1aa3ef8983065fe5fe79ef9e79f6494e6f258c259'], fromBlock: '0x' + (head - 860000).toString(16), toBlock: '0x' + head.toString(16) }]);
    g = { rows: logs.reverse().map(l => ({ token: '0x' + l.topics[1].slice(-40), t: Date.now() - (head - parseInt(l.blockNumber, 16)) * 100.4 })) };
  } catch (e) {}
  const list = (g.rows || []).slice(0, 20);
  let m = {}; try { m = await prices(list.map(r => r.token)); } catch (e) {}
  const out = []; let asked = 0;
  for (const r of list) {
    let p = m[r.token];
    if (!p && asked++ < 6) p = await pairFor(r.token).catch(() => null);   // DexScreener can be minutes behind a fresh graduation
    if (p) out.push({ tx24: 0, ...p, created: r.t, grad: true });
  }
  return out;
}

// Pons launches by one wallet, read from the factory's log in the visitor's browser. The node answers at most
// ten million blocks (about eleven days) per query, so the search walks back in steps to the factory's first launch.
const PONS = '0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e', PONS_FROM = 39100000;
const T_LAUNCH = '0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607', T_GRAD = '0x0a44ef75df69c534f43cd6c1aa3ef8983065fe5fe79ef9e79f6494e6f258c259';
const word32 = a => '0x' + a.slice(2).toLowerCase().padStart(64, '0'), fromWord = w => '0x' + w.slice(-40).toLowerCase();
async function ponsLogs(topics, onStep) {
  const head = parseInt(await rpc('eth_blockNumber'), 16), out = [];
  for (let to = head; to >= PONS_FROM; to -= 9999999) {
    const from = Math.max(PONS_FROM, to - 9999998);
    onStep && onStep(head - to, head - PONS_FROM);
    out.push(...await rpc('eth_getLogs', [{ address: PONS, topics, fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16) }]));
    await new Promise(r => setTimeout(r, 250));   // the public node rate-limits bursts
  }
  return { head, logs: out };
}
// who launched a token on Pons (null when it did not come from Pons)
export async function ponsLauncher(token) {
  try { const { logs } = await ponsLogs([T_LAUNCH, word32(token)]); return logs[0] ? fromWord(logs[0].topics[3]) : null; }
  // a node that refuses the wide log read: the server reads the same log from its keyed index
  catch (e) { const r = await api(`hand?w=${token.toLowerCase()}&creator=1`); if (!r?.ok) throw e; return r.ponsBy || null; }
}
// everything a wallet launched on Pons: when, whether it graduated, and how its pool stands now
export async function deployerRecord(wallet, onStep) {
  let head, logs;
  try { ({ head, logs } = await ponsLogs([T_LAUNCH, null, null, word32(wallet)], onStep)); }
  catch (e) { return deployerFromServer(wallet, e); }
  const toks = logs.map(l => ({ addr: fromWord(l.topics[1]), block: parseInt(l.blockNumber, 16) })).sort((a, b) => b.block - a.block);
  const ago = b => Date.now() - (head - b) * 100.4;   // about ten blocks a second on this chain
  const grads = new Set();
  for (let i = 0; i < toks.length; i += 40) {
    const { logs: g } = await ponsLogs([T_GRAD, toks.slice(i, i + 40).map(t => word32(t.addr))]);
    g.forEach(l => grads.add(fromWord(l.topics[1])));
  }
  let m = {}; try { m = await prices(toks.map(t => t.addr)); } catch (e) {}
  for (const t of toks.filter(t => !m[t.addr]).slice(0, 5)) { const p = await pairFor(t.addr).catch(() => null); if (p) m[t.addr] = p; }   // fresh ones: GeckoTerminal
  return toks.map(t => ({ ...t, t: ago(t.block), graduated: grads.has(t.addr), pair: m[t.addr] || null }));
}

// the same record through the server's keyed index, for when the node refuses the wide log read. Graduation is
// read from the pools: a token with a DEX pool has left the curve (the curve itself is not listed by DexScreener).
async function deployerFromServer(wallet, err) {
  const r = await api('hand/launches?w=' + wallet.toLowerCase()); if (!r?.ok) throw err;
  const toks = (r.launches[wallet.toLowerCase()] || []).map(l => ({ addr: l.token, block: l.block, t: l.t || Date.now() })).sort((a, b) => b.block - a.block);
  let m = {}; try { m = await prices(toks.map(t => t.addr)); } catch (e) {}
  return toks.map(t => ({ ...t, graduated: !!m[t.addr], pair: m[t.addr] || null }));
}

// best pair (deepest liquidity) per token
export async function prices(addrs) {
  const out = {};
  const list = [...new Set(addrs.map(a => a.toLowerCase()))];
  for (let i = 0; i < list.length; i += 30) {
    const j = await getJSON(`${DS}/tokens/v1/robinhood/${list.slice(i, i + 30).join(',')}`, 8);
    for (const p of j || []) { const r = fromDsPair(p); if (!out[r.addr] || out[r.addr].liq < r.liq) out[r.addr] = r; }
  }
  return out;
}
// brand-new pools reach GeckoTerminal minutes before DexScreener lists them
export async function pairFor(addr) {
  addr = addr.toLowerCase();
  try { const p = (await prices([addr]))[addr]; if (p) return p; } catch (e) {}
  try {
    const j = await gt(`/tokens/${addr}/pools?page=1&include=base_token`, 60);
    const rows = (j.data || []).map(d => fromGtPool(d, j.included)).filter(r => r.addr === addr).sort((a, b) => b.liq - a.liq);
    if (rows[0]) return { ...rows[0], dex: 'a DEX (via GeckoTerminal)' };
  } catch (e) {}
  return null;
}
// candles for a pair: GeckoTerminal first (free, straight from the browser); if it has too few, which is
// usual for a pool under an hour old, the server asks Codex, which indexes new pools within a minute
export async function candles(pair) {
  let rows = [];
  try { const j = await gt(`/pools/${pair.pool}/ohlcv/minute?aggregate=5&limit=120`, 120); rows = (j.data?.attributes?.ohlcv_list || []).map(c => ({ t: c[0] * 1000, o: c[1], h: c[2], l: c[3], c: c[4] })).reverse(); } catch (e) {}
  if (rows.length >= 12) return { rows, label: '5-minute candles · GeckoTerminal' };
  try { const j = await api('candles?a=' + pair.addr); if (j?.rows?.length > rows.length) return { rows: j.rows, label: `${j.res}-minute candles · Codex` }; } catch (e) {}
  return { rows, label: '5-minute candles · GeckoTerminal' };
}

// GoPlus token security for Robinhood Chain (4663): no key needed from a browser. null when it has nothing.
export async function goplus(addr) {
  try { const j = await getJSON(`https://api.gopluslabs.io/api/v1/token_security/4663?contract_addresses=${addr.toLowerCase()}`, 300, 8000); return j?.result?.[addr.toLowerCase()] || null; } catch (e) { return null; }
}

// ---------- the seven stops ----------
export const STOP_KEYS = ['sources', 'gate', 'scout', 'tracer', 'linker', 'auditor', 'judge'];
const SEL = { mint: '40c10f19', pause: '8456cb59', blacklist: ['f9f92be4', 'fe575a87', '44337ea1', '0ecb93c0'], renounce: '715018a6' };
const pct = (v, supply) => supply > 0n ? Number(BigInt(v) * 100000n / supply) / 1000 : 0;
const short = a => a.slice(0, 6) + '…' + a.slice(-4);
export function zoneFor(liq) { return liq >= 250000 ? { zone: 1, max: 100 } : liq >= 40000 ? { zone: 2, max: 25 } : { zone: 3, max: 5 }; }

async function pool3(items, fn) {
  const out = []; let i = 0;
  await Promise.all([0, 1, 2, 3, 4, 5].map(async () => { while (i < items.length) { const k = i++; try { out[k] = await fn(items[k]); } catch (e) { out[k] = null; } } }));
  return out;
}

export function cachedScan(addr) {
  try { const c = JSON.parse(localStorage.getItem('sd.scan.' + addr.toLowerCase())); if (c && Date.now() - c.at < 15 * 60000) return c; } catch (e) {}
  return null;
}
export function recentScans() {
  try { return JSON.parse(localStorage.getItem('sd.scans') || '[]').map(a => { try { return JSON.parse(localStorage.getItem('sd.scan.' + a)); } catch (e) { return null; } }).filter(Boolean); } catch (e) { return []; }
}
function saveScan(res) {
  try {
    localStorage.setItem('sd.scan.' + res.addr, JSON.stringify(res));
    const idx = JSON.parse(localStorage.getItem('sd.scans') || '[]').filter(a => a !== res.addr);
    idx.unshift(res.addr);
    idx.slice(40).forEach(a => localStorage.removeItem('sd.scan.' + a));
    localStorage.setItem('sd.scans', JSON.stringify(idx.slice(0, 40)));
  } catch (e) {}
}

// Runs the line for one token. onStep(step, index) fires as each stop reports.
export async function scan(address, onStep = () => {}) {
  const addr = address.trim().toLowerCase();
  const res = { addr, steps: [], score: 100, at: Date.now() };
  const push = s => { res.steps.push(s); res.score -= s.cost || 0; onStep(s, res.steps.length - 1, res); return s; };
  const unread = (key, name, why) => push({ key, name, status: 'skip', tag: 'NO READ', detail: `Could not read this stop (${why}).`, facts: [], cost: 5 });

  // 1. Sources
  const pair = await pairFor(addr);
  if (!pair) {
    push({ key: 'sources', name: 'Sources', status: 'bad', tag: 'NO POOL', detail: 'No pool found for this address on Robinhood Chain.', facts: [], cost: 100 });
    Object.assign(res, { sym: short(addr), verdict: 'NO POOL', platform: 'depot', score: 0, zone: 3, maxLev: 0 });
    return res;
  }
  const ageMin = pair.created ? (Date.now() - pair.created) / 60000 : null;
  Object.assign(res, { sym: pair.sym, name: pair.name, price: pair.price, liq: pair.liq, pool: pair.pool, ageMin, url: pair.url, fdv: pair.fdv, links: pair.links || [] });
  push({ key: 'sources', name: 'Sources', status: 'ok', tag: 'FOUND', detail: `${pair.sym} trades on ${pair.dex || 'a DEX'}, pool ${ageMin == null ? 'age unknown' : fmtAge(ageMin) + ' old'}.`, facts: [['Price', '$' + sig(pair.price)], ['24h trades', pair.tx24], ['24h volume', '$' + compact(pair.vol24 || 0)]] });

  // 2. Gate
  {
    const thin = pair.liq < 1000, low = pair.liq < 3000, young = ageMin != null && ageMin < 10;
    push({ key: 'gate', name: 'Gate', status: thin ? 'bad' : low || young ? 'warn' : 'ok', tag: thin ? 'TOO THIN' : low || young ? 'NOTE' : 'PASS', cost: thin ? 30 : low || young ? 10 : 0,
      detail: thin ? `Only $${compact(pair.liq)} in the pool. One sale moves the price.` : low ? `Liquidity is $${compact(pair.liq)}, under the $3K floor.` : young ? `Pool is ${fmtAge(ageMin)} old, under ten minutes.` : `Liquidity $${compact(pair.liq)}, old enough to read.`,
      facts: [['Liquidity', '$' + compact(pair.liq)], ['FDV', '$' + compact(pair.fdv)]] });
  }

  // the explorer is slow, so everything that does not depend on an earlier stop starts now
  const quiet = p => { p.catch(() => {}); return p; };
  const pScout = quiet(Promise.all([getJSON(`${BS}/tokens/${addr}`, 120), getJSON(`${BS}/tokens/${addr}/holders`, 120)]));
  const pGp = goplus(addr);   // a second, independent reading: holders, sell test, taxes, owner powers
  const pCreator = getJSON(`${BS}/addresses/${addr}`, 600, 4500).then(i => (i.creator_address_hash || '').toLowerCase() || null).catch(() => null).then(async c => c || ((await pGp)?.creator_address || '').toLowerCase() || null);
  const pAudit = quiet(Promise.all([rpc('eth_getCode', [addr, 'latest']).catch(() => null), pGp, rpc('eth_call', [{ to: addr, data: '0x8da5cb5b' }, 'latest']).catch(() => null)]));
  // launch facts (Codex, through the server): snipers, bundles, insiders and the developer's share, for launchpad tokens
  const pLaunch = Promise.race([api('launch?a=' + addr).catch(() => null), new Promise(r => setTimeout(() => r(null), 6000))]);

  // 3. Scout: the explorer's holder list, or GoPlus's if the explorer does not answer
  let holders = [], supply = 0n, eoa = [];
  try {
    let count, src = 'Blockscout';
    try {
      const [tok, hl] = await pScout;
      supply = BigInt(tok.total_supply || '0'); count = Number(tok.holders_count ?? tok.holders ?? 0);
      holders = (hl.items || []).map(i => ({ a: i.address.hash.toLowerCase(), c: !!i.address.is_contract, share: pct(i.value, supply) }));
    } catch (e) {
      const gp = await pGp; if (!gp || !gp.holders || !gp.holder_count) throw e;
      src = 'GoPlus'; count = Number(gp.holder_count);
      holders = gp.holders.map(h => ({ a: h.address.toLowerCase(), c: h.is_contract == 1 || h.is_locked == 1, share: Number(h.percent) * 100 }));
    }
    // EIP-7702: a person's wallet delegating to smart-wallet code has 23 bytes of code (0xef0100 and an address) and the
    // explorer calls it a contract. Most large holders here are such wallets: they count as wallets, not contracts.
    const flagged = holders.slice(0, 25).filter(h => h.c);
    const codes = await Promise.all(flagged.map(h => rpc('eth_getCode', [h.a, 'latest']).catch(() => null)));
    flagged.forEach((h, i) => { if (/^0xef0100[0-9a-f]{40}$/i.test(String(codes[i] || ''))) { h.c = false; h.delegated = true; } });
    eoa = holders.filter(h => !h.c && h.a !== ZERO && h.a !== DEAD);
    const top10 = eoa.slice(0, 10).reduce((s, h) => s + h.share, 0), inContracts = holders.filter(h => h.c).reduce((s, h) => s + h.share, 0);
    res.holderSrc = src;
    const st = top10 > 50 ? 'bad' : top10 > 25 || count < 25 ? 'warn' : 'ok';
    res.holders = count; res.top10 = top10; res.topShares = eoa.slice(0, 10).map(h => Math.round(h.share * 1000) / 1000);
    // who provides the liquidity. Shown, not scored: on this chain positions are NFTs that are almost never
    // locked, for good tokens and bad ones alike, so "unlocked" says nothing by itself.
    const lps = (await pGp)?.lp_holders, lpFacts = [];
    if (lps && lps.length) {
      const n = Number((await pGp).lp_holder_count) || lps.length, big = Math.max(...lps.map(h => Number(h.percent) || 0)) * 100, locked = lps.filter(h => h.is_locked == 1).reduce((s, h) => s + Number(h.percent), 0) * 100;
      lpFacts.push(['Liquidity providers', n], ['Largest provider', big.toFixed(0) + '% of the pool'], ['Liquidity locked', locked.toFixed(0) + '%']);
    }
    push({ key: 'scout', name: 'Scout', status: st, tag: st === 'bad' ? 'TOP HEAVY' : st === 'warn' ? 'NOTE' : 'SPREAD', cost: top10 > 50 ? 25 : top10 > 25 ? 10 : count < 25 ? 6 : 0,
      detail: `${count.toLocaleString('en-US')} holders. The ten largest wallets keep ${top10.toFixed(1)}% of supply.`,
      facts: [['Holders', count.toLocaleString('en-US')], ['Top 10 wallets', top10.toFixed(1) + '%'], ['Held by contracts', inContracts.toFixed(1) + '%'], ...lpFacts, ['Read from', src]] });
  } catch (e) { unread('scout', 'Scout', e.message); }

  // 4. Tracer: who sent each top wallet its first funds
  let creator = null, funders = [];
  try {
    // the deployer lookup fails on some contracts; the wallets can still be traced without it
    const top = eoa.slice(0, 6);
    const got = await pool3(top, async h => {
      const j = await getJSON(`${BS}/addresses/${h.a}/transactions?filter=to`, 300, 6500);
      const items = j.items || [], old = !!j.next_page_params;
      const first = [...items].reverse().find(t => t.from?.hash && Number(t.value) > 0);
      return { ...h, old, funder: old ? null : first?.from.hash.toLowerCase() || null, txs: items.length };
    });
    funders = got.filter(Boolean);
    creator = await pCreator; res.creator = creator;
    const fresh = funders.filter(f => !f.old && f.txs <= 3).length, byCreator = funders.filter(f => creator && (f.funder === creator || f.a === creator)).length;
    // the deployer's own record (GoPlus). A deployer that is itself a contract is a factory or a launchpad shared
    // by many tokens, so its record says nothing about this one and is not held against it.
    let rep = null, past = 'no record';
    if (creator) try { rep = (await getJSON(`https://api.gopluslabs.io/api/v1/address_security/${creator}?chain_id=4663`, 600, 6000)).result || null; } catch (e) {}
    const viaContract = rep && rep.contract_address === '1', made = rep && !viaContract ? Number(rep.number_of_malicious_contracts_created) || 0 : 0;
    const marks = rep && !viaContract ? ['honeypot_related_address', 'phishing_activities', 'stealing_attack', 'cybercrime', 'money_laundering', 'financial_crime', 'blacklist_doubt', 'sanctioned'].filter(k => rep[k] === '1') : [];
    const dirty = made > 0 || marks.length > 0;
    if (rep) past = viaContract ? 'a contract (factory or launchpad)' : dirty ? [made && `${made} malicious contract${made > 1 ? 's' : ''} before`, ...marks.map(k => k.replace(/_/g, ' '))].filter(Boolean).join(', ') : 'nothing flagged';
    const st = byCreator >= 2 || dirty ? 'bad' : fresh >= 5 ? 'warn' : 'ok', traced = funders.length > 0;
    push({ key: 'tracer', name: 'Tracer', status: traced || dirty ? st : 'skip', tag: dirty ? 'DEPLOYER FLAGGED' : !traced ? 'NOTHING TO TRACE' : st === 'bad' ? 'DEPLOYER PAID' : st === 'warn' ? 'FRESH WALLETS' : 'TRACED', cost: (byCreator >= 2 ? 15 : fresh >= 5 ? 8 : 0) + (dirty ? 20 : 0),
      detail: (dirty ? `The deployer ${short(creator)} is on record: ${past}. ` : '') + (!traced ? 'No ordinary wallets among the top holders yet.' : `Traced ${funders.length} top wallets. ${fresh} are brand new, ${byCreator} tie back to the deployer.`),
      facts: [['Deployer', creator ? short(creator) : 'unknown'], ['Deployer record', past], ['Wallets traced', funders.length], ['Brand new', fresh]] });
  } catch (e) { unread('tracer', 'Tracer', e.message); }

  // 5. Linker: wallets that share a funder
  {
    const groups = {};
    for (const f of funders) if (f.funder) (groups[f.funder] = groups[f.funder] || []).push(f);
    const multi = Object.entries(groups).filter(([, g]) => g.length >= 2).map(([k, g]) => ({ funder: k, n: g.length, share: g.reduce((s, h) => s + h.share, 0) })).sort((a, b) => b.share - a.share);
    const big = multi[0], devShare = creator ? (holders.find(h => h.a === creator)?.share || 0) : 0;
    let st = big && big.share > 15 ? 'bad' : big && big.share > 5 || devShare > 10 ? 'warn' : 'ok';
    let cost = big && big.share > 15 ? 28 : big && big.share > 5 ? 12 : devShare > 10 ? 10 : 0;
    res.group = big || null; res.devShare = devShare;
    // who bought at launch: wallets in the first blocks (snipers), wallets buying together in one transaction (bundles)
    const L = await pLaunch, lf = [], said = [];
    if (L && L.ok && L.launchpad) {
      const p = v => v == null ? null : Number(v), sn = p(L.sniperPct), bu = p(L.bundlerPct), ins = p(L.insiderPct), dev = p(L.devPct);
      res.launch = { pad: L.launchpad, graduated: L.graduated, progress: L.progress, sn, bu, ins, dev, pool: L.pool || null };
      lf.push(['Launchpad', `${L.launchpad === 'pons' ? 'Pons' : L.launchpad}${L.graduated ? ', graduated' : L.progress != null ? `, ${Math.round(L.progress)}% to graduation` : ''}`]);
      for (const [k, v] of [['Snipers hold', sn], ['Bundles hold', bu], ['Insiders hold', ins], ['Developer holds', dev]]) if (v != null) lf.push([k, v.toFixed(1) + '%']);
      const worse = s => { if (s === 'bad' || (s === 'warn' && st === 'ok')) st = s; };
      if (bu != null && bu > 25) { cost += 18; worse('bad'); said.push(`bundles still hold ${bu.toFixed(1)}%`); } else if (bu != null && bu > 10) { cost += 7; worse('warn'); said.push(`bundles hold ${bu.toFixed(1)}%`); }
      if (sn != null && sn > 15) { cost += 10; worse('warn'); said.push(`snipers hold ${sn.toFixed(1)}%`); }
      if (ins != null && ins > 15) { cost += 8; worse('warn'); said.push(`insiders hold ${ins.toFixed(1)}%`); }
      if (dev != null && dev > 15) { cost += 6; worse('warn'); said.push(`the developer holds ${dev.toFixed(1)}%`); }
    }
    const linked = funders.length > 0 || lf.length > 0;
    const launchNote = said.length ? ` At launch: ${said.join(', ')}.` : lf.length ? ' No heavy sniping or bundling at launch.' : '';
    push({ key: 'linker', name: 'Linker', status: linked ? st : 'skip', tag: !linked ? 'NOTHING TO LINK' : st === 'bad' ? 'BUNDLED' : st === 'warn' ? 'NOTE' : 'NO GROUP', cost,
      detail: (big ? `${big.n} top wallets were funded by ${short(big.funder)} and keep ${big.share.toFixed(1)}% between them.` : devShare > 10 ? `No shared funder, but the deployer still keeps ${devShare.toFixed(1)}%.` : funders.length ? 'No two top wallets share a funder.' : 'No top wallets to trace.') + launchNote,
      facts: [['Groups found', multi.length], ['Largest group', big ? big.share.toFixed(1) + '%' : 'none'], ['Deployer keeps', devShare.toFixed(1) + '%'], ...lf] });
  }

  // 6. Auditor
  try {
    const [code, gp, ownerRaw] = await pAudit;
    if (!code && !gp) throw new Error('neither the chain nor GoPlus answered');
    const has = s => !!code && code.includes('63' + s);   // PUSH4 selector, as the dispatcher compares it
    const on = k => gp?.[k] === '1', tax = k => gp && gp[k] !== undefined && gp[k] !== '' ? Number(gp[k]) * 100 : null;
    const gpOwner = gp?.owner_address ? gp.owner_address.toLowerCase() : null;
    const owner = ownerRaw && ownerRaw.length >= 66 ? '0x' + ownerRaw.slice(-40) : gpOwner, ownerLive = !!owner && owner !== ZERO && owner !== DEAD;
    const sell = tax('sell_tax'), buy = tax('buy_tax');
    res.sellTax = sell; res.buyTax = buy; res.noSell = on('is_honeypot') || on('cannot_sell_all');
    // each finding: [shown when true, points off, hard flag]
    const found = [
      [on('is_honeypot'), 'a sell that fails in simulation (honeypot)', 60, 1], [on('cannot_sell_all'), 'a block on selling everything', 30, 1],
      [sell != null && sell > 10, `a ${sell?.toFixed(0)}% sell tax`, 25, 1], [buy != null && buy > 10, `a ${buy?.toFixed(0)}% buy tax`, 10, 0],
      [on('is_blacklisted') || SEL.blacklist.some(has), 'a blacklist', 25, 1], [(on('is_mintable') || has(SEL.mint)) && ownerLive, 'minting by the owner', 22, 1],
      [on('hidden_owner'), 'a hidden owner', 15, 1], [on('can_take_back_ownership'), 'ownership that can be taken back', 15, 1], [on('selfdestruct'), 'a self-destruct', 15, 1],
      [(on('transfer_pausable') || has(SEL.pause)) && ownerLive, 'a pause switch', 12, 0], [on('is_proxy'), 'a proxy that can be swapped', 8, 0]
    ].filter(f => f[0]);
    // null when nobody could say: unknown is not the same as unverified, or as passing the sell test
    const verified = gp && gp.is_open_source !== undefined ? gp.is_open_source === '1' : null, sold = gp && gp.is_honeypot !== undefined ? gp.is_honeypot === '0' : null;
    const hard = found.some(f => f[3]), st = hard ? 'bad' : found.length || verified === false ? 'warn' : 'ok';
    const cost = found.reduce((s, f) => s + f[2], 0) + (verified === false ? 6 : verified == null ? 3 : 0) + (sold == null ? 3 : 0) + (ownerLive && !found.length ? 3 : 0);
    const src = verified == null ? 'Nobody could say whether the source is open.' : verified ? 'Source is open.' : 'Source is not open.';
    push({ key: 'auditor', name: 'Auditor', status: st, tag: st === 'bad' ? 'TRAP DOOR' : st === 'warn' ? 'NOTE' : 'READS CLEAN', cost,
      detail: found.length ? `The contract carries ${found.map(f => f[1]).join(', ')}.` : `${src} ${owner == null ? 'No owner found.' : ownerLive ? 'An owner is still set.' : 'Ownership is renounced.'} ${sold ? 'A simulated sell goes through.' : sold == null ? 'No sell simulation was available.' : ''} No trap found.`,
      facts: [['Sell test', sold == null ? 'not available' : sold ? 'passes' : 'FAILS'], ['Tax buy / sell', buy == null ? 'unknown' : `${buy.toFixed(1)}% / ${(sell ?? 0).toFixed(1)}%`], ['Source', verified == null ? 'unknown' : verified ? 'open' : 'closed'], ['Owner', owner == null ? 'none' : ownerLive ? short(owner) : 'renounced'], ['Read from', [gp && 'GoPlus', code && 'bytecode'].filter(Boolean).join(' + ')]] });
  } catch (e) { unread('auditor', 'Auditor', e.message); }

  // 7. Judge
  res.score = Math.max(0, Math.min(100, Math.round(res.score)));
  // an hour-old pool or a few dozen holders is not enough history to call anything clean
  const early = (ageMin != null && ageMin < 60) || (res.holders != null && res.holders < 50);
  // a stop that could not be read is not a pass: no clean verdict on a partial reading
  const blind = res.steps.some(s => s.tag === 'NO READ');
  if (early || blind) res.score = Math.min(res.score, 70);
  res.verdict = res.score >= 75 ? 'CLEAN' : res.score >= 45 ? 'RISKY' : 'DANGER';
  const z = zoneFor(res.liq); res.zone = z.zone; res.maxLev = z.max;
  res.platform = res.verdict === 'CLEAN' ? 'long' : res.verdict === 'DANGER' && res.liq >= 20000 ? 'short' : 'depot';
  const why = res.verdict === 'DANGER' && res.platform === 'depot' ? 'Too thin to short, so it goes to the depot.' : res.platform === 'long' ? `Long desk, zone ${z.zone}, at most ${z.max}x.` : res.platform === 'short' ? `Short desk, zone ${z.zone}, at most ${z.max}x.` : blind && res.score === 70 ? 'Depot. One of the stops could not be read, so this cannot be called clean. Run it again.' : early && res.score === 70 ? 'Depot. Under an hour old or under 50 holders: too early to call clean.' : 'Depot. No trade either way.';
  push({ key: 'judge', name: 'Judge', status: res.verdict === 'CLEAN' ? 'ok' : res.verdict === 'RISKY' ? 'warn' : 'bad', tag: `${res.verdict} ${res.score}`, detail: why, facts: [['Score', res.score + ' / 100'], ['Zone', z.zone], ['Max leverage', z.max + 'x']] });
  res.at = Date.now();
  // hand the ticket to the shared crew desk; the page works the same if the desk does not answer
  res.crew = await Promise.race([api('verdict', { addr, verdict: res.verdict, score: res.score, tags: res.steps.map(s => s.tag), pool: pair.pool, quote: pair.quote || '', sym: pair.sym, created: pair.created || 0, liq: pair.liq || 0 }).then(r => r.why || 'filed'), new Promise(r => setTimeout(() => r('no answer'), 3500))]).catch(() => 'offline');
  saveScan(res);
  return res;
}

// the Shuntdesk backend (crew desk, verdict record, leaderboard, conductor)
export async function api(path, body) {
  const r = await fetch('/api/' + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(12000) } : { signal: AbortSignal.timeout(8000) });
  const j = await r.json().catch(() => null);
  if (!r.ok && !j) throw new Error('api ' + r.status);
  return j;
}

// ---------- formatting ----------
export function compact(n) { n = Number(n) || 0; return n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : n.toFixed(n < 10 ? 2 : 0); }
export function sig(n) { n = Number(n) || 0; if (n === 0) return '0'; if (n >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 4 }); const z = Math.floor(-Math.log10(n)); return z >= 4 ? '0.0' + sub(z) + String(Math.round(n * 10 ** (z + 4))).padStart(4, '0').replace(/0+$/, '') : n.toPrecision(4); }
const sub = z => String(z).split('').map(d => '₀₁₂₃₄₅₆₇₈₉'[d]).join('');
export function fmtAge(min) { return min < 1 ? 'under a minute' : min < 60 ? Math.round(min) + ' min' : min < 1440 ? (min / 60).toFixed(1) + ' h' : Math.round(min / 1440) + ' d'; }
export function ageShort(ts) { if (!ts) return '--'; const m = (Date.now() - ts) / 60000; return m < 60 ? Math.max(1, Math.round(m)) + 'm' : m < 1440 ? Math.round(m / 60) + 'h' : Math.round(m / 1440) + 'd'; }
export { short as shortAddr };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
