// 今日身体准备度（Readiness）—— 移植自 tools/readiness.py

const HRV_DROP_PCT = 20.0;
const RHR_SPIKE_BPM = 7.0;
const SLEEP_SCORE_MIN = 60;
const RECOVERY_PCT_MIN = 50;

const LEVEL_ZH = {
  'Training as usual': '正常训练',
  'Heavy training allowed': '可高强度训练',
  'Light training': '仅可轻量训练',
  'Light training only': '仅可轻量训练',
  'Recovery recommended': '建议恢复',
  'Rest recommended': '建议休息',
  'Rest': '建议休息'
};

/**
 * computeReadiness({recoveryPct, recoveryLevel, estFullHours, hrvDropPct, rhrSpikeBpm, sleepScore}) -> dict
 * 缺失的信号一律跳过（计入 skipped），不臆造、不默认安全。
 */
function computeReadiness(opts) {
  opts = opts || {};
  const recoveryPct = numOrNull(opts.recoveryPct);
  const recoveryLevel = opts.recoveryLevel || null;
  const estFullHours = numOrNull(opts.estFullHours);
  const hrvDropPct = numOrNull(opts.hrvDropPct);
  const rhrSpikeBpm = numOrNull(opts.rhrSpikeBpm);
  const sleepScore = numOrNull(opts.sleepScore);

  const flags = [];
  if (hrvDropPct !== null && hrvDropPct >= HRV_DROP_PCT) {
    flags.push('HRV 较基线跌 ' + Math.round(hrvDropPct) + '%（≥' + Math.round(HRV_DROP_PCT) + '%）');
  }
  if (rhrSpikeBpm !== null && rhrSpikeBpm >= RHR_SPIKE_BPM) {
    flags.push('静息心率较基线升 ' + Math.round(rhrSpikeBpm) + 'bpm（≥' + Math.round(RHR_SPIKE_BPM) + '）');
  }
  if (sleepScore !== null && sleepScore < SLEEP_SCORE_MIN) {
    flags.push('睡眠分 ' + sleepScore + '（<' + SLEEP_SCORE_MIN + '）');
  }
  if (recoveryPct !== null && recoveryPct < RECOVERY_PCT_MIN) {
    flags.push('高驰恢复度 ' + recoveryPct + '%（<' + RECOVERY_PCT_MIN + '%）');
  }

  const skipped = [];
  if (hrvDropPct === null) skipped.push('HRV');
  if (rhrSpikeBpm === null) skipped.push('静息心率');
  if (sleepScore === null) skipped.push('睡眠分');

  if (recoveryPct === null && flags.length === 0 && skipped.length === 3) {
    return { status: 'unknown', label: '数据不足', flags: [], skipped: skipped, summary: '' };
  }

  let status, label;
  if (flags.length >= 2) { status = 'recover'; label = '建议恢复'; }
  else if (flags.length === 1) { status = 'caution'; label = '注意'; }
  else { status = 'ok'; label = '状态良好'; }

  const parts = [];
  if (recoveryPct !== null) parts.push('高驰恢复度 ' + recoveryPct + '%');
  if (estFullHours) parts.push('预计完全恢复约 ' + estFullHours + ' 小时');
  if (recoveryLevel) parts.push(LEVEL_ZH[recoveryLevel] || recoveryLevel);

  return {
    status: status,
    label: label,
    recoveryPct: recoveryPct,
    level: recoveryLevel,
    estFullHours: estFullHours,
    flags: flags,
    skipped: skipped,
    summary: parts.join(' · ')
  };
}

function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

module.exports = { computeReadiness: computeReadiness };
