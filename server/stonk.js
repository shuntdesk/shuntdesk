// StonkFun: a Solana launchpad on Raydium LaunchLab (stonkfun.xyz). Market data from its own public API (no key, 300
// a minute), and each curve read from its LaunchLab pool account on chain: the quote raised against the quote it
// needs to migrate. StonkFun's own graduationProgress is market cap against a dollar mark, which is not the curve.
const SF = 'https://www.stonkfun.xyz', LAUNCHLAB = 'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj';
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; Shuntdesk/1.0; +https://shuntdesk.com)', Accept: 'application/json' };
const cache = new Map();
async function sf(path, ttl = 30000) {
  const hit = cache.get(path), now = Date.now(); if (hit && now - hit.t < ttl) return hit.v;
  const r = await fetch(SF + path, { headers: UA, signal: AbortSignal.timeout(12000) });
  const j = await r.json().catch(() => null); if (!r.ok || !j) throw new Error('stonkfun said ' + r.status);
  cache.set(path, { t: now, v: j }); if (cache.size > 300) cache.delete(cache.keys().next().value);
  return j;
}
// a LaunchLab pool account: status, decimals, the curve's reserves and its raise target (Raydium's PoolState layout)
function poolState(b64) {
  const b = Buffer.from(b64, 'base64'); if (b.length < 77) return null;
  const u = o => b.readBigUInt64LE(o), decA = b[18], decB = b[19];
  const realB = Number(u(61)) / 10 ** decB, raise = Number(u(69)) / 10 ** decB;
  return { status: b[17], migrated: b[17] === 2, sold: Number(u(53)) / 10 ** decA, forSale: Number(u(29)) / 10 ** decA, raised: realB, target: raise, progress: raise ? Math.min(100, realB / raise * 100) : null };
}
export async function stonkCurves(env, pools) {
  if (!env?.HELIUS_API_KEY || !pools.length) return pools.map(() => null);
  const r = await fetch(`https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getMultipleAccounts', params: [pools.slice(0, 100), { encoding: 'base64' }] }), signal: AbortSignal.timeout(12000) });
  const j = await r.json().catch(() => null);
  return (j?.result?.value || pools.map(() => null)).map(v => v && v.owner === LAUNCHLAB ? poolState(v.data[0]) : null);
}
const row = (t, curve) => ({ mint: t.mint, pool: t.pool, name: t.name, symbol: t.symbol, image: t.imageUrl || null, quote: t.quote?.symbol || t.quoteSymbol || null, quoteMint: t.quote?.mint || t.quoteMint || null,
  marketCap: t.market?.marketCapUsd ?? t.marketCapUsd ?? null, volume24h: t.market?.volume24hUsd ?? t.volume24hUsd ?? null, liquidity: t.market?.liquidityUsd ?? null, peak: t.market?.peakMarketCapUsd ?? t.peakMarketCapUsd ?? null,
  change24h: t.market?.priceChange24h ?? null, status: t.status, sfProgress: t.graduationProgress != null ? Math.round(t.graduationProgress * 1000) / 10 : null, created: t.createdAt || null, graduated: t.graduatedAt || null, curve: curve || null });
// one token: StonkFun's record (its creator) and its curve from chain
export async function stonkToken(env, mint) {
  const j = await sf('/api/public/v1/tokens/' + mint, 20000).catch(e => ({ error: e.message }));
  const t = j?.data?.token; if (!t) return { ok: false, error: j?.error ? String(j.error.message || j.error).slice(0, 80) : 'not a StonkFun token' };
  const [curve] = t.status === 'graduated' ? [null] : await stonkCurves(env, [t.pool]).catch(() => [null]);
  return { ok: true, ...row(t, curve), creator: j.data.launch?.creator || null, launchpad: t.launchpad, mode: t.mode, links: t.links || {}, startMarketCap: j.data.launch?.startMarketCapUsd ?? null,
    note: 'Market data from StonkFun. The curve is read from its Raydium LaunchLab pool on Solana: the quote it raised against the quote it needs to move to a Raydium pool. StonkFun\'s own progress is market cap against $40,000. Not advice.' };
}
// the newest launches, the most traded and the ones closest to graduating, each with its curve from chain
export async function stonkBoard(env, kind) {
  const path = kind === 'tape' ? '/api/v2/launches/recent?limit=40' : kind === 'hot' ? '/api/public/v1/tokens?sort=volume&pageSize=20' : kind === 'near' ? '/api/public/v1/tokens?status=aboutToGraduate&sort=marketCap&pageSize=20' : kind === 'graduated' ? '/api/public/v1/tokens?status=graduated&sort=newest&pageSize=15' : null;
  if (!path) return { ok: false, error: 'tape, hot, near or graduated' };
  const j = await sf(path, kind === 'tape' ? 15000 : 45000);
  const list = j.pools || j.data?.tokens || [];
  const curves = kind === 'graduated' ? list.map(() => null) : await stonkCurves(env, list.filter(t => t.status !== 'graduated').map(t => t.pool)).catch(() => []);
  let k = 0; const rows = list.map(t => row(t, t.status !== 'graduated' ? curves[k++] : null));
  return { ok: true, kind, read: new Date().toISOString(), rows, note: 'From StonkFun\'s public API; each curve read from its LaunchLab pool on Solana. Not advice.' };
}
export async function stonkStats() { const j = await sf('/api/public/v1/stats', 300000); return { ok: true, ...j.data }; }
