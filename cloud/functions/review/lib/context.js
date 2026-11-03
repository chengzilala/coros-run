// 复盘上下文拼装（纯函数）——把看板数据结构化成一段中文文本，交给大模型。
//
// 移植自 web/serve.py 的 build_context（口径与文案保持一致），只保留「取数 → 文本」这一步；
// 不做任何网络/数据库访问，便于单测与复用。
//
// 输入 data：与 dashboard 云函数返回**同结构**的对象（profile/fitness/devices/trainingLoad/
//            activities/details/laps）。
// 输入 scope：'latest'（只看最近一次）/ 其它（默认看最近 25 条）。

var SPORT = {
  100: '户外跑', 101: '跑步机', 102: '田径场跑', 103: '越野跑',
  104: '徒步', 105: '室内骑行', 200: '骑行', 300: '游泳'
};

function pad2(n) { return (n < 10 ? '0' : '') + n; }

/** 缺值（null/undefined）显示为空，其余原样转字符串（保留数字 0，不被 || 吞掉） */
function txt(v) { return (v === null || v === undefined) ? '' : String(v); }

function fmtPace(sec) {
  if (!sec) { return '—'; }
  sec = Math.round(Number(sec));
  return Math.floor(sec / 60) + ':' + pad2(sec % 60);
}

function fmtDist(m) {
  if (m === null || m === undefined || m === '') { return '—'; }
  return (Number(m) / 1000).toFixed(2) + 'km';
}

function fmtDur(sec) {
  if (!sec) { return '—'; }
  sec = Math.round(Number(sec));
  var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? (h + ':' + pad2(m) + ':' + pad2(s)) : (m + ':' + pad2(s));
}

function buildContext(data, scope) {
  data = data || {};
  var p = data.profile || {};
  var fit = data.fitness || {};
  var lines = [];

  lines.push('【个人情况】');
  lines.push('昵称：' + (p.nickname || '—') + '；年龄：' + (p.age || '—') +
    '；身高：' + (p.heightCm || '—') + 'cm；体重：' + (p.weightKg || '—') + 'kg');

  var pred = fit.predictions || {};
  var predKeys = Object.keys(pred);
  var predTxt = predKeys.length
    ? predKeys.map(function (k) { return k + ' ' + pred[k]; }).join('、')
    : '—';
  lines.push('体能：VO2max=' + (fit.vo2max || '—') + '；跑力值=' + (fit.runningLevel || '—') +
    '；阈值配速=' + fmtPace(fit.thresholdPaceSec) + '/km；完赛预测：' + predTxt);

  var dev = (data.devices || [{}])[0] || {};
  if (dev['Model Name']) { lines.push('设备：' + dev['Model Name']); }

  var loadRows = data.trainingLoad || [];
  if (loadRows.length) {
    var tail = loadRows.slice(-14);
    lines.push('');
    lines.push('【近期训练负荷（日期/短期/长期）】');
    lines.push(tail.map(function (r) {
      return txt(r.date) + ' ' + txt(r.shortLoad) + '/' + txt(r.longLoad);
    }).join('；'));
  }

  var acts = (data.activities || []).slice();
  if (!acts.length) {
    lines.push('');
    lines.push('（没有运动记录）');
    return lines.join('\n');
  }

  if (scope === 'latest') {
    acts = acts.slice(0, 1);
    lines.push('');
    lines.push('【最近一次运动】');
  } else {
    acts = acts.slice(0, 25);
    lines.push('');
    lines.push('【最近的训练记录（从新到旧，共列出 ' + acts.length + ' 条）】');
  }
  acts.forEach(function (a) {
    lines.push('- ' + (a.date || '') + ' ' + (SPORT[a.sportType] || a.title || '运动') +
      ' ' + fmtDist(a.distanceM) + '，用时' + fmtDur(a.durationSec) +
      '，配速' + fmtPace(a.paceSec) + '/km，均心' + (a.avgHr || '—') +
      '，消耗' + (a.calories || '—') + 'kcal' + (a.location ? ('，地点' + a.location) : ''));
  });

  // 详细指标（最近一次）
  var details = data.details || {};
  var laps = data.laps || {};
  var first = acts[0] || {};
  var d = details[first.labelId] || {};
  if (d && Object.keys(d).length) {
    lines.push('');
    lines.push('【最近一次的关键技术指标】');
    var kv = [
      ['平均步频', d.avgCadence, 'spm'], ['平均功率', d.avgPowerW, 'W'],
      ['平均步幅', d.avgStrideM, 'm'], ['累计爬升', d.elevGainM, 'm'],
      ['训练负荷', d.trainingLoad, ''], ['有氧效果', d.aerobicTE, ''],
      ['训练重点', d.trainingFocus, ''], ['运动表现', d.performance, '']
    ];
    lines.push(kv.filter(function (x) { return x[1] !== null && x[1] !== undefined && x[1] !== ''; })
      .map(function (x) { return x[0] + x[1] + x[2]; }).join('；'));
  }

  var lk = laps[first.labelId];
  if (lk) {
    var groups = lk.lapGroups || [];
    var g = null;
    for (var i = 0; i < groups.length; i++) {
      if (groups[i].type === 2 && (groups[i].laps || []).length > 1) { g = groups[i]; break; }
    }
    if (!g && groups.length) {
      g = groups.slice().sort(function (a, b) { return (b.laps || []).length - (a.laps || []).length; })[0];
    }
    if (g && g.laps && g.laps.length) {
      var seg = g.laps.slice(0, 12).map(function (l, idx) {
        return '第' + (idx + 1) + '段:' + fmtDist(l.distance) + '/' + fmtPace(l.avgPace) + '/心率' + (l.avgHr || '—');
      });
      lines.push('【分段（距离/配速/心率）】' + seg.join('；'));
    }
  }

  return lines.join('\n');
}

module.exports = { buildContext: buildContext };
