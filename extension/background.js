// The watchlist in the background: every five minutes, the events shuntdesk.com saw for the tokens on this watchlist
// (a curve past 80% or bonded, half a curve's ETH gone, a pooled price halved, a launcher moving its tokens) become
// browser notifications. The list itself lives on shuntdesk.com under a code the site, the CLI and the bot share.
const BASE = 'https://shuntdesk.com';
const store = { get: k => chrome.storage.sync.get(k).then(v => v[k]), set: (k, v) => chrome.storage.sync.set({ [k]: v }) };

async function api(path, body) {
  const r = await fetch(BASE + '/api/' + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await r.json().catch(() => null); if (!j || j.ok === false) throw new Error(j?.why || 'not answering'); return j;
}
async function check() {
  const code = await store.get('code'); if (!code) return;
  const since = (await chrome.storage.local.get('since')).since || Date.now() - 10 * 60000;
  let r; try { r = await api(`watch/events?c=${code}&since=${since}`); } catch (e) { return; }
  for (const e of r.events.slice(0, 5).reverse()) chrome.notifications.create('sd|' + e.token + '|' + e.t, { type: 'basic', iconUrl: 'icons/128.png', title: `Shuntdesk · $${e.symbol || 'token'}`, message: e.text, priority: 1 });
  if (r.events.length) await chrome.storage.local.set({ since: Math.max(...r.events.map(e => e.t)) });
  else if (r.checked) await chrome.storage.local.set({ since: Math.max(since, r.checked - 60000) });
}
chrome.runtime.onInstalled.addListener(() => chrome.alarms.create('sd-watch', { periodInMinutes: 5 }));
chrome.runtime.onStartup.addListener(() => chrome.alarms.create('sd-watch', { periodInMinutes: 5 }));
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'sd-watch') check(); });
chrome.notifications.onClicked.addListener(id => { const [, token] = id.split('|'); if (token) chrome.tabs.create({ url: `${BASE}/ticket/?a=${token}` }); chrome.notifications.clear(id); });

// the panel's Watch button and the popup talk to the list through here
chrome.runtime.onMessage.addListener((m, _, reply) => {
  (async () => {
    const code = await store.get('code');
    if (m.type === 'watch') { const r = await api('watch', { c: code || undefined, add: { a: m.a, sym: m.sym } }); await store.set('code', r.code); return { ok: true, code: r.code, n: r.tokens.length }; }
    if (m.type === 'unwatch') { if (!code) return { ok: false }; const r = await api('watch', { c: code, remove: m.a }); return { ok: true, n: r.tokens.length }; }
    if (m.type === 'list') { if (!code) return { ok: true, code: null, tokens: [] }; return await api('watch?c=' + code); }
    if (m.type === 'use') { const c = String(m.code || '').trim().toLowerCase(); await api('watch?c=' + c); await store.set('code', c); await chrome.storage.local.set({ since: Date.now() }); return { ok: true, code: c }; }
    if (m.type === 'forget') { await chrome.storage.sync.remove('code'); return { ok: true }; }
    return { ok: false };
  })().then(reply, e => reply({ ok: false, why: e.message }));
  return true;
});
