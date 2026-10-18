// /dev/: Dev Score, every Pons launch by one wallet and what it did with each
import { createYard } from './yard.js';
import { mountChrome, $, esc, feedYard } from './ui.js';
import { api, isAddr, rpc } from './data.js';

mountChrome('');
feedYard(createYard($('#yard'), { ambient: true }));
const n0 = v => v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : Math.round(v || 0).toLocaleString('en-US');
const when = iso => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
let job = 0;

async function run(a) {
  const id = ++job; a = a.toLowerCase(); $('#dv-a').value = a; history.replaceState(null, '', '?w=' + a); $('#dv-out').hidden = true;
  $('#dv-msg').textContent = 'READING THE LAUNCHES…';
  // a token: find who launched it first, from the dev ledger
  let w = a;
  const code = await rpc('eth_getCode', [a, 'latest']).catch(() => '0x');
  if (code && code !== '0x' && !/^0xef0100[0-9a-f]{40}$/i.test(code)) { const l = await api('ledger?a=' + a).catch(() => null); if (!l?.ok) { $('#dv-msg').textContent = 'COULD NOT FIND WHO LAUNCHED THAT TOKEN.'; return; } w = l.dev; }
  // a dev with many launches takes a while to read: its own, longer wait
  const v = await fetch('/api/devscore?w=' + w, { signal: AbortSignal.timeout(45000) }).then(r => r.json()).catch(() => null);
  if (id !== job) return;
  if (!v?.ok) { $('#dv-msg').textContent = (v?.why || 'not answering right now').toUpperCase() + '.'; return; }
  if (!v.launched) { $('#dv-msg').textContent = 'NO PONS LAUNCH BY ' + w.slice(0, 6) + '…' + w.slice(-4) + ' ON RECORD.'; return; }
  $('#dv-msg').textContent = `LAUNCHER ${w}`; $('#dv-out').hidden = false;
  $('#dv-score').textContent = v.score ?? '—'; $('#dv-score').className = 'v ' + (v.score == null ? '' : v.score >= 80 ? 'long' : v.score < 50 ? 'short' : '');
  $('#dv-n').textContent = v.launched; $('#dv-n-s').textContent = v.read < v.launched ? `the newest ${v.read} read in full` : 'on Pons, by this wallet';
  $('#dv-d').textContent = `${v.dumped} of ${v.held}`; $('#dv-d-s').textContent = v.dumpedFirstHour ? `${v.dumpedFirstHour} within the first hour` : 'sold or sent away half or more';
  $('#dv-b').textContent = v.burnedMost; $('#dv-by').textContent = `${v.bonded} bonded · newest first`;
  const l = $('#dv-list'); l.querySelectorAll('.r:not(.h)').forEach(n => n.remove());
  l.insertAdjacentHTML('beforeend', v.launches.map(x => `<a class="r" href="/ticket/?a=${x.token}"><span class="sy">${esc(x.symbol)}<small>${x.token.slice(0, 6)}…${x.token.slice(-4)}</small></span><span>${when(x.launched)}</span><span>${n0(x.got)}</span><span class="${x.dumped ? 'short' : ''}">${n0(x.sold + x.sentAway)}</span><span class="${x.burnedMost ? 'long' : ''}">${n0(x.burned)}</span><span>${x.dumpedFirstHour ? '<b class="short">dumped in the first hour</b>' : x.dumped ? '<b class="short">dumped</b>' : x.burnedMost ? '<b class="long">burned</b>' : x.got ? 'held' : 'never held it'}${x.bonded ? ' · bonded' : ''}</span></a>`).join(''));
  $('#dv-note').textContent = (v.partial ? `Shuntdesk's launch index is still filling: it holds every Pons launch since ${v.indexFrom ? new Date(v.indexFrom).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : 'recently'}, and reaches back to the factory's first launch within hours. An older launch may not show yet. ` : '') + v.note;
}
$('#dv-form').addEventListener('submit', e => { e.preventDefault(); const a = $('#dv-a').value.trim(); if (isAddr(a)) run(a); else $('#dv-msg').textContent = 'PASTE A 0x… ADDRESS.'; });
const q = new URLSearchParams(location.search).get('w') || new URLSearchParams(location.search).get('a');
if (q && isAddr(q)) run(q);
