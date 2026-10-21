// /guess/: Guess the Chart. A real chart from Replay, cut at a random point; the next hour, up or down. Kept in this browser
import { createYard } from './yard.js';
import { mountChrome, $, esc, feedYard } from './ui.js';
import { api } from './data.js';

mountChrome('');
feedYard(createYard($('#yard'), { ambient: true }));
const KEY = 'sd.guess', st = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || { streak: 0, best: 0, played: 0, right: 0 }; } catch (e) { return { streak: 0, best: 0, played: 0, right: 0 }; } })();
const keep = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} };
let pool = [], cur = null, cut = 0, shown = 0, done = false;

function stats() { $('#gs-streak').textContent = st.streak; $('#gs-best').textContent = st.best; $('#gs-played').textContent = st.played; $('#gs-rate').textContent = st.played ? Math.round(st.right / st.played * 100) + '% right' : ''; }
function draw() {
  const c = $('#gs-chart'), x = c.getContext('2d'), W = c.width, H = c.height; x.fillStyle = '#08090b'; x.fillRect(0, 0, W, H); if (!cur) return;
  const B = cur.bars.slice(Math.max(0, cut - 40), cut + 4), n = B.length, k = Math.min(n, cut - Math.max(0, cut - 40) + Math.round(shown));
  const lo = Math.min(...B.map(b => b[3])), hi = Math.max(...B.map(b => b[2])), lg = v => Math.log(Math.max(v, 1e-18)), y = v => 30 + (H - 70) * (1 - (lg(v) - lg(lo)) / Math.max(1e-9, lg(hi) - lg(lo)));
  const w = (W - 80) / n, cx = i => 40 + i * w + w / 2, edge = cut - Math.max(0, cut - 40);
  for (let i = 0; i < k; i++) { const [, o, h, l, cl] = B[i], up = cl >= o; x.strokeStyle = x.fillStyle = up ? '#2ed3a0' : '#ff6b6b'; if (i >= edge) x.globalAlpha = 0.95;
    x.beginPath(); x.moveTo(cx(i), y(h)); x.lineTo(cx(i), y(l)); x.stroke(); x.fillRect(cx(i) - w * 0.32, Math.min(y(o), y(cl)), w * 0.64, Math.max(1.5, Math.abs(y(o) - y(cl)))); x.globalAlpha = 1; }
  // the cut: what is hidden until the call
  x.strokeStyle = 'rgba(237,235,230,.5)'; x.setLineDash([5, 5]); x.beginPath(); x.moveTo(cx(edge) - w / 2, 14); x.lineTo(cx(edge) - w / 2, H - 30); x.stroke(); x.setLineDash([]);
  if (!done) { x.fillStyle = 'rgba(237,235,230,.06)'; x.fillRect(cx(edge) - w / 2, 14, W - (cx(edge) - w / 2) - 30, H - 44); x.fillStyle = '#8d8b86'; x.font = '700 15px "JetBrains Mono", monospace'; x.textAlign = 'center'; x.fillText('THE NEXT HOUR', (cx(edge) + W) / 2, H / 2); }
  x.fillStyle = '#6f6d68'; x.font = '12px "JetBrains Mono", monospace'; x.textAlign = 'left'; x.fillText(new Date(B[0][0]).toISOString().slice(5, 16).replace('T', ' ') + ' UTC', 40, H - 8);
  if (done && shown < 4) { shown += 0.08; requestAnimationFrame(draw); }
}
async function next() {
  done = false; shown = 0; $('#gs-next').hidden = true; $('#gs-pick').querySelectorAll('[data-g]').forEach(b => { b.disabled = false; b.className = ''; }); $('#gs-msg').textContent = '';
  for (let tries = 0; tries < 6; tries++) {
    const t = pool[Math.floor(Math.random() * pool.length)]; if (!t) break; $('#gs-title').textContent = 'Reading a chart…';
    let r = null; try { r = await (await fetch('/api/replay?a=' + t.token)).json(); } catch (e) {}
    const bars = (r?.bars || []).filter(b => b[1] > 0 && b[4] > 0); if (bars.length < 16) continue;
    cur = { token: t.token, symbol: r.symbol || t.symbol, bars }; cut = 8 + Math.floor(Math.random() * (bars.length - 12));
    $('#gs-title').textContent = `$${esc(cur.symbol || '?')} · a real chart`; $('#gs-state').textContent = new Date(bars[cut - 1][0]).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'; draw(); return;
  }
  $('#gs-title').textContent = 'No chart answered: try again in a minute'; $('#gs-next').hidden = false;
}
$('#gs-pick').addEventListener('click', e => {
  const b = e.target.closest('[data-g]'); if (!b || done || !cur) return;
  const before = cur.bars[cut - 1][4], after = cur.bars[Math.min(cur.bars.length - 1, cut + 3)][4], up = after >= before, right = (b.dataset.g === 'up') === up, m = after / before - 1;
  done = true; st.played++; if (right) { st.right++; st.streak++; st.best = Math.max(st.best, st.streak); } else st.streak = 0; keep(); stats();
  b.className = 'on' + (right ? '' : ' no'); $('#gs-pick').querySelectorAll('[data-g]').forEach(x => x.disabled = true);
  $('#gs-msg').innerHTML = `${right ? 'RIGHT' : 'WRONG'}: THE NEXT HOUR WENT ${m >= 0 ? '+' : ''}${(m * 100).toFixed(1)}%. <a class="acc" href="/replay/?a=${cur.token}">THE WHOLE CHART →</a>`;
  $('#gs-next').hidden = false; requestAnimationFrame(draw);
});
$('#gs-next').addEventListener('click', next);
(async () => { stats(); try { const p = await api('play'); pool = [...(p.launches || []), ...(p.trains || [])].filter((t, i, A) => A.findIndex(x => x.token === t.token) === i); } catch (e) {} next(); })();
