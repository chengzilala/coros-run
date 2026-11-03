/* Service Worker —— 只为满足「可安装」条件，不做离线缓存。
 *
 * 刻意保持「直通」：不缓存任何资源，避免开发/更新时看到旧文件。
 * 只保留一个 fetch 事件监听（PWA 可安装的必要条件）。
 */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function () { /* 直通浏览器默认网络请求，不缓存 */ });
