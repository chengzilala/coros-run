// 云函数 coros-authorize —— 生成高驰授权链接（阶段 B1）
//
// 作用：前端已用「产品账号」登录后调用本函数，拿到一条**高驰授权页链接**，
//      前端把它跳转过去；用户在高驰登录并同意后，高驰会回调到
//      /coros/callback（见云函数 coros-callback）带 code 回来。
//
// 关键点：
//   1) 用调用上下文 event.tcbContext.accessToken（JWT，网关已验签）取当前产品用户 uid；
//   2) 动态注册高驰客户端（只注册一次，client_id 存库复用）；
//   3) 生成 PKCE（code_verifier/challenge）+ 随机 state，把 state→{uid, verifier}
//      存进集合 coros_oauth_state，供回调时核对；
//   4) 返回可跳转的授权 URL。
//
// 依赖环境变量（控制台「云函数 → 配置 → 环境变量」）：
//   COROS_REGION        us / cn / eu（本账号为 us）
//   COROS_REDIRECT_URI  高驰回调地址，例：
//                       https://coros-run-d0g0acnksda36ca62.service.tcloudbase.com/coros/callback
//
// 依赖集合（控制台先建）：coros_app（存 client_id）、coros_oauth_state（存待核对的 state）

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
const SCOPE = 'openid mcp.tools offline_access';
const STATE_TTL_MS = 10 * 60 * 1000; // state 10 分钟有效

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

/** PKCE：返回 { verifier, challenge } */
function pkcePair() {
  const verifier = crypto.randomBytes(48).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return { verifier: verifier, challenge: challenge };
}

/** 取（或首次注册）高驰客户端 client_id，缓存在集合 coros_app 的单条文档里 */
async function getOrRegisterClient() {
  const col = db.collection('coros_app');
  const got = await col.where({ _id: 'default' }).get();
  if (got && got.data && got.data.length) { return got.data[0].client_id; }

  const resp = await fetch(AUTH_BASE + '/connect/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'coros-run-cloud',
      redirect_uris: [REDIRECT_URI],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: SCOPE
    })
  });
  const info = await resp.json().catch(function () { return {}; });
  if (!resp.ok || !info || !info.client_id) {
    throw new Error('注册高驰客户端失败：HTTP ' + resp.status + ' ' + JSON.stringify(info));
  }
  const data = {
    _id: 'default',
    client_id: info.client_id,
    redirect_uris: [REDIRECT_URI],
    created_at: Date.now()
  };
  try { await col.add(data); } catch (e) { /* 并发下可能已存在，忽略 */ }
  return info.client_id;
}

exports.main = async function (event) {
  event = event || {};
  try {
    if (!REDIRECT_URI) { throw new Error('未配置环境变量 COROS_REDIRECT_URI'); }

    const c = claimOf(event);
    const uid = c.sub || c.user_id || '';
    if (!uid) { return { ok: false, error: '未登录（拿不到用户身份），请先登录再绑定高驰' }; }

    const clientId = await getOrRegisterClient();
    const pkce = pkcePair();
    const state = crypto.randomBytes(24).toString('hex');

    // 存 state → { uid, verifier }，回调时据此核验并换 token
    await db.collection('coros_oauth_state').add({
      _id: state,
      uid: uid,
      code_verifier: pkce.verifier,
      redirect_uri: REDIRECT_URI,
      created_at: Date.now(),
      expire_at: Date.now() + STATE_TTL_MS
    });

    const params = {
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      scope: SCOPE,
      state: state,
      code_challenge: pkce.challenge,
      code_challenge_method: 'S256'
    };
    const url = AUTH_BASE + '/oauth2/authorize?' + new URLSearchParams(params).toString();

    return { ok: true, url: url };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
};
