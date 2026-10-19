// /rug-run/: ten real new tokens as the radar read them, names hidden; the server scores the calls from its record
import { createYard } from './yard.js';
import { mountChrome, $, esc, feedYard } from './ui.js';

mountChrome('');
feedYard(createYard($('#yard'), { ambient: true }));
const store = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
const n0 = v => Math.round(v || 0).toLocaleString('en-US'), p1 = v => v == null ? '—' : Number(v).toFixed(1) + '%';
let run = null, calls = [], done = null;
function draw() {
  $('#rr-list').innerHTML = run.tokens.map((t, i) => { const res = done?.results[i], mine = calls[i];
    return `<div class="rr-card ${res ? (mine === res.rug ? 'right' : 'wrong') : ''}">
      <div class="rr-n">#${t.n}${res ? ` · <b>${esc(res.symbol || '')}</b>` : ''}</div>
      <div class="rr-f"><span>${t.liquidity > 0 ? `Pool $${n0(t.liquidity)}` : 'pool not read'}</span><span>${n0(t.holders)} holders</span><span>top ten ${p1(t.top10)}</span><span>dev ${p1(t.dev)}</span><span>snipers ${p1(t.snipers)}</span><span>bundles ${p1(t.bundles)}</span><span>${t.age != null ? t.age + ' min old' : ''}</span><span>${t.launchpad ? esc(t.launchpad) : 'launchpad not named'}</span><span>${t.site === 'none' ? 'no website' : t.site ? 'website ' + t.site : 'website not read'}</span></div>
      <div class="rr-flags">${t.flags.length ? t.flags.map(f => `<i>${esc(f)}</i>`).join('') : '<i class="ok">no flag found</i>'}</div>
      ${res ? `<div class="rr-res ${res.rug ? 'short' : 'long'}">${res.move24h == null ? 'no result' : res.rug ? `RUG · ${Math.round(res.move24h * 100)}% in a day` : `RIDE · ${res.move24h >= 0 ? '+' : ''}${Math.round(res.move24h * 100)}% in a day`}</div>`
        : `<div class="bg-pick"><button type="button" data-i="${i}" data-v="1" class="${mine === true ? 'on no' : ''}">Rug</button><button type="button" data-i="${i}" data-v="0" class="${mine === false ? 'on' : ''}">Ride</button></div>`}</div>`; }).join('');
  $('#rr-go').hidden = !!done; $('#rr-state').textContent = done ? `${done.right} of ${done.of} right` : `${calls.filter(c => c !== null).length} of 10 called`;
}
function board(b) { $('#rr-board').innerHTML = b?.length ? b.map((r, i) => `<p>${i + 1}. ${esc(r.handle)}${r.holder ? ' <b class="long">HOLDER</b>' : ''} · <b>${r.best}</b> of 10</p>`).join('') : '<p>Nobody yet this week.</p>'; }
async function start() {
  done = null; $('#rr-msg').textContent = 'PICKING TEN TOKENS…';
  try { run = await (await fetch('/api/rugrun')).json(); } catch (e) {}
  if (!run?.ok) { $('#rr-msg').textContent = String(run?.why || 'not answering right now').toUpperCase() + '.'; return; }
  calls = run.tokens.map(() => null); $('#rr-msg').textContent = ''; $('#rr-note').textContent = run.note; draw();
}
$('#rr-list').addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (!b || done) return; calls[+b.dataset.i] = b.dataset.v === '1'; draw(); });
$('#rr-new').addEventListener('click', start);
$('#rr-form').addEventListener('submit', async e => {
  e.preventDefault(); const h = $('#rr-h').value.trim().toLowerCase();
  if (!/^[a-z0-9_]{2,16}$/.test(h)) { $('#rr-msg').textContent = 'A HANDLE OF 2 TO 16 LETTERS, DIGITS OR _.'; return; }
  if (calls.some(c => c === null)) { $('#rr-msg').textContent = 'CALL ALL TEN FIRST.'; return; }
  let r = null; try { r = await (await fetch('/api/rugrun', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: run.id, handle: h, calls }) })).json(); } catch (x) {}
  if (!r?.ok) { $('#rr-msg').textContent = String(r?.why || 'not answering right now').toUpperCase() + '.'; return; }
  store.set('sd.rr.h', h); done = r; $('#rr-msg').textContent = `${r.right} OF ${r.of} RIGHT. NEW RUN FOR TEN MORE.`; draw(); board(r.board);
});
$('#rr-h').value = store.get('sd.rr.h') || store.get('sd.bg.h') || '';
start();
