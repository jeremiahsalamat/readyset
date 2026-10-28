const CACHE = 'readyset-v3';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-180.png'];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
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
  e.respondWith(fetch(net).then(r => { if (r && r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); } return r; }).catch(() => caches.match(e.request).then(m => m || (e.request.mode === 'navigate' ? caches.match('./index.html') : undefined))));
});
