// Wallet X-ray: the server lists the wallet's tokens with what it knows of them; prices and the way out come from
// DexScreener in this browser, and Agent Scan is asked about the largest holdings.
import { createYard } from './yard.js';
import { mountChrome, $, esc, feedYard } from './ui.js';
import { api, prices, isAddr, compact } from './data.js';

mountChrome('');
feedYard(createYard($('#yard'), { ambient: true }));
const msg = $('#msg'), short = a => a.slice(0, 6) + '…' + a.slice(-4), usd = v => v == null ? '···' : '$' + (v >= 1000 ? compact(v) : v.toFixed(v < 1 ? 4 : 2));
const amount = (bal, dec) => Number(BigInt(bal) * 1000000n / 10n ** BigInt(dec)) / 1e6;
// selling the whole holding into one constant-product pool holding the quoted liquidity, half a side, 0.3% fee
const exitOut = (qty, p) => { if (!p?.liq || !p.price) return null; const q = p.liq / 2, k = q / p.price, t = qty * 0.997; return q * t / (k + t); };
// a token still on its Pons curve: priced by the curve, sold into it (virtual reserves, the curve's fee off the ETH out,
// never more than the curve has raised), as the curve itself answers
const curveOut = (qty, c) => Math.max(0, Math.min(c.quoteUsd * qty / (c.tokens + qty), c.realUsd)) * (1 - c.fee);
let job = 0;

async function run(w) {
  const id = ++job; w = w.toLowerCase(); $('#a').value = w; $('#out').hidden = true; history.replaceState(null, '', '?w=' + w);
  msg.textContent = 'READING THE WALLET…';
  let v = null; try { v = await api('wallet?w=' + w); } catch (e) {}
  if (id !== job) return;
  if (!v?.ok) { msg.textContent = (v?.why || 'the explorer did not answer, try again in a minute').toUpperCase() + '.'; return; }
  msg.textContent = 'PRICING EVERY TOKEN…';
  let m = {}; try { m = await prices(v.tokens.map(t => t.token)); } catch (e) {}
  if (id !== job) return;
  const rows = v.tokens.map(t => { const p = m[t.token], qty = amount(t.balance, t.decimals), c = t.curve?.pool;
    if (c) return { ...t, qty, p: p || { price: c.quoteUsd / c.tokens, liq: c.realUsd }, mark: qty * c.quoteUsd / c.tokens, out: curveOut(qty, c) };
    return { ...t, qty, p, mark: p ? qty * p.price : null, out: p ? exitOut(qty, p) : null }; })
    .sort((a, b) => (b.mark || 0) - (a.mark || 0));
  const mark = rows.reduce((s, r) => s + (r.mark || 0), 0), out = rows.reduce((s, r) => s + (r.out || 0), 0), fakes = rows.filter(r => r.impostor).length;
  $('#out').hidden = false;
  $('#wx-mark').textContent = usd(mark); $('#wx-out').textContent = usd(out); $('#wx-out').className = 'v ' + (mark && out < mark * 0.8 ? 'short' : '');
  $('#wx-out2').textContent = mark ? `${Math.round((out / mark - 1) * 100)}% against the marked value` : 'through each pool’s depth';
  $('#wx-fake').textContent = fakes; $('#wx-fake').className = 'v ' + (fakes ? 'short' : '');
  $('#wx-n').textContent = rows.length; $('#wx-n2').textContent = `${rows.filter(r => r.p).length} with a pool or curve`;
  const list = $('#wx-list'); list.querySelectorAll('.r:not(.h)').forEach(n => n.remove());
  list.insertAdjacentHTML('beforeend', rows.map((r, i) => {
    const know = [r.impostor ? `<b class="short">COPY OF ${esc(r.symbol)}</b>` : '', r.verdict ? `<span class="vd ${r.verdict.verdict}">${r.verdict.verdict} ${r.verdict.score}</span>` : '', r.curve && !r.curve.bonded ? `on the Pons curve, ${r.curve.progress}%` : '', `<span class="wx-x" data-i="${i}">${r.powers ? (r.powers.length ? 'can ' + r.powers.slice(0, 2).join(', ') : 'no high-risk power') : ''}</span>`].filter(Boolean).join(' · ');
    return `<a class="r" href="/ticket/?a=${r.token}"><span class="sy">${esc(r.symbol || short(r.token))}<small>${short(r.token)}</small></span><span>${r.qty.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span><span>${usd(r.mark)}</span>
      <span class="${r.mark && r.out < r.mark * 0.8 ? 'short' : ''}">${r.p ? usd(r.out) + (r.mark ? `<small>${Math.round((r.out / r.mark - 1) * 100)}%</small>` : '') : 'no pool'}</span><span class="wx-k">${know}</span><span class="go">→</span></a>`;
  }).join('') || '<p class="note" style="margin:10px 0 0">No ERC-20 token with a balance in this wallet.</p>');
  msg.textContent = `${rows.length} TOKENS · MARKED ${usd(mark)} · ${usd(out)} IF SOLD NOW${fakes ? ` · ${fakes} COP${fakes > 1 ? 'IES' : 'Y'} OF REAL TOKENS` : ''}`;
  // Agent Scan on the largest holdings that have not been scanned yet
  for (const [i, r] of rows.entries()) {
    if (i >= 8 || r.powers || !r.p) continue;
    const x = await api('xray?a=' + r.token).catch(() => null); if (id !== job) return;
    const n = list.querySelector(`.wx-x[data-i="${i}"]`); if (n && x?.ok) { const hi = x.powers.filter(p => p.level === 'high').map(p => p.what); n.textContent = hi.length ? 'can ' + [...new Set(hi)].slice(0, 2).join(', ') : 'no high-risk power'; n.classList.toggle('short', !!hi.length); }
  }
}
$('#f').addEventListener('submit', e => { e.preventDefault(); const a = $('#a').value.trim(); if (!isAddr(a)) { msg.textContent = 'THAT IS NOT AN ADDRESS. IT SHOULD BE 0x FOLLOWED BY 40 HEX CHARACTERS.'; return; } run(a); });
const q = new URLSearchParams(location.search).get('w'); if (isAddr(q)) run(q);
