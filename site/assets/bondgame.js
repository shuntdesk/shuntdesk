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
  const tag = b => `${b.holder ? ' <b class="long">HOLDER</b>' : ''}${b.streak >= 3 ? ` · ${b.streak} days running` : ''}${b.perfect ? ` · ${b.perfect} perfect` : ''}`;
  $('#bg-board').innerHTML = v.board.length ? v.board.map((b, i) => `<p>${i + 1}. ${esc(b.handle)} · <b>${b.pts}</b>${tag(b)}</p>`).join('') : '<p>No day has finished yet.</p>';
  $('#bg-league').innerHTML = v.league?.length ? v.league.map((b, i) => `<p>${i + 1}. ${esc(b.handle)} · <b>${b.pts}</b>${b.streak >= 3 ? ` · ${b.streak} days running` : ''}</p>`).join('') : '<p>No holder on the board yet. Hold $SHUNT, /link your wallet and set /handle in the bot.</p>';
  if (v.me) $('#bg-me').innerHTML = `<p>Streak <b>${v.me.streak}</b> day${v.me.streak === 1 ? '' : 's'} · perfect days <b>${v.me.perfect}</b> · <b>${v.me.week}</b> points this week${v.me.holder ? ' · <b class="long">holder league</b>' : ''}</p>`;
  if (v.duel) { const d = v.duel, y = d.yesterday; $('#bg-duel-msg').innerHTML = `Duel with <b>${esc(d.vs)}</b>: ${y && (y.me != null || y.them != null) ? `yesterday you ${y.me ?? '—'}, them ${y.them ?? '—'} of ${y.of}. ` : ''}today they are ${d.theirsToday ? (Array.isArray(d.theirsToday) ? 'in: ' + d.theirsToday.map(x => x ? 'bonds' : 'no').join(' · ') : 'in, calls hidden until 12:00 UTC') : 'not in yet'}.`; }
  $('#bg-note').textContent = v.note;
}
async function load() {
  const me = store.get('sd.bg.h') || ''; if (me) $('#bg-h').value = me;
  const vs = (new URLSearchParams(location.search).get('vs') || '').toLowerCase();
  try { view = await api('bondgame?me=' + encodeURIComponent(me) + (vs ? '&vs=' + encodeURIComponent(vs) : '')); } catch (e) {}
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
$('#bg-duel').addEventListener('click', async () => {
  const h = store.get('sd.bg.h'); if (!h) { $('#bg-duel-msg').textContent = 'LOCK YOUR CALLS FIRST, THEN CHALLENGE.'; return; }
  const link = location.origin + '/bond-game/?vs=' + encodeURIComponent(h);
  try { await navigator.clipboard.writeText(link); $('#bg-duel-msg').textContent = 'LINK COPIED: SEND IT TO A FRIEND. ' + link; } catch (e) { $('#bg-duel-msg').textContent = link; }
});
load();
