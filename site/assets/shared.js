// /shared/: Shared Bags. The wallets among the largest holders of two tokens that hold both
import { createYard } from './yard.js';
import { mountChrome, $, feedYard } from './ui.js';
import { isAddr } from './data.js';

mountChrome('');
feedYard(createYard($('#yard'), { ambient: true }));
const pc = v => v == null ? '—' : v.toFixed(v < 1 ? 2 : 1) + '%';
async function go(a, b) {
  history.replaceState(null, '', `?a=${a}&b=${b}`); $('#sb-out').hidden = true; $('#sb-msg').textContent = 'READING BOTH HOLDER LISTS…';
  let v = null; try { v = await (await fetch(`/api/shared?a=${a}&b=${b}`)).json(); } catch (e) {}
  if (!v?.ok) { $('#sb-msg').textContent = String(v?.why || 'not answering right now').toUpperCase() + '.'; return; }
  $('#sb-msg').textContent = ''; $('#sb-out').hidden = false;
  $('#sb-n').textContent = v.shared; $('#sb-a2').textContent = pc(v.heldA); $('#sb-b2').textContent = pc(v.heldB); $('#sb-r').textContent = `${v.readA} · ${v.readB}`;
  const l = $('#sb-list'); l.querySelectorAll('.r:not(.h), p').forEach(x => x.remove());
  l.insertAdjacentHTML('beforeend', v.wallets.length ? v.wallets.map(w => `<a class="r" href="/wallet/?w=${w.wallet}"><span class="sy">${w.wallet.slice(0, 6)}…${w.wallet.slice(-4)}</span><span>${pc(w.shareA)}</span><span>${pc(w.shareB)}</span><span class="go">→</span></a>`).join('') : '<p class="note" style="margin:10px 0">No wallet holds both among the largest holders.</p>');
  $('#sb-note').textContent = (v.unread ? `${v.unread} shared address${v.unread === 1 ? '' : 'es'} could not be checked for code and ${v.unread === 1 ? 'is' : 'are'} left out. ` : '') + (v.past40 ? `${v.past40} more shared address${v.past40 === 1 ? '' : 'es'} past the first 40 not checked. ` : '') + v.note;
}
$('#sb-form').addEventListener('submit', e => { e.preventDefault(); const a = $('#sb-a').value.trim().toLowerCase(), b = $('#sb-b').value.trim().toLowerCase(); if (isAddr(a) && isAddr(b) && a !== b) go(a, b); else $('#sb-msg').textContent = 'PASTE TWO DIFFERENT 0x… TOKENS.'; });
const q = new URLSearchParams(location.search); if (isAddr(q.get('a') || '') && isAddr(q.get('b') || '')) { $('#sb-a').value = q.get('a'); $('#sb-b').value = q.get('b'); go(q.get('a').toLowerCase(), q.get('b').toLowerCase()); }
