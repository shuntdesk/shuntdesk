// /bingo/: Launch Bingo. Nine things the chain may do between 12:00 and 24:00 UTC; the card fills from the chain's reads
import { createYard } from './yard.js';
import { mountChrome, $, esc, feedYard } from './ui.js';
import { api } from './data.js';

mountChrome('');
feedYard(createYard($('#yard'), { ambient: true }));
const store = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
let v = null, picks = [];
const hhmm = iso => new Date(iso).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
function paint() {
  const mine = v.mine, open = v.open && !mine;
  $('#bn-day').textContent = 'Today · ' + v.day;
  $('#bn-state').textContent = mine ? 'your four are in' : v.open ? `picks close at ${hhmm(v.closes)} · ${v.players} in · ${picks.length} of 4 picked` : `counting ${hhmm(v.counts.from)} to 24:00 UTC · ${v.players} played`;
  $('#bn-card').innerHTML = v.card.map(s => { const on = (mine || picks).includes(s.key);
    return `<button type="button" class="bn-sq ${s.hit ? 'hit' : ''} ${on ? 'on' : ''}" data-k="${s.key}" ${open ? '' : 'disabled'}><span>${esc(s.text)}</span><small>${s.hit ? 'HAPPENED · SEEN BY ' + hhmm(s.at) : on ? 'YOUR PICK' : s.picks + ' picked'}</small></button>`; }).join('');
  $('#bn-form').hidden = !open;
  const y = v.yesterday; $('#bn-y').innerHTML = y ? `<p>${y.card.map(s => `${s.hit ? '<b class="long">●</b>' : '<b class="short">○</b>'} ${esc(s.text)}`).join('<br>')}</p><p class="s">${y.players} played${y.mine ? ` · you got ${y.mine.hit} of 4 for ${y.mine.pts} points` : ''}</p>` : '<p>The first day is still running.</p>';
  $('#bn-board').innerHTML = v.board.length ? v.board.map((b, i) => `<p>${i + 1}. ${esc(b.handle)}${b.holder ? ' <b class="long">HOLDER</b>' : ''} · <b>${b.pts}</b></p>`).join('') : '<p>Nobody yet this week.</p>';
  $('#bn-note').textContent = v.note;
}
async function load() { const me = store.get('sd.bg.h') || ''; if (me) $('#bn-h').value = me; try { v = await api('bingo?me=' + encodeURIComponent(me)); } catch (e) {} if (!v?.ok) { $('#bn-state').textContent = 'not answering right now'; return; } paint(); }
$('#bn-card').addEventListener('click', e => { const b = e.target.closest('button[data-k]'); if (!b || b.disabled) return; const k = b.dataset.k; picks = picks.includes(k) ? picks.filter(x => x !== k) : picks.length < 4 ? [...picks, k] : picks; paint(); });
$('#bn-form').addEventListener('submit', async e => {
  e.preventDefault(); const h = $('#bn-h').value.trim().toLowerCase();
  if (!/^[a-z0-9_]{2,16}$/.test(h)) return $('#bn-msg').textContent = 'A HANDLE OF 2 TO 16 LETTERS, DIGITS OR _.';
  if (picks.length !== 4) return $('#bn-msg').textContent = 'PICK FOUR SQUARES.';
  let r = null; try { r = await api('bingo', { handle: h, picks }); } catch (x) {}
  if (r?.ok) { store.set('sd.bg.h', h); v = r; $('#bn-msg').textContent = 'LOCKED IN. THE CHAIN FILLS THE CARD FROM NOON.'; paint(); } else $('#bn-msg').textContent = (r?.why || 'not answering right now').toUpperCase() + '.';
});
load(); setInterval(load, 60000);
