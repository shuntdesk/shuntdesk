// /proof/: everything about $SHUNT that can be checked, read from the chain when the page opens
import { createYard } from './yard.js';
import { mountChrome, $, esc } from './ui.js';
import { api } from './data.js';

mountChrome('');
createYard($('#yard'), { ambient: true });
const CA = '0x7e517e779b85895894becad80c9bb69b4cb1c4d6', BS = 'https://robinhoodchain.blockscout.com';
const n0 = v => Math.round(v || 0).toLocaleString('en-US'), pct = (a, b) => b > 0 ? Math.round(a / b * 100) + '%' : '0%';
const when = iso => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

async function paint() {
  let v = null; try { v = await api('proof'); } catch (e) {}
  if (!v?.ok) { $('#pf-ct').textContent = 'Not answering right now. Try again in a minute.'; return; }
  const dl = v.ledger;
  if (dl) {
    const L = dl.ledger, got = L.bought + L.received, out = L.sold + L.toWallets + L.toContracts;
    $('#pf-got').textContent = n0(got); $('#pf-sold').textContent = n0(out); $('#pf-sold').className = 'v ' + (out ? 'short' : 'long');
    $('#pf-sold-s').textContent = `${pct(out, got)} of what it got`;
    $('#pf-burn').textContent = n0(dl.burns.total); $('#pf-burn-s').textContent = `${(dl.burns.total / 1e7).toFixed(2)}% of supply, ${dl.burns.count} burns`;
    $('#pf-hold').textContent = n0(dl.holdsNow);
    $('#pf-got-s').innerHTML = `on the curve · <a href="${BS}/address/${dl.dev}" target="_blank" rel="noopener">${dl.dev.slice(0, 6)}…${dl.dev.slice(-4)} ↗</a>`;
    $('#pf-bn').textContent = dl.burns.byDev === dl.burns.count ? `${dl.burns.count} burns, all from the dev wallet` : `${dl.burns.count} burns, ${dl.burns.byDev} from the dev wallet`;
    $('#pf-burns').innerHTML = dl.burns.last.map(b => `<a href="${BS}/tx/${b.tx}" target="_blank" rel="noopener"><b>${n0(b.amount)}</b><span>${when(b.at)}</span><i>${b.tx.slice(0, 8)}…${b.tx.slice(-4)} ↗</i></a>`).join('');
  }
  const c = v.contract;
  $('#pf-ct').innerHTML = c ? `<p><b>${c.functions}</b> functions, ${c.named} named${c.unknown ? `, ${c.unknown} unknown` : ''}.</p>
    <p>${c.powers.length ? 'Powers: ' + c.powers.map(esc).join(', ') : 'No function that mints, pauses trading, blocks wallets or changes the tax.'}</p>
    <p>${c.proxy ? 'Behind a proxy: its code can be swapped.' : 'Not a proxy: the code cannot be swapped.'}</p>
    <p><a href="/scan/?a=${CA}">The full Agent Scan →</a></p>` : 'Could not read the contract right now.';
  const cv = v.curve;
  $('#pf-cv').innerHTML = cv ? `<p><b>${cv.graduated ? 'Bonded' : (Math.round(cv.progress * 10) / 10) + '%'}</b>${cv.graduated ? '' : ` to bond: ${cv.raised?.toFixed(3)} of ${cv.need} ETH`}.</p>${cv.holders ? `<p>${n0(cv.holders)} holders.</p>` : ''}<p><a href="https://ponsfamily.com/launchpad/${CA}" target="_blank" rel="noopener">The token on Pons ↗</a></p>` : 'Could not read the curve right now.';
  const r = v.record, held = s => s.n ? `${s.right} of ${s.n}` : 'none checked yet';
  $('#pf-rec').innerHTML = `<p><b>${n0(r.calls)}</b> calls on record, each priced an hour and a day later.</p><p>CLEAN calls up a day later: ${held(r.clean)}.<br>DANGER calls down a day later: ${held(r.danger)}.</p><p><a href="/report/">The daily report →</a></p>`;
  $('#pf-links').innerHTML = `<a href="${v.links.source}" target="_blank" rel="noopener">The source code, open on GitHub ↗</a><a href="${v.links.data}" target="_blank" rel="noopener">Every call, as open data ↗</a><a href="/lab/">Every rule against what happened →</a><a href="/caught/">What the radar caught, and missed →</a>`;
}
paint();
$('#pf-badge').src = `/badge/${CA}.svg`;
$('#pf-embed').textContent = `<a href="https://shuntdesk.com/ticket/?a=${CA}"><img src="https://shuntdesk.com/badge/${CA}.svg" alt="Scanned by Shuntdesk" width="340" height="64"></a>`;
