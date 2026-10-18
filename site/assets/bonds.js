// Bond Watch: every token on the Pons curve, nearest to bonding first, from the server's read of the curves.
import { createYard } from './yard.js';
import { mountChrome, $, esc, feedYard } from './ui.js';
import { api, ageShort } from './data.js';

mountChrome('');
feedYard(createYard($('#yard'), { ambient: true }));
const pct = v => (v * 100).toFixed(v < 0.1 ? 1 : 0) + '%';
const of = r => r.n ? `${r.bonded} of ${r.n}` : 'not yet';

async function paint() {
  let v = null; try { v = await api('bonds'); } catch (e) {}
  if (!v?.ok) { $('#bw-read').textContent = 'not answering right now'; return; }
  const w = v.week;
  $('#bw-rate').textContent = w.rate != null ? pct(w.rate) : '···';
  $('#bw-rate2').textContent = w.launched ? `${w.bonded.toLocaleString('en-US')} bonds against ${w.launched.toLocaleString('en-US')} launches · about 1 in ${Math.round(1 / (w.rate || 1))}` : 'of Pons launches complete the curve';
  $('#bw-days').textContent = `last ${v.days.length} days`;
  $('#bw-on').textContent = v.onCurve.toLocaleString('en-US');
  $('#bw-50').textContent = of(v.reached[50]); $('#bw-75').textContent = of(v.reached[75]);
  const lb = v.bonded[0];
  $('#bw-last').textContent = lb ? lb.symbol : 'none yet'; $('#bw-last2').textContent = lb ? `${ageShort(Date.parse(lb.bonded))} ago, ${lb.hoursToBond} h after launch` : 'in the last two days';
  const cv = v.coverage; $('#bw-read').textContent = `read ${ageShort(v.read)} ago · every ten minutes` + (cv && !cv.complete ? ` · still reading back: ${cv.hours} of 168 hours so far${cv.queued ? `, ${cv.queued.toLocaleString('en-US')} launches queued` : ''}` : '');
  const list = $('#bw-list'); list.querySelectorAll('.r:not(.h)').forEach(n => n.remove());
  list.insertAdjacentHTML('beforeend', v.rows.slice(0, 60).map(r => `<a class="r" href="/ticket/?a=${r.token}">
    <span class="sy">${esc(r.symbol)}<small>${r.token.slice(0, 6)}…${r.token.slice(-4)}</small></span>
    <span><div class="bw-bar"><i style="width:${r.progress}%"></i></div><b>${r.progress}%</b></span>
    <span>${r.raised < 1000 ? r.raised.toFixed(2) : Math.round(r.raised).toLocaleString('en-US')} / ${r.need < 1000 ? r.need : Math.round(r.need).toLocaleString('en-US')} ${esc(r.unit)}</span>
    <span class="${r.perHour == null ? '' : r.perHour > 0 ? 'long' : r.perHour < 0 ? 'short' : ''}">${r.perHour == null ? '···' : (r.perHour > 0 ? '+' : '') + r.perHour + ' pts'}</span>
    <span>${r.etaHours != null ? '~' + (r.etaHours < 1 ? Math.round(r.etaHours * 60) + ' min' : r.etaHours + ' h') : r.perHour != null && r.perHour <= 0 ? 'stalled' : '···'}</span>
    <span>${ageShort(Date.parse(r.launched))}</span><span class="go">→</span></a>`).join(''));
  $('#bw-done').innerHTML = v.bonded.length ? v.bonded.map(b => `<a href="/ticket/?a=${b.token}">${esc(b.symbol)}<small>${ageShort(Date.parse(b.bonded))} ago · ${b.hoursToBond} h</small></a>`).join('') : '<p class="note" style="margin:0">No bond in the last two days.</p>';
}
paint(); setInterval(paint, 60000);
