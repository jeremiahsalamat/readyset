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

print('built readyset.html (%d KB) and docs/index.html (%d KB)' % (os.path.getsize(os.path.join(ROOT, 'readyset.html')) // 1024, os.path.getsize(os.path.join(DIST, 'index.html')) // 1024))
