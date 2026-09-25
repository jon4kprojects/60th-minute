// Offline-first, but not stale-first.
//
// The first version was cache-first for everything, which meant a published
// code change never reached a device that had already installed the app: the
// service worker answered from its own copy and never asked. Splitting the
// strategy keeps offline working while letting updates land:
//
//   app shell (html/js/css)  network-first, fall back to cache when offline
//   dataset + icons          cache-first, since they are large and versioned
//
const CACHE = 'm60-b39.833b8f0';
const ASSETS = [
  './', './index.html', './manifest.webmanifest',
  './css/style.css',
  './js/main.js', './js/data.js', './js/rng.js', './js/names.js',
  './js/engine/index.js', './js/engine/careerPath.js',
  './js/engine/higherLower.js', './js/engine/whoAmI.js',
  './js/engine/football501.js', './js/engine/playedForBoth.js',
  './data/dataset.json', './data/version.json',
  './icon-180.png', './icon-512.png', './icon-64.png', './icon-32.png',
  './brand/logo-lockup.svg', './brand/mark.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(ASSETS))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== 'm60-data').map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const isShell = (url) =>
  /\.(js|css|html|webmanifest)$/.test(url.pathname) || url.pathname.endsWith('/');

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  if (isShell(url)) {
    // Network first: a reload with signal always gets the current build.
    e.respondWith(
      fetch(e.request).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      }).catch(() =>
        caches.match(e.request, { ignoreSearch: true })
          .then(hit => hit || caches.match('./index.html'))
      )
    );
    return;
  }

  // Everything else (dataset, icons): cache first, it is big and versioned.
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit =>
      hit || fetch(e.request).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      }).catch(() => caches.match('./index.html'))
    )
  );
});
