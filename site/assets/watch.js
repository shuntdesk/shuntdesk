// The watchlist: tokens kept in this browser and looked at again while a Shuntdesk page is open.
// Every minute the pool is priced again; a big move in price or liquidity raises an alert, and a browser
// notification when the visitor allowed them. Every half hour the oldest token runs the line again, so a
// verdict that changed shows up too. Nothing leaves the browser except the reads themselves.
import { prices, pairFor, scan, compact, sig, ageShort } from './data.js';
import { $, esc } from './ui.js';

const KEY = 'sd.watch', MAX = 12, MOVE = 0.3;
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; } };
const write = l => { try { localStorage.setItem(KEY, JSON.stringify(l.slice(0, MAX))); } catch (e) {} };

export const watching = addr => read().some(w => w.addr === addr);
export function watch(res) {
  const l = read().filter(w => w.addr !== res.addr);
  l.unshift({ addr: res.addr, sym: res.sym, verdict: res.verdict, score: res.score, p0: res.price || 0, l0: res.liq || 0, t: Date.now(), checked: Date.now(), alerts: [] });
  write(l);
  try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch (e) {}
  return l.length;
}
export function unwatch(addr) { write(read().filter(w => w.addr !== addr)); }

function alert(w, text) {
  const last = w.alerts[0];
  if (last && last.text === text && Date.now() - last.t < 6 * 3600000) return;   // the same alert once every six hours at most
  w.alerts.unshift({ t: Date.now(), text }); w.alerts = w.alerts.slice(0, 5);
  try { if ('Notification' in window && Notification.permission === 'granted') new Notification(`Shuntdesk · ${w.sym}`, { body: text, icon: '/apple-touch-icon.png', tag: 'sd-' + w.addr }); } catch (e) {}
}

// prices every watched token, raises alerts, and every half hour runs the oldest one on the line again
async function check() {
  const l = read(); if (!l.length) return l;
  let m = {}; try { m = await prices(l.map(w => w.addr)); } catch (e) {}
  // a token still on a launch curve is not on DexScreener yet: GeckoTerminal has it
  for (const w of l.filter(w => !m[w.addr]).slice(0, 3)) { const p = await pairFor(w.addr).catch(() => null); if (p) m[w.addr] = p; }
  for (const w of l) {
    const p = m[w.addr]; if (!p) continue;
    w.price = p.price; w.liq = p.liq;
    if (w.l0 && p.liq < w.l0 * (1 - MOVE)) alert(w, `Liquidity fell ${Math.round((1 - p.liq / w.l0) * 100)}% since you started watching, now $${compact(p.liq)}.`);
    if (w.p0 && p.price < w.p0 * (1 - MOVE)) alert(w, `Price is down ${Math.round((1 - p.price / w.p0) * 100)}% since you started watching.`);
    if (w.p0 && p.price > w.p0 * (1 + MOVE)) alert(w, `Price is up ${Math.round((p.price / w.p0 - 1) * 100)}% since you started watching.`);
  }
  const due = l.filter(w => Date.now() - w.checked > 30 * 60000).sort((a, b) => a.checked - b.checked)[0];
  if (due) {
    due.checked = Date.now();
    try { const r = await scan(due.addr); if (r.verdict && r.verdict !== 'NO POOL' && r.verdict !== due.verdict) { alert(due, `Verdict changed from ${due.verdict} ${due.score} to ${r.verdict} ${r.score}.`); due.verdict = r.verdict; due.score = r.score; } } catch (e) {}
  }
  // keep what the visitor did in the meantime (another tab may have added or removed one)
  const now = read(), byAddr = new Map(l.map(w => [w.addr, w]));
  write(now.map(w => ({ ...w, ...(byAddr.get(w.addr) || {}) })));
  return read();
}

const pct = (a, b) => !a || !b ? '' : `${a >= b ? '+' : ''}${((a / b - 1) * 100).toFixed(1)}%`;
export function mountWatch(box) {
  if (!box) return () => {};
  function paint(l = read()) {
    box.hidden = false;
    $('#w-n', box).textContent = l.length ? `${l.length} of ${MAX}` : 'empty';
    $('#w-list', box).innerHTML = l.length ? l.map(w => `<div class="wr" data-a="${w.addr}">
      <a href="/ticket/?a=${w.addr}"><b>${esc(w.sym)}</b><small>watching ${ageShort(w.t)}</small></a>
      <span class="tag ${w.verdict}">${w.verdict} ${w.score}</span>
      <span class="mono">${w.price ? '$' + sig(w.price) : '···'} <i class="${(w.price || 0) >= w.p0 ? 'up' : 'dn'}">${pct(w.price, w.p0)}</i></span>
      <span class="mono">liq ${w.liq ? '$' + compact(w.liq) : '···'} <i class="${(w.liq || 0) >= w.l0 ? 'up' : 'dn'}">${pct(w.liq, w.l0)}</i></span>
      <span class="wa">${w.alerts[0] ? esc(w.alerts[0].text) : 'no alerts'}</span>
      <button class="btn ghost" data-un="${w.addr}" type="button">Stop</button></div>`).join('')
      : '<p class="note" style="margin:0">Run a ticket and press Watch. This browser looks at the token again every minute while a Shuntdesk page is open, and tells you when its price or liquidity moves 30% or its verdict changes.</p>';
    const perm = 'Notification' in window ? Notification.permission : 'unsupported';
    $('#w-perm', box).textContent = perm === 'granted' ? 'BROWSER ALERTS ON' : perm === 'denied' ? 'BROWSER ALERTS BLOCKED · ALERTS SHOW HERE ONLY' : perm === 'unsupported' ? 'ALERTS SHOW HERE ONLY' : 'BROWSER ALERTS: ASKED WHEN YOU WATCH A TOKEN';
  }
  box.addEventListener('click', e => { const b = e.target.closest('[data-un]'); if (b) { unwatch(b.dataset.un); paint(); } });
  addEventListener('storage', e => { if (e.key === KEY) paint(); });
  paint(); check().then(paint);
  setInterval(() => check().then(paint), 60000);
  return () => { paint(); check().then(paint); };   // a token just added is priced right away
}
