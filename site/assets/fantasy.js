// /fantasy/: Fantasy Launcher. Back five launcher wallets for the week; their Pons launches after your pick score
import { createYard } from './yard.js';
import { mountChrome, $, esc, feedYard } from './ui.js';
import { api } from './data.js';

mountChrome('');
feedYard(createYard($('#yard'), { ambient: true }));
const store = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
let v = null, picks = [];
const short = a => a.slice(0, 6) + '…' + a.slice(-4), ago = iso => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 60 ? m + 'm ago' : m < 2880 ? Math.round(m / 60) + 'h ago' : Math.round(m / 1440) + 'd ago'; };
function paint() {
  const mine = v.mine;
  $('#ft-state').textContent = mine ? 'your five are set' : `${picks.length} of 5 picked · ${v.players} playing · week of ${v.week}`;
  $('#ft-pool').innerHTML = '<div class="r h"><span>LAUNCHER</span><span>LAUNCHES · 7 DAYS</span><span>BONDED · PAST 50%</span><span></span></div>' + (v.pool.length ? v.pool.map(x => { const on = (mine ? mine.wallets : picks).includes(x.wallet);
    return `<div class="r"><a class="sy" href="/dev/?w=${x.wallet}">${short(x.wallet)}<small>last ${ago(x.last)}</small></a><span>${x.launches}</span><span>${x.bonded} · ${x.past50}</span>${mine ? (on ? '<b class="long">yours</b>' : '<span></span>') : `<button type="button" class="btn ghost ${on ? 'on' : ''}" data-w="${x.wallet}">${on ? 'Picked' : 'Pick'}</button>`}</div>`; }).join('')
    : '<p class="note" style="margin:10px 0">No launcher with two launches this week yet.</p>');
  $('#ft-form').hidden = !!mine;
  $('#ft-mine-box').hidden = !mine;
  if (mine) { $('#ft-mine-s').textContent = `${mine.pts} points since ${new Date(mine.since).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
    $('#ft-mine').innerHTML = mine.tokens.length ? mine.tokens.map(t => `<p>${t.pts > 0 ? '<b class="long">+' + t.pts + '</b>' : t.pts < 0 ? '<b class="short">' + t.pts + '</b>' : '<b>0</b>'} <a href="/ticket/?a=${t.token}">$${esc(t.symbol || short(t.token))}</a> · ${t.bonded ? 'bonded' : t.dead ? 'died' : 'curve peaked at ' + t.max + '%'} · by ${short(t.launcher)}</p>`).join('') : '<p>None of your five has launched since your pick.</p>'; }
  $('#ft-board').innerHTML = v.board.length ? v.board.map((b, i) => `<p>${i + 1}. ${esc(b.handle)}${b.holder ? ' <b class="long">HOLDER</b>' : ''} · <b>${b.pts}</b></p>`).join('') : '<p>Nobody yet this week.</p>';
  $('#ft-note').textContent = v.note;
}
async function load() { const me = store.get('sd.bg.h') || ''; if (me) $('#ft-h').value = me; try { v = await api('fantasy?me=' + encodeURIComponent(me)); } catch (e) {} if (!v?.ok) { $('#ft-state').textContent = 'not answering right now'; return; } paint(); }
$('#ft-pool').addEventListener('click', e => { const b = e.target.closest('button[data-w]'); if (!b) return; const w = b.dataset.w; picks = picks.includes(w) ? picks.filter(x => x !== w) : picks.length < 5 ? [...picks, w] : picks; paint(); });
$('#ft-form').addEventListener('submit', async e => {
  e.preventDefault(); const h = $('#ft-h').value.trim().toLowerCase();
  if (!/^[a-z0-9_]{2,16}$/.test(h)) return $('#ft-msg').textContent = 'A HANDLE OF 2 TO 16 LETTERS, DIGITS OR _.';
  if (picks.length !== 5) return $('#ft-msg').textContent = 'PICK FIVE LAUNCHERS.';
  let r = null; try { r = await api('fantasy', { handle: h, wallets: picks }); } catch (x) {}
  if (r?.ok) { store.set('sd.bg.h', h); $('#ft-msg').textContent = 'YOUR FIVE ARE SET. THEIR NEXT LAUNCHES SCORE.'; load(); } else $('#ft-msg').textContent = (r?.why || 'not answering right now').toUpperCase() + '.';
});
load(); setInterval(load, 120000);
