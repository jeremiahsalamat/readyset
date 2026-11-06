// The service worker's promises, checked on the real docs/sw.js with stubbed caches and network:
// a return never waits on the network, offline works, updates arrive, fonts survive a build, and
// nothing but the real app is ever stored. Usage: node tests/sw_budget.js [path to sw.js]
const fs = require('fs'), path = require('path'), vm = require('vm');
const code = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'docs', 'sw.js'), 'utf8');
const SCOPE = 'https://x.test/readyset/', IDX = SCOPE + 'index.html', CSS = 'https://fonts.googleapis.com/css2?f', WOFF = 'https://fonts.gstatic.com/s/a.woff2';
let fails = 0, checks = 0;
const ok = (c, m, extra) => { checks++; if (!c) { fails++; console.log('FAIL  ' + m + (extra != null ? '  [' + extra + ']' : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const isPageUrl = u => u === IDX || u === SCOPE;
const appHtml = b => `${b}:<html><head><meta name="readyset-build" content="${b}"></head></html>\n`;
const net = () => ({ delay: 5, bodyDelay: 0, down: false, build: 'A', portal: false, n: 0 });
function worldCaches() {
  const stores = new Map(), key = r => (typeof r === 'string' ? new URL(r, SCOPE).href : r.url);
  const obj = n => ({
    match: async r => { const v = stores.get(n).get(key(r)); return v ? v.clone() : undefined; },
    put: async (r, res) => { stores.get(n).set(key(r), res); },
    delete: async r => stores.get(n).delete(key(r)),
    addAll: async rs => { for (const q of rs) stores.get(n).set(key(q), await obj.fetch(q)); },
  });
  return { obj, stores, api: { open: async n => { if (!stores.has(n)) stores.set(n, new Map()); return obj(n); }, keys: async () => [...stores.keys()], delete: async n => stores.delete(n), match: async r => { for (const [n] of stores) { const m = await obj(n).match(r); if (m) return m; } } } };
}
class Req { constructor(u, o = {}) { this.url = typeof u === 'string' ? new URL(u, SCOPE).href : u.url; this.mode = o.mode || (typeof u === 'object' ? u.mode : 'cors'); this.method = 'GET'; } clone() { return this; } }
function startWorker(C, N, build) {
  const h = {};
  const fetchStub = async q => {
    N.n++; const u = typeof q === 'string' ? q : q.url; await sleep(N.delay);
    if (N.down) throw new TypeError('offline');
    if (N.bodyDelay) await sleep(N.bodyDelay);
    if (isPageUrl(u)) return new Response(N.portal ? '<html>Sign in to the gym wifi</html>' : appHtml(N.build));
    return new Response(N.build + ':' + u);
  };
  C.obj.fetch = fetchStub;
  const shown = [];
  const ctx = { self: { location: new URL(SCOPE + 'sw.js'), addEventListener: (t, f) => { h[t] = f; }, skipWaiting: async () => {}, clients: { claim: async () => {}, matchAll: async () => [] }, registration: { showNotification: async (t, o) => { shown.push(o); } } }, caches: C.api, fetch: fetchStub, Request: Req, Response, URL, Set, Promise, setTimeout, clearTimeout, console, JSON, Math, Date, String, location: { origin: new URL(SCOPE).origin } };
  vm.createContext(ctx); vm.runInContext(code.replace(/const BUILD = '[^']+'/, `const BUILD = '${build}'`), ctx);
  const life = async ev => { let p; h[ev]({ waitUntil: x => { p = x; } }); await p; };
  const req = async (u, mode) => {
    let r; const t0 = Date.now(), w = [];
    h.fetch({ request: new Req(u, { mode }), respondWith: x => { r = x; }, waitUntil: x => w.push(x) });
    let res; try { res = r ? await r : 'pass'; } catch (e) { res = undefined; }
    const ms = Date.now() - t0; let body = null;
    try { body = res && res !== 'pass' ? await res.clone().text() : null; } catch (e) { body = null; }
    if (res && res.type === 'error') body = null;
    return { ms, body, settle: () => Promise.all(w) };
  };
  const msg = (data) => new Promise(res => { let p = null; h.message({ data, waitUntil: x => { p = x; } }); setTimeout(() => res(p), 0); });
  return { life, req, msg, shown };
}
(async () => {
  const C = worldCaches(), N = net(); let W = startWorker(C, N, 'b1'); await W.life('install'); await W.life('activate');
  const first = await W.req(CSS, 'no-cors'); await first.settle(); await W.req(WOFF, 'cors').then(r => r.settle());

  // A return never waits on the network, however slow, and a slow body cannot hold it either.
  N.delay = 700; { const r = await W.req(IDX, 'navigate'); ok(r.ms < 100 && /^A:/.test(r.body || ''), 'cached page served without waiting for a 700 ms network', r.ms + ' ms'); await r.settle(); }
  N.delay = 200; N.bodyDelay = 800; { const r = await W.req(IDX, 'navigate'); ok(r.ms < 100, 'a slow body does not hold the page', r.ms + ' ms'); await r.settle(); }
  N.delay = 5; N.bodyDelay = 0;
  { const r = await W.req(SCOPE, 'navigate'); ok(r.ms < 100 && /^A:/.test(r.body || ''), 'the folder URL gets the same page', r.ms + ' ms'); await r.settle(); }

  // Offline.
  N.down = true;
  { const r = await W.req(IDX, 'navigate'); ok(r.ms < 100 && /^A:/.test(r.body || ''), 'offline: page from cache', r.ms + ' ms'); await r.settle(); const c = await W.req(CSS, 'no-cors'); ok(c.ms < 100 && c.body, 'offline: font CSS from cache', c.ms + ' ms'); }
  N.down = false;

  // A captive portal's page, or an error, is never stored as the app.
  N.portal = true; { const r = await W.req(IDX, 'navigate'); await r.settle(); const again = await W.req(IDX, 'navigate'); await again.settle(); ok(/^A:/.test(again.body || ''), 'a captive portal page never replaces the app', (again.body || '').slice(0, 30)); }
  N.portal = false;
  { const C3 = worldCaches(), N3 = net(); N3.portal = true; const W3 = startWorker(C3, N3, 'bx'); let failed = false; try { await W3.life('install'); } catch (e) { failed = true; } ok(failed, 'a worker cannot install from a captive portal page'); }

  // An update keeps the fonts, and installs the new page.
  N.build = 'B'; W = startWorker(C, N, 'b2'); await W.life('install'); await W.life('activate');
  ok(!!(await C.api.match(CSS)), 'fonts survive a new build');
  ok([...C.stores.keys()].filter(k => /^readyset-b/.test(k)).join() === 'readyset-b2', 'the old build cache is gone', [...C.stores.keys()].join());
  { const r = await W.req(IDX, 'navigate'); ok(/^B:/.test(r.body || ''), 'a new worker serves its own build'); await r.settle(); }
  N.down = true; { const c = await W.req(CSS, 'no-cors'); ok(!!c.body, 'offline right after an update: fonts still there'); } N.down = false;

  // Font misses: the stylesheet has a limit, font files do not.
  { const C2 = worldCaches(), N2 = net(); const W2 = startWorker(C2, N2, 'b1'); await W2.life('install'); await W2.life('activate'); N2.delay = 1600; const r = await W2.req(CSS, 'no-cors'); ok(r.ms < 1400, 'uncached font CSS on a slow network does not hold the page', r.ms + ' ms'); const f = await W2.req(WOFF, 'cors'); ok(f.body && f.ms >= 1500, 'an uncached font file is still delivered', f.ms + ' ms'); await f.settle(); await r.settle(); }
  { await sleep(20); N.n = 0; W = startWorker(C, N, 'b2'); const a = await W.req(WOFF, 'cors'); await a.settle(); ok(N.n === 0, 'restarted worker: font files need no request', N.n + ' requests'); }

  // The update path: the page's refresh, then a reload, gives the new build, from either URL.
  { N.build = 'C'; const f = await W.req(IDX, 'cors'); await f.settle(); ok(/^C:/.test(f.body || ''), 'the refresh fetch returns the new page'); N.delay = 700; const r = await W.req(IDX, 'navigate'); ok(/^C:/.test(r.body || ''), 'refresh then reload gives the new build', (r.body || '').slice(0, 1) + ' in ' + r.ms + ' ms'); ok(r.ms < 100, 'and at once', r.ms + ' ms'); await r.settle(); N.delay = 5; }
  { N.build = 'C2'; const f = await W.req(SCOPE, 'cors'); await f.settle(); const r = await W.req(IDX, 'navigate'); ok(/^C2:/.test(r.body || ''), 'refreshing the folder URL updates the same copy'); await r.settle(); }
  { N.down = true; const f = await W.req(IDX, 'cors'); ok(/^C2:/.test(f.body || ''), 'a refresh offline still answers from the copy', (f.body || '').slice(0, 3)); N.down = false; }
  // Each open refreshes the copy, so the next open is current: an old build can never stick.
  { N.build = 'D'; const r = await W.req(IDX, 'navigate'); await r.settle(); const again = await W.req(IDX, 'navigate'); ok(/^D:/.test(again.body || ''), 'an open refreshes the cache behind the scenes'); await again.settle(); }
  // The update check itself always sees the network.
  { const r = await W.req(SCOPE + 'version.txt', 'cors'); ok(r.body === null, 'version.txt is not answered by the worker'); }
  // Assets come from the cache with no wait.
  { N.delay = 700; const r = await W.req(SCOPE + 'icon-192.png', 'no-cors'); ok(r.ms < 100 && r.body, 'icons from the cache', r.ms + ' ms'); N.delay = 5; }

  // Rest alert: one banner per deadline, however many times it is told.
  { const at = Date.now() + 30; const W4 = startWorker(worldCaches(), net(), 'b3'); await W4.life('install'); await W4.life('activate');
    await W4.msg({ type: 'rest-schedule', at, body: 'Next: Squat' }); await sleep(10);
    await Promise.all([W4.msg({ type: 'rest-due', at, body: 'Next: Squat' }), W4.msg({ type: 'rest-due', at, body: 'Next: Squat' })]); await sleep(80);
    await W4.msg({ type: 'rest-schedule', at, body: 'Next: Squat' }); await sleep(40);
    ok(W4.shown.length === 1, 'one banner per rest', W4.shown.length);
    ok(!W4.shown[0] || (W4.shown[0].tag === 'readyset-rest-' + at && !W4.shown[0].renotify), 'each rest has its own tag', JSON.stringify(W4.shown[0]));
    const late = Date.now() - 6000; await W4.msg({ type: 'rest-due', at: late }); await sleep(20); ok(W4.shown.length === 1, 'a rest over 5 s past gets no banner', W4.shown.length); }

  console.log(`${checks} checks, ${fails} failures`);
  process.exit(fails ? 1 : 0);
})();
