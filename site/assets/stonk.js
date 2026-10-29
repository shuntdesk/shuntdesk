// /stonk/: Stonk Watch, StonkFun launches on Solana: near graduating, hot, the live tape, just graduated
import { createYard } from './yard.js';
import { mountChrome, $, $$, esc, feedYard } from './ui.js';
import { api } from './data.js';
mountChrome('Stonk');
feedYard(createYard($('#yard'), { ambient: true }));
const usd = v => v == null ? '—' : '$' + (v >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : Math.round(v));
const ago = iso => { if (!iso) return ''; const m = (Date.now() - Date.parse(iso)) / 60000; return m < 60 ? Math.max(1, Math.round(m)) + 'm' : m < 1440 ? (m / 60).toFixed(m < 600 ? 1 : 0) + 'h' : Math.round(m / 1440) + 'd'; };
const CAP = { near: 'Closest to graduating', hot: 'Most traded, 24 hours', tape: 'Live tape: the newest launches', graduated: 'Just graduated' };
let kind = 'near', timer = null, seen = new Set();
// a row's progress: the curve where there is one, else StonkFun's market-cap measure, labelled as such
const prog = r => r.status === 'graduated' ? '<span class="long">GRADUATED</span>' : r.curve ? `<span class="sk-bar"><i style="width:${Math.min(100, r.curve.progress).toFixed(1)}%"></i></span>${r.curve.progress.toFixed(1)}% <small>curve</small>` : r.sfProgress != null ? `<span class="sk-bar mc"><i style="width:${Math.min(100, r.sfProgress)}%"></i></span>${r.sfProgress}% <small>of $40K mc</small>` : '—';
async function load() {
  let v = null; try { v = await api('stonk/' + kind); } catch (e) {}
  if (!v?.ok) { $('#sk-list').innerHTML = '<p class="note">STONKFUN DID NOT ANSWER: TRYING AGAIN.</p>'; return; }
  $('#sk-list').innerHTML = `<div class="r h"><span>TOKEN</span><span>PAIRED WITH</span><span>MARKET CAP</span><span>24H VOLUME</span><span>PROGRESS</span><span>AGE</span></div>` + v.rows.map(r => { const fresh = kind === 'tape' && seen.size && !seen.has(r.mint); seen.add(r.mint);
    return `<a class="r${fresh ? ' tp-new' : ''}" href="/ticket/?a=${r.mint}"><span class="sy">${r.image ? `<img src="${esc(r.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}${esc(r.symbol || '?')}<small>${esc((r.name || '').slice(0, 22))}</small></span><span>${esc(r.quote || '—')}</span><span>${usd(r.marketCap)}</span><span>${usd(r.volume24h)}</span><span class="sk-p">${prog(r)}</span><span>${ago(r.created)}</span></a>`; }).join('') || '<p class="note">NOTHING HERE RIGHT NOW.</p>';
}
function pick(k) { kind = k; seen = new Set(); $('#sk-cap').textContent = CAP[k]; $$('#sk-f button').forEach(b => b.classList.toggle('on', b.dataset.k === k)); $('#sk-list').innerHTML = '<p class="note">READING…</p>'; load(); clearInterval(timer); timer = setInterval(() => { if (!document.hidden) load(); }, k === 'tape' ? 15000 : 60000); }
$$('#sk-f button').forEach(b => b.addEventListener('click', () => pick(b.dataset.k)));
(async () => { try { const s = await api('stonk/stats'); if (s?.ok) { $('#sk-t').textContent = s.tokens.total.toLocaleString('en-US'); $('#sk-g').textContent = s.tokens.graduated.toLocaleString('en-US'); $('#sk-g-s').textContent = (s.tokens.graduated / s.tokens.total * 100).toFixed(1) + '% of all launches'; $('#sk-a').textContent = s.tokens.aboutToGraduate; $('#sk-v').textContent = usd(s.tokens.totalVolume24hUsd); } } catch (e) {} })();
pick(new URLSearchParams(location.search).get('k') || 'near');
