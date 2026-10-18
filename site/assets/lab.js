// Verdict Lab: every candidate rule against what happened to the tokens it would have caught, from the radar's log
import { createYard } from './yard.js';
import { mountChrome, $, esc, feedYard } from './ui.js';
import { api } from './data.js';

mountChrome('');
feedYard(createYard($('#yard'), { ambient: true }));
const pc = v => v == null ? '—' : (v * 100).toFixed(v < 0.1 ? 1 : 0) + '%';
const lift = v => v == null ? '<span class="mut">too few</span>' : `<b class="${v >= 1.5 ? 'short' : v <= 0.67 ? 'long' : ''}">${v.toFixed(2)}×</b>`;
const cell = s => s.n ? `${pc(s.rate)} <small>${s.lostHalf} of ${s.n}</small>` : '<span class="mut">no result yet</span>';

async function paint() {
  let v = null; try { v = await api('lab'); } catch (e) {}
  if (!v?.ok) { $('#lb-read').textContent = 'not answering right now'; return; }
  $('#lb-n').textContent = v.logged.toLocaleString('en-US'); $('#lb-s').textContent = v.scanned.toLocaleString('en-US');
  if (v.since) $('#lb-since').textContent = 'logged since ' + new Date(v.since).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  $('#lb-h1').innerHTML = cell(v.base.h1); $('#lb-h24').innerHTML = cell(v.base.h24);
  const rows = [...v.rules].sort((a, b) => (b.lift24h ?? -1) - (a.lift24h ?? -1) || (b.lift1h ?? -1) - (a.lift1h ?? -1));
  const list = $('#lb-list'); list.querySelectorAll('.r:not(.h)').forEach(n => n.remove());
  list.insertAdjacentHTML('beforeend', rows.map(r => `<div class="r">
    <span class="sy">${esc(r.rule)}</span>
    <span>${r.caught.toLocaleString('en-US')} <small>${r.read ? pc(r.caughtShare) + ' of ' + r.read.toLocaleString('en-US') : 'not read yet'}</small></span>
    <span>${cell(r.caughtThen.h1)}</span><span>${lift(r.lift1h)}</span>
    <span>${cell(r.caughtThen.h24)}</span><span>${lift(r.lift24h)}</span></div>`).join(''));
}
paint(); setInterval(paint, 5 * 60000);
