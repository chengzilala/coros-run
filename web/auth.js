/* 对外版登录封装：CloudBase 邮箱验证码（window.CorosAuth）
 *
 * 心智：邮箱即身份，发 6 位验证码 → 验码 → 登录/注册一体（新邮箱自动注册）。
 *
 * 两种模式，只改下面的 MODE：
 *   'proxy'（当前）：经**本机服务中转**。浏览器只跟本机服务说话，由本机服务去调
 *                    CloudBase 认证接口——服务端调用不校验来源域名，免费体验版可用。
 *   'sdk'          ：浏览器直连 CloudBase SDK。需先把域名加进「WEB 安全域名」
 *                    （免费体验版不支持添加，升级套餐后再切）。
 *
 * 为什么单独一份：本机自用版用「账户码」，对外版用「邮箱验证码」，
 * 两套并存、互不影响——本机版页面保持不动，对外版走本文件。
 */
window.CorosAuth = (function () {
  var MODE = 'sdk';

  var ENV_ID = 'coros-run-d0g0acnksda36ca62';
  // 地域：控制台「环境 → 概览」里显示的地域。默认上海；若登录报地域错误，改成 ap-guangzhou 等。
  var REGION = 'ap-shanghai';
  // 应用 clientId：一般留空即可；若控制台「身份认证」里给了 clientId，填这里。
  var CLIENT_ID = '';

  var TOKEN_KEY = 'coros_cb_token';   // 登录后拿到的 access_token（只存本机）
  var EMAIL_KEY = 'coros_cb_email';
  var PW_FLAG = 'coros_cb_has_pw';    // 本机记录「已设过密码」，避免每次登录都引导设密码

  var app = null;   // CloudBase 应用实例
  var auth = null;  // 认证对象
  var pendingVerificationId = '';  // 发码后暂存，验码时回传
  var pendingIsUser = false;       // 该邮箱是否已注册（发码时得知）

  // ---------- 公共小工具 ----------
  function api(path) {
    var S = window.CorosStore;
    return (S && S.apiUrl) ? S.apiUrl(path) : path;
  }

  function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }

  function lsSet(k, v) {
    try { if (v) { localStorage.setItem(k, v); } else { localStorage.removeItem(k); } } catch (e) { /* 忽略 */ }
  }

  /** 本机是否已设过密码（仅用于决定要不要再引导"设密码"，不涉及真实校验） */
  function markHasPassword(v) { lsSet(PW_FLAG, v ? '1' : ''); }
  function hasPasswordFlag() { return lsGet(PW_FLAG) === '1'; }

  /** 把各类错误对象统一成一句人话 */
  function humanError(e) {
    if (!e) { return '未知错误'; }
    if (typeof e === 'string') { return e; }
    return e.error_description || e.message || e.error || (e.data && e.data.message) || JSON.stringify(e);
  }

  // ================= 模式一：本机服务中转 =================
  function relay(path, payload) {
    return fetch(api(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    }).then(function (r) {
      return r.json().catch(function () { return {}; });
    }).then(function (j) {
      if (j && j.error) { throw new Error(j.error); }
      return j || {};
    }, function (e) {
      throw new Error('本机服务请求失败：' + humanError(e) + '（本机服务在跑吗？）');
    });
  }

  function proxySendCode(email) {
    return relay('/api/cloud/send-code', { email: email }).then(function (r) {
      pendingIsUser = !!r.isUser;
      return { isUser: pendingIsUser };
    });
  }

  function proxySignIn(email, code) {
    var S = window.CorosStore;
    return relay('/api/cloud/login', {
      email: email,
      code: code,
      device: (S && S.getDeviceId) ? S.getDeviceId() : ''
    }).then(function (r) {
      lsSet(TOKEN_KEY, r.accessToken || '');
      lsSet(EMAIL_KEY, email);
      return { isNewUser: !!r.isNewUser, uid: r.uid || '' };
    });
  }

  function proxyCurrent() {
    var token = lsGet(TOKEN_KEY);
    if (!token) { return Promise.resolve(null); }
    return fetch(api('/api/cloud/me'), { headers: { 'x-access-token': token } })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.user) { lsSet(TOKEN_KEY, ''); return null; }
        return {
          uid: j.user.uid || '',
          email: j.user.email || lsGet(EMAIL_KEY),
          name: j.user.name || ''
        };
      })
      .catch(function () { return null; });
  }

  function proxySignOut() {
    lsSet(TOKEN_KEY, '');
    lsSet(EMAIL_KEY, '');
    return Promise.resolve();
  }

  // ================= 模式二：浏览器直连 SDK =================
  /** 惰性初始化：首次调用时才建实例，避免 SDK 未就绪时报错 */
  function ready() {
    if (auth) { return auth; }
    if (!window.cloudbase) { throw new Error('CloudBase SDK 未加载（web/lib/cloudbase.full.js）'); }
    var opts = { env: ENV_ID, timeout: 120000 };  // 抓数同步较慢，客户端超时放宽到 120s
    if (REGION) { opts.region = REGION; }
    if (CLIENT_ID) { opts.clientId = CLIENT_ID; }
    app = window.cloudbase.init(opts);
    auth = app.auth();
    return auth;
  }

  /** 统一入口：把「取实例」也放进 Promise，任何同步异常都变成可捕获的 reject */
  function run(fn) {
    return Promise.resolve().then(function () { return fn(ready()); })
      .catch(function (e) { throw new Error(humanError(e)); });
  }

  function sdkSendCode(email) {
    return run(function (a) {
      return a.getVerification({ email: email }).then(function (res) {
        pendingVerificationId = (res && res.verification_id) || '';
        pendingIsUser = !!(res && res.is_user);
        if (!pendingVerificationId) { throw new Error('未拿到验证码 ID，请重试'); }
        return { isUser: pendingIsUser };
      });
    });
  }

  /** 由邮箱派生一个合法用户名（6–25 位，首字符必须小写字母，其余允许小写字母/数字/_/-） */
  function deriveUsername(email) {
    var base = String(email).split('@')[0].toLowerCase().replace(/[^0-9a-z_-]/g, '');
    if (!/^[a-z]/.test(base)) { base = 'u' + base; }
    if (base.length < 6) { base = (base + 'user0000').slice(0, 6); }
    base = base.slice(0, 18);
    return base + Math.floor(Math.random() * 9000 + 1000);
  }

  function sdkSignIn(email, code) {
    if (!pendingVerificationId) { return Promise.reject(new Error('请先点「发送验证码」')); }
    var vid = pendingVerificationId;
    var isUser = pendingIsUser;
    return run(function (a) {
      return a.verify({ verification_id: vid, verification_code: code }).then(function (vt) {
        var token = vt && vt.verification_token;
        if (!token) { throw new Error('验证码校验未通过，请重新获取'); }
        // 发码时已判过是否已注册：已注册→登录；未注册→注册（注册成功即自动登录）
        if (isUser) {
          return a.signIn({ username: email, verification_token: token }).then(function () { return { isNewUser: false }; });
        }
        return a.signUp({
          email: email,
          verification_code: code,
          verification_token: token,
          username: deriveUsername(email)
        }).then(function () { return { isNewUser: true }; });
      });
    });
  }

  /** 邮箱/用户名 + 密码登录（需先在控制台开启「用户名密码登录」）；account 可填邮箱或自定义用户名 */
  function sdkSignInPassword(account, password) {
    return run(function (a) {
      var req = { username: account, password: password };
      // signInWithPassword 是新版别名，老 SDK 只有 signIn；两者等价
      var p = (typeof a.signInWithPassword === 'function') ? a.signInWithPassword(req) : a.signIn(req);
      return Promise.resolve(p).then(function () { markHasPassword(true); return {}; });
    });
  }

  /** 绑定自定义用户名：改用户名走「修改用户基础信息」接口（user/basic/edit，官方支持改 username 的那个） */
  function bindUsername(a, username) {
    // 先查重：占用→友好报错；查询不可用/失败→不拦，交给服务端最终判定
    var chk = null;
    try { chk = (typeof a.isUsernameRegistered === 'function') ? a.isUsernameRegistered(username) : null; } catch (e) { chk = null; }
    return Promise.resolve(chk).then(function (used) {
      if (used === true) { throw new Error('该用户名已被占用，请换一个'); }
    }, function () { /* 忽略查询失败 */ }).then(function () {
      if (typeof a.updateUserBasicInfo === 'function') { return a.updateUserBasicInfo({ username: username }); }
      if (a.currentUser && typeof a.currentUser.updateUserBasicInfo === 'function') { return a.currentUser.updateUserBasicInfo({ username: username }); }
      if (a.currentUser && typeof a.currentUser.updateUsername === 'function') { return a.currentUser.updateUsername(username); }
      throw new Error('当前登录态无法改用户名');
    });
  }

  /** 设置 / 重置用户名与密码（复用邮箱验证码验证身份） */
  function sdkSetPassword(email, code, newPassword, username) {
    if (!pendingVerificationId) { return Promise.reject(new Error('请先点「发送验证码」')); }
    var vid = pendingVerificationId;
    var isUser = pendingIsUser;
    return run(function (a) {
      return a.verify({ verification_id: vid, verification_code: code }).then(function (vt) {
        var token = vt && vt.verification_token;
        if (!token) { throw new Error('验证码校验未通过，请重新获取'); }
        // 新用户：注册时就绑定用户名与密码（CloudBase 推荐口径），注册即登录
        if (!isUser) {
          return a.signUp({
            email: email,
            verification_code: code,
            verification_token: token,
            username: username || deriveUsername(email),
            password: newPassword
          }).then(function () { markHasPassword(true); return {}; });
        }
        // 老用户：先用验证码改密 → 用新密码登录 → 若填了用户名再改名
        return a.resetPassword({ email: email, new_password: newPassword, verification_token: token })
          .then(function () { return sdkSignInPassword(email, newPassword); })
          .then(function () {
            if (!username) { return; }
            return bindUsername(a, username).catch(function (e) {
              // 走到这里密码已设好、也已登录，只是用户名没写上——说清楚，别让人以为全失败
              throw new Error('密码已设置成功，但用户名未设置：' + humanError(e));
            });
          }).then(function () { return {}; });
      });
    });
  }

  function sdkCurrent() {
    return run(function (a) {
      return a.getLoginState().then(function (state) {
        if (!state) { return null; }
        var u = (state.user || state.User || {});
        return {
          uid: u.uid || u.Uid || u.openid || u.customUserId || '',
          email: u.email || '',
          username: u.username || '',
          name: u.name || u.nickName || '',
          raw: state
        };
      });
    }).catch(function () { return null; });
  }

  function sdkSignOut() {
    return run(function (a) { return a.signOut(); });
  }

  /** 用「自定义登录票据」登录（统一账户换来的 CloudBase 票据；无需邮箱验证码） */
  function sdkSignInWithTicket(ticket) {
    if (!ticket) { return Promise.reject(new Error('缺少登录票据')); }
    return run(function (a) {
      if (typeof a.signInWithCustomTicket !== 'function') {
        throw new Error('当前 CloudBase SDK 不支持自定义登录，请更新 web/lib/cloudbase.full.js');
      }
      // 该 SDK 要求传「返回票据的函数」；传字符串会静默失败（只在返回值 error 里体现）
      return a.signInWithCustomTicket(function () { return Promise.resolve(ticket); })
        .then(function (res) {
          if (res && res.error) { throw res.error; }
          return res;
        });
    });
  }

  function sdkCallFunction(name, data) {
    return run(function () {
      return app.callFunction({ name: name, data: data || {} }).then(function (res) {
        return (res && res.result) || res;
      });
    });
  }

  // ================= 对外统一接口 =================
  /** 第一步：给邮箱发验证码。返回 { isUser }（该邮箱是否已注册） */
  function sendCode(email) {
    return MODE === 'proxy' ? proxySendCode(email) : sdkSendCode(email);
  }

  /** 第二步：验码并登录/注册。返回 { isNewUser, uid } */
  function signInWithCode(email, code) {
    return MODE === 'proxy' ? proxySignIn(email, code) : sdkSignIn(email, code);
  }

  /** 邮箱 + 密码登录：返回 {} */
  function signInWithPassword(email, password) {
    if (MODE === 'proxy') { return Promise.reject(new Error('本机中转模式暂未接密码登录，请改用验证码登录')); }
    return sdkSignInPassword(email, password);
  }

  /** 设置 / 重置密码（可选同时设置自定义用户名，用邮箱验证码验证身份）：返回 {} */
  function setPassword(email, code, newPassword, username) {
    if (MODE === 'proxy') { return Promise.reject(new Error('本机中转模式暂未接设置密码，请改用验证码登录')); }
    return sdkSetPassword(email, code, newPassword, username);
  }

  /** 当前登录态：未登录返回 null；已登录返回 { uid, email, name } */
  function current() {
    return MODE === 'proxy' ? proxyCurrent() : sdkCurrent();
  }

  function signOut() {
    return MODE === 'proxy' ? proxySignOut() : sdkSignOut();
  }

  /** 调云函数（自动带上登录态）。name=函数名，data=入参对象 */
  function callFunction(name, data) {
    if (MODE === 'proxy') {
      return Promise.reject(new Error('本机中转模式还没接云函数调用，等下一步接上再测。'));
    }
    return sdkCallFunction(name, data);
  }

  return {
    MODE: MODE,
    ENV_ID: ENV_ID,
    REGION: REGION,
    sendCode: sendCode,
    signInWithCode: signInWithCode,
    signInWithPassword: signInWithPassword,
    setPassword: setPassword,
    hasPasswordFlag: hasPasswordFlag,
    current: current,
    signOut: signOut,
    signInWithTicket: sdkSignInWithTicket,
    callFunction: callFunction
  };
})();
