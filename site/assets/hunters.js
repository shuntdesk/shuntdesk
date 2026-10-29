// /hunters/: the wallets that keep buying early into Pons curves that bond, and the open curves they are in now
import { createYard } from './yard.js';
import { mountChrome, $, esc, feedYard } from './ui.js';
import { api } from './data.js';
mountChrome('');
feedYard(createYard($('#yard'), { ambient: true }));
const w4 = a => a.slice(0, 6) + '…' + a.slice(-4);
const ago = t => { const m = (Date.now() - t) / 60000; return m < 60 ? Math.max(1, Math.round(m)) + ' MIN AGO' : (m / 60).toFixed(1) + ' H AGO'; };
// on sol.shuntdesk.com the board is Stonk Hunters: StonkFun curves on Solana
const SOL = document.documentElement.classList.contains('sol'), Q = SOL ? 'chain=sol&' : '';
const isW = a => SOL ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a) : /^0x[0-9a-fA-F]{40}$/.test(a);
if (SOL) { $('.eyebrow').textContent = 'Stonk Hunters · StonkFun on Solana'; document.title = 'Stonk Hunters — Shuntdesk'; }

async function one(w) {
  w = SOL ? w : w.toLowerCase(); $('#hu-w').value = w; history.replaceState(null, '', '?w=' + w);
  $('#hu-one').innerHTML = '<p class="note">READING…</p>';
  let v = null; try { v = await api('hunters?' + Q + 'w=' + w); } catch (e) {}
  if (!v?.ok) { $('#hu-one').innerHTML = '<p class="note">COULD NOT READ IT RIGHT NOW. TRY AGAIN IN A MINUTE.</p>'; return; }
  if (!v.found) { $('#hu-one').innerHTML = `<p class="note">NO EARLY BUY ON FILE FOR ${w4(w)} IN THE ${v.board.curves} CURVES READ SO FAR.</p>`; return; }
  $('#hu-one').innerHTML = `<div class="lk-row"><span>Bonded<b class="long">${v.hits} of ${v.tries}</b></span><span>Hit rate<b>${v.rate ?? '—'}%</b></span><span>On the board<b>${v.rank ? '#' + v.rank : 'not yet'}</b></span><span>Open now<b>${v.open.length}</b></span></div>
    ${v.hitList.length ? `<p class="note" style="margin-top:10px">BONDED: ${v.hitList.map(b => `<a class="acc" href="/ticket/?a=${b.token}">${esc(b.symbol)}</a> (#${b.rank} in)`).join(' · ')}</p>` : ''}
    ${v.open.length ? `<p class="note">OPEN NOW: ${v.open.map(o => `<a class="acc" href="/ticket/?a=${o.token}">${esc(o.symbol)}</a> ${o.progress ?? '?'}%`).join(' · ')}</p>` : ''}
    <p class="note">FOLLOW IT IN THE BOT (HOLDERS): <code>/follow ${w}</code> · <a class="acc" href="/wallet/?a=${w}">WALLET X-RAY →</a></p>`;
}

(async () => {
  let v = null; try { v = await api('hunters' + (SOL ? '?chain=sol' : '')); } catch (e) {}
  if (!v?.ok) { $('#hu-list').innerHTML = $('#hu-now').innerHTML = '<p class="note">COULD NOT READ THE BOARD RIGHT NOW.</p>'; return; }
  $('#hu-c').textContent = v.board.curves.toLocaleString('en-US'); $('#hu-b').textContent = v.board.bonded; $('#hu-n').textContent = v.hunters.length; $('#hu-t').textContent = v.read ? ago(v.read) : '—';
  $('#hu-now').innerHTML = v.inNow.length ? `<div class="r h"><span>TOKEN</span><span>CURVE</span><span>HUNTERS</span><span>THEIR RECORD</span></div>` + v.inNow.map(c => `<a class="r" href="/ticket/?a=${c.token}"><span class="sy">${esc(c.symbol)}<small>${w4(c.token)}</small></span><span>${c.progress ?? '?'}%</span><span class="long">${c.hunters.length}</span><span>${c.hunters.slice(0, 3).map(h => `${h.hits}/${h.tries}`).join(' · ')}</span></a>`).join('')
    : '<p class="note">NONE OF THE BOARD\'S WALLETS IS EARLY IN AN OPEN CURVE RIGHT NOW.</p>';
  $('#hu-list').innerHTML = v.hunters.length ? `<div class="r h"><span>#</span><span>WALLET</span><span>BONDED</span><span>RATE</span><span>LAST BONDS</span><span>OPEN</span></div>` + v.hunters.map((h, i) => `<a class="r" href="?w=${h.wallet}" data-w="${h.wallet}"><span>${i + 1}</span><span class="sy">${w4(h.wallet)}</span><span class="long">${h.hits} of ${h.tries}</span><span>${h.rate}%</span><span>${esc(h.last.join(', '))}</span><span>${h.openNow}</span></a>`).join('')
    : '<p class="note">THE FIRST CURVES ARE STILL BEING READ. THE BOARD FILLS WITHIN A FEW HOURS.</p>';
  $('#hu-list').addEventListener('click', e => { const r = e.target.closest('[data-w]'); if (!r) return; e.preventDefault(); one(r.dataset.w); $('#hu-form').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
  const q = new URLSearchParams(location.search).get('w'); if (q && isW(q)) one(q);
})();
$('#hu-form').addEventListener('submit', e => { e.preventDefault(); const a = $('#hu-w').value.trim(); if (isW(a)) one(a); else $('#hu-one').innerHTML = '<p class="note">PASTE A 0x… WALLET.</p>'; });
