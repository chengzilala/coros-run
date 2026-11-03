// 云函数 account —— 账户数据管理（阶段 E：合规 + AI Key 加密托管）
//
// 动作（入参 event.action）：
//   'status'（默认）：返回当前用户的**高驰绑定状态**（是否已绑定 / 上次更新时间 / 区域），
//                     并附**高驰用户资料**（昵称/身高/体重/性别/生日/年龄，来自 profiles.profile；
//                     未同步过则为 null）。只回状态与资料，绝不返回 token 密文等敏感字段。
//   'placesGet'     ：返回当前用户的**自定义地点**（地图维度分析用；结构 {v,clusters}）。
//   'placesSave'    ：覆盖式保存当前用户的自定义地点。
//   'keyGet'        ：返回当前用户「AI Key 托管」状态（是否已配置 + 掩码 + base_url/model），**绝不回明文**。
//   'keyReveal'     ：按需**回一次明文**给本人（仅前端点「显示」时调用；不常驻、不写日志）。
//   'keySave'       ：加密托管用户自填的 AI Key（{base_url, api_key, model}）。
//   'keyClear'      ：清除当前用户托管的 AI Key（保留 base_url/model 与其它账户资料）。
//   'keyTest'       ：用（本次传入或已托管的）Key 试调一次大模型，验证连通性。
//   'delete'        ：删除当前登录用户的**全部云端数据**（不可恢复），含托管 AI Key。
//
// 安全：一律只按调用上下文里的 uid 操作，**绝不动别人数据**；
//      `coros_app` 是全站配置（高驰 client_id），**不属于用户数据，不删**。
//      AI Key 用 AES-256-GCM 应用层加密后再入库，明文只在内存中使用、不写日志；
//      只有 keyReveal 会在用户在账户页主动点「显示」时，按 uid 回一次**本人这份**明文。
//
// 依赖环境变量：KEY_SECRET（任意足够长的随机串，用于加密托管的 AI Key；**一旦设置不要更改**，否则已托管 Key 无法解密）。
//
// 部署：Node.js 18，handler=index.main。安全规则建议「仅登录用户可调用」（auth != null）。

const cloudbase = require('@cloudbase/node-sdk');
const crypto = require('crypto');

const app = cloudbase.init({
  env: cloudbase.SYMBOL_CURRENT_ENV || process.env.TCB_ENV || process.env.SCF_NAMESPACE
});
const db = app.database();

// ---------------- AI Key 加密托管（与 微信读书插件 wereadProxy 同口径） ----------------
const KEY_SECRET = String(process.env.KEY_SECRET || '');
const LLM_COLLECTION = 'user_llm';   // { _openid, base_url, model, enc, masked, updated_at }

/** 32 字节派生密钥（对 KEY_SECRET 做 SHA-256；secret 本身不入库、不写日志） */
function deriveSecret() {
  return crypto.createHash('sha256').update(KEY_SECRET, 'utf8').digest();
}

/** 应用层加密：v1:<iv b64>:<tag b64>:<密文 b64>（AES-256-GCM） */
function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveSecret(), iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

/** 解密（失败一律返回空串，绝不抛错穿透） */
function decryptSecret(enc) {
  const parts = String(enc || '').split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') { return ''; }
  try {
    const iv = Buffer.from(parts[1], 'base64');
    const tag = Buffer.from(parts[2], 'base64');
    const ct = Buffer.from(parts[3], 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', deriveSecret(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
  } catch (e) {
    return '';
  }
}

/** 掩码：只露头 4 尾 4，用于界面显示 */
function maskKey(key) {
  const s = String(key || '');
  if (!s) { return ''; }
  if (s.length <= 8) { return s.slice(0, 2) + '****'; }
  return s.slice(0, 4) + '****' + s.slice(-4);
}

/** 规范化 base_url：去首尾空格与结尾斜杠；仅允许 http/https */
function cleanBaseUrl(raw) {
  const s = String(raw || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(s)) { return ''; }
  return s.slice(0, 200);
}

/** 读该用户的托管文档（不存在返回 null，绝不抛错） */
async function readLlmDoc(uid) {
  try {
    const got = await db.collection(LLM_COLLECTION).where({ _openid: uid }).limit(1).get();
    return (got && got.data && got.data[0]) || null;
  } catch (e) {
    return null;   // 集合不存在等，按「未配置」处理
  }
}

/** 校验一组 LLM 配置是否齐全（用于 keySave / keyTest） */
function validLlmInput(baseUrl, model, apiKey) {
  return !!baseUrl && !!model && !!apiKey;
}

/** 调用一次大模型做连通性测试，返回 { ok, reply } 或 { ok:false, error } */
async function testLLM(baseUrl, model, apiKey) {
  let resp;
  try {
    resp = await fetch(baseUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: '你好，请只回复两个字：收到' }],
        max_tokens: 16,
        temperature: 0,
        stream: false
      })
    });
  } catch (e) {
    return { ok: false, error: '连接失败：' + String((e && e.message) || e) + '（检查 base_url 与网络）' };
  }
  const body = await resp.json().catch(function () { return {}; });
  if (!resp.ok) {
    return { ok: false, error: '接口报错（HTTP ' + resp.status + '）：' + JSON.stringify(body).slice(0, 300) };
  }
  const text = body && body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content;
  if (!text && text !== '') {
    return { ok: false, error: '返回格式异常：' + JSON.stringify(body).slice(0, 300) };
  }
  return { ok: true, reply: String(text || '').trim() };
}

// ---------------- 身份（与其它云函数一致） ----------------
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

// ---------------- 归属字段说明 ----------------
// profiles / activities / metrics_daily / coros_links / usage_quota 用 `_openid` 标记归属；
// coros_oauth_state 用 `uid` 标记归属。
const USER_TARGETS = [
  ['profiles', '_openid'],
  ['activities', '_openid'],
  ['metrics_daily', '_openid'],
  ['coros_links', '_openid'],
  ['usage_quota', '_openid'],
  ['user_prefs', '_openid'],
  ['user_llm', '_openid'],
  ['coros_oauth_state', 'uid']
];

// ---------------- 自定义地点（地图维度分析）----------------
// 结构 {v:1, clusters:{"lat,lng":{n:"地点名",k:"place|treadmill|ignore"}}}
const PLACE_KINDS = ['place', 'treadmill', 'ignore'];
const CLUSTER_RE = /^-?\d{1,3}\.\d{1,3},-?\d{1,3}\.\d{1,3}$/;
const MAX_PLACES = 500;
const EMPTY_PLACES = { v: 1, clusters: {} };

/** 裁剪前端传来的地点映射为安全结构；非法项一律丢弃（最多 500 个点、名字 ≤24 字）。 */
function sanitizePlaces(raw) {
  const out = { v: 1, clusters: {} };
  if (!raw || typeof raw !== 'object' || !raw.clusters || typeof raw.clusters !== 'object') { return out; }
  Object.keys(raw.clusters).slice(0, MAX_PLACES).forEach(function (cid) {
    if (!CLUSTER_RE.test(cid)) { return; }
    const e = raw.clusters[cid] || {};
    if (typeof e !== 'object') { return; }
    const name = String(e.n || '').trim().slice(0, 24);
    const kind = PLACE_KINDS.indexOf(e.k) >= 0 ? e.k : 'place';
    if (name || kind !== 'place') { out.clusters[cid] = { n: name, k: kind }; }
  });
  return out;
}

// ---------------- 主流程 ----------------
exports.main = async function (event) {
  event = event || {};
  try {
    const uid = resolveUid(event);
    if (!uid) { return { ok: false, error: '未登录（拿不到用户身份），请先登录' }; }

    const KNOWN = ['delete', 'placesGet', 'placesSave', 'keyGet', 'keySave', 'keyClear', 'keyReveal', 'keyTest'];
    const action = KNOWN.indexOf(event.action) >= 0 ? event.action : 'status';

    if (action === 'status') {
      const got = await db.collection('coros_links').where({ _openid: uid }).limit(1).get();
      const link = (got && got.data && got.data[0]) || null;
      // 顺带回一次高驰用户资料（供账户页展示；没同步过则为 null，绝不报错）
      let profile = null;
      try {
        const pg = await db.collection('profiles').where({ _openid: uid }).limit(1).get();
        const pdoc = (pg && pg.data && pg.data[0]) || null;
        if (pdoc && pdoc.profile) { profile = pdoc.profile; }
      } catch (e) { profile = null; }
      return {
        ok: true,
        bound: !!link,
        provider: link ? (link.provider || 'coros') : '',
        region: link ? (link.region || '') : '',
        updatedAt: link ? Number(link.updated_at || 0) : 0,
        profile: profile
      };
    }

    // action === 'placesGet'：读当前用户的自定义地点（集合/记录不存在时返回空结构）
    if (action === 'placesGet') {
      try {
        const got = await db.collection('user_prefs').where({ _openid: uid }).limit(1).get();
        const doc = (got && got.data && got.data[0]) || null;
        return { ok: true, places: sanitizePlaces(doc && doc.places) };
      } catch (e) {
        // 集合不存在等：视为「还没有地点」
        return { ok: true, places: EMPTY_PLACES };
      }
    }

    // action === 'placesSave'：覆盖式保存当前用户的自定义地点
    if (action === 'placesSave') {
      const places = sanitizePlaces(event.places);
      const got = await db.collection('user_prefs').where({ _openid: uid }).limit(1).get();
      const doc = (got && got.data && got.data[0]) || null;
      if (doc && doc._id) {
        await db.collection('user_prefs').doc(doc._id).update({ places: places, updated_at: Date.now() });
      } else {
        await db.collection('user_prefs').add({ _openid: uid, places: places, updated_at: Date.now() });
      }
      return { ok: true };
    }

    // action === 'keyGet'：只回「是否已配置 + 掩码 + base_url/model」，绝不回明文
    if (action === 'keyGet') {
      const doc = await readLlmDoc(uid);
      return {
        ok: true,
        hasKey: !!(doc && doc.enc),
        masked: (doc && doc.masked) || '',
        baseUrl: (doc && doc.base_url) || '',
        model: (doc && doc.model) || ''
      };
    }

    // action === 'keyReveal'：按需回一次明文——只回**本人 uid 名下的**，且仅在前端点「显示」时调用。
    // 平时（页面加载、keyGet）一律只回掩码，不让明文常驻页面。
    if (action === 'keyReveal') {
      const doc = await readLlmDoc(uid);
      if (!doc || !doc.enc) { return { ok: false, error: '还没有托管 Key。' }; }
      return { ok: true, key: decryptSecret(doc.enc) };
    }

    // action === 'keySave'：加密托管用户自填的 AI Key
    if (action === 'keySave') {
      if (!KEY_SECRET) { return { ok: false, error: '服务端未配置 KEY_SECRET，密钥托管暂不可用。' }; }
      const baseUrl = cleanBaseUrl(event.base_url);
      const model = String(event.model || '').trim().slice(0, 80);
      const apiKey = String(event.api_key || '').trim();
      if (!baseUrl) { return { ok: false, error: '服务地址不对：需以 http:// 或 https:// 开头（一般末尾带 /v1）。' }; }
      if (!model) { return { ok: false, error: '请填写模型名（如 deepseek-chat）。' }; }
      if (!apiKey) { return { ok: false, error: '请填写 API Key。' }; }

      const doc = await readLlmDoc(uid);
      const patch = {
        base_url: baseUrl,
        model: model,
        enc: encryptSecret(apiKey),
        masked: maskKey(apiKey),
        updated_at: Date.now()
      };
      if (doc && doc._id) {
        await db.collection(LLM_COLLECTION).doc(doc._id).update(patch);
      } else {
        try {
          await db.collection(LLM_COLLECTION).add(Object.assign({ _openid: uid }, patch));
        } catch (e) {
          await db.createCollection(LLM_COLLECTION);
          await db.collection(LLM_COLLECTION).add(Object.assign({ _openid: uid }, patch));
        }
      }
      return { ok: true, hasKey: true, masked: patch.masked, baseUrl: baseUrl, model: model };
    }

    // action === 'keyClear'：只清 Key（保留 base_url/model 与其它账户资料）
    if (action === 'keyClear') {
      try {
        const doc = await readLlmDoc(uid);
        if (doc && doc._id) {
          await db.collection(LLM_COLLECTION).doc(doc._id).update({ enc: '', masked: '', updated_at: Date.now() });
        }
      } catch (e) { /* 文档不存在也算成功 */ }
      return { ok: true };
    }

    // action === 'keyTest'：用（本次传入或已托管的）Key 试调一次大模型
    if (action === 'keyTest') {
      let baseUrl = cleanBaseUrl(event.base_url);
      let model = String(event.model || '').trim().slice(0, 80);
      let apiKey = String(event.api_key || '').trim();
      // 传来的字段不全时，回退到已托管的那份（方便「Key 只填一次，之后留空测试」）
      if (!validLlmInput(baseUrl, model, apiKey)) {
        const doc = await readLlmDoc(uid);
        if (doc && doc.enc) {
          baseUrl = baseUrl || cleanBaseUrl(doc.base_url);
          model = model || String(doc.model || '');
          apiKey = apiKey || decryptSecret(doc.enc);
        }
      }
      if (!validLlmInput(baseUrl, model, apiKey)) {
        return { ok: false, error: '请先填写完整的服务地址、模型名与 API Key。' };
      }
      const r = await testLLM(baseUrl, model, apiKey);
      return r.ok ? { ok: true, reply: r.reply } : { ok: false, error: r.error };
    }

    // action === 'delete'：逐集合按归属删除
    const counts = {};
    for (let i = 0; i < USER_TARGETS.length; i++) {
      const col = USER_TARGETS[i][0];
      const key = USER_TARGETS[i][1];   // '_openid' 或 'uid'
      try {
        const where = {};
        where[key] = uid;
        const res = await db.collection(col).where(where).remove();
        const n = (res && (res.deleted || (res.stats && res.stats.removed))) || 0;
        counts[col] = n;
      } catch (e) {
        // 集合不存在等情况：记录但继续删其它集合
        counts[col] = 'error: ' + String((e && e.message) || e);
      }
    }
    return { ok: true, deleted: counts, at: Date.now() };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
};
