import { createYard } from './yard.js';
import { mountChrome, $, $$, flap, esc, feedYard } from './ui.js';
import { pairFor, prices, candles, cachedScan, recentScans, trending, zoneFor, isAddr, compact, sig, api } from './data.js';
import { FEE, MAX_IMPACT, impact, fill, value, liqPrice } from './trade.js';
import { MAJORS, STOCKS, isMajor, klines, majorsFeed } from './markets.js';
import { refreshLive } from './live.js';
import { mountCrew, mountBoard } from './crew.js';

mountChrome('Desk');
feedYard(createYard($('#yard'), { ambient: true }));

// ---------- your paper account lives in this browser ----------
const START = 10000, BUST = 100;
const fresh = (busts = 0) => ({ cash: START, pos: [], hist: [], seq: 1, busts });
let acct; try { acct = Object.assign(fresh(), JSON.parse(localStorage.getItem('sd.desk'))); } catch (e) { acct = fresh(); }
const save = () => { try { localStorage.setItem('sd.desk', JSON.stringify({ cash: acct.cash, pos: acct.pos, hist: acct.hist, seq: acct.seq, busts: acct.busts, season: acct.season, s0: acct.s0 })); } catch (e) {} };
// weekly seasons on the board: Monday 00:00 UTC. s0 is what the desk was worth when this browser first saw the week.
const seasonId = (t = Date.now()) => { const d = new Date(t), back = (d.getUTCDay() + 6) % 7; return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back); };
const seasonPnl = () => equity() - (acct.s0 ?? START);
function seasonCheck() { const s = seasonId(); if (acct.season !== s) { acct.season = s; acct.s0 = equity(); save(); } }
// a reset starts the desk over at 10,000 but carries the week's result, so starting over never wipes a loss
function restart(busts) { const carry = acct.season === seasonId() ? seasonPnl() : 0; acct = fresh(busts); acct.season = seasonId(); acct.s0 = START - carry; save(); }
// The desk can be open in more than one tab. Each tab used to keep its own copy and write it back, so one tab's
// reset or trade was overwritten by the other's older copy. Now a tab adopts whatever another tab has just saved.
addEventListener('storage', e => {
  if (e.key !== 'sd.desk') return;
  try { acct = Object.assign(fresh(), JSON.parse(e.newValue)); } catch (x) { acct = fresh(); }
  paint(); drawLines();
});
const money = n => (n < 0 ? '-' : '') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = n => (n >= 0 ? '+' : '') + money(n);

// marks and depths are keyed by instrument: a token address, or a Binance symbol for a major
let marks = {}, liqs = {}, trail = {}, cur = null, side = 'long', tab = 'majors', colUsd = 500, maxLev = 5;
const pairs = {}, live = {}, openDet = new Set();   // pool details per token, the last on-chain price per token, positions showing their detail
// the project's own token, always on the desk under its own tab and first on the chain list
const OWN = { addr: '0x7e517e779b85895894becad80c9bb69b4cb1c4d6', sym: 'SHUNT', name: 'Shuntdesk', kind: 'chain', liq: 0, price: 0, chg: null };
const lists = {
  own: [OWN],
  majors: MAJORS.map(m => ({ ...m, kind: 'major', liq: m.depth, price: 0, chg: null })),
  stocks: STOCKS.map(s => ({ ...s, kind: 'stock', liq: 0, price: 0, chg: null })),
  chain: []
};
for (const m of MAJORS) liqs[m.addr] = m.depth;
// what a position would return if closed now: live price, exit impact, fees and borrow cost included
const val = p => value(p, marks[p.addr] || p.entry, liqs[p.addr] || p.liq0, Date.now());
const equity = () => acct.cash + acct.pos.reduce((s, p) => s + val(p).back, 0);
// the order as the form stands
function quote() {
  const lev = Math.min(maxLev, Math.max(1, Math.round(Number($('#o-levn').value) || 1))), col = Math.max(0, Math.floor(Math.min(colUsd, acct.cash / (1 + FEE * lev))));
  const size = col * lev, k = cur ? impact(size, cur.liq) : 0;
  return { lev, col, size, k, px: cur && cur.price ? fill(cur.price, size, cur.liq, side === 'long') : 0, fee: size * FEE };
}
// before changing anything, take the latest saved desk, in case another tab changed it a moment ago
function sync() { try { const s = JSON.parse(localStorage.getItem('sd.desk')); if (s) acct = Object.assign(fresh(), s); } catch (e) {} }
function openPos() {
  sync(); const q = quote(); if (!cur || !cur.price || q.col <= 0 || q.k > MAX_IMPACT || q.col + q.fee > acct.cash) return false;
  const pct = id => { const v = Number($(id).value); return v > 0 ? v / 100 : 0; };
  acct.cash -= q.col + q.fee;
  acct.pos.push({ id: acct.seq++, addr: cur.addr, sym: cur.sym, kind: cur.kind, side, lev: q.lev, col: q.col, size: q.size, entry: q.px, q0: cur.price, fee0: q.fee, liq0: cur.liq, t: Date.now(), sl: Math.min(pct('#o-sl'), 0.89), tp: pct('#o-tp') });
  marks[cur.addr] = cur.price; liqs[cur.addr] = cur.liq; save(); paint(true); drawLines();
  $('#o-msg').textContent = `FILLED ${side.toUpperCase()} ${cur.sym} AT ${sig(q.px)} · FEE ${money(q.fee)} · PAPER ONLY`;
  return true;
}
function closePos(id, why) {
  sync(); const i = acct.pos.findIndex(p => p.id === id); if (i < 0) { paint(); return; }
  const p = acct.pos[i], v = val(p);
  acct.pos.splice(i, 1); acct.cash += v.back;
  acct.hist.unshift({ sym: p.sym, side: p.side, lev: p.lev, entry: p.entry, exit: v.exit, pnl: v.net, fees: (p.fee0 || 0) + v.closeFee + v.borrow, why, t: Date.now() }); acct.hist = acct.hist.slice(0, 30);
  save(); paint(true); drawLines();
}
// the desk's own rules, applied every time a price arrives
function guard() {
  for (const p of [...acct.pos]) {
    const v = val(p);
    if (v.health <= 0.1) closePos(p.id, 'liquidated');
    else if (p.sl && v.net <= -p.sl * p.col) closePos(p.id, 'stop loss');
    else if (p.tp && v.net >= p.tp * p.col) closePos(p.id, 'take profit');
  }
  // a desk worth under 100 is finished: it starts again at 10,000 and the reset is counted
  if (equity() < BUST) { sync(); if (equity() >= BUST) return; const was = equity(); restart((acct.busts || 0) + 1); drawLines(); $('#o-msg').textContent = `YOUR DESK FELL TO ${money(was)} USDG AND WAS RESET TO 10,000. RESET NUMBER ${acct.busts}.`; }
}

// everything about one position, as it stands at the current mark
function detail(p, v) {
  const mark = marks[p.addr] || p.entry, size = p.size ?? p.col * p.lev, lp = liqPrice(p.entry, p.lev, p.side), dir = p.side === 'long' ? 1 : -1, held = (Date.now() - p.t) / 60000;
  const pc = n => (n >= 0 ? '+' : '') + n.toFixed(2) + '%', col = n => `style="color:${n >= 0 ? 'var(--long)' : 'var(--short)'}"`;
  const rows = [
    ['Opened', new Date(p.t).toTimeString().slice(0, 8) + ' · held ' + (held < 60 ? Math.round(held) + ' min' : (held / 60).toFixed(1) + ' h')],
    ['Price when ordered', p.q0 ? sig(p.q0) : '—'], ['Filled at', sig(p.entry) + (p.q0 ? ' (' + (Math.abs(p.entry / p.q0 - 1) * 100).toFixed(2) + '% slippage)' : '')],
    ['Mark now', sig(mark) + ' (' + pc((mark / p.entry - 1) * 100) + ' from fill)'], ['Would close at', sig(v.exit) + ' after exit slippage'],
    ['Position size', money(size) + ' USDG'], ['Collateral', money(p.col) + ' USDG'], ['Borrowed', money(size - p.col) + ' USDG at ' + p.lev + 'x'],
    ['Price move, before costs', `<b ${col(v.gross)}>${signed(v.gross)}</b>`], ['Fee paid to open', '-' + money(p.fee0 || 0)], ['Fee to close', '-' + money(v.closeFee)], ['Borrow cost so far', '-' + money(v.borrow)],
    ['Net P&L if closed now', `<b ${col(v.net)}>${signed(v.net)}</b>`], ['Return on collateral', `<b ${col(v.net)}>${pc(v.net / p.col * 100)}</b>`], ['You would get back', money(v.back) + ' of ' + money(p.col)],
    ['Health', Math.max(0, v.health).toFixed(2) + ' · liquidated at 0.10'], ['Liquidation price', sig(lp) + ' · ' + Math.abs((lp / mark - 1) * 100).toFixed(2) + '% away'],
    ['Stop loss', p.sl ? 'at -' + (p.sl * 100).toFixed(0) + '% of collateral, near ' + sig(p.entry * (1 - dir * p.sl / p.lev)) : 'off'], ['Take profit', p.tp ? 'at +' + (p.tp * 100).toFixed(0) + '% of collateral, near ' + sig(p.entry * (1 + dir * p.tp / p.lev)) : 'off'],
    ['Price source', isMajor(p.addr) ? 'Binance, every trade' : live[p.addr] ? 'last swap on chain, ' + Math.max(0, Math.round((Date.now() - live[p.addr].at) / 1000)) + 's ago' : 'DexScreener, every 10 seconds']
  ];
  return `<tr class="det"><td colspan="10"><div class="detg">${rows.map(r => `<div><span>${r[0]}</span><b>${r[1]}</b></div>`).join('')}</div></td></tr>`;
}

// ---------- painting ----------
// numbers that change many times a second are written straight in; the split-flap is kept for single events
const put = (sel, text, animate) => { const n = $(sel); if (animate) flap(n, text, 260); else { n._flapTo = text; n.textContent = text; } };
function paint(animate = false) {
  const float = acct.pos.reduce((s, p) => s + val(p).net, 0), eq = equity(), closed = acct.hist.reduce((s, h) => s + h.pnl, 0);
  put('#a-eq', money(eq), animate); put('#a-cash', money(acct.cash), animate); put('#a-open', signed(float), animate); put('#a-closed', signed(closed), animate);
  $('#a-open').style.color = float > 0 ? 'var(--long)' : float < 0 ? 'var(--short)' : ''; $('#a-closed').style.color = closed > 0 ? 'var(--long)' : closed < 0 ? 'var(--short)' : '';
  $('#a-ret').textContent = `${signed((eq / START - 1) * 100)}% since the start` + (acct.busts ? ` · reset ${acct.busts} time${acct.busts > 1 ? 's' : ''}` : '');
  $('#a-npos').textContent = acct.pos.length ? `${acct.pos.length} open, after fees` : 'no open positions';
  $('#a-ntr').textContent = acct.hist.length ? `${acct.hist.length} closed, ${acct.hist.filter(h => h.pnl > 0).length} won` : 'no closed trades';
  $('#t-pos').innerHTML = acct.pos.length ? '<tr><th>SIDE</th><th>MARKET</th><th>LEV</th><th>SIZE</th><th>ENTRY</th><th>MARK</th><th>LIQ. AT</th><th>HEALTH</th><th>P&amp;L</th><th></th></tr>' + acct.pos.map(p => {
    const v = val(p), h = Math.max(0, v.health);
    return `<tr><td><span class="tag ${p.side === 'long' ? 'CLEAN' : 'DANGER'}">${p.side.toUpperCase()}</span></td><td>${esc(p.sym)}</td><td>${p.lev.toFixed(1)}x</td><td>${money(p.size ?? p.col * p.lev)}</td><td>${sig(p.entry)}</td><td>${sig(marks[p.addr] || p.entry)}</td><td>${sig(liqPrice(p.entry, p.lev, p.side))}</td><td style="color:${h < 0.4 ? 'var(--short)' : h < 0.7 ? 'var(--warn)' : ''}">${h.toFixed(2)}</td><td style="color:${v.net >= 0 ? 'var(--long)' : 'var(--short)'}">${signed(v.net)}</td><td class="acts2"><button class="x" data-d="${p.id}">${openDet.has(p.id) ? 'HIDE' : 'DETAILS'}</button><button class="x" data-x="${p.id}">CLOSE</button></td></tr>` + (openDet.has(p.id) ? detail(p, v) : '');
  }).join('') : '<tr><td class="empty">Nothing open. Pick a market above.</td></tr>';
  $('#t-hist').innerHTML = acct.hist.length ? '<tr><th>SIDE</th><th>MARKET</th><th>LEV</th><th>ENTRY</th><th>EXIT</th><th>FEES</th><th>WHY</th><th>P&amp;L</th></tr>' + acct.hist.slice(0, 8).map(h => `<tr><td>${h.side.toUpperCase()}</td><td>${esc(h.sym)}</td><td>${h.lev.toFixed(1)}x</td><td>${sig(h.entry)}</td><td>${sig(h.exit)}</td><td class="mut">${money(h.fees || 0)}</td><td class="mut">${esc(h.why)}</td><td style="color:${h.pnl >= 0 ? 'var(--long)' : 'var(--short)'}">${signed(h.pnl)}</td></tr>`).join('') : '<tr><td class="empty">No closed trades yet.</td></tr>';
  paintForm(); paintList();
}
function paintForm() {
  const q = quote(), major = cur && cur.kind === 'major', where = major ? 'MARKET' : 'POOL';
  // the typed boxes and the sliders show the same two numbers; a box being typed in is left alone
  $('#o-bal').textContent = money(acct.cash);
  // free cash is not the whole desk: what is locked in positions, and the total the reset rule looks at
  const eq = equity(), why = $('#o-why');
  $('#o-lock').textContent = money(eq - acct.cash) + (acct.pos.length ? ` in ${acct.pos.length}` : ''); $('#o-eq').textContent = money(eq);
  // out of free balance with money still in positions: say so, and offer the two ways out right here
  const stuck = acct.cash < 100 && acct.pos.length > 0; $('#o-rescue').hidden = !stuck;
  if (stuck) { why.textContent = `NO FREE BALANCE LEFT: ${money(eq - acct.cash)} USDG IS IN ${acct.pos.length} OPEN POSITION${acct.pos.length > 1 ? 'S' : ''}.`; $('#o-closeall').textContent = `Close all ${acct.pos.length}, get back ~${money(eq - acct.cash).replace(/\.\d+$/, '')}`; }
  if (document.activeElement !== $('#o-coln')) $('#o-coln').value = q.col;
  if (document.activeElement !== $('#o-levn')) $('#o-levn').value = q.lev;
  $('#o-col').value = acct.cash > 0 ? Math.min(100, q.col / acct.cash * 100) : 0; $('#o-lev').value = q.lev;
  $('#k-size').textContent = money(q.size) + ' USDG'; $('#k-bor').textContent = money(q.size - q.col) + ' USDG';
  $('#k-fill').textContent = cur && cur.price ? `${sig(q.px)} (${(q.k * 100).toFixed(2)}% impact)` : '—';
  $('#k-fee').textContent = money(q.fee) + ' in, ' + money(q.fee) + ' out';
  $('#k-liq').textContent = cur && cur.price ? sig(liqPrice(q.px, q.lev, side)) : '—';
  $('#o-long').className = side === 'long' ? 'on l' : ''; $('#o-short').className = side === 'short' ? 'on s' : '';
  const thin = cur && !major && side === 'short' && cur.liq < 20000, big = q.k > MAX_IMPACT, go = $('#o-go');
  // health the position would have the moment it opens: at high leverage, slippage and fees alone can liquidate it
  const h0 = cur && cur.price && q.col > 0 ? value({ side, lev: q.lev, col: q.col, size: q.size, entry: q.px, t: Date.now() }, cur.price, cur.liq).health : 1, dead = !big && h0 <= 0.3;
  go.className = 'btn ' + (side === 'long' ? 'g' : 'r'); go.disabled = !cur || !cur.price || q.col <= 0 || thin || big || dead;
  go.textContent = !cur ? 'Pick a market first' : !cur.price ? 'Waiting for a price' : thin ? 'Too thin to short' : big ? 'Too large for this ' + where.toLowerCase() : dead ? 'Would be liquidated on entry' : `Open ${side} ${q.lev.toFixed(1)}x on ${cur.sym}`;
  $('#k-h0').textContent = cur && cur.price && q.col > 0 ? Math.max(0, h0).toFixed(2) : '—'; $('#k-h0').style.color = h0 < 0.5 ? 'var(--short)' : h0 < 0.8 ? 'var(--warn)' : '';
  // the size ceiling at this leverage: the 8% rule, and staying alive after the order's own slippage and fees
  $('#k-max').textContent = cur && cur.liq ? money(Math.max(0, Math.min(maxSize(), Math.floor((0.55 / q.lev - FEE) * cur.liq / 4)))).replace('.00', '') + ' USDG' : '—';
  $('#o-ask').disabled = !cur || !cur.price || q.col <= 0;
  // say why an order is refused, with the market's own numbers, and offer to resize it
  $('#o-fit').hidden = !(big || dead);
  const msg = $('#o-msg');
  if (big) msg.textContent = `THIS ${where} HOLDS $${compact(cur.liq).toUpperCase()}. AN ORDER MAY MOVE ITS PRICE 8% AT MOST, SO THE LARGEST IT TAKES IS ${money(maxSize()).replace('.00', '')} USDG. YOURS IS ${money(q.size).replace('.00', '')}.`;
  else if (dead) msg.textContent = `AT ${q.lev.toFixed(0)}X THIS POSITION IS LIQUIDATED BY A ${(Math.abs(liqPrice(q.px, q.lev, side) / q.px - 1) * 100).toFixed(2)}% MOVE, AND SLIPPAGE PLUS FEES ALREADY COST THAT MUCH. LOWER THE SIZE OR THE LEVERAGE.`;
  else if (thin) msg.textContent = 'SHORTING NEEDS A POOL OF AT LEAST $20K. THIS ONE HOLDS $' + compact(cur.liq).toUpperCase() + '.';
  else if (/^(THIS (POOL|MARKET)|SHORTING|AT \d)/.test(msg.textContent)) msg.textContent = IDLE();
}
const IDLE = () => cur && cur.kind === 'major' ? 'SIMULATED AT THE LIVE BINANCE PRICE. NO ORDER IS SENT ANYWHERE.' : 'SIMULATED AT THE LIVE POOL PRICE. NO ORDER IS SENT ANYWHERE.';
// the largest order this market takes, and a resize that keeps the position alive after its own slippage
const maxSize = () => cur ? Math.floor(MAX_IMPACT * cur.liq / 2 * 0.98) : 0;
function fit() {
  const lev = quote().lev, alive = Math.floor((0.55 / lev - FEE) * cur.liq / 4), col = Math.floor(Math.min(maxSize(), alive) / lev);
  if (col >= 1) colUsd = col;
  else { colUsd = 10; $('#o-levn').value = Math.max(1, Math.min(maxLev, Math.floor(maxSize() / 10))); }   // too thin for this leverage at any size: lower the leverage
  $('#o-coln').blur(); $('#o-levn').blur(); paintForm();
}

// ---------- the markets strip ----------
const fmtChg = c => c == null ? '' : (c >= 0 ? '+' : '') + c.toFixed(2) + '%';
function buildList() {
  const box = $('#mk-list'), paste = tab === 'paste';
  $('#mk-paste').hidden = !paste; box.hidden = paste;
  $('#mk-note').textContent = { majors: 'BINANCE · EVERY TRADE · NO KEY', stocks: 'STOCK TOKENS THAT TRADE ON ROBINHOOD CHAIN · OPEN ALL DAY', chain: 'BUSIEST ON ROBINHOOD CHAIN RIGHT NOW', own: 'THE SHUNTDESK TOKEN · PAPER ONLY, LIKE EVERYTHING HERE', paste: 'ANY TOKEN ON ROBINHOOD CHAIN' }[tab];
  if (paste) return;
  const rows = lists[tab];
  box.innerHTML = rows.length ? rows.map(r => `<button class="mt" data-a="${r.addr}"><b>${esc(r.sym.slice(0, 9))}</b><em></em><small>${esc(r.name || '')}</small><span></span></button>`).join('') : '<div class="empty">Loading this market…</div>';
  paintList();
}
function paintList() {
  if (tab === 'paste') return;
  for (const n of $$('#mk-list .mt')) {
    const r = lists[tab].find(x => x.addr === n.dataset.a); if (!r) continue;
    n.classList.toggle('on', !!cur && cur.addr === r.addr);
    const px = marks[r.addr] || r.price, em = n.children[1];
    n.children[3].textContent = px ? '$' + sig(px) : '···'; em.textContent = fmtChg(r.chg); em.className = r.chg == null ? '' : r.chg >= 0 ? 'up' : 'dn';
  }
}
async function loadList(which) {
  try {
    if (which === 'stocks') { const m = await prices(STOCKS.map(s => s.addr)); for (const s of lists.stocks) { const p = m[s.addr]; if (p) { s.price = p.price; s.liq = p.liq; s.chg = p.chg; marks[s.addr] = p.price; liqs[s.addr] = p.liq; } } }
    if (which === 'own' || which === 'chain') {   // its price comes from its own pool (DexScreener, or GeckoTerminal while DexScreener has not listed it)
      const p = await pairFor(OWN.addr).catch(() => null);
      if (p) { OWN.price = p.price; OWN.liq = p.liq; OWN.chg = p.chg ?? null; marks[OWN.addr] = marks[OWN.addr] || p.price; liqs[OWN.addr] = p.liq; }
    }
    if (which === 'chain') {
      const skip = new Set([...STOCKS.map(s => s.addr), OWN.addr]), seen = new Set();
      const rows = (await trending()).filter(r => r.price && r.liq > 20000 && !skip.has(r.addr) && !seen.has(r.addr) && seen.add(r.addr)).slice(0, 14).map(r => ({ ...r, kind: 'chain' }));
      if (rows.length) { lists.chain = [OWN, ...rows]; for (const r of rows) { marks[r.addr] = marks[r.addr] || r.price; liqs[r.addr] = r.liq; } if (tab === 'chain') buildList(); }
    }
  } catch (e) {}
  paintList();
}
function setTab(t) {
  tab = t; $$('#mk-tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
  buildList(); if (t === 'stocks' || t === 'chain' || t === 'own') loadList(t);
}

// ---------- chart: TradingView Lightweight Charts ----------
const LC = window.LightweightCharts, TZ = -new Date().getTimezoneOffset() * 60;
let chartApi = null, series = null, plines = [], bars = [], barRes = 60;
function initChart() {
  if (!LC) { $('#p-note').textContent = 'the chart library did not load'; return; }
  chartApi = LC.createChart($('#chart'), { autoSize: true, layout: { background: { color: 'transparent' }, textColor: '#9a9da3', fontFamily: '"JetBrains Mono", monospace', fontSize: 11 },
    grid: { vertLines: { color: 'rgba(237,235,230,.045)' }, horzLines: { color: 'rgba(237,235,230,.045)' } }, rightPriceScale: { borderVisible: false },
    // A finger scrolling the page often lands on the chart. Dragging the price axis or panning vertically switched
    // auto-scaling off and left every later token off screen, so the price scale is not draggable and vertical
    // touches go to the page. Sideways drag and pinch still move through time.
    handleScroll: { vertTouchDrag: false, horzTouchDrag: true, pressedMouseMove: true, mouseWheel: false },
    handleScale: { axisPressedMouseMove: { time: true, price: false }, axisDoubleClickReset: true, mouseWheel: false, pinch: true },
    timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 4 },
    crosshair: { mode: 0, vertLine: { color: 'rgba(237,235,230,.4)', labelBackgroundColor: '#1c1e22' }, horzLine: { color: 'rgba(237,235,230,.4)', labelBackgroundColor: '#1c1e22' } } });
  series = chartApi.addCandlestickSeries({ upColor: '#2ed3a0', downColor: '#ff4d5e', wickUpColor: '#2ed3a0', wickDownColor: '#ff4d5e', borderVisible: false, priceLineColor: '#edebe6' });
}
const digits = px => px >= 1000 ? 2 : px >= 1 ? 4 : Math.min(12, Math.max(4, Math.ceil(-Math.log10(px)) + 4));
function setBars(rows, resSec) {
  if (!series) return;
  barRes = resSec; const seen = new Set();
  bars = rows.filter(r => r.c > 0).map(r => ({ time: Math.floor(r.t / 1000 / resSec) * resSec + TZ, open: r.o, high: r.h, low: r.l, close: r.c })).sort((a, b) => a.time - b.time).filter(b => !seen.has(b.time) && seen.add(b.time));
  const p = digits(cur.price || rows[rows.length - 1]?.c || 1);
  series.applyOptions({ priceFormat: { type: 'price', precision: p, minMove: 1 / 10 ** p } });
  chartApi.priceScale('right').applyOptions({ autoScale: true });   // every new market starts fitted to its own prices
  series.setData(bars); chartApi.timeScale().fitContent(); drawLines();
}
// fold a live price into the last candle, or start the next one
function tickBar(px) {
  if (!series || !px) return;
  const t = Math.floor(Date.now() / 1000 / barRes) * barRes + TZ, last = bars[bars.length - 1];
  let b;
  if (last && last.time === t) { last.high = Math.max(last.high, px); last.low = Math.min(last.low, px); last.close = px; b = last; }
  else if (!last || t > last.time) { const o = last ? last.close : px; b = { time: t, open: o, high: Math.max(o, px), low: Math.min(o, px), close: px }; bars.push(b); if (bars.length > 900) bars.shift(); }
  else return;
  series.update(b);
}
// entry, liquidation, stop and target of every position on the market in view
function drawLines() {
  if (!series) return;
  plines.forEach(l => series.removePriceLine(l)); plines = [];
  if (!cur) return;
  const add = (price, color, style, title) => plines.push(series.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title }));
  for (const p of acct.pos.filter(p => p.addr === cur.addr)) {
    const dir = p.side === 'long' ? 1 : -1;
    add(p.entry, '#edebe6', LC.LineStyle.Dashed, `${p.side} ${p.lev}x`); add(liqPrice(p.entry, p.lev, p.side), '#ff4d5e', LC.LineStyle.Solid, 'liquidation');
    if (p.sl) add(p.entry * (1 - dir * p.sl / p.lev), '#ff4d5e', LC.LineStyle.Dotted, 'stop'); if (p.tp) add(p.entry * (1 + dir * p.tp / p.lev), '#2ed3a0', LC.LineStyle.Dotted, 'target');
  }
}
async function loadChart(inst) {
  $('#p-note').textContent = 'loading the chart…';
  if (inst.kind === 'major') {
    const rows = await klines(inst.addr); if (cur !== inst) return;
    setBars(rows, 60); $('#p-note').textContent = rows.length ? `1-minute candles · Binance · live on every trade` : 'Binance did not answer · a live line builds here as prices arrive';
    return;
  }
  const got = await candles(inst); if (cur !== inst) return;
  let rows = got.rows, res = /^1-/.test(got.label) ? 60 : 300, label = `last ${rows.length} · ${got.label} · live from on-chain swaps`;
  if (rows.length < 3) {   // nobody has candles for a pool this young: draw the prices this page has seen itself
    rows = (trail[inst.addr] || []).map(p => ({ t: p.t, o: p.c, h: p.c, l: p.c, c: p.c })); res = 10;
    label = 'this pool is too new for candles · a live line builds here as prices arrive';
  }
  setBars(rows, res); $('#p-note').textContent = label;
}

// ---------- choosing a market ----------
async function select(inst) {
  if (inst.kind === 'major') inst = { ...inst, liq: inst.depth, price: marks[inst.addr] || 0 };
  else {
    $('#o-msg').textContent = 'LOADING THE POOL…';
    const pair = await pairFor(inst.addr);
    if (!pair || !pair.price) { $('#o-msg').textContent = 'NO POOL WITH A PRICE FOUND FOR THAT ADDRESS.'; return; }
    inst = { ...pair, sym: inst.sym || pair.sym, name: inst.name || pair.name, kind: inst.kind || 'chain' };
  }
  cur = inst; marks[inst.addr] = inst.price || marks[inst.addr]; liqs[inst.addr] = inst.liq; if (inst.kind !== 'major') pairs[inst.addr] = inst;
  $('#p-src').textContent = inst.kind === 'major' ? 'every trade' : 'reading the chain…';
  const major = inst.kind === 'major', z = major ? { zone: 1, max: 100 } : zoneFor(inst.liq), sc = major ? null : cachedScan(inst.addr);
  feed.focus(major ? inst.addr : null);
  flap($('#p-sym'), (major ? `${inst.sym} / USDT` : `${inst.sym} / USD`).toUpperCase().slice(0, 16)); $('#p-px').textContent = inst.price ? '$' + sig(inst.price) : '';
  $('#p-chg').textContent = major ? 'Binance spot' : `liquidity $${compact(inst.liq)}` + (inst.kind === 'stock' ? ' · stock token' : '');
  $('#p-zone').textContent = major ? 'MAJOR · MAX 100X' : `ZONE ${z.zone} · MAX ${z.max}X`;
  $('#p-ver').innerHTML = major ? '<span class="live">live</span>' : sc ? `<span class="tag ${sc.verdict}">${sc.verdict} ${sc.score}</span>` : `<a class="acc" href="/ticket/?a=${inst.addr}">not checked yet · run the line →</a>`;
  $('#o-what').textContent = major ? 'Binance price' : 'pool price';
  maxLev = z.max; $('#o-lev').max = z.max; $('#o-levn').max = z.max; $('#o-levn').value = Math.min(quote().lev, z.max);
  $('#q-lev').innerHTML = [1, 2, 5, 10, 25, 50, 100].filter(x => x <= z.max).map(x => `<button type="button" data-x="${x}">${x}x</button>`).join('');
  $('#o-msg').textContent = IDLE(); $('#o-ai').hidden = true; if (!major) $('#o-addr').value = inst.addr;
  history.replaceState(null, '', major ? '?m=' + inst.addr : '?a=' + inst.addr);
  paintForm(); paintList(); loadChart(inst);
}

// ---------- prices ----------
// majors: every trade, straight from the stream
let dirty = false;
const feed = majorsFeed((sym, px, open24) => {
  marks[sym] = px; const m = lists.majors.find(x => x.addr === sym); if (m) { m.price = px; if (open24) m.chg = (px / open24 - 1) * 100; }
  if (cur && cur.addr === sym) { cur.price = px; $('#p-px').textContent = '$' + sig(px); tickBar(px); }
  dirty = true;
}, s => { if (tab === 'majors') $('#mk-note').textContent = s === 'live' ? 'BINANCE · EVERY TRADE · NO KEY' : 'BINANCE STREAM RECONNECTING…'; });
// liquidations and stops are checked four times a second; the tables repaint twice a second
setInterval(() => { if (!dirty) return; dirty = false; guard(); }, 250);
setInterval(() => { paint(); $('#a-mark').textContent = 'marked ' + new Date().toTimeString().slice(0, 8); }, 500);
// chain tokens and stock tokens: every 10 seconds
let polls = 0;
async function poll() {
  const addrs = [...new Set([...acct.pos.map(p => p.addr), ...(cur ? [cur.addr] : [])])].filter(a => !isMajor(a));
  if (addrs.length) {
    try {
      const m = await prices(addrs);
      for (const a in m) if (m[a].price) { pairs[a] = m[a]; liqs[a] = m[a].liq; if (!live[a]) { marks[a] = m[a].price; note(a, m[a].price); } }
      if (cur && m[cur.addr]) { cur.liq = m[cur.addr].liq; if (!live[cur.addr]) { cur.price = m[cur.addr].price; $('#p-px').textContent = '$' + sig(cur.price); tickBar(cur.price); } }
    } catch (e) {}
  }
  if (tab === 'stocks' || (tab === 'chain' && polls % 6 === 0)) loadList(tab);
  polls++; guard();
}
const note = (a, px) => { (trail[a] = trail[a] || []).push({ t: Date.now(), c: px }); if (trail[a].length > 240) trail[a].shift(); };
// chain and stock tokens: the last swap on chain, every 3 seconds. ETH-quoted pools follow the live ETH price in between.
let busy = false;
async function fast() {
  if (busy || document.hidden) return; busy = true;
  try {
    const want = [...new Set([...acct.pos.map(p => p.addr), ...(cur ? [cur.addr] : [])])].filter(a => !isMajor(a) && pairs[a]);
    const got = await refreshLive(want.map(a => pairs[a]), marks.ETHUSDT);
    for (const a in got) { live[a] = got[a]; marks[a] = got[a].price; note(a, got[a].price); if (cur && cur.addr === a) { cur.price = got[a].price; $('#p-px').textContent = '$' + sig(cur.price); tickBar(cur.price); $('#p-src').textContent = 'last swap on chain ' + Math.max(0, Math.round((Date.now() - got[a].at) / 1000)) + 's ago'; } }
    if (want.length) dirty = true;
  } finally { busy = false; }
}
// the conductor explains the order as it stands, before it is opened
let typing = 0;
async function askTrade() {
  const q = quote(), box = $('#o-ai'), id = ++typing, sc = cur.kind === 'major' ? null : cachedScan(cur.addr);
  box.hidden = false; box.textContent = 'The conductor is reading the order…';
  let r; try { r = await api('trade', { sym: cur.sym, side, lev: q.lev, col: q.col, price: cur.price, liq: cur.liq, liqPrice: liqPrice(q.px, q.lev, side), verdict: sc ? `${sc.verdict} ${sc.score}` : cur.kind === 'major' ? 'not a chain token, no verdict applies' : '' }); } catch (e) { r = null; }
  if (id !== typing) return;
  if (!r || !r.text) { box.textContent = 'The conductor is not answering right now.'; return; }
  for (let i = 1; i <= r.text.length && id === typing; i++) { box.textContent = r.text.slice(0, i); if (i % 3 === 0) await new Promise(x => setTimeout(x, 12)); }
  box.insertAdjacentHTML('beforeend', `<small>${r.by === 'model' ? 'written by a language model from the numbers above' : 'written from the numbers above by fixed rules'}</small>`);
}

// ---------- wiring ----------
$('#o-long').onclick = () => { side = 'long'; paintForm(); };
$('#o-short').onclick = () => { side = 'short'; paintForm(); };
// collateral and leverage: slider, typed box and quick buttons all set the same two numbers
$('#o-col').oninput = e => { colUsd = Math.floor(acct.cash * e.target.value / 100); $('#o-coln').blur(); paintForm(); };
$('#o-coln').oninput = e => { colUsd = Math.max(0, Number(e.target.value) || 0); paintForm(); };
$('#o-coln').onblur = paintForm;
// clicking into a box selects what is there, so typing replaces it instead of adding to it
for (const n of [$('#o-coln'), $('#o-levn')]) n.addEventListener('focus', () => setTimeout(() => n.select(), 0));
$('#o-lev').oninput = e => { $('#o-levn').value = e.target.value; $('#o-levn').blur(); paintForm(); };
$('#o-levn').oninput = paintForm; $('#o-levn').onblur = paintForm;
$('#q-col').onclick = e => { const b = e.target.closest('[data-p]'); if (!b) return; colUsd = Math.floor(acct.cash * b.dataset.p / 100); $('#o-coln').blur(); paintForm(); };
$('#q-lev').onclick = e => { const b = e.target.closest('[data-x]'); if (!b) return; $('#o-levn').value = b.dataset.x; $('#o-levn').blur(); paintForm(); };
$('#o-load').onclick = () => { const a = $('#o-addr').value.trim(); if (isAddr(a)) select({ kind: 'chain', addr: a.toLowerCase() }); else $('#o-msg').textContent = 'THAT IS NOT A TOKEN ADDRESS.'; };
$('#o-addr').onfocus = e => e.target.select();   // a paste replaces the address already there
$('#o-go').onclick = openPos; $('#o-ask').onclick = askTrade; $('#o-fit').onclick = fit;
// the tables repaint under the pointer, so these act on press rather than on a completed click
$('#t-pos').addEventListener('pointerdown', e => {
  const d = e.target.closest('[data-d]'); if (d) { const id = Number(d.dataset.d); openDet.has(id) ? openDet.delete(id) : openDet.add(id); paint(); return; }
  const b = e.target.closest('[data-x]'); if (b) closePos(Number(b.dataset.x), 'closed by you');
});
$('#mk-list').addEventListener('pointerdown', e => { const b = e.target.closest('.mt'); if (!b) return; const r = lists[tab].find(x => x.addr === b.dataset.a); if (r) select(r); });
$$('#mk-tabs button').forEach(b => b.onclick = () => setTab(b.dataset.t));
$('#reset').onclick = () => { if (confirm('Reset your paper desk to 10,000 USDG and clear its history? It counts as a reset on the board.')) { restart((acct.busts || 0) + (acct.hist.length || acct.pos.length ? 1 : 0)); paint(true); drawLines(); } };
// the two ways out when the free balance is gone
$('#o-closeall').onclick = () => { for (const p of [...acct.pos]) closePos(p.id, 'closed by you'); $('#o-msg').textContent = 'ALL POSITIONS CLOSED. THEIR COLLATERAL IS FREE AGAIN.'; };
$('#o-resetnow').onclick = () => { if (!confirm('Close everything and start over with 10,000 USDG? It counts as a reset on the board.')) return; sync(); restart((acct.busts || 0) + 1); paint(true); drawLines(); $('#o-msg').textContent = `YOUR DESK STARTS OVER AT 10,000. RESET NUMBER ${acct.busts}.`; };
$('#o-chips').onclick = e => { const c = e.target.closest('.chip'); if (c) select({ kind: 'chain', addr: c.dataset.a }); };

mountCrew();
mountBoard(() => { seasonCheck(); return { equity: equity(), pnl: seasonPnl(), season: acct.season, trades: acct.hist.length, wins: acct.hist.filter(h => h.pnl > 0).length, busts: acct.busts || 0 }; });

(async () => {
  initChart(); paint();
  $('#o-chips').innerHTML = recentScans().filter(s => s.price).slice(0, 8).map(s => `<span class="chip" data-a="${s.addr}">${esc(s.sym)}<b>${s.verdict}</b></span>`).join('') || '<span class="note" style="margin:0">Tokens you run on the Ticket page show up here.</span>';
  const q = new URLSearchParams(location.search), a = q.get('a'), m = q.get('m');
  const stock = a && lists.stocks.find(s => s.addr === a.toLowerCase());
  if (isAddr(a)) { setTab(stock ? 'stocks' : 'paste'); await select(stock || { kind: 'chain', addr: a.toLowerCase() }); }
  else { setTab('majors'); await select(lists.majors.find(x => x.addr === m) || lists.majors[0]); }
  loadList('own'); loadList('stocks'); loadList('chain');
  await poll(); setInterval(poll, 10000); fast(); setInterval(fast, 3000);
})();
