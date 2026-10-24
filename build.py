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
    with open(os.path.join(SRC, name), encoding='utf-8') as f:
        return f.read()

css, body, engine, app = read('styles.css'), read('body.html'), read('engine.js'), read('app.js')
FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Barlow:wght@400;500;600&display=swap">'

head_common = (
    '<title>Readyset</title>\n'
    '<meta name="claude:viewport-fit-sides" content="cover">\n'
    + FONTS + '\n<style>\n' + css + '\n</style>\n'
)
scripts = '<script>\n' + engine + '\n</script>\n<script>\n' + app + '\n</script>\n'

# 1) Artifact page: content only; the publisher wraps it in its own skeleton. The home-screen
#    icon is published next to the page (icon-180.png) and the link tags are hoisted into <head>
#    at runtime so Safari's Add to Home Screen finds them.
icon_tags = (
    '<link rel="apple-touch-icon" href="icon-180.png">\n'
    '<link rel="icon" type="image/png" href="icon-180.png">\n'
    '<meta name="apple-mobile-web-app-title" content="Readyset">\n'
    '<meta name="apple-mobile-web-app-capable" content="yes">\n'
    '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">\n'
    '<script>(function(){try{var h=document.head;["link[rel=apple-touch-icon]","link[rel=icon]","meta[name=apple-mobile-web-app-title]","meta[name=apple-mobile-web-app-capable]","meta[name=apple-mobile-web-app-status-bar-style]"].forEach(function(s){var e=document.querySelector("body "+s);if(e&&h)h.appendChild(e);});}catch(e){}})();</script>\n'
)
with open(os.path.join(ROOT, 'readyset.html'), 'w', encoding='utf-8') as f:
    f.write(head_common + icon_tags + body + scripts)

# 2) Standalone PWA.
sw_reg = """<script>
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => {}); });
}
</script>
"""
index = (
    '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
    '<meta name="apple-mobile-web-app-capable" content="yes">\n'
    '<meta name="mobile-web-app-capable" content="yes">\n'
    '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">\n'
    '<meta name="apple-mobile-web-app-title" content="Readyset">\n'
    '<meta name="theme-color" content="#0f1216" media="(prefers-color-scheme: dark)">\n'
    '<meta name="theme-color" content="#eceef1" media="(prefers-color-scheme: light)">\n'
    '<link rel="manifest" href="./manifest.webmanifest">\n'
    '<link rel="apple-touch-icon" href="./icon-180.png">\n'
    '<link rel="icon" href="./icon-192.png">\n'
    + head_common +
    '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}</style>\n'
    '</head>\n<body>\n' + body + scripts + sw_reg + '</body>\n</html>\n'
)
with open(os.path.join(DIST, 'index.html'), 'w', encoding='utf-8') as f:
    f.write(index)

with open(os.path.join(DIST, 'manifest.webmanifest'), 'w', encoding='utf-8') as f:
    f.write('{"name":"Readyset","short_name":"Readyset","start_url":"./index.html","scope":"./","display":"standalone",'
            '"background_color":"#0f1216","theme_color":"#d9530e",'
            '"icons":[{"src":"icon-192.png","sizes":"192x192","type":"image/png"},{"src":"icon-512.png","sizes":"512x512","type":"image/png"}]}')

with open(os.path.join(DIST, 'sw.js'), 'w', encoding='utf-8') as f:
    f.write("""const CACHE = 'readyset-v1';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-180.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then(r => { if (new URL(e.request.url).origin === location.origin) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); } return r; }).catch(() => caches.match(e.request).then(m => m || caches.match('./index.html'))));
});
""")

# 3) Icons: orange tile with a dark barbell glyph, written as raw PNG (no image libraries needed).
def png(size, path):
    bg = (217, 83, 14); fg = (20, 17, 14)
    rows = []
    cx = cy = size / 2
    bar_h = size * 0.07; bar_w = size * 0.70
    plate_w = size * 0.10; plate_h = size * 0.34; inner_w = size * 0.07; inner_h = size * 0.26
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            dx, dy = x - cx, y - cy
            # rounded square mask
            r = size * 0.22
            ax, ay = abs(dx) - (cx - r), abs(dy) - (cy - r)
            inside = (ax <= 0 or ay <= 0 or ax * ax + ay * ay <= r * r) and abs(dx) <= cx and abs(dy) <= cy
            if not inside:
                row += bytes((0, 0, 0)); continue
            c = bg
            if abs(dy) <= bar_h / 2 and abs(dx) <= bar_w / 2: c = fg
            if abs(dy) <= plate_h / 2 and bar_w / 2 - plate_w * 1.6 <= abs(dx) <= bar_w / 2 - plate_w * 0.6: c = fg
            if abs(dy) <= inner_h / 2 and bar_w / 2 - plate_w * 2.7 <= abs(dx) <= bar_w / 2 - plate_w * 2.0: c = fg
            row += bytes(c)
        rows.append(bytes(row))
    raw = b''.join(rows)
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    with open(path, 'wb') as f: f.write(data)

for s in (180, 192, 512):
    png(s, os.path.join(DIST, f'icon-{s}.png'))

print('built readyset.html (%d KB) and docs/index.html (%d KB)' % (os.path.getsize(os.path.join(ROOT, 'readyset.html')) // 1024, os.path.getsize(os.path.join(DIST, 'index.html')) // 1024))
