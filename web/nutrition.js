/* 补给 / 营养计算（纯函数 · 确定性算术不交给 AI）
 *
 * 口径参考通用运动营养共识（自撰，仅供参考，非医疗建议）。
 * 教练页「补给计算器」与对话注入共用这一份逻辑——本机自用与（未来）对外版同一口径。
 */
(function () {
  var LEVELS = {
    easy:     { label: '轻松 / 慢跑（E）',   carbs: 30, fluid: 500, sodium: 400 },
    moderate: { label: '中等 / 节奏（M·T）', carbs: 60, fluid: 600, sodium: 600 },
    hard:     { label: '高强度 / 比赛（I·R）', carbs: 90, fluid: 750, sodium: 800 }
  };

  // 补给意图关键词（用于判断某句话是不是在问补给）
  var FUEL_KW = ['补给', '补糖', '能量胶', '喝水', '补水', '电解质', '盐丸', '碳水',
    '赛前吃', '吃什么', '喝什么', '怎么吃', '怎么喝', '喝多少', '吃多少', '撞墙', '补盐'];

  function hasIntent(text) {
    var t = String(text || '');
    for (var i = 0; i < FUEL_KW.length; i++) { if (t.indexOf(FUEL_KW[i]) >= 0) { return true; } }
    return false;
  }

  // 从一句话里粗略识别「时长 + 强度」；识别不到时长则返回 null（不猜数字）
  function parse(text) {
    var t = String(text || '');
    var minutes = 0, m;
    m = t.match(/(\d+(?:\.\d+)?)\s*(?:个?半?小时|hours?|hrs?|h\b)/i);
    if (m) { minutes = Math.round(parseFloat(m[1]) * 60); }
    if (!minutes) {
      m = t.match(/(\d+)\s*(?:分钟|mins?|min\b)/i);
      if (m) { minutes = Math.round(parseFloat(m[1])); }
    }
    if (!minutes) { return null; }
    var level = '';
    if (/间歇|冲刺|全力|竞速|比赛|测试/.test(t)) { level = 'hard'; }
    else if (/轻松|慢跑|恢复跑|easy|有氧/.test(t)) { level = 'easy'; }
    else if (/节奏|阈值|马配|马拉松配速|tempo|全力马|中等/.test(t)) { level = 'moderate'; }
    return { minutes: minutes, level: level || 'moderate', levelKnown: !!level };
  }

  function plan(weightKg, minutes, level) {
    var w = Number(weightKg) > 0 ? Number(weightKg) : 60;
    var min = Number(minutes) > 0 ? Number(minutes) : 0;
    var key = LEVELS[level] ? level : 'moderate';
    var lv = LEVELS[key];
    var h = min / 60;
    var carbsPerHour = min < 60 ? 0 : lv.carbs;   // 不足 1 小时一般无需赛中补糖
    return {
      weightKg: Math.round(w * 10) / 10,
      minutes: Math.round(min),
      level: key,
      levelLabel: lv.label,
      hours: h,
      carbsPerHour: carbsPerHour,
      fluidPerHour: lv.fluid,
      sodiumPerHour: lv.sodium,
      totalCarbs: Math.round(carbsPerHour * h),
      totalFluid: Math.round(lv.fluid * h),
      totalSodium: Math.round(lv.sodium * h),
      preRaceCarbs: Math.round(w * 1.5),        // 赛前 2–3h 约 1–2 g/kg，取 1.5
      note: '碳水 / 水 / 钠为每小时建议量，总量按时长换算；仅供参考，非医疗建议。'
    };
  }

  // 输出一段中文数字（供面板展示与对话注入，都是「已算好的结果」）
  function format(res) {
    if (!res) { return ''; }
    var head = '按体重 ' + res.weightKg + ' kg、时长 ' + res.minutes + ' 分钟、强度「' + res.levelLabel + '」估算：';
    var body;
    if (res.carbsPerHour === 0) {
      body = '时长不足 1 小时，一般无需赛中额外补糖（赛前正常进食即可）；' +
        '补水约 ' + res.totalFluid + ' ml；若出汗多可补钠约 ' + res.totalSodium + ' mg。';
    } else {
      body = '赛中补碳水约 ' + res.carbsPerHour + ' g/小时（合计约 ' + res.totalCarbs + ' g）；' +
        '补水约 ' + res.fluidPerHour + ' ml/小时（合计约 ' + res.totalFluid + ' ml）；' +
        '补钠约 ' + res.sodiumPerHour + ' mg/小时（合计约 ' + res.totalSodium + ' mg）。';
    }
    var pre = '若为比赛，赛前 2–3 小时可额外补碳水约 ' + res.preRaceCarbs + ' g。';
    return head + body + pre + '（' + res.note + '）';
  }

  window.CorosNutrition = { LEVELS: LEVELS, plan: plan, format: format, parse: parse, hasIntent: hasIntent };
})();
