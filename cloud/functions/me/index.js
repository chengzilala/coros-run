// 云函数 me —— 对外版登录骨架的「身份探针」
// 作用：被前端登录后调用，返回云函数侧识别到的当前用户身份。
//      能返回 uid 即证明「登录态 → 云函数」链路是通的。
//
// 部署：在 CloudBase 控制台 → 云函数 → 新建函数（Node.js）→ 粘贴本文件内容；
//      函数名填 me；安全规则设为「所有用户可调用」或 "auth != null"（仅登录后）。
//
// 说明：本文件用 @cloudbase/node-sdk 从调用上下文取身份，无需自己传 token。

const cloudbase = require('@cloudbase/node-sdk');

const app = cloudbase.init({
  env: cloudbase.SYMBOL_CURRENT_ENV || process.env.TCB_ENV || process.env.SCF_NAMESPACE
});

exports.main = async function (event) {
  try {
    const info = app.auth().getUserInfo() || {};
    const userInfo = info.userInfo || {};
    return {
      ok: true,
      uid: userInfo.uid || userInfo.openId || userInfo.customUserId || '',
      openId: userInfo.openId || '',
      loginType: userInfo.loginType || '',
      // 回显一下入参，方便前端确认「入参也送到了」
      echo: event || {}
    };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
};
