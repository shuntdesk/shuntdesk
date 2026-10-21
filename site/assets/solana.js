// /solana/: the Solana hub. Rug of the Day with its draft post, the Deployer Board and the curves near the line
import { createYard } from './yard.js';
import { mountChrome, $, esc, feedYard } from './ui.js';
import { api, ageShort, isSol } from './data.js';

mountChrome('');
feedYard(createYard($('#yard'), { ambient: true }));
const usd = v => '$' + (v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : Math.round(v || 0));
const w4 = a => a.slice(0, 4) + '…' + a.slice(-4);
$('#sx-f').addEventListener('submit', async e => { e.preventDefault(); const a = $('#sx-a').value.trim(); if (!isSol(a)) { $('#sx-msg').textContent = 'THAT IS NOT A SOLANA ADDRESS.'; return; }
  $('#sx-msg').textContent = 'CHECKING WHETHER IT IS A TOKEN OR A WALLET…'; let r = null; try { r = await (await fetch('/api/sol?a=' + a)).json(); } catch (x) {}
  location.href = r?.verdict && r.verdict !== 'NO POOL' ? '/ticket/?a=' + a : '/wallet/?w=' + a; });

async function paint() {
  let v = null; try { v = await api('solhub'); } catch (e) {}
  if (!v?.ok) { $('#rd').innerHTML = '<p class="note">NOT ANSWERING RIGHT NOW.</p>'; return; }
  const r = v.rugDay[0];
  $('#rd').innerHTML = !r ? '<p class="note">THE FIRST ONE IS PICKED AT 12:00 UTC, FROM THE TOKENS SHUNTDESK FOLLOWS: A PEAK OF $20K OR MORE, THEN A FALL OF 75% OR MORE WITHIN A DAY.</p>'
    : `<div style="display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:18px;align-items:start" class="rd-g">
      <a href="/ticket/?a=${r.token}"><img src="/card/${r.token}.png?d=${r.day}" alt="Shuntdesk card for ${esc(r.symbol)}" style="width:100%;border-radius:8px;display:block"></a>
      <div><div class="lk-big"><b class="short">-${r.fell}%</b><span>${esc('$' + r.symbol)} · ${usd(r.peak)} TO ${usd(r.now)} · ${r.day}</span></div>
        <div class="lk-row"><span>Peak<b>${r.hoursToPeak} h after first seen</b></span>${r.sold != null ? `<span>Deployer sold or sent<b class="${r.sold >= 50 ? 'short' : ''}">${r.sold}%</b></span>` : ''}${r.created != null ? `<span>Tokens it created lately<b>${r.created}</b></span>` : ''}</div>
        <div class="cap" style="margin-top:14px"><b>Draft post</b><span><button class="btn ghost" id="rd-copy" type="button">Copy</button></span></div>
        <pre id="rd-cap" style="white-space:pre-wrap;font:14px/1.5 'JetBrains Mono',monospace;margin:8px 0 0;color:var(--ink)">${esc(r.caption)}</pre></div></div>`;
  if (r) { $('#rd-copy').onclick = async e => { try { await navigator.clipboard.writeText(r.caption); e.target.textContent = 'Copied'; } catch (x) { e.target.textContent = 'Select and copy'; } }; $('#rd-by').textContent = `picked ${r.day} · earlier: ${v.rugDay.slice(1, 5).map(x => '$' + x.symbol).join(', ') || 'none yet'}`; }
  const B = v.board, row = x => `<a class="r" href="/dev/?w=${x.wallet}"><span class="sy">${w4(x.wallet)}<small>${x.last ? esc('$' + x.last.symbol) + ' · ' + ageShort(Date.parse(x.last.at)) + ' ago' : ''}</small></span><span>${x.launched} launched</span><span class="${x.judged && x.dead / x.judged >= 0.7 ? 'short' : ''}">${x.dead} dead</span><span class="${x.graduated ? 'long' : ''}">${x.graduated} graduated</span></a>`;
  $('#db-by').textContent = B.deployers ? `${B.deployers} deployers read this week` : 'it fills as deployers are read';
  $('#db-f').innerHTML = B.factories.length ? B.factories.slice(0, 10).map(row).join('') : '<p class="note">NO DEPLOYER READ YET THIS WEEK.</p>';
  $('#db-l').innerHTML = B.lasting.length ? B.lasting.map(row).join('') : '<p class="note">NONE YET.</p>';
  const G = v.graduation;
  $('#gl').innerHTML = G.rows.map(x => `<a class="r" href="/ticket/?a=${x.token}"><span class="sy">${esc(x.symbol)}<small>${w4(x.token)} · ${usd(x.marketCap)}</small></span><span><div class="bw-bar"><i style="width:${x.progress}%"></i></div><b>${x.progress}%</b></span><span>${x.perHour == null ? '···' : (x.perHour > 0 ? '+' : '') + x.perHour + ' pts/h'}</span></a>`).join('') || '<p class="note">READING THE CURVES…</p>';
  $('#gd').innerHTML = G.graduated.map(b => `<a href="/ticket/?a=${b.token}">${esc(b.symbol)}<small>${ageShort(Date.parse(b.at))} ago · ${b.hours} h</small></a>`).join('');
}
paint(); setInterval(paint, 60000);
