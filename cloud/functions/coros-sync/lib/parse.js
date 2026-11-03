// 高驰 MCP 返回文本 → 结构化对象 —— 移植自 tools/fetch_data.py（逐函数对照，口径一致）

// ---------------- 通用小工具 ----------------
/** 取出 MCP 返回的文本；该文本是被再次 JSON 编码的字符串，需要解一层。 */
function getText(data) {
  let t;
  try { t = data.result.content[0].text; } catch (e) { return ''; }
  if (typeof t === 'string') {
    try {
      const decoded = JSON.parse(t);
      if (typeof decoded === 'string') t = decoded;
    } catch (e) {
      t = t.trim();
      if (t.length >= 2 && t[0] === '"' && t[t.length - 1] === '"') t = t.slice(1, -1);
    }
  }
  return t;
}

function getJsonText(data) {
  try { return JSON.parse(getText(data)); } catch (e) { return null; }
}

function toInt(x) { return Math.round(Number(x)); }

function toSec(s) {
  if (!s) return null;
  s = String(s).trim();
  if (!/^\d+(:\d+)*$/.test(s)) return null;
  let sec = 0;
  s.split(':').forEach(function (p) { sec = sec * 60 + toInt(p); });
  return sec;
}

function toM(s) {
  if (!s) return null;
  s = String(s).trim();
  let m = s.match(/^([\d.]+)\s*km$/);
  if (m) return Math.round(Number(m[1]) * 1000);
  m = s.match(/^([\d.]+)\s*m$/);
  if (m) return Math.round(Number(m[1]));
  return null;
}

function toNum(s, cast) {
  if (s === null || s === undefined) return null;
  const m = String(s).match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  return cast ? cast(m[0]) : Number(m[0]);
}

function keyvals(text) {
  const out = {};
  String(text || '').split('\n').forEach(function (line) {
    line = line.trim();
    if (!line || /^[= ]*$/.test(line)) return;
    const i = line.indexOf(':');
    if (i >= 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  });
  return out;
}

/** 从 '6:39 /km' 取 '6:39' */
function paceHead(s) { return String(s || '').split('/')[0].trim(); }

/** 按首个分隔符切成 [前, 后]（等价 Python 的 str.split(sep, 1)）
 *  注：'a:b' 分隔 ':' → ['a', 'b']；之所以下面用 '：' 之外的自定义分隔语义见调用处。 */
function splitOnce(s, sep) {
  if (sep === ':') {
    // Python 的 split(":", 1)：'Duration: 00:30:00 | Distance: 5 km' → ['Duration', ' 00:30:00 | Distance: 5 km']
    // 注意：这里只切第一个英文冒号，与 Python 一致（不切时间里的冒号）。
    const i = String(s).indexOf(':');
    if (i < 0) return [String(s)];
    return [String(s).slice(0, i), String(s).slice(i + 1)];
  }
  const i = String(s).indexOf(sep);
  if (i < 0) return [String(s)];
  return [String(s).slice(0, i), String(s).slice(i + sep.length)];
}

// ---------------- 各工具返回解析 ----------------
function parseProfile(text) {
  const kv = keyvals(text);
  const p = { nickname: kv['Nickname'] !== undefined ? kv['Nickname'] : null };
  p.heightCm = toNum(kv['Height']);
  p.weightKg = toNum(kv['Weight']);
  p.gender = kv['Gender'] !== undefined ? kv['Gender'] : null;
  const bd = kv['Birthday'];
  if (bd) {
    const m = bd.match(/(\d{4}-\d{2}-\d{2})/);
    p.birthday = m ? m[1] : bd;
    if (bd.indexOf('Age:') >= 0) {
      const a = bd.match(/Age:\s*(\d+)/);
      p.age = a ? toNum(a[1], toInt) : null;
    } else {
      p.age = null;
    }
  }
  return p;
}

function parseDevices(text) {
  const out = [];
  String(text || '').split(/\n\s*\n/).forEach(function (blk) {
    const m = blk.match(/^\s*\d+\.\s*(.+)/);
    if (!m) return;
    const d = { name: m[1].trim() };
    blk.split('\n').slice(1).forEach(function (line) {
      line = line.trim();
      const i = line.indexOf(':');
      if (i >= 0) d[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    });
    out.push(d);
  });
  return out;
}

function parseFitness(text) {
  const kv = keyvals(text);
  const f = {
    vo2max: toNum(kv['VO2max']),
    runningLevel: toNum(kv['Running Level']),
    thresholdPaceSec: toSec(paceHead(kv['Threshold Pace'])),
    predictions: {}
  };
  Object.keys(kv).forEach(function (k) {
    if (k.length > 11 && k.slice(-11) === ' Prediction') {
      f.predictions[k.slice(0, -11).trim()] = kv[k];
    }
  });
  return f;
}

function parseTrainingLoad(text) {
  const out = [];
  const pat = /(\d{4}-\d{2}-\d{2})\s*\nComment:\s*(.+?)\nShort-Term Load:\s*(\d+)\s*\nLong-Term Load:\s*(\d+)\s*\nLoad Ratio:\s*([\d.]+)/g;
  let m;
  while ((m = pat.exec(String(text || ''))) !== null) {
    out.push({
      date: m[1],
      comment: m[2].trim(),
      shortLoad: toInt(m[3]),
      longLoad: toInt(m[4]),
      ratio: Number(m[5])
    });
  }
  return out;
}

function parseDailyHealth(text) {
  const h = {};
  let m = String(text || '').match(/Resting HR:\s*(\d+)\s*bpm/);
  if (m) h.restingHr = toInt(m[1]);
  m = String(text || '').match(/HRV Baseline:\s*(\d+)\s*ms/);
  if (m) h.hrvBaseline = toInt(m[1]);
  const days = [];
  let cur = null;
  String(text || '').split('\n').forEach(function (line) {
    line = line.trim();
    const mm = line.match(/^---\s*(\d{8})\s*---$/);
    if (mm) { cur = { date: mm[1] }; days.push(cur); return; }
    if (cur && line.indexOf(':') >= 0) {
      line.split('|').forEach(function (seg) {
        seg = seg.trim();
        const i = seg.indexOf(':');
        if (i >= 0) cur[seg.slice(0, i).trim()] = seg.slice(i + 1).trim();
      });
    }
  });
  h.days = days;
  return h;
}

/** 解析 queryRecoveryStatus：恢复度% / 等级 / 预计完全恢复小时。无数据返回 null。 */
function parseRecovery(text) {
  if (!text || String(text).indexOf('Recovery') < 0) return null;
  const r = {};
  let m = String(text).match(/Recovery:\s*(\d+)\s*%/);
  if (m) r.recoveryPct = toInt(m[1]);
  m = String(text).match(/Level:\s*(.+)/);
  if (m) r.level = m[1].trim();
  m = String(text).match(/Estimated Full Recovery:\s*(\d+)\s*h/);
  if (m) r.estFullHours = toInt(m[1]);
  return Object.keys(r).length ? r : null;
}

function parseRecords(text) {
  const recs = [];
  String(text || '').split(/\n\s*\n/).forEach(function (b) {
    const m = b.match(/^\s*\d+\.\s*(.+?)\s*—\s*(\d{4}-\d{2}-\d{2})/);
    if (!m) return;
    const r = { title: m[1].trim(), date: m[2] };
    b.split('\n').forEach(function (line) {
      line = line.trim();
      if (line.indexOf('Location:') === 0) {
        r.location = splitOnce(line, ':')[1].trim();
      } else if (line.indexOf('Start Coordinates:') === 0) {
        r.coordinates = splitOnce(line, ':')[1].trim();
      } else if (line.indexOf('Time Window:') === 0) {
        const mm = line.match(/startTimestamp=(\d+)\s*\|\s*endTimestamp=(\d+)/);
        if (mm) { r.startTs = toInt(mm[1]); r.endTs = toInt(mm[2]); }
      } else if (line.indexOf('Duration:') === 0) {
        const parts = splitOnce(line, ':')[1].split('|').map(function (p) { return p.trim(); });
        r.durationSec = toSec(parts[0]);
        parts.slice(1).forEach(function (p) {
          if (p.indexOf('Distance:') === 0) r.distanceM = toM(splitOnce(p, ':')[1]);
        });
      } else if (line.indexOf('Average Pace:') === 0) {
        const parts = splitOnce(line, ':')[1].split('|').map(function (p) { return p.trim(); });
        r.paceSec = toSec(paceHead(parts[0]));
        parts.slice(1).forEach(function (p) {
          if (p.indexOf('Avg HR:') === 0) r.avgHr = toNum(splitOnce(p, ':')[1], toInt);
          else if (p.indexOf('Calories:') === 0) r.calories = toNum(splitOnce(p, ':')[1], toInt);
        });
      } else if (line.indexOf('LabelId:') === 0) {
        const parts = splitOnce(line, ':')[1].split('|').map(function (p) { return p.trim(); });
        r.labelId = parts[0];
        parts.slice(1).forEach(function (p) {
          if (p.indexOf('SportType:') === 0) r.sportType = toNum(splitOnce(p, ':')[1], toInt);
        });
      }
    });
    recs.push(r);
  });
  return recs;
}

function parseDetail(text) {
  const kv = keyvals(text);
  const d = {
    workoutTimeSec: toSec(kv['Workout Time']),
    totalTimeSec: toSec(kv['Total Time']),
    distanceM: toM(kv['Distance']),
    avgPaceSec: toSec(paceHead(kv['Average Pace'])),
    movingAvgPaceSec: toSec(paceHead(kv['Moving Average Pace'])),
    adjustedPaceSec: toSec(paceHead(kv['Adjusted Pace'])),
    bestKmSec: toSec(paceHead(kv['Best Kilometer'])),
    avgHr: toNum(kv['Average Heart Rate'], toInt),
    avgCadence: toNum(kv['Average Cadence'], toInt),
    avgStrideM: toNum(kv['Average Stride Length']),
    avgPowerW: toNum(kv['Average Power'], toInt),
    calories: toNum(kv['Calories'], toInt),
    trainingLoad: toNum(kv['Training Load'], toInt),
    aerobicTE: toNum(kv['Aerobic TE']),
    anaerobicTE: toNum(kv['Anaerobic TE']),
    trainingFocus: kv['Training Focus'] !== undefined ? kv['Training Focus'] : null,
    performance: kv['Performance'] !== undefined ? kv['Performance'] : null
  };
  const el = kv['Elevation Gain / Loss'];
  if (el) {
    const m = el.match(/([\d.]+)\s*m\s*\/\s*([\d.]+)\s*m/);
    if (m) { d.elevGainM = Number(m[1]); d.elevLossM = Number(m[2]); }
  }
  return d;
}

module.exports = {
  getText: getText,
  getJsonText: getJsonText,
  toSec: toSec,
  toM: toM,
  toNum: toNum,
  toInt: toInt,
  keyvals: keyvals,
  paceHead: paceHead,
  parseProfile: parseProfile,
  parseDevices: parseDevices,
  parseFitness: parseFitness,
  parseTrainingLoad: parseTrainingLoad,
  parseDailyHealth: parseDailyHealth,
  parseRecovery: parseRecovery,
  parseRecords: parseRecords,
  parseDetail: parseDetail
};
