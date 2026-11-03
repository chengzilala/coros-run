// 跑力五区配速（丹尼尔斯 VDOT）—— 移植自 tools/pace.py（表与算法逐项对照，结果一致）
//
// 输入：高驰完赛预测 { "Half Marathon": "1:42:14", ... }；输出：五区配速或 null。

// 丹尼尔斯 VDOT 对照表（第 3 版 Table 3.1 & 3.2）
// 时间单位: 秒 | 配速单位: 秒/公里 | I/R 为对应距离用时（秒）
const VDOT_TABLE = {
  30: { race: { '5K': 1860, '10K': 3876, half: 8640, full: 17820 }, pace: { E: [462, 498], M: 426, T: 402, I_400: 144, I_1000: 375, R_200: 66, R_400: 138 } },
  31: { race: { '5K': 1800, '10K': 3750, half: 8352, full: 17220 }, pace: { E: [450, 486], M: 414, T: 390, I_400: 140, I_1000: 365, R_200: 64, R_400: 134 } },
  32: { race: { '5K': 1740, '10K': 3630, half: 8082, full: 16656 }, pace: { E: [438, 474], M: 402, T: 381, I_400: 137, I_1000: 356, R_200: 63, R_400: 131 } },
  33: { race: { '5K': 1686, '10K': 3516, half: 7830, full: 16128 }, pace: { E: [426, 462], M: 393, T: 372, I_400: 133, I_1000: 347, R_200: 61, R_400: 128 } },
  34: { race: { '5K': 1632, '10K': 3408, half: 7590, full: 15636 }, pace: { E: [417, 450], M: 384, T: 363, I_400: 130, I_1000: 339, R_200: 60, R_400: 125 } },
  35: { race: { '5K': 1578, '10K': 3300, half: 7356, full: 15168 }, pace: { E: [405, 441], M: 375, T: 354, I_400: 127, I_1000: 331, R_200: 58, R_400: 122 } },
  36: { race: { '5K': 1530, '10K': 3198, half: 7134, full: 14724 }, pace: { E: [396, 429], M: 366, T: 348, I_400: 124, I_1000: 324, R_200: 57, R_400: 120 } },
  37: { race: { '5K': 1482, '10K': 3102, half: 6924, full: 14304 }, pace: { E: [387, 420], M: 360, T: 339, I_400: 121, I_1000: 317, R_200: 56, R_400: 117 } },
  38: { race: { '5K': 1434, '10K': 3006, half: 6726, full: 13908 }, pace: { E: [378, 411], M: 351, T: 333, I_400: 119, I_1000: 310, R_200: 55, R_400: 115 } },
  39: { race: { '5K': 1392, '10K': 2916, half: 6534, full: 13530 }, pace: { E: [369, 402], M: 345, T: 327, I_400: 116, I_1000: 304, R_200: 54, R_400: 112 } },
  40: { race: { '5K': 1350, '10K': 2832, half: 6348, full: 13170 }, pace: { E: [363, 396], M: 339, T: 321, I_400: 114, I_1000: 298, R_200: 53, R_400: 110 } },
  41: { race: { '5K': 1308, '10K': 2748, half: 6174, full: 12828 }, pace: { E: [354, 387], M: 333, T: 315, I_400: 112, I_1000: 292, R_200: 52, R_400: 108 } },
  42: { race: { '5K': 1272, '10K': 2670, half: 6006, full: 12498 }, pace: { E: [348, 378], M: 327, T: 309, I_400: 110, I_1000: 287, R_200: 51, R_400: 106 } },
  43: { race: { '5K': 1236, '10K': 2592, half: 5844, full: 12186 }, pace: { E: [339, 372], M: 321, T: 306, I_400: 108, I_1000: 282, R_200: 50, R_400: 104 } },
  44: { race: { '5K': 1200, '10K': 2520, half: 5694, full: 11886 }, pace: { E: [333, 363], M: 318, T: 300, I_400: 106, I_1000: 277, R_200: 49, R_400: 102 } },
  45: { race: { '5K': 1170, '10K': 2454, half: 5550, full: 11598 }, pace: { E: [327, 357], M: 312, T: 294, I_400: 104, I_1000: 272, R_200: 48, R_400: 100 } },
  46: { race: { '5K': 1140, '10K': 2388, half: 5412, full: 11322 }, pace: { E: [321, 351], M: 309, T: 291, I_400: 102, I_1000: 268, R_200: 47, R_400: 99 } },
  47: { race: { '5K': 1110, '10K': 2328, half: 5280, full: 11058 }, pace: { E: [315, 345], M: 303, T: 285, I_400: 101, I_1000: 264, R_200: 47, R_400: 97 } },
  48: { race: { '5K': 1080, '10K': 2268, half: 5154, full: 10806 }, pace: { E: [309, 339], M: 300, T: 282, I_400: 99, I_1000: 260, R_200: 46, R_400: 96 } },
  49: { race: { '5K': 1056, '10K': 2214, half: 5034, full: 10560 }, pace: { E: [306, 333], M: 294, T: 279, I_400: 98, I_1000: 256, R_200: 45, R_400: 94 } },
  50: { race: { '5K': 1032, '10K': 2160, half: 4920, full: 10326 }, pace: { E: [300, 330], M: 291, T: 275, I_400: 96, I_1000: 252, R_200: 45, R_400: 93 } },
  51: { race: { '5K': 1008, '10K': 2112, half: 4812, full: 10104 }, pace: { E: [294, 324], M: 288, T: 272, I_400: 95, I_1000: 249, R_200: 44, R_400: 92 } },
  52: { race: { '5K': 984, '10K': 2064, half: 4710, full: 9888 }, pace: { E: [291, 318], M: 285, T: 268, I_400: 94, I_1000: 246, R_200: 43, R_400: 90 } },
  53: { race: { '5K': 960, '10K': 2016, half: 4608, full: 9684 }, pace: { E: [285, 315], M: 279, T: 265, I_400: 92, I_1000: 243, R_200: 43, R_400: 89 } },
  54: { race: { '5K': 942, '10K': 1974, half: 4512, full: 9486 }, pace: { E: [282, 309], M: 276, T: 262, I_400: 91, I_1000: 240, R_200: 42, R_400: 88 } },
  55: { race: { '5K': 918, '10K': 1932, half: 4416, full: 9300 }, pace: { E: [276, 306], M: 273, T: 258, I_400: 90, I_1000: 237, R_200: 42, R_400: 87 } },
  56: { race: { '5K': 900, '10K': 1890, half: 4326, full: 9120 }, pace: { E: [273, 300], M: 270, T: 255, I_400: 89, I_1000: 234, R_200: 41, R_400: 86 } },
  57: { race: { '5K': 882, '10K': 1854, half: 4242, full: 8946 }, pace: { E: [270, 297], M: 267, T: 252, I_400: 88, I_1000: 231, R_200: 41, R_400: 85 } },
  58: { race: { '5K': 864, '10K': 1818, half: 4158, full: 8784 }, pace: { E: [267, 294], M: 264, T: 249, I_400: 87, I_1000: 228, R_200: 40, R_400: 84 } },
  59: { race: { '5K': 846, '10K': 1782, half: 4080, full: 8622 }, pace: { E: [264, 291], M: 261, T: 246, I_400: 86, I_1000: 226, R_200: 40, R_400: 83 } },
  60: { race: { '5K': 834, '10K': 1746, half: 4002, full: 8472 }, pace: { E: [261, 288], M: 258, T: 243, I_400: 85, I_1000: 224, R_200: 39, R_400: 82 } },
  65: { race: { '5K': 762, '10K': 1602, half: 3678, full: 7800 }, pace: { E: [246, 270], M: 243, T: 231, I_400: 81, I_1000: 213, R_200: 37, R_400: 78 } }
};

const COROS_KEY = { '5 km': '5K', '10 km': '10K', 'Half Marathon': 'half', 'Marathon': 'full' };
const ANCHOR_ORDER = ['Half Marathon', '10 km', '5 km', 'Marathon'];
const ANCHOR_LABEL = { 'Half Marathon': '半马', '10 km': '10 km', '5 km': '5 km', 'Marathon': '全马' };

function fmtTime(seconds) {
  seconds = Math.round(seconds);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return h + ':' + pad2(m) + ':' + pad2(s);
  return m + ':' + pad2(s);
}

function fmtPace(secPerKm) {
  secPerKm = Math.round(secPerKm);
  return Math.floor(secPerKm / 60) + ':' + pad2(secPerKm % 60);
}

function pad2(n) { return (n < 10 ? '0' : '') + n; }

function parseTime(timeStr) {
  if (!timeStr) return null;
  const parts = String(timeStr).trim().split(':');
  const nums = parts.map(function (p) { return parseInt(p, 10); });
  if (nums.some(function (n) { return isNaN(n); })) return null;
  if (parts.length === 3) return nums[0] * 3600 + nums[1] * 60 + nums[2];
  if (parts.length === 2) return nums[0] * 60 + nums[1];
  return null;
}

function vdotKeys() {
  return Object.keys(VDOT_TABLE).map(Number).sort(function (a, b) { return a - b; });
}

/** 按距离 + 成绩查最接近的 VDOT；超出对照表范围抛错（不静默钳制）。 */
function lookupVdot(distKey, seconds) {
  if (['5K', '10K', 'half', 'full'].indexOf(distKey) < 0) {
    throw new Error('不支持的距离: ' + distKey);
  }
  const vdots = vdotKeys();
  const slowest = VDOT_TABLE[vdots[0]].race[distKey];
  const fastest = VDOT_TABLE[vdots[vdots.length - 1]].race[distKey];
  if (seconds > slowest || seconds < fastest) {
    throw new Error('成绩 ' + fmtTime(seconds) + ' 超出 VDOT 表范围(' + distKey + ')');
  }
  let bestV = vdots[0];
  let bestDiff = null;
  vdots.forEach(function (v) {
    const diff = Math.abs(VDOT_TABLE[v].race[distKey] - seconds);
    if (bestDiff === null || diff < bestDiff) { bestV = v; bestDiff = diff; }
  });
  return bestV;
}

/** VDOT → 五区配速（格式化字符串） */
function pacesForVdot(vdot) {
  const vdots = vdotKeys();
  if (!VDOT_TABLE[vdot]) {
    vdot = vdots.reduce(function (best, v) {
      return Math.abs(v - vdot) < Math.abs(best - vdot) ? v : best;
    }, vdots[0]);
  }
  const p = VDOT_TABLE[vdot].pace;
  return {
    vdot: vdot,
    E: fmtPace(p.E[0]) + '~' + fmtPace(p.E[1]),
    M: fmtPace(p.M),
    T: fmtPace(p.T),
    I400: fmtTime(p.I_400),
    I1000: fmtTime(p.I_1000),
    R200: fmtTime(p.R_200),
    R400: fmtTime(p.R_400)
  };
}

/** 输入高驰完赛预测，挑锚点算出五区配速；全缺或超表返回 null */
function buildPaces(predictions) {
  if (!predictions) return null;
  for (let i = 0; i < ANCHOR_ORDER.length; i++) {
    const key = ANCHOR_ORDER[i];
    const raw = predictions[key];
    const secs = parseTime(raw);
    const distKey = COROS_KEY[key];
    if (secs === null || !distKey) continue;
    let vdot;
    try { vdot = lookupVdot(distKey, secs); } catch (e) { continue; }
    const out = { anchor: key, anchorLabel: ANCHOR_LABEL[key], anchorTime: String(raw) };
    const p = pacesForVdot(vdot);
    Object.keys(p).forEach(function (k) { out[k] = p[k]; });
    return out;
  }
  return null;
}

module.exports = { buildPaces: buildPaces };
