// PlayzAnime service worker. The site needs the internet: this only makes it
// installable, keeps built files (hashed names), icons and fonts in a cache so
// pages open faster, and shows offline.html when there is no connection.
// Nothing here makes the app work offline; downloads live in the Windows and
// Android apps. API, proxy and other sites are never cached.
const CACHE = 'playzanime-v2';
const BASE = new URL('./', self.location).pathname;
const OFFLINE = `${BASE}offline.html`;
const PRECACHE = [OFFLINE, `${BASE}icon.svg`, `${BASE}icon.png`, `${BASE}manifest.webmanifest`];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const isStatic = (url) => url.pathname.startsWith(`${BASE}assets/`) || /\.(?:png|svg|webmanifest|woff2?)$/.test(url.pathname);

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || /\/(?:api|proxy)\//.test(url.pathname)) return;

  // Pages always come from the network; offline gets the "come back online" page.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE)));
    return;
  }

  // Built files never change under the same name: cache first, fill on miss.
  if (isStatic(url)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              void caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});
