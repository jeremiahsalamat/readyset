"""Assemble Readyset from src/ into:
  readyset.html      - page body for publishing as a claude.ai Artifact (no html/head/body wrapper)
  docs/index.html    - standalone installable web app (any static host, or open locally)
  docs/manifest.webmanifest, docs/sw.js, docs/icon-*.png
Run: python build.py
"""
import os, struct, zlib

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, 'src')
DIST = os.path.join(ROOT, 'docs')
os.makedirs(DIST, exist_ok=True)

def read(name):
    with open(os.path.join(SRC, name), encoding='utf-8', newline='') as f:
        return f.read().replace('\r\n', '\n')

css, body, engine, sanitize, app = read('styles.css'), read('body.html'), read('engine.js'), read('sanitize.js'), read('app.js')
FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Barlow:wght@400;500;600&display=swap">'

head_common = (
    '<title>Readyset</title>\n'
    '<meta name="claude:viewport-fit-sides" content="cover">\n'
    + FONTS + '\n<style>\n' + css + '\n</style>\n'
)
inline_scripts = ['\n' + engine + '\n', '\n' + sanitize + '\n', '\n' + app + '\n']
scripts = ''.join('<script>' + x + '</script>\n' for x in inline_scripts)

# 1) Artifact page: content only; the publisher wraps it in its own skeleton. The home-screen
#    icon is published next to the page (icon-180.png) and the link tags are hoisted into <head>
#    at runtime so Safari's Add to Home Screen finds them.
icon_tags = (
    '<link rel="apple-touch-icon" href="icon-180.png">\n'
    '<link rel="icon" type="image/png" href="icon-180.png">\n'
    '<meta name="apple-mobile-web-app-title" content="Readyset">\n'
    '<meta name="apple-mobile-web-app-capable" content="yes">\n'
    '<meta name="apple-mobile-web-app-status-bar-style" content="black">\n'
    '<script>(function(){try{var h=document.head;["link[rel=apple-touch-icon]","link[rel=icon]","meta[name=apple-mobile-web-app-title]","meta[name=apple-mobile-web-app-capable]","meta[name=apple-mobile-web-app-status-bar-style]"].forEach(function(s){var e=document.querySelector("body "+s);if(e&&h)h.appendChild(e);});}catch(e){}})();</script>\n'
)
with open(os.path.join(ROOT, 'readyset.html'), 'w', encoding='utf-8', newline='\n') as f:
    f.write(head_common + icon_tags + body + scripts)

# 2) Standalone PWA.
sw_reg_js = """
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(() => {}); });
}
"""
sw_reg = '<script>' + sw_reg_js + '</script>\n'
import hashlib, base64
def sha(x): return "'sha256-" + base64.b64encode(hashlib.sha256(x.encode('utf-8')).digest()).decode() + "'"
script_hashes = ' '.join(sha(x) for x in inline_scripts + [sw_reg_js])
# Every inline script is hashed, so an injected <script> or on* attribute cannot run. Styles keep
# 'unsafe-inline' for the few style="" attributes (no script risk). Network: Google Fonts only.
csp = ("default-src 'self'; script-src " + script_hashes + "; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
       "font-src https://fonts.gstatic.com; img-src 'self'; connect-src 'self'; "
       "manifest-src 'self'; worker-src 'self'; child-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'")

index = (
    '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
    '<meta http-equiv="Content-Security-Policy" content="' + csp + '">\n'
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
    '<meta name="apple-mobile-web-app-capable" content="yes">\n'
    '<meta name="mobile-web-app-capable" content="yes">\n'
    # Solid status bar: iOS places the app below it. With 'black-translucent' some iOS versions size
    # the app as screen minus status bar but draw it from the top edge, leaving that much unusable
    # space under the tab bar. Either way the layout only ever uses the height iOS reports.
    '<meta name="apple-mobile-web-app-status-bar-style" content="black">\n'
    '<meta name="apple-mobile-web-app-title" content="Readyset">\n'
    '<meta name="theme-color" content="#0f1216" media="(prefers-color-scheme: dark)">\n'
    '<meta name="theme-color" content="#eceef1" media="(prefers-color-scheme: light)">\n'
    '<link rel="manifest" href="./manifest.webmanifest">\n'
    '<link rel="apple-touch-icon" href="./icon-180.png">\n'
    '<link rel="icon" href="./icon-192.png">\n'
    '<meta name="readyset-build" content="__BUILD__">\n'
    + head_common +
    '</head>\n<body>\n' + body + scripts + sw_reg + '</body>\n</html>\n'
)
manifest = ('{"name":"Readyset","short_name":"Readyset","start_url":"./index.html","scope":"./","display":"standalone",'
            '"background_color":"#0f1216","theme_color":"#d9530e",'
            '"icons":[{"src":"icon-192.png","sizes":"192x192","type":"image/png"},{"src":"icon-512.png","sizes":"512x512","type":"image/png"}]}')

SW_TEMPLATE = """const CACHE = 'readyset-' + BUILD;
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
// Rest-timer alert. iOS freezes this worker with the page soon after Readyset leaves the screen,
// so a banner can only go out in the first seconds after you switch away; on screen, the page chimes
// instead. The worker is the only one that posts a banner, once per deadline: a page awake in the
// background only tells it the rest is due. The deadline is kept on disk, so a restarted worker (or
// the next build's) still has it. Thawed more than 5 s late means you are back and the page says so.
// iOS ignores notification tags, so two showNotification calls are always two banners.
const REST_CACHE = 'readyset-rest', REST_KEY = './__rest__';
let restTimer = null, restDone = null, restShown = 0;
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
  if (m.type === 'rest-schedule' && m.at) { const r = { at: +m.at, body: String(m.body || 'Next set').slice(0, 80) }; if (restShown !== r.at) p = restSave(r).then(() => restArm(r)); }
  else if (m.type === 'rest-due' && m.at) { restArm(null); p = restFire({ at: +m.at, body: m.body }, true); }
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
"""

# The build id covers everything a phone could be running: page, worker and manifest. An unchanged
# build keeps its id, so phones only reload for real changes.
build_id = hashlib.sha256((index + SW_TEMPLATE + manifest).encode('utf-8')).hexdigest()[:12]
index = index.replace('__BUILD__', build_id)
with open(os.path.join(DIST, 'index.html'), 'w', encoding='utf-8', newline='\n') as f:
    f.write(index)
with open(os.path.join(DIST, 'manifest.webmanifest'), 'w', encoding='utf-8', newline='\n') as f:
    f.write(manifest)
with open(os.path.join(DIST, 'version.txt'), 'w', encoding='utf-8', newline='\n') as f:
    f.write(build_id + '\n')
with open(os.path.join(DIST, 'sw.js'), 'w', encoding='utf-8', newline='\n') as f:
    f.write("const BUILD = '" + build_id + "';\n" + SW_TEMPLATE)

# 3) Icons: a loaded barbell (sleeves, collars, three plates a side) in cream on a warm orange
#    ground, full-bleed (iOS and Android apply their own corner masks). Rendered with 3x
#    supersampling so the edges are smooth, written as a raw PNG (no image libraries needed).
def png(size, path):
    SS = 3
    N = size * SS
    bg_top, bg_bot = (237, 104, 46), (206, 74, 14)
    cream, shade = (255, 245, 233), (246, 220, 196)
    def rrect(x0, y0, x1, y1, r):
        return (x0 * N, y0 * N, x1 * N, y1 * N, r * N)
    # Geometry in unit coordinates (mirrored for the right side).
    bar_h = 0.040
    shapes = []  # (rect, color), painted in order
    shapes.append((rrect(0.055, 0.5 - 0.028, 0.945, 0.5 + 0.028, 0.02), shade))   # sleeves (slightly thicker)
    shapes.append((rrect(0.30, 0.5 - bar_h / 2, 0.70, 0.5 + bar_h / 2, 0.015), cream))  # shaft
    plates = [(0.240, 0.312, 0.235), (0.168, 0.228, 0.185), (0.112, 0.156, 0.135)]  # (x0, x1, half-height)
    for x0, x1, hh in plates:
        shapes.append((rrect(x0, 0.5 - hh, x1, 0.5 + hh, 0.012), cream))
        shapes.append((rrect(1 - x1, 0.5 - hh, 1 - x0, 0.5 + hh, 0.012), cream))
    shapes.append((rrect(0.318, 0.5 - 0.055, 0.342, 0.5 + 0.055, 0.008), shade))  # collars
    shapes.append((rrect(0.658, 0.5 - 0.055, 0.682, 0.5 + 0.055, 0.008), shade))
    def inside(px, py, rect):
        x0, y0, x1, y1, r = rect
        if px < x0 or px > x1 or py < y0 or py > y1: return False
        cx = min(max(px, x0 + r), x1 - r); cy = min(max(py, y0 + r), y1 - r)
        return (px - cx) ** 2 + (py - cy) ** 2 <= r * r
    rows = []
    for y in range(size):
        acc = [[0, 0, 0] for _ in range(size)]
        for sy in range(SS):
            py = y * SS + sy + 0.5
            t = py / N
            bg = tuple(int(bg_top[i] + (bg_bot[i] - bg_top[i]) * t) for i in range(3))
            for x in range(size):
                for sx in range(SS):
                    px = x * SS + sx + 0.5
                    c = bg
                    for rect, col in shapes:
                        if inside(px, py, rect): c = col
                    a = acc[x]; a[0] += c[0]; a[1] += c[1]; a[2] += c[2]
        row = bytearray([0])
        for x in range(size):
            a = acc[x]; row += bytes((a[0] // (SS * SS), a[1] // (SS * SS), a[2] // (SS * SS)))
        rows.append(bytes(row))
    raw = b''.join(rows)
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    with open(path, 'wb') as f: f.write(data)

for s in (180, 192, 512):
    png(s, os.path.join(DIST, f'icon-{s}.png'))


# Self-check: every inline script in the written file must hash to a value in its CSP, byte for byte.
import re as _re
_html = open(os.path.join(DIST, 'index.html'), 'rb').read()
_csp = _re.search(rb'Content-Security-Policy" content="([^"]*)"', _html).group(1).decode()
for _m in _re.finditer(rb'<script>(.*?)</script>', _html, _re.S):
    _h = "'sha256-" + base64.b64encode(hashlib.sha256(_m.group(1)).digest()).decode() + "'"
    assert _h in _csp, 'CSP hash mismatch for an inline script (line endings?)'
assert b'\r' not in _html, 'CRLF found in docs/index.html'
# A size budget: this file is downloaded once per update and parsed on every reopen.
import gzip as _gzip
assert len(_html) < 450 * 1024 and len(_gzip.compress(_html)) < 135 * 1024, 'docs/index.html is over its size budget'

print('built readyset.html (%d KB) and docs/index.html (%d KB)' % (os.path.getsize(os.path.join(ROOT, 'readyset.html')) // 1024, os.path.getsize(os.path.join(DIST, 'index.html')) // 1024))
