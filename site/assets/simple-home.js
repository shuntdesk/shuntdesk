// The landing: one field to check a token, the site's own numbers, the latest calls and how they held, the tools.
import { mountChrome, $, esc } from './ui.js';
import { api, newPools, isToken as isAddr, ageShort } from './data.js';

mountChrome('Yard');
const go = a => { a = a.trim(); location.href = '/ticket/?a=' + (/^0x/i.test(a) ? a.toLowerCase() : a); };
$('#hf').addEventListener('submit', e => { e.preventDefault(); const a = $('#ha').value.trim(); if (isAddr(a)) go(a); else { $('#ha').value = ''; $('#ha').placeholder = 'That is not an address: 0x… on Robinhood Chain, or a Solana mint.'; } });

const pct = v => (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%';
// the numbers on the desk page, as they are now
api('desk').then(d => {
  if (!d) return;
  const r = d.record, calls = Object.values(r.count || {}).reduce((s, n) => s + n, 0), h = r.after1h?.CLEAN;
  $('#st-calls').textContent = calls.toLocaleString('en-US');
  $('#st-desk').textContent = pct(d.equity / d.start - 1); $('#st-desk').className = d.equity >= d.start ? 'long' : 'short';
  $('#st-held').textContent = h?.n ? `${h.right} of ${h.n}` : '···';
  $('#hw-eq').textContent = Math.round(d.equity).toLocaleString('en-US') + ' USDG';
}).catch(() => {});

// the latest calls, with the price an hour later when there is one
api('v1/verdicts').then(j => {
  const rows = (j?.verdicts || []).slice(0, 8);
  if (!rows.length) { $('#calls').innerHTML = '<p class="note">No calls yet. Run a ticket and yours is the first.</p>'; return; }
  $('#calls').innerHTML = '<div class="cr h"><span>Filed</span><span>Token</span><span>Verdict</span><span>Desk</span><span>An hour later</span></div>' + rows.map(v => {
    const m = v.after1h && v.priceAtVerdict ? v.after1h / v.priceAtVerdict - 1 : null;
    return `<a class="cr" href="/ticket/?a=${v.token}"><span>${ageShort(Date.parse(v.at))} ago</span><b>${esc(v.symbol || v.token.slice(0, 8))}</b><span><i class="vd ${v.verdict}">${v.verdict} ${v.score}</i></span><span>${v.desk === 'depot' ? 'depot' : v.desk + ' desk'}</span><span class="${m == null ? '' : m >= 0 ? 'long' : 'short'}">${m == null ? 'not yet' : pct(m)}</span></a>`;
  }).join('');
}).catch(() => { $('#calls').innerHTML = '<p class="note">The calls are not loading right now.</p>'; });

// a few of the newest pools to try
newPools().then(({ rows }) => {
  $('#htry').insertAdjacentHTML('beforeend', rows.slice(0, 5).map(r => `<button type="button" data-a="${r.addr}">${esc(r.sym)}<small>${ageShort(r.created)}</small></button>`).join(''));
  $('#htry').addEventListener('click', e => { const b = e.target.closest('button[data-a]'); if (b) go(b.dataset.a); });
}).catch(() => { $('#htry').hidden = true; });
