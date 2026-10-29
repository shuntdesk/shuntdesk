// Wallet Wrapped and Profit Map on Solana, from Helius' parsed transactions. A swap is read from what moved in it: the
// SOL (native and wrapped) a wallet put in or took out, against the one other token it got or gave. Swaps against any
// other quote (a stock token, another coin) are counted apart, not priced. Prices now from Jupiter's public price API.
const WSOL = 'So11111111111111111111111111111111111111112', HOUR = 3600000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function parsed(env, addr, pages, until = 0) {
  const out = []; let before = '';
  for (let p = 0; p < pages; p++) {
    const r = await fetch(`https://api.helius.xyz/v0/addresses/${addr}/transactions?api-key=${env.HELIUS_API_KEY}&limit=100${before ? '&before=' + before : ''}`, { signal: AbortSignal.timeout(20000) });
    const j = await r.json().catch(() => null); if (!Array.isArray(j)) { if (p === 0) throw new Error('the Solana index did not answer'); break; }
    out.push(...j); if (j.length < 100 || (until && j.at(-1).timestamp * 1000 < until)) break; before = j.at(-1).signature;
  }
  return out;
}
export async function jupPrices(mints) {
  const out = {}; const ids = [...new Set(mints)];
  for (let i = 0; i < ids.length; i += 50) { try { const j = await (await fetch('https://lite-api.jup.ag/price/v3?ids=' + ids.slice(i, i + 50).join(','), { signal: AbortSignal.timeout(10000) })).json(); for (const [m, v] of Object.entries(j || {})) if (v?.usdPrice) out[m] = { usd: v.usdPrice, launchpad: v.launchpad || null }; } catch (e) {} }
  return out;
}
// one swap as seen by one wallet: SOL in or out against one other token
function swapOf(t, w) {
  let sol = 0; const tok = {};
  for (const n of t.nativeTransfers || []) { if (n.fromUserAccount === w) sol -= n.amount / 1e9; if (n.toUserAccount === w) sol += n.amount / 1e9; }
  for (const x of t.tokenTransfers || []) { const v = Number(x.tokenAmount) || 0; if (x.mint === WSOL) { if (x.fromUserAccount === w) sol -= v; if (x.toUserAccount === w) sol += v; continue; } if (x.fromUserAccount === w) tok[x.mint] = (tok[x.mint] || 0) - v; if (x.toUserAccount === w) tok[x.mint] = (tok[x.mint] || 0) + v; }
  const moved = Object.entries(tok).filter(([, v]) => Math.abs(v) > 0);
  if (moved.length !== 1) return { other: moved.length > 1 };
  const [mint, amt] = moved[0];
  if (amt > 0 && sol < 0) return { mint, side: 'buy', sol: -sol, amt };
  if (amt < 0 && sol > 0) return { mint, side: 'sell', sol, amt: -amt };
  return { other: true };
}
const wraps = new Map();
export async function solWrapped(env, w) {
  const hit = wraps.get(w), now = Date.now(); if (hit && now - hit.t < 30 * 60000) return hit.v;
  if (!env?.HELIUS_API_KEY) return { ok: false, error: 'the Solana index is not set up' };
  const since = now - 7 * 24 * HOUR, txs = (await parsed(env, w, 4, since)).filter(t => t.timestamp * 1000 >= since);
  const T = new Map(); let other = 0;
  for (const t of txs) { if (t.type !== 'SWAP' && !/LAUNCHLAB|PUMP|RAYDIUM|JUPITER|METEORA|ORCA/.test(t.source || '')) continue; const s = swapOf(t, w); if (!s.mint) { if (s.other) other++; continue; }
    const x = T.get(s.mint) || (T.set(s.mint, { token: s.mint, in: 0, out: 0, got: 0, gave: 0, buys: 0, sells: 0, src: t.source }), T.get(s.mint)); if (s.side === 'buy') { x.in += s.sol; x.got += s.amt; x.buys++; } else { x.out += s.sol; x.gave += s.amt; x.sells++; } }
  const list = [...T.values()];
  if (!list.length) { const v = { ok: true, chain: 'solana', unit: 'SOL', wallet: w, tokens: 0, read: new Date().toISOString(), note: 'No swap against SOL by this wallet in the last seven days.' }; wraps.set(w, { t: now, v }); return v; }
  // what is still held, at the price now
  const j = await (await fetch(`https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAssetsByOwner', params: { ownerAddress: w, page: 1, limit: 1000, displayOptions: { showFungible: true } } }), signal: AbortSignal.timeout(20000) })).json().catch(() => null);
  const bal = {}, sym = {}; for (const a of j?.result?.items || []) if (a.token_info) { bal[a.id] = a.token_info.balance / 10 ** (a.token_info.decimals || 0); sym[a.id] = a.token_info.symbol || a.content?.metadata?.symbol || null; }
  // the names of the ones no longer held, in one call
  const nameless = list.filter(x => !sym[x.token]).map(x => x.token).slice(0, 100);
  if (nameless.length) try { const b = await (await fetch(`https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAssetBatch', params: { ids: nameless } }), signal: AbortSignal.timeout(15000) })).json(); for (const a of b?.result || []) if (a?.id) sym[a.id] = a.token_info?.symbol || a.content?.metadata?.symbol || null; } catch (e) {}
  const px = await jupPrices([WSOL, ...list.map(x => x.token)]), solUsd = px[WSOL]?.usd || 0;
  for (const x of list) { x.symbol = sym[x.token] || null; x.stonk = px[x.token]?.launchpad === 'stonkfun'; x.bal = bal[x.token] || 0; x.held = x.bal && px[x.token]?.usd && solUsd ? x.bal * px[x.token].usd / solUsd : 0; x.pnl = x.out + x.held - x.in; x.mult = x.in ? (x.out + x.held) / x.in : null; }
  const ranked = list.filter(x => x.in > 0).sort((a, b) => b.pnl - a.pnl), r4 = v => Math.round(v * 10000) / 10000;
  const pick = x => x && { token: x.token, symbol: x.symbol, pnl: r4(x.pnl), mult: x.mult != null ? Math.round(x.mult * 100) / 100 : null, in: r4(x.in), stonk: x.stonk };
  const spent = list.reduce((s, x) => s + x.in, 0), back = list.reduce((s, x) => s + x.out, 0), held = list.reduce((s, x) => s + x.held, 0);
  const v = { ok: true, chain: 'solana', unit: 'SOL', solUsd, wallet: w, read: new Date().toISOString(), full: txs.length < 400, tokens: list.length, buys: list.reduce((s, x) => s + x.buys, 0), sells: list.reduce((s, x) => s + x.sells, 0),
    spent: r4(spent), back: r4(back), held: r4(held), pnl: r4(back + held - spent), won: ranked.filter(x => x.pnl > 0).length, lost: ranked.filter(x => x.pnl < 0).length, exitLiquidity: ranked.filter(x => x.mult != null && x.mult < 0.5).length,
    stonkTokens: list.filter(x => x.stonk).length, stonkPnl: r4(list.filter(x => x.stonk).reduce((t, x) => t + x.pnl, 0)), stonkIn: r4(list.filter(x => x.stonk).reduce((t, x) => t + x.in, 0)), stonkBest: pick(list.filter(x => x.stonk && x.in > 0).sort((a, b) => b.pnl - a.pnl)[0]), otherQuote: other, best: pick(ranked[0]), worst: pick(ranked.at(-1)), rows: ranked.slice(0, 20).map(pick),
    note: 'The last seven days on Solana, from Helius\' parsed transactions: SOL in for each token received in a swap, SOL back for each one given, and what is still held at Jupiter\'s price now. Swaps against another quote token are not priced. Not advice.' };
  wraps.set(w, { t: now, v }); if (wraps.size > 200) wraps.delete(wraps.keys().next().value);
  return v;
}
// Profit Map for a StonkFun (or any SOL-paired) token: what its largest holders paid in their swaps of it, against the
// price now. Read from the token's own recent swap history and its 20 largest accounts.
const profs = new Map();
export async function solProfit(env, mint, owners) {
  const hit = profs.get(mint), now = Date.now(); if (hit && now - hit.t < 10 * 60000) return hit.v;
  if (!env?.HELIUS_API_KEY) return { ok: false, error: 'the Solana index is not set up' };
  const [txs, ow, px] = await Promise.all([parsed(env, mint, 6), owners(env, mint), jupPrices([WSOL, mint])]);
  const solUsd = px[WSOL]?.usd, price = px[mint]?.usd && solUsd ? px[mint].usd / solUsd : null; if (!price) return { ok: false, error: 'no price for this token right now' };
  const W = new Map();
  for (const t of txs) { const w = t.feePayer; if (!w) continue; const s = swapOf(t, w); if (s.mint !== mint) continue; const x = W.get(w) || (W.set(w, { wallet: w, in: 0, out: 0, got: 0, gave: 0 }), W.get(w)); if (s.side === 'buy') { x.in += s.sol; x.got += s.amt; } else { x.out += s.sol; x.gave += s.amt; } }
  const held = ow.list.filter(o => o.isWallet).map(o => { const x = W.get(o.wallet), cost = x?.got ? x.in / x.got : null; return { wallet: o.wallet, share: o.share, tokens: o.tokens, cost, mult: cost ? price / cost : null, paid: x?.in || null, realized: x ? x.out - (x.got ? x.in * Math.min(1, x.gave / x.got) : 0) : null }; });
  const known = held.filter(h => h.mult != null), T = known.reduce((s, h) => s + h.share, 0);
  const band = (a, b) => { const g = known.filter(h => h.mult >= a && h.mult < b); return { wallets: g.length, share: T ? Math.round(g.reduce((s, h) => s + h.share, 0) / T * 1000) / 10 : 0 }; };
  const v = { ok: true, chain: 'solana', unit: 'SOL', token: mint, price, priceUsd: px[mint].usd, read: txs.length, oldest: txs.length ? new Date(txs.at(-1).timestamp * 1000).toISOString() : null, holders: held.length, priced: known.length,
    inProfit: T ? Math.round(known.filter(h => h.mult >= 1).reduce((s, h) => s + h.share, 0) / T * 1000) / 10 : null,
    bands: [{ band: 'under', ...band(0, 1) }, { band: '1–2x', ...band(1, 2) }, { band: '2–5x', ...band(2, 5) }, { band: '5x+', ...band(5, Infinity) }],
    top: held.slice(0, 15).map(h => ({ wallet: h.wallet, share: Math.round(h.share * 100) / 100, cost: h.cost, mult: h.mult != null ? Math.round(h.mult * 100) / 100 : null, paid: h.paid != null ? Math.round(h.paid * 10000) / 10000 : null, realized: h.realized != null ? Math.round(h.realized * 10000) / 10000 : null })),
    note: 'The 20 largest token accounts, wallets only, against what each wallet paid in SOL in its swaps of this token among the last 600 transactions. A holder whose buys are older than that, or who got the tokens by transfer, shows no cost. Prices from Jupiter. Not advice.' };
  profs.set(mint, { t: now, v }); if (profs.size > 200) profs.delete(profs.keys().next().value);
  return v;
}
