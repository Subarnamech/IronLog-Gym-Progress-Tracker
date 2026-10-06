/* Busbar Sizing service worker — scope: the busbar/ folder only (e.g. "/busbar/" or "/repo/busbar/").
   Bump CACHE_VERSION every time the tool is rebuilt so installed copies update. */
const CACHE_VERSION = 'busbar-v2';
const BASE = new URL(self.registration.scope).pathname; // derived from where this worker is registered
const ASSETS = new URL('../assets/', self.registration.scope).pathname; // the shared build output
const SHELL = [
  BASE,
  BASE + 'index.html',
  BASE + 'manifest.webmanifest',
  BASE + 'icons/icon-192.png',
  BASE + 'icons/icon-512.png',
  BASE + 'icons/apple-touch-icon.png'
];

// The page's script and styles are built into ../assets/ under hashed names, so read them out of
// the page instead of listing them.
function bundleFiles(cache) {
  return cache.match(BASE + 'index.html')
    .then((res) => (res ? res.text() : ''))
    .then((html) => Array.from(html.matchAll(/(?:src|href)="\.\.\/assets\/([^"]+)"/g), (m) => ASSETS + m[1]));
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(SHELL).then(() => bundleFiles(cache)).then((files) => cache.addAll(files)))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      // Only manage this tool's own caches ("busbar-*"); never touch other tools' caches.
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('busbar-') && k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Page navigations: network first (so updates arrive), fall back to the cached page offline
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

  // The tool's own files and its bundle in ../assets/: cache first, refresh in background
  if (url.pathname.startsWith(BASE) || url.pathname.startsWith(ASSETS)) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            if (res && res.status === 200) {
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
