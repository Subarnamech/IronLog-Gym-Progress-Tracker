/* Iron Log service worker.
   Bump CACHE_VERSION every time you change index.html so users get the update. */
const CACHE_VERSION = 'ironlog-v2';
const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png'
];
// Third-party files worth keeping so the first offline launch still looks right
const CDN_HOSTS = [
  'www.gstatic.com',        // Firebase SDK scripts
  'fonts.googleapis.com',   // font CSS
  'fonts.gstatic.com'       // font files
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
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
  if (url.hostname === 'identitytoolkit.googleapis.com' || url.hostname === 'securetoken.googleapis.com') return;
  if (url.pathname.startsWith('/__/')) return; // Firebase Hosting auth helper paths

  // Page navigations: network first (so updates arrive), fall back to cached app shell offline
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put('/index.html', copy));
          return res;
        })
        .catch(() => caches.match('/index.html').then((r) => r || caches.match('/')))
    );
    return;
  }

  // Same-origin static files and CDN scripts/fonts: cache first, refresh in background
  if (url.origin === self.location.origin || CDN_HOSTS.includes(url.hostname)) {
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
