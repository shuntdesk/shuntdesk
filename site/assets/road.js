// /road/: Road to Bond, the $SHUNT curve read from its contract and what opens at each mark
import { createYard } from './yard.js';
import { mountChrome, $, esc, feedYard } from './ui.js';
import { api } from './data.js';
mountChrome('');
feedYard(createYard($('#yard'), { ambient: true }));
const day = iso => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
(async () => {
  let v = null; try { v = await api('road'); } catch (e) {}
  if (!v?.ok || v.progress == null) { $('#rd-read').textContent = 'the curve did not answer: try again in a minute'; return; }
  const p = v.graduated ? 100 : v.progress;
  $('#rd-p').textContent = p.toFixed(1) + '%'; $('#rd-eth').textContent = v.raised != null ? `${v.raised.toFixed(2)} of ${v.need} ETH raised on the curve` : '';
  $('#rd-read').textContent = v.read ? 'read ' + new Date(v.read).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + ' · every ten minutes' : '';
  $('#rd-fill').style.width = p + '%'; $('#rd-high').style.left = v.highest + '%';
  $('#rd-ticks').innerHTML = v.marks.map(m => `<span style="left:${m.at}%" class="${m.open ? 'on' : ''}">${m.at}%</span>`).join('');
  $('#rd-note2').textContent = v.highest > p + 0.5 ? `HIGHEST SO FAR ${v.highest.toFixed(1)}%: WHAT OPENED THERE STAYS OPEN.` : v.graduated ? '$SHUNT BONDED ON PONS.' : `${(v.need - v.raised).toFixed(2)} ETH TO GO.`;
  $('#rd-marks').innerHTML = v.marks.map(m => `<div class="stub n ${m.open ? 'road-open' : ''}"><div class="in"><div class="cap"><b>${m.at}%</b><span>${m.open ? 'OPEN' + (m.reached ? ' · ' + day(m.reached) : '') : 'opens at ' + m.at + '%'}</span></div><h2>${esc(m.name)}</h2><p>${esc(m.what)}.</p></div></div>`).join('');
})();
