/* 本机存储层（账户层）
 *
 * 与微信读书插件同构的心智：
 *   账户码 = 账号 + 登录凭证（一体），本机唯一持有。首次访问自动生成、长期复用。
 *   本机只存账户码 / 掩码 / 昵称；AI Key 明文**不落本机**，只交本机服务加密托管。
 *
 * 键说明（同域名同 origin，看板页与账户页共用同一套键 → 登录态天然互通）：
 *   coros_account_id        账户码（32 位十六进制）
 *   coros_account_endpoint  服务地址（默认空 = 同源；将来换云函数只改这里）
 *   coros_account_mask      掩码缓存 { masked, hasKey, aiMasked... }
 *   coros_account_profile   昵称缓存 { nickName }
 *   coros_h5_cache_*        接口临时缓存（带 TTL）
 *   coros_font_scale        字号档位
 *   coros_theme             外观模式（time 按时间 / auto 跟随系统 / dark / light；默认 time）
 */
window.CorosStore = (function () {
  var DEVICE_KEY = 'coros_account_id';
  var ENDPOINT_KEY = 'coros_account_endpoint';
  var MASK_KEY = 'coros_account_mask';
  var PROFILE_KEY = 'coros_account_profile';
  var CACHE_PREFIX = 'coros_h5_cache_';
  var FONT_KEY = 'coros_font_scale';
  var THEME_KEY = 'coros_theme';

  function randomHex(bytes) {
    var arr = new Uint8Array(bytes || 16);
    var c = window.crypto || window.msCrypto;
    if (c && c.getRandomValues) {
      c.getRandomValues(arr);
    } else {
      for (var i = 0; i < arr.length; i += 1) { arr[i] = Math.floor(Math.random() * 256); }
    }
    return Array.prototype.map.call(arr, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  /** 账户码：首次访问生成一次（32 位十六进制），之后长期复用；即账号 + 登录凭证 */
  function getDeviceId() {
    var id = '';
    try { id = localStorage.getItem(DEVICE_KEY) || ''; } catch (e) { id = ''; }
    if (!id) {
      id = randomHex(16);
      try { localStorage.setItem(DEVICE_KEY, id); } catch (e) { /* 隐私模式：本次会话用内存值 */ }
    }
    return id;
  }

  /** 用账户码登录（须为 32 位十六进制）。成功返回 true */
  function setDeviceId(id) {
    var value = String(id || '').trim().toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(value)) { return false; }
    try {
      localStorage.setItem(DEVICE_KEY, value);
      localStorage.removeItem(MASK_KEY);   // 换账户后掩码失效，重新向服务端确认
    } catch (e) { return false; }
    return true;
  }

  /** 退出登录：清空本机账户码 / 掩码 / 昵称（服务端数据原封不动，可凭原账户码登回） */
  function resetDeviceId() {
    try {
      localStorage.removeItem(DEVICE_KEY);
      localStorage.removeItem(MASK_KEY);
      localStorage.removeItem(PROFILE_KEY);
    } catch (e) { /* 忽略 */ }
  }

  /** 服务地址：网址参数 > 本机保存 > 空（同源） */
  function getEndpoint() {
    var fromQuery = '';
    try { fromQuery = new URLSearchParams(location.search).get('endpoint') || ''; } catch (e) { fromQuery = ''; }
    if (fromQuery) { setEndpoint(fromQuery); return fromQuery.replace(/\/+$/, ''); }
    var saved = '';
    try { saved = localStorage.getItem(ENDPOINT_KEY) || ''; } catch (e) { saved = ''; }
    return String(saved || '').replace(/\/+$/, '');
  }

  function setEndpoint(url) {
    try { localStorage.setItem(ENDPOINT_KEY, String(url || '').trim().replace(/\/+$/, '')); } catch (e) { /* 忽略 */ }
  }

  /** 把接口路径拼成完整地址（同源时就是相对路径） */
  function apiUrl(path) {
    var base = getEndpoint();
    return base ? base + '/' + String(path).replace(/^\/+/, '') : path;
  }

  function getMask() {
    try { var raw = localStorage.getItem(MASK_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function setMask(mask) {
    try {
      if (mask) { localStorage.setItem(MASK_KEY, JSON.stringify(mask)); }
      else { localStorage.removeItem(MASK_KEY); }
    } catch (e) { /* 忽略 */ }
  }

  function getProfile() {
    try {
      var raw = localStorage.getItem(PROFILE_KEY);
      var p = raw ? JSON.parse(raw) : null;
      if (p && typeof p === 'object') { return { nickName: String(p.nickName || '') }; }
    } catch (e) { /* 忽略 */ }
    return { nickName: '' };
  }
  function setProfile(profile) {
    var p = profile || {};
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify({ nickName: String(p.nickName || '').slice(0, 24) })); } catch (e) { /* 忽略 */ }
  }

  // ---- 通用缓存（带 TTL）----
  function cacheGet(key, ttlMs) {
    try {
      var raw = localStorage.getItem(CACHE_PREFIX + key);
      if (!raw) { return null; }
      var obj = JSON.parse(raw);
      if (!obj || typeof obj.at !== 'number') { return null; }
      if (ttlMs && Date.now() - obj.at > ttlMs) { return null; }
      return obj.value;
    } catch (e) { return null; }
  }
  function cacheSet(key, value) {
    try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ at: Date.now(), value: value })); } catch (e) { /* 忽略 */ }
  }
  function cacheClear(key) {
    try { localStorage.removeItem(CACHE_PREFIX + key); } catch (e) { /* 忽略 */ }
  }

  // ---- 字号档位（仅本机偏好，改后即刻生效）----
  var FONT_TIERS = [
    { key: 'sm', label: '小', value: 0.9 },
    { key: 'md', label: '标准', value: 1 },
    { key: 'lg', label: '大', value: 1.15 },
    { key: 'xl', label: '特大', value: 1.3 }
  ];
  function normalizeScale(v) {
    v = Number(v);
    for (var i = 0; i < FONT_TIERS.length; i += 1) { if (FONT_TIERS[i].value === v) { return v; } }
    return 1;
  }
  function getFontScale() {
    try { return normalizeScale(localStorage.getItem(FONT_KEY)); } catch (e) { return 1; }
  }
  function setFontScale(value) {
    var v = normalizeScale(value);
    try { localStorage.setItem(FONT_KEY, String(v)); } catch (e) { /* 忽略 */ }
    return v;
  }
  /** 应用字号：写 CSS 变量 --coros-fs，由 .wrap 的 zoom 生效 */
  function applyFontScale(value) {
    var v = (value === undefined) ? getFontScale() : setFontScale(value);
    try { document.documentElement.style.setProperty('--coros-fs', String(v)); } catch (e) { /* 忽略 */ }
    return v;
  }

  // ---- 外观主题（仅本机偏好）----
  // 四种「模式」：auto=跟随系统、time=按时间段、dark/light=手动指定。
  // 存的是「模式」，渲染到 <html> 的 data-theme 是解析后的实际外观（dark / light）。
  var THEME_TIERS = [
    { key: 'time', label: '按时间' },
    { key: 'auto', label: '跟随系统' },
    { key: 'dark', label: '夜间' },
    { key: 'light', label: '白天' }
  ];
  var THEME_KEYS = { auto: true, time: true, dark: true, light: true };
  var THEME_COLOR = { dark: '#08090b', light: '#f4efe6' };
  var DAY_START = 7;   // 白天时段：7:00（含）
  var DAY_END = 19;    // 到 19:00（不含），其余为黑夜
  function normalizeTheme(v) { return THEME_KEYS[v] ? v : 'time'; }
  function getTheme() {
    try { return normalizeTheme(localStorage.getItem(THEME_KEY)); } catch (e) { return 'time'; }
  }
  function setTheme(value) {
    var v = normalizeTheme(value);
    try { localStorage.setItem(THEME_KEY, v); } catch (e) { /* 忽略 */ }
    return v;
  }
  function systemPrefersLight() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches); } catch (e) { return false; }
  }
  function isDaytime(now) {
    var h = (now || new Date()).getHours();
    return h >= DAY_START && h < DAY_END;
  }
  /** 把「模式」解析成实际外观 dark / light */
  function resolveTheme(mode) {
    var m = (mode === undefined) ? getTheme() : normalizeTheme(mode);
    if (m === 'light' || m === 'dark') { return m; }
    if (m === 'time') { return isDaytime() ? 'light' : 'dark'; }
    return systemPrefersLight() ? 'light' : 'dark';   // auto：跟随系统
  }

  var themeSubs = [];
  var lastResolved = null;
  /** 渲染当前模式对应的外观；解析结果变化时通知订阅者（如重绘图表、同步图标） */
  function syncTheme() {
    var v = resolveTheme();
    try {
      document.documentElement.setAttribute('data-theme', v);
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) { meta.setAttribute('content', THEME_COLOR[v]); }
    } catch (e) { /* 忽略 */ }
    if (v !== lastResolved) {
      lastResolved = v;
      for (var i = 0; i < themeSubs.length; i += 1) { try { themeSubs[i](v); } catch (e) { /* 忽略 */ } }
    }
    return v;
  }
  /** 订阅「实际外观变化」：自动模式下系统/时间触发切换时回调，返回取消订阅函数 */
  function onThemeChange(cb) {
    if (typeof cb !== 'function') { return function () {}; }
    themeSubs.push(cb);
    return function () {
      var i = themeSubs.indexOf(cb);
      if (i >= 0) { themeSubs.splice(i, 1); }
    };
  }
  var themeWatched = false;
  /** 绑定自动模式的监听：系统外观变化即时生效；按时间模式每分钟核对（跨过白天/黑夜分界即切换） */
  function watchAutoTheme() {
    if (themeWatched) { return; }
    themeWatched = true;
    try {
      var mq = window.matchMedia('(prefers-color-scheme: light)');
      var onChange = function () { if (getTheme() === 'auto') { syncTheme(); } };
      if (mq.addEventListener) { mq.addEventListener('change', onChange); }
      else if (mq.addListener) { mq.addListener(onChange); }
    } catch (e) { /* 忽略 */ }
    try {
      setInterval(function () { if (getTheme() === 'time') { syncTheme(); } }, 60000);
    } catch (e) { /* 忽略 */ }
  }
  /** 应用主题：value 传「模式」则先保存；不传则按已存模式渲染。返回实际外观（dark / light） */
  function applyTheme(value) {
    if (value !== undefined) { setTheme(value); }
    watchAutoTheme();
    return syncTheme();
  }

  // ---- 简笔图标（与 logo 同一套线条语言：单线、圆头、无填充）----
  var THEME_ICON = {
    sun: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.1"/><path d="M12 2.8v2.2M12 19v2.2M2.8 12h2.2M19 12h2.2M5.5 5.5l1.6 1.6M16.9 16.9l1.6 1.6M18.5 5.5l-1.6 1.6M7.1 16.9l-1.6 1.6"/></svg>',
    moon: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.2 14.6A8.6 8.6 0 0 1 9.4 3.8 8.7 8.7 0 1 0 20.2 14.6z"/></svg>'
  };
  /** 把主题按钮画成月亮 / 太阳；label 传了就在图标后补一段文字 */
  function paintThemeIcon(btn, label) {
    if (!btn) { return; }
    var light = document.documentElement.getAttribute('data-theme') === 'light';
    btn.innerHTML = THEME_ICON[light ? 'sun' : 'moon'] + (label ? '<span>' + label + '</span>' : '');
  }

  return {
    getDeviceId: getDeviceId, setDeviceId: setDeviceId, resetDeviceId: resetDeviceId,
    paintThemeIcon: paintThemeIcon,
    getEndpoint: getEndpoint, setEndpoint: setEndpoint, apiUrl: apiUrl,
    getMask: getMask, setMask: setMask, getProfile: getProfile, setProfile: setProfile,
    cacheGet: cacheGet, cacheSet: cacheSet, cacheClear: cacheClear,
    FONT_TIERS: FONT_TIERS, getFontScale: getFontScale, setFontScale: setFontScale, applyFontScale: applyFontScale,
    THEME_TIERS: THEME_TIERS, getTheme: getTheme, setTheme: setTheme, applyTheme: applyTheme,
    resolveTheme: resolveTheme, onThemeChange: onThemeChange
  };
})();
