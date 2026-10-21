// /dev/: Dev Score, every Pons launch by one wallet and what it did with each
import { createYard } from './yard.js';
import { mountChrome, $, esc, feedYard } from './ui.js';
import { api, isToken as isAddr, isSol, normAddr, rpc } from './data.js';
// a line under the result: this read as a card, a preview image wherever the link is posted
const shareLine = (host, url) => { let p = host.querySelector('.share-card'); if (!p) { p = document.createElement('p'); p.className = 'note share-card'; p.style.marginTop = '10px'; host.appendChild(p); }
  p.innerHTML = `SHARE AS A CARD: <a class="acc" href="${url}" target="_blank" rel="noopener">${url.replace('https://', '')}</a> <button class="btn ghost" type="button" style="margin-left:8px">Copy</button>`;
  p.querySelector('button').onclick = async e => { try { await navigator.clipboard.writeText(url); e.target.textContent = 'Copied'; } catch (x) { e.target.textContent = url; } }; };

mountChrome('');
feedYard(createYard($('#yard'), { ambient: true }));
const n0 = v => v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : Math.round(v || 0).toLocaleString('en-US');
const when = iso => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
let job = 0;

async function run(a) {
  const id = ++job; a = normAddr(a); $('#dv-a').value = a; history.replaceState(null, '', '?w=' + a); $('#dv-out').hidden = true;
  $('#dv-msg').textContent = 'READING THE LAUNCHES…';
  // a token: find who launched it first, from the dev ledger (on Solana the server finds the deployer itself)
  let w = a;
  const code = isSol(a) ? '0x' : await rpc('eth_getCode', [a, 'latest']).catch(() => '0x');
  if (code && code !== '0x' && !/^0xef0100[0-9a-f]{40}$/i.test(code)) { const l = await api('ledger?a=' + a).catch(() => null); if (!l?.ok) { $('#dv-msg').textContent = 'COULD NOT FIND WHO LAUNCHED THAT TOKEN.'; return; } w = l.dev; }
  // a dev with many launches takes a while to read: its own, longer wait
  const v = await fetch('/api/devscore?w=' + w, { signal: AbortSignal.timeout(45000) }).then(r => r.json()).catch(() => null);
  if (id !== job) return;
  if (!v?.ok) { $('#dv-msg').textContent = (v?.why || 'not answering right now').toUpperCase() + '.'; return; }
  if (v.chain === 'solana') return paintSol(v);
  if (!v.launched) { $('#dv-msg').textContent = 'NO PONS LAUNCH BY ' + w.slice(0, 6) + '…' + w.slice(-4) + ' ON RECORD.'; return; }
  $('#dv-msg').textContent = `LAUNCHER ${w}`; $('#dv-out').hidden = false;
  $('#dv-score').textContent = v.score ?? '—'; $('#dv-score').className = 'v ' + (v.score == null ? '' : v.score >= 80 ? 'long' : v.score < 50 ? 'short' : '');
  $('#dv-n').textContent = v.launched; $('#dv-n-s').textContent = v.read < v.launched ? `the newest ${v.read} read in full` : 'on Pons, by this wallet';
  $('#dv-d').textContent = `${v.dumped} of ${v.held}`; $('#dv-d-s').textContent = v.dumpedFirstHour ? `${v.dumpedFirstHour} within the first hour` : 'sold or sent away half or more';
  $('#dv-b').textContent = v.burnedMost; $('#dv-by').textContent = `${v.bonded} bonded · newest first`;
  const l = $('#dv-list'); l.querySelectorAll('.r:not(.h)').forEach(n => n.remove());
  l.insertAdjacentHTML('beforeend', v.launches.map(x => `<a class="r" href="/ticket/?a=${x.token}"><span class="sy">${esc(x.symbol)}<small>${x.token.slice(0, 6)}…${x.token.slice(-4)}</small></span><span>${when(x.launched)}</span><span>${n0(x.got)}</span><span class="${x.dumped ? 'short' : ''}">${n0(x.sold + x.sentAway)}</span><span class="${x.burnedMost ? 'long' : ''}">${n0(x.burned)}</span><span>${x.dumpedFirstHour ? '<b class="short">dumped in the first hour</b>' : x.dumped ? '<b class="short">dumped</b>' : x.burnedMost ? '<b class="long">burned</b>' : x.got ? 'held' : 'never held it'}${x.bonded ? ' · bonded' : ''}</span></a>`).join(''));
  shareLine($('#dv-out'), location.origin + '/card/dev/' + a);
  $('#dv-note').textContent = (v.partial ? `Shuntdesk's launch index is still filling: it holds every Pons launch since ${v.indexFrom ? new Date(v.indexFrom).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : 'recently'}, and reaches back to the factory's first launch within hours. An older launch may not show yet. ` : '') + v.note;
}
// a Solana deployer: what Codex lists as launched by it, and how many died inside the hour
const usd = v => '$' + (v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : Math.round(v));
function paintSol(v) {
  if (!v.launched) { $('#dv-msg').textContent = 'NO SOLANA LAUNCH ON RECORD FOR ' + v.wallet.slice(0, 4) + '…' + v.wallet.slice(-4) + '.'; return; }
  $('#dv-msg').textContent = 'DEPLOYER ' + v.wallet + (v.from ? ' · FOUND FROM THE TOKEN' : ''); $('#dv-out').hidden = false;
  $('#dv-score').textContent = v.score ?? '—'; $('#dv-score').className = 'v ' + (v.score == null ? '' : v.score >= 80 ? 'long' : v.score < 50 ? 'short' : ''); $('#dv-score-s').textContent = 'share of launches still alive after an hour';
  $('#dv-n').textContent = v.launched; $('#dv-n-s').textContent = v.read < v.launched ? `on Solana, the newest ${v.read} read` : 'on Solana, by this wallet';
  $('#dv-d').textContent = `${v.dead} of ${v.judged}`; $('#dv-d').closest('.in').querySelector('.cap b').textContent = 'Dead'; $('#dv-d-s').textContent = 'under $5K and not graduated an hour in';
  $('#dv-b').textContent = v.bonded; $('#dv-b').closest('.in').querySelector('.cap b').textContent = 'Graduated'; $('#dv-b-s').textContent = 'reached the end of their curve';
  $('#dv-by').textContent = 'newest first';
  const l = $('#dv-list'); l.innerHTML = '<div class="r h"><span>TOKEN</span><span>LAUNCHED</span><span>MARKET CAP</span><span>HOLDERS</span><span>DEV HOLDS</span><span>RESULT</span></div>';
  l.insertAdjacentHTML('beforeend', v.launches.map(x => `<a class="r" href="/ticket/?a=${x.token}"><span class="sy">${esc(x.symbol)}<small>${x.token.slice(0, 4)}…${x.token.slice(-4)}</small></span><span>${when(x.launched)}</span><span>${usd(x.marketCap)}</span><span>${x.holders ?? '—'}</span><span>${x.devHolds == null ? '—' : Number(x.devHolds).toFixed(1) + '%'}</span><span>${x.bonded ? '<b class="long">graduated</b>' : x.dead ? '<b class="short">dead</b>' : x.progress != null ? Math.round(x.progress) + '% to graduation' : 'live'}</span></a>`).join(''));
  $('#dv-note').textContent = v.note;
  ring(v.wallet);
}
// Deployer Ring: who funded this deployer, and the other deployers that funder paid
async function ring(w) {
  let box = document.getElementById('dv-ring');
  if (!box) { box = document.createElement('div'); box.id = 'dv-ring'; box.className = 'stub n'; box.style.marginTop = '16px'; $('#dv-note').before(box); }
  box.innerHTML = '<div class="in"><div class="cap"><b>Deployer Ring</b><span>who funded it, and who else that funder paid</span></div><p class="note">FOLLOWING THE FIRST SOL BACK…</p></div>';
  let r = null; try { r = await api('ring?a=' + w); } catch (e) {}
  const body = box.querySelector('.in');
  if (!r?.ok) { body.lastElementChild.textContent = (r?.why || 'not answering right now').toUpperCase() + '.'; return; }
  if (!r.funder) { body.lastElementChild.textContent = (r.why || 'no first funding found').toUpperCase() + '.'; return; }
  const w4 = a => a.slice(0, 4) + '…' + a.slice(-4);
  body.lastElementChild.outerHTML = `<p style="margin:6px 0 10px">First funded by <a class="acc" href="/wallet/?w=${r.funder}">${w4(r.funder)}</a>, which paid ${r.paidWallets} wallet${r.paidWallets === 1 ? '' : 's'} in its latest transactions. ${r.ring.length ? `${r.ring.length} of them launch tokens too:` : 'None of the ones checked launch tokens.'}</p>
    <div class="dep">${r.ring.map(x => `<a class="r" href="/dev/?w=${x.wallet}"><span class="sy">${w4(x.wallet)}<small>got ${x.sol} SOL</small></span><span>${x.launched} launched</span><span>${x.recent.map(y => esc('$' + (y.symbol || '?'))).join(', ')}</span><span class="go">→</span></a>`).join('')}</div>
    <p class="note" style="margin-top:8px">${esc(r.note)}</p>`;
}
$('#dv-form').addEventListener('submit', e => { e.preventDefault(); const a = $('#dv-a').value.trim(); if (isAddr(a)) run(a); else $('#dv-msg').textContent = 'PASTE A 0x… ADDRESS OR A SOLANA WALLET OR MINT.'; });
const q = new URLSearchParams(location.search).get('w') || new URLSearchParams(location.search).get('a');
if (q && isAddr(q)) run(q);
