// /ape/: Ape Check, one StonkFun token, one score, every lost point, and a card to post
import { createYard } from './yard.js';
import { mountChrome, $, esc, feedYard } from './ui.js';
import { api } from './data.js';
mountChrome('');
feedYard(createYard($('#yard'), { ambient: true }));
const isM = a => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
let job = 0;
async function run(m) {
  const id = ++job; $('#ap-m').value = m; history.replaceState(null, '', '?m=' + m);
  $('#ap-out').hidden = true; $('#ap-msg').textContent = 'READING THE LAUNCHER, THE HOLDERS AND THE FIRST BUYERS…';
  let v = null; try { v = await api('ape?m=' + m); } catch (e) {}
  if (id !== job) return;
  if (!v?.ok) { $('#ap-msg').textContent = (v?.error || 'could not read it right now').toUpperCase() + '.'; return; }
  $('#ap-msg').textContent = `$${(v.symbol || '?').toUpperCase()} · ${v.score} OF 100 · ${v.grade}`;
  const link = `https://shuntdesk.com/card/ape/${m}`, text = `$${v.symbol} Ape Check on Shuntdesk: ${v.score}/100, ${v.grade.toLowerCase()}.`;
  $('#ap-card').src = `/card/ape/${m}.png?h=${Math.floor(Date.now() / 600000)}`;
  $('#ap-why').innerHTML = [...v.lost.map(l => `<p class="short" style="margin:6px 0">−${l.points} · ${esc(l.why)}</p>`), ...v.kept.map(k => `<p class="long" style="margin:6px 0">✓ ${esc(k)}</p>`)].join('') || '<p class="note">NOTHING LOST.</p>';
  $('#ap-x').href = 'https://x.com/intent/post?text=' + encodeURIComponent(text + '\n\n' + link);
  $('#ap-t').href = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
  $('#ap-copy').onclick = async e => { try { await navigator.clipboard.writeText(link); e.target.textContent = 'Copied'; } catch (x) { e.target.textContent = 'Select the link'; } };
  $('#ap-full').href = '/ticket/?a=' + m; $('#ap-note').textContent = v.note; $('#ap-out').hidden = false;
}
$('#ap-form').addEventListener('submit', e => { e.preventDefault(); const a = $('#ap-m').value.trim(); if (isM(a)) run(a); else $('#ap-msg').textContent = 'PASTE A SOLANA TOKEN MINT.'; });
const q = new URLSearchParams(location.search).get('m'); if (q && isM(q)) run(q);
