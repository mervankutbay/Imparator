// İmparator service worker: uygulama dosyaları önbellekten anında açılır, yenisi arkada iner. /api asla önbelleğe alınmaz.
const CACHE = 'imparator-v10';
const SHELL = ['./', './index.html', './style.css', './app.js', './hesap.js', './manifest.webmanifest', './img/aydin.png', './img/tac.svg', './img/icon-180.png', './img/icon-192.png', './img/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  const ag = fetch(e.request).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); } return r; });
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(o => { if (o) { e.waitUntil(ag.catch(() => {})); return o; } return ag.catch(() => caches.match('./index.html')); }));
});
