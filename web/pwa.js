/* 注册 Service Worker（PWA「加到桌面」用）。仅在 http/https 下注册。 */
(function () {
  if (!('serviceWorker' in navigator)) { return; }
  if (location.protocol !== 'http:' && location.protocol !== 'https:') { return; }
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function () { /* 注册失败不影响使用 */ });
  });
})();
