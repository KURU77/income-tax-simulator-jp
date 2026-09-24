/* オフラインでも開けるようにするための Service Worker。
   本体を更新したら CACHE の版数を上げること。それが更新の合図になる。

   画面はキャッシュから返す（オフラインでも、電波が弱い場所でも待たされない）。
   新しい版の配信に気づく役目は Service Worker の仕組みそのものに任せる。
   新しい sw.js を見つけたブラウザはそれを「待機中」にするので、
   ページ側はその状態を見て更新を知らせ、利用者が押したら差し替える。
   （以前はキャッシュとネットワークの ETag を比べていたが、
     同じ版でも通知が出ることがあり、押しても差し替わらなかった） */
const CACHE = 'shotoku-sim-v19';
const INDEX = './index.html';
const ASSETS = [
  './',
  INDEX,
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './privacy.html'
];

self.addEventListener('install', function (e) {
  // ブラウザのHTTPキャッシュを経由せず、必ず配信元から取り直して保存する。
  // 1つ取得できなくても導入は続ける（全部失敗扱いにするとオフライン対応が丸ごと効かなくなる）。
  // ここで skipWaiting はしない。待機させることが「新しい版がある」という合図になる。
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return Promise.all(ASSETS.map(function (u) {
        return fetch(u, { cache: 'reload' })
          .then(function (r) { if (r && r.ok) return c.put(u, r); })
          .catch(function () {});
      }));
    })
  );
});

// ページで「更新する」が押されたら、待機をやめて自分が引き継ぐ
self.addEventListener('message', function (e) {
  if (e.data && e.data.type === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) { return k === CACHE ? null : caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  if (req.mode === 'navigate') {
    // 開こうとしているページ自体を探す。プライバシーポリシーなど本体以外の
    // ページもあるため、ここで index.html を決め打ちしてはいけない。
    // クエリは無視して1つの鍵にまとめる（?v=... で別物として溜まるのを防ぐ）。
    const key = new URL(req.url);
    key.search = '';
    key.hash = '';

    e.respondWith(
      caches.match(key.href)
        .then(function (hit) { return hit || caches.match(INDEX); })   // 未知のパスは本体を返す
        .then(function (hit) {
          if (hit) return hit;
          return fetch(req).catch(function () { return caches.match(INDEX); });
        })
    );
    return;
  }

  // アイコンなどもキャッシュを優先する
  e.respondWith(
    caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) {
        if (res && res.ok) {
          const copy = res.clone();
          e.waitUntil(caches.open(CACHE).then(function (c) { return c.put(req, copy); }));
        }
        return res;
      });
    })
  );
});
