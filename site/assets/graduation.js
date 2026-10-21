// Graduation Watch: the Pump.fun curves closest to graduating, from the server's read of each curve on Solana
import { createYard } from './yard.js';
import { mountChrome, $, esc, feedYard } from './ui.js';
import { api, ageShort } from './data.js';

mountChrome('');
feedYard(createYard($('#yard'), { ambient: true }));
const usd = v => '$' + (v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : Math.round(v || 0));

async function paint() {
  let v = null; try { v = await api('gradsol'); } catch (e) {}
  if (!v?.rows) { $('#gw-read').textContent = 'not answering right now'; return; }
  if (!v.rows.length) { $('#gw-read').textContent = v.why ? v.why : 'the first read is on its way'; }
  const R = v.rows, fast = [...R].filter(r => r.perHour != null).sort((a, b) => b.perHour - a.perHour)[0], last = v.graduated[0];
  $('#gw-90').textContent = R.filter(r => r.progress >= 90).length; $('#gw-when').textContent = v.read ? 'read ' + ageShort(Date.parse(v.read)) + ' ago' : '···';
  $('#gw-on').textContent = R.length; $('#gw-fast').textContent = fast ? fast.symbol : '···'; $('#gw-fast2').textContent = fast ? `+${fast.perHour} points an hour` : 'the pace needs ten minutes of reads';
  $('#gw-done-n').textContent = v.graduated.length; $('#gw-last').textContent = last ? last.symbol : 'none yet'; $('#gw-last2').textContent = last ? `${ageShort(Date.parse(last.at))} ago, ${last.hours} h after launch` : 'since this page started watching';
  if (v.rows.length) $('#gw-read').textContent = `curves read ${v.read ? ageShort(Date.parse(v.read)) + ' ago' : 'just now'} · list from Codex every twenty minutes`;
  const list = $('#gw-list'); list.querySelectorAll('.r:not(.h)').forEach(n => n.remove());
  list.insertAdjacentHTML('beforeend', R.slice(0, 60).map(r => `<a class="r" href="/ticket/?a=${r.token}">
    <span class="sy">${esc(r.symbol)}${r.verdict ? ` <em class="vd ${r.verdict.verdict}">${r.verdict.verdict}</em>` : ''}<small>${r.token.slice(0, 4)}…${r.token.slice(-4)} · ${usd(r.marketCap)}</small></span>
    <span><div class="bw-bar"><i style="width:${r.progress}%"></i></div><b>${r.progress}%</b></span>
    <span>${r.raised == null ? '<small>quoted in another token</small>' : `${r.raised.toFixed(1)} / ${r.need} SOL`}</span>
    <span class="${r.perHour == null ? '' : r.perHour > 0 ? 'long' : r.perHour < 0 ? 'short' : ''}">${r.perHour == null ? '···' : (r.perHour > 0 ? '+' : '') + r.perHour + ' pts'}</span>
    <span>${r.etaHours != null ? '~' + (r.etaHours < 1 ? Math.round(r.etaHours * 60) + ' min' : r.etaHours + ' h') : r.perHour != null && r.perHour <= 0 ? 'stalled' : '···'}</span>
    <span>${ageShort(Date.parse(r.launched))}</span><span class="go">→</span></a>`).join(''));
  $('#gw-done').innerHTML = v.graduated.length ? v.graduated.map(b => `<a href="/ticket/?a=${b.token}">${esc(b.symbol)}<small>${ageShort(Date.parse(b.at))} ago · ${b.hours} h</small></a>`).join('') : '<p class="note" style="margin:0">None seen yet: graduations show here as this page catches them.</p>';
}
paint(); setInterval(paint, 30000);
