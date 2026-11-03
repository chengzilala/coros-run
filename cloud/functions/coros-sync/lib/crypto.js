// AES-256-GCM 加解密（与 coros-callback 的密文外壳保持一致：v1:<iv>:<tag>:<ct>）
//
// 用途：coros-sync 在云函数内把 coros_links 里的高驰 token 解密出来用于调 MCP；
//       若刷新了 token 再用 enc 写回。密钥来自环境变量 COROS_TOKEN_KEY（32 字节 base64）。

const crypto = require('crypto');

function key() {
  const k = Buffer.from(process.env.COROS_TOKEN_KEY || '', 'base64');
  if (k.length !== 32) {
    throw new Error('COROS_TOKEN_KEY 必须是 32 字节的 base64（用 openssl rand -base64 32 生成）');
  }
  return k;
}

/** 加密：v1:<iv_b64>:<tag_b64>:<ct_b64> */
function enc(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return 'v1:' + iv.toString('base64') + ':' + tag.toString('base64') + ':' + ct.toString('base64');
}

/** 解密：与 enc 互为逆操作 */
function dec(shell) {
  const parts = String(shell || '').split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('密文格式非法（期望 v1:iv:tag:ct）');
  }
  const iv = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const ct = Buffer.from(parts[3], 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

module.exports = { enc: enc, dec: dec };
