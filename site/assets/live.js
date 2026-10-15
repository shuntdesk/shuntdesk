// The last traded price of a pool, read from its own Swap events on Robinhood Chain.
// Price aggregators lag by a minute or more; the chain does not. Works for Uniswap v3-style pools (one contract
// per pool) and v4 pools (one manager, pools told apart by id). Anything else returns nothing and the caller
// keeps the aggregator's price.
import { rpc } from './data.js';

const V3 = '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67';   // Swap(address,address,int256,int256,uint160,uint128,int24)
const V4 = '0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f';   // Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)
const BACK = 6000;   // blocks to look back for the first price: about ten minutes
const pools = new Map(), decs = new Map();
const hex = n => '0x' + n.toString(16);

async function decimals(a) {
  if (/^0x0{40}$/.test(a)) return 18;   // native ETH in a v4 pool
  if (!decs.has(a)) decs.set(a, rpc('eth_call', [{ to: a, data: '0x313ce567' }, 'latest']).then(r => parseInt(r, 16)));
  return decs.get(a);
}
// both versions put sqrtPriceX96 in the third word of the event data
function ratio(log, st) {
  const s = BigInt('0x' + log.data.slice(130, 194)), r = Number(s * s * 10n ** 18n / (1n << 192n)) / 1e18 * 10 ** (st.d0 - st.d1);
  return st.base0 ? r : 1 / r;   // quote tokens per base token
}
async function setup(pair) {
  const v4 = pair.pool.length === 66, v3 = pair.pool.length === 42;
  if ((!v4 && !v3) || !pair.quote || !pair.native) return { dead: true };
  const [db, dq] = await Promise.all([decimals(pair.addr), decimals(pair.quote)]), base0 = BigInt(pair.addr) < BigInt(pair.quote);
  return { filter: v4 ? { topics: [V4, pair.pool] } : { address: pair.pool, topics: [V3] }, base0, d0: base0 ? db : dq, d1: base0 ? dq : db,
    eth: /^W?ETH$/i.test(pair.quoteSym || ''), quoteUsd: pair.price / pair.native, from: 0, r: null, at: 0, swaps: 0 };
}
// Refreshes every pair in one round. ethUsd, when given, prices ETH-quoted pools at the live ETH price.
// Returns { addr: { price, at, swaps } } for the pairs that have a traded price.
export async function refreshLive(pairs, ethUsd) {
  const out = {}; if (!pairs.length) return out;
  let head; try { head = parseInt(await rpc('eth_blockNumber'), 16); } catch (e) { return out; }
  await Promise.all(pairs.map(async pair => {
    try {
      let st = pools.get(pair.pool); if (!st) pools.set(pair.pool, st = await setup(pair));
      if (st.dead) return;
      const logs = await rpc('eth_getLogs', [{ ...st.filter, fromBlock: hex(st.from || head - BACK), toBlock: hex(head) }]);
      st.from = head + 1; st.fails = 0;
      if (logs.length) { st.r = ratio(logs[logs.length - 1], st); st.at = Date.now(); st.swaps += logs.length; }
      if (st.r) out[pair.addr] = { price: st.r * (st.eth && ethUsd ? ethUsd : st.quoteUsd), at: st.at, swaps: st.swaps };
    } catch (e) { const st = pools.get(pair.pool); if (st && (st.fails = (st.fails || 0) + 1) > 4) st.dead = true; }   // a pool the node will not serve is left to the aggregator
  }));
  return out;
}
export const isLive = pool => { const st = pools.get(pool); return !!st && !st.dead && !!st.r; };
