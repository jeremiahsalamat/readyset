const BUILD = 'bd32b79adda5';
const CACHE = 'readyset-' + BUILD;
const PAGE = './index.html', ASSETS = ['./manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-180.png'];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'], FONT_CACHE = 'readyset-fonts'; // fonts outlive a build: every update used to wipe them
const fontsSeen = new Set();
// Only the real app is ever stored: a captive portal's page at the gym answers 200 too.
const isApp = html => html.includes('<meta name="readyset-build"') && html.trimEnd().endsWith('</html>');
const keepPage = html => caches.open(CACHE).then(c => c.put(PAGE, new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })));
self.addEventListener('install', e => { e.waitUntil((async () => {
  const r = await fetch(new Request(PAGE, { cache: 'reload' }));
  const html = r.ok ? await r.text() : '';
  if (!isApp(html)) throw new Error('not the app');
  const c = await caches.open(CACHE);
  await c.addAll(ASSETS.map(a => new Request(a, { cache: 'reload' })));
  await keepPage(html); // last: a cache that has the page is complete
  await self.skipWaiting();
})()); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== REST_CACHE && k !== FONT_CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()).then(restLoad).then(r => { if (r && !r.fired) restArm(r); })); });
// Rest-timer alert. iOS freezes this worker with the page soon after ReadySet leaves the screen,
// so a banner can only go out in the first seconds after you switch away; on screen, the page chimes
// instead. The worker is the only one that posts a banner, once per deadline: a page awake in the
// background only tells it the rest is due. The deadline is kept on disk, so a restarted worker (or
// the next build's) still has it. Thawed more than 5 s late means you are back and the page says so.
// iOS ignores notification tags, so two showNotification calls are always two banners.
const REST_CACHE = 'readyset-rest', REST_KEY = './__rest__';
let restTimer = null, restDone = null, restShown = 0, restAt = 0, restOff = 0; // restOff: the deadline the page cancelled (a late 'due' for it is stale)
const restSave = r => caches.open(REST_CACHE).then(c => (r ? c.put(REST_KEY, new Response(JSON.stringify(r))) : c.delete(REST_KEY))).catch(() => {});
const restLoad = () => caches.open(REST_CACHE).then(c => c.match(REST_KEY)).then(m => (m ? m.json() : null)).catch(() => null);
function restArm(r) {
  if (restTimer) { clearTimeout(restTimer); restTimer = null; }
  if (restDone) { restDone(); restDone = null; } // the replaced rest's waitUntil settles
  if (!r) return Promise.resolve();
  return new Promise(res => { restDone = res; restTimer = setTimeout(() => { restTimer = null; restDone = null; restFire(r).then(res, res); }, Math.max(0, r.at - Date.now())); });
}
async function restFire(r, handed) { // handed: the hidden page says this rest is due
  const cur = await restLoad();
  if (cur && cur.at === r.at && cur.fired) return;
  if (!handed && (!cur || cur.at !== r.at)) return; // cancelled or replaced meanwhile
  if (Date.now() - r.at > 5000) return restSave(null);
  if (!handed) { const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true }); if (cs.some(c => c.visibilityState === 'visible')) return; } // on screen: the page chimes
  if (self.serviceWorker && self.registration.active && self.registration.active !== self.serviceWorker) return; // a replaced worker: the new one has the deadline
  if (restShown === r.at) return; restShown = r.at; // no await between the check and the set
  await restSave({ at: r.at, fired: 1 });
  await self.registration.showNotification('Rest done', { body: String(r.body || 'Next set').slice(0, 80), tag: 'readyset-rest-' + r.at });
}
self.addEventListener('message', e => {
  const m = e.data || {};
  let p = null;
  if (m.type === 'rest-schedule' && m.at) { const r = { at: +m.at, body: String(m.body || 'Next set').slice(0, 80) }; restAt = r.at; restOff = 0; if (restShown !== r.at) p = restSave(r).then(() => restArm(r)); }
  else if (m.type === 'rest-due' && m.at) { if (+m.at !== restOff) { restArm(null); p = restFire({ at: +m.at, body: m.body }, true); } }
  else if (m.type === 'rest-cancel') { restOff = restAt; restAt = 0; p = restSave(null).then(() => restArm(null)); }
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
    const css = url.host === 'fonts.googleapis.com', fresh = css && !fontsSeen.has(e.request.url); fontsSeen.add(e.request.url); // font files are versioned by URL: only the stylesheet is refreshed
    e.respondWith(caches.open(FONT_CACHE).then(c => c.match(e.request).then(m => {
      if (m && !fresh) return m;
      const net = fetch(e.request).then(r => { if (r && (r.ok || r.type === 'opaque')) return c.put(e.request, r.clone()).then(() => r, () => r); return r; }).catch(() => m);
      e.waitUntil(net.catch(() => {}));
      if (m) return m;
      if (!css) return net; // font files never block the page: let them finish and swap in
      return Promise.race([net, new Promise(res => setTimeout(() => res(Response.error()), 1200))]); // a stylesheet holds back the scripts, so it gets a limit; system fonts for this open
    })));
    return;
  }
  if (url.origin !== location.origin) return; // never cache or serve other origins
  if (!restTimer) e.waitUntil(restLoad().then(r => { if (r && !r.fired && r.at > Date.now()) restArm(r); })); // a worker restarted mid-rest picks the deadline back up
  if (url.pathname.endsWith('/version.txt')) return; // the update check must see the network or fail, never a cached copy
  // The app is served from the cache at once: when iOS has discarded the page, a return must not
  // wait on the gym's signal. Each open refreshes the copy in the background, and the page's own
  // check of version.txt handles a new build (it refreshes this copy, then reloads when safe). The
  // network request skips the browser's HTTP cache, which GitHub Pages lets keep a copy for 10 minutes.
  const dir = new URL('./', self.location).pathname, isPage = e.request.mode === 'navigate' || url.pathname === dir || url.pathname === dir + 'index.html';
  const stored = () => caches.open(CACHE).then(c => c.match(isPage ? PAGE : e.request));
  if (!isPage) { e.respondWith(stored().then(m => m || fetch(e.request))); return; }
  const net = fetch(new Request(url.origin + url.pathname, { cache: 'no-cache', credentials: 'same-origin' }));
  const kept = net.then(r => (r.ok ? r.clone().text().then(h => (isApp(h) ? keepPage(h) : null)) : null)).catch(() => {});
  e.waitUntil(kept);
  if (e.request.mode === 'navigate') e.respondWith(stored().then(m => m || net).catch(() => net));
  else e.respondWith(kept.then(() => net).catch(() => stored())); // the page refreshing the copy before an update reload
});
