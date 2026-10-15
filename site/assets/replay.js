// Rug replay: one token's life on a chart, with launch, graduation, the call Shuntdesk made, the peak and the fall
// marked where they happened. Everything comes from /api/replay, which reads the chain log and Codex.
import { createYard } from './yard.js';
import { mountChrome, $, esc, feedYard } from './ui.js';
import { api, isAddr, sig, ageShort } from './data.js';

mountChrome('');
feedYard(createYard($('#yard'), { ambient: true }));
const msg = $('#msg'), LC = window.LightweightCharts, TZ = -new Date().getTimezoneOffset() * 60;
const short = a => a.slice(0, 6) + '…' + a.slice(-4), pct = v => (v >= 0 ? '+' : '') + (v * 100).toFixed(v > -0.99 ? 1 : v > -0.9999 ? 2 : 3) + '%';
const when = t => new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
const gap = ms => { const h = Math.abs(ms) / 3600000; return h < 1 ? Math.round(h * 60) + ' min' : h < 48 ? h.toFixed(1) + ' h' : Math.round(h / 24) + ' days'; };
let chart = null, series = null, job = 0;

function draw(r) {
  const el = $('#chart'); el.innerHTML = '';
  chart = LC.createChart(el, { height: 440, layout: { background: { color: 'transparent' }, textColor: '#9a9da3', fontFamily: 'JetBrains Mono' }, grid: { vertLines: { color: 'rgba(237,235,230,.05)' }, horzLines: { color: 'rgba(237,235,230,.05)' } },
    rightPriceScale: { borderColor: 'rgba(237,235,230,.15)', mode: 2 }, timeScale: { borderColor: 'rgba(237,235,230,.15)', timeVisible: true }, handleScroll: { vertTouchDrag: false } });
  series = chart.addCandlestickSeries({ upColor: '#2ed3a0', downColor: '#ff4d5e', borderVisible: false, wickUpColor: '#2ed3a0', wickDownColor: '#ff4d5e', priceFormat: { type: 'custom', formatter: p => '$' + sig(p), minMove: 1e-12 } });
  const data = r.bars.map(b => ({ time: Math.floor(b[0] / 1000) + TZ, open: b[1], high: b[2], low: b[3], close: b[4] }));
  series.setData(data);
  // markers snap to the bar that holds the moment
  const at = t => { const s = Math.floor(t / 1000) + TZ; let best = data[0]; for (const d of data) if (d.time <= s) best = d; return best ? best.time : s; };
  const m = [];
  if (r.launch) m.push({ time: at(r.launch.t), position: 'belowBar', color: '#edebe6', shape: 'arrowUp', text: 'LAUNCH' });
  for (const v of r.verdicts) m.push({ time: at(v.t), position: 'aboveBar', color: v.verdict === 'CLEAN' ? '#2ed3a0' : v.verdict === 'DANGER' ? '#ff4d5e' : '#c9c7c2', shape: 'circle', text: `${v.verdict} ${v.score}` });
  if (r.graduated) m.push({ time: at(r.graduated.t), position: 'belowBar', color: '#2ed3a0', shape: 'square', text: 'GRADUATED' });
  if (r.peak) m.push({ time: at(r.peak.t), position: 'aboveBar', color: '#edebe6', shape: 'arrowDown', text: 'PEAK' });
  if (r.drop) m.push({ time: at(r.drop.t), position: 'aboveBar', color: '#ff4d5e', shape: 'arrowDown', text: pct(r.drop.d) });
  series.setMarkers(m.filter(x => x.time).sort((a, b) => a.time - b.time));
  chart.timeScale().fitContent();
}

function story(r) {
  const ev = [];
  if (r.launch) ev.push([r.launch.t, 'Launch', `Launched on Pons by <a class="acc" href="/deployer/?a=${r.launch.by}">${short(r.launch.by)}</a>.`]);
  if (r.launchFacts) { const L = r.launchFacts, f = v => v == null ? '—' : Number(v).toFixed(1) + '%'; ev.push([r.launch?.t || r.bars[0]?.[0], 'At launch', `Snipers held ${f(L.sniperPct)}, bundles ${f(L.bundlerPct)}, insiders ${f(L.insiderPct)}, the developer ${f(L.devPct)}.`]); }
  for (const v of r.verdicts) ev.push([v.t, 'Our call', `Shuntdesk filed <b>${v.verdict} ${v.score}</b>${v.claimed && v.claimed !== v.verdict ? ` (the browser said ${v.claimed}; the server held it back)` : ''}, ${v.desk === 'depot' ? 'no trade' : 'sent to the ' + v.desk + ' desk'}. Stops: ${esc(v.stops.join(' · ')) || '—'}.`]);
  if (r.graduated) ev.push([r.graduated.t, 'Graduated', 'Completed the Pons curve; liquidity moved to a pool.']);
  if (r.peak) ev.push([r.peak.t, 'Peak', `Highest price on the record: $${sig(r.peak.price)}.`]);
  if (r.drop) ev.push([r.drop.t, 'Steepest bar', `One bar took the price from $${sig(r.drop.from)} to $${sig(r.drop.to)}, ${pct(r.drop.d)}.`]);
  if (r.fall) ev.push([r.fall.t, 'Lowest after the peak', `$${sig(r.fall.price)}, ${pct(r.fall.fromPeak)} from the peak.`]);
  if (r.now) ev.push([r.now.t, 'Now', `$${sig(r.now.price)}, ${pct(r.now.fromPeak)} from the peak.`]);
  $('#r-tl').innerHTML = ev.filter(e => e[0]).sort((a, b) => a[0] - b[0]).map(e => `<li><time>${when(e[0])}</time><b>${e[1]}</b><span>${e[2]}</span></li>`).join('');
}

function stats(r) {
  $('#r-sym').textContent = r.symbol || short(r.token);
  $('#r-age').textContent = r.launch ? `launched ${ageShort(r.launch.t)} ago` : `${r.bars.length} bars on the record`;
  $('#r-fall').textContent = r.now?.fromPeak != null ? pct(r.now.fromPeak) : '—';
  $('#r-fall').style.color = r.now?.fromPeak <= -0.5 ? 'var(--short)' : '';
  $('#r-fallat').textContent = r.peak ? `peak $${sig(r.peak.price)}` : '';
  $('#r-drop').textContent = r.drop ? pct(r.drop.d) : 'none';
  $('#r-dropat').textContent = r.drop ? when(r.drop.t) : 'no bar fell over 20%';
  // the honest question: was there a call before the fall, and what did it say
  const v = r.verdicts[0], fallT = r.drop?.t || r.fall?.t;
  $('#r-call').textContent = v ? `${v.verdict} ${v.score}` : 'none';
  $('#r-call').style.color = v ? (v.verdict === 'DANGER' ? 'var(--short)' : v.verdict === 'CLEAN' ? 'var(--long)' : '') : '';
  $('#r-callat').textContent = !v ? 'no verdict on file' : !fallT ? 'filed ' + when(v.t) : v.t < fallT ? `${gap(fallT - v.t)} before the steepest fall` : `${gap(v.t - fallT)} after the steepest fall`;
  $('#r-res').textContent = `${r.res === '5' ? '5-minute' : r.res === '15' ? '15-minute' : r.res === '60' ? 'hourly' : '4-hour'} candles · Codex`;
  $('#r-run').href = '/ticket/?a=' + r.token; $('#r-dep').href = '/deployer/?t=' + r.token;
}

async function go(a) {
  const id = ++job; a = a.toLowerCase(); history.replaceState(null, '', '?a=' + a); $('#a').value = a;
  msg.textContent = 'READING THE LOG AND THE PRICE HISTORY…';
  let r = null; try { r = await api('replay?a=' + a); } catch (e) {}
  if (id !== job) return;
  if (!r || !r.ok) { msg.textContent = (r?.why || 'the replay did not answer').toUpperCase() + '.'; return; }
  $('#out').hidden = false; stats(r); story(r); draw(r);
  msg.textContent = `${r.bars.length} BARS · ${r.verdicts.length} CALL${r.verdicts.length === 1 ? '' : 'S'} ON FILE · ${r.launch ? 'PONS LAUNCH' : 'NOT A PONS V2 LAUNCH'}`;
}
$('#f').addEventListener('submit', e => { e.preventDefault(); const a = $('#a').value.trim(); if (isAddr(a)) go(a); else msg.textContent = 'THAT IS NOT A TOKEN ADDRESS.'; });
$('#rugs').addEventListener('click', e => { const c = e.target.closest('.chip'); if (c) go(c.dataset.a); });
api('rugs').then(j => { $('#rugs').innerHTML = (j.rows || []).slice(0, 6).map(x => `<span class="chip" data-a="${x.token}">${esc(x.symbol)}<b>${pct(x.fall)} after ${x.after}</b></span>`).join(''); }).catch(() => {});
const q = new URLSearchParams(location.search).get('a'); if (isAddr(q)) go(q);
addEventListener('resize', () => chart && chart.applyOptions({ width: $('#chart').clientWidth }));
