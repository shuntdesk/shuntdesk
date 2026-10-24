// /shadow/: the Bond Hunters copied on paper by fixed rules, every trade in public
import { createYard } from './yard.js';
import { mountChrome, $, esc, feedYard } from './ui.js';
import { api } from './data.js';
mountChrome('');
feedYard(createYard($('#yard'), { ambient: true }));
const eth = v => `${v >= 0 ? '+' : ''}${v.toFixed(4)}`;
const pct = v => v == null ? '—' : `${v >= 0 ? '+' : ''}${v}%`;
const cls = v => v == null ? '' : v >= 0 ? 'long' : 'short';
const when = iso => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
(async () => {
  let v = null; try { v = await api('shadow'); } catch (e) {}
  if (!v?.ok) { $('#sh-open').innerHTML = $('#sh-closed').innerHTML = '<p class="note">COULD NOT READ THE DESK RIGHT NOW.</p>'; return; }
  $('#sh-pnl').textContent = v.trades ? eth(v.pnl) : '—'; $('#sh-pnl').className = 'v ' + cls(v.pnl); $('#sh-pnl-s').textContent = v.trades ? 'paper ETH, every closed trade' : 'no trade closed yet';
  $('#sh-n').textContent = v.trades; $('#sh-n-s').textContent = v.trades ? `${v.wins} won, ${v.trades - v.wins} lost` : 'closed';
  $('#sh-wk').textContent = v.week.trades ? eth(v.week.pnl) : '—'; $('#sh-wk-s').textContent = `${v.week.trades} closed in 7 days`;
  $('#sh-o').textContent = v.open.length;
  $('#sh-open').innerHTML = v.open.length ? `<div class="r h"><span>TOKEN</span><span>OPENED</span><span>HUNTERS</span><span>NOW</span><span>CURVE</span></div>` + v.open.map(o => `<a class="r" href="/ticket/?a=${o.token}"><span class="sy">${esc(o.symbol)}<small>${o.token.slice(0, 6)}…${o.token.slice(-4)}</small></span><span>${when(o.opened)}</span><span>${o.hunters}</span><span class="${cls(o.nowRet)}">${pct(o.nowRet)}</span><span>${o.progress ?? o.entryProgress}%</span></a>`).join('')
    : '<p class="note">NO POSITION OPEN. THE DESK WAITS FOR THREE OF THE BEST HUNTERS IN ONE CURVE.</p>';
  $('#sh-closed').innerHTML = v.closed.length ? `<div class="r h"><span>TOKEN</span><span>CLOSED</span><span>WHY</span><span>RETURN</span><span>PAPER ETH</span></div>` + v.closed.map(o => `<a class="r" href="/ticket/?a=${o.token}"><span class="sy">${esc(o.symbol)}<small>${o.hunters} hunters in</small></span><span>${o.closed ? when(o.closed) : '—'}</span><span>${esc((o.why || '').toUpperCase())}</span><span class="${cls(o.ret)}">${pct(o.ret)}</span><span class="${cls(o.pnl)}">${o.pnl != null ? eth(o.pnl) : '—'}</span></a>`).join('')
    : '<p class="note">NOTHING CLOSED YET. EVERY TRADE WILL STAY HERE, LOSSES INCLUDED.</p>';
  if (v.since) $('#sh-since').textContent = `Running since ${when(v.since)} UTC. ` + $('#sh-since').textContent;
})();
