import { createYard, STOPS } from './yard.js';
import { mountChrome, $, $$, flap, esc } from './ui.js';
import { scan, cachedScan, newPools, trending, graduates, compact, ageShort } from './data.js';

mountChrome('Board');
// here the yard is the board itself: seen from above the start of the line, every train placed by its real scan
const yard = createYard($('#yard'), { pose: { pos: [-158, 90, 92], tgt: [10, -72, 350], fog: [120, 1300], tall: { pos: [-300, 230, 40], tgt: [0, -90, 360], fog: [200, 1600] } } });

const dep = $('#dep'), state = new Map();   // addr -> { marks: [status…], running: index | -1, res }
let rows = [], tab = new URLSearchParams(location.search).get('t') === 'grad' ? 'grad' : 'new', job = 0, hover = null;
const dots = st => STOPS.map((_, i) => `<i class="${st.marks[i] || (st.running === i ? 'run' : '')}"></i>`).join('<u></u>');
const label = st => st.res ? (st.res.verdict === 'NO POOL' ? 'NO POOL' : 'ARRIVED') : st.running >= 0 ? 'AT ' + STOPS[st.running].toUpperCase() : 'WAITING';

// push the real state of every row into the 3D scene, and count it up for the tally
function sync() {
  const n = { wait: 0, run: 0, long: 0, depot: 0, short: 0 };
  yard.setTracked(rows.map(r => {
    const st = state.get(r.addr), sym = r.sym.toUpperCase().slice(0, 8), sel = hover === r.addr;
    if (st.res) {
      if (st.res.verdict === 'NO POOL') return { id: r.addr, sym, state: 'dead', stop: 0, sel };
      n[st.res.platform]++; return { id: r.addr, sym, state: 'done', to: st.res.platform, sel };
    }
    if (st.running >= 0) { n.run++; return { id: r.addr, sym, state: 'run', stop: st.running, sel }; }
    n.wait++; return { id: r.addr, sym, state: 'wait', sel };
  }));
  $('#tally').innerHTML = [['WAITING', n.wait, ''], ['ON THE LINE', n.run, 'acc'], ['LONG DESK', n.long, 'long'], ['DEPOT', n.depot, 'mut'], ['SHORT DESK', n.short, 'short']].map(t => `<div><b class="${t[2]}">${t[1]}</b><span>${t[0]}</span></div>`).join('');
}
function paintRow(addr) {
  const n = dep.querySelector(`[data-a="${addr}"]`), st = state.get(addr); if (!n || !st) return;
  $('.dots', n).innerHTML = dots(st);
  flap($('em', n), label(st), 300);
  const v = $('.vd', n);
  if (st.res && st.res.verdict !== 'NO POOL') { v.className = 'vd tag ' + st.res.verdict; flap(v, `${st.res.verdict} ${st.res.score}`, 420); }
  sync();
}
function fromRes(res) { return { marks: res.steps.map(s => s.status), running: -1, res }; }
function render() {
  $$('.r:not(.h)', dep).forEach(n => n.remove());
  dep.insertAdjacentHTML('beforeend', rows.map(r => `<a class="r" data-a="${r.addr}" href="/ticket/?a=${r.addr}">
    <span>${ageShort(r.created)}</span><span class="sy">${esc(r.sym)}<small>${esc((r.name || '').slice(0, 22))}</small></span><span>${r.liq ? "$" + compact(r.liq) : "···"}</span><span>${r.tx24.toLocaleString('en-US')}</span>
    <span class="prog"><span class="dots"></span><em>WAITING</em></span><span><span class="vd tag"></span></span><span class="go">→</span></a>`).join(''));
  // every row needs its state before any row is painted, because painting syncs the whole yard
  rows.forEach(r => { if (!state.has(r.addr)) { const c = cachedScan(r.addr); state.set(r.addr, c ? fromRes(c) : { marks: [], running: -1, res: null }); } });
  rows.forEach(r => paintRow(r.addr));
  stats();
}
function stats() {
  const done = rows.map(r => state.get(r.addr)?.res).filter(r => r && r.verdict !== 'NO POOL');
  const c = done.filter(r => r.verdict === 'CLEAN').length, k = done.filter(r => r.verdict === 'RISKY').length, d = done.filter(r => r.verdict === 'DANGER').length;
  flap($('#s-n'), String(rows.length), 300); flap($('#s-done'), String(done.length), 300); flap($('#s-v'), `${c} · ${k} · ${d}`, 300);
  $('#b-c').style.flex = c; $('#b-r').style.flex = k; $('#b-d').style.flex = d;
}
// run the line on rows that have no saved result, one after another
async function runLine(limit) {
  const id = ++job, todo = rows.filter(r => !state.get(r.addr)?.res).slice(0, limit);
  for (const r of todo) {
    if (id !== job) return;
    const st = state.get(r.addr); st.marks = []; st.running = 0; paintRow(r.addr);
    $('#b-msg').textContent = `CHECKING ${r.sym.toUpperCase()} · ${todo.indexOf(r) + 1} OF ${todo.length}`;
    try {
      const res = await scan(r.addr, (s, i) => { st.marks[i] = s.status; st.running = i < 6 ? i + 1 : -1; paintRow(r.addr); });
      st.res = res; st.running = -1;
    } catch (e) { st.running = -1; }
    paintRow(r.addr); stats();
  }
  if (id === job) $('#b-msg').textContent = todo.length ? 'THE LINE IS CLEAR' : '';
}
async function load() {
  job++; $('#b-msg').textContent = 'LOADING THE FEED…';
  try {
    if (tab === 'new') { const f = await newPools(); rows = f.rows; $('#s-src').textContent = (f.source === 'DexScreener' ? 'recently listed tokens · ' : 'newest pools · ') + f.source; }
    else if (tab === 'grad') { rows = await graduates(); $('#s-src').textContent = 'graduated from Pons · read from the factory log'; if (!rows.length) { $('#b-msg').textContent = 'NO GRADUATION IN THE LAST DAY YET.'; } }
    else { rows = await trending(); $('#s-src').textContent = 'trending pools · GeckoTerminal'; }
    const seen = new Set(); rows = rows.filter(r => !seen.has(r.addr) && seen.add(r.addr)).slice(0, 20);
    render(); runLine(5);
  } catch (e) { console.error(e); $('#b-msg').textContent = 'THE FEED DID NOT ANSWER. TRY AGAIN IN A MINUTE.'; }
}
$$('.tabs button').forEach(b => b.onclick = () => { tab = b.dataset.t; $$('.tabs button').forEach(x => x.classList.toggle('on', x === b)); load(); });
$('#b-all').onclick = () => runLine(20);
// pointing at a row lights its train in the yard
dep.addEventListener('pointerover', e => { const r = e.target.closest('.r[data-a]'); const a = r ? r.dataset.a : null; if (a !== hover) { hover = a; sync(); } });
dep.addEventListener('pointerleave', () => { hover = null; sync(); });
$$('.tabs button').forEach(x => x.classList.toggle('on', x.dataset.t === tab));
load();
