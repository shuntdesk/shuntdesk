// /sim/: Curve Simulator. The curve's reserves come from the server, read from the contract; every buy and sell is
// worked here the way the curve works it: a constant product, the fee off the ETH in and out, no more out than raised
import { createYard } from './yard.js';
import { mountChrome, $, feedYard } from './ui.js';
import { isToken as isAddr, normAddr } from './data.js';

mountChrome('');
feedYard(createYard($('#yard'), { ambient: true }));
const n0 = v => v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : Math.round(v).toLocaleString('en-US');
let U = 'ETH';   // the curve's currency: ETH on Pons, SOL on Pump.fun
const e4 = v => v.toFixed(v < 0.01 ? 5 : 4) + ' ' + U, usd = (v, c) => '$' + (v * c.ethUsd).toFixed(v * c.ethUsd < 10 ? 2 : 0), pc = v => (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%';

// one buy of E ETH, then others put in X ETH, then everything is sold back
function run(c, E, X = 0) {
  const f = c.fee, Q = c.quoteEth, T = c.tokens, inn = E * (1 - f), tok = T * inn / (Q + inn), Q1 = Q + inn, T1 = T - tok;
  const inX = X * (1 - f), Q2 = Q1 + inX, T2 = Q1 * T1 / Q2, real = c.realEth + inn + inX;
  const gross = Math.min(Q2 * tok / (T2 + tok), real), back = gross * (1 - f);
  return { tok, avg: E / tok, impact: (Q1 / T1) / (Q / T) - 1, after: Math.min(100, (c.realEth + inn) / c.need * 100), afterX: Math.min(100, real / c.need * 100), back, bonds: c.realEth + inn >= c.need };
}
// the least ETH others must put in after the buy for a straight sell to give it back; null when the curve bonds first
function breakEven(c, E) {
  const room = (c.need - c.realEth - E * (1 - c.fee)) / (1 - c.fee);
  if (run(c, E).back >= E) return 0;
  if (!(room > 0) || run(c, E, room).back < E) return null;
  let lo = 0, hi = room; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (run(c, E, m).back >= E) hi = m; else lo = m; }
  return hi;
}
let job = 0;
async function go(a, E) {
  const id = ++job; history.replaceState(null, '', `?a=${a}&e=${E}`); $('#sm-out').hidden = true; $('#sm-msg').textContent = 'READING THE CURVE…';
  let c = null; try { c = await (await fetch('/api/sim?a=' + a)).json(); } catch (e) {}
  if (id !== job) return;
  if (!c?.ok) { $('#sm-msg').textContent = String(c?.why || 'not answering right now').toUpperCase() + '.'; return; }
  U = c.unit || 'ETH'; const sol = U === 'SOL';
  const r = run(c, E);
  $('#sm-msg').textContent = `CURVE ${c.progress.toFixed(1)}% · ${c.raised.toFixed(3)} OF ${c.need} ${U} · FEE ${(c.fee * 100).toFixed(1)}% EACH WAY`;
  $('#sm-out').hidden = false;
  $('#sm-tok').textContent = n0(r.tok); $('#sm-tok-s').textContent = `average $${(r.avg * c.ethUsd).toPrecision(3)} a token, ${usd(E, c)} in`;
  $('#sm-imp').textContent = pc(r.impact); $('#sm-imp').className = 'v ' + (r.impact > 0.1 ? 'short' : '');
  $('#sm-cv').textContent = r.after.toFixed(1) + '%'; $('#sm-cv-s').textContent = r.bonds ? (sol ? 'this buy would graduate the curve' : 'this buy would reach the bond mark') : `${(c.need - c.realEth - E * (1 - c.fee)).toFixed(3)} ${U} left to ${sol ? 'graduate' : 'bond'}`;
  $('#sm-back').textContent = e4(r.back); $('#sm-back').className = 'v ' + (r.back < E * 0.9 ? 'short' : ''); const be = breakEven(c, E); $('#sm-back-s').textContent = `${usd(r.back, c)} · ${pc(r.back / E - 1)} on the round trip · ${be == null ? 'the curve bonds before it breaks even' : `breaks even when others put in ${e4(be)}`}`;
  const A = $('#sm-after'); A.querySelectorAll('.r:not(.h)').forEach(x => x.remove());
  A.insertAdjacentHTML('beforeend', (sol ? [0.5, 1, 2.5, 5, 10, 20] : [0.05, 0.1, 0.25, 0.5, 1, 2]).map(X => { const q = run(c, E, X); return `<div class="r"><span>${X} ${U}</span><span>${q.afterX.toFixed(1)}%</span><span class="${q.back >= E ? 'long' : 'short'}">${e4(q.back)}</span><span>${pc(q.back / E - 1)}</span></div>`; }).join(''));
  const S = $('#sm-sizes'); S.querySelectorAll('.r:not(.h)').forEach(x => x.remove());
  S.insertAdjacentHTML('beforeend', (sol ? [0.1, 0.5, 1, 2, 5, 10] : [0.01, 0.05, 0.1, 0.25, 0.5, 1]).map(e => { const q = run(c, e); return `<div class="r"><span>${e} ${U}</span><span>${n0(q.tok)}</span><span>${pc(q.impact)}</span><span>${e4(q.back)} · ${pc(q.back / e - 1)}</span></div>`; }).join(''));
  $('#sm-note').textContent = c.note;
}
$('#sm-form').addEventListener('submit', e => { e.preventDefault(); const a = normAddr($('#sm-a').value), E = Number($('#sm-e').value); if (!isAddr(a)) { $('#sm-msg').textContent = 'PASTE A PONS TOKEN (0x…) OR A PUMP.FUN MINT.'; return; } if (!(E > 0 && E < 100)) { $('#sm-msg').textContent = 'AN AMOUNT, MORE THAN 0.'; return; } go(a, E); });
const q = new URLSearchParams(location.search); if (isAddr(q.get('a') || '')) { $('#sm-a').value = q.get('a'); if (Number(q.get('e')) > 0) $('#sm-e').value = q.get('e'); go(normAddr(q.get('a')), Number($('#sm-e').value)); }
