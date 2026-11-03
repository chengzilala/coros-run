// 云函数 ps-login —— 把「统一账户」换成 CloudBase 登录态（一座身份桥）
//
// 做的事：
//   1) 收到统一账户 Token（ps_token），服务端向账户中心 action=me 验明身份，拿到 uid；
//   2) 用 CloudBase「自定义登录」私钥签一张 Ticket 返回前端；
//   3) 前端 signInWithCustomTicket(ticket) 后，本站云函数（dashboard/account/...）照旧按 uid 取数。
//
// 身份映射（ps_uid_map 集合，_id = ps_<hash>）：
//   - 第一次调用时，如果请求来自**已登录的旧本站会话**（云函数调用上下文里有 uid），
//     就把旧 uid 记下来当这个统一账户的 CloudBase uid —— 历史数据一条不丢；
//   - 否则用 ps_<hash> 作为新身份（新用户从零开始）。
//
// 调用方式（两种都支持）：
//   - 云函数调用：CorosAuth.callFunction('ps-login', { token })，能带旧会话 uid 做迁移绑定；
//   - HTTP 访问服务：POST /ps-login  { token }，用于「还没有任何本站会话」的新用户。
//
// 依赖环境变量：
//   TCB_CUSTOM_LOGIN_KEY = 控制台「身份认证 → 登录方式 → 自定义登录」下载的私钥 JSON 全文
// 依赖集合：ps_uid_map

const cloudbase = require('@cloudbase/node-sdk');
const https = require('https');
const crypto = require('crypto');

const ENV = cloudbase.SYMBOL_CURRENT_ENV || process.env.TCB_ENV || process.env.SCF_NAMESPACE;
const ACCOUNT_API = 'https://account.chesterlee.cn/accountCenter';
const MAP_COL = 'ps_uid_map';
const LOG_COL = 'ps_login_log';
const TICKET_TTL = 3600 * 1000; // CloudBase access_token 刷新间隔（毫秒）

// 允许跨域调用本站的前端来源（HTTP 访问服务时用）
const ORIGINS = ['https://run.chesterlee.cn', 'http://127.0.0.1:8920', 'http://localhost:8920'];

let _app = null;
/** 自定义登录私钥：优先取环境变量，其次取函数目录里的私钥文件（本机生成、不入库）
 *  注意字段名：SDK 只认 env_id / private_key_id / private_key；
 *  控制台下载的 JSON 是 env / keyId / privateKey（大写时为 KeyID / PrivateKey），这里统一转换。 */
function credentials() {
  const raw = process.env.TCB_CUSTOM_LOGIN_KEY || '';
  let json = null;
  if (raw) {
    try { json = JSON.parse(raw); } catch (e) { json = null; }
  }
  if (!json) {
    try { json = require('./tcb_custom_login.json'); } catch (e) { return null; }
  }
  if (!json) { return null; }
  const cred = {
    env_id: json.env_id || json.env || ENV,
    private_key_id: json.private_key_id || json.keyId || json.KeyID || '',
    private_key: json.private_key || json.privateKey || json.PrivateKey || ''
  };
  if (!cred.private_key) { return null; }
  return cred;
}

function app() {
  if (_app) { return _app; }
  const opt = { env: ENV };
  const cred = credentials();
  if (cred) { opt.credentials = cred; }
  _app = cloudbase.init(opt);
  return _app;
}

/** POST JSON（不引第三方库，云函数只跑标准库） */
function postJson(url, body, headers) {
  return new Promise(function (resolve, reject) {
    const data = Buffer.from(JSON.stringify(body || {}));
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method: 'POST',
      timeout: 8000,
      headers: Object.assign({
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }, headers || {})
    }, function (res) {
      const chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { resolve(null); }
      });
    });
    req.on('timeout', function () { req.destroy(new Error('timeout')); });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/** 向账户中心验 Token；无效返回 null */
async function verifyPsToken(token) {
  if (!token) { return null; }
  try {
    const res = await postJson(ACCOUNT_API, { action: 'me' }, { Authorization: 'Bearer ' + token });
    if (res && res.ok === true && res.data && res.data.uid) { return res.data; }
  } catch (e) { /* 网络失败按未登录处理 */ }
  return null;
}

/** 记账：把每次换票的结果写进 ps_login_log（不含 token / 票据，便于线上排查） */
async function audit(rec) {
  const db = app().database();
  const doc = Object.assign({ at: new Date().toISOString() }, rec || {});
  try {
    await db.collection(LOG_COL).add(doc);
  } catch (e) {
    try {
      await db.createCollection(LOG_COL);
      await db.collection(LOG_COL).add(doc);
    } catch (e2) { /* 审计失败不影响主流程 */ }
  }
}

/** 从云函数调用上下文取旧会话 uid（不验签，网关已验签） */
function ctxUid(ev) {
  try {
    const parts = String((ev.tcbContext || {}).accessToken || '').split('.');
    if (parts.length < 2) { return ''; }
    let b = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4) { b += '='; }
    const c = JSON.parse(Buffer.from(b, 'base64').toString('utf8'));
    return c.sub || c.user_id || '';
  } catch (e) { return ''; }
}

function hash(s) {
  return crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 20);
}

/** 查/建 ps 统一账户 → CloudBase uid 的映射 */
async function resolveCloudUid(psUid, legacyUid) {
  const db = app().database();
  const _id = 'ps_' + hash(psUid);
  let doc = null;
  try {
    const got = await db.collection(MAP_COL).doc(_id).get();
    doc = (got && got.data && (got.data[0] || got.data)) || null;
  } catch (e) { doc = null; }

  if (doc && doc.cloudUid) { return doc.cloudUid; }

  const cloudUid = legacyUid || ('ps_' + hash(psUid));
  try {
    await db.collection(MAP_COL).doc(_id).set({
      psUid: psUid,
      cloudUid: cloudUid,
      via: legacyUid ? 'legacy' : 'new',
      boundAt: new Date().toISOString()
    });
  } catch (e) { /* 写失败不拦登录，下次再建 */ }
  return cloudUid;
}

function reply(httpEvent, code, body) {
  if (!httpEvent) { return body; }
  const origin = (httpEvent.headers && (httpEvent.headers.origin || httpEvent.headers.Origin)) || '';
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
  if (ORIGINS.indexOf(origin) >= 0) { headers['Access-Control-Allow-Origin'] = origin; }
  return { statusCode: code, headers: headers, body: JSON.stringify(body) };
}

/** HTTP 访问服务：event.body 可能是 base64 或明文 JSON */
function parseBody(ev) {
  try {
    const raw = ev.isBase64Encoded
      ? Buffer.from(ev.body || '', 'base64').toString('utf8')
      : (ev.body || '{}');
    return JSON.parse(raw || '{}');
  } catch (e) { return {}; }
}

exports.main = async function (event) {
  const isHttp = !!(event && (event.httpMethod || event.requestContext));
  const payload = isHttp ? parseBody(event) : (event || {});

  if (isHttp && String(event.httpMethod || '').toUpperCase() === 'OPTIONS') {
    return reply(event, 200, { ok: true });
  }

  // 前端换票失败时回报（不带 token），只记账
  if (payload.report) {
    await audit({ stage: 'client', code: String(payload.report), message: String(payload.message || '').slice(0, 300) });
    return reply(event, 200, { ok: true });
  }

  const token = String(payload.token || '');
  const ps = await verifyPsToken(token);
  if (!ps) {
    await audit({ stage: 'verify', ok: false, code: 'UNAUTHORIZED', isHttp: isHttp, hasToken: !!token });
    return reply(event, 401, { ok: false, code: 'UNAUTHORIZED', message: '统一账户登录已失效，请重新登录' });
  }

  const cloudUid = await resolveCloudUid(ps.uid, isHttp ? '' : ctxUid(event));

  let ticket = '';
  try {
    // node-sdk 同步返回字符串；个别版本返回 Promise，这里统一 await
    const t = await app().auth().createTicket(cloudUid, { refresh: TICKET_TTL });
    ticket = typeof t === 'string' ? t : String((t && (t.ticket || t.Ticket)) || '');
  } catch (e) {
    await audit({ stage: 'ticket', ok: false, code: 'NO_KEY', message: String((e && e.message) || e).slice(0, 300), uid: cloudUid });
    return reply(event, 500, {
      ok: false,
      code: 'NO_KEY',
      message: '环境还没配置「自定义登录」私钥（云函数环境变量 TCB_CUSTOM_LOGIN_KEY）'
    });
  }
  if (!ticket) {
    await audit({ stage: 'ticket', ok: false, code: 'NO_TICKET', uid: cloudUid });
    return reply(event, 500, { ok: false, code: 'NO_TICKET', message: '票据签发失败' });
  }

  await audit({ stage: 'ticket', ok: true, code: 'OK', uid: cloudUid, psUid: ps.uid, isHttp: isHttp });

  return reply(event, 200, {
    ok: true,
    uid: cloudUid,
    nickname: ps.nickname || '',
    ticket: ticket
  });
};
