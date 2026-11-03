/* 跑不快 · 多语言运行时（简体 / English / 繁體）
 *
 * 设计原则：
 *   1) 不改业务代码，只在渲染结果上做「整段精确匹配 + 正则模板」翻译；
 *      匹配不到的文本（用户数据、AI 输出等）保持原样，绝不误伤。
 *   2) 繁体走内置转换表（i18n/zh-hant-data.js），覆盖 100% 文本（含动态内容）。
 *   3) 语言优先级：URL ?lang= → 本机记住 → 默认简体中文（不按浏览器语言猜）。
 *
 * 依赖（须在本文件之前引入）：
 *   i18n/zh-hant-data.js  → window.COROS_S2T
 *   i18n/en.js            → window.COROS_I18N_EN
 */
(function () {
  'use strict';

  var KEY = 'coros:lang';
  var CN = /[\u3400-\u9fff]/;
  var ATTRS = ['title', 'placeholder', 'aria-label', 'alt'];
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1, PRE: 1, CODE: 1, CANVAS: 1, SVG: 1 };

  var dict = window.COROS_I18N_EN || {};
  var s2t = window.COROS_S2T;

  /* ---------------- 语言判定 ---------------- */
  function normLang(v) {
    v = String(v || '').trim().toLowerCase();
    if (!v) { return ''; }
    if (v === 'zh' || v === 'zh-cn' || v === 'zh-sg' || v === 'zh-hans' || v === 'cn' || v === 'hans' || v === 'chs') { return 'hans'; }
    if (v.indexOf('zh') === 0 && /(tw|hk|mo|hant)/.test(v)) { return 'hant'; }
    if (v === 'tw' || v === 'hk' || v === 'hant' || v === 'cht') { return 'hant'; }
    if (v.indexOf('en') === 0 || v === 'english') { return 'en'; }
    return '';
  }

  var qLang = '';
  try { qLang = normLang(new URLSearchParams(location.search).get('lang')); } catch (e) { /* 老浏览器忽略 */ }

  var lang = qLang;
  if (!lang) {
    try { lang = normLang(localStorage.getItem(KEY)); } catch (e) { /* 隐私模式 */ }
  }
  // 默认简体中文（不按浏览器语言猜）；要英文/繁体请点右上角胶囊或带 ?lang=
  if (!lang) { lang = 'hans'; }
  if (qLang) { try { localStorage.setItem(KEY, qLang); } catch (e) { /* 忽略 */ } }

  var HTML_LANG = { hans: 'zh-CN', hant: 'zh-Hant', en: 'en' }[lang];
  document.documentElement.setAttribute('lang', HTML_LANG);
  document.documentElement.setAttribute('data-lang', lang);

  /* ---------------- 英文：精确匹配 ---------------- */
  function coreOf(text) {
    var lead = text.match(/^\s*/)[0];
    var trail = text.match(/\s*$/)[0];
    return { lead: lead, trail: trail, core: text.slice(lead.length, text.length - trail.length) };
  }

  /* ---------------- 英文：正则模板 ---------------- */
  var NUM = '([\\d.,]+)';
  var PAT = [
    /* —— 通用计数 —— */
    [/^共 (\d+) 次训练：(.*)$/, function (m, n, rest) { return 'Total ' + n + ' workouts: ' + rest; }],
    [/^共 (\d+) 次记录$/, function (m, n) { return 'Total ' + n + ' activities'; }],
    [/^共 (\d+) 次$/, function (m, n) { return 'Total ' + n + ' runs'; }],
    [/^(\d+) 次记录$/, function (m, n) { return n + ' activities'; }],
    [/^(\d+) 次$/, function (m, n) { return n + ' runs'; }],
    [/^(\d+) 场疑似比赛$/, function (m, n) { return n + ' possible races'; }],
    [/^(\d+) 天$/, function (m, n) { return n + ' days'; }],
    [/^(\d+) 个章节$/, function (m, n) { return n + ' sections'; }],

    /* —— 今日状态 / 首屏 —— */
    [/^依据 (.+)预测 (.+) · VDOT (.+)$/, function (m, a, b, c) { return 'Based on ' + a + ' predicted ' + b + ' · VDOT ' + c; }],
    [/^身体电量 (\d+)~(\d+)$/, function (m, a, b) { return 'Body Battery ' + a + '–' + b; }],
    [/^身体电量 (\d+)$/, function (m, a) { return 'Body Battery ' + a; }],
    [/^红旗：(.+)$/, function (m, a) { return 'Red flags: ' + a; }],
    [/^恢复度 (\d+)%$/, function (m, a) { return 'Recovery ' + a + '%'; }],

    /* —— 周小结 —— */
    [/^→ 持平$/, function () { return '→ Flat'; }],
    [/^快 (\d+)s$/, function (m, a) { return a + 's faster'; }],
    [/^慢 (\d+)s$/, function (m, a) { return a + 's slower'; }],
    [/^前 7 天没有训练记录；最近 7 天 ([\d.]+) km \/ (\d+) 次。$/, function (m, a, b) {
      return 'No workouts in the previous 7 days; last 7 days: ' + a + ' km / ' + b + ' runs.';
    }],
    [/^最近 7 天 ([\d.]+) km \/ (\d+) 次。$/, function (m, a, b) { return 'Last 7 days: ' + a + ' km / ' + b + ' runs.'; }],
    [/^跑量较前 7 天(增加 (\d+)%|减少 (\d+)%|持平)（最近 7 天 ([\d.]+) km \/ (\d+) 次）(；高强度占比 (\d+)%（[^）]*）)?。$/, function (m, a, up, down, km, cnt, hard, note) {
      var s = up ? ('Mileage up ' + up + '% vs previous 7 days') : (down ? ('Mileage down ' + down + '% vs previous 7 days') : 'Mileage flat vs previous 7 days');
      s += ' (last 7 days: ' + km + ' km / ' + cnt + ' runs)';
      if (hard) {
        s += '; high intensity ' + hard + '%' + (/高于/.test(note || '') ? ' (above the 20% target — add more easy runs)' : ' (within polarized range)');
      }
      return s + '.';
    }],

    /* —— 跑量趋势 —— */
    [/^本(周|月|年) ([\d.]+) km，较上(周|月|年)(增加|减少) ([\d.]+)%，(周|月|年)均 ([\d.]+) km。$/, function (m, u1, cur, u2, dir, pct, u3, avg) {
      var U = { '周': ['week', 'weekly'], '月': ['month', 'monthly'], '年': ['year', 'yearly'] }[u1];
      return 'This ' + U[0] + ' ' + cur + ' km, ' + (dir === '增加' ? 'up ' : 'down ') + pct + '% vs last ' + U[0] +
        '; ' + U[1] + ' avg ' + avg + ' km.';
    }],
    [/^(周|月|年)均 ([\d.]+) km（数据不足两期，暂不比较）。$/, function (m, u, avg) {
      var U = { '周': 'Weekly', '月': 'Monthly', '年': 'Yearly' }[u];
      return U + ' avg ' + avg + ' km (not enough data to compare yet).';
    }],
    [/^按(周|月|年)$/, function (m, u) { return 'By ' + ({ '周': 'week', '月': 'month', '年': 'year' }[u]); }],

    /* —— 图表 tooltip —— */
    [/^跑量 ([\d.]+) km（(\d+) 次）$/, function (m, km, n) { return 'Mileage ' + km + ' km (' + n + ' runs)'; }],
    [/^跑量 ([\d.]+) km · (\d+) 次$/, function (m, km, n) { return 'Mileage ' + km + ' km · ' + n + ' runs'; }],
    [/^跑量 ([\d.]+) km$/, function (m, km) { return 'Mileage ' + km + ' km'; }],
    [/^ · 配速 ([\d:]+)\/km · 心率 (.+) bpm$/, function (m, p, hr) { return ' · Pace ' + p + '/km · HR ' + hr + ' bpm'; }],
    [/^轻松 ([\d.]+) km · 高强度 ([\d.]+) km$/, function (m, e, h) { return 'Easy ' + e + ' km · Hard ' + h + ' km'; }],
    [/^高强度占比 ([\d.]+)%$/, function (m, p) { return 'Hard share ' + p + '%'; }],
    [/^(\d{4}-\d{2}) 当周$/, function (m, d) { return 'Week of ' + d; }],
    [/^第 (\d+) 段$/, function (m, n) { return 'Lap ' + n; }],
    [/^第(\d+)段$/, function (m, n) { return 'Lap ' + n; }],
    [/^负荷数据不足，画不出趋势$/, function () { return 'Not enough load data to draw a trend'; }],
    [/^负荷(.*)，画不出趋势$/, function (m, why) { return 'Not enough load data' + why + ' to draw a trend'; }],
    [/^负荷比：(.*)$/, function (m, v) { return 'Load ratio: ' + v; }],
    [/^近 (\d+) 周：轻松 ([\d.]+) km、高强度 ([\d.]+) km/, function (m, n, easy, hard) {
      return 'Last ' + n + ' weeks: easy ' + easy + ' km, hard ' + hard + ' km';
    }],
    [/^只比同类（(.+)）：最近一次效率 ([\d.]+)$/, function (m, sport, v) {
      return 'Same sport only (' + sport + '): latest efficiency ' + v;
    }],

    /* —— 跑量规律 —— */
    [/^本月至今（(.+)）([\d.]+) km(，上月同期 ([\d.]+) km(（.*）)?)?$/, function (m, d, cur, rest, prev, pct) {
      var s = 'Month to date (' + d + '): ' + cur + ' km';
      if (prev) { s += ', same time last month: ' + prev + ' km' + (pct || ''); }
      return s;
    }],
    [/^本年至今 ([\d.]+) km(.*)$/, function (m, cur, rest) { return 'Year to date: ' + cur + ' km' + rest; }],

    /* —— 比赛 —— */
    [/^计划 (\d+) · 已完赛 (\d+)( · 识别到 (\d+) 场疑似比赛)?$/, function (m, plan, done, a, found) {
      return 'Planned ' + plan + ' · Completed ' + done + (found ? ' · ' + found + ' possible races detected' : '');
    }],
    [/^目标 (.+)$/, function (m, v) { return 'Goal ' + v; }],
    [/^已标记 (\d+) 场，可点卡片改名$/, function (m, n) { return 'Marked ' + n + ' race(s) — click a card to rename'; }],
    [/^比赛数据来自训练记录：(.+)$/, function (m, v) { return 'Race data comes from your workout record: ' + v; }],
    [/^系统已识别到 (\d+) 场疑似比赛，点右上「🏁 标记比赛」一键确认；或「＋ 计划比赛」加一场目标赛。$/, function (m, n) {
      return n + ' possible races detected. Click “🏁 Mark race” at top right to confirm, or “＋ Plan a race” to add a goal race.';
    }],
    [/^还没有比赛。点右上「🏁 标记比赛」把某次跑步记录标为比赛，或「＋ 计划比赛」加一场未来的目标赛。$/, function () {
      return 'No races yet. Click “🏁 Mark race” at top right to tag a run as a race, or “＋ Plan a race” to add a future goal race.';
    }],
    [/^(.+) · 已标记$/, function (m, v) { return v + ' · Marked'; }],

    /* —— 下周建议（规则生成）—— */
    [/^今日状态灯建议「(.+)」。下周先降量，目标约 ([\d.]+) km（较本周 -20%），全程轻松跑。$/, function (m, label, km) {
      return 'Your readiness suggests “' + label + '”. Cut volume next week to about ' + km + ' km (−20% vs this week), all easy running.';
    }],
    [/^本周跑量较前 7 天增加 (\d+)%，增量偏快（一般每周 ≤10%）。下周别再加量，保持或回调到 ([\d.]+) km 左右。$/, function (m, pct, km) {
      return 'Mileage is up ' + pct + '% vs the previous 7 days — that is a fast ramp (normally ≤10% per week). Hold or ease back to about ' + km + ' km next week.';
    }],
    [/^本周跑量较前 7 天减少 (\d+)%。下周可逐步回升到 ([\d.]+) km 左右（增幅 ≤10%）。$/, function (m, pct, km) {
      return 'Mileage is down ' + pct + '% vs the previous 7 days. Build back gradually to about ' + km + ' km next week (≤10% increase).';
    }],
    [/^本周跑量 ([\d.]+) km，节奏稳定。下周保持相近水平，小幅加量也别超过 ([\d.]+) km。$/, function (m, km, cap) {
      return 'Mileage this week is ' + km + ' km and steady. Keep a similar level next week; if you add volume, stay under ' + cap + ' km.';
    }],
    [/^本周高强度占比 (\d+)%（高于 20% 目标）。下周多安排轻松跑，把高强度压回 ≤20%，形成 80\/20 极化。$/, function (m, pct) {
      return 'High intensity is ' + pct + '% this week (above the 20% target). Add more easy runs next week to bring it back to ≤20% and stay polarized 80/20.';
    }],
    [/^本周高强度占比 (\d+)%（在 ≤20% 目标内）。下周保持：轻松跑打底，强度课 1–2 次。$/, function (m, pct) {
      return 'High intensity is ' + pct + '% this week (within the ≤20% target). Keep it up next week: easy running as the base, plus 1–2 quality sessions.';
    }],
    [/^本周只练了 (\d+) 次，偏少。下周争取 3–4 次，把跑量摊开、别一次练太猛。$/, function (m, n) {
      return 'Only ' + n + ' runs this week — on the low side. Aim for 3–4 runs next week and spread the mileage out rather than one big session.';
    }],
    [/^本周练了 (\d+) 次，密度偏高。下周保证至少 1 天完全休息，给身体恢复时间。$/, function (m, n) {
      return n + ' runs this week — quite dense. Take at least one full rest day next week and let your body recover.';
    }],
    [/^轻松跑参考配速 (.+) \/km（E 区间）；阈值跑 (.+) \/km。慢下来，才能快起来。$/, function (m, e, t) {
      return 'Easy run reference pace ' + e + ' /km (zone E); threshold ' + t + ' /km. Slow down to get faster.';
    }],

    /* —— AI 复盘 —— */
    [/^复盘已生成（今日剩余 (\d+) 次）$/, function (m, n) { return 'Review ready (' + n + ' left today)'; }],
    [/^调用失败：(.*)$/, function (m, v) { return 'Request failed: ' + v; }],

    /* —— 数据 / 设备 —— */
    [/^数据更新于 (.+)$/, function (m, v) { return 'Data updated ' + v; }],
    [/^数据来自你的(高驰|佳明)账号（只读）$/, function (m, b) { return 'Data from your ' + (b === '佳明' ? 'Garmin' : 'COROS') + ' account (read-only)'; }],
    [/^已接入 · (\d+) 次记录 · 更新于 (.+)$/, function (m, n, v) { return 'Connected · ' + n + ' activities · updated ' + v; }],
    [/^已同步 (\d+) 次记录 · 更新于 (.+)$/, function (m, n, v) { return 'Synced ' + n + ' activities · updated ' + v; }],
    [/^已抓取 · (\d+) 次记录 · 更新于 (.+)$/, function (m, n, v) { return 'Fetched · ' + n + ' activities · updated ' + v; }],
    [/^已接入 · 已同步 (\d+) 次记录 · 更新于 (.+)$/, function (m, n, v) { return 'Connected · synced ' + n + ' activities · updated ' + v; }],

    /* —— 地点 —— */
    [/^最多的是「(.+)」(\d+) 次 \/ ([\d.]+) km。$/, function (m, name, n, km) { return 'Most frequent: “' + name + '” — ' + n + ' runs / ' + km + ' km.'; }],
    [/^共 (\d+) 次训练：户外定位 (\d+) 次、跑步机 (\d+) 次、未定位 (\d+) 次。$/, function (m, a, b, c, d) {
      return 'Total ' + a + ' workouts: ' + b + ' GPS outdoor, ' + c + ' treadmill, ' + d + ' unlocated.';
    }],
    [/^其他 (\d+) 处$/, function (m, n) { return 'Other (' + n + ')'; }],
    [/^未命名（(.+)）$/, function (m, v) { return 'Unnamed (' + v + ')'; }],

    /* —— AI 教练快捷提问 —— */
    [/^我今天恢复 (\d+)%，能上一节质量课吗？$/, function (m, p) { return 'I am at ' + p + '% recovery today — can I do a quality session?'; }],
    [/^我最近状态一般（恢复 (\d+)%），今天该怎么练？$/, function (m, p) { return 'My readiness is mediocre (recovery ' + p + '%) — what should I do today?'; }],
    [/^我全马预测 ([\d:]+)，怎么练能更快？$/, function (m, t) { return 'My marathon prediction is ' + t + ' — how can I get faster?'; }],
    [/^我的阈值配速 ([\d:]+)，阈值跑该跑多久？$/, function (m, p) { return 'My threshold pace is ' + p + ' — how long should threshold runs be?'; }],
    [/^我最近一周跑了 ([\d.]+) km，量够吗？$/, function (m, km) { return 'I ran ' + km + ' km last week — is that enough?'; }],

    /* —— 页面标题「XX · 跑不快」 —— */
    [/^(.+) · 跑不快$/, function (m, t) { return trEn(t) + ' · Slow Is Fast'; }],
    [/^跑不快 · (.+)$/, function (m, t) { return 'Slow Is Fast · ' + trEn(t); }]
  ];

  /* 前缀类：可保留后文再翻译 */
  var PREFIX = [
    [/^（数据截至 ([\d\/\-]+)）/, function (m, d) { return '（Data through ' + d + '）'; }],
    [/^环比 \/ 同比（同期对比）/, function () { return 'Period over period'; }],
    [/^还没有数据：/, function () { return 'No data yet: '; }],
    [/^检查中…$/, function () { return 'Checking…'; }],
    [/^本月至今/, null]
  ];

  function trEn(text) {
    var c = coreOf(text);
    var core = c.core;
    if (!core || !CN.test(core)) { return text; }

    var hit = dict[core];
    if (hit != null) { return c.lead + hit + c.trail; }

    var i, m;
    for (i = 0; i < PREFIX.length; i++) {
      if (!PREFIX[i][1]) { continue; }
      m = PREFIX[i][0].exec(core);
      if (m) {
        return c.lead + PREFIX[i][1].apply(null, m) + trEn(core.slice(m[0].length)) + c.trail;
      }
    }
    for (i = 0; i < PAT.length; i++) {
      m = PAT[i][0].exec(core);
      if (m) { return c.lead + PAT[i][1].apply(null, m) + c.trail; }
    }
    return text;
  }

  /* ---------------- 统一翻译入口 ---------------- */
  function tr(text) {
    if (!text || typeof text !== 'string' || !CN.test(text)) { return text; }
    if (lang === 'hant') { return s2t ? s2t.convert(text) : text; }
    if (lang === 'en') { return trEn(text); }
    return text;
  }

  /* ---------------- DOM 应用 ---------------- */
  function skipEn(el) {
    if (lang !== 'en') { return false; }
    for (; el; el = el.parentNode) {
      if (el.nodeType !== 1) { continue; }
      if (el.getAttribute && el.getAttribute('data-i18n-skip') !== null) { return true; }
      var cls = (el.className && typeof el.className === 'string') ? el.className : '';
      if (el.id === 'aiBox' || el.id === 'coachLog' || cls.indexOf('chat-bubble') >= 0) { return true; }
    }
    return false;
  }

  function tx(node) {
    if (!node || node.nodeType !== 3) { return; }
    var p = node.parentNode;
    if (p && p.nodeName && SKIP_TAGS[p.nodeName]) { return; }
    if (p && p.closest && p.closest('#i18nSwitch')) { return; }
    // 备案号是官方登记原文，不翻译、不转繁体
    if (p && p.nodeName === 'A' && /beian\./.test(p.getAttribute('href') || '')) { return; }
    var s = node.nodeValue;
    if (!s || !CN.test(s)) { return; }
    if (skipEn(p)) { return; }
    var out = tr(s);
    if (out !== s) { node.nodeValue = out; }
  }

  function tAttrs(el) {
    if (!el || el.nodeType !== 1) { return; }
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i];
      var v = el.getAttribute && el.getAttribute(a);
      if (v && CN.test(v)) {
        if (skipEn(el)) { continue; }
        var nv = tr(v);
        if (nv !== v) { el.setAttribute(a, nv); }
      }
    }
  }

  var walker = document.createTreeWalker(document.body || document.documentElement, 4 /* SHOW_TEXT */, null, false);
  function applyTree(root) {
    if (!root) { return; }
    if (root.nodeType === 3) { tx(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9) { return; }
    if (root.nodeType === 1) {
      if (SKIP_TAGS[root.nodeName]) { return; }
      tAttrs(root);
      var list = root.querySelectorAll ? root.querySelectorAll('[title],[placeholder],[aria-label],[alt]') : [];
      for (var i = 0; i < list.length; i++) { tAttrs(list[i]); }
    }
    var w = document.createTreeWalker(root, 4, null, false);
    var n;
    while ((n = w.nextNode())) { tx(n); }
  }

  function applyHead() {
    if (lang === 'hans') { return; }
    if (document.title) { document.title = tr(document.title); }
    var metas = document.querySelectorAll('meta[name="description"],meta[property="og:title"],meta[property="og:description"],meta[name="apple-mobile-web-app-title"]');
    for (var i = 0; i < metas.length; i++) {
      var v = metas[i].getAttribute('content');
      if (v && CN.test(v)) { metas[i].setAttribute('content', tr(v)); }
    }
  }

  /* ---------------- 图表（ECharts）文本 ---------------- */
  function deepOption(obj, depth) {
    if (!obj || depth > 8) { return; }
    if (typeof obj === 'string') { return; }
    if (Array.isArray(obj)) {
      for (var i = 0; i < obj.length; i++) { deepOption(obj[i], depth + 1); }
      return;
    }
    if (typeof obj !== 'object') { return; }
    for (var k in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, k)) { continue; }
      var v = obj[k];
      if (typeof v === 'string') {
        if (CN.test(v)) { obj[k] = tr(v); }
      } else if (v && typeof v === 'object') {
        deepOption(v, depth + 1);
      }
    }
  }

  function patchECharts() {
    if (lang !== 'en' || !window.echarts || !window.echarts.init || window.echarts.__i18nPatched) { return; }
    var origInit = window.echarts.init;
    window.echarts.init = function () {
      var chart = origInit.apply(this, arguments);
      var origSet = chart.setOption;
      chart.setOption = function (opt) {
        if (opt && typeof opt === 'object') {
          try { deepOption(opt, 0); } catch (e) { /* 图表容错 */ }
        }
        return origSet.apply(chart, arguments);
      };
      return chart;
    };
    window.echarts.__i18nPatched = true;
  }

  /* ---------------- 动态内容监听 ---------------- */
  function startObserver() {
    if (!window.MutationObserver || !document.body) { return; }
    var pending = [];
    var timer = null;
    function flush() {
      timer = null;
      var list = pending;
      pending = [];
      for (var i = 0; i < list.length; i++) {
        var m = list[i];
        if (m.type === 'characterData') { tx(m.target); continue; }
        for (var j = 0; j < m.addedNodes.length; j++) {
          var n = m.addedNodes[j];
          if (n.nodeType === 3) { tx(n); } else if (n.nodeType === 1) { applyTree(n); }
        }
        if (m.type === 'attributes' && m.target) { tAttrs(m.target); }
      }
    }
    var mo = new MutationObserver(function (list) {
      for (var i = 0; i < list.length; i++) { pending.push(list[i]); }
      if (pending.length > 400) { pending = pending.slice(-400); }
      if (!timer) { timer = setTimeout(flush, 16); }
    });
    mo.observe(document.body, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ATTRS
    });
  }

  /* ---------------- 语言切换器 ---------------- */
  var LABEL = { hans: '简', en: 'EN', hant: '繁' };
  var CSS = [
    '.i18n-switch{display:inline-flex;align-items:center;gap:1px;padding:2px;border-radius:999px;',
    'border:1px solid rgba(128,128,128,.38);background:rgba(128,128,128,.14);',
    'font:12px/1 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;',
    'vertical-align:middle;z-index:9000;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}',
    '.i18n-switch button{border:0;background:transparent;color:inherit;opacity:.62;cursor:pointer;',
    'padding:5px 9px;border-radius:999px;font:inherit;line-height:1;letter-spacing:0}',
    '.i18n-switch button:hover{opacity:1}',
    '.i18n-switch button.on{background:var(--accent,#f2620a);color:#fff;opacity:1}',
    '.i18n-switch.i18n-fixed{position:fixed;top:10px;right:10px}',
    '.i18n-switch.i18n-inline{margin-left:auto}',
    'html[data-lang="en"] .i18n-switch button{padding:5px 11px}',
    '@media (max-width:520px){.i18n-switch.i18n-fixed{top:8px;right:8px;transform:scale(.94);transform-origin:top right}}'
  ].join('');

  function buildSwitch() {
    if (document.getElementById('i18nSwitch')) { return; }
    var st = document.createElement('style');
    st.id = 'i18nSwitchStyle';
    st.textContent = CSS;
    document.head.appendChild(st);

    var box = document.createElement('div');
    box.id = 'i18nSwitch';
    box.className = 'i18n-switch';
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', 'Language / 语言');
    ['hans', 'en', 'hant'].forEach(function (k) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = LABEL[k];
      b.setAttribute('data-lang', k);
      b.title = { hans: '简体中文', en: 'English', hant: '繁體中文' }[k];
      if (k === lang) { b.className = 'on'; }
      b.addEventListener('click', function () {
        try { localStorage.setItem(KEY, k); } catch (e) { /* 忽略 */ }
        var u = new URL(location.href);
        u.searchParams.set('lang', k);
        location.href = u.toString();
      });
      box.appendChild(b);
    });

    // 看板首页：放在「工具」旁边（不能放进 <details>，收起时会一起隐藏）
    var tl = document.querySelector('.topline');
    if (tl) {
      tl.insertBefore(box, tl.querySelector('.tools-menu'));
      box.classList.add('i18n-inline');
      return;
    }
    var hosts = ['.lp-top-actions', '.help-top'];
    for (var i = 0; i < hosts.length; i++) {
      var el = document.querySelector(hosts[i]);
      if (el) { el.insertBefore(box, el.firstChild); return; }
    }
    box.classList.add('i18n-fixed');
    document.body.appendChild(box);
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    patchECharts();
    applyHead();
    applyTree(document.body || document.documentElement);
    startObserver();
    buildSwitch();
  }

  window.I18N = {
    lang: lang,
    t: tr,
    apply: function (root) { applyTree(root || document.body); }
  };

  // 尽早打补丁：ECharts 在 DOMContentLoaded 后才建图，这里先包好 init
  patchECharts();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
