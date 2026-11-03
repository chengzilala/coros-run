/* AI 跑步教练（对话框）· 本机优先
 *
 * 多轮对话：前端持有全部历史，服务端无状态（POST /api/coach）。
 * 教练人设与方法论在服务端（serve.py），本页只负责收发与渲染。
 * 对话记录存本机 localStorage，可清空；训练数据不下发、不外传。
 */
(function () {
  var Store = window.CorosStore, UI = window.CorosUI, NUT = window.CorosNutrition;
  Store.applyFontScale();

  var LS_KEY = 'coros_coach_chat';
  var SAMPLE_Q = '我下周该怎么练？';   // 四风格共用一个示例问题，便于对比差异
  var PERSONAS = [
    { key: 'geek', label: '数据极客',
      desc: '冷静精确，先摆数据再下结论，爱用数字和对比。适合想看硬指标、要量化依据的人。',
      sample: '你近 7 天跑量 32km、负荷比 1.3 偏高；下周维持 30km、E 占 8 成，加 1 次 T 跑 4:35/km×20min。' },
    { key: 'veteran', label: '老教练',
      desc: '沉稳有阅历，像带了几十年队的老教练，语气笃定、爱讲经验。适合想听经验判断、拿不准主意的人。',
      sample: '别急着加量，先把基础打牢——下周还是以慢跑为主，等身体适应了，咱们再加质量课。' },
    { key: 'straight', label: '直球',
      desc: '直接简短、不绕弯，问题直说、建议干脆。适合不想听客套、要快速拿结论的人。',
      sample: '别加量。慢跑为主，加一次阈值就够了。' },
    { key: 'companion', label: '伙伴',
      desc: '像一起训练的跑友，口语轻松有温度，鼓励为主。适合喜欢被陪伴、边聊边练的人。（默认）',
      sample: '咱们不着急哈～你最近状态一般，下周就先轻松跑为主，找回感觉再加点质量课，我陪你一步步来。' }
  ];
  var SUGGEST = [
    '我下周该怎么练？',
    '今天能不能跑？',
    '最近训练强度合不合理？',
    '按我现在状态，全马大概能跑多少？',
    '马拉松世界纪录是多少？'
  ];

  var messages = [];            // [{role:'user'|'assistant', content}]
  var persona = 'companion';
  var busy = false;
  var weightKg = 0;             // 从本机看板数据读到的体重（补给计算默认值）

  function $(id) { return document.getElementById(id); }

  function save() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ persona: persona, messages: messages.slice(-40) }));
    } catch (e) { /* 隐私模式：忽略 */ }
  }

  function load() {
    try {
      var obj = JSON.parse(localStorage.getItem(LS_KEY) || 'null') || {};
      if (Array.isArray(obj.messages)) {
        messages = obj.messages.filter(function (m) {
          return m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string';
        });
      }
      if (obj.persona && PERSONAS.some(function (p) { return p.key === obj.persona; })) { persona = obj.persona; }
    } catch (e) { /* 忽略 */ }
  }

  function bubble(role, content) {
    var wrap = document.createElement('div');
    wrap.className = 'chat-msg chat-msg--' + role;
    var body = (role === 'assistant')
      ? UI.md(content)
      : '<div class="ai-content"><p>' + UI.esc(content) + '</p></div>';
    wrap.innerHTML = '<div class="chat-who">' + (role === 'user' ? '我' : '教练') + '</div>' +
                     '<div class="chat-bubble">' + body + '</div>';
    // 教练的每条回复都可一键复制（学员可把建议粘贴到备忘录 / 分享）
    if (role === 'assistant') {
      var act = document.createElement('div');
      act.className = 'chat-actions';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chat-copy';
      btn.textContent = '复制';
      btn.onclick = function () {
        UI.copyText(content).then(function (ok) {
          btn.textContent = ok ? '已复制' : '复制失败';
          setTimeout(function () { btn.textContent = '复制'; }, 1500);
        });
      };
      act.appendChild(btn);
      wrap.appendChild(act);
    }
    return wrap;
  }

  function scrollBottom() {
    var log = $('chatLog');
    if (log) { log.scrollTop = log.scrollHeight; }
    try { window.scrollTo(0, document.body.scrollHeight); } catch (e) { /* 忽略 */ }
  }

  function renderLog() {
    var log = $('chatLog');
    log.innerHTML = '';
    if (!messages.length) {
      log.innerHTML = UI.stateHtml('empty', '你好，我是你的跑步万事通（丹尼尔斯体系内核）。' +
        '训练安排、跑步常识、世界纪录 / 赛事，都可以问我；点下面的问题开始，或直接把你的疑问告诉我。');
    } else {
      messages.forEach(function (m) { log.appendChild(bubble(m.role, m.content)); });
    }
    scrollBottom();
  }

  function setBusy(on) {
    busy = on;
    $('chatSend').disabled = on;
    $('chatInput').disabled = on;
  }

  function addBubble(node) {
    var log = $('chatLog');
    log.appendChild(node);
    scrollBottom();
  }

  /** 对话框里的「提示卡」（未配 Key / 调用失败）：紧凑左对齐，带图标+标题+说明+按钮 */
  function noticeBubble(o) {
    var d = document.createElement('div');
    d.className = 'chat-msg chat-msg--assistant';
    d.innerHTML = '<div class="chat-who">教练</div>' +
      '<div class="chat-bubble chat-note' + (o.kind ? ' chat-note--' + o.kind : '') + '">' +
      '<div class="chat-note__head"><span class="chat-note__ico">' + UI.esc(o.icon) + '</span><b>' + UI.esc(o.title) + '</b></div>' +
      '<p class="chat-note__desc">' + UI.esc(o.desc) + '</p>' +
      (o.actionLabel ? '<button type="button" class="chat-note__btn">' + UI.esc(o.actionLabel) + '</button>' : '') +
      '</div>';
    var btn = d.querySelector('.chat-note__btn');
    if (btn && o.onAction) { btn.onclick = function () { o.onAction(d); }; }
    return d;
  }

  function failMsg(text) {
    addBubble(noticeBubble({
      kind: 'error',
      icon: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.8L21 19.4H3z"/><path d="M12 9.8v4.2"/><circle cx="12" cy="16.9" r=".8" fill="currentColor" stroke="none"/></svg>',
      title: '调用失败', desc: text,
      actionLabel: '重试',
      onAction: function (node) { node.remove(); callCoach(); }
    }));
  }

  /** 未配置自己的 AI Key：引导去「我的账户 → AI 复盘 Key」填写 */
  function noKeyMsg() {
    addBubble(noticeBubble({
      icon: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="8.4" cy="8.4" r="4.1"/><path d="M11.4 11.4L20 20M16.6 16.6l-1.8 1.8M18.6 18.6l-1.8 1.8"/></svg>',
      title: '还没有配置 AI Key',
      desc: '到「我的账户 → AI 复盘 Key」填入你自己的 Key（支持 DeepSeek / 通义 / Kimi / 智谱 / 豆包），填一次即可。',
      actionLabel: '去配置 Key',
      onAction: function () { location.href = 'account.html'; }
    }));
  }

  function send() {
    if (busy) { return; }
    var input = $('chatInput');
    var text = String(input.value || '').trim();
    if (!text) { return; }
    input.value = '';
    input.style.height = 'auto';
    messages.push({ role: 'user', content: text });
    renderLog();
    callCoach();
  }

  function buildCalcNote() {
    // 补给问题：前端纯函数先算好数字，随请求喂给教练（确定性算术不交给 AI）
    if (!NUT) { return ''; }
    var last = messages[messages.length - 1];
    if (!last || last.role !== 'user') { return ''; }
    var text = String(last.content || '');
    if (!NUT.hasIntent(text)) { return ''; }
    var p = NUT.parse(text);
    if (!p) {
      return '用户在问补给，但没说明「时长 / 强度」——请先问清跑多久、什么强度，再按页面「补给计算器」的口径给数字，不要自行心算。';
    }
    var w = Number($('fuelWeight').value) || weightKg || 60;
    return NUT.format(NUT.plan(w, p.minutes, p.level));
  }

  /** 本机预览：走本机服务 /api/coach（Key 存在本机「我的账户」） */
  function callLocal(body) {
    body.device = Store.getDeviceId();
    body.source = isGarminSource() ? 'garmin' : '';
    return fetch(Store.apiUrl('api/coach'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return { error: '服务返回异常（HTTP ' + r.status + '）' }; });
    }, function (e) {
      throw new Error('本机服务请求失败：' + ((e && e.message) || e) + '（本机预览请用 web/serve.py 启动服务）');
    }).then(function (j) {
      if (j && j.error) { throw new Error(j.error); }
      return { text: (j && j.text), quota: null };
    });
  }

  /** 已登录：走云函数 coach（用户自填 Key 优先；平台 Key 兜底默认关闭） */
  function callCloud(body) {
    return window.CorosAuth.callFunction('coach', body).then(function (res) {
      if (res && res.ok && res.text) { return { text: res.text, quota: res.quota }; }
      var err = new Error((res && res.error) || '教练没有返回内容');
      if (res && res.code === 'ai_nokey') { err.aiNoKey = true; }
      throw err;
    });
  }

  /** 双源：已登录 → 云函数；未登录 / 无 SDK → 本机服务 */
  function pickSource(body) {
    var A = window.CorosAuth;
    if (A && A.callFunction && A.current) {
      return A.current().then(function (u) { return u ? callCloud(body) : callLocal(body); });
    }
    return callLocal(body);
  }

  function callCoach() {
    if (busy || !messages.length) { return; }
    setBusy(true);
    var thinking = document.createElement('div');
    thinking.className = 'chat-msg chat-msg--assistant chat-thinking';
    thinking.id = 'chatThinking';
    thinking.innerHTML = '<div class="chat-who">教练</div><div class="chat-bubble chat-bubble--thinking">' +
      UI.stateArt('loading') + '<span>正在结合你的训练数据分析…</span></div>';
    addBubble(thinking);

    var body = { persona: persona, messages: messages, calc: buildCalcNote(),
                 lang: (window.I18N && window.I18N.lang) || 'hans' };
    pickSource(body).then(function (r) {
      var t = $('chatThinking'); if (t) { t.remove(); }
      messages.push({ role: 'assistant', content: r.text || '(教练没有返回内容)' });
      renderLog();
      save();
      if (r.quota) { UI.toast('今日教练剩余 ' + r.quota.remaining + ' 条'); }
    }).catch(function (e) {
      var t = $('chatThinking'); if (t) { t.remove(); }
      if (e && e.aiNoKey) { noKeyMsg(); }
      else { failMsg('调用失败：' + ((e && e.message) || e)); }
    }).then(function () {
      setBusy(false);
    });
  }

  function renderPersonaSeg() {
    var seg = $('personaSeg');
    seg.innerHTML = '';
    PERSONAS.forEach(function (p) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = p.label;
      b.title = p.desc + ' 示例——问「' + SAMPLE_Q + '」：' + p.sample;
      if (p.key === persona) { b.className = 'on'; }
      b.onclick = function () {
        persona = p.key; save(); renderPersonaSeg();
        UI.toast('已切换到「' + p.label + '」风格');
      };
      seg.appendChild(b);
    });
    var cur = PERSONAS.filter(function (p) { return p.key === persona; })[0] || PERSONAS[PERSONAS.length - 1];
    var box = $('personaDesc');
    if (box) {
      box.innerHTML = '<b>' + UI.esc(cur.label) + '</b>：' + UI.esc(cur.desc) +
        '<span class="persona-demo">示例——问「' + UI.esc(SAMPLE_Q) + '」，它会这样回你：' + UI.esc(cur.sample) + '</span>';
    }
  }

  function bindTheme() {
    var btn = $('themeToggle');
    if (!btn) { return; }
    function isLight() { return document.documentElement.getAttribute('data-theme') === 'light'; }
    function sync() { Store.paintThemeIcon(btn); }
    sync();
    btn.onclick = function () { Store.applyTheme(isLight() ? 'dark' : 'light'); };
    if (Store.onThemeChange) { Store.onThemeChange(sync); }
  }

  function bindInput() {
    var input = $('chatInput');
    input.addEventListener('input', function () {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 160) + 'px';
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
  }

  // ---------- 数据驱动的「建议问题」 ----------
  var boardData = null;   // 本页读到的看板数据（体重 / 状态 / 配速 / 预测 / 活动），仅本人

  /** 当前数据源是否佳明（与看板共用同一个本机选择；各自独立文件，不混用） */
  function isGarminSource() {
    try { return localStorage.getItem('coros.dataSource') === 'garmin'; } catch (e) { return false; }
  }

  /** 读数据：已登录走云函数 dashboard（仅本人）；本机预览回退 data/dashboard.json；都拿不到返回 null */
  function loadBoard() {
    var A = window.CorosAuth;
    var p = (A && A.callFunction && A.current)
      ? A.current().then(function (u) {
          if (!u) { return null; }
          return A.callFunction('dashboard', {}).then(function (res) {
            return (res && res.ok) ? res : null;
          }, function () { return null; });
        }, function () { return null; })
      : Promise.resolve(null);
    return p.then(function (res) {
      if (res) { return res; }
      if (!isLocalHost()) { return null; }
      return fetch(isGarminSource() ? 'data/dashboard.garmin.json' : 'data/dashboard.json', { cache: 'no-store' })
        .then(function (r) { return r.json(); }).catch(function () { return null; });
    });
  }

  /** 最近 7 天跑量（公里），按数据里最新一条活动的日期回推 */
  function recentWeekKm(d) {
    var acts = (d && d.activities) || [];
    var maxT = 0;
    acts.forEach(function (a) {
      var t = new Date(String(a.date) + 'T00:00:00').getTime();
      if (t > maxT) { maxT = t; }
    });
    if (!maxT) { return 0; }
    var from = maxT - 6 * 86400000;
    var m = 0;
    acts.forEach(function (a) {
      var t = new Date(String(a.date) + 'T00:00:00').getTime();
      if (t >= from && t <= maxT) { m += Number(a.distanceM) || 0; }
    });
    return Math.round(m / 1000);
  }

  /** 用「当前这个人」的真实数据生成建议问题；没数据时退回通用问题 */
  function suggestQuestions(d) {
    var fit = (d && d.fitness) || {};
    var rd = (d && d.readiness) || {};
    var pred = fit.predictions || {};
    var paces = fit.paces || {};
    var out = [];

    // 状态：按今日恢复度 / 状态灯给「今天怎么练」
    var rp = Number(rd.recoveryPct);
    if (rp > 0 && rd.status === 'ok') {
      out.push('我今天恢复 ' + rp + '%，能上一节质量课吗？');
    } else if (rp > 0) {
      out.push('我最近状态一般（恢复 ' + rp + '%），今天该怎么练？');
    }

    // 训练安排（总入口）
    out.push('我下一步该怎么安排训练？');

    // 全马预测：带真实数字
    if (pred['Marathon']) {
      out.push('我全马预测 ' + pred['Marathon'] + '，怎么练能更快？');
    }

    // 阈值配速：带真实数字
    if (paces.T) {
      out.push('我的阈值配速 ' + paces.T + '，阈值跑该跑多久？');
    }

    // 近期跑量
    var wk = recentWeekKm(d);
    if (wk > 0) { out.push('我最近一周跑了 ' + wk + ' km，量够吗？'); }

    // 兜底凑数（保证至少有 3 个可选）
    SUGGEST.forEach(function (t) { if (out.indexOf(t) < 0 && out.length < 6) { out.push(t); } });

    return out.slice(0, 6);
  }

  /** 渲染建议问题（始终显示在输入框上方，点一下即发送） */
  function renderChips() {
    var chips = $('chatChips');
    if (!chips) { return; }
    chips.innerHTML = '';
    suggestQuestions(boardData).forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chat-chip';
      b.textContent = t;
      b.onclick = function () { $('chatInput').value = t; send(); };
      chips.appendChild(b);
    });
  }

  /** 取数完成后：回填体重 + 用真实数据刷新建议问题 */
  function loadBoardAndSuggest() {
    renderChips();   // 先渲染通用问题，避免空白
    loadBoard().then(function (d) {
      boardData = d;
      var w = d && d.profile && Number(d.profile.weightKg);
      if (w > 0) {
        weightKg = w;
        var el = $('fuelWeight');
        if (el && !el.value) { el.value = w; }
      }
      renderChips();
    }, function () { /* 忽略：保留通用问题 */ });
  }

  function renderFuel() {
    var out = $('fuelOut');
    if (!out || !NUT) { return; }
    var w = Number($('fuelWeight').value) || weightKg || 60;
    var min = Number($('fuelMin').value) || 0;
    if (!min) { out.textContent = '请先填「时长（分钟）」再点计算。'; return; }
    out.textContent = NUT.format(NUT.plan(w, min, $('fuelLevel').value));
  }

  function initFuel() {
    if (!NUT || !$('fuelTool')) { return; }
    $('fuelGo').onclick = renderFuel;
  }

  /** 仅本机预览（localhost/127.0.0.1）不走登录门禁 */
  function isLocalHost() {
    var h = location.hostname;
    return h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '';
  }

  /** 线上未登录：不展示可输入的对话框，直接引导去登录/落地页（与看板 app.js 同款门禁） */
  function guardLogin() {
    var A = window.CorosAuth;
    if (!A || !A.current || isLocalHost()) { return Promise.resolve(); }
    return A.current().then(function (u) {
      if (!u) { location.replace('landing.html'); throw new Error('__NEED_LOGIN__'); }
    });
  }

  function initUI() {
    renderPersonaSeg();
    renderLog();
    bindTheme();
    bindInput();
    initFuel();
    loadBoardAndSuggest();
    $('chatForm').addEventListener('submit', function (e) { e.preventDefault(); send(); });
    $('clearBtn').onclick = function () {
      if (!messages.length) { return; }
      UI.confirmDialog({ title: '清空对话', html: '将删除当前对话记录（不影响你的训练数据）。', confirmLabel: '清空', danger: true })
        .then(function (ok) { if (ok) { messages = []; save(); renderLog(); } });
    };
  }

  function init() {
    load();
    guardLogin().then(initUI, function () { /* 未登录已跳转，忽略 */ });
  }

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); } else { init(); }
})();
