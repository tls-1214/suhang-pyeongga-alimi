// Service Worker — 수행 평가 알리미
const CACHE_NAME = 'eval-reminder-v2';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon.svg',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  // Supabase API 요청은 캐시 제외
  if (event.request.url.includes('supabase.co')) return;
  event.respondWith(
    caches.match(event.request).then(cached => cached ?? fetch(event.request))
  );
});

// ──────────────────────────────────────────
//  Web Push 수신 → 알림 표시
// ──────────────────────────────────────────
self.addEventListener('push', event => {
  let data = { title: '수행 평가 알리미', body: '수행 평가 알림이 있어요', tag: 'eval-notif' };
  try { data = { ...data, ...event.data?.json() }; } catch {}

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body:    data.body,
      icon:    data.icon ?? './icon.svg',
      badge:   './icon.svg',
      tag:     data.tag,
      renotify: true,
      data:    { url: self.registration.scope },
    })
  );
});

// 알림 클릭 → 앱 열기
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification.data?.url ?? self.registration.scope;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.startsWith(self.registration.scope)) { c.focus(); return; }
      }
      return clients.openWindow(target);
    })
  );
});
