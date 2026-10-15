// For agents: the read-only endpoints, each one runnable here against the live desk
import { createYard } from './yard.js';
import { mountChrome, $, $$, esc, feedYard } from './ui.js';

mountChrome('');
feedYard(createYard($('#yard'), { ambient: true }));
const EPS = [
  ['token?a=0x7e517e779b85895894becad80c9bb69b4cb1c4d6', 'One token', 'Verdict on file, a fresh security read, launch facts (snipers, bundles, insiders), and the crew position.'],
  ['verdicts', 'Verdicts', 'The 50 latest calls, and how many held an hour later.'],
  ['desk', 'The crew desk', 'Equity, open positions, closed trades with the conductor’s post-mortems.'],
  ['graduated', 'Graduated', 'Tokens that just completed the Pons curve.'],
  ['report', 'Daily report', 'The last 24 hours, with a one-paragraph summary.'],
];
const base = location.origin + '/api/v1/';
$('#eps').innerHTML = EPS.map(([p, n, d], i) => `<button class="ep${i ? '' : ' on'}" data-p="${esc(p)}" type="button"><b>${esc(n)}</b><code>/api/v1/${esc(p.split('?')[0])}${p.includes('?') ? '?a=0x…' : ''}</code><span>${esc(d)}</span></button>`).join('');
// a light JSON highlighter: keys, strings, numbers, nulls
const hl = s => esc(s).replace(/(&quot;[^&]*?&quot;)(\s*:)?|\b(-?\d+(?:\.\d+)?(?:e-?\d+)?)\b|\b(null|true|false)\b/g, (m, str, colon, numb, lit) => str ? `<i class="${colon ? 'k' : 's'}">${str}</i>${colon || ''}` : numb ? `<i class="n">${numb}</i>` : `<i class="l">${lit}</i>`);
function pick(p) {
  $$('.ep').forEach(b => b.classList.toggle('on', b.dataset.p === p));
  $('#ag-url').value = base + p;
  $('#ag-code').innerHTML = hl(`const r = await fetch("${base + p}");\nconst data = await r.json();`);
}
async function run() {
  const u = $('#ag-url').value.trim(); if (!u.startsWith(base)) { $('#ag-out').textContent = 'Only addresses under ' + base + ' run here.'; return; }
  $('#ag-st').textContent = 'asking the desk…'; $('#ag-out').textContent = '…';
  const t0 = performance.now();
  try {
    const r = await fetch(u), j = await r.json();
    $('#ag-out').innerHTML = hl(JSON.stringify(j, null, 2).slice(0, 6000));
    $('#ag-st').textContent = `${r.status} · ${Math.round(performance.now() - t0)} ms · live`;
  } catch (e) { $('#ag-out').textContent = 'The desk did not answer. Try again in a minute.'; $('#ag-st').textContent = 'no answer'; }
}
$('#eps').addEventListener('click', e => { const b = e.target.closest('.ep'); if (b) { pick(b.dataset.p); run(); } });
$('#ag-go').onclick = run; $('#ag-url').addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
pick(EPS[0][0]); run();