// /bond-game/: Will it bond? Five open Pons curves a day, called before 12:00 UTC, answered by the chain at midnight
import { createYard } from './yard.js';
import { mountChrome, $, esc, feedYard } from './ui.js';
import { api } from './data.js';

mountChrome('');
feedYard(createYard($('#yard'), { ambient: true }));
const store = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
let picks = [], view = null;
const hhmm = iso => new Date(iso).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';

function draw() {
  const v = view, locked = !!v.mine || !v.open;
  $('#bg-day').textContent = 'Today · ' + v.day;
  $('#bg-state').textContent = v.mine ? 'your calls are in' : v.open ? `calls close at ${hhmm(v.closes)} · ${v.players} in` : `calls closed · the chain answers at ${hhmm(v.resolves)}`;
  $('#bg-list').innerHTML = v.tokens.length ? v.tokens.map((t, i) => { const mine = v.mine ? v.mine[i] : picks[i];
    return `<div class="bg-row"><a class="sy" href="/ticket/?a=${t.token}">${esc(t.symbol)}<small>${t.token.slice(0, 6)}…${t.token.slice(-4)}</small></a>
      <span class="bg-bar"><i style="width:${t.progress ?? t.startProgress}%"></i><b>${t.progress ?? t.startProgress}%</b></span>
      <span class="bg-pick"><button type="button" data-i="${i}" data-v="1" class="${mine === true ? 'on' : ''}" ${locked ? 'disabled' : ''}>Bonds</button><button type="button" data-i="${i}" data-v="0" class="${mine === false ? 'on no' : ''}" ${locked ? 'disabled' : ''}>No bond</button></span></div>`; }).join('')
    : '<p class="note">Today\'s curves are not set yet. Come back in a few minutes.</p>';
  $('#bg-form').hidden = locked || !v.tokens.length;
  const y = v.yesterday;
  $('#bg-yday').innerHTML = y ? `<p>${y.tokens.map(t => `${esc(t.symbol)} <b class="${t.bonded ? 'long' : 'short'}">${t.bonded ? 'bonded' : 'did not'}</b>`).join(' · ')}</p><p>${y.players} played${y.mine != null ? ` · you got ${y.mine} of ${y.tokens.length}` : ''}.</p>` : '<p>The first day is still running.</p>';
  $('#bg-board').innerHTML = v.board.length ? v.board.map((b, i) => `<p>${i + 1}. ${esc(b.handle)} · <b>${b.pts}</b></p>`).join('') : '<p>No day has finished yet.</p>';
  $('#bg-note').textContent = v.note;
}
async function load() {
  const me = store.get('sd.bg.h') || ''; if (me) $('#bg-h').value = me;
  try { view = await api('bondgame?me=' + encodeURIComponent(me)); } catch (e) {}
  if (!view?.ok) { $('#bg-state').textContent = 'not answering right now'; return; }
  picks = view.tokens.map(() => null); draw();
}
$('#bg-list').addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (!b || b.disabled) return; picks[+b.dataset.i] = b.dataset.v === '1'; draw(); });
$('#bg-form').addEventListener('submit', async e => {
  e.preventDefault(); const h = $('#bg-h').value.trim().toLowerCase();
  if (!/^[a-z0-9_]{2,16}$/.test(h)) { $('#bg-msg').textContent = 'A HANDLE OF 2 TO 16 LETTERS, DIGITS OR _.'; return; }
  if (picks.some(p => p === null)) { $('#bg-msg').textContent = 'CALL EVERY CURVE FIRST.'; return; }
  $('#bg-go').disabled = true;
  let r = null; try { r = await api('bondgame', { handle: h, picks }); } catch (x) {}
  $('#bg-go').disabled = false;
  if (r?.ok) { store.set('sd.bg.h', h); view = r; $('#bg-msg').textContent = 'LOCKED IN. THE CHAIN ANSWERS AT MIDNIGHT UTC.'; draw(); }
  else $('#bg-msg').textContent = (r?.why || 'not answering right now').toUpperCase() + '.';
});
load();
