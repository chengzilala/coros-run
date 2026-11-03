/* 轻量 UI 工具（零依赖；从微信读书插件的交互经验移植）
 *
 * 提供：esc / toast / copyText / stateHtml / md / confirmDialog
 * 样式在 style.css（.coros-toast / .coros-dialog / .coros-state / .ai-content）。
 */
window.CorosUI = (function () {

  /** HTML 转义（所有来自接口/用户的内容都必须过一遍） */
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * 极简 Markdown 渲染（只为 AI 复盘这类固定格式服务，不求通用）：
   *   ## 标题 / - 项目 / 1. 项目 / **加粗** / `行内代码` → 结构化 HTML。
   * 先整体转义再拼 HTML，保证注入安全（不支持原始 HTML 片段）。
   */
  function md(text) {
    var lines = String(text == null ? '' : text).replace(/\r\n/g, '\n').split('\n');
    var out = [], list = null;
    function closeList() { if (list) { out.push('</' + list + '>'); list = null; } }
    function inline(s) {
      return esc(s)
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/`([^`]+)`/g, '<code>$1</code>');
    }
    lines.forEach(function (raw) {
      var line = raw.replace(/\s+$/, '');
      if (!line.trim()) { closeList(); return; }
      var h = line.match(/^\s*#{1,6}\s*(.+)$/);
      if (h) { closeList(); out.push('<h4 class="ai-h">' + inline(h[1]) + '</h4>'); return; }
      var ul = line.match(/^\s*[-*·]\s+(.+)$/);
      if (ul) {
        if (list !== 'ul') { closeList(); out.push('<ul class="ai-ul">'); list = 'ul'; }
        out.push('<li>' + inline(ul[1]) + '</li>');
        return;
      }
      var ol = line.match(/^\s*\d+[.)、]\s*(.+)$/);
      if (ol) {
        if (list !== 'ol') { closeList(); out.push('<ol class="ai-ol">'); list = 'ol'; }
        out.push('<li>' + inline(ol[1]) + '</li>');
        return;
      }
      closeList();
      out.push('<p>' + inline(line) + '</p>');
    });
    closeList();
    return '<div class="ai-content">' + out.join('') + '</div>';
  }

  /** 极简 toast */
  var toastTimer = null;
  function toast(message) {
    var node = document.getElementById('corosToast');
    if (!node) {
      node = document.createElement('div');
      node.id = 'corosToast';
      node.className = 'coros-toast';
      document.body.appendChild(node);
    }
    node.textContent = String(message || '');
    node.classList.add('is-show');
    if (toastTimer) { clearTimeout(toastTimer); }
    toastTimer = setTimeout(function () { node.classList.remove('is-show'); }, 2200);
  }

  /** 复制文本（带降级：clipboard API 不可用时用 execCommand） */
  function copyText(text) {
    var value = String(text || '');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(value).then(function () { return true; }).catch(function () {
        return legacyCopy(value);
      });
    }
    return Promise.resolve(legacyCopy(value));
  }

  function legacyCopy(value) {
    try {
      var ta = document.createElement('textarea');
      ta.value = value;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  /** 状态插画：一条简笔路线 + 一个圆点（与 logo 同一套线条语言） */
  var STATE_ART = {
    loading: '<svg class="state-art" viewBox="0 0 64 40" aria-hidden="true"><path d="M5 30C15 28 17 16 27 15s13 9 21-2"/><circle class="is-live" cx="52" cy="11" r="3.6"/></svg>',
    error: '<svg class="state-art" viewBox="0 0 64 40" aria-hidden="true"><path d="M5 30C14 28 17 20 24 17"/><path d="M34 14l6-2"/><circle cx="50" cy="10" r="3.6"/></svg>',
    empty: '<svg class="state-art" viewBox="0 0 64 40" aria-hidden="true"><path d="M5 30C15 28 17 17 27 15s13 8 20-3"/><circle cx="52" cy="10" r="3.6"/></svg>'
  };
  /** 状态块 HTML：loading / empty / error（可选重试按钮，data-action="retry"） */
  function stateHtml(kind, text, actionLabel) {
    var art = STATE_ART[kind] || STATE_ART.empty;
    var action = actionLabel
      ? '<button type="button" class="coros-btn coros-btn--ghost" data-action="retry">' + esc(actionLabel) + '</button>'
      : '';
    return '<div class="coros-state coros-state--' + esc(kind) + '">' +
      '<div class="coros-state__icon">' + art + '</div>' +
      '<div class="coros-state__text">' + esc(text || '') + '</div>' +
      action +
      '</div>';
  }

  /**
   * 通用确认弹层（站内弹层，不用系统 confirm）。
   * opts = { title, html, code, codeLabel, confirmLabel, cancelLabel, danger }
   * 返回 Promise<boolean>：true = 确认；false = 取消。
   * 传了 code 会额外渲染「代码 + 一键复制」一行（用于退出防呆展示账户码）。
   */
  var activeDialog = null;
  function confirmDialog(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      if (activeDialog) { return; }   // 已有弹层，忽略重复触发
      var overlay = document.createElement('div');
      overlay.className = 'coros-dialog-overlay';
      var codeRow = opts.code
        ? '<div class="coros-dialog__code">' +
            '<code>' + esc(opts.code) + '</code>' +
            '<button class="coros-dialog__copy" type="button" data-coros-dlg="copy">' + esc(opts.codeLabel || '复制') + '</button>' +
          '</div>'
        : '';
      overlay.innerHTML =
        '<div class="coros-dialog" role="dialog" aria-modal="true">' +
        '<div class="coros-dialog__title">' + esc(opts.title || '确认') + '</div>' +
        '<div class="coros-dialog__text">' + (opts.html || '') + '</div>' +
        codeRow +
        '<div class="coros-dialog__actions">' +
        '<button class="coros-dialog__btn" type="button" data-coros-dlg="cancel">' + esc(opts.cancelLabel || '取消') + '</button>' +
        '<button class="coros-dialog__btn' + (opts.danger ? ' coros-dialog__btn--danger' : '') + '" type="button" data-coros-dlg="confirm">' +
        esc(opts.confirmLabel || '确定') + '</button>' +
        '</div>' +
        '</div>';

      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); close(false); }
      }
      function close(result) {
        document.removeEventListener('keydown', onKey, true);
        if (overlay.parentNode) { overlay.parentNode.removeChild(overlay); }
        activeDialog = null;
        resolve(result);
      }

      overlay.addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('[data-coros-dlg]') : null;
        if (!btn) {
          if (e.target === overlay) { close(false); }
          return;
        }
        var act = btn.getAttribute('data-coros-dlg');
        if (act === 'copy') {
          copyText(opts.code).then(function (ok) { btn.textContent = ok ? '已复制' : '复制失败，请手动选择'; });
        } else if (act === 'cancel') {
          close(false);
        } else if (act === 'confirm') {
          close(true);
        }
      });

      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(overlay);
      activeDialog = overlay;
    });
  }

  /** 退出登录防呆：先把完整账户码摆出来让用户复制/确认已保存，再真正退出 */
  function confirmSignOut(deviceId) {
    return confirmDialog({
      title: '退出登录',
      html: '退出后本机会变成一个全新账户。请先保存下面的<b>账户码</b>，' +
            '否则将无法再找回本账户的 Key 与昵称（它们仍加密存在本机）。',
      code: deviceId,
      codeLabel: '复制账户码',
      confirmLabel: '我已保存，退出登录',
      danger: true
    });
  }

  return { esc: esc, toast: toast, copyText: copyText, stateHtml: stateHtml, stateArt: function (kind) { return STATE_ART[kind] || STATE_ART.empty; }, md: md, confirmDialog: confirmDialog, confirmSignOut: confirmSignOut };
})();
