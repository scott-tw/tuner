// Service Worker：離線快取
//
// 策略：先用快取（開啟快、離線可用），同時在背景向網路確認是否有新版，有就更新快取，
// 下一次開啟時就是新版本。新增檔案時，請把它加進下面的 FILES，並把 CACHE 的版本號加一。

const CACHE = 'tuner-v3';
const FILES = [
  './',
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/audio.js',
  'js/graph.js',
  'js/metronome.js',
  'js/notation.js',
  'js/pitch.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
  'tools/test-tone.html',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// 用 ETag／Last-Modified 判斷檔案是否有新版
const versionTag = (res) => res.headers.get('etag') || res.headers.get('last-modified') || '';

// 背景下載到新版檔案時通知畫面（畫面會顯示「點這裡更新」）
async function notifyUpdated() {
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach((c) => c.postMessage({ type: 'updated' }));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      // 網址帶 ?xxx 或 #xxx 時也對應到同一個檔案
      const key = req.url.split('#')[0].split('?')[0];
      const cached = await cache.match(key);
      const update = fetch(req, { cache: 'no-cache' })
        .then((res) => {
          if (res.ok) {
            cache.put(key, res.clone());
            if (cached && versionTag(res) !== versionTag(cached)) notifyUpdated();
          }
          return res;
        })
        .catch(() => null);
      if (cached) {
        event.waitUntil(update);
        return cached;
      }
      return (await update) || new Response('離線中，而且這個檔案還沒有存到手機上。', {
        status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }),
  );
});
