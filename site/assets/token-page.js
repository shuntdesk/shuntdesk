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

// the dev ledger: what the launcher's wallet did with $SHUNT, and every burn
const n0 = v => Math.round(v).toLocaleString('en-US'), ago = iso => { const m = (Date.now() - Date.parse(iso)) / 60000; return m < 60 ? Math.round(m) + 'm ago' : m < 1440 ? Math.round(m / 60) + 'h ago' : Math.round(m / 1440) + 'd ago'; };
async function ledger() {
  try {
    const v = await (await fetch('/api/ledger?a=' + CA)).json();
    if (!v.ok) throw new Error(v.why);
    const L = v.ledger, got = L.bought + L.received, out = L.sold + L.toContracts + L.toWallets;
    $('#dl-dev').textContent = 'Dev wallet ' + v.dev.slice(0, 6) + '…' + v.dev.slice(-4) + ' ↗'; $('#dl-dev').href = 'https://robinhoodchain.blockscout.com/address/' + v.dev;
    $('#dl-grid').innerHTML = [
      [n0(got), L.received ? 'Bought or received by the dev' : 'Bought by the dev, on the curve'], [n0(L.burned), 'Burned by the dev'], [n0(L.sold), 'Sold by the dev'],
      [n0(out - L.sold), 'Sent anywhere else'], [n0(v.holdsNow ?? 0), 'Dev holds now'], [n0(v.burns.total), `Burned in all, ${(v.burns.total / 1e7).toFixed(2)}% of supply`],
    ].map(([a, b]) => `<div><b>${a}</b><span>${b}</span></div>`).join('');
    $('#dl-burns').innerHTML = `<h3>${v.burns.count} burns${v.burns.byDev === v.burns.count ? ', all from the dev wallet' : `, ${v.burns.byDev} from the dev wallet`}</h3>` +
      v.burns.last.map(b => `<a href="https://robinhoodchain.blockscout.com/tx/${b.tx}" target="_blank" rel="noopener"><b>${n0(b.amount)}</b><span>${ago(b.at)}</span><i>${b.tx.slice(0, 8)}…${b.tx.slice(-4)} ↗</i></a>`).join('');
    $('#dl-when').textContent = 'read ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (e) { $('#dl-when').textContent = 'could not read right now'; }
}
ledger(); setInterval(ledger, 5 * 60000);
