// /race/: Curve Racing. Five open Pons curves race to the bond mark; the server reads the lanes from the curves themselves
import { createYard } from './yard.js';
import { mountChrome, $, esc, feedYard } from './ui.js';
import { api } from './data.js';

mountChrome('');
feedYard(createYard($('#yard'), { ambient: true }));
const store = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
const COL = ['#2ed3a0', '#6fd3ff', '#f0c75e', '#ff8fb1', '#b79cff'];
let v = null, pick = null, shown = [];   // shown: where each train is drawn, eased toward its read
const hhmm = iso => new Date(iso).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
const left = iso => { const m = Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 60000)); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };

function draw() {
  const c = $('#rc-track'), x = c.getContext('2d'), W = c.width, H = c.height, L = v?.lanes || [], pad = 70, lane = (H - 40) / Math.max(1, L.length);
  x.clearRect(0, 0, W, H); x.fillStyle = '#08090b'; x.fillRect(0, 0, W, H);
  const X = p => pad + (W - pad * 2) * Math.min(100, Math.max(0, p)) / 100;
  // the bond mark
  x.strokeStyle = 'rgba(46,211,160,.8)'; x.setLineDash([6, 6]); x.beginPath(); x.moveTo(X(100), 10); x.lineTo(X(100), H - 10); x.stroke(); x.setLineDash([]);
  x.fillStyle = '#2ed3a0'; x.font = '700 13px "JetBrains Mono", monospace'; x.textAlign = 'center'; x.fillText('BOND', X(100), H - 2);
  L.forEach((l, i) => {
    const y = 30 + i * lane + lane / 2; shown[i] = shown[i] == null ? l.startProgress : shown[i] + (l.progress - shown[i]) * 0.12;
    // the rails and the sleepers
    x.strokeStyle = 'rgba(237,235,230,.12)'; for (let s = pad; s < W - pad; s += 22) { x.beginPath(); x.moveTo(s, y - 9); x.lineTo(s, y + 9); x.stroke(); }
    x.strokeStyle = 'rgba(237,235,230,.35)'; x.lineWidth = 2; for (const d of [-6, 6]) { x.beginPath(); x.moveTo(pad, y + d); x.lineTo(W - pad, y + d); x.stroke(); } x.lineWidth = 1;
    // where it started, and the train
    x.fillStyle = 'rgba(237,235,230,.4)'; x.fillRect(X(l.startProgress) - 1, y - 14, 2, 28);
    const tx = X(shown[i]), mine = v.mine === i;
    x.fillStyle = COL[i]; x.shadowColor = COL[i]; x.shadowBlur = mine ? 22 : 10; x.beginPath(); x.roundRect(tx - 34, y - 11, 34, 22, 5); x.fill(); x.shadowBlur = 0;
    x.fillStyle = '#060708'; x.fillRect(tx - 9, y - 6, 6, 6);
    x.fillStyle = '#edebe6'; x.textAlign = 'left'; x.font = '700 14px "JetBrains Mono", monospace'; x.fillText(`${mine ? '★ ' : ''}$${l.symbol}`, 8, y - 16);
    x.textAlign = 'right'; x.fillStyle = l.bonded ? '#2ed3a0' : '#c9c7c2'; x.fillText(l.bonded ? 'BONDED' : `${l.progress.toFixed(1)}%  ${l.gain >= 0 ? '+' : ''}${l.gain.toFixed(1)}`, W - 8, y - 16);
  });
  if (!L.length) { x.fillStyle = '#8d8b86'; x.textAlign = 'center'; x.font = '15px "JetBrains Mono", monospace'; x.fillText('No race on the line right now: the next starts at the turn of the next four-hour mark.', W / 2, H / 2); }
  requestAnimationFrame(draw);
}
function paint() {
  const L = v.lanes || [];
  $('#rc-title').textContent = v.ok ? `Race ${v.id}` : 'No race yet';
  $('#rc-state').textContent = !v.ok ? 'waiting for five curves between 30% and 80%' : v.done ? 'finished' : v.open ? `backing closes in ${left(v.closes)} · ${v.players} in · ends ${hhmm(v.end)}` : `backing closed · ends ${hhmm(v.end)} · ${v.players} in`;
  $('#rc-lanes').innerHTML = L.map((l, i) => `<div class="rc-lane"><span class="dot" style="background:${COL[i]}"></span><a class="sy" href="/ticket/?a=${l.token}">$${esc(l.symbol)}</a><span>${l.startProgress}% → <b>${l.progress}%</b></span><span>${l.backers} backing</span>
    ${v.open && v.mine == null ? `<button type="button" class="btn ghost ${pick === i ? 'on' : ''}" data-l="${i}">${pick === i ? 'Backing this' : 'Back it'}</button>` : v.mine === i ? '<b class="long">your pick</b>' : '<span></span>'}</div>`).join('');
  $('#rc-form').hidden = !(v.open && v.mine == null);
  if (v.result) { const p = v.result.order.indexOf(v.mine); $('#rc-msg').textContent = v.mine == null ? '' : `YOUR LANE FINISHED ${['FIRST', 'SECOND', 'THIRD', 'FOURTH', 'FIFTH'][p]}: ${v.result.mine || 0} POINTS.`; }
  const y = v.last; $('#rc-last').innerHTML = y ? y.order.map((i, k) => `<p>${k + 1}. $${esc(y.lanes[i].symbol)} · ${y.lanes[i].p0}% → ${y.lanes[i].bonded ? '<b class="long">bonded</b>' : y.lanes[i].p + '%'}</p>`).join('') + `<p class="s">${y.players} backed a lane</p>` : '<p>The first race is still running.</p>';
  $('#rc-board').innerHTML = v.board.length ? v.board.map((b, i) => `<p>${i + 1}. ${esc(b.handle)}${b.holder ? ' <b class="long">HOLDER</b>' : ''} · <b>${b.pts}</b></p>`).join('') : '<p>Nobody yet this week.</p>';
  $('#rc-note').textContent = v.note;
}
async function load() { const me = store.get('sd.bg.h') || ''; if (me) $('#rc-h').value = me; try { v = await api('race?me=' + encodeURIComponent(me)); } catch (e) {} if (!v) { $('#rc-state').textContent = 'not answering right now'; return; } paint(); }
$('#rc-lanes').addEventListener('click', e => { const b = e.target.closest('button[data-l]'); if (!b) return; pick = +b.dataset.l; paint(); });
$('#rc-form').addEventListener('submit', async e => {
  e.preventDefault(); const h = $('#rc-h').value.trim().toLowerCase();
  if (!/^[a-z0-9_]{2,16}$/.test(h)) return $('#rc-msg').textContent = 'A HANDLE OF 2 TO 16 LETTERS, DIGITS OR _.';
  if (pick == null) return $('#rc-msg').textContent = 'BACK A LANE FIRST.';
  let r = null; try { r = await api('race', { handle: h, lane: pick }); } catch (x) {}
  if (r?.ok) { store.set('sd.bg.h', h); v = r; $('#rc-msg').textContent = 'BACKED. THE CHAIN RUNS THE RACE.'; paint(); } else $('#rc-msg').textContent = (r?.why || 'not answering right now').toUpperCase() + '.';
});
load(); setInterval(load, 30000); requestAnimationFrame(draw);
