// Precache everything on install so the game works with no network at all.
// Bump CACHE on every deploy: the old cache is deleted on activate.
const CACHE = 'footy-v2';
const ASSETS = [
  './', './index.html', './manifest.webmanifest',
  './css/style.css',
  './js/main.js', './js/data.js', './js/rng.js', './js/names.js',
  './js/engine/index.js', './js/engine/careerPath.js',
  './js/engine/higherLower.js', './js/engine/whoAmI.js',
  './js/engine/football501.js',
  './data/dataset.json',
  './icon-180.png', './icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(ASSETS))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Cache-first: offline is the normal case here, not the fallback.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit =>
      hit || fetch(e.request).then(res => {
        if (res.ok && new URL(e.request.url).origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      }).catch(() => caches.match('./index.html'))
    )
  );
});
