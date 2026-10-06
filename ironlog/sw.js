/* Iron Log service worker — scope: the ironlog/ folder only (e.g. "/ironlog/" or "/repo/ironlog/").
   Bump CACHE_VERSION every time you change ironlog/index.html so installed copies update. */
const CACHE_VERSION = 'ironlog-v5';
const BASE = new URL(self.registration.scope).pathname; // derived from where this worker is registered
const SHELL = [
  BASE,
  BASE + 'index.html',
  BASE + 'manifest.webmanifest',
  BASE + 'icons/icon-192.png',
  BASE + 'icons/icon-512.png',
  BASE + 'icons/apple-touch-icon.png'
];
// Third-party files worth keeping so the first offline launch still looks right
const CDN_HOSTS = ['www.gstatic.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      // Only manage this tool's own caches ("ironlog-*"); never touch other tools' caches.
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('ironlog-') && k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Never touch Firebase API traffic (Firestore / Auth) — the Firebase SDK handles its own offline logic.
  if (url.hostname.endsWith('googleapis.com') && url.hostname !== 'fonts.googleapis.com') return;
  if (url.hostname.endsWith('firebaseapp.com') || url.hostname.endsWith('firebaseio.com')) return;
  if (url.pathname.startsWith('/__/')) return; // Firebase Hosting auth helper paths

  // Page navigations: network first (so updates arrive), fall back to the cached app shell offline
  if (req.mode === 'navigate') {
    if (!url.pathname.startsWith(BASE)) return;
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(BASE + 'index.html', copy));
          return res;
        })
        .catch(() => caches.match(BASE + 'index.html').then((r) => r || caches.match(BASE)))
    );
    return;
  }

  // Iron Log's own static files and CDN scripts/fonts: cache first, refresh in background
  const mine = url.origin === self.location.origin && url.pathname.startsWith(BASE);
  if (mine || CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            if (res && (res.status === 200 || res.type === 'opaque')) {
              const copy = res.clone();
              caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
            }
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
  }
});
