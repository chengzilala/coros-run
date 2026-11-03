/* 我的账户页：AI Key 托管（统一组件）/ 外观 / 字号。
 *
 * Key 面板已抽成共享组件（母本：AI Key 集成/component），本页只负责：
 *   ① 提供 RPC（本机 /api/account 或云函数 account）
 *   ② 挂载面板
 * 面板内的厂商清单、文案、交互一律以母本为准，不要在本项目里另改一套。
 */
(function () {
  var S = window.CorosStore, U = window.CorosUI;
  var device = S.getDeviceId();

  var LOCAL = (function () {
    var h = location.hostname;
    return h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '';
  })();

  function $(id) { return document.getElementById(id); }

  // ---------- 统一后端调用：本机 → /api/account；线上 → 云函数 account ----------
  function callLocal(action, payload) {
    var body = { action: action, device: device };
    if (payload) { for (var k in payload) { body[k] = payload[k]; } }
    return fetch(S.apiUrl('api/account'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(function (r) { return r.json(); })
      .catch(function (e) { return { error: '请求失败：' + ((e && e.message) || e) + '（本机服务在跑吗？）' }; });
  }
  function callCloud(action, payload) {
    if (!window.CorosAuth || !window.CorosAuth.callFunction) {
      return Promise.resolve({ error: '登录组件未就绪，请刷新页面重试。' });
    }
    var data = { action: action };
    if (payload) { for (var k in payload) { data[k] = payload[k]; } }
    return window.CorosAuth.callFunction('account', data)
      .then(function (res) { return res || { error: '云函数没有返回内容。' }; },
        function (e) { return { error: (e && e.message) || String(e) }; });
  }
  function call(action, payload) {
    // 本机服务的「读取」只有 GET /api/account（没有 keyGet 这个 POST 动作），单独走一次
    if (LOCAL && action === 'keyGet') {
      return fetch(S.apiUrl('api/account') + '?device=' + encodeURIComponent(device))
        .then(function (r) { return r.json(); })
        .catch(function (e) { return { error: '请求失败：' + ((e && e.message) || e) }; });
    }
    return LOCAL ? callLocal(action, payload) : callCloud(action, payload);
  }

  // ---------- AI Key 面板（共享组件，install.sh 同步） ----------
  function mountAiKey() {
    var slot = $('aiKeySlot');
    if (!slot) { return; }
    if (!window.AIKeyPanel || !window.AIKeyStore) {
      slot.innerHTML = '<div class="tip">Key 面板组件未加载，请刷新页面重试。</div>';
      return;
    }
    AIKeyPanel.mount(slot, {
      store: AIKeyStore.remote({
        call: call,
        // 本机服务的测试动作叫 test，云函数叫 keyTest
        actions: { test: LOCAL ? 'test' : 'keyTest' }
      }),
      note: 'AI 复盘与教练用你自己的 Key：填一次、加密托管，之后打开即用，也可随时一键清除。选平台即自动配好地址与模型。',
      footText: (LOCAL ? 'Key 只加密保存在本机。' : 'Key 加密托管在云端，仅你本人可用。')
        + '页面只显示掩码，随时可以一键清除。',
      onSaved: function () { U.toast('Key 已加密托管'); },
      onCleared: function () { U.toast('已清除托管 Key'); }
    });
  }

  // ---------- 外观 ----------
  $('themeTiers').innerHTML = S.THEME_TIERS.map(function (t) {
    return '<button type="button" class="ghost" data-theme="' + t.key + '">' + U.esc(t.label) + '</button>';
  }).join('');
  function markTheme() {
    var cur = S.getTheme();
    Array.prototype.forEach.call($('themeTiers').querySelectorAll('button'), function (b) {
      b.classList.toggle('primary', b.getAttribute('data-theme') === cur);
    });
  }
  Array.prototype.forEach.call($('themeTiers').querySelectorAll('button'), function (b) {
    b.onclick = function () { S.applyTheme(b.getAttribute('data-theme')); markTheme(); U.toast('外观已切换'); };
  });
  markTheme();

  // ---------- 字号 ----------
  S.applyFontScale();
  $('fontTiers').innerHTML = S.FONT_TIERS.map(function (t) {
    return '<button type="button" class="ghost" data-v="' + t.value + '">' + U.esc(t.label) + '</button>';
  }).join('');
  function markFont() {
    var cur = S.getFontScale();
    Array.prototype.forEach.call($('fontTiers').querySelectorAll('button'), function (b) {
      b.classList.toggle('primary', Number(b.getAttribute('data-v')) === cur);
    });
  }
  Array.prototype.forEach.call($('fontTiers').querySelectorAll('button'), function (b) {
    b.onclick = function () { S.applyFontScale(Number(b.getAttribute('data-v'))); markFont(); };
  });
  markFont();

  // ---------- 初始化 ----------
  // 线上要等 auth.js 就绪（它在本文件之后加载），故放到 DOMContentLoaded 之后。
  function init() { mountAiKey(); }
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); } else { init(); }
})();
