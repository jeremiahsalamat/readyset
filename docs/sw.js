const BUILD = '5a86d742ef64';
const CACHE = 'readyset-' + BUILD;
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-180.png'];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
const fontsSeen = new Set();
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(a => new Request(a, { cache: 'reload' })))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== REST_CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()).then(restLoad).then(r => { if (r) restArm(r); })); });
// Rest-timer backup. iOS freezes this worker with the page soon after Readyset leaves the screen,
// so this can only alert in the first seconds after you switch away; the page alerts whenever it
// is the one awake. The deadline is kept on disk, so a restarted worker (or the next build's) still
// has it. A worker thawed late, or a page already on screen, means no notification here.
const REST_CACHE = 'readyset-rest', REST_KEY = './__rest__';
let restTimer = null, restDone = null;
const restSave = r => caches.open(REST_CACHE).then(c => (r ? c.put(REST_KEY, new Response(JSON.stringify(r))) : c.delete(REST_KEY))).catch(() => {});
const restLoad = () => caches.open(REST_CACHE).then(c => c.match(REST_KEY)).then(m => (m ? m.json() : null)).catch(() => null);
function restArm(r) {
  if (restTimer) { clearTimeout(restTimer); restTimer = null; }
  if (restDone) { restDone(); restDone = null; } // the replaced rest's waitUntil settles
  if (!r) return Promise.resolve();
  return new Promise(res => { restDone = res; restTimer = setTimeout(() => { restTimer = null; restDone = null; restFire(r).then(res, res); }, Math.max(0, r.at - Date.now())); });
}
async function restFire(r) {
  const cur = await restLoad(); if (!cur || cur.at !== r.at) return; // cancelled or replaced meanwhile
  await restSave(null);
  if (Date.now() - r.at > 15000) return; // frozen and thawed late: you are back, and the page says so
  const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (cs.some(c => c.visibilityState === 'visible')) return; // Readyset is on screen and chimes itself
  await self.registration.showNotification('Rest done', { body: String(r.body || 'Next set').slice(0, 80), tag: 'readyset-rest', renotify: true });
}
self.addEventListener('message', e => {
  const m = e.data || {};
  let p = null;
  if (m.type === 'rest-schedule' && m.at) { const r = { at: +m.at, body: String(m.body || 'Next set').slice(0, 80) }; p = restSave(r).then(() => restArm(r)); }
  else if (m.type === 'rest-cancel') p = restSave(null).then(() => restArm(null));
  if (p && e.waitUntil) { try { e.waitUntil(p); } catch (err) { /* some browsers refuse long waits */ } }
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
    const fresh = !fontsSeen.has(e.request.url); fontsSeen.add(e.request.url);
    e.respondWith(caches.open(CACHE).then(c => c.match(e.request).then(m => {
      if (m && !fresh) return m;
      const net = fetch(e.request).then(r => { if (r && (r.ok || r.type === 'opaque')) return c.put(e.request, r.clone()).then(() => r, () => r); return r; }).catch(() => m);
      if (m) { e.waitUntil(net.catch(() => {})); return m; }
      return net;
    })));
    return;
  }
  if (url.origin !== location.origin) return; // never cache or serve other origins
  if (!restTimer) e.waitUntil(restLoad().then(r => { if (r && r.at > Date.now()) restArm(r); })); // a worker restarted mid-rest picks the deadline back up
  if (url.pathname.endsWith('/version.txt')) return; // the update check must see the network or fail, never a cached copy
  // App files: network first, cache fallback, so updates arrive at once and offline still works.
  // The network request skips the browser's HTTP cache (GitHub Pages lets it keep a copy for up to
  // 10 minutes), so a fix reaches the phone on the very next open. A navigation needs a fresh
  // Request, because one in 'navigate' mode cannot be copied with new options.
  const net = e.request.mode === 'navigate' ? new Request(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }) : new Request(e.request, { cache: 'no-cache' });
  // A slow network (one bar at the gym) must not leave a blank page: after 1.5 s the cached copy is
  // served if there is one, and the network answer still refreshes the cache when it arrives.
  const fromNet = fetch(net);
  if (!url.search) e.waitUntil(fromNet.then(r => { if (!(r && r.ok)) return null; const c = r.clone(); return caches.open(CACHE).then(x => x.put(e.request, c)); }).catch(() => {}));
  const cached = () => caches.match(e.request).then(m => m || (e.request.mode === 'navigate' ? caches.match('./index.html') : undefined));
  const timeout = new Promise(res => setTimeout(() => res('timeout'), 1500));
  e.respondWith(Promise.race([fromNet.catch(() => 'failed'), timeout]).then(r => {
    if (r === 'timeout' || r === 'failed') return cached().then(m => m || fromNet);
    if (!r.ok && e.request.mode === 'navigate') return cached().then(m => m || r); // an error page is no substitute for the cached app
    return r;
  }).catch(() => cached()));
});
