// 云函数 coros-callback —— 高驰 OAuth 回调（阶段 B2）
//
// 作用：用户在高驰完成授权后，高驰把浏览器**回调到这个地址**：
//       https://<环境默认域名>/coros/callback?code=...&state=...
//       本函数用 code 换 token，把 token **AES-256-GCM 加密**后写入集合 coros_links，
//       最后返回一个「绑定成功」的网页。
//
// 触发方式：CloudBase「HTTP 访问服务」把路径 /coros/callback 绑到本函数（GET）。
//
// 依赖环境变量：
//   COROS_REGION     us / cn / eu（本账号为 us）
//   COROS_REDIRECT_URI  与 coros-authorize 里一致的回调地址
//   COROS_TOKEN_KEY  32 字节随机密钥的 base64（用于 AES-256-GCM 加密 token）
//                    生成示例：openssl rand -base64 32
//
// 依赖集合（控制台先建）：coros_app、coros_oauth_state（由 coros-authorize 写）、coros_links

const cloudbase = require('@cloudbase/node-sdk');
const crypto = require('crypto');

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
const REDIRECT_URI = process.env.COROS_REDIRECT_URI || '';

/** AES-256-GCM 加密，输出外壳：v1:<iv_b64>:<tag_b64>:<ct_b64> */
function enc(plain) {
  const key = Buffer.from(process.env.COROS_TOKEN_KEY || '', 'base64');
  if (key.length !== 32) { throw new Error('COROS_TOKEN_KEY 必须是 32 字节的 base64（用 openssl rand -base64 32 生成）'); }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return 'v1:' + iv.toString('base64') + ':' + tag.toString('base64') + ':' + ct.toString('base64');
}

/** 统一返回一个 HTML 页面（HTTP 访问服务「集成响应」） */
function html(statusCode, title, message) {
  const body = '<!doctype html><meta charset="utf-8"><title>' + title + '</title>'
    + '<div style="font-family:-apple-system,\'PingFang SC\',sans-serif;padding:48px;text-align:center;color:#222">'
    + '<h2>' + title + '</h2><p style="color:#666">' + message + '</p></div>';
  return { statusCode: statusCode, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: body };
}

/** 从各种触发形态里取出 query 参数 */
function queryOf(event) {
  event = event || {};
  if (event.queryStringParameters) { return event.queryStringParameters; }
  if (event.query) { return event.query; }
  if (event.path || event.rawPath) {
    const raw = event.rawQueryString || (String(event.path || event.rawPath).split('?')[1] || '');
    const out = {};
    new URLSearchParams(raw).forEach(function (v, k) { out[k] = v; });
    return out;
  }
  return {};
}

/** 用授权码换取 token（form-encoded） */
async function exchangeToken(code, clientId, verifier) {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code: code,
    redirect_uri: REDIRECT_URI,
    client_id: clientId,
    code_verifier: verifier
  });
  const resp = await fetch(AUTH_BASE + '/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString()
  });
  const data = await resp.json().catch(function () { return {}; });
  if (!resp.ok || !data || !data.access_token) {
    throw new Error('换取 token 失败：HTTP ' + resp.status + ' ' + JSON.stringify(data));
  }
  return data;
}

/** 把加密后的高驰授权写入 coros_links（按 uid 覆盖更新） */
async function saveLink(uid, token) {
  const now = Date.now();
  const expiresAt = now + (Number(token.expires_in) || 0) * 1000;
  const record = {
    _openid: uid,
    uid: uid,
    provider: 'coros',
    region: REGION,
    enc_token: enc(token.access_token),
    enc_refresh: enc(token.refresh_token || ''),
    scope: token.scope || '',
    expires_at: expiresAt,
    updated_at: now
  };
  const col = db.collection('coros_links');
  const existing = await col.where({ _openid: uid }).get();
  if (existing && existing.data && existing.data.length) {
    const id = existing.data[0]._id;
    const upd = Object.assign({}, record);
    delete upd._openid;
    delete upd.uid;
    await col.doc(id).update(upd);
  } else {
    await col.add(record);
  }
}

exports.main = async function (event) {
  try {
    if (!REDIRECT_URI) { return html(500, '配置缺失', '云函数未配置 COROS_REDIRECT_URI。'); }

    const q = queryOf(event);
    if (q.error) {
      return html(400, '授权未完成', '高驰返回：' + q.error + ' ' + (q.error_description || ''));
    }
    const code = q.code || '';
    const state = q.state || '';
    if (!code || !state) { return html(400, '参数缺失', '回调缺少 code 或 state。'); }

    // 核对 state（取出授权时暂存的 uid + PKCE verifier）
    const stCol = db.collection('coros_oauth_state');
    const got = await stCol.where({ _id: state }).get();
    if (!got || !got.data || !got.data.length) {
      return html(400, 'state 无效', '未找到对应的授权会话，可能已过期，请回到页面重新绑定。');
    }
    const sess = got.data[0];
    if (sess.expire_at && Date.now() > sess.expire_at) {
      return html(400, '授权超时', '授权会话已过期，请回到页面重新绑定。');
    }

    // 取 client_id（与 coros-authorize 复用同一条）
    const appGot = await db.collection('coros_app').where({ _id: 'default' }).get();
    const clientId = (appGot && appGot.data && appGot.data[0] && appGot.data[0].client_id) || '';
    if (!clientId) { return html(500, '配置缺失', '未找到高驰 client_id，请先调用 coros-authorize。'); }

    const token = await exchangeToken(code, clientId, sess.code_verifier);
    await saveLink(sess.uid, token);

    // 用完即删，state 一次性
    try { await stCol.doc(state).remove(); } catch (e) { /* 忽略 */ }

    return html(200, '绑定成功 ✅', '已完成高驰账号绑定，可以关闭本页面回到 App。');
  } catch (e) {
    return html(500, '绑定失败', String((e && e.message) || e));
  }
};
