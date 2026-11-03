/* 马拉松配速计算器（复刻 COROS 应用「配速计算」的设计）
 *
 * 纯函数、零依赖。模型（与官方应用输出一致的算法）：
 *   ① 即时跑力 = 丹尼尔斯 VDOT：由「距离 + 用时」用丹尼尔斯公式**直接算**（非查表）；
 *   ② 赛事预测：保持同一 VDOT，**反解**各标准距离（全马 / 半马 / 10K / 5K）的用时应为多少；
 *   ③ 训练参考：五区配速，按 vVO₂max（VDOT 对应的最大摄氧速度）**固定百分比**换算：
 *        Easy 69% ~ 75%、Marathon 85%、Threshold 90%、Interval 98.6%、Repetition 105.8%；
 *   ④ 配速区间：同一配速换算到 1km / 1Mile / 800m / 400m（1 Mile = 1.609344 km）。
 *
 * 口径参照杰克·丹尼尔斯《Running Formula》第 3 版；数字仅供训练参考，非医疗建议。
 * 数字式输入：浅灰框里只敲数字即可——415 → 4:15，25920 → 2:59:20（从右往左按「秒/分/时」两位一组）。
 */
(function () {
  'use strict';

  var MILE_KM = 1.609344;

  // 距离档位（key 稳定用于逻辑；cn 用于界面显示）
  var DISTS = [
    { key: 'Marathon', cn: '全马', km: 42.195, kmLabel: '42.195' },
    { key: 'Half Marathon', cn: '半马', km: 21.0975, kmLabel: '21.0975' },
    { key: '10K', cn: '10 公里', km: 10, kmLabel: '10' },
    { key: '5K', cn: '5 公里', km: 5, kmLabel: '5' },
    { key: '1500m', cn: '1500 米', km: 1.5, kmLabel: '1.5' }
  ];
  // 赛事预测展示的标准距离（最长在前）
  var PREDICT = ['Marathon', 'Half Marathon', '10K', '5K'];
  // 训练五区：hi/lo 为「占 vVO₂max 的百分比」（hi=更快一档）；v 为单值区间
  var ZONES = [
    { name: '轻松跑', hi: 0.75, lo: 0.69, gold: true },
    { name: '马拉松配速', v: 0.85 },
    { name: '阈值跑', v: 0.90, dim: true },
    { name: '间歇跑', v: 0.986, dim: true },
    { name: '重复跑', v: 1.058, dim: true }
  ];

  // ---------- 丹尼尔斯公式（纯函数） ----------
  function vo2At(v) { return -4.6 + 0.182258 * v + 0.000104 * v * v; }   // v: m/min
  function pctMax(tMin) {
    return 0.8 + 0.1894393 * Math.exp(-0.012778 * tMin) + 0.2989558 * Math.exp(-0.1932605 * tMin);
  }
  /** 由「距离(m) + 用时(s)」算 VDOT（即官方所说的「跑力」） */
  function vdotOf(distM, sec) {
    if (!(distM > 0) || !(sec > 0)) { return null; }
    var tMin = sec / 60;
    return vo2At(distM / tMin) / pctMax(tMin);
  }
  /** VDOT → 最大摄氧速度（m/min）：解 -4.6 + 0.182258v + 0.000104v² = VDOT */
  function vdotVelocity(vdot) {
    var a = 0.000104, b = 0.182258, c = -(vdot + 4.6);
    return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
  }
  /** 保持 targetVdot 不变，反解 distM 对应用时（二分；用时越长 VDOT 越低） */
  function predictTime(targetVdot, distM) {
    var lo = 60, hi = 60 * 60 * 8, mid, vd;
    for (var i = 0; i < 120; i += 1) {
      mid = (lo + hi) / 2;
      vd = vdotOf(distM, mid);
      if (vd > targetVdot) { lo = mid; } else { hi = mid; }
    }
    return (lo + hi) / 2;
  }

  // ---------- 格式化 / 数字输入解析 ----------
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  /** 秒 → 表格用（不补零）：4:15 / 2:59:20 */
  function fmtClock(sec) {
    sec = Math.round(sec);
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h > 0 ? h + ':' + p2(m) + ':' + p2(s) : m + ':' + p2(s);
  }
  /** 秒 → 输入框用（补零到两位）：04:15 / 02:59:20 */
  function fmtPad(sec) {
    sec = Math.round(sec);
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h > 0 ? p2(h) + ':' + p2(m) + ':' + p2(s) : p2(m) + ':' + p2(s);
  }
  function digitsOf(str) { return String(str == null ? '' : str).replace(/\D/g, ''); }
  /** 数字串 → 秒：从右往左两位一组（秒 / 分 / 时），如 415 → 4:15、25920 → 2:59:20 */
  function secFromDigits(d) {
    d = String(d || '').slice(0, 6);
    var s = parseInt(d.slice(-2), 10) || 0;
    var m = parseInt(d.slice(-4, -2), 10) || 0;
    var h = parseInt(d.slice(0, -4), 10) || 0;
    return h * 3600 + m * 60 + s;
  }

  // ---------- 一次性算出全部结果 ----------
  function compute(km, timeSec) {
    if (!(km > 0) || !(timeSec > 0)) { return null; }
    var distM = km * 1000;
    var pace = timeSec / km;                       // s/km
    var vdot = vdotOf(distM, timeSec);
    var vv = vdot == null ? null : vdotVelocity(vdot);

    var zones = null;
    if (vv) {
      zones = ZONES.map(function (z) {
        if (z.hi != null) {
          var fKm = 60000 / (z.hi * vv), sKm = 60000 / (z.lo * vv);
          return { name: z.name, gold: z.gold, range: true,
            km1: fKm, km2: sKm, mile1: fKm * MILE_KM, mile2: sKm * MILE_KM };
        }
        var pKm = 60000 / (z.v * vv);
        return { name: z.name, dim: z.dim, range: false, km1: pKm, mile1: pKm * MILE_KM };
      });
    }

    var pred = null;
    if (vdot != null) {
      pred = PREDICT.map(function (k) {
        var d = distByKey(k);
        var t = predictTime(vdot, d.km * 1000);
        return { key: k, time: t, paceKm: t / d.km, paceMi: (t / d.km) * MILE_KM };
      });
    }

    return { km: km, pace: pace, vdot: vdot, zones: zones, pred: pred };
  }

  function distByKey(key) {
    for (var i = 0; i < DISTS.length; i += 1) { if (DISTS[i].key === key) { return DISTS[i]; } }
    return DISTS[0];
  }
  /** 距离 key → 中文显示名（全马 / 半马 / 10 公里 / 5 公里 / 1500 米） */
  function cnByKey(key) { return distByKey(key).cn; }

  var api = {
    MILE_KM: MILE_KM, DISTS: DISTS, PREDICT: PREDICT, ZONES: ZONES,
    vdotOf: vdotOf, vdotVelocity: vdotVelocity, predictTime: predictTime,
    fmtClock: fmtClock, fmtPad: fmtPad, secFromDigits: secFromDigits, compute: compute
  };
  if (typeof window !== 'undefined') { window.CorosPace = api; }

  // ========================================================================
  // 以下为页面交互（无 DOM 环境时自动跳过，便于纯函数单测）
  // ========================================================================
  if (typeof document === 'undefined' || !document.getElementById) { return; }

  function $(id) { return document.getElementById(id); }

  var state = {
    distKey: 'Marathon',
    timeSec: 10760,          // 2:59:20
    paceSecPerKm: 255,       // 4:15/km
    paceUnit: 'km',
    cadence: 180,            // 步/分
    strideCm: 131            // 厘米
  };

  var elDistBtn = $('distBtn'), elDistLabel = $('distLabel'),
      elTime = $('timeInput'), elPace = $('paceInput'), elUnit = $('paceUnit'),
      elUnitLabel = $('paceUnitLabel'), elCad = $('cadInput'), elStride = $('strideInput'),
      elTitle = $('raceTitle'), elSub = $('raceSub'), elPower = $('powerVal'),
      elInterval = $('intervalTbl'), elRef = $('refTbl'), elPred = $('predTbl'),
      elMask = $('distMask'), elSheetList = $('sheetList'), elSheetCur = $('sheetCur');

  function distKm() { return distByKey(state.distKey).km; }

  /** 步幅（厘米）= 速度(m/min) ÷ 步频 × 100，速度 = 60000 ÷ 配速(s/km) */
  function strideFromPace() {
    var spm = state.cadence > 0 ? state.cadence : 180;
    state.strideCm = Math.round((60000 / state.paceSecPerKm) / spm * 100);
  }

  function renderInterval(km, timeSec, pace, label) {
    var rows = [
      { l: label, v: fmtClock(timeSec), cls: 'gold' },
      { l: '1 公里', v: fmtClock(pace), cls: '' },
      { l: '1 英里', v: fmtClock(pace * MILE_KM), cls: '' },
      { l: '800 米', v: fmtClock(pace * 0.8), cls: 'dim' },
      { l: '400 米', v: fmtClock(pace * 0.4), cls: 'dim' }
    ];
    elInterval.innerHTML = '<thead><tr><th>距离</th><th>用时</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr class="' + r.cls + '"><td class="' + r.cls + '">' + r.l + '</td><td class="' + r.cls + '">' + r.v + '</td></tr>';
      }).join('') + '</tbody>';
  }

  function renderRef(zones) {
    if (!zones) { elRef.innerHTML = ''; return; }
    elRef.innerHTML = '<thead><tr><th>类型</th><th>1 公里</th><th>1 英里</th></tr></thead><tbody>' +
      zones.map(function (z) {
        var cls = z.gold ? 'gold' : (z.dim ? 'dim' : '');
        var kmTxt = z.range ? fmtClock(z.km1) + ' ~ ' + fmtClock(z.km2) : fmtClock(z.km1);
        var miTxt = z.range ? fmtClock(z.mile1) + ' ~ ' + fmtClock(z.mile2) : fmtClock(z.mile1);
        return '<tr><td class="' + cls + '">' + z.name + '</td>' +
               '<td class="' + cls + '">' + kmTxt + '</td>' +
               '<td class="' + cls + '">' + miTxt + '</td></tr>';
      }).join('') + '</tbody>';
  }

  function renderPred(pred, curKey) {
    if (!pred) { elPred.innerHTML = ''; return; }
    elPred.innerHTML = '<thead><tr><th>项目</th><th>用时</th><th>配速/km</th><th>配速/mi</th></tr></thead><tbody>' +
      pred.map(function (r) {
        var cls = r.key === curKey ? 'gold' : '';
        return '<tr><td class="' + cls + '">' + cnByKey(r.key) + '</td>' +
               '<td class="' + cls + '">' + fmtClock(r.time) + '</td>' +
               '<td class="' + cls + '">' + fmtClock(r.paceKm) + '</td>' +
               '<td class="' + cls + '">' + fmtClock(r.paceMi) + '</td></tr>';
      }).join('') + '</tbody>';
  }

  function render() {
    var km = distKm(), timeSec = state.timeSec, pace = state.paceSecPerKm;
    var res = compute(km, timeSec);
    var d = distByKey(state.distKey);

    elDistLabel.textContent = d.cn;
    elSheetCur.textContent = d.cn;
    elTitle.textContent = d.cn;
    elSub.textContent = d.kmLabel + ' km · ' + fmtPad(pace) + ' /km';
    elPower.textContent = res && res.vdot != null ? res.vdot.toFixed(1) : '—';

    renderInterval(km, timeSec, pace, d.cn);
    renderRef(res && res.zones);
    renderPred(res && res.pred, state.distKey);

    // 输入框回填（不打断结果区）
    elTime.value = fmtPad(timeSec);
    elPace.value = fmtPad(state.paceUnit === 'mi' ? pace * MILE_KM : pace);
    elUnitLabel.textContent = state.paceUnit;
    elCad.value = state.cadence;
    elStride.value = state.strideCm;
  }

  // ---------- 事件 ----------
  elTime.addEventListener('input', function () {
    var d = digitsOf(this.value);
    if (!d) { return; }
    state.timeSec = secFromDigits(d);
    state.paceSecPerKm = state.timeSec / distKm();
    strideFromPace();
    render();
  });

  elPace.addEventListener('input', function () {
    var d = digitsOf(this.value);
    if (!d) { return; }
    var perUnit = secFromDigits(d);                       // 秒 / 当前单位
    var sPerKm = state.paceUnit === 'mi' ? perUnit / MILE_KM : perUnit;
    if (!(sPerKm > 0)) { return; }
    state.paceSecPerKm = sPerKm;
    state.timeSec = sPerKm * distKm();
    strideFromPace();
    render();
  });

  elUnit.addEventListener('click', function () {
    state.paceUnit = state.paceUnit === 'km' ? 'mi' : 'km';
    render();
  });

  elCad.addEventListener('input', function () {
    var n = parseInt(digitsOf(this.value), 10);
    if (!(n > 0)) { return; }
    state.cadence = Math.min(n, 300);
    strideFromPace();
    render();
  });

  elStride.addEventListener('input', function () {
    var n = parseInt(digitsOf(this.value), 10);
    if (!(n > 0)) { return; }
    var spm = Math.round((60000 / state.paceSecPerKm) / (n / 100));
    if (!(spm > 0)) { return; }
    state.cadence = Math.min(spm, 300);
    state.strideCm = n;
    render();
  });

  // 距离下拉（弹层）
  var mask = elMask;
  function openSheet() { renderSheet(); mask.hidden = false; }
  function closeSheet() { mask.hidden = true; }
  function renderSheet() {
    elSheetList.innerHTML = DISTS.map(function (d) {
      var on = d.key === state.distKey;
      return '<div class="sheet-item' + (on ? ' on' : '') + '" role="option" data-key="' + d.key + '">' +
             '<span>' + d.cn + '</span>' + (on ? '<span class="ck">✓</span>' : '') + '</div>';
    }).join('');
  }

  elDistBtn.addEventListener('click', openSheet);
  mask.addEventListener('click', function (e) {
    if (e.target === mask) { closeSheet(); return; }
    var item = e.target.closest ? e.target.closest('.sheet-item') : null;
    if (!item) { return; }
    var d = distByKey(item.getAttribute('data-key'));
    state.distKey = d.key;
    state.timeSec = state.paceSecPerKm * d.km;   // 保持配速不变，用时应距离而变
    closeSheet();
    render();
  });
  renderSheet();   // 首次即渲染，避免下拉打开时空白

  render();
})();
