// /rail/: Launch Rail, every live StonkFun launch as a train in the 3D yard, as far down the line as its curve has
// filled (read from its LaunchLab pool). Graduated ones take the long track; the ones that stalled wait in the depot.
import { createYard, STOPS } from './yard.js';
import { mountChrome, $, $$, flap, esc } from './ui.js';
import { api } from './data.js';
mountChrome('Rail');
const yard = createYard($('#yard'), { pose: { pos: [-158, 90, 92], tgt: [10, -72, 350], fog: [120, 1300], tall: { pos: [-300, 230, 40], tgt: [0, -90, 360], fog: [200, 1600] } } });
const dep = $('#dep'), usd = v => v == null ? '—' : '$' + (v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : Math.round(v));
const age = iso => { const m = (Date.now() - Date.parse(iso)) / 60000; return m < 60 ? Math.max(1, Math.round(m)) + 'm' : m < 1440 ? (m / 60).toFixed(m < 600 ? 1 : 0) + 'h' : Math.round(m / 1440) + 'd'; };
let rows = [], hover = null;
// how far down the line: the curve where there is one, else StonkFun's market-cap measure
const pct = r => r.status === 'graduated' ? 100 : r.curve ? r.curve.progress : r.sfProgress ?? 0;
const stopOf = p => Math.max(0, Math.min(STOPS.length - 1, Math.floor(p / 100 * STOPS.length)));
const stalled = r => r.status !== 'graduated' && Date.now() - Date.parse(r.created) > 6 * 3600000 && pct(r) < 5;
function sync() {
  yard.setTracked(rows.map(r => { const sym = String(r.symbol || '?').toUpperCase().slice(0, 8), sel = hover === r.mint;
    if (r.status === 'graduated') return { id: r.mint, sym, state: 'done', to: 'long', sel };
    if (stalled(r)) return { id: r.mint, sym, state: 'done', to: 'depot', sel };
    return { id: r.mint, sym, state: 'run', stop: stopOf(pct(r)), sel }; }));
}
function render() {
  $$('.r:not(.h)', dep).forEach(n => n.remove());
  dep.insertAdjacentHTML('beforeend', rows.map(r => { const p = pct(r), st = r.status === 'graduated' ? '<b class="long">GRADUATED</b>' : stalled(r) ? '<b class="mut">STALLED</b>' : `<b>${p >= 85 ? 'AT THE GATE' : p >= 50 ? 'PAST HALFWAY' : p >= 15 ? 'ON THE CURVE' : 'LEAVING THE STATION'}</b>`;
    return `<a class="r" data-a="${r.mint}" href="/ape/?m=${r.mint}"><span>${age(r.created)}</span><span class="sy">${esc(r.symbol || '?')}<small>${esc((r.name || '').slice(0, 22))}</small></span><span>${usd(r.marketCap)}</span><span>${esc(r.quote || '—')}</span><span class="sk-p"><span class="sk-bar${r.curve ? '' : ' mc'}"><i style="width:${Math.min(100, p).toFixed(1)}%"></i></span>${p.toFixed(1)}%</span><span>${st}</span><span class="go">→</span></a>`; }).join(''));
  const live = rows.filter(r => r.status !== 'graduated'), top = live.slice().sort((a, b) => pct(b) - pct(a))[0];
  flap($('#s-n'), String(rows.length), 300); flap($('#s-g'), String(rows.length - live.length), 300);
  $('#s-top').textContent = top ? '$' + top.symbol : '—'; $('#s-top-s').textContent = top ? pct(top).toFixed(1) + '% down the line' : '';
  $('#s-t').textContent = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  sync();
}
async function load() {
  try {
    const [near, tape, grad] = await Promise.all(['near', 'tape', 'graduated'].map(k => api('stonk/' + k).catch(() => null)));
    const seen = new Set(), all = [...(near?.rows || []), ...(tape?.rows || []).slice(0, 14), ...(grad?.rows || []).slice(0, 5)].filter(r => !seen.has(r.mint) && seen.add(r.mint));
    rows = all.slice(0, 24); $('#s-src').textContent = 'StonkFun · near, newest and just graduated'; render();
  } catch (e) { $('#s-src').textContent = 'StonkFun did not answer: trying again'; }
}
dep.addEventListener('pointerover', e => { const r = e.target.closest('.r[data-a]'); const a = r ? r.dataset.a : null; if (a !== hover) { hover = a; sync(); } });
dep.addEventListener('pointerleave', () => { hover = null; sync(); });
load(); setInterval(() => { if (!document.hidden) load(); }, 30000);
