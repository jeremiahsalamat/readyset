const BUILD = '05bb60d7b172';
const CACHE = 'readyset-' + BUILD;
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-180.png'];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(a => new Request(a, { cache: 'reload' })))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
// Rest-timer alert: the page asks for it at a given time; iOS keeps this worker alive a while after
// the page is suspended, so the alert can still fire with another app in front. The tag makes this
// and the page's own alert a single notification.
let restTimer = null;
self.addEventListener('message', e => {
  const m = e.data || {};
  if (restTimer) { clearTimeout(restTimer); restTimer = null; }
  if (m.type === 'rest-schedule' && m.at) {
    const delay = Math.max(0, m.at - Date.now());
    const fire = new Promise(res => { restTimer = setTimeout(() => { restTimer = null; self.registration.showNotification('Rest done', { body: String(m.body || 'Next set').slice(0, 80), tag: 'readyset-rest', renotify: true, vibrate: [200, 100, 200] }).catch(() => {}).then(res, res); }, delay); });
    if (e.waitUntil) { try { e.waitUntil(fire); } catch (err) { /* some browsers refuse long waits */ } }
  }
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => { const c = cs.find(x => 'focus' in x); return c ? c.focus() : self.clients.openWindow('./'); }));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (FONT_HOSTS.includes(url.host)) {
    // Fonts: cache first, so the app keeps its type offline; fetch to refresh in the background.
    e.respondWith(caches.open(CACHE).then(c => c.match(e.request).then(m => { const net = fetch(e.request).then(r => { if (r && (r.ok || r.type === 'opaque')) c.put(e.request, r.clone()); return r; }).catch(() => m); return m || net; })));
    return;
  }
  if (url.origin !== location.origin) return; // never cache or serve other origins (GitHub API etc.)
  // App files: network first, cache fallback, so updates arrive at once and offline still works.
  // The network request skips the browser's HTTP cache (GitHub Pages lets it keep a copy for up to
  // 10 minutes), so a fix reaches the phone on the very next open. A navigation needs a fresh
  // Request, because one in 'navigate' mode cannot be copied with new options.
  const net = e.request.mode === 'navigate' ? new Request(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }) : new Request(e.request, { cache: 'no-cache' });
  // A slow network (one bar at the gym) must not leave a blank page: after 4 s the cached copy is
  // served if there is one, and the network answer still refreshes the cache when it arrives.
  const fromNet = fetch(net);
  if (!url.search) e.waitUntil(fromNet.then(r => { if (!(r && r.ok)) return null; const c = r.clone(); return caches.open(CACHE).then(x => x.put(e.request, c)); }).catch(() => {}));
  const cached = () => caches.match(e.request).then(m => m || (e.request.mode === 'navigate' ? caches.match('./index.html') : undefined));
  const timeout = new Promise(res => setTimeout(() => res('timeout'), 4000));
  e.respondWith(Promise.race([fromNet.catch(() => 'failed'), timeout]).then(r => (r === 'timeout' || r === 'failed') ? cached().then(m => m || fromNet) : r).catch(() => cached()));
});
