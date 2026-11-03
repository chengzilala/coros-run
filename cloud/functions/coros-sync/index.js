// 云函数 coros-sync —— 云端抓数入库（阶段 C2）
//
// 作用：用 coros_links 里**已加密入库**的高驰 token（本函数内解密）调用高驰官方 MCP，
//       抓取该用户的训练数据，解析后写入云数据库：
//         - profiles      ：每人 1 条（资料 / 设备 / 体能+五区配速 / 今日准备度）
//         - activities    ：每活动 1 条（列表字段 + 详情 detail + 圈数据 laps）
//         - metrics_daily ：每天 1 条（每日健康 + 训练负荷）
//       token 若过期则用 refresh_token 自动刷新，并把新密文写回 coros_links。
//
// 调用方式：
//   1) 前端登录后 app.callFunction('coros-sync', {...})（uid 从调用上下文取）；
//   2) 定时触发器 / 管理调用可显式传 event.uid。
//   可选入参：details（拉最近几次活动详情，默认 5）、days（健康数据天数，默认 90）。
//
// 依赖环境变量：COROS_REGION、COROS_TOKEN_KEY
// 依赖集合：coros_links / coros_app（阶段 B 已建）+ profiles / activities / metrics_daily（阶段 C1 新建）
//
// 注意：单次抓取较慢，函数「超时」建议调到 60s。

const cloudbase = require('@cloudbase/node-sdk');
const crypto = require('./lib/crypto');
const mcp = require('./lib/mcp');
const parse = require('./lib/parse');
const pace = require('./lib/pace');
const readiness = require('./lib/readiness');

const app = cloudbase.init({
  env: cloudbase.SYMBOL_CURRENT_ENV || process.env.TCB_ENV || process.env.SCF_NAMESPACE
});
const db = app.database();

const REGION = process.env.COROS_REGION || 'us';
const AUTH_BASE = {
  cn: 'https://mcpcn.coros.com',
  us: 'https://mcpus.coros.com',
  eu: 'https://mcpeu.coros.com'
}[REGION];
const MCP_URL = AUTH_BASE + '/mcp';
const TOKEN_URL = AUTH_BASE + '/oauth2/token';
const RUN_SPORT_CODES = [100, 101, 102, 103]; // 户外跑 / 跑步机 / 田径场 / 越野跑

// ---------------- 身份 / 工具 ----------------
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

function pad2(n) { return (n < 10 ? '0' : '') + n; }
function ymd(d) { return '' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()); }
function fmtDateTime(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
    + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}
/** 'YYYYMMDD' → 'YYYY-MM-DD'（已是则原样） */
function normalizeDate(s) {
  s = String(s || '').trim();
  if (/^\d{8}$/.test(s)) return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return '';
}

/** 通用 upsert：不存在则建、存在则更新（不改 _id/_openid） */
async function upsert(colName, id, data) {
  const col = db.collection(colName);
  const payload = Object.assign({}, data);
  delete payload._id;
  try {
    await col.doc(id).set(payload);
  } catch (e) {
    try {
      await col.add(Object.assign({ _id: id }, payload));
    } catch (e2) {
      await col.doc(id).update(payload);
    }
  }
}

async function getClientId() {
  const got = await db.collection('coros_app').where({ _id: 'default' }).get();
  return (got && got.data && got.data[0] && got.data[0].client_id) || '';
}

// ---------------- token 获取 / 刷新 ----------------
/**
 * 读取并（必要时）刷新该用户的高驰 access_token。
 * 返回 { access, refresh, expiresAt, linkId }；刷新后的新密文会写回 coros_links。
 */
async function ensureToken(link) {
  let access = crypto.dec(link.enc_token);
  let refresh = link.enc_refresh ? crypto.dec(link.enc_refresh) : '';
  let expiresAt = Number(link.expires_at) || 0;

  const needRefresh = refresh && (!expiresAt || Date.now() > expiresAt - 60 * 1000);
  if (needRefresh) {
    const clientId = await getClientId();
    const tok = await mcp.refreshToken(TOKEN_URL, refresh, clientId);
    if (tok) {
      access = tok.access_token;
      refresh = tok.refresh_token || refresh;
      expiresAt = Date.now() + (Number(tok.expires_in) || 0) * 1000;
      await db.collection('coros_links').doc(link._id).update({
        enc_token: crypto.enc(access),
        enc_refresh: crypto.enc(refresh),
        expires_at: expiresAt,
        updated_at: Date.now()
      });
    }
  }
  return { access: access, refresh: refresh, expiresAt: expiresAt, linkId: link._id };
}

// ---------------- 主流程 ----------------
async function syncUser(uid, opts) {
  const detailsN = opts.details;
  const days = opts.days;

  const got = await db.collection('coros_links').where({ _openid: uid }).get();
  if (!got || !got.data || !got.data.length) {
    throw new Error('该用户尚未绑定高驰账号，请先在「账户」页绑定');
  }
  const link = got.data[0];

  const state = await ensureToken(link);
  state.session = await mcp.openSession(MCP_URL, state.access);

  const errors = [];
  async function callTool(name, args) {
    let r = await mcp.callTool(MCP_URL, name, args || {}, state.access, state.session);
    if (r.status === 401) {
      // 授权可能刚失效：刷新重开会话后再试一次
      const clientId = await getClientId();
      const tok = await mcp.refreshToken(TOKEN_URL, state.refresh, clientId);
      if (tok) {
        state.access = tok.access_token;
        state.refresh = tok.refresh_token || state.refresh;
        state.expiresAt = Date.now() + (Number(tok.expires_in) || 0) * 1000;
        await db.collection('coros_links').doc(state.linkId).update({
          enc_token: crypto.enc(state.access),
          enc_refresh: crypto.enc(state.refresh),
          expires_at: state.expiresAt,
          updated_at: Date.now()
        });
        state.session = await mcp.openSession(MCP_URL, state.access);
        r = await mcp.callTool(MCP_URL, name, args || {}, state.access, state.session);
      }
    }
    if (r.status >= 400 || (r.data && r.data.error)) {
      errors.push(name + ' [HTTP ' + r.status + ']');
      return null;
    }
    return r.data;
  }

  const today = new Date();
  const end = ymd(today);
  const startD = new Date(today.getTime() - 730 * 24 * 3600 * 1000);
  const start = ymd(startD);

  const profile = parse.parseProfile(parse.getText(await callTool('queryUserInfo')));
  const devices = parse.parseDevices(parse.getText(await callTool('queryDevices')));
  const fitness = parse.parseFitness(parse.getText(await callTool('queryFitnessAssessmentOverview')));
  const paces = pace.buildPaces(fitness.predictions || {});
  if (paces) fitness.paces = paces;
  const daily = parse.parseDailyHealth(parse.getText(await callTool('queryDailyHealthData', { days: days })));
  const load = parse.parseTrainingLoad(parse.getText(await callTool('queryTrainingLoadAssessment', { days: days })));
  const recovery = parse.parseRecovery(parse.getText(await callTool('queryRecoveryStatus'))) || {};
  const readinessData = readiness.computeReadiness({
    recoveryPct: recovery.recoveryPct,
    recoveryLevel: recovery.level,
    estFullHours: recovery.estFullHours
  });

  // querySportRecords 单次上限 200、无 offset 分页：单窗会把更早的记录截断（之前 limit:200 只拿到最近 200 条）。
  // 故把 [start,end] 按 60 天小窗逐窗抓取、按 labelId 去重（与 tools/source_coros.py 同法），拿到完整历史。
  const CHUNK_DAYS = 60;
  const records = [];
  const seenLid = new Set();
  for (let cur = new Date(startD.getTime()); cur <= today; cur = new Date(cur.getTime() + CHUNK_DAYS * 86400000)) {
    const stop = new Date(Math.min(cur.getTime() + (CHUNK_DAYS - 1) * 86400000, today.getTime()));
    const raw = await callTool('querySportRecords', {
      startDate: ymd(cur),
      endDate: ymd(stop),
      sportTypeCodes: RUN_SPORT_CODES,
      limit: 200
    });
    const recs = raw ? parse.parseRecords(parse.getText(raw)) : [];
    for (const r of recs || []) {
      const lid = r && r.labelId;
      if (lid) { if (seenLid.has(lid)) continue; seenLid.add(lid); }
      records.push(r);
    }
    await new Promise(function (rs) { setTimeout(rs, 250); });   // 轻微节流，降低被限流概率
  }
  records.sort(function (a, b) { return (a.date || '') < (b.date || '') ? 1 : ((a.date || '') > (b.date || '') ? -1 : 0); });

  // 拉最近 N 次活动的详情 + 圈数据
  const detailsMap = {};
  const lapsMap = {};
  for (let i = 0; i < Math.min(detailsN, records.length); i++) {
    const r = records[i];
    const lid = r.labelId;
    const st = r.sportType;
    if (!lid || st === null || st === undefined) continue;
    detailsMap[lid] = parse.parseDetail(parse.getText(await callTool('getActivityDetail', { labelId: lid, sportType: st })));
    lapsMap[lid] = parse.getJsonText(await callTool('queryActivityLapData', { labelId: lid, sportType: st }));
  }

  // ---------------- 写库 ----------------
  const now = Date.now();
  const generatedAt = fmtDateTime(new Date());

  await upsert('profiles', uid, {
    _openid: uid,
    uid: uid,
    provider: 'coros',
    region: REGION,
    generatedAt: generatedAt,
    range: { start: start, end: end },
    profile: profile,
    devices: devices,
    fitness: fitness,
    readiness: readinessData,
    errors: errors,
    updated_at: now
  });

  let actCount = 0;
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (!r.labelId) continue;
    const docId = uid + '_' + r.labelId;
    const doc = Object.assign({}, r, {
      _openid: uid,
      uid: uid,
      provider: 'coros',        // 多品牌标记：dashboard 按 provider 过滤（老数据无此字段按 coros 处理）
      detail: detailsMap[r.labelId] || null,
      laps: lapsMap[r.labelId] || null,
      updated_at: now
    });
    await upsert('activities', docId, doc);
    actCount++;
  }

  // 每日指标：把「每日健康 days」与「训练负荷 load」按日期合并
  const metricMap = {};
  (daily.days || []).forEach(function (day) {
    const d = normalizeDate(day.date);
    if (!d) return;
    if (!metricMap[d]) metricMap[d] = {};
    metricMap[d].health = day;
  });
  (load || []).forEach(function (l) {
    const d = normalizeDate(l.date);
    if (!d) return;
    if (!metricMap[d]) metricMap[d] = {};
    metricMap[d].load = l;
  });
  let metricCount = 0;
  const metricDates = Object.keys(metricMap);
  for (let i = 0; i < metricDates.length; i++) {
    const d = metricDates[i];
    await upsert('metrics_daily', uid + '_' + d.replace(/-/g, ''), {
      _openid: uid,
      uid: uid,
      provider: 'coros',      // 多品牌标记（同上）
      date: d,
      health: metricMap[d].health || null,
      load: metricMap[d].load || null,
      updated_at: now
    });
    metricCount++;
  }

  return {
    region: REGION,
    generatedAt: generatedAt,
    activities: actCount,
    metrics: metricCount,
    details: Object.keys(detailsMap).length,
    errors: errors
  };
}

exports.main = async function (event) {
  event = event || {};
  const started = Date.now();
  try {
    const uid = resolveUid(event);
    if (!uid) { return { ok: false, error: '未登录（拿不到用户身份），请先登录' }; }

    let details = event.details !== undefined ? Number(event.details) : 5;
    let days = event.days !== undefined ? Number(event.days) : 90;
    if (isNaN(details) || details < 0) details = 5;
    if (isNaN(days) || days < 0) days = 90;
    details = Math.min(details, 20);
    days = Math.min(days, 180);

    const result = await syncUser(uid, { details: details, days: days });
    const out = Object.assign({ ok: true, uid: uid, ms: Date.now() - started }, result);
    return out;
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e), ms: Date.now() - started };
  }
};
