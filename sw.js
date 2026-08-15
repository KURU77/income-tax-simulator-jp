/* オフラインでも開けるようにするための Service Worker。
   本体を更新したら CACHE の版数を上げること。

   画面はキャッシュを先に返し、裏でサーバーに確認する（stale-while-revalidate）。
   こうすると圏外でも、電波が弱くて応答が返らない場所でも、待たされずに開ける。
   新しい版が見つかったときはページへ知らせ、利用者が再読み込みできるようにする。 */
const CACHE = 'shotoku-sim-v11';
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
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return Promise.all(ASSETS.map(function (u) {
        return fetch(u, { cache: 'reload' })
          .then(function (r) { if (r && r.ok) return c.put(u, r); })
          .catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) { return k === CACHE ? null : caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

/** 取り直した本体が、いま表示しているものと違うならページへ知らせる */
function notifyIfNew(fresh, cached) {
  if (!fresh || !fresh.ok || !cached) return;
  const a = fresh.headers.get('etag') || fresh.headers.get('last-modified');
  const b = cached.headers.get('etag') || cached.headers.get('last-modified');
  if (!a || !b || a === b) return;
  return self.clients.matchAll({ type: 'window' }).then(function (list) {
    list.forEach(function (client) { client.postMessage({ type: 'update-ready' }); });
  });
}

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
    const keyHref = key.href;

    const cachedP = caches.match(keyHref).then(function (hit) {
      return hit || caches.match(INDEX);   // 未知のパスは本体を返す
    });
    const freshP = fetch(req, { cache: 'no-cache' }).then(function (res) {
      if (res && res.ok) {
        const copy = res.clone();
        return caches.open(CACHE)
          .then(function (c) { return c.put(keyHref, copy); })
          .then(function () { return res; });
      }
      return res;
    });

    // 裏での更新確認。waitUntil はイベント処理中に同期で渡す必要がある
    e.waitUntil(
      Promise.all([cachedP, freshP.catch(function () { return null; })])
        .then(function (r) { return notifyIfNew(r[1], r[0]); })
        .catch(function () {})
    );

    // キャッシュがあれば即返す。初回だけネットワークを待つ
    e.respondWith(
      cachedP.then(function (cached) {
        if (cached) return cached;
        return freshP.catch(function () { return caches.match(INDEX); });
      })
    );
    return;
  }

  // アイコンなどはキャッシュを優先する
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
