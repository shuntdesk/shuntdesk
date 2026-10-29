// The first buyers of a StonkFun launch, Fresh Wallets for it, and Stonk Hunters: the wallets that keep buying early into
// StonkFun curves that graduate. A curve's first trades come from its LaunchLab pool: the node's signature list walked
// back to the start (1,000 a call), then the oldest hundred parsed by Helius in one call.
const HOUR = 3600000, WSOL = 'So11111111111111111111111111111111111111112';
const SF = 'https://www.stonkfun.xyz', UA = { 'User-Agent': 'Mozilla/5.0 (compatible; Shuntdesk/1.0; +https://shuntdesk.com)', Accept: 'application/json' };
const rpcUrl = env => `https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}`;
async function rpc(env, method, params) { const j = await (await fetch(rpcUrl(env), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(20000) })).json(); if (j.error) throw new Error(j.error.message); return j.result; }
async function parseSigs(env, sigs) { if (!sigs.length) return []; const r = await fetch(`https://api.helius.xyz/v0/transactions?api-key=${env.HELIUS_API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transactions: sigs.slice(0, 100) }), signal: AbortSignal.timeout(25000) }); const j = await r.json().catch(() => null); return Array.isArray(j) ? j : []; }
// the signatures of an address, oldest first, if it has no more than pages × 1,000 of them
async function oldestSigs(env, addr, pages = 3) {
  let before, all = [];
  for (let p = 0; p < pages; p++) { const s = await rpc(env, 'getSignaturesForAddress', [addr, { limit: 1000, ...(before ? { before } : {}) }]); all.push(...s); if (s.length < 1000) return { sigs: all.reverse(), whole: true }; before = s.at(-1).signature; }
  return { sigs: all.reverse(), whole: false };
}
const poolOf = new Map();
export async function stonkLaunch(mint) {
  if (poolOf.has(mint)) return poolOf.get(mint);
  const j = await (await fetch(`${SF}/api/v2/launches/${mint}`, { headers: UA, signal: AbortSignal.timeout(12000) })).json().catch(() => null);
  const p = j?.pool && j.pool.launchpad === 'launchlab' ? { pool: j.pool.pool, symbol: j.pool.symbol, created: j.pool.createdAt, graduated: !!j.pool.graduatedPool, peak: j.pool.peakMarketCapUsd, quote: j.pool.quoteMint } : null;
  poolOf.set(mint, p); if (poolOf.size > 2000) poolOf.delete(poolOf.keys().next().value); return p;
}
// the first 20 wallets that bought on the curve, in order: a swap that put the token in the fee payer's wallet
export async function firstBuyers(env, mint, pool) {
  const { sigs, whole } = await oldestSigs(env, pool);
  const txs = (await parseSigs(env, sigs.filter(s => !s.err).slice(0, 100).map(s => s.signature))).sort((a, b) => a.slot - b.slot);
  const out = [], launcher = txs[0]?.feePayer || null;
  for (const t of txs) { const w = t.feePayer; if (!w || out.some(o => o.wallet === w)) continue;
    const got = (t.tokenTransfers || []).filter(x => x.mint === mint && x.toUserAccount === w).reduce((s, x) => s + (Number(x.tokenAmount) || 0), 0); if (got <= 0) continue;
    const paid = (t.nativeTransfers || []).filter(n => n.fromUserAccount === w).reduce((s, n) => s + n.amount, 0) / 1e9 + (t.tokenTransfers || []).filter(x => x.mint !== mint && x.fromUserAccount === w).reduce((s, x) => s + (x.mint === WSOL ? Number(x.tokenAmount) || 0 : 0), 0);
    out.push({ wallet: w, slot: t.slot, at: t.timestamp * 1000, got, paid: Math.round(paid * 10000) / 10000, launcher: w === launcher }); if (out.length >= 20) break; }
  return { buyers: out, launcher, whole, read: txs.length };
}
// Fresh Wallets: each first buyer's first transaction on Solana, and who sent it its first SOL
const freshS = new Map(), firstSeen = new Map();
export async function solFresh(env, mint) {
  const hit = freshS.get(mint), now = Date.now(); if (hit && now - hit.t < HOUR) return hit.v;
  if (!env?.HELIUS_API_KEY) return { ok: false, error: 'the Solana index is not set up' };
  const L = await stonkLaunch(mint); if (!L) return { ok: false, error: 'Fresh Wallets on Solana reads StonkFun launches on a LaunchLab curve' };
  const F = await firstBuyers(env, mint, L.pool), at = Date.parse(L.created) || F.buyers[0]?.at || now;
  const buyers = F.buyers.filter(b => !b.launcher);
  // one signature call per wallet: under 1,000 signatures, the oldest one is its very first
  for (const b of buyers) { if (firstSeen.has(b.wallet)) continue; try { const s = await rpc(env, 'getSignaturesForAddress', [b.wallet, { limit: 1000 }]); firstSeen.set(b.wallet, s.length < 1000 ? { t: s.at(-1).blockTime * 1000, sig: s.at(-1).signature, n: s.length } : { t: null, n: 1000 }); } catch (e) {} }
  const firsts = buyers.map(b => firstSeen.get(b.wallet)).filter(f => f?.sig && !f.funder);
  if (firsts.length) for (const t of await parseSigs(env, firsts.map(f => f.sig))) { const f = firsts.find(x => x.sig === t.signature); if (!f) continue; const w = buyers.find(b => firstSeen.get(b.wallet) === f)?.wallet; const n = (t.nativeTransfers || []).filter(x => x.toUserAccount === w).sort((a, b) => b.amount - a.amount)[0]; f.funder = n?.fromUserAccount || (t.feePayer && t.feePayer !== w ? t.feePayer : null); }
  const rows = buyers.map(b => { const f = firstSeen.get(b.wallet) || {}; return { wallet: b.wallet, firstSeen: f.t ? new Date(f.t).toISOString() : null, hoursBefore: f.t ? Math.round((at - f.t) / HOUR * 10) / 10 : null, fresh: f.t != null && at - f.t < 24 * HOUR, busy: f.n >= 1000, funder: f.funder || null, paid: b.paid }; });
  const fund = new Map(); for (const r of rows) if (r.funder) fund.set(r.funder, [...(fund.get(r.funder) || []), r.wallet]);
  const shared = [...fund].filter(([, ws]) => ws.length >= 2).map(([funder, wallets]) => ({ funder, wallets, launcher: funder === F.launcher })).sort((a, b) => b.wallets.length - a.wallets.length).slice(0, 6);
  // a funder with a thousand signatures or more pays out to everyone (an exchange, a bridge): a hub, not one hand
  for (const s of shared) { try { const x = await rpc(env, 'getSignaturesForAddress', [s.funder, { limit: 1000 }]); s.hub = x.length >= 1000; s.sent = x.length; } catch (e) { s.hub = null; } }
  const hands = shared.filter(s => s.hub === false), read = rows.filter(r => r.firstSeen || r.busy), fresh = rows.filter(r => r.fresh).length;
  const v = { ok: true, chain: 'solana', token: mint, launcher: F.launcher, launched: new Date(at).toISOString(), buyers: rows.length, read: read.length, unread: 0, fresh, freshShare: read.length ? Math.round(fresh / read.length * 100) : null,
    sharedFunders: shared, inShared: hands.reduce((s, x) => s + x.wallets.length, 0), level: !read.length ? null : fresh / read.length >= 0.5 || hands.some(x => x.wallets.length >= 4 || x.launcher) ? 'high' : fresh / read.length >= 0.25 || hands.length ? 'some' : 'low',
    rows, note: 'The first 20 wallets that bought on the StonkFun curve, from the oldest trades of its LaunchLab pool, and each one\'s first transaction on Solana. Fresh: first seen less than a day before the launch. Funders with a thousand transactions or more are hubs, left out. Not advice.' };
  freshS.set(mint, { t: now, v }); if (freshS.size > 200) freshS.delete(freshS.keys().next().value);
  return v;
}

// ---------- Stonk Hunters ----------
// Each run: the newest graduations (hits) and the newest launches (to judge a day later). A launch a day old that went
// above $10,000 at its peak and did not graduate is a try. Two tokens' first buyers read a run.
const SH = 'stonkhunters:v1'; let shMem = null;
const shLoad = async env => shMem || (shMem = await env.KV.get(SH).then(s => { const h = s ? JSON.parse(s) : {}; return h.tok ? h : { t: 0, tok: {}, q: {} }; }));
export async function stonkHuntTick(env) {
  const H = await shLoad(env), now = Date.now(); if (now - H.t < 20 * 60000 - 5000) return; H.t = now;   // every 20 minutes: Helius's free credits are shared with every Solana tool
  try {
    const get = async p => (await (await fetch(SF + p, { headers: UA, signal: AbortSignal.timeout(12000) })).json().catch(() => null));
    const [g, r] = await Promise.all([get('/api/public/v1/tokens?status=graduated&sort=newest&pageSize=25'), get('/api/v2/launches/recent?limit=100')]);
    for (const t of g?.data?.tokens || []) if (t.launchpad === 'launchlab') { const x = H.tok[t.mint] = H.tok[t.mint] || { s: t.symbol, at: Date.parse(t.createdAt) || now }; x.o = 1; }
    for (const t of r?.pools || []) if (t.launchpad === 'launchlab' && !H.tok[t.mint] && !H.q[t.mint]) H.q[t.mint] = { s: t.symbol, at: Date.parse(t.createdAt) || now, pool: t.pool };
    // the day-old launches: did they run? one StonkFun read each, a dozen a run
    const due = Object.entries(H.q).filter(([, q]) => now - q.at >= 24 * HOUR).slice(0, 12);
    for (const [m, q] of due) { delete H.q[m]; const t = await get('/api/public/v1/tokens/' + m); const tk = t?.data?.token; if (!tk) continue; if (tk.status === 'graduated') H.tok[m] = { s: q.s, at: q.at, o: 1, pool: q.pool }; else if ((tk.market?.peakMarketCapUsd || 0) >= 10000) H.tok[m] = { s: q.s, at: q.at, o: 0, pool: q.pool }; }
    for (const m in H.q) if (now - H.q[m].at > 3 * 24 * HOUR) delete H.q[m];
    for (const m in H.tok) if (now - H.tok[m].at > 14 * 24 * HOUR) delete H.tok[m];
    // three first-buyer reads a run, hits first
    const todo = Object.entries(H.tok).filter(([, x]) => !x.w && (x.tries || 0) < 3).sort((a, b) => (b[1].o || 0) - (a[1].o || 0) || b[1].at - a[1].at).slice(0, 2);
    let got = 0;
    for (const [m, x] of todo) { try { const L = x.pool ? { pool: x.pool } : await stonkLaunch(m); if (!L) { x.tries = 3; continue; } x.pool = L.pool; const F = await firstBuyers(env, m, L.pool); x.w = F.buyers.filter(b => !b.launcher).map(b => b.wallet); x.by = F.launcher; got++; } catch (e) { x.tries = (x.tries || 0) + 1; H.err = String(e.message || e).slice(0, 120); } }
    H.last = { read: got, asked: todo.length, queued: Object.keys(H.q).length };
  } catch (e) { H.err = String(e.message || e).slice(0, 120); }
  await env.KV.put(SH, JSON.stringify(H));
}
const wilson = (k, n) => { if (!n) return 0; const z = 1.64, p = k / n; return (p + z * z / (2 * n) - z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / (1 + z * z / n); };
export async function stonkHunters(env, wallet) {
  const H = await shLoad(env), now = Date.now(), W = new Map();
  for (const [m, x] of Object.entries(H.tok)) { if (!x.w) continue; x.w.forEach((w, i) => { const v = W.get(w) || { wallet: w, hits: 0, tries: 0, bonded: [] }; W.set(w, v); v.tries++; if (x.o) { v.hits++; v.bonded.push(x.s); } }); }
  const read = Object.values(H.tok).filter(x => x.w), spray = v => v.tries >= 15 && v.tries >= read.length * 0.3;
  const top = [...W.values()].filter(v => v.hits >= 2 && !spray(v)).map(v => ({ ...v, rate: Math.round(v.hits / v.tries * 1000) / 10, score: wilson(v.hits, v.tries) })).sort((a, b) => b.score - a.score || b.hits - a.hits).slice(0, 40);
  const base = { ok: true, chain: 'solana', read: H.t || null, err: H.err || null, last: H.last || null, board: { curves: read.length, bonded: read.filter(x => x.o).length, settled: read.length, queued: Object.keys(H.q || {}).length } };
  if (wallet) { const v = W.get(wallet); const rank = top.findIndex(x => x.wallet === wallet); return { ...base, wallet, found: !!v, rank: rank >= 0 ? rank + 1 : null, hits: v?.hits || 0, tries: v?.tries || 0, rate: v?.tries ? Math.round(v.hits / v.tries * 1000) / 10 : null, hitList: (v?.bonded || []).slice(0, 12).map(s => ({ symbol: s })), open: [], sameHand: [] }; }
  return { ...base, hunters: top.slice(0, 30).map(v => ({ wallet: v.wallet, hits: v.hits, tries: v.tries, rate: v.rate, last: v.bonded.slice(0, 4), openNow: 0, linked: [] })), inNow: [],
    note: 'The first 20 wallets that bought on each StonkFun LaunchLab curve, from its pool\'s oldest trades on Solana. A hit is a curve that graduated; a try is one that reached $10,000 at its peak and did not, a day on. A record of past buys, not a call. Not advice.' };
}
