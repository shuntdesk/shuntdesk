// /profit/: Profit Map, what every wallet paid on a Pons curve against the price now
import { createYard } from './yard.js';
import { mountChrome, $, esc, feedYard } from './ui.js';
import { api } from './data.js';
mountChrome('');
feedYard(createYard($('#yard'), { ambient: true }));
const isT = a => /^0x[0-9a-fA-F]{40}$/.test(a);
const n0 = v => v >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : Math.round(v || 0).toString();
const e4 = v => (v >= 0 ? '' : '-') + Math.abs(v).toFixed(4);
const usd = v => v == null ? '—' : v < 0.01 ? '$' + v.toPrecision(3) : '$' + v.toFixed(4);
const COL = { under: 'var(--short)', '1–2x': 'var(--mut)', '2–5x': 'var(--long)', '5x+': 'var(--long)' };
let job = 0;
async function run(a) {
  const id = ++job; a = a.toLowerCase(); $('#pm-a').value = a; history.replaceState(null, '', '?a=' + a);
  $('#pm-out').hidden = true; $('#pm-msg').textContent = 'READING EVERY TRADE ON ITS CURVE…';
  let v = null; try { v = await api('profit?a=' + a); } catch (e) {}
  if (id !== job) return;
  if (!v?.ok) { $('#pm-msg').textContent = (v?.error || 'could not read it right now').toUpperCase() + '.'; return; }
  $('#pm-msg').innerHTML = `${v.trades.toLocaleString('en-US')} CURVE TRADES BY ${v.buyers} BUYERS · ${v.graduated ? 'BONDED, PRICED FROM THE ' + v.priceFrom.toUpperCase() : 'CURVE AT ' + v.progress.toFixed(1) + '%'} · <a class="acc" href="/ticket/?a=${a}">THE SEVEN CHECKS →</a>`;
  $('#pm-in').textContent = v.inProfit == null ? '—' : v.inProfit + '%'; $('#pm-in').className = 'v ' + (v.inProfit >= 50 ? 'long' : '');
  $('#pm-h').textContent = v.holding; $('#pm-h-s').textContent = `wallets still holding, of ${v.buyers} buyers`;
  $('#pm-f').textContent = v.fallIfTwoXSell == null ? '—' : '-' + v.fallIfTwoXSell + '%'; $('#pm-f').className = 'v ' + (v.fallIfTwoXSell >= 30 ? 'short' : '');
  $('#pm-f-s').textContent = v.graduated ? 'bonded: the pool is not modelled' : v.fallIfTwoXSell == null ? 'nobody holds at 2x or more' : 'if every 2x+ holder sold into the curve now';
  $('#pm-p').textContent = v.priceUsd != null ? usd(v.priceUsd) : v.price.toPrecision(3) + ' ETH'; $('#pm-p-s').textContent = `per token, from the ${v.priceFrom}`;
  $('#pm-bands').innerHTML = `<div style="display:flex;height:22px;border-radius:4px;overflow:hidden;margin:10px 0 12px">${v.bands.filter(b => b.share > 0).map(b => `<span title="${b.band}" style="width:${b.share}%;background:${COL[b.band]};opacity:${b.band === '5x+' ? 1 : b.band === '2–5x' ? .7 : .55}"></span>`).join('')}</div>
    <div class="lk-row">${v.bands.map(b => `<span>${b.band === 'under' ? 'Under water' : b.band}<b class="${b.band === 'under' ? 'short' : b.band === '1–2x' ? '' : 'long'}">${b.share}%</b><small style="display:block;color:var(--dim)">${b.wallets} wallets</small></span>`).join('')}</div>`;
  $('#pm-top').innerHTML = `<div class="r h"><span>WALLET</span><span>HOLDS</span><span>PAID</span><span>NOW</span><span>WORTH</span><span>TAKEN OUT</span></div>` + v.top.map(t => `<a class="r" href="/wallet/?a=${t.wallet}"><span class="sy">${t.wallet.slice(0, 6)}…${t.wallet.slice(-4)}<small>${t.share}% of what is held</small></span><span>${n0(t.tokens)}</span><span>${e4(t.paid)} ETH</span><span class="${t.mult >= 1 ? 'long' : 'short'}">${t.mult}x</span><span>${e4(t.worth)} ETH</span><span class="${t.realized >= 0 ? 'long' : 'short'}">${e4(t.realized)} ETH</span></a>`).join('');
  $('#pm-note').textContent = v.note; $('#pm-out').hidden = false;
}
$('#pm-form').addEventListener('submit', e => { e.preventDefault(); const a = $('#pm-a').value.trim(); if (isT(a)) run(a); else $('#pm-msg').textContent = 'PASTE A 0x… PONS TOKEN.'; });
const q = new URLSearchParams(location.search).get('a'); if (q && isT(q)) run(q);
