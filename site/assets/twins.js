// /twins/: Twin Finder. Contracts in the radar's log that run exactly the same code as this one
import { createYard } from './yard.js';
import { mountChrome, $, esc, feedYard } from './ui.js';
import { isAddr } from './data.js';

mountChrome('');
feedYard(createYard($('#yard'), { ambient: true }));
const pc = v => v == null ? '—' : (v > 0 ? '+' : '') + Math.round(v * 100) + '%';
const when = iso => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
async function go(a) {
  history.replaceState(null, '', '?a=' + a); $('#tw-out').hidden = true; $('#tw-msg').textContent = 'READING THE CONTRACT…';
  let v = null; try { v = await (await fetch('/api/twins?a=' + a)).json(); } catch (e) {}
  if (!v?.ok) { $('#tw-msg').textContent = String(v?.why || 'not answering right now').toUpperCase() + '.'; return; }
  if (v.pons) { $('#tw-msg').innerHTML = esc(v.note).toUpperCase() + ` <a href="/dev/?w=${a}">DEV SCORE →</a>`; return; }
  $('#tw-msg').textContent = ''; $('#tw-out').hidden = false;
  $('#tw-f').textContent = v.functions; $('#tw-n').textContent = v.twins.toLocaleString('en-US');
  $('#tw-l').textContent = v.judged ? `${v.lostHalf} of ${v.judged}` : '—'; $('#tw-l').className = 'v sm ' + (v.judged && v.lostHalf / v.judged >= 0.5 ? 'short' : '');
  $('#tw-m').textContent = v.marked.toLocaleString('en-US'); if (v.logged) $('#tw-m-s').textContent = `of ${v.logged.toLocaleString('en-US')} logged tokens compared so far`;
  const l = $('#tw-list'); l.querySelectorAll('.r:not(.h), p').forEach(x => x.remove());
  l.insertAdjacentHTML('beforeend', v.rows.length ? v.rows.map(r => `<a class="r" href="/replay/?a=${r.token}"><span class="sy">${esc(r.symbol || r.token.slice(0, 8))}<small>${r.token.slice(0, 6)}…${r.token.slice(-4)}</small></span><span>${when(r.read)}</span><span></span><span class="${r.worst != null && r.worst <= -0.5 ? 'short' : ''}">${r.worst == null ? 'no result yet' : r.worst <= -1 ? 'no price' : pc(r.worst)}</span><span class="go">→</span></a>`).join('') : '<p class="note" style="margin:10px 0">No twin in the log yet.</p>');
  $('#tw-note').textContent = v.note;
}
$('#tw-form').addEventListener('submit', e => { e.preventDefault(); const a = $('#tw-a').value.trim().toLowerCase(); if (isAddr(a)) go(a); else $('#tw-msg').textContent = 'PASTE A 0x… TOKEN.'; });
const q = new URLSearchParams(location.search).get('a'); if (isAddr(q || '')) { $('#tw-a').value = q; go(q.toLowerCase()); }
