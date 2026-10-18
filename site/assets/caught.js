// /caught/: what the radar flagged that then lost half, and what it missed
import { createYard } from './yard.js';
import { mountChrome, $, esc, feedYard } from './ui.js';
import { api } from './data.js';

mountChrome('');
feedYard(createYard($('#yard'), { ambient: true }));
const pc = v => v == null ? '—' : (v > 0 ? '+' : '') + Math.round(v * 100) + '%';
const when = iso => iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const row = r => `<a class="r" href="/replay/?a=${r.token}"><span class="sy">${esc(r.symbol || r.token.slice(0, 8))}<small>${r.token.slice(0, 6)}…${r.token.slice(-4)}</small></span><span>${when(r.read)}</span><span>${r.flags.length ? r.flags.map(esc).join(' · ') : 'no flag'}</span><span class="short">${r.worst <= -1 ? 'no price' : pc(r.worst)}</span><span class="go">→</span></a>`;

async function paint() {
  let v = null; try { v = await api('caught'); } catch (e) {}
  if (!v?.ok) { $('#ca-note').textContent = 'Not answering right now.'; return; }
  $('#ca-f').textContent = v.flagged.toLocaleString('en-US'); $('#ca-f-s').textContent = `of ${v.judged.toLocaleString('en-US')} scanned and judged later`;
  $('#ca-c').textContent = v.caught.toLocaleString('en-US'); $('#ca-c-s').textContent = v.flagged ? `${Math.round(v.caught / v.flagged * 100)}% of the flagged lost half` : 'flagged, then lost half';
  $('#ca-m').textContent = v.missed.toLocaleString('en-US'); $('#ca-m-s').textContent = v.clean ? `${Math.round(v.missed / v.clean * 100)}% of the unflagged lost half` : 'no flag, lost half anyway';
  $('#ca-w').textContent = `${v.week.caught} · ${v.week.missed}`;
  const put = (id, rows, empty) => { const l = $(id); l.querySelectorAll('.r:not(.h)').forEach(n => n.remove()); l.insertAdjacentHTML('beforeend', rows.length ? rows.map(row).join('') : `<p class="note" style="margin:10px 0">${empty}</p>`); };
  put('#ca-list', v.caughtRows, 'Nothing caught yet: no flagged token has lost half since it was scanned.');
  put('#ca-miss', v.missedRows, 'No miss yet.');
  $('#ca-note').textContent = v.note;
}
paint(); setInterval(paint, 5 * 60000);
