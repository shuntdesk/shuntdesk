// Shuntdesk service worker: only phone alerts. It caches nothing; every page still loads from the network.
// A push arrives empty; the message is fetched from the inbox the server keeps for this browser.
const ID = new URL(self.location).searchParams.get('id') || '';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('push', e => e.waitUntil((async () => {
  let msgs = [];
  try { msgs = (await (await fetch('/api/push/inbox?id=' + encodeURIComponent(ID), { cache: 'no-store' })).json()).messages || []; } catch (x) {}
  if (!msgs.length) return self.registration.showNotification('Shuntdesk', { body: 'Something moved on your watchlist.', icon: '/apple-touch-icon.png', tag: 'sd-watch', data: { url: '/ticket/' } });
  for (const m of msgs.slice(0, 3)) await self.registration.showNotification('Shuntdesk · ' + (m.sym || 'watchlist'), { body: m.text, icon: '/apple-touch-icon.png', tag: 'sd-' + m.addr, data: { url: '/ticket/?a=' + m.addr } });
})()));
self.addEventListener('notificationclick', e => { e.notification.close(); e.waitUntil(self.clients.openWindow(e.notification.data?.url || '/')); });