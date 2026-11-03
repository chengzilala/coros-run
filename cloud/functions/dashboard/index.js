// 云函数 dashboard —— 返回**本人**看板数据（阶段 C3）
//
// 作用：前端登录后调用本函数，拿到与本地 data/dashboard.json **同结构**的数据，
//       供 web/app.js 直接渲染（阶段 C4 把数据源从本地 JSON 切到本函数）。
//
// 数据隔离：本函数只按调用者 uid 过滤（profiles/_openid==uid、activities/_openid==uid、
//           metrics_daily/_openid==uid），因此换账号登录只能看到自己的数据。
//
// 数据来源：coros-sync 写入的三个集合：
//   - profiles      ：1 条（profile/devices/fitness/readiness/region/range/generatedAt）
//   - activities    ：每活动 1 条（列表字段 + detail + laps）
//   - metrics_daily ：每天 1 条（health + load）
//
// 多品牌（契约 v2）：
//   - 入参 provider：'coros'（默认）/ 'garmin'；返回里带同一份 provider 与 capabilities，
//     前端按能力决定显示/隐藏，不写品牌 if-else。
//   - 老数据没有 provider 字段 → 一律视为 coros（历史兼容）。
//   - 线上暂不支持佳明（官方 API 只覆盖开发者本人，不能替他人授权）→ 返回 PROVIDER_UNSUPPORTED，
//     由前端展示「本机可用、线上待开放」的引导，不用空数据假装。
//
// 依赖环境变量：无（集合内已含 region/generatedAt）
// 依赖集合：profiles / activities / metrics_daily（阶段 C1 已建）

const cloudbase = require('@cloudbase/node-sdk');

const app = cloudbase.init({
  env: cloudbase.SYMBOL_CURRENT_ENV || process.env.TCB_ENV || process.env.SCF_NAMESPACE
});
const db = app.database();

/** 从调用上下文解出 JWT 载荷（不验签，网关已验签） */
function claimOf(ev) {
  try {
    const p = String((ev.tcbContext || {}).accessToken || '').split('.');
    if (p.length < 2) { return {}; }
    let b = p[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4) { b += '='; }
    return JSON.parse(Buffer.from(b, 'base64').toString('utf8'));
  } catch (e) { return {}; }
}

function resolveUid(event) {
  const c = claimOf(event);
  return c.sub || c.user_id || event.uid || '';
}

/** 分页拉全某用户的某集合（服务端单次上限 1000 条） */
async function fetchAll(colName, uid, orderField) {
  const out = [];
  const pageSize = 1000;
  for (let skip = 0; ; skip += pageSize) {
    let q = db.collection(colName).where({ _openid: uid });
    if (orderField) { q = q.orderBy(orderField, 'desc'); }
    const got = await q.skip(skip).limit(pageSize).get();
    const rows = (got && got.data) || [];
    out.push.apply(out, rows);
    if (rows.length < pageSize) { break; }
  }
  return out;
}

/** 老数据没有 provider 字段 → 视为 coros（历史兼容） */
function rowProvider(row) {
  const p = String((row && row.provider) || '').toLowerCase();
  return p === 'garmin' ? 'garmin' : 'coros';
}

/** 能力声明（契约 v2）：前端只按「有/没有」决定显示、隐藏或降级占位 */
function buildCaps(data) {
  const fitness = data.fitness || {};
  const readiness = data.readiness || {};
  const load = data.trainingLoad || [];
  return {
    recoveryPct: readiness.recoveryPct !== undefined && readiness.recoveryPct !== null,
    recoveryLevel: !!readiness.level,
    estFullHours: readiness.estFullHours !== undefined && readiness.estFullHours !== null,
    runningLevel: fitness.runningLevel !== undefined && fitness.runningLevel !== null,
    loadHistory: load.length > 1,
    loadRatio: load.some(function (x) { return x && x.ratio !== undefined && x.ratio !== null; }),
    acwr: false,          // 高驰是自家负荷比，不是佳明式 ACWR
    bodyBattery: false,   // 高驰无身体电量
    vendorReadiness: false,
    lapsUnit: 'cm'
  };
}

exports.main = async function (event) {
  event = event || {};
  const started = Date.now();
  try {
    const uid = resolveUid(event);
    if (!uid) { return { ok: false, error: '未登录（拿不到用户身份），请先登录' }; }

    const provider = String(event.provider || 'coros').toLowerCase() === 'garmin' ? 'garmin' : 'coros';
    if (provider === 'garmin') {
      // 佳明官方 API 只能覆盖开发者本人，不能替他人授权；线上先引导，不返回空数据
      return {
        ok: false,
        code: 'PROVIDER_UNSUPPORTED',
        provider: 'garmin',
        error: '线上暂不支持佳明账号：佳明没有开放「替他人读取」的接口。请在电脑上用本机版接入（见 landing 里的说明），线上继续用高驰。'
      };
    }

    const profRows = await db.collection('profiles').where({ _openid: uid }).limit(20).get();
    const prof = ((profRows && profRows.data) || []).filter(function (r) {
      return rowProvider(r) === provider;
    })[0] || null;
    if (!prof) {
      return {
        ok: false,
        provider: provider,
        error: provider === 'garmin'
          ? '云端暂无佳明数据（线上暂不支持佳明，请用本机版）'
          : '云端暂无你的数据，请先在「账户」页点「同步高驰数据」',
        ms: Date.now() - started
      };
    }

    const actRows = (await fetchAll('activities', uid, 'date')).filter(function (r) {
      return rowProvider(r) === provider;
    });
    const metricRows = (await fetchAll('metrics_daily', uid, 'date')).filter(function (r) {
      return rowProvider(r) === provider;
    });

    // activities：把 detail/laps 拆出为独立映射（与本地 dashboard.json 结构一致）
    const activities = [];
    const details = {};
    const laps = {};
    actRows.forEach(function (row) {
      const a = Object.assign({}, row);
      const detail = a.detail; delete a.detail;
      const lap = a.laps; delete a.laps;
      delete a._openid; delete a.uid; delete a.updated_at;
      if (a.labelId) {
        details[a.labelId] = detail || {};
        laps[a.labelId] = lap || [];
      }
      activities.push(a);
    });

    // metrics_daily：拆成 trainingLoad（负荷数组）与 dailyHealth（健康）
    const trainingLoad = [];
    const healthDays = [];
    metricRows.forEach(function (row) {
      if (row.load) { trainingLoad.push(row.load); }
      if (row.health) { healthDays.push(row.health); }
    });
    trainingLoad.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    healthDays.sort(function (a, b) { return String(a.date) < String(b.date) ? -1 : 1; });

    const payload = {
      ok: true,
      uid: uid,
      ms: Date.now() - started,
      schemaVersion: 2,
      provider: provider,
      generatedAt: prof.generatedAt || '',
      region: prof.region || '',
      range: prof.range || null,
      profile: prof.profile || {},
      devices: prof.devices || [],
      fitness: prof.fitness || {},
      readiness: prof.readiness || {},
      trainingLoad: trainingLoad,
      dailyHealth: { days: healthDays },
      activities: activities,
      details: details,
      laps: laps,
      counts: { activities: activities.length, metrics: metricRows.length }
    };
    payload.capabilities = buildCaps(payload);
    return payload;
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e), ms: Date.now() - started };
  }
};
