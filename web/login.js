/* 对外版登录页逻辑：发码 → 验码登录/注册 → 显示登录态 → 测试云函数 */
(function () {
  var A = window.CorosAuth, U = window.CorosUI;

  function $(id) { return document.getElementById(id); }
  function show(text, ok) { $('msg').innerHTML = '<span class="' + (ok ? 'ok' : 'err') + '">' + U.esc(text) + '</span>'; }
  function showSet(text, ok) { $('spMsg').innerHTML = text ? ('<span class="' + (ok ? 'ok' : 'err') + '">' + U.esc(text) + '</span>') : ''; }

  function busy(btn, on, text) {
    if (on) { btn.dataset.old = btn.textContent; btn.disabled = true; btn.textContent = text; }
    else { btn.disabled = false; btn.textContent = btn.dataset.old || btn.textContent; }
  }

  /** 登录成功后的回跳地址：默认回看板；支持 ?next=xxx 指定，且只允许站内相对路径 */
  function nextUrl() {
    var v = '';
    try { v = new URLSearchParams(location.search).get('next') || ''; } catch (e) { v = ''; }
    if (!v || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(v) || v.indexOf('//') === 0) { return './'; }
    return v;
  }

  // ---------- 发送验证码（含 60 秒倒计时，防连点） ----------
  // 倒计时挂在按钮自身上，避免两个「发送验证码」按钮互相干扰
  function startCooldown(btn) {
    if (btn._cool) { return; }
    var left = 60;
    btn.disabled = true;
    btn.textContent = left + ' 秒后重发';
    btn._cool = setInterval(function () {
      left -= 1;
      if (left <= 0) {
        clearInterval(btn._cool); btn._cool = null;
        btn.disabled = false; btn.textContent = '重新发送';
      } else {
        btn.textContent = left + ' 秒后重发';
      }
    }, 1000);
  }

  $('sendBtn').onclick = function () {
    var email = $('email').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { return show('请输入正确的邮箱地址。', false); }
    busy($('sendBtn'), true, '发送中…');
    A.sendCode(email).then(function (r) {
      busy($('sendBtn'), false);
      startCooldown($('sendBtn'));
      $('code').focus();
      show(r.isUser ? '验证码已发送，请查收邮箱。' : '验证码已发送（这是新邮箱，验证后将自动注册）。', true);
    }).catch(function (e) {
      busy($('sendBtn'), false);
      show('发送失败：' + e.message, false);
    });
  };

  // ---------- 验证码登录 / 注册 ----------
  $('loginBtn').onclick = function () {
    var email = $('email').value.trim();
    var code = $('code').value.trim();
    if (!email) { return show('请先填邮箱并发送验证码。', false); }
    if (!/^\d{4,8}$/.test(code)) { return show('请输入邮件里的验证码。', false); }
    busy($('loginBtn'), true, '登录中…');
    A.signInWithCode(email, code).then(function (r) {
      busy($('loginBtn'), false);
      var okText = (r.isNewUser ? '注册并登录成功 🎉 ' : '登录成功 🎉 ');
      U.toast('登录成功');
      renderState();
      // 还没设过密码：引导设一次，之后可免验证码（可「取消」跳过）
      if (!A.hasPasswordFlag()) {
        show(okText + '建议设置用户名和密码，下次可免验证码登录。', true);
        openSetPwd(email, '用邮箱验证码验证身份后，设置用户名（可选）和密码；点「取消」可直接进入看板。');
        return;
      }
      show(okText + '正在返回看板…', true);
      // 稍等一下让用户看到成功提示，再跳回看板
      setTimeout(function () { location.href = nextUrl(); }, 900);
    }).catch(function (e) {
      busy($('loginBtn'), false);
      show('登录失败：' + e.message, false);
    });
  };

  // ---------- 登录方式切换（验证码 / 密码） ----------
  (function () {
    var seg = $('loginSeg');
    if (!seg) { return; }
    var btns = seg.getElementsByTagName('button');
    function switchPane(name) {
      for (var i = 0; i < btns.length; i++) {
        btns[i].classList.toggle('on', btns[i].getAttribute('data-pane') === name);
      }
      $('paneCode').hidden = (name !== 'code');
      $('panePwd').hidden = (name !== 'pwd');
      $('msg').innerHTML = '';
    }
    for (var i = 0; i < btns.length; i++) {
      btns[i].onclick = (function (b) {
        return function () { switchPane(b.getAttribute('data-pane')); };
      })(btns[i]);
    }
  })();

  // ---------- 邮箱 / 用户名 + 密码登录 ----------
  $('pwdLoginBtn').onclick = function () {
    var acct = $('pwdEmail').value.trim();
    var pwd = $('pwd').value;
    if (!acct) { return show('请输入邮箱或用户名。', false); }
    if (acct.indexOf('@') !== -1 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(acct)) { return show('邮箱格式不正确。', false); }
    if (!pwd) { return show('请输入密码。', false); }
    busy($('pwdLoginBtn'), true, '登录中…');
    A.signInWithPassword(acct, pwd).then(function () {
      busy($('pwdLoginBtn'), false);
      show('登录成功 🎉 正在返回看板…', true);
      U.toast('登录成功');
      renderState();
      setTimeout(function () { location.href = nextUrl(); }, 900);
    }).catch(function (e) {
      busy($('pwdLoginBtn'), false);
      show('登录失败：' + e.message + '（还没设过密码？点下方「设置 / 重置密码」）', false);
    });
  };

  // ---------- 设置 / 重置用户名与密码（用邮箱验证码验证身份） ----------
  /** 密码规则与 CloudBase 一致：8-32 位，且同时包含字母和数字 */
  function pwdValid(p) { return p.length >= 8 && p.length <= 32 && /[A-Za-z]/.test(p) && /\d/.test(p); }
  /** 用户名规则：4-24 位，仅字母/数字/_/-，不能是纯数字、不能以 _ 或 - 开头结尾 */
  function unameValid(u) {
    if (!/^[A-Za-z0-9_-]{4,24}$/.test(u)) { return false; }
    if (/^[-_]|[-_]$/.test(u)) { return false; }
    if (!/[A-Za-z]/.test(u)) { return false; }
    return true;
  }

  function openSetPwd(email, tip) {
    $('setPwdCard').hidden = false;
    if (email) { $('spEmail').value = email; }
    showSet(tip || '', true);
    try { $('setPwdCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) { /* 忽略 */ }
  }

  $('toSetPwd').onclick = function (e) {
    if (e && e.preventDefault) { e.preventDefault(); }
    openSetPwd($('pwdEmail').value.trim() || $('email').value.trim(), '');
  };

  $('spSendBtn').onclick = function () {
    var email = $('spEmail').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { return showSet('请输入正确的邮箱地址。', false); }
    busy($('spSendBtn'), true, '发送中…');
    A.sendCode(email).then(function () {
      busy($('spSendBtn'), false);
      startCooldown($('spSendBtn'));
      $('spCode').focus();
      showSet('验证码已发送，请查收邮箱。', true);
    }).catch(function (e) {
      busy($('spSendBtn'), false);
      showSet('发送失败：' + e.message, false);
    });
  };

  $('spBtn').onclick = function () {
    var email = $('spEmail').value.trim();
    var code = $('spCode').value.trim();
    var pwd = $('spPwd').value;
    var user = $('spUser').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { return showSet('请输入正确的邮箱地址。', false); }
    if (!/^\d{4,8}$/.test(code)) { return showSet('请输入邮件里的验证码。', false); }
    if (!pwdValid(pwd)) { return showSet('密码需 8-32 位，且同时包含字母和数字。', false); }
    if (user && !unameValid(user)) { return showSet('用户名需 4-24 位，仅限字母/数字/下划线/短横线，不能是纯数字、不能以 _ 或 - 开头结尾。', false); }
    busy($('spBtn'), true, '设置中…');
    A.setPassword(email, code, pwd, user).then(function () {
      busy($('spBtn'), false);
      showSet('设置成功 🎉 正在返回看板…', true);
      U.toast('设置成功');
      renderState();
      setTimeout(function () { location.href = nextUrl(); }, 900);
    }).catch(function (e) {
      busy($('spBtn'), false);
      showSet('设置失败：' + e.message, false);
    });
  };

  $('spCancelBtn').onclick = function () {
    $('setPwdCard').hidden = true;
    showSet('', true);
    // 若已登录（比如验证码登录后跳过设密码），直接进看板
    A.current().then(function (u) { if (u) { location.href = nextUrl(); } });
  };

  // ---------- 登录态 ----------
  function renderState() {
    $('state').textContent = '查询中…';
    A.current().then(function (u) {
      if (!u) { $('state').innerHTML = '未登录。可用「验证码登录」或「密码登录」登录。'; return; }
      $('state').innerHTML = '已登录 ✅　uid：<code>' + U.esc(u.uid || '(未返回)') + '</code>' +
        (u.email ? '　邮箱：<code>' + U.esc(u.email) + '</code>' : '');
    }).catch(function (e) {
      $('state').innerHTML = '<span class="err">读取登录态失败：' + U.esc(e.message) + '</span>';
    });
  }

  // ---------- 退出 ----------
  $('signOutBtn').onclick = function () {
    A.signOut().then(function () {
      U.toast('已退出登录');
      renderState();
      show('已退出登录。', true);
    }).catch(function (e) { show('退出失败：' + e.message, false); });
  };

  renderState();
})();
