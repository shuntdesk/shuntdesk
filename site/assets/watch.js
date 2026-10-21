// The watchlist: tokens kept in this browser and looked at again while a Shuntdesk page is open.
// Every minute the pool is priced again; a big move in price or liquidity raises an alert, and a browser
// notification when the visitor allowed them. Every half hour the oldest token runs the line again, so a
// verdict that changed shows up too. With phone alerts on, the server also watches the same tokens and wakes this
// device with a push when price or liquidity moves 30%, even with no Shuntdesk tab open.
import { prices, pairFor, scan, compact, sig, ageShort, api } from './data.js';
import { $, esc } from './ui.js';

const KEY = 'sd.watch', MAX = 25, MOVE = 0.3;
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; } };
const write = l => { try { localStorage.setItem(KEY, JSON.stringify(l.slice(0, MAX))); } catch (e) {} };

// ---- one watchlist everywhere: the list lives on the server under a code the CLI, the extension and the bot share ----
const CKEY = 'sd.wl';
export const watchCode = () => { try { return localStorage.getItem(CKEY) || ''; } catch (e) { return ''; } };
const setCode = c => { try { localStorage.setItem(CKEY, c); } catch (e) {} };
async function syncUp() {
  try { const r = await api('watch', { c: watchCode() || undefined, tokens: read().map(w => ({ a: w.addr, sym: w.sym })) }); if (r?.ok) setCode(r.code); return r; } catch (e) { return null; }
}
// what the server has that this browser does not: tokens added from the CLI or the extension, and the events it saw
async function syncDown() {
  const c = watchCode(); if (!c) return;
  let r; try { r = await api('watch?c=' + c); } catch (e) { return; } if (!r?.ok) return;
  const l = read();
  for (const x of r.tokens) if (!l.some(w => w.addr === x.a)) l.push({ addr: x.a, sym: x.sym || x.a.slice(0, 8), verdict: 'WATCH', score: '', p0: 0, l0: 0, t: x.t || Date.now(), checked: 0, alerts: [] });
  for (const e of r.events || []) { const w = l.find(w => w.addr === e.token); if (w && !w.alerts.some(a => a.text === e.text)) { w.alerts.unshift({ t: e.t, text: e.text }); w.alerts = w.alerts.sort((a, b) => b.t - a.t).slice(0, 5); } }
  write(l);
}
export async function useCode(c) {
  c = String(c || '').trim().toLowerCase(); if (!/^wl-[a-z0-9]{6}$/.test(c)) throw new Error('A code looks like wl-xxxxxx.');
  const r = await api('watch?c=' + c).catch(() => null); if (!r?.ok) throw new Error('No watchlist with that code.');
  setCode(c); await syncDown(); await syncUp();
}

export const watching = addr => read().some(w => w.addr === addr);
export function watch(res) {
  const l = read().filter(w => w.addr !== res.addr);
  l.unshift({ addr: res.addr, sym: res.sym, verdict: res.verdict, score: res.score, p0: res.price || 0, l0: res.liq || 0, t: Date.now(), checked: Date.now(), alerts: [] });
  write(l);
  try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch (e) {}
  pushSync(); syncUp();
  return l.length;
}
export function unwatch(addr) { write(read().filter(w => w.addr !== addr)); pushSync(); syncUp(); }

// ---- phone alerts (Web Push) ----
const PKEY = 'sd.push', pushId = () => { try { return localStorage.getItem(PKEY) || ''; } catch (e) { return ''; } };
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const pushOn = () => !!pushId();
const u8 = s => { const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)); return Uint8Array.from(b, c => c.charCodeAt(0)); };
export async function pushEnable() {
  if (!pushSupported()) throw new Error('This browser has no push. On an iPhone, add Shuntdesk to the home screen first.');
  if (await Notification.requestPermission() !== 'granted') throw new Error('Notifications are blocked for this site.');
  const { key } = await api('push/key'); if (!key) throw new Error('Phone alerts are not set up on the server.');
  const reg = await navigator.serviceWorker.register('/sw.js?id=' + (pushId() || 'new'));
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: u8(key) });
  const r = await api('push/sub', { id: pushId(), sub: sub.toJSON(), tokens: read().map(w => ({ addr: w.addr, sym: w.sym })) });
  if (!r || !r.ok) throw new Error(r?.why || 'The server did not answer.');
  try { localStorage.setItem(PKEY, r.id); } catch (e) {}
  await navigator.serviceWorker.register('/sw.js?id=' + r.id);   // the worker reads its inbox id from its own address
  return r;
}
export async function pushDisable() {
  try { const reg = await navigator.serviceWorker.getRegistration('/'); const sub = await reg?.pushManager.getSubscription(); await sub?.unsubscribe(); await reg?.unregister(); } catch (e) {}
  try { localStorage.removeItem(PKEY); } catch (e) {}
}
async function pushSync() {
  if (!pushOn()) return;
  try { const reg = await navigator.serviceWorker.getRegistration('/'); const sub = await reg?.pushManager.getSubscription(); if (sub) await api('push/sub', { id: pushId(), sub: sub.toJSON(), tokens: read().map(w => ({ addr: w.addr, sym: w.sym })) }); } catch (e) {}
}

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
    try { const r = await scan(due.addr); if (r.verdict && r.verdict !== 'NO POOL' && r.verdict !== due.verdict) { if (due.verdict !== 'WATCH') alert(due, `Verdict changed from ${due.verdict} ${due.score} to ${r.verdict} ${r.score}.`); due.verdict = r.verdict; due.score = r.score; } } catch (e) {}
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
    const pb = $('#w-push', box); if (pb) { pb.hidden = !pushSupported() && !/iPhone|iPad/.test(navigator.userAgent); pb.textContent = pushOn() ? 'Phone alerts on · turn off' : 'Turn on phone alerts'; }
    // the code that carries this list to the CLI, the extension and the bot
    let cb = box.querySelector('.w-code'); if (!cb) { cb = document.createElement('div'); cb.className = 'w-code note'; cb.style.cssText = 'margin-top:12px;line-height:1.8'; box.querySelector('.in')?.appendChild(cb) || box.appendChild(cb); }
    const code = watchCode();
    cb.innerHTML = code ? `YOUR WATCHLIST CODE <b class="mono" style="color:var(--ink, #edebe6)">${code}</b> <button class="btn ghost" type="button" data-copy="${code}">Copy</button><br>
      THE SAME LIST, EVERYWHERE: <span class="mono">npx shuntdesk watchlist ${code}</span> · THE EXTENSION · THE BOT: <span class="mono">/watchlist ${code}</span> ON <a class="acc" href="https://t.me/shuntdesk_bot" target="_blank" rel="noopener">@shuntdesk_bot</a><br>
      <a class="acc" href="#" data-use="1">Use another code</a>`
      : `WATCH A TOKEN AND IT GETS A CODE THAT CARRIES THIS LIST TO THE CLI, THE EXTENSION AND THE BOT. <a class="acc" href="#" data-use="1">Have a code already?</a>`;
    const perm = 'Notification' in window ? Notification.permission : 'unsupported';
    $('#w-perm', box).textContent = pushOn() ? 'PHONE ALERTS ON · THE SERVER CHECKS EVERY 15 MINUTES, EVEN WITH THIS TAB CLOSED' : perm === 'granted' ? 'BROWSER ALERTS ON' : perm === 'denied' ? 'BROWSER ALERTS BLOCKED · ALERTS SHOW HERE ONLY' : perm === 'unsupported' ? 'ALERTS SHOW HERE ONLY' : 'BROWSER ALERTS: ASKED WHEN YOU WATCH A TOKEN';
  }
  box.addEventListener('click', async e => {
    const b = e.target.closest('[data-un]'); if (b) { unwatch(b.dataset.un); paint(); return; }
    const cp = e.target.closest('[data-copy]'); if (cp) { try { await navigator.clipboard.writeText(cp.dataset.copy); cp.textContent = 'Copied'; } catch (x) {} return; }
    const u = e.target.closest('[data-use]'); if (u) { e.preventDefault(); const c = prompt('Your watchlist code (wl-xxxxxx):'); if (!c) return; try { await useCode(c); paint(); check().then(paint); } catch (x) { $('#w-perm', box).textContent = String(x.message || x).toUpperCase(); } return; }
    const p = e.target.closest('#w-push'); if (!p) return;
    p.disabled = true; const was = p.textContent; p.textContent = 'Working…';
    try { if (pushOn()) await pushDisable(); else await pushEnable(); paint(); } catch (x) { p.textContent = was; $('#w-perm', box).textContent = String(x.message || x).toUpperCase(); }
    p.disabled = false;
  });
  addEventListener('storage', e => { if (e.key === KEY) paint(); });
  paint(); syncDown().then(() => { paint(); return check(); }).then(paint);
  setInterval(() => check().then(paint), 60000);
  setInterval(() => syncDown().then(paint), 5 * 60000);   // what the CLI, the extension and the server added in the meantime
  return () => { paint(); check().then(paint); };   // a token just added is priced right away
}
