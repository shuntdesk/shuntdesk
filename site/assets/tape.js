// /tape/: every Buy and Sell on every Pons curve, read by the browser from the public node every five seconds
import { createYard } from './yard.js';
import { mountChrome, $, $$, esc, feedYard } from './ui.js';
import { api, rpc } from './data.js';
mountChrome('');
feedYard(createYard($('#yard'), { ambient: true }));
const T_BUY = '0xec36bf571f136799e8dc0b0b8bea4b04d8bd3d43de838aab0d5fc21d4cbfc455', T_SELL = '0x8113d738abdcb6b38357e9d53a54a7157861a09031b453651f0fe7fe151f59df';
const WIN = 6000, BIG = 0.25;   // ten minutes of blocks; a trade this size or more is lit
const hex = n => '0x' + n.toString(16), addr = w => '0x' + w.slice(26).toLowerCase();
const word = (d, i) => Number(BigInt('0x' + d.slice(2 + 64 * i, 66 + 64 * i)) / 10n ** 12n) / 1e6;
const w4 = a => a.slice(0, 6) + '…' + a.slice(-4);
let map = { curves: {}, hunters: [] }, hunt = new Map(), trades = [], last = 0, filter = 'all', clock = null;
// a curve the board does not list yet (minutes old, or under 1%): its token from token(), the token's symbol from symbol()
const str = h => { try { const x = h.slice(2), n = parseInt(x.slice(64, 128), 16); return new TextDecoder().decode(new Uint8Array(x.slice(128, 128 + n * 2).match(/../g).map(b => parseInt(b, 16)))).replace(/[^ -~]/g, '').slice(0, 16); } catch (e) { return null; } };
const asked = new Set();
async function name(curves) {
  for (const c of curves.filter(c => !map.curves[c] && !asked.has(c)).slice(0, 8)) { asked.add(c);
    try { const t = '0x' + (await rpc('eth_call', [{ to: c, data: '0xfc0c546a' }, 'latest'])).slice(-40), sym = str(await rpc('eth_call', [{ to: t, data: '0x95d89b41' }, 'latest'])); map.curves[c] = [t, sym, null, null, 0]; for (const x of trades) if (x.curve === c) { x.token = t; x.symbol = sym; } } catch (e) {} }
}
async function loadMap() { try { const v = await api('tapemap'); if (v?.ok) { map = v; hunt = new Map(v.hunters.map(([w, h, t]) => [w, `${h}/${t}`])); } } catch (e) {} }
function toTrade(l, side) {
  const curve = l.address.toLowerCase(), m = map.curves[curve] || [], b = parseInt(l.blockNumber, 16);
  const wallet = addr(side === 'buy' ? l.topics[2] : l.topics[1]), eth = word(l.data, side === 'buy' ? 0 : 1);
  return { key: l.transactionHash + l.logIndex, b, side, curve, token: m[0] || null, symbol: m[1] || null, dev: m[2] && m[2] === wallet, hunter: hunt.get(wallet) || null, progress: m[3], wallet, eth };
}
async function read() {
  const head = parseInt(await rpc('eth_blockNumber'), 16); if (head <= last) return;
  const from = last ? last + 1 : head - WIN;
  const [buys, sells, blk] = await Promise.all([rpc('eth_getLogs', [{ topics: [T_BUY], fromBlock: hex(from), toBlock: hex(head) }]), rpc('eth_getLogs', [{ topics: [T_SELL], fromBlock: hex(from), toBlock: hex(head) }]), rpc('eth_getBlockByNumber', [hex(head), false])]);
  clock = { head, t: parseInt(blk.timestamp, 16) * 1000 };
  const seen = new Set(trades.map(t => t.key));
  for (const t of [...buys.map(l => toTrade(l, 'buy')), ...sells.map(l => toTrade(l, 'sell'))]) if (!seen.has(t.key)) { t.fresh = !!last; trades.push(t); }
  last = head; trades = trades.filter(t => t.b > head - WIN).sort((a, b) => b.b - a.b);
  draw(); await name([...new Set(trades.map(t => t.curve))]); draw();
}
const when = b => { if (!clock) return ''; const s = Math.max(0, Math.round((clock.head - b) / 10)); return s < 60 ? s + 's' : Math.round(s / 60) + 'm'; };
function draw() {
  const buy = trades.filter(t => t.side === 'buy').reduce((s, t) => s + t.eth, 0), sell = trades.filter(t => t.side === 'sell').reduce((s, t) => s + t.eth, 0);
  $('#tp-b').textContent = buy.toFixed(2); $('#tp-s').textContent = sell.toFixed(2); $('#tp-n').textContent = trades.length.toLocaleString('en-US'); $('#tp-h').textContent = '#' + last.toLocaleString('en-US');
  const net = new Map(); for (const t of trades) { const x = net.get(t.curve) || { ...t, net: 0, n: 0, buyers: new Set() }; x.net += t.side === 'buy' ? t.eth : -t.eth; x.n++; if (t.side === 'buy') x.buyers.add(t.wallet); net.set(t.curve, x); }
  const hot = [...net.values()].filter(x => x.net > 0).sort((a, b) => b.net - a.net).slice(0, 5);
  $('#tp-hot').innerHTML = hot.length ? `<div class="r h"><span>TOKEN</span><span>NET IN</span><span>TRADES</span><span>BUYERS</span><span>CURVE</span></div>` + hot.map(x => `<a class="r" href="${x.token ? '/profit/?a=' + x.token : '#'}"><span class="sy">${esc(x.symbol || 'new curve')}<small>${x.token ? w4(x.token) : w4(x.curve)}</small></span><span class="long">+${x.net.toFixed(3)} ETH</span><span>${x.n}</span><span>${x.buyers.size}</span><span>${x.progress != null ? x.progress + '%' : '—'}</span></a>`).join('') : '<p class="note">NO CURVE TOOK IN MORE THAN IT PAID OUT IN THE LAST TEN MINUTES.</p>';
  const rows = trades.filter(t => filter === 'all' || (filter === 'big' && t.eth >= BIG) || (filter === 'hunt' && t.hunter) || (filter === 'dev' && t.dev)).slice(0, 80);
  $('#tp-list').innerHTML = rows.length ? `<div class="r h"><span>WHEN</span><span>SIDE</span><span>TOKEN</span><span>ETH</span><span>WALLET</span></div>` + rows.map(t => `<a class="r${t.fresh ? ' tp-new' : ''}${t.eth >= BIG ? ' tp-big' : ''}" href="${t.token ? '/ticket/?a=' + t.token : '#'}"><span>${when(t.b)}</span><span style="color:var(--${t.side === 'buy' ? 'long' : 'short'})">${t.side.toUpperCase()}</span><span class="sy">${esc(t.symbol || 'new curve')}<small>${t.progress != null ? t.progress + '%' : ''}</small></span><span class="${t.eth >= BIG ? (t.side === 'buy' ? 'long' : 'short') : ''}">${t.eth.toFixed(t.eth >= 1 ? 2 : 4)}</span><span>${w4(t.wallet)}${t.dev ? ' <b class="short">LAUNCHER</b>' : ''}${t.hunter ? ` <b class="long">HUNTER ${t.hunter}</b>` : ''}</span></a>`).join('')
    : '<p class="note">NOTHING ON THIS FILTER IN THE LAST TEN MINUTES.</p>';
  for (const t of trades) t.fresh = false;
}
$$('#tp-f button').forEach(b => b.addEventListener('click', () => { filter = b.dataset.f; $$('#tp-f button').forEach(x => x.classList.toggle('on', x === b)); draw(); }));
(async () => {
  await loadMap();
  const tick = async () => { try { await read(); $('#tp-h-s').textContent = 'read every 5 seconds'; } catch (e) { $('#tp-h-s').textContent = 'the node did not answer: trying again'; } };
  await tick(); setInterval(() => { if (!document.hidden) tick(); }, 5000); setInterval(loadMap, 5 * 60000);
})();
