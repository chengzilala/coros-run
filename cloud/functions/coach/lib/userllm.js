// 读取当前用户「加密托管的 AI Key」（与 cloud/functions/account 的加密口径完全一致）
//
// 集合 user_llm 每人一条：{ _openid, base_url, model, enc(Key 密文), masked, updated_at }
// 口径：v1:<iv b64>:<tag b64>:<密文 b64>（AES-256-GCM，密钥由环境变量 KEY_SECRET 派生）。
// 明文只在内存中使用，绝不回传浏览器、绝不写日志。

const crypto = require('crypto');

const KEY_SECRET = String(process.env.KEY_SECRET || '');
const LLM_COLLECTION = 'user_llm';

function deriveSecret() {
  return crypto.createHash('sha256').update(KEY_SECRET, 'utf8').digest();
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

/**
 * 读该用户的托管 Key。
 * 返回 { ok:true, base_url, model, api_key } 或 { ok:false, code, error }。
 * 未配置 / 解密失败一律 ok:false；code 统一用 'ai_nokey'，便于前端引导去配置。
 */
async function loadUserLlm(db, uid) {
  if (!KEY_SECRET) {
    return { ok: false, code: 'ai_nokey', error: '服务端未配置 KEY_SECRET，密钥托管不可用' };
  }
  let doc = null;
  try {
    const got = await db.collection(LLM_COLLECTION).where({ _openid: uid }).limit(1).get();
    doc = (got && got.data && got.data[0]) || null;
  } catch (e) {
    doc = null;   // 集合不存在等，按「未配置」处理
  }
  if (!doc || !doc.enc) {
    return { ok: false, code: 'ai_nokey', error: '还没有配置 AI Key' };
  }
  const api_key = decryptSecret(doc.enc);
  const base_url = String(doc.base_url || '').trim().replace(/\/+$/, '');
  const model = String(doc.model || '').trim();
  if (!api_key || !base_url || !model) {
    return { ok: false, code: 'ai_nokey', error: '托管 Key 不完整，请重新填写' };
  }
  return { ok: true, base_url: base_url, model: model, api_key: api_key };
}

module.exports = { loadUserLlm: loadUserLlm, decryptSecret: decryptSecret };
