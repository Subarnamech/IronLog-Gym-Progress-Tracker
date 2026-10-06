/* OmniPorta hub service worker — scope: /
   Tools (e.g. /ironlog/) register their own, more specific service workers, which take over
   inside their folders. This worker deliberately ignores everything under a tool's folder.
   Bump CACHE_VERSION whenever you change the hub files. */
const CACHE_VERSION = 'omniporta-v1';
const SHELL = [
  '/',
  '/index.html',
  '/tools.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png'
];
const CDN_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

// Hub-owned paths only: the root page, its data file, and icon folders ("/icons/..", "/<tool>/icons/..").
function isHubPath(p) {
  return p === '/' || p === '/index.html' || p === '/tools.js' || p === '/manifest.webmanifest' ||
    /^\/icons\//.test(p) || /^\/[^/]+\/icons\//.test(p);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      // Remove old hub caches and the pre-hub "ironlog-v1/v2" caches that used to live at the root.
      // Tool caches written by the tool's own worker at the current version ("ironlog-v3") are left alone.
      .then((keys) => Promise.all(keys.filter((k) =>
        (k.startsWith('omniporta-') && k !== CACHE_VERSION) || k === 'ironlog-v1' || k === 'ironlog-v2'
      ).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Page navigations: network first so new tools appear, cached hub shell when offline
  if (req.mode === 'navigate') {
    if (url.origin !== self.location.origin || (url.pathname !== '/' && url.pathname !== '/index.html')) return;
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

  const mine = url.origin === self.location.origin && isHubPath(url.pathname);
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
