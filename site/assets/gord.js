// /gord/: Graduate or Die, five fresh StonkFun launches an hour, called graduate or die, judged a day later
import { createYard } from './yard.js';
import { mountChrome, $, $$, esc, feedYard } from './ui.js';
import { api } from './data.js';
mountChrome('Play');
feedYard(createYard($('#yard'), { ambient: true }));
const store = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
const hm = iso => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
let calls = {}, round = null;
const tok = (t, pick) => `<div class="gd-t"><span class="sy">${t.image ? `<img src="${esc(t.image)}" alt="" referrerpolicy="no-referrer">` : ''}${esc(t.symbol || '?')}<small>curve ${t.progress}% · ${esc(t.quote || '')} · <a class="acc" href="/ape/?m=${t.mint}">ape check</a></small></span>${pick}</div>`;
function draw(v) {
  const me = store.get('sd.bg.h') || ''; $('#gd-h').value = me; round = v.open;
  if (!v.open) { $('#gd-cap').textContent = 'Between rounds'; $('#gd-closes').textContent = 'the next opens on the hour'; $('#gd-round').innerHTML = v.waiting.length ? `<p class="note">WAITING TO BE JUDGED: ${v.waiting.length} ROUND${v.waiting.length > 1 ? 'S' : ''}, THE NEXT AT ${hm(v.waiting.at(-1).judgesAt)}.</p>` : '<p class="note">NO ROUND OPEN. COME BACK ON THE HOUR.</p>'; $('#gd-form').hidden = true; }
  else {
    $('#gd-cap').textContent = 'This hour · ' + v.open.players + ' played'; $('#gd-closes').textContent = `calls close ${hm(v.open.closes)} · judged ${hm(v.open.judgesAt)} tomorrow`;
    const mine = v.open.mine;
    $('#gd-round').innerHTML = v.open.tokens.map(t => tok(t, mine ? `<b class="${mine[t.mint] === 'g' ? 'long' : 'short'}">${mine[t.mint] === 'g' ? 'GRADUATE' : 'DIE'}</b>` : `<span class="bg-pick" data-m="${t.mint}"><button type="button" data-k="g">Graduate</button><button type="button" data-k="d" class="no">Die</button></span>`)).join('');
    $('#gd-form').hidden = !!mine; if (mine) $('#gd-msg').textContent = 'YOUR CALLS ARE LOCKED. THE CHAIN ANSWERS TOMORROW.';
    $$('#gd-round .bg-pick').forEach(p => p.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; calls[p.dataset.m] = b.dataset.k; $$('button', p).forEach(x => x.classList.toggle('on', x === b)); }));
  }
  $('#gd-board').innerHTML = v.board.length ? v.board.map((r, i) => `<div class="r"><span>${i + 1}</span><span class="sy">${esc(r.handle)}</span><span class="${r.pts >= 0 ? 'long' : 'short'}">${r.pts}</span></div>`).join('') : '<p class="note">NO ROUND JUDGED THIS WEEK YET.</p>';
  $('#gd-judged').innerHTML = v.judged.map(r => `<p class="note" style="margin:0 0 6px">${hm(r.id)} · ${r.players} played</p>` + r.tokens.map(t => tok(t, `<b class="${t.graduated ? 'long' : 'short'}">${t.graduated ? 'GRADUATED' : 'DIED'}</b>`)).join('')).join('<hr style="border:0;border-top:1px solid rgba(237,235,230,.1);margin:12px 0">') || '<p class="note">THE FIRST ROUNDS ARE JUDGED A DAY AFTER THEY OPEN.</p>';
}
async function load() { try { draw(await api('gord?me=' + encodeURIComponent(store.get('sd.bg.h') || ''))); } catch (e) { $('#gd-round').innerHTML = '<p class="note">COULD NOT READ THE ROUND RIGHT NOW.</p>'; } }
$('#gd-form').addEventListener('submit', async e => {
  e.preventDefault(); const h = $('#gd-h').value.trim().toLowerCase();
  if (!/^[a-z0-9_]{2,16}$/.test(h)) { $('#gd-msg').textContent = 'A HANDLE OF 2 TO 16 LETTERS, DIGITS OR _.'; return; }
  if (!round || round.tokens.some(t => !calls[t.mint])) { $('#gd-msg').textContent = 'CALL EVERY TOKEN FIRST: GRADUATE OR DIE.'; return; }
  store.set('sd.bg.h', h);
  try { const r = await fetch('/api/gord', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ handle: h, calls }) }); const v = await r.json(); if (!v.ok) { $('#gd-msg').textContent = String(v.why || 'not taken').toUpperCase() + '.'; return; } draw(v); } catch (x) { $('#gd-msg').textContent = 'COULD NOT SEND IT. TRY AGAIN.'; }
});
load(); setInterval(() => { if (!document.hidden) load(); }, 60000);
