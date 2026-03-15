const CACHE = 'schedkit-v3';
const SHELL = ['/dashboard', '/manifest.json', '/brand/icon-192.png', '/brand/icon-512.png'];

// ── Install ───────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

// ── Activate ──────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

// ── Messages ──────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

// ── Fetch ─────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Skip non-http(s) requests (chrome-extension://, etc.)
  if (!url.protocol.startsWith('http')) return;

  // Network-first for API and auth
  if (url.pathname.startsWith('/v1/') || url.pathname.startsWith('/auth/')) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }

  // Cache-first for static assets
  if (
    e.request.destination === 'style' ||
    e.request.destination === 'script' ||
    e.request.destination === 'image' ||
    e.request.destination === 'font'
  ) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      }))
    );
    return;
  }

  // Network-first for pages, offline fallback to cache
  e.respondWith(
    fetch(e.request).then(res => {
      const clone = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, clone));
      return res;
    }).catch(() => caches.match(e.request) || caches.match('/dashboard'))
  );
});

// ── Push Notifications ────────────────────────────────
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data?.json() || {}; } catch { data = { title: 'SchedKit', body: e.data?.text() || '' }; }

  const title = data.title || 'SchedKit';
  const options = {
    body: data.body || '',
    icon: '/brand/icon-192.png',
    badge: '/brand/icon-192.png',
    tag: data.tag || 'schedkit-default',
    data: { url: data.url || '/dashboard' },
    requireInteraction: data.requireInteraction || false,
    actions: data.actions || [],
    vibrate: data.vibrate || [200, 100, 200],
  };

  e.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification Click ────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/dashboard';

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // Focus existing tab if open
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      // Otherwise open new tab
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
