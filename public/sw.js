// 앱 화면만 저장해 두고 인터넷이 끊겨도 열리게 한다. /api 는 절대 캐시하지 않는다.
const CACHE = 'findme-v34';
const SHELL = ['/', '/index.html', '/style.css', '/icon.svg', '/manifest.webmanifest',
  '/js/app.js', '/js/api.js', '/js/box.js', '/js/crypto.js', '/js/map.js', '/js/ui.js', '/js/write.js', '/js/human.js', '/js/recovery.js', '/js/theme.js', '/js/kbd.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // 저장본을 먼저 보여 주고(느린 인터넷에서도 바로 열리게), 뒤에서 새 버전을 받아 둔다.
  // 지도 프로그램처럼 처음 보는 파일은 받은 뒤 저장한다.
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const key = url.pathname === '/' ? '/index.html' : e.request;
      const cached = await cache.match(key);
      const fresh = fetch(e.request)
        .then((res) => {
          if (res.ok) cache.put(key, res.clone());
          return res;
        })
        .catch(() => null);
      if (cached) {
        e.waitUntil(fresh);
        return cached;
      }
      return (await fresh) || (await cache.match('/index.html')) || Response.error();
    })
  );
});
