// The four markets of the paper desk.
//   majors : BTC, ETH and a few more, priced tick by tick from Binance's public stream (no key)
//   stocks : stock tokens that trade on Robinhood Chain, from a fixed list of contract addresses
//   chain  : what is busiest on Robinhood Chain right now
//   paste  : any token by contract address
// A market instrument is { kind, addr, sym, name, price, liq }. For majors `addr` is the Binance symbol.

// `depth` stands in for pool liquidity in the slippage rule: an order book this deep is not simulated level by level
export const MAJORS = [
  { addr: 'BTCUSDT', sym: 'BTC', name: 'Bitcoin', depth: 4e9 }, { addr: 'ETHUSDT', sym: 'ETH', name: 'Ethereum', depth: 2e9 },
  { addr: 'SOLUSDT', sym: 'SOL', name: 'Solana', depth: 8e8 }, { addr: 'BNBUSDT', sym: 'BNB', name: 'BNB', depth: 5e8 },
  { addr: 'XRPUSDT', sym: 'XRP', name: 'XRP', depth: 5e8 }, { addr: 'DOGEUSDT', sym: 'DOGE', name: 'Dogecoin', depth: 3e8 }
];
// Stock tokens on Robinhood Chain. Look-alike contracts exist with vanity addresses that copy the first and last
// characters, so this is a fixed list of addresses, each one checked by hand for real trading volume.
export const STOCKS = [
  ['NVDA', 'NVIDIA', '0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec'], ['TSLA', 'Tesla', '0x322f0929c4625ed5bad873c95208d54e1c003b2d'],
  ['AAPL', 'Apple', '0xaf3d76f1834a1d425780943c99ea8a608f8a93f9'], ['META', 'Meta Platforms', '0xc0d6457c16cc70d6790dd43521c899c87ce02f35'],
  ['GOOGL', 'Alphabet', '0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3'], ['AMZN', 'Amazon', '0x12f190a9f9d7d37a250758b26824b97ce941bf54'],
  ['MSFT', 'Microsoft', '0xe93237c50d904957cf27e7b1133b510c669c2e74'], ['AMD', 'AMD', '0x86923f96303d656e4aa86d9d42d1e57ad2023fdc'],
  ['COIN', 'Coinbase', '0x6330d8c3178a418788df01a47479c0ce7ccf450b'], ['PLTR', 'Palantir', '0x894e1ec2d74ffe5aef8dc8a9e84686accb964f2a'],
  ['MSTR', 'Strategy', '0xec262a75e413fafd0df80480274532c79d42da09'], ['SPY', 'S&P 500 ETF', '0x117cc2133c37b721f49de2a7a74833232b3b4c0c'],
  ['QQQ', 'Nasdaq 100 ETF', '0xd5f3879160bc7c32ebb4dc785f8a4f505888de68']
].map(s => ({ sym: s[0], name: s[1], addr: s[2] }));

export const isMajor = id => !String(id).startsWith('0x');
export const major = id => MAJORS.find(m => m.addr === id);

// Binance market data. The main host carries every trade; the data-only mirror thins the trade stream out
// (measured: 3 trades against 56 in the same six seconds), so it is only the fallback where the main host is blocked.
const HOSTS = [['https://api.binance.com', 'wss://stream.binance.com:443'], ['https://data-api.binance.vision', 'wss://data-stream.binance.vision'], ['https://api.binance.com', 'wss://stream.binance.com:9443']];
export async function klines(sym, limit = 300) {
  for (const h of HOSTS) {
    try {
      const r = await fetch(`${h[0]}/api/v3/klines?symbol=${sym}&interval=1m&limit=${limit}`, { signal: AbortSignal.timeout(8000) });
      if (r.ok) return (await r.json()).map(k => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4] }));
    } catch (e) {}
  }
  return [];
}
// One socket: a once-a-second ticker for every major (so open positions are always marked), plus every trade of
// the one on screen. onTick(symbol, price, open24h | null); onState('live' | 'reconnecting').
export function majorsFeed(onTick, onState = () => {}) {
  let ws = null, host = 0, focus = null, timer = 0, closed = false;
  function open() {
    const streams = MAJORS.map(m => m.addr.toLowerCase() + '@miniTicker').concat(focus ? [focus.toLowerCase() + '@aggTrade'] : []).join('/');
    const sock = ws = new WebSocket(`${HOSTS[host][1]}/stream?streams=${streams}`);
    sock.onopen = () => onState('live');
    sock.onmessage = e => { const d = JSON.parse(e.data).data; if (!d) return; if (d.e === 'aggTrade') onTick(d.s, +d.p, null); else if (d.e === '24hrMiniTicker') onTick(d.s, +d.c, +d.o); };
    sock.onclose = () => { if (closed || sock !== ws) return; onState('reconnecting'); host = (host + 1) % HOSTS.length; timer = setTimeout(open, 1500); };
    sock.onerror = () => sock.close();
  }
  open();
  return {
    focus(sym) { if (sym === focus) return; focus = sym; clearTimeout(timer); const old = ws; ws = null; if (old) old.close(); open(); },
    stop() { closed = true; clearTimeout(timer); if (ws) ws.close(); }
  };
}
