// SLS 방송팀 관리 시스템 — 서비스 워커 (아이폰·갤럭시 푸시 알림 표시)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  const title = d.title || 'SLS 방송팀';
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || '새 포지션 알림이 있어요',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    tag: d.tag || 'sls-notice',
    renotify: true,
    data: { url: d.url || './' },
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) { if (c.url.startsWith(self.registration.scope)) { await c.focus(); c.navigate?.(url); return; } }
    await self.clients.openWindow(url);
  })());
});
