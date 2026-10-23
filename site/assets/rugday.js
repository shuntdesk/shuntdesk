// /rug-of-the-day/: the day's pick on Robinhood Chain, its card and a draft post to copy
import { createYard } from './yard.js';
import { mountChrome, $, esc, feedYard } from './ui.js';
import { api } from './data.js';
mountChrome('');
feedYard(createYard($('#yard'), { ambient: true }));
const usd = v => '$' + (v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : Math.round(v || 0));
const w4 = a => a.slice(0, 6) + '…' + a.slice(-4);
(async () => {
  let v = null; try { v = await api('rugday' + (new URLSearchParams(location.search).has('preview') ? '?preview=1' : '')); } catch (e) {}
  const r = v?.today || v?.preview;
  if (!r) { $('#rd').innerHTML = '<p class="note">THE FIRST ONE IS PICKED AT 12:00 UTC.</p>'; return; }
  if (!v.today) $('#rd-cap').textContent = 'Preview';
  $('#rd').innerHTML = `<div style="display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:18px;align-items:start">
    <a href="/ticket/?a=${r.token}"><img src="/card/${r.token}.png?d=${r.day}" alt="Shuntdesk card for ${esc(r.symbol)}" style="width:100%;border-radius:8px;display:block"></a>
    <div><div class="lk-big"><b class="short">-${r.fell}%</b><span>${esc('$' + r.symbol)} · A DAY AFTER THE RADAR READ IT · ${r.day}</span></div>
      <div class="lk-row"><span>Pool when read<b>${usd(r.liquidity)}</b></span><span>Holders<b>${r.holders}</b></span>${r.sold != null ? `<span>Launcher sold or moved<b class="${r.sold >= 50 ? 'short' : ''}">${r.sold}%</b></span>` : ''}</div>
      <p class="note">${r.flags.length ? 'FLAGGED THEN: ' + esc(r.flags.slice(0, 4).join(' · ').toUpperCase()) : 'NO FLAG AT THE TIME: A MISS, ON THE CAUGHT PAGE TOO'}</p>
      <div class="cap" style="margin-top:14px"><b>Draft post</b><span><button class="btn ghost" id="cp" type="button">Copy</button></span></div>
      <pre id="cap" style="white-space:pre-wrap;font:14px/1.5 'JetBrains Mono',monospace;margin:8px 0 0;color:var(--ink)">${esc(r.caption)}</pre></div></div>`;
  $('#cp').onclick = async e => { try { await navigator.clipboard.writeText(r.caption); e.target.textContent = 'Copied'; } catch (x) { e.target.textContent = 'Select and copy'; } };
  $('#rd-old').innerHTML = (v.earlier || []).map(x => `<a class="r" href="/ticket/?a=${x.token}"><span class="sy">${esc(x.symbol)}<small>${x.day} · ${w4(x.token)}</small></span><span class="short">-${x.fell}%</span><span>${usd(x.liquidity)} pool</span></a>`).join('') || '<p class="note">NONE YET.</p>';
})();
