// The shared crew desk, the verdict record and the leaderboard, read from the backend.
import { api, sig } from './data.js';
import { $, flap, esc } from './ui.js';

const money = n => (n < 0 ? '-' : '') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = n => (n >= 0 ? '+' : '') + money(n);
const hhmm = t => new Date(t).toTimeString().slice(0, 5);
const ago = t => { const m = (Date.now() - t) / 60000; return m < 1 ? 'just now' : m < 60 ? Math.round(m) + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };

function drawCurve(cv, pts, start) {
  const ctx = cv.getContext('2d'), d = Math.min(devicePixelRatio || 1, 2), W = cv.clientWidth, H = cv.clientHeight;
  cv.width = W * d; cv.height = H * d; ctx.setTransform(d, 0, 0, d, 0, 0); ctx.clearRect(0, 0, W, H);
  if (pts.length < 2) { ctx.fillStyle = '#5f6268'; ctx.font = '12px "JetBrains Mono", monospace'; ctx.fillText('The curve starts once the desk has run for ten minutes.', 4, H / 2); return; }
  const lo = Math.min(start, ...pts.map(p => p[1])), hi = Math.max(start, ...pts.map(p => p[1])), pad = (hi - lo) * 0.15 || 50;
  const X = i => 4 + i * (W - 8) / (pts.length - 1), Y = v => H - 8 - (v - lo + pad) / (hi - lo + pad * 2) * (H - 16);
  ctx.setLineDash([4, 6]); ctx.strokeStyle = 'rgba(237,235,230,.25)'; ctx.beginPath(); ctx.moveTo(0, Y(start)); ctx.lineTo(W, Y(start)); ctx.stroke(); ctx.setLineDash([]);
  const up = pts[pts.length - 1][1] >= start, col = up ? '46,211,160' : '255,77,94';
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, `rgba(${col},.28)`); g.addColorStop(1, `rgba(${col},0)`);
  ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(X(i), Y(p[1])) : ctx.moveTo(X(i), Y(p[1]))); ctx.lineTo(X(pts.length - 1), H); ctx.lineTo(X(0), H); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
  ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(X(i), Y(p[1])) : ctx.moveTo(X(i), Y(p[1]))); ctx.strokeStyle = `rgb(${col})`; ctx.lineWidth = 2; ctx.shadowColor = `rgb(${col})`; ctx.shadowBlur = 12; ctx.stroke(); ctx.shadowBlur = 0;
}
const rate = o => o.n ? `${o.right} of ${o.n}` : 'none yet';

// the latest thing each crew member did, for pages that only show one line per role
export async function crewLines() {
  try { const d = await api('desk'), out = {}; for (const l of d.log) if (!out[l[1]]) out[l[1]] = l[2]; return { lines: out, equity: d.equity, open: d.pos.length }; } catch (e) { return null; }
}

export function mountCrew() {
  async function paint() {
    let d; try { d = await api('desk'); } catch (e) { $('#c-state').textContent = 'the crew desk is not answering'; return; }
    if (!d || d.error) { $('#c-state').textContent = 'the crew desk is not answering'; return; }
    $('#c-state').textContent = d.updated ? 'marked ' + ago(d.updated) : 'waiting for its first ticket';
    flap($('#c-eq'), money(d.equity), 300);
    const ret = (d.equity / d.start - 1) * 100; $('#c-ret').textContent = `${signed(ret)}% since it started with ${d.start.toLocaleString('en-US')}`;
    $('#c-ret').style.color = ret > 0 ? 'var(--long)' : ret < 0 ? 'var(--short)' : '';
    $('#c-sub').textContent = `${d.pos.length} open · ${d.hist.length} closed · ${money(d.cash)} free`;
    drawCurve($('#c-curve'), d.curve, d.start);
    api('brief').then(b => { if (b && b.text) { const n = $('#c-brief'); n.hidden = false; n.innerHTML = `${esc(b.text)}<small>the conductor · ${b.by === 'model' ? 'written by a language model from the desk’s own figures' : 'written from the desk’s own figures by fixed rules'}</small>`; } }).catch(() => {});
    $('#c-pos').innerHTML = d.pos.length ? '<tr><th>SIDE</th><th>TOKEN</th><th>LEV</th><th>ENTRY</th><th>MARK</th><th>P&amp;L</th></tr>' + d.pos.map(p => { const g = p.net; return `<tr><td><span class="tag ${p.side === 'long' ? 'CLEAN' : 'DANGER'}">${p.side.toUpperCase()}</span></td><td><a href="/ticket/?a=${p.addr}">${esc(p.sym)}</a></td><td>${p.lev.toFixed(1)}x</td><td>${sig(p.entry)}</td><td>${sig(p.mark || p.entry)}</td><td style="color:${g >= 0 ? 'var(--long)' : 'var(--short)'}">${signed(g)}</td></tr>`; }).join('')
      : '<tr><td class="empty">Nothing open. The crew trades the tickets visitors run: clean ones long, deep danger ones short.</td></tr>';
    // post-mortems the conductor wrote on closed trades come first, then the crew's own log
    const pm = d.hist.filter(h => h.note && h.note.text).slice(0, 3).map(h => `<p class="pm"><b>Post-mortem</b> ${esc(h.sym)} ${h.side} <span style="color:${h.pnl >= 0 ? 'var(--long)' : 'var(--short)'}">${signed(h.pnl)}</span><br>${esc(h.note.text)}<small>${h.note.by === 'model' ? 'the conductor, a language model, after the trade closed' : 'written by fixed rules after the trade closed'}</small></p>`).join('');
    $('#c-log').innerHTML = pm + (d.log.length ? d.log.slice(0, 14).map(l => `<p>${hhmm(l[0])} <b>${esc(l[1])}</b> ${esc(l[2])}</p>`).join('') : '<p>No ticket has reached the crew yet. Run one on the Ticket page.</p>');
    const r = d.record;
    $('#c-rec').innerHTML = `<div><span>Tickets on file</span><b>${r.count.CLEAN + r.count.RISKY + r.count.DANGER}</b></div>
      <div><span>Clean, higher an hour later</span><b>${rate(r.after1h.CLEAN)}</b></div><div><span>Clean, higher a day later</span><b>${rate(r.after24h.CLEAN)}</b></div>
      <div><span>Danger, lower an hour later</span><b>${rate(r.after1h.DANGER)}</b></div><div><span>Danger, lower a day later</span><b>${rate(r.after24h.DANGER)}</b></div>`;
  }
  paint(); setInterval(paint, 20000);
  return paint;
}

// leaderboard: handles post their own paper equity, so it is self-reported
export function mountBoard(mine) {
  const box = $('#lb'), form = $('#lb-form'), inp = $('#lb-in'), msg = $('#lb-msg');
  let handle = ''; try { handle = localStorage.getItem('sd.handle') || ''; } catch (e) {}
  inp.value = handle;
  const left = t => { const h = Math.max(0, (t - Date.now()) / 3600000); return h >= 48 ? Math.floor(h / 24) + ' days' : h >= 1 ? Math.floor(h) + ' hours' : Math.max(1, Math.round(h * 60)) + ' minutes'; };
  const day = t => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  let last = null;
  const paint = r => {
    last = r; const rows = r.rows || [];
    box.innerHTML = '<tr><th>#</th><th>DESK</th><th>THIS WEEK</th><th>EQUITY</th><th>TRADES</th><th>WON</th><th>RESETS</th><th>SEEN</th></tr>' + rows.slice(0, 12).map((x, i) => `<tr${x.handle === handle ? ' style="color:var(--acc)"' : ''}><td>${i + 1}</td><td>${x.crew ? '<span class="tag ok">CREW</span>' : esc(x.handle)}</td><td style="color:${x.pnl > 0 ? 'var(--long)' : x.pnl < 0 ? 'var(--short)' : ''}">${signed(x.pnl ?? 0)}</td><td>${money(x.equity)}</td><td>${x.trades}</td><td>${x.wins}</td><td>${x.busts || 0}</td><td class="mut">${x.t ? ago(x.t) : '—'}</td></tr>`).join('');
    const s = $('#lb-season'); if (s && r.season) s.textContent = `SEASON OF ${day(r.season).toUpperCase()} · ENDS IN ${left(r.ends).toUpperCase()} · RANKED BY WHAT EACH DESK MADE THIS WEEK`;
    const p = $('#lb-past'); if (p) p.innerHTML = (r.past || []).filter(x => x.handle).slice(0, 4).map(x => `<span class="chip">${day(x.id)}<b>${esc(x.handle)} ${signed(x.pnl)}</b></span>`).join('') || '<span class="note" style="margin:0">The first season is running. Its winner shows here when the week ends.</span>';
    const c = $('#lb-card'); if (c) c.hidden = !handle || !rows.some(x => x.handle === handle);
  };
  async function sync(post) {
    try {
      const m = mine(), r = await api('board', post && handle ? { handle, equity: m.equity, pnl: m.pnl, season: m.season, trades: m.trades, wins: m.wins, busts: m.busts } : undefined);
      if (r.rows) paint(r); if (r.why) msg.textContent = r.why.toUpperCase();
    } catch (e) { msg.textContent = 'THE BOARD IS NOT ANSWERING'; }
  }
  // a picture of this desk's week, to save or share
  const cardBtn = $('#lb-card');
  if (cardBtn) cardBtn.onclick = async () => {
    if (!last) return;
    const rows = last.rows || [], i = rows.findIndex(x => x.handle === handle); if (i < 0) return;
    const me = rows[i], W = 1200, H = 675, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d');
    await document.fonts.load('900 40px "Big Shoulders Display"'); await document.fonts.load('400 20px "JetBrains Mono"');
    const g = c.createRadialGradient(W / 2, H * 0.4, 0, W / 2, H * 0.4, W * 0.7); g.addColorStop(0, '#17191c'); g.addColorStop(1, '#060708'); c.fillStyle = g; c.fillRect(0, 0, W, H);
    for (let k = -8; k <= 8; k++) { const on = k === 0 || k === 1; c.strokeStyle = on ? 'rgba(237,235,230,.2)' : 'rgba(237,235,230,.05)'; c.lineWidth = on ? 2 : 1; c.beginPath(); c.moveTo(W / 2, H * 0.34); c.lineTo(W / 2 + (k - 0.5) * 170, H + 30); c.stroke(); }
    c.strokeStyle = 'rgba(237,235,230,.2)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(42, 22); c.lineTo(W - 22, 22); c.lineTo(W - 22, H - 42); c.lineTo(W - 42, H - 22); c.lineTo(22, H - 22); c.lineTo(22, 42); c.closePath(); c.stroke();
    c.fillStyle = '#edebe6'; 
    c.font = '900 38px "Big Shoulders Display"'; c.fillText('SHUNTDESK', 90, 86);
    c.font = '400 18px "JetBrains Mono"'; c.fillStyle = '#8b8e94'; c.textAlign = 'right'; c.fillText(`BOARD OF DESKS · SEASON OF ${day(last.season).toUpperCase()}`, W - 56, 82); c.textAlign = 'left';
    c.font = '400 20px "JetBrains Mono"'; c.fillText(`#${i + 1} OF ${rows.length}`, 56, 200);
    c.font = '900 150px "Big Shoulders Display"'; c.fillStyle = '#edebe6'; c.fillText(handle.toUpperCase(), 50, 340);
    c.font = '900 96px "Big Shoulders Display"'; c.fillStyle = me.pnl > 0 ? '#2ed3a0' : me.pnl < 0 ? '#ff4d5e' : '#8b8e94'; c.fillText(`${signed(me.pnl)} THIS WEEK`, 54, 460);
    c.font = '400 20px "JetBrains Mono"'; c.fillStyle = '#8b8e94'; c.fillText(`${me.trades} TRADES · ${me.wins} WON · ${me.busts || 0} RESETS · PAPER USDG, SELF-REPORTED`, 56, 540);
    c.textAlign = 'right'; c.fillText('SHUNTDESK.COM/DESK', W - 56, 620); c.textAlign = 'left';
    cv.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `shuntdesk-season-${handle}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }, 'image/png');
  };
  form.addEventListener('submit', e => {
    e.preventDefault(); handle = inp.value.trim().toLowerCase();
    if (!/^[a-z0-9_]{2,16}$/.test(handle)) { msg.textContent = 'A HANDLE IS 2 TO 16 LETTERS, DIGITS OR _'; return; }
    try { localStorage.setItem('sd.handle', handle); } catch (x) {}
    msg.textContent = 'ON THE BOARD AS ' + handle.toUpperCase() + ' · SELF-REPORTED'; sync(true);
  });
  sync(!!handle); setInterval(() => sync(!!handle), 60000);
}
