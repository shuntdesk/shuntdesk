// /token/: the official $SHUNT page, its address to copy and its launch read live from Shuntdesk's own API
import { createYard } from './yard.js';
import { mountChrome, $ } from './ui.js';

const CA = '0x7e517e779b85895894becad80c9bb69b4cb1c4d6';
mountChrome('');
createYard($('#yard'), { ambient: true });   // no live feed here: another token's GRADUATED next to $SHUNT would read as ours

const btn = $('#tk-ca');
btn.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(CA); } catch (e) {}
  btn.classList.add('done'); btn.querySelector('i').textContent = 'COPIED';
  setTimeout(() => { btn.classList.remove('done'); btn.querySelector('i').textContent = 'COPY'; }, 1600);
});

const pct = v => v == null ? '—' : (Math.round(v * 10) / 10) + '%';
async function read() {
  try {
    const j = await (await fetch('/api/v1/token?a=' + CA)).json(), L = j.launch || {};
    const p = Math.max(0, Math.min(100, L.progress || 0));
    $('#tk-fill').style.width = p + '%';
    $('#tk-prog').textContent = 'Curve progress ' + pct(L.progress);
    $('#tk-state').textContent = L.graduated ? 'Bonded' : 'On the Pons curve';
    const cells = [
      ['Holders', String(L.holders ?? j.serverCheck?.holders ?? '—')],
      ['Ten largest hold', pct(L.top10Pct)],
      ['Developer holds', pct(L.devPct)],
      ['Launch snipers', String(L.snipers ?? '—')],
      ['Bundles', String(L.bundlers ?? '—')],
      ['Red flags (GoPlus)', String(j.serverCheck?.redFlags?.length ?? '—')],
    ];
    $('#tk-grid').innerHTML = cells.map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('');
    $('#tk-when').textContent = 'read ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (e) { $('#tk-when').textContent = 'could not read right now'; }
}
read(); setInterval(read, 60000);
