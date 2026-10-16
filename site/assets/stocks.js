// Stock gap: each stock token's price on Robinhood Chain against the stock's own latest trade and last close.
import { createYard } from './yard.js';
import { mountChrome, $, esc, feedYard } from './ui.js';
import { api, prices, compact, sig } from './data.js';
import { STOCKS } from './markets.js';

mountChrome('');
feedYard(createYard($('#yard'), { ambient: true }));
const SESSION = { regular: 'OPEN', pre: 'PRE-MARKET', post: 'AFTER HOURS', closed: 'CLOSED' };
const gap = (a, b) => a && b ? a / b - 1 : null;
const pct = g => g == null ? '···' : (g >= 0 ? '+' : '') + (g * 100).toFixed(2) + '%';
const cls = g => g == null ? '' : Math.abs(g) < 0.005 ? '' : g > 0 ? 'long' : 'short';
const ago = t => { const m = (Date.now() - t) / 60000; return m < 2 ? 'just now' : m < 60 ? Math.round(m) + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };

async function paint() {
  let ref = null, chain = {};
  await Promise.all([api('stocks').then(r => { ref = r; }).catch(() => {}), prices(STOCKS.map(s => s.addr)).then(m => { chain = m; }).catch(() => {})]);
  const rows = ref?.rows || {}, any = Object.values(rows)[0];
  const state = any ? SESSION[any.session] : 'NO READ';
  $('#s-state').textContent = state; $('#s-state').className = 'v sm ' + (any?.session === 'regular' ? 'long' : '');
  $('#s-when').textContent = new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' }) + ' NEW YORK';
  const live = STOCKS.map(s => ({ s, c: chain[s.addr], r: rows[s.sym] })).filter(x => x.c && x.r);
  const gaps = live.map(x => gap(x.c.price, x.r.last)).filter(g => g != null), avg = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null;
  $('#s-note').textContent = !any ? 'the stock feed did not answer; chain prices only' : any.session === 'regular' ? `the chain trades ${pct(avg)} from the stocks on average` : `the chain keeps trading: ${pct(avg)} from the latest trades on average`;
  $('#s-read').textContent = ref?.read ? `stocks read ${ago(ref.read)} · refreshes every 30 seconds` : 'refreshes every 30 seconds';
  const list = $('#s-list'); list.querySelectorAll('.r:not(.h)').forEach(n => n.remove());
  list.insertAdjacentHTML('beforeend', STOCKS.map(s => ({ s, c: chain[s.addr], r: rows[s.sym] })).sort((a, b) => Math.abs(gap(b.c?.price, b.r?.last) ?? 0) - Math.abs(gap(a.c?.price, a.r?.last) ?? 0)).map(({ s, c, r }) => {
    const g1 = gap(c?.price, r?.last), g2 = gap(c?.price, r?.close);
    return `<a class="r" href="/desk/?m=stocks&a=${s.addr}"><span class="sy">${esc(s.sym)}<small>${esc(s.name)}</small></span><span>${c ? '$' + sig(c.price) : 'no pool'}</span>
      <span>${r ? '$' + sig(r.last) + `<small>${ago(r.lastAt)}</small>` : '···'}</span><span class="${cls(g1)}"><b>${pct(g1)}</b></span>
      <span>${r?.close ? '$' + sig(r.close) : '···'}</span><span class="${cls(g2)}">${pct(g2)}</span><span>${c ? '$' + compact(c.liq) : '···'}</span></a>`;
  }).join(''));
}
paint(); setInterval(paint, 30000);
