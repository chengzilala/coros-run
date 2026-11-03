/* 统一账户中心接入 —— 本站**唯一**登录入口
 *
 * 登录 = 账户中心（account.chesterlee.cn）；登录回来后自动换取 CloudBase 登录态，
 * 看板 / 高驰同步 / AI Key 全部照旧按本站 uid 取数，不改任何云函数业务逻辑。
 *
 * 身份桥：前端拿 ps_token 调云函数 ps-login → 服务端向账户中心验身份 → 签 CloudBase
 *         自定义登录票 → 前端 signInWithCustomTicket 完成登录。
 *
 * 历史数据：第一次换票时如果当前还处于**旧本站会话**，云函数会把旧 uid 记成这个统一账户的
 *           CloudBase uid（ps_uid_map），所以旧数据一条不丢。
 *
 * 边界（硬性）：账户中心只提供身份。高驰 Token、训练数据、AI Key 一概不传。
 *
 * 降级：账户中心不可用 / 换票失败时，入口照常可点，本站旧登录页（login.html）仍可直连使用。
 * 本机（127.0.0.1 / localhost）：不接管，保持旧登录方式，避免静默跳转打断调试。
 */
(function () {
  'use strict';

  var PRODUCT_ID = 'coros-run';
  // 简笔图标（与全站图标同一套线条：单线 / 圆头 / 无填充）
  var USER_ICO = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.6"/><path d="M4.8 20.2c.6-3.6 3.6-5.6 7.2-5.6s6.6 2 7.2 5.6"/></svg>';
  var KEY_ICO = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="8.4" cy="8.4" r="4.1"/><path d="M11.4 11.4L20 20M16.6 16.6l-1.8 1.8M18.6 18.6l-1.8 1.8"/></svg>';
  /** 图标 + 文字（文字走 textNode，昵称不拼 HTML） */
  function paintIconText(el, ico, text) {
    el.innerHTML = ico;
    el.appendChild(document.createTextNode(' ' + text));
  }
  var ACCOUNT_WEB = 'https://account.chesterlee.cn';
  var TICKET_API = 'https://coros-run-d0g0acnksda36ca62.service.tcloudbase.com/ps-login';
  var SDK_SRC = 'assets/js/ps-auth.js';
  var TOKEN_KEY = 'ps_token';        // 与 ps-auth.js 一致：统一账户登录态存本域 localStorage
  var BRIDGE_KEY = 'coros_ps_bridged'; // 已废弃，仅保留 key 名供退出时清理存量
  var JUST_KEY = 'coros_ps_just_bridged'; // 刚换完票、页面即将刷新（防来回刷新）
  var bridgeFailed = false; // 本次页面换票失败过（避免同一页反复重试）

  var sdk = null;
  var unifiedUser = null;

  // 让别的脚本（app.js 的「未登录跳官网」）能等到换票结束再跳，避免打断一次性票据
  var settledDone = false;
  var settledResolve = null;
  var settled = new Promise(function (resolve) { settledResolve = resolve; });
  function markSettled() {
    if (settledDone) { return; }
    settledDone = true;
    try { settledResolve(); } catch (e) { /* 忽略 */ }
  }

  function isLocal() {
    return /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  }

  function hasToken() {
    try { return Boolean(localStorage.getItem(TOKEN_KEY)); } catch (e) { return false; }
  }

  function hasTicket() {
    try { return new URL(location.href).searchParams.has('ps_ticket'); } catch (e) { return false; }
  }

  function loginUrl(back) {
    return ACCOUNT_WEB + '/login.html?productId=' + encodeURIComponent(PRODUCT_ID)
      + '&returnUrl=' + encodeURIComponent(back)
      + '&theme=light&accent=' + encodeURIComponent('#f2620a');
  }

  function accountUrl() {
    return ACCOUNT_WEB + '/account.html';
  }

  /** 按需加载 SDK（ps-auth.js 整文件来自账户中心，不手改） */
  function loadSdk() {
    if (window.__corosPsSdk) { return window.__corosPsSdk; }
    window.__corosPsSdk = new Promise(function (resolve) {
      var script = document.createElement('script');
      script.src = SDK_SRC;
      script.onload = function () {
        if (!window.PSAuth) { resolve(null); return; }
        window.PSAuth.init({
          apiBase: ACCOUNT_WEB,
          loginUrl: ACCOUNT_WEB + '/login.html',
          productId: PRODUCT_ID
        });
        resolve(window.PSAuth);
      };
      script.onerror = function () { resolve(null); };
      document.head.appendChild(script);
    });
    return window.__corosPsSdk;
  }

  /** 用旧本站会话调云函数（能带旧 uid 做迁移绑定）；没有旧会话就走 HTTP 接口 */
  function fetchTicket() {
    var A = window.CorosAuth;
    var token = '';
    try { token = localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { token = ''; }

    var legacy = (A && A.current)
      ? A.current().then(function (u) { return Boolean(u && u.uid); }, function () { return false; })
      : Promise.resolve(false);

    return legacy.then(function (hasLegacy) {
      if (hasLegacy && A && A.callFunction) {
        return A.callFunction('ps-login', { token: token }).then(function (r) {
          if (r && r.ok && r.ticket) { return r.ticket; }
          throw new Error((r && (r.message || r.error)) || 'ps-login 没有返回票据');
        });
      }
      return fetch(TICKET_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token })
      }).then(function (res) {
        return res.json().catch(function () { return null; });
      }).then(function (j) {
        if (j && j.ok && j.ticket) { return j.ticket; }
        throw new Error((j && j.message) || '取票接口不可用');
      });
    });
  }

  /** 换票失败时回报给云函数记账（不带 token），便于线上定位是哪一步挂了 */
  function report(kind, err) {
    try {
      fetch(TICKET_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          report: kind,
          message: String((err && err.message) || err || '').slice(0, 300)
        })
      });
    } catch (e) { /* 忽略 */ }
  }

  /** 把统一账户换成 CloudBase 登录态；换成功返回 true（调用方负责刷新页面） */
  function bridge() {
    var A = window.CorosAuth;
    if (!A || !A.signInWithTicket) { report('NO_SIGNIN_API', 'CorosAuth.signInWithTicket 不存在'); return Promise.resolve(false); }
    // 本次页面已经失败过就不再重试（防止刷新循环）；换页/刷新会重新给一次机会
    if (bridgeFailed) { report('BRIDGE_SKIP', '本次页面已失败过'); return Promise.resolve(false); }

    // 上一页刚换成功、正在刷新：先信一次会话，别因为 current() 判断不准又换一遍
    try {
      if (sessionStorage.getItem(JUST_KEY) === '1') {
        sessionStorage.removeItem(JUST_KEY);
        return Promise.resolve(false);
      }
    } catch (e) { /* 忽略 */ }

    // 本站已有会话就不用再换：以实际登录态为准（不再用一次性标记，避免标记残留导致永远跳过）
    var logged = A.current ? A.current() : Promise.resolve(null);
    return logged.then(function (u) {
      if (u && u.uid) { return false; }
      return fetchTicket().then(function (ticket) {
        return A.signInWithTicket(ticket);
      }).then(function () {
        // 必须回读一次真实登录态：票据接口可能“成功”但会话没建立
        return A.current ? A.current() : Promise.resolve(null);
      }).then(function (u) {
        if (!u || !u.uid) { throw new Error('票据已换取，但本站登录态没建立'); }
        try { sessionStorage.setItem(JUST_KEY, '1'); } catch (e) { /* 忽略 */ }
        return true;
      }).catch(function (err) {
        bridgeFailed = true;
        report('BRIDGE_FAILED', err);
        console.warn('[统一账户] 换本站登录态失败：' + ((err && err.message) || err));
        return false;
      });
    }, function () { return false; });
  }

  /** 顶部按钮：统一账户已登录显示昵称，未登录显示「登录」 */
  function paintEntry() {
    var btn = document.getElementById('loginEntry');
    if (btn) {
      if (unifiedUser) {
        paintIconText(btn, USER_ICO, unifiedUser.nickname || '已登录');
        btn.href = accountUrl();
        btn.title = '已登录统一账户（点击查看 / 退出）';
      } else {
        btn.textContent = '登录';
        btn.href = loginUrl(location.origin + location.pathname);
        btn.title = '统一账户登录（一处登录，各作品通用）';
      }
    }
    var acctLogin = document.getElementById('acctLogin');
    if (acctLogin) {
      // 账户页的「登录 / 注册」也指向统一账户（本机不接管，仍是旧登录页）
      acctLogin.href = unifiedUser
        ? accountUrl()
        : loginUrl(location.origin + '/account.html');
    }
    Array.prototype.forEach.call(document.querySelectorAll('[data-ps-account]'), function (el) {
      paintIconText(el, unifiedUser ? USER_ICO : KEY_ICO, unifiedUser ? (unifiedUser.nickname || '统一账户') : '统一账户');
      el.href = unifiedUser ? accountUrl() : loginUrl(location.origin + location.pathname);
      el.hidden = false;
      el.style.display = '';
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-ps-account-state]'), function (el) {
      el.textContent = unifiedUser
        ? '已登录统一账户：' + (unifiedUser.nickname || unifiedUser.uid || '')
        : '未登录。本站的登录就是统一账户登录，登录后本站在内的各作品通用。';
    });
  }

  /** 本机：不接管登录，仍用旧登录页 */
  function localMode() {
    var A = window.CorosAuth;
    if (!A) { return; }
    A.current().then(function (u) {
      var btn = document.getElementById('loginEntry');
      if (!btn) { return; }
      if (!u) {
        btn.textContent = '登录';
        btn.href = 'login.html?next=./';
        btn.title = '邮箱验证码登录';
        return;
      }
      var name = String(u.name || '').trim() || String(u.email || '').split('@')[0] || '已登录';
      paintIconText(btn, USER_ICO, name);
      btn.href = 'login.html?next=./';
      btn.title = '已登录：' + (u.email || u.uid || '') + '（点击查看 / 退出登录）';
    }, function () { /* 忽略 */ });
  }

  function start() {
    if (isLocal()) { localMode(); markSettled(); return; }

    // 先画入口（未登录态），保证首屏可点
    paintEntry();

    if (!hasToken() && !hasTicket()) { markSettled(); return; }

    loadSdk().then(function (s) {
      sdk = s;
      if (!sdk) { markSettled(); return; }
      return sdk.getUser().then(function (user) {
        unifiedUser = user;
        paintEntry();
        if (!user) { markSettled(); return; }
        return bridge().then(function (switched) {
          // 换票成功必须先刷新：一旦 markSettled()，app.js 会立刻 replace 到 landing.html，
          // 抢在 reload 前面把刚换好的登录态冲掉。
          if (switched) { location.reload(); return; }
          markSettled();
        });
      }, function () { markSettled(); /* 账户中心不可用：保持未登录入口 */ });
    }).catch(function () { markSettled(); });
  }

  /** 供其它脚本（如账户页退出登录）调用 */
  window.CorosPS = {
    managed: true,
    getUser: function () { return unifiedUser; },
    /** 等本次换票/登录态判断结束（无票据时立刻 resolve） */
    whenSettled: function () { return settled; },
    logout: function () {
      // 先调账户中心注销（SDK 需要当前 Token），再清本地状态
      var p = (sdk && sdk.logout) ? sdk.logout() : Promise.resolve();
      return p.catch(function () { /* 忽略 */ }).then(function () {
        try {
          localStorage.removeItem(BRIDGE_KEY);
          localStorage.removeItem(TOKEN_KEY);
        } catch (e) { /* 忽略 */ }
      });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
