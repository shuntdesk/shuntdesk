// Agent Scan page: the server reads the contract's bytecode and names its functions; this page lays it out.
import { createYard } from './yard.js';
import { mountChrome, $, esc, feedYard } from './ui.js';
import { api, isAddr } from './data.js';
import { siteCheck } from './sitecheck.js';

mountChrome('');
feedYard(createYard($('#yard'), { ambient: true }));
const msg = $('#msg'), short = a => a.slice(0, 6) + '…' + a.slice(-4), X = 'https://robinhoodchain.blockscout.com/address/';
const LV = { high: 'HIGH', medium: 'MEDIUM', low: 'LOW', info: 'INFO' };
let last = null, job = 0;

function fmt(s) {
  if (s.kind === 'address') return `<a href="${X}${s.v}" target="_blank" rel="noopener">${short(s.v)}</a>`;
  if (s.kind === 'bool') return s.v ? 'yes' : 'no';
  const n = BigInt(s.v);
  if (n > 10n ** 15n) { const d = Number(n / 10n ** 12n) / 1e6; return `${s.v.length > 24 ? Number(s.v).toExponential(3) : Number(s.v).toLocaleString('en-US')}<small> · ${d.toLocaleString('en-US', { maximumFractionDigits: 2 })} at 18 decimals</small>`; }
  return n.toLocaleString('en-US');
}

function paint(v) {
  $('#out').hidden = false;
  const hi = v.powers.filter(p => p.level === 'high'), md = v.powers.filter(p => p.level === 'medium');
  const ownerLive = v.owner?.live, guarded = v.owner && !ownerLive && !v.proxy && !v.roles;
  const tag = hi.length && !guarded ? `${hi.length} HIGH-RISK POWER${hi.length > 1 ? 'S' : ''}` : hi.length ? 'POWERS PRESENT, OWNER RENOUNCED' : md.length ? 'NO HIGH-RISK POWER FOUND' : 'NOTHING FOUND TO PULL';
  $('#xr-tag').textContent = tag; $('#xr-hero').className = 'stub xr-hero ' + (hi.length && !guarded ? 'r' : hi.length || md.length ? '' : 'g');
  $('#xr-by').textContent = v.summary.by === 'model' ? 'written by a language model from the findings' : 'written by fixed rules from the findings';
  $('#xr-sum').textContent = v.summary.text;
  $('#xr-own').innerHTML = v.owner ? (ownerLive ? `<a href="${X}${v.owner.address}" target="_blank" rel="noopener">${short(v.owner.address)}</a>` : 'Renounced') : v.roles ? 'Admin roles' : 'No owner()';
  $('#xr-own2').textContent = v.owner ? (ownerLive ? 'a live owner' : 'owner set to zero or dead') : v.roles ? 'AccessControl' : 'not visible from the bytecode';
  $('#xr-fn').textContent = String(v.functions); $('#xr-fn2').textContent = v.unknown ? `${v.unknown} not named in any database` : 'all of them named';
  $('#xr-px').textContent = v.proxy ? 'Swappable' : 'Fixed'; $('#xr-px').className = 'v sm ' + (v.proxy ? 'short' : '');
  $('#xr-px2').textContent = v.proxy ? `${v.proxy.kind} → ${short(v.proxy.implementation)}` : 'not a proxy';
  $('#xr-src').textContent = v.source.verified ? 'Verified' : v.source.verified === false ? 'Not verified' : 'Unknown';
  const pw = v.powers.filter(p => p.level !== 'info').sort((a, b) => ['high', 'medium', 'low'].indexOf(a.level) - ['high', 'medium', 'low'].indexOf(b.level));
  $('#xr-pw').innerHTML = pw.length ? pw.map(p => `<div class="xr-r ${p.level}"><em>${LV[p.level]}</em><code>${esc(p.fn)}</code><span>can ${esc(p.what)}${guarded ? ' · locked if owner-only' : ''}</span><i>0x${p.sel}</i></div>`).join('')
    : '<p class="note" style="margin:6px 0 0">No function found that mints, pauses, blocks wallets, changes the tax, changes limits or pulls funds.</p>';
  $('#xr-stbox').hidden = !v.state.length;
  $('#xr-st').innerHTML = v.state.map(s => `<div><span>${esc(s.fn)}</span><b>${fmt(s)}</b></div>`).join('');
  $('#xr-all').innerHTML = v.list.map(f => `<span class="${f.name ? '' : 'unk'}"><i>0x${f.sel}</i>${esc(f.name || 'unknown function')}</span>`).join('');
  $('#xr-ticket').href = '/ticket/?a=' + v.token;
  msg.textContent = `${v.functions} FUNCTIONS · ${pw.length} POWER${pw.length === 1 ? '' : 'S'} · ${v.proxy ? 'PROXY' : 'FIXED CODE'} · READ ${new Date(v.t).toISOString().slice(11, 16)} UTC`;
}

async function run(a) {
  const id = ++job; a = a.toLowerCase(); $('#a').value = a; $('#out').hidden = true;
  history.replaceState(null, '', '?a=' + a);
  msg.textContent = 'READING THE BYTECODE AND NAMING EVERY FUNCTION…';
  let v = null; try { v = await api('xray?a=' + a); } catch (e) {}
  if (id !== job) return;
  if (!v?.ok) { msg.textContent = (v?.why || 'the chain did not answer, try again in a minute').toUpperCase() + '.'; return; }
  last = v; paint(v); ownerIntel(v); siteCheck($('#sc'), v.token);
}
$('#f').addEventListener('submit', e => { e.preventDefault(); const a = $('#a').value.trim(); if (!isAddr(a)) { msg.textContent = 'THAT IS NOT AN ADDRESS. IT SHOULD BE 0x FOLLOWED BY 40 HEX CHARACTERS.'; return; } run(a); });
const q = new URLSearchParams(location.search).get('a'); if (isAddr(q)) run(q);
const link = () => location.origin + '/scan/?a=' + last?.token;
$('#xr-x').onclick = () => { if (!last) return; const hi = last.powers.filter(p => p.level === 'high'); const txt = hi.length ? `Agent Scan on ${short(last.token)}: ${last.functions} functions, and the contract can ${[...new Set(hi.map(p => p.what))].slice(0, 3).join(', ')}.` : `Agent Scan on ${short(last.token)}: ${last.functions} functions, none that mints, pauses, blocks wallets or changes the tax.`; window.open('https://x.com/intent/post?text=' + encodeURIComponent(txt) + '&url=' + encodeURIComponent(link()), '_blank', 'noopener'); };
$('#xr-link').onclick = async e => { if (!last) return; try { await navigator.clipboard.writeText(link()); e.target.textContent = 'Copied'; } catch (x) { e.target.textContent = link(); } };

// the owner off this chain: Webacy's risk read, and its history on Ethereum and Arbitrum
async function ownerIntel(v) {
  if (!v.owner?.live) return;
  let j = null; try { j = await api('intel?w=' + v.owner.address); } catch (e) {}
  const x = j?.wallets?.[v.owner.address]; if (!x?.ok || last !== v) return;
  const tags = x.risk?.tags || [], hist = [['Ethereum', x.ethereum], ['Arbitrum', x.arbitrum]].filter(([, h]) => h?.txs).map(([k, h]) => `${k} ${h.txs} tx`);
  $('#xr-own2').innerHTML = tags.length ? `<span class="short">${tags.slice(0, 2).map(t => esc(t.name)).join(' · ')}</span>` : `no risk flag${hist.length ? ' · ' + hist.join(', ') : ''}`;
}
// Tripwire by email: one confirmation email first
$('#tw-f').addEventListener('submit', async e => {
  e.preventDefault(); if (!last) return;
  const email = $('#tw-e').value.trim(); if (!email) return;
  $('#tw-msg').textContent = 'SENDING THE CONFIRMATION EMAIL…';
  let r = null; try { r = await api('trip/email', { email, token: last.token }); } catch (x) {}
  $('#tw-msg').textContent = (r?.why || 'not answering right now').toUpperCase() + '.';
});