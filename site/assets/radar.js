// Radar: the server's own scans of every new token, newest first, with what the price did next.
import { createYard } from './yard.js';
import { mountChrome, $, esc, feedYard } from './ui.js';
import { api, ageShort, compact } from './data.js';

mountChrome('');
feedYard(createYard($('#yard'), { ambient: true }));
const mv = v => v == null ? '<span class="mut">···</span>' : `<span class="${v >= 0 ? 'long' : 'short'}">${v >= 0 ? '+' : ''}${Math.round(v * 100)}%</span>`;
const rate = r => r.n ? `${r.fellHalf1h} of ${r.n}` : 'not yet';

async function paint() {
  let v = null; try { v = await api('radar'); } catch (e) {}
  if (!v?.ok) { $('#rd-read').textContent = 'not answering right now'; return; }
  $('#rd-log').textContent = v.logged.toLocaleString('en-US'); $('#rd-scan').textContent = v.scanned.toLocaleString('en-US');
  $('#rd-f').textContent = rate(v.record.flagged); $('#rd-c').textContent = rate(v.record.clean);
  const list = $('#rd-list'); list.querySelectorAll('.r:not(.h)').forEach(n => n.remove());
  list.insertAdjacentHTML('beforeend', v.rows.map(r => `<a class="r" href="/ticket/?a=${r.token}"><span class="sy">${esc(r.symbol || r.token.slice(0, 8))}<small>${r.launchpad === 'pons' ? 'Pons' : r.token.slice(0, 6) + '…' + r.token.slice(-4)}</small></span>
    <span>${ageShort(Date.parse(r.read))} ago</span><span>$${compact(r.liquidity)}</span>
    <span class="rd-f">${r.flags.length ? r.flags.map(f => `<i>${esc(f)}</i>`).join('') : '<em>nothing found</em>'}</span>
    <span>${mv(r.move1h)}</span><span>${mv(r.move24h)}</span><span class="go">→</span></a>`).join('') || '<p class="note" style="margin:10px 0 0">The radar has not scanned anything yet. It takes a few minutes after the log starts.</p>');
}
paint(); setInterval(paint, 60000);
