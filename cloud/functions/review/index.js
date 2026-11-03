// 云函数 review —— AI 中文复盘（用户自填 Key 优先 + 平台 Key 可选兜底）
//
// 作用：前端登录后在看板点「生成复盘」调用本函数。本函数：
//   1) 从调用上下文取当前用户 uid（网关已验签）；
//   2) 取该用户**加密托管的 AI Key**（集合 user_llm）——配了就用自己的 Key，**不计平台额度**；
//   3) 没配时：平台 Key 兜底**默认关闭**（环境变量 PLATFORM_LLM_ENABLED），
//      未启用则直接返回 code='ai_nokey'，引导用户去「我的账户」填写自己的 Key；
//      启用了才走平台统一 Key，并按用户/天限流（集合 usage_quota）；
//   4) 按 uid 读该用户云端训练数据（profiles/activities/metrics_daily），拼成中文上下文；
//   5) 调用大模型返回复盘文本；
//   6) 仅「平台 Key 模式」下、成功后再把当天计数 +1（失败不计费）。
//
// 与「本机自用版」的关系：口径与 prompt 与 web/serve.py 的 /api/review 完全一致，
// 本机预览仍走 /api/review（只用本机账户托管的 Key）。
//
// 依赖环境变量（控制台「云函数 → 配置 → 环境变量」）：
//   KEY_SECRET            应用层加密密钥（**与 account 云函数一致**，一旦设置不要更改）
//   PLATFORM_LLM_ENABLED  是否提供平台 Key 兜底，默认 'false'（不消耗平台额度，用户须自填）
//   LLM_BASE_URL          平台 Key 的大模型地址，默认 https://api.deepseek.com/v1
//   LLM_API_KEY           平台统一的 Key（**只填在控制台，绝不入库/不进代码库**）
//   LLM_MODEL             平台 Key 的模型名，默认 deepseek-chat
//   REVIEW_DAILY_LIMIT    每人每天复盘次数上限（仅平台 Key 模式），默认 10
//
// 依赖集合：profiles / activities / metrics_daily + usage_quota + user_llm
// 建议函数超时设为 60s（大模型响应可能较慢）。
//
// 说明：只返回文本，前端不做二次解析；出错一律返回 { ok:false, error }，未配 Key 时带 code='ai_nokey'。

const cloudbase = require('@cloudbase/node-sdk');
const context = require('./lib/context');
const userllm = require('./lib/userllm');

const app = cloudbase.init({
  env: cloudbase.SYMBOL_CURRENT_ENV || process.env.TCB_ENV || process.env.SCF_NAMESPACE
});
const db = app.database();

const PLATFORM_ENABLED = String(process.env.PLATFORM_LLM_ENABLED || 'false').toLowerCase() === 'true';
const LLM_BASE = String(process.env.LLM_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/+$/, '');
const LLM_KEY = process.env.LLM_API_KEY || '';
const LLM_MODEL = process.env.LLM_MODEL || 'deepseek-chat';
const DAILY_LIMIT = Math.max(1, Number(process.env.REVIEW_DAILY_LIMIT || 10));

// 与 web/serve.py 完全一致的复盘口径（改一处需同步另一处）
const SYSTEM_PROMPT = (
  '你是一位专业、务实、说话直白的跑步教练。你只依据用户提供的真实训练数据做分析，' +
  '不要编造数据里没有的信息。用简体中文回答，不要用英文术语堆砌。' +
  '【两条硬准则】① 确定性算术不交给 AI——配速、占比、周/月汇总等已在数据里算好，直接引用结果即可，不要自己再算一套；' +
  '② 无数据不推断——某项数据缺失就明说「数据不足」，不要臆造或用常识外推。' +
  '输出用 Markdown，结构固定为四段：' +
  '1) 一句话总览；2) 亮点（2-3 条）；3) 需要注意的问题（2-3 条）；4) 接下来 2 周的具体建议（3-4 条，可执行、带数字）。' +
  '篇幅控制在 400 字以内，语气鼓励但指出问题，不要空话。'
);

// 多语言：只替换「回答语言」那一句，其余口径与中文保持一致
const LANG_RULE = {
  en: 'Answer in natural, plain English only — never use Chinese in the answer. ' +
      'Keep the units used in the data (km, min/km, bpm) and the same four-part Markdown structure.',
  hant: '請用繁體中文（台灣用語）回答，不要出現簡體字；其餘要求不變。'
};
function systemPromptFor(lang) {
  const rule = LANG_RULE[lang];
  return rule ? SYSTEM_PROMPT.replace('用简体中文回答，不要用英文术语堆砌。', rule) : SYSTEM_PROMPT;
}

// ---------------- 身份 ----------------
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

// ---------------- 日期 / 额度 ----------------
function pad2(n) { return (n < 10 ? '0' : '') + n; }
/** 当天日期 key（YYYYMMDD）。云函数运行在 UTC，这里统一按北京时间（UTC+8）取日，
 *  保证每日额度在用户本地 0 点重置，而不是 UTC 0 点（北京时间早上 8 点）。 */
function todayKey() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return '' + d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate());
}

async function readQuota(uid, date) {
  const got = await db.collection('usage_quota').where({ _openid: uid, date: date }).limit(1).get();
  return (got && got.data && got.data[0]) || null;
}

/** 当天计数 +1（当天记录不存在则新建）。返回更新后的计数（仅用于回显额度）。 */
async function bumpQuota(uid, date) {
  const col = db.collection('usage_quota');
  const id = uid + '_' + date;
  const got = await col.where({ _id: id }).get();
  if (got && got.data && got.data.length) {
    await col.doc(id).update({ review_count: db.command.inc(1), updated_at: Date.now() });
    return Number(got.data[0].review_count || 0) + 1;
  }
  try {
    await col.add({ _id: id, _openid: uid, uid: uid, date: date, review_count: 1, updated_at: Date.now() });
    return 1;
  } catch (e) {
    // 并发下可能已被创建：原子自增即可
    await col.doc(id).update({ review_count: db.command.inc(1), updated_at: Date.now() });
    return 1;
  }
}

// ---------------- 取数（与 dashboard 云函数同结构） ----------------
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

/** 读该用户云端看板数据；无资料记录则返回 null */
async function loadBoardData(uid) {
  const profRows = await db.collection('profiles').where({ _openid: uid }).limit(1).get();
  const prof = (profRows && profRows.data && profRows.data[0]) || null;
  if (!prof) { return null; }

  const actRows = await fetchAll('activities', uid, 'date');
  const metricRows = await fetchAll('metrics_daily', uid, 'date');

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

  const trainingLoad = [];
  metricRows.forEach(function (row) { if (row.load) { trainingLoad.push(row.load); } });
  trainingLoad.sort(function (a, b) { return a.date < b.date ? -1 : 1; });

  return {
    profile: prof.profile || {},
    devices: prof.devices || [],
    fitness: prof.fitness || {},
    trainingLoad: trainingLoad,
    activities: activities,
    details: details,
    laps: laps
  };
}

// ---------------- 大模型调用 ----------------
async function callLLM(userPrompt, cfg, lang) {
  const url = cfg.base + '/chat/completions';
  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.key },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: 'system', content: systemPromptFor(lang) },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.6,
        stream: false
      })
    });
  } catch (e) {
    return { text: null, err: '调用大模型失败：' + String((e && e.message) || e) + '（检查服务地址与网络）' };
  }
  const body = await resp.json().catch(function () { return {}; });
  if (!resp.ok) {
    return { text: null, err: '大模型接口报错（HTTP ' + resp.status + '）：' + JSON.stringify(body).slice(0, 400) };
  }
  const text = body && body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content;
  if (!text) { return { text: null, err: '大模型返回格式异常：' + JSON.stringify(body).slice(0, 400) }; }
  return { text: text, err: null };
}

// ---------------- 主流程 ----------------
exports.main = async function (event) {
  event = event || {};
  const started = Date.now();
  try {
    const uid = resolveUid(event);
    if (!uid) { return { ok: false, error: '未登录（拿不到用户身份），请先登录' }; }

    const scope = event.scope === 'latest' ? 'latest' : 'all';
    const lang = (event.lang === 'en' || event.lang === 'hant') ? event.lang : 'hans';
    const date = todayKey();

    // 1) 定 Key 来源：用户自填优先；未配则看平台兜底是否启用（默认关闭）
    let cfg = null, usePlatform = false;
    const uk = await userllm.loadUserLlm(db, uid);
    if (uk.ok) {
      cfg = { base: uk.base_url, key: uk.api_key, model: uk.model };
    } else if (PLATFORM_ENABLED && LLM_KEY) {
      cfg = { base: LLM_BASE, key: LLM_KEY, model: LLM_MODEL };
      usePlatform = true;
    } else {
      return {
        ok: false,
        code: 'ai_nokey',
        error: '还没有配置自己的 AI Key：请到「我的账户 → AI 复盘 Key」填写（支持 DeepSeek / 通义 / Kimi / 智谱 / 豆包等），填一次即可长期使用。',
        ms: Date.now() - started
      };
    }

    // 2) 仅平台 Key 模式：先查额度
    if (usePlatform) {
      const q = await readQuota(uid, date);
      const used = q ? Number(q.review_count || 0) : 0;
      if (used >= DAILY_LIMIT) {
        return {
          ok: false,
          error: '今天的 AI 复盘次数已用完（每人每天 ' + DAILY_LIMIT + ' 次），明天再来吧。也可以到「我的账户」填写自己的 Key，用自己的 Key 不受此限制。',
          quota: { date: date, used: used, limit: DAILY_LIMIT, remaining: 0 },
          ms: Date.now() - started
        };
      }
    }

    // 3) 取数拼上下文
    const data = await loadBoardData(uid);
    if (!data) {
      return { ok: false, error: '云端暂无你的数据，请先在「账户」页点「同步高驰数据」', ms: Date.now() - started };
    }
    const ask = lang === 'en' ? 'Here is my COROS training data. Please give me a review in English:\n\n'
      : (lang === 'hant' ? '這是我的高馳訓練資料，請給我一次繁體中文復盤：\n\n'
        : '这是我的高驰训练数据，请给我一次中文复盘：\n\n');
    const userPrompt = ask + context.buildContext(data, scope);

    // 4) 调大模型
    const r = await callLLM(userPrompt, cfg, lang);
    if (r.err) { return { ok: false, error: r.err, ms: Date.now() - started }; }

    // 5) 仅平台 Key 模式：成功后再计数
    let quota = null;
    if (usePlatform) {
      const nowUsed = await bumpQuota(uid, date);
      quota = { date: date, used: nowUsed, limit: DAILY_LIMIT, remaining: Math.max(0, DAILY_LIMIT - nowUsed) };
    }
    return {
      ok: true,
      text: r.text,
      quota: quota,
      ms: Date.now() - started
    };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e), ms: Date.now() - started };
  }
};
