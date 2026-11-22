// 楊陽英文 閱讀單字 — offline service worker
const VER = 'yy-v8';
const SHELL = ['./', './index.html', './engine.js', './manifest.webmanifest', './lessons/index.json',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-180.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VER).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VER).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
async function fromCache(req) {
  const c = await caches.open(VER);
  const url = req.url.split('#')[0];
  let res = await c.match(url, { ignoreSearch: true });
  if (!res) {
    res = await fetch(url);
    if (res.ok && res.status === 200) await c.put(url, res.clone());
  }
  return res;
}
async function rangeResponse(req) {
  const full = await fromCache(new Request(req.url));
  const buf = await full.arrayBuffer();
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '');
  const size = buf.byteLength;
  let start = m && m[1] ? +m[1] : 0, end = m && m[2] ? +m[2] : size - 1;
  if (m && !m[1] && m[2]) { start = size - +m[2]; end = size - 1; }
  end = Math.min(end, size - 1);
  return new Response(buf.slice(start, end + 1), { status: 206, statusText: 'Partial Content', headers: {
    'Content-Type': full.headers.get('Content-Type') || 'audio/mpeg', 'Content-Range': `bytes ${start}-${end}/${size}`,
    'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes' } });
}
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const u = new URL(req.url);
  const same = u.origin === location.origin, font = /fonts\.(googleapis|gstatic)\.com$/.test(u.hostname);
  if (!same && !font) return;
  if (same && req.headers.get('range')) { e.respondWith(rangeResponse(req).catch(() => fetch(req))); return; }
  // app code + lesson list: network first so updates arrive, cache as fallback
  if (same && /(\/|index\.html|engine\.js|index\.json|manifest\.webmanifest)$/.test(u.pathname)) {
    e.respondWith(fetch(req).then(async r => { if (r.ok) (await caches.open(VER)).put(req.url.split('#')[0], r.clone()); return r; })
      .catch(() => caches.open(VER).then(c => c.match(req.url.split('#')[0], { ignoreSearch: true })).then(r => r || caches.match('./index.html'))));
    return;
  }
  // everything else (lessons, audio, pdf.js, fonts, icons): cache first
  e.respondWith(fromCache(req).catch(() => caches.match(req.url)));
});
