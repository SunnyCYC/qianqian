/* 離線可用：先上網拿最新版，連不上才用上次存下的。
 *
 * 只快取程式本身（同一個網站的檔案），帳本資料在 IndexedDB，跟這裡無關。
 * 匯率 API 不快取：舊匯率要由使用者在盤點時自己決定要不要沿用。
 */

const CACHE = "qianqian-v4";
const SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/base.css",
  "css/app.css",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "js/main.js",
  "js/api.js",
  "js/store.js",
  "js/util.js",
  "js/dialog.js",
  "js/core/money.js",
  "js/core/dates.js",
  "js/core/ledger.js",
  "js/core/assets.js",
  "js/core/cashflow.js",
  "js/core/wishlist.js",
  "js/ui/assets.js",
  "js/ui/cashflow.js",
  "js/ui/wishlist.js",
  "js/ui/ledgers.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  // no-cache：每次都向網站確認是不是最新版，否則瀏覽器會沿用最多 10 分鐘前的舊檔
  e.respondWith(
    fetch(e.request, { cache: "no-cache" })
      .then((resp) => {
        if (resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return resp;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
