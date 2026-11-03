#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
跑不快 —— 本机本地服务（纯 Python 标准库，无需安装任何东西）

做四件事：
  1) 把 web/ 目录当成网站发布（手机/电脑浏览器访问 http://127.0.0.1:8920 ）
  2) 提供 POST /api/review —— 读取 web/data/dashboard.json，调用大模型生成「中文复盘」
  3) 提供「本机版账户体系」/api/account —— 账户码即账号；Key 加密托管在本机
  4) 提供「比赛记录」/api/races —— 比赛标记/名称/目标按账户码存本机（races.json）

用法：
    python3 web/serve.py
    然后浏览器打开 http://127.0.0.1:8920

AI 复盘的 Key 配置（网页版**只用这一种**）：
    打开页面右上「我的账户」，填 Key 并保存 —— 会加密托管到本机
    web/data/accounts.json（AES 外壳，明文不落地）。
    没配就提示去配置，**不会**偷偷用别处的 Key。
    仅命令行/开发直连本模块时，才读 web/llm_config.json 或环境变量
    LLM_BASE_URL / LLM_API_KEY / LLM_MODEL（不属于网页复盘路径）。

安全：accounts.json / races.json / secret.key / llm_config.json 均在 .gitignore 里，
      且本服务**拒绝**把这些文件当静态资源返回，绝不会被提交或下载。
"""

import base64
import hashlib
import hmac
import json
import os
import random
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BASE_DIR = os.path.dirname(os.path.abspath(__file__))          # .../coros-run/web
PROJ_DIR = os.path.dirname(BASE_DIR)                            # .../coros-run
DATA_DIR = os.path.join(BASE_DIR, "data")
DATA_FILE = os.path.join(DATA_DIR, "dashboard.json")
GARMIN_DATA_FILE = os.path.join(DATA_DIR, "dashboard.garmin.json")
CONFIG_FILE = os.path.join(BASE_DIR, "llm_config.json")
ACCOUNTS_FILE = os.path.join(DATA_DIR, "accounts.json")
SECRET_FILE = os.path.join(DATA_DIR, "secret.key")
RACES_FILE = os.path.join(DATA_DIR, "races.json")
KNOWLEDGE_DIR = os.path.join(PROJ_DIR, "tools", "coach_knowledge")   # 教练知识卡（伤病 / 营养 / 已核验事实）
PORT = int(os.environ.get("PORT", "8920"))

# 账户码：32 位十六进制（前端生成）；放宽到 16–64 位以兼容
ACCOUNT_RE = re.compile(r"^[0-9a-f]{16,64}$")
BIND_TTL_MS = 10 * 60 * 1000        # 6 位登录码有效期：10 分钟
_accounts_lock = threading.Lock()
_races_lock = threading.Lock()

# 比赛记录：允许的字段与上限（前端只传这些；服务端做一次白名单清洗，绝不落可疑内容）
RACE_CATEGORIES = ("", "A", "B", "C")      # 赛事等级：A 目标赛 / B 次目标 / C 体验 / 无
RACE_LIMIT = 500                            # 单个账户最多保存多少条比赛

CONFIG_TEMPLATE = {
    "base_url": "https://api.deepseek.com/v1",
    "api_key": "",
    "model": "deepseek-chat",
    "_说明": "国内可用 DeepSeek（https://platform.deepseek.com 申请 Key）；"
             "也支持任何 OpenAI 兼容接口，如通义/Kimi/OpenRouter 等，改 base_url 和 model 即可。",
}


# ---------- 配置 ----------
def load_llm_config():
    """返回 (base_url, api_key, model)；优先读文件，其次读环境变量。"""
    cfg = {}
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                cfg = json.load(f) or {}
        except Exception:
            cfg = {}
    base = (cfg.get("base_url") or os.environ.get("LLM_BASE_URL") or "").rstrip("/")
    key = cfg.get("api_key") or os.environ.get("LLM_API_KEY") or ""
    model = cfg.get("model") or os.environ.get("LLM_MODEL") or ""
    return base, key, model


def ensure_config_template():
    if not os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump(CONFIG_TEMPLATE, f, ensure_ascii=False, indent=2)
            print("[提示] 已生成 AI 配置模板：%s（填入 Key 后 AI 复盘即可用）" % CONFIG_FILE)
        except Exception:
            pass


def mask_key(key):
    if not key:
        return ""
    if len(key) <= 10:
        return "****"
    return key[:6] + "……" + key[-4:]


# ---------- 自定义地点（地图维度分析）----------
# 结构 {v:1, clusters:{"lat,lng":{n:"地点名",k:"place|treadmill|ignore"}}}；按账户码存，可跨设备登录共用。
_PLACE_KINDS = ("place", "treadmill", "ignore")
_CLUSTER_RE = re.compile(r"^-?\d{1,3}\.\d{1,3},-?\d{1,3}\.\d{1,3}$")
MAX_PLACES = 500


def sanitize_places(raw):
    """把前端传来的地点映射裁剪成安全结构；非法项一律丢弃（最多 500 个点、名字 ≤24 字）。"""
    out = {"v": 1, "clusters": {}}
    if not isinstance(raw, dict):
        return out
    clusters = raw.get("clusters")
    if not isinstance(clusters, dict):
        return out
    for cid, e in list(clusters.items())[:MAX_PLACES]:
        cid = str(cid)
        if not _CLUSTER_RE.match(cid) or not isinstance(e, dict):
            continue
        name = str(e.get("n") or "").strip()[:24]
        kind = e.get("k") if e.get("k") in _PLACE_KINDS else "place"
        if name or kind != "place":
            out["clusters"][cid] = {"n": name, "k": kind}
    return out


# ---------- 账户体系（本机版原型） ----------
# 心智：账户码 = 账号 + 登录凭证（一体），本机唯一持有。无注册/密码。
# 结构 1:1 对齐对外版（见 微信读书插件/plan/账户体系_说明.md）：将来换云函数只改 endpoint + 这套加密函数。
def _b64e(b):
    return base64.b64encode(b).decode("ascii")


def _b64d(s):
    return base64.b64decode(s)


def load_secret():
    """返回 32 字节加密密钥。优先环境变量 COROS_KEY_SECRET，其次本机密钥文件（首次自动生成，chmod 600）。"""
    env = os.environ.get("COROS_KEY_SECRET")
    if env:
        return hashlib.sha256(env.encode("utf-8")).digest()
    try:
        if os.path.exists(SECRET_FILE):
            with open(SECRET_FILE, "r", encoding="utf-8") as f:
                hexs = f.read().strip()
            if len(hexs) >= 32:
                return hashlib.sha256(bytes.fromhex(hexs)).digest()
    except Exception:
        pass
    raw = os.urandom(32)
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        with open(SECRET_FILE, "w", encoding="utf-8") as f:
            f.write(raw.hex())
        os.chmod(SECRET_FILE, 0o600)
    except Exception:
        pass
    return hashlib.sha256(raw).digest()


SECRET = load_secret()


def _keystream(nonce, n):
    out = bytearray()
    counter = 0
    while len(out) < n:
        out += hmac.new(SECRET, nonce + counter.to_bytes(8, "big"), hashlib.sha256).digest()
        counter += 1
    return bytes(out[:n])


def encrypt_secret(plain):
    """本机版加密：v1:<nonce b64>:<tag b64>:<ct b64>。

    用 HMAC-SHA256 生成流密钥 + 认证标签（纯标准库，因 Python 无内置 AES）。
    与对外版 AES-256-GCM 采用**同一密文外壳**，将来换云函数只需替换本函数。
    """
    data = str(plain).encode("utf-8")
    nonce = os.urandom(12)
    ks = _keystream(nonce, len(data))
    ct = bytes(a ^ b for a, b in zip(data, ks))
    tag = hmac.new(SECRET, nonce + ct, hashlib.sha256).digest()
    return "v1:%s:%s:%s" % (_b64e(nonce), _b64e(tag), _b64e(ct))


def decrypt_secret(enc):
    """解密（失败一律返回空串，绝不抛错穿透）。"""
    try:
        parts = str(enc or "").split(":")
        if len(parts) != 4 or parts[0] != "v1":
            return ""
        nonce, tag, ct = _b64d(parts[1]), _b64d(parts[2]), _b64d(parts[3])
        expect = hmac.new(SECRET, nonce + ct, hashlib.sha256).digest()
        if not hmac.compare_digest(expect, tag):
            return ""
        ks = _keystream(nonce, len(ct))
        return bytes(a ^ b for a, b in zip(ct, ks)).decode("utf-8", "replace")
    except Exception:
        return ""


def _now_ms():
    return int(time.time() * 1000)


def _load_accounts():
    obj = {}
    if os.path.exists(ACCOUNTS_FILE):
        try:
            with open(ACCOUNTS_FILE, "r", encoding="utf-8") as f:
                obj = json.load(f) or {}
        except Exception:
            obj = {}
    obj.setdefault("users", {})
    obj.setdefault("binds", {})
    return obj


def _save_accounts(obj):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(ACCOUNTS_FILE, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)


# ---------- 比赛记录（本机版：按账户码存本机 races.json） ----------
# 心智同账户体系：比赛标记/名称/目标属于「用户录入的信息」，跟着账户码走。
# 结构：{ "<device>": [ {race...}, ... ] }。只本机，不入库。
def _load_races():
    obj = {}
    if os.path.exists(RACES_FILE):
        try:
            with open(RACES_FILE, "r", encoding="utf-8") as f:
                obj = json.load(f) or {}
        except Exception:
            obj = {}
    return obj if isinstance(obj, dict) else {}


def _save_races(obj):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(RACES_FILE, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)


def _clean_race(raw):
    """把前端传来的一条比赛压成白名单字段（非法/缺失一律跳过，返回 None）。"""
    if not isinstance(raw, dict):
        return None
    rid = str(raw.get("id") or "").strip()[:64]
    if not rid:
        return None
    kind = str(raw.get("kind") or "").strip()
    if kind not in ("completed", "planned"):
        return None
    date = str(raw.get("date") or "").strip()
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", date):
        date = ""
    dist = raw.get("distanceM")
    try:
        dist = int(dist) if dist not in (None, "") else None
    except Exception:
        dist = None
    cat = str(raw.get("category") or "").strip().upper()
    if cat not in RACE_CATEGORIES:
        cat = ""
    def _ts(v):
        try:
            return int(v)
        except Exception:
            return _now_ms()
    return {
        "id": rid,
        "kind": kind,
        "labelId": (str(raw.get("labelId")).strip()[:64] or None) if raw.get("labelId") else None,
        "name": str(raw.get("name") or "").strip()[:80],
        "date": date,
        "distanceM": dist,
        "category": cat,
        "target": str(raw.get("target") or "").strip()[:60],
        "note": str(raw.get("note") or "").strip()[:500],
        "createdAt": _ts(raw.get("createdAt")),
        "updatedAt": _ts(raw.get("updatedAt")),
    }


def _clean_races(races):
    out, seen = [], set()
    if not isinstance(races, list):
        return out
    for r in races[:RACE_LIMIT]:
        c = _clean_race(r)
        if c and c["id"] not in seen:
            seen.add(c["id"])
            out.append(c)
    return out


def valid_device(device):
    return bool(ACCOUNT_RE.match(str(device or "").strip().lower()))


def get_account(device):
    d = str(device or "").strip().lower()
    if not valid_device(d):
        return None
    return _load_accounts()["users"].get(d)


def resolve_llm_config(device):
    """**严格模式**：网页复盘只用账户托管的 Key。
    账户里没配（或字段不全）就返回空值，由 call_llm 给出「请先去我的账户配置」的可读提示；
    不再退回 web/llm_config.json / 环境变量——避免界面显示「未配置」却偷偷用别处 Key。"""
    acc = get_account(device) or {}
    if acc.get("enc"):
        key = decrypt_secret(acc["enc"])
        base = (acc.get("baseUrl") or "").rstrip("/")
        model = acc.get("model") or ""
        if key and base and model:
            return base, key, model
    return "", "", ""


# ---------- CloudBase 认证中转（对外版登录） ----------
# 为什么中转：浏览器直连 CloudBase 需要把域名加进「WEB 安全域名」，
# 免费体验版不支持添加；而**服务端调用不校验来源域名**，所以由本机服务代打。
# 将来升级套餐后，前端可切回直连（auth.js 里 MODE 改成 sdk）。
CB_ENV = os.environ.get("CB_ENV", "coros-run-d0g0acnksda36ca62")
CB_BASE = "https://%s.api.tcloudbasegateway.com" % CB_ENV
CB_PENDING_TTL_MS = 10 * 60 * 1000   # 验证码有效期 10 分钟
CB_PENDING = {}                      # email -> { verification_id, is_user, ts }
_cb_lock = threading.Lock()


def cb_request(path, payload=None, headers=None):
    """调 CloudBase 认证 HTTP API。返回 (http_status, dict)；status=0 表示连不上。"""
    h = {"Content-Type": "application/json", "Accept": "application/json"}
    if headers:
        h.update(headers)
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(CB_BASE + path, data=data, headers=h, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8", "replace") or "{}")
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(raw or "{}")
        except Exception:
            return e.code, {"error": "http_%s" % e.code, "error_description": raw[:300]}
    except Exception as e:
        return 0, {"error": "network_error",
                   "error_description": "连不上云开发认证服务：%s" % e}


def cb_error(obj, fallback):
    """把 CloudBase 的错误响应压成一句人话。"""
    return obj.get("error_description") or obj.get("error") or fallback


def jwt_payload(token):
    """只解 JWT 的第二段（不验签，仅用于取 uid）。"""
    try:
        seg = str(token).split(".")[1]
        seg += "=" * (-len(seg) % 4)
        return json.loads(base64.urlsafe_b64decode(seg).decode("utf-8", "replace"))
    except Exception:
        return {}


# ---------- 数据 → 给大模型的精简文本 ----------
def load_data(source=None):
    """source="garmin" 时读佳明数据（dashboard.garmin.json），否则读高驰数据（dashboard.json）。"""
    path = GARMIN_DATA_FILE if str(source or "").lower() == "garmin" else DATA_FILE
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _pace(sec):
    if not sec:
        return "—"
    sec = int(round(sec))
    return "%d:%02d" % (sec // 60, sec % 60)


def _dist(m):
    if m is None:
        return "—"
    return "%.2fkm" % (m / 1000.0)


def _dist_cm(cm):
    """分段距离：统一契约单位是**厘米**（高驰原生即为厘米，佳明适配器已 ×100 归一）。"""
    if cm is None:
        return "—"
    return "%.2fkm" % (cm / 100000.0)


def _dur(sec):
    if not sec:
        return "—"
    sec = int(round(sec))
    h, m, s = sec // 3600, (sec % 3600) // 60, sec % 60
    return ("%d:%02d:%02d" % (h, m, s)) if h else ("%d:%02d" % (m, s))


SPORT = {100: "户外跑", 101: "跑步机", 102: "田径场跑", 103: "越野跑",
         104: "徒步", 105: "室内骑行", 200: "骑行", 300: "游泳"}


def build_context(data, scope):
    """把手里的数据结构化成一段中文文本，交给大模型。"""
    p = data.get("profile") or {}
    fit = data.get("fitness") or {}
    lines = []
    lines.append("【个人情况】")
    lines.append("昵称：%s；年龄：%s；身高：%scm；体重：%skg" % (
        p.get("nickname", "—"), p.get("age", "—"), p.get("heightCm", "—"), p.get("weightKg", "—")))
    pred = fit.get("predictions") or {}
    pred_txt = "、".join("%s %s" % (k, v) for k, v in pred.items()) if pred else "—"
    fit_bits = ["VO2max=%s" % (fit.get("vo2max") if fit.get("vo2max") is not None else "—")]
    if fit.get("runningLevel") is not None:      # 佳明无跑力值：不写「—」，直接不提该指标
        fit_bits.append("跑力值=%s" % fit.get("runningLevel"))
    fit_bits.append("阈值配速=%s/km" % _pace(fit.get("thresholdPaceSec")))
    if pred_txt != "—":
        fit_bits.append("完赛预测：%s" % pred_txt)
    lines.append("体能：" + "；".join(fit_bits))
    dev = (data.get("devices") or [{}])[0]
    if dev.get("Model Name"):
        lines.append("设备：%s" % dev.get("Model Name"))

    # 今日状态（恢复类）：摘要 + 红旗 + 厂商准备度（佳明），让模型看到恢复依据
    rd = data.get("readiness") or {}
    if rd.get("summary"):
        lines.append("今日状态：%s（%s）" % (rd.get("label") or "—", rd.get("summary")))
    elif rd.get("label"):
        lines.append("今日状态：%s" % rd.get("label"))
    if rd.get("flags"):
        lines.append("红旗信号：" + "；".join(rd["flags"]))
    if rd.get("garminTrainingReadiness") is not None:
        lines.append("佳明训练准备度：%s 分（%s）" % (
            rd.get("garminTrainingReadiness"), rd.get("garminTrainingReadinessLevel") or "—"))

    # 佳明独有：身体电量（当日峰值）
    bb = data.get("bodyBattery") or []
    if bb:
        last_bb = bb[-1]
        lines.append("身体电量（当日峰值/低点）：%s / %s" % (last_bb.get("high"), last_bb.get("low")))

    load_rows = data.get("trainingLoad") or []
    if load_rows:
        tail = load_rows[-14:]
        lines.append("\n【近期训练负荷（日期/短期/长期）】")
        lines.append("；".join("%s %s/%s" % (r.get("date"), r.get("shortLoad"), r.get("longLoad")) for r in tail))
        last = load_rows[-1]
        if last.get("ratio") is not None:
            lines.append("负荷比：%s（%s）" % (round(last["ratio"], 2),
                                          last.get("status") or last.get("comment") or "—"))

    acts = data.get("activities") or []
    if not acts:
        lines.append("\n（没有运动记录）")
        return "\n".join(lines)

    if scope == "latest":
        acts = acts[:1]
        lines.append("\n【最近一次运动】")
    else:
        acts = acts[:25]
        lines.append("\n【最近的训练记录（从新到旧，共列出 %d 条）】" % len(acts))
    for a in acts:
        lines.append("- %s %s %s，用时%s，配速%s/km，均心%s，消耗%skcal%s" % (
            a.get("date", ""), SPORT.get(a.get("sportType"), a.get("title", "运动")),
            _dist(a.get("distanceM")), _dur(a.get("durationSec")),
            _pace(a.get("paceSec")), a.get("avgHr") or "—", a.get("calories") or "—",
            ("，地点" + a["location"]) if a.get("location") else ""))

    # 详细指标（最近一次）
    details = data.get("details") or {}
    laps = data.get("laps") or {}
    first = acts[0]
    d = details.get(first.get("labelId")) or {}
    if d:
        lines.append("\n【最近一次的关键技术指标】")
        kv = [("平均步频", d.get("avgCadence"), "spm"), ("平均功率", d.get("avgPowerW"), "W"),
              ("平均步幅", d.get("avgStrideM"), "m"), ("累计爬升", d.get("elevGainM"), "m"),
              ("训练负荷", d.get("trainingLoad"), ""), ("有氧效果", d.get("aerobicTE"), ""),
              ("训练重点", d.get("trainingFocus"), ""), ("运动表现", d.get("performance"), "")]
        lines.append("；".join("%s%s%s" % (k, v, u) for k, v, u in kv if v not in (None, "")))
    lk = laps.get(first.get("labelId"))
    if lk:
        groups = lk.get("lapGroups") or []
        g = None
        for x in groups:
            if x.get("type") == 2 and len(x.get("laps") or []) > 1:
                g = x
                break
        if g is None and groups:
            g = sorted(groups, key=lambda x: len(x.get("laps") or []), reverse=True)[0]
        if g and g.get("laps"):
            seg = ["第%d段:%s/%s/心率%s" % (i + 1, _dist_cm(l.get("distance")), _pace(l.get("avgPace")), l.get("avgHr") or "—")
                   for i, l in enumerate(g["laps"][:12])]
            lines.append("【分段（距离/配速/心率）】" + "；".join(seg))

    return "\n".join(lines)


SYSTEM_PROMPT = (
    "你是一位专业、务实、说话直白的跑步教练。你只依据用户提供的真实训练数据做分析，"
    "不要编造数据里没有的信息。用简体中文回答，不要用英文术语堆砌。"
    "【两条硬准则】① 确定性算术不交给 AI——配速、占比、周/月汇总等已在数据里算好，直接引用结果即可，不要自己再算一套；"
    "② 无数据不推断——某项数据缺失就明说「数据不足」，不要臆造或用常识外推。"
    "输出用 Markdown，结构固定为四段："
    "1) 一句话总览；2) 亮点（2-3 条）；3) 需要注意的问题（2-3 条）；4) 接下来 2 周的具体建议（3-4 条，可执行、带数字）。"
    "篇幅控制在 400 字以内，语气鼓励但指出问题，不要空话。"
)

# 多语言：只替换「回答语言」那一句，其余口径完全一致
_LANG_RULE = {
    "en": ("Answer in natural, plain English only — never use Chinese in the answer. "
           "Keep the units used in the data (km, min/km, bpm) and the same four-part Markdown structure."),
    "hant": "請用繁體中文（台灣用語）回答，不要出現簡體字；其餘要求不變。",
}


def system_prompt_for(lang):
    rule = _LANG_RULE.get(lang or "")
    if not rule:
        return SYSTEM_PROMPT
    return SYSTEM_PROMPT.replace("用简体中文回答，不要用英文术语堆砌。", rule)


def call_llm_chat(messages, cfg=None, max_tokens=None, temperature=0.6):
    """多轮对话版：messages 为 [{role, content}...]（须含 system 开头）。"""
    if cfg is None:
        base, key, model = load_llm_config()
    else:
        base, key, model = cfg
    base = (base or "").rstrip("/")
    if not key or not model or not base:
        return None, ("还没有配置大模型。请打开「我的账户」页填写 API Key（推荐 DeepSeek）后重试。")
    url = base + "/chat/completions"
    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "stream": False,
    }
    if max_tokens:
        payload["max_tokens"] = max_tokens
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + key},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            body = json.loads(resp.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")
        return None, "大模型接口报错（HTTP %s）：%s" % (e.code, detail[:400])
    except Exception as e:
        return None, "调用大模型失败：%s（检查网络与 base_url）" % e
    try:
        return body["choices"][0]["message"]["content"], None
    except Exception:
        return None, "大模型返回格式异常：%s" % json.dumps(body, ensure_ascii=False)[:400]


def call_llm(system_prompt, user_prompt, cfg=None, max_tokens=None):
    """单轮（复盘用）：system + user 两条消息。"""
    return call_llm_chat(
        [{"role": "system", "content": system_prompt},
         {"role": "user", "content": user_prompt}],
        cfg=cfg, max_tokens=max_tokens)


# ---------- 教练系统提示词（丹尼尔斯内核 · 四类分工 · 四种人格）----------
# 分工：自身训练类（引用算好的数字）/ 通用知识类 / 事实赛事类（优先用已核验知识）/ 实时类（明说没联网）。
# 方法论来自「丹尼尔斯跑步公式」的通用训练原则（自撰，非搬运）；数字一律引用数据里已算好的结果。
COACH_METHODOLOGY = (
    "你是用户的**专属跑步教练兼「跑步万事通」**：既能帮用户把训练数据翻译成「下一步怎么练」，"
    "也能回答任何与跑步相关的问题。你以杰克·丹尼尔斯（Jack Daniels）跑步公式作为**训练建议**的方法论内核。\n"
    "【先判断问题属于哪一类，再决定怎么答（重要）】\n"
    "① 自身训练类（我该怎么练 / 我最近练得怎样）——必须引用下方【用户的训练数据】里已算好的数字"
    "（五区配速 / 状态灯 / 负荷等），不要自己重算；数据缺失就明说「数据不足」。\n"
    "② 通用知识类（训练原理 / 配速心法 / 常见问题 / 装备 / 饮食常识）——用你自己的知识直接、具体地回答，可给方法与经验，不依赖用户数据。\n"
    "③ 事实 / 赛事类（世界纪录 / 赛事评级 / 大满贯 / 等级标准）——**优先使用下方【已核验知识】里的内容**："
    "命中就以它为准并注明来源；没命中可凭自己的知识作答，但须说明「此项我未核验，建议以官方为准」。\n"
    "④ 实时信息类（最新赛事结果 / 刚刷新的纪录 / 任何需要联网的消息）——**明确说明「我目前没有联网，无法获取实时信息」**，"
    "并给出可查的官方渠道（如世界田联 / 中国田协 / 赛事官网），**绝不编造**结果或数字。\n"
    "【方法论规则（涉及训练建议时必须遵守）】\n"
    "1) 配速用丹尼尔斯五区：E 轻松跑 / M 马拉松配速 / T 阈值跑 / I 间歇 / R 冲刺——区间数值已在数据里算好，直接引用，不要自己再算。\n"
    "2) 强度分布遵循 80/20：轻松跑（E）占约八成，高强度（T/I/R）不超过约两成。\n"
    "3) 周跑量递增遵循 10% 原则：每周总跑量增幅不超过上周 10%，宁可少加、不可猛加。\n"
    "4) 训练要周期化：基础期（E 打底、堆有氧）→ 强化期（加入 T/I）→ 巅峰期（专项）→ 赛前减量（taper，赛前 2–3 周逐步减量）。\n"
    "5) 建议要落到「练什么类型 + 用什么配速区间 + 练多久/多远」，不要给空泛口号。\n"
    "6) 结合训练负荷（短期/长期）与「今日状态」：负荷偏高或状态亮红旗时，主动降级或安排休息。\n"
    "【硬准则（不可违反）】\n"
    "① 确定性算术不交给 AI——配速、占比、周/月汇总等已在数据里算好，直接引用结果，不要自己再算一套。\n"
    "② 不编造具体事实——世界纪录、赛事结果、日期、人名、成绩等「可被查证的具体事实」，没有把握或没有来源就不作断言"
    "（说「不确定 / 建议以官方为准」），尤其不要把旧纪录当成最新的说。\n"
    "③ 健康话题（伤病 / 营养 / 身体不适）只作一般性参考，**不做医疗诊断**；回答务必标注「仅供参考」，情况严重时建议就医。\n"
    "④ 你只能给训练建议，**无法把课表写入用户的手表**（数据只读），不要承诺写表。\n"
    "⑤ 用简体中文，专业但不堆术语，能落地就落到数字。\n"
    "【输出】用 Markdown，简洁、结论先行。"
)

COACH_PERSONAS = {
    "geek": "【说话风格：数据极客】冷静、精确，先摆数据再下结论，爱用数字和对比，几乎不寒暄。",
    "veteran": "【说话风格：老教练】沉稳、有阅历，像带了几十年队的老教练，语气笃定，爱讲经验和道理。",
    "straight": "【说话风格：直球】直接、简短、不绕弯，问题直说、建议干脆，不说客套话。",
    "companion": "【说话风格：伙伴型】像一起训练的跑友，口语、轻松、有温度，多用「咱们」，鼓励为主但也直说问题。",
}
DEFAULT_PERSONA = "companion"
COACH_MAX_HISTORY = 24      # 最多带上多少条历史（含最新一句）
COACH_MAX_CHARS = 4000      # 单条消息最大字符
COACH_MAX_TOKENS = 1200


def build_coach_context(data):
    """教练用的训练上下文：复用 build_context，再补「五区配速」与「今日状态」。"""
    parts = [build_context(data, "all")]
    fit = data.get("fitness") or {}
    p = fit.get("paces") or {}
    if p:
        parts.append("\n【训练配速区（丹尼尔斯五区，直接引用，勿重算）】")
        parts.append("依据%s预测%s；VDOT=%s" % (
            p.get("anchorLabel", "—"), p.get("anchorTime", "—"), p.get("vdot", "—")))
        parts.append("E 轻松 %s/km｜M 马拉松 %s/km｜T 阈值 %s/km｜I 间歇 400m %s、1km %s｜R 冲刺 200m %s、400m %s" % (
            p.get("E", "—"), p.get("M", "—"), p.get("T", "—"),
            p.get("I400", "—"), p.get("I1000", "—"), p.get("R200", "—"), p.get("R400", "—")))
    r = data.get("readiness") or {}
    if r.get("status") and r.get("status") != "unknown":
        flags = ("；" + "、".join(r.get("flags") or [])) if r.get("flags") else ""
        parts.append("\n【今日状态（Readiness）】%s —— %s%s" % (
            r.get("label", ""), r.get("summary", ""), flags))
    return "\n".join(parts)


# ---------- 教练知识卡（伤病 / 营养，自撰，关键词路由注入）----------
KNOW_MAX_CARDS = 2          # 单次最多注入几张卡
KNOW_MAX_CHARS = 2600       # 注入文本总长上限
KNOW_LOOKBACK = 4           # 匹配时回看最近几条用户消息
_KNOW_CACHE = None


def _parse_card(text):
    """解析一张知识卡：首行 `# 标题`、`keywords:` 行、余下为正文。"""
    title = ""
    keywords = []
    body_lines = []
    for line in text.splitlines():
        s = line.strip()
        if not title and s.startswith("# "):
            title = s[2:].strip()
            continue
        if s.lower().startswith("keywords:"):
            keywords = [k.strip() for k in s.split(":", 1)[1].split(",") if k.strip()]
            continue
        body_lines.append(line)
    return title, keywords, "\n".join(body_lines).strip()


def load_knowledge_cards():
    """加载 tools/coach_knowledge/*.md（一次性缓存）。"""
    global _KNOW_CACHE
    if _KNOW_CACHE is not None:
        return _KNOW_CACHE
    cards = []
    try:
        names = sorted(os.listdir(KNOWLEDGE_DIR))
    except OSError:
        names = []
    for name in names:
        if not name.endswith(".md"):
            continue
        try:
            with open(os.path.join(KNOWLEDGE_DIR, name), "r", encoding="utf-8") as f:
                text = f.read()
        except OSError:
            continue
        title, keywords, body = _parse_card(text)
        if body:
            cards.append({"title": title, "keywords": keywords, "body": body})
    _KNOW_CACHE = cards
    return cards


def route_knowledge(messages):
    """按关键词命中，把相关「知识卡」文本拼进上下文（不引向量库）。"""
    cards = load_knowledge_cards()
    if not cards:
        return ""
    users = [m.get("content", "") for m in messages if m.get("role") == "user"]
    text = "\n".join(users[-KNOW_LOOKBACK:])
    if not text:
        return ""
    scored = []
    for c in cards:
        hits = sum(1 for kw in c["keywords"] if kw and kw in text)
        if hits:
            scored.append((hits, c))
    if not scored:
        return ""
    scored.sort(key=lambda x: x[0], reverse=True)
    picked = []
    total = 0
    for _, c in scored[:KNOW_MAX_CARDS]:
        block = "### " + (c["title"] or "知识卡") + "\n" + c["body"]
        if picked and total + len(block) > KNOW_MAX_CHARS:
            break
        picked.append(block)
        total += len(block)
    if not picked:
        return ""
    return ("\n\n【已核验知识参考（自撰/整理，仅供一般性参考；健康内容非医疗诊断，回答健康话题务必提示「仅供参考」）】\n"
            + "\n\n".join(picked))


def _sanitize_messages(raw):
    """把前端传来的对话裁剪成安全的消息列表（只留 user/assistant，限条数与长度）。"""
    out = []
    if not isinstance(raw, list):
        return out
    for m in raw[-COACH_MAX_HISTORY:]:
        if not isinstance(m, dict):
            continue
        role = m.get("role")
        if role not in ("user", "assistant"):
            continue
        content = str(m.get("content") or "").strip()
        if not content:
            continue
        out.append({"role": role, "content": content[:COACH_MAX_CHARS]})
    return out


# ---------- HTTP ----------
class Handler(BaseHTTPRequestHandler):
    server_version = "coros-dashboard/1.0"

    def log_message(self, fmt, *args):  # 只保留关键日志
        sys.stderr.write("[web] " + (fmt % args) + "\n")

    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False)
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path == "/api/account":
            return self.api_account_get(parsed.query)
        if path == "/api/races":
            return self.api_races_get(parsed.query)
        if path == "/api/cloud/me":
            return self.api_cloud_me()
        if path in ("/", ""):
            path = "/index.html"
        elif path in ("/config", "/config/", "/settings", "/account", "/account/"):
            path = "/account.html"
        # 防目录穿越
        rel = os.path.normpath(path.lstrip("/")).replace("\\", "/")
        if rel.startswith(".."):
            return self._send(403, "forbidden", "text/plain; charset=utf-8")
        fp = os.path.join(BASE_DIR, rel)
        # 敏感文件绝不作为静态资源返回
        if os.path.abspath(fp) in (CONFIG_FILE, ACCOUNTS_FILE, SECRET_FILE, RACES_FILE):
            return self._send(403, "forbidden", "text/plain; charset=utf-8")
        if not os.path.isfile(fp):
            return self._send(404, "not found", "text/plain; charset=utf-8")
        ctype = {
            ".html": "text/html; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".json": "application/json; charset=utf-8",
            ".webmanifest": "application/manifest+json; charset=utf-8",
            ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml",
        }.get(os.path.splitext(fp)[1].lower(), "application/octet-stream")
        with open(fp, "rb") as f:
            return self._send(200, f.read(), ctype)

    def _read_json_body(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(n) if n else b"{}"
            return json.loads(raw.decode("utf-8") or "{}")
        except Exception:
            return {}

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/review":
            return self.api_review()
        if path == "/api/coach":
            return self.api_coach()
        if path == "/api/account":
            return self.api_account_post()
        if path == "/api/races":
            return self.api_races_post()
        if path == "/api/cloud/send-code":
            return self.api_cloud_send_code()
        if path == "/api/cloud/login":
            return self.api_cloud_login()
        return self._send(404, {"error": "not found"})

    def api_review(self):
        req = self._read_json_body()
        scope = req.get("scope") or "all"
        device = str(req.get("device") or "").strip().lower()
        source = str(req.get("source") or "").strip().lower()
        lang = str(req.get("lang") or "").strip().lower()

        data = load_data(source)
        if not data:
            return self._send(200, {"error": "没有找到数据。请先运行：COROS_REGION=us python3 tools/fetch_data.py --details 8"})

        context = build_context(data, scope)
        if lang == "en":
            ask = "Here is my %s training data. Please give me a review in English:\n\n"
            brand = "Garmin" if source == "garmin" else "COROS"
        elif lang == "hant":
            ask = "這是我的%s訓練資料，請給我一次繁體中文復盤：\n\n"
            brand = "Garmin" if source == "garmin" else "高馳"
        else:
            ask = "这是我的%s训练数据，请给我一次中文复盘：\n\n"
            brand = "佳明" if source == "garmin" else "高驰"
        user_prompt = (ask % brand) + context
        text, err = call_llm(system_prompt_for(lang), user_prompt, cfg=resolve_llm_config(device))
        if err:
            return self._send(200, {"error": err})
        return self._send(200, {"text": text})

    def api_coach(self):
        """多轮对话教练：前端带全部历史（含最新一句 user），服务端无状态。"""
        req = self._read_json_body()
        device = str(req.get("device") or "").strip().lower()
        persona = req.get("persona") if req.get("persona") in COACH_PERSONAS else DEFAULT_PERSONA
        messages = _sanitize_messages(req.get("messages"))
        if not messages or messages[-1].get("role") != "user":
            return self._send(200, {"error": "消息为空。"})

        data = load_data(req.get("source"))
        if not data:
            return self._send(200, {"error": "没有找到数据。请先运行：COROS_REGION=us python3 tools/fetch_data.py --details 8"})

        system = (COACH_METHODOLOGY + "\n" + COACH_PERSONAS[persona]
                  + "\n\n【用户的训练数据（只读，直接引用其中的数字）】\n" + build_coach_context(data))
        lang = str(req.get("lang") or "").strip().lower()
        if lang == "en":
            system += ("\n\n【Response language】Answer ONLY in natural, plain English. "
                       "Never use Chinese characters in the answer; keep units as in the data.")
        elif lang == "hant":
            system += "\n\n【回答語言】只用繁體中文（台灣用語）回答，不要出現簡體字。"
        know = route_knowledge(messages)
        if know:
            system += know
        calc = str(req.get("calc") or "").strip()
        if calc:
            system += "\n\n【已算好的补给数字（确定性结果，直接引用，勿重算）】\n" + calc[:1500]
        chat = [{"role": "system", "content": system}] + messages
        text, err = call_llm_chat(chat, cfg=resolve_llm_config(device), max_tokens=COACH_MAX_TOKENS)
        if err:
            return self._send(200, {"error": err})
        return self._send(200, {"text": text, "persona": persona})

    # ---------- 账户接口 ----------
    def api_account_get(self, query):
        device = (urllib.parse.parse_qs(query).get("device", [""])[0] if query else "")
        if not valid_device(device):
            return self._send(200, {"error": "缺少或非法的账户码。"})
        acc = get_account(device) or {}
        return self._send(200, {
            "hasKey": bool(acc.get("enc")),
            "masked": acc.get("masked", ""),
            "baseUrl": acc.get("baseUrl", ""),
            "model": acc.get("model", ""),
            "nickName": acc.get("nickName", ""),
            "createdAt": acc.get("createdAt"),
            "places": acc.get("places") or {"v": 1, "clusters": {}},
        })

    def api_account_post(self):
        req = self._read_json_body()
        action = req.get("action") or ""
        device = str(req.get("device") or "").strip().lower()
        if action == "bindRedeem":
            return self.api_bind_redeem(req)
        if not valid_device(device):
            return self._send(200, {"error": "缺少或非法的账户码。"})
        if action == "keySave":
            return self.api_key_save(req, device)
        if action == "keyClear":
            return self.api_key_clear(device)
        if action == "keyReveal":
            return self.api_key_reveal(device)
        if action == "profileSave":
            return self.api_profile_save(req, device)
        if action == "placesSave":
            return self.api_places_save(req, device)
        if action == "bindCreate":
            return self.api_bind_create(device)
        if action == "test":
            return self.api_account_test(req, device)
        return self._send(200, {"error": "未知操作：%s" % action})

    def _upsert_account(self, device, mutate):
        """在同一把锁里读改写账户，返回新的账户 dict。"""
        with _accounts_lock:
            obj = _load_accounts()
            acc = obj["users"].get(device, {})
            mutate(acc)
            acc["createdAt"] = acc.get("createdAt") or _now_ms()
            acc["updatedAt"] = _now_ms()
            obj["users"][device] = acc
            _save_accounts(obj)
            return dict(acc)

    def api_key_save(self, req, device):
        base = (req.get("base_url") or "").strip().rstrip("/")
        model = (req.get("model") or "").strip()
        api_key = (req.get("api_key") or "").strip()
        old = get_account(device) or {}
        if not api_key:
            api_key = decrypt_secret(old.get("enc", ""))   # 留空 = 沿用已托管 Key
        if not api_key:
            return self._send(200, {"error": "API Key 不能为空。"})
        if not base or not model:
            return self._send(200, {"error": "服务地址和模型名不能为空。"})

        def mutate(acc):
            acc["enc"] = encrypt_secret(api_key)
            acc["masked"] = mask_key(api_key)
            acc["baseUrl"] = base
            acc["model"] = model
        acc = self._upsert_account(device, mutate)
        return self._send(200, {"ok": True, "masked": acc["masked"]})

    def api_key_clear(self, device):
        def mutate(acc):
            acc.pop("enc", None)
            acc.pop("masked", None)
        self._upsert_account(device, mutate)
        return self._send(200, {"ok": True})

    def api_key_reveal(self, device):
        """按需回一次明文 Key——只回**本机这个账户自己的**，且仅在前端点「显示」时调用。
        平时（页面加载、keyGet）一律只回掩码，不让明文常驻页面。"""
        acc = get_account(device) or {}
        if not acc.get("enc"):
            return self._send(200, {"ok": False, "error": "还没有托管 Key。"})
        return self._send(200, {"ok": True, "key": decrypt_secret(acc["enc"])})

    def api_profile_save(self, req, device):
        nick = str(req.get("nickName") or "").strip()[:24]

        def mutate(acc):
            acc["nickName"] = nick
        acc = self._upsert_account(device, mutate)
        return self._send(200, {"ok": True, "nickName": nick})

    def api_places_save(self, req, device):
        """保存自定义地点（地图维度）：整份覆盖式写入账户的 places 字段。"""
        places = sanitize_places(req.get("places"))

        def mutate(acc):
            acc["places"] = places
        self._upsert_account(device, mutate)
        return self._send(200, {"ok": True})

    def api_bind_create(self, device):
        with _accounts_lock:
            obj = _load_accounts()
            now = _now_ms()
            # 清掉过期 / 已使用的登录码
            obj["binds"] = {k: v for k, v in obj["binds"].items()
                            if v.get("expireAt", 0) > now and not v.get("redeemed")}
            code = ""
            for _ in range(60):
                c = "%06d" % random.randint(0, 999999)
                if c not in obj["binds"]:
                    code = c
                    break
            if not code:
                return self._send(200, {"error": "生成登录码失败，请重试。"})
            obj["binds"][code] = {"device": device, "expireAt": now + BIND_TTL_MS, "redeemed": False}
            _save_accounts(obj)
        return self._send(200, {"ok": True, "code": code, "ttlMs": BIND_TTL_MS})

    def api_bind_redeem(self, req):
        code = str(req.get("code") or "").strip()
        if not re.fullmatch(r"\d{6}", code):
            return self._send(200, {"error": "请输入 6 位数字登录码。"})
        with _accounts_lock:
            obj = _load_accounts()
            now = _now_ms()
            b = obj["binds"].get(code)
            if not b or b.get("expireAt", 0) <= now:
                return self._send(200, {"error": "登录码已过期，请在另一台设备重新生成。"})
            if b.get("redeemed"):
                return self._send(200, {"error": "登录码已被使用，请重新生成。"})
            b["redeemed"] = True
            obj["binds"][code] = b
            _save_accounts(obj)
            device = b["device"]
        return self._send(200, {"ok": True, "device": device})

    def api_account_test(self, req, device):
        base = (req.get("base_url") or "").strip().rstrip("/")
        model = (req.get("model") or "").strip()
        api_key = (req.get("api_key") or "").strip()
        if not api_key:
            acc = get_account(device) or {}
            api_key = decrypt_secret(acc.get("enc", ""))
            base = base or (acc.get("baseUrl") or "")
            model = model or (acc.get("model") or "")
        if not (api_key and base and model):
            return self._send(200, {"error": "请先填写完整的服务地址、API Key、模型名。"})
        text, err = call_llm("你是连通性测试助手。", "请只回复四个字：连接正常",
                             cfg=(base, api_key, model), max_tokens=24)
        if err:
            return self._send(200, {"error": err})
        return self._send(200, {"ok": True, "reply": (text or "").strip()[:80]})

    # ---------- 比赛记录接口（本机版） ----------
    def api_races_get(self, query):
        device = (urllib.parse.parse_qs(query).get("device", [""])[0] if query else "").strip().lower()
        if not valid_device(device):
            return self._send(200, {"error": "缺少或非法的账户码。"})
        return self._send(200, {"ok": True, "races": _load_races().get(device, [])})

    def api_races_post(self):
        req = self._read_json_body()
        device = str(req.get("device") or "").strip().lower()
        if not valid_device(device):
            return self._send(200, {"error": "缺少或非法的账户码。"})
        races = _clean_races(req.get("races"))
        with _races_lock:
            obj = _load_races()
            obj[device] = races
            _save_races(obj)
        return self._send(200, {"ok": True, "count": len(races)})

    # ---------- CloudBase 登录中转接口 ----------
    def api_cloud_send_code(self):
        req = self._read_json_body()
        email = str(req.get("email") or "").strip()
        if not re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", email):
            return self._send(200, {"error": "邮箱格式不正确。"})
        status, obj = cb_request("/auth/v1/verification", {"target": "ANY", "email": email})
        if status != 200 or not obj.get("verification_id"):
            return self._send(200, {"error": cb_error(obj, "验证码发送失败（HTTP %s）" % status)})
        is_user = bool(obj.get("is_user"))
        with _cb_lock:
            now = _now_ms()
            for k in [k for k, v in CB_PENDING.items() if now - v["ts"] > CB_PENDING_TTL_MS]:
                CB_PENDING.pop(k, None)
            CB_PENDING[email] = {"verification_id": obj["verification_id"],
                                 "is_user": is_user, "ts": now}
        print("[cloud] 验证码已发送：%s（已注册=%s）" % (email, is_user))
        return self._send(200, {"ok": True, "isUser": is_user,
                                "expiresIn": obj.get("expires_in", 600)})

    def api_cloud_login(self):
        req = self._read_json_body()
        email = str(req.get("email") or "").strip()
        code = str(req.get("code") or "").strip()
        device = str(req.get("device") or "").strip().lower()[:64] or "local-device"
        with _cb_lock:
            pending = CB_PENDING.get(email)
        if not pending:
            return self._send(200, {"error": "请先点「发送验证码」。"})
        if not re.fullmatch(r"\d{4,8}", code):
            return self._send(200, {"error": "请输入邮件里的验证码。"})

        status, obj = cb_request("/auth/v1/verification/verify",
                                 {"verification_id": pending["verification_id"],
                                  "verification_code": code})
        vt = obj.get("verification_token")
        if status != 200 or not vt:
            return self._send(200, {"error": cb_error(obj, "验证码校验失败（HTTP %s）" % status)})

        is_user = pending["is_user"]
        if is_user:
            status, obj = cb_request("/auth/v1/signin", {"verification_token": vt},
                                     headers={"x-device-id": device})
        else:
            status, obj = cb_request("/auth/v1/signup",
                                     {"email": email, "verification_token": vt,
                                      "name": email.split("@")[0], "locale": "zh"},
                                     headers={"x-device-id": device})
        if status != 200 or not obj.get("access_token"):
            return self._send(200, {"error": cb_error(obj, "登录失败（HTTP %s）" % status)})

        with _cb_lock:
            CB_PENDING.pop(email, None)
        print("[cloud] 登录成功：%s → uid=%s" % (email, obj.get("sub", "")))
        return self._send(200, {
            "ok": True, "isNewUser": not is_user, "uid": obj.get("sub", ""), "email": email,
            "accessToken": obj.get("access_token", ""),
            "refreshToken": obj.get("refresh_token", ""),
            "expiresIn": obj.get("expires_in", 0),
        })

    def api_cloud_me(self):
        """凭 access_token 回读登录态（只解 JWT，不验签；正式版应改由云函数校验）。"""
        token = self.headers.get("x-access-token") or ""
        payload = jwt_payload(token) if token else {}
        exp = payload.get("exp") or 0
        if not payload or (exp and exp * 1000 < _now_ms()):
            return self._send(200, {"ok": True, "user": None})
        return self._send(200, {"ok": True, "user": {
            "uid": payload.get("sub", ""),
            "email": payload.get("email") or "",
            "name": payload.get("name") or "",
        }})


def main():
    ensure_config_template()
    accounts = _load_accounts().get("users") or {}
    with_key = sum(1 for a in accounts.values() if a.get("enc"))
    print("=" * 56)
    print(" 跑不快 · 本地服务")
    print(" 打开：http://127.0.0.1:%d" % PORT)
    print(" 数据：%s" % ("已就绪" if os.path.exists(DATA_FILE) else "缺失，请先抓取"))
    print(" 账户：%d 个（其中 %d 个已托管 Key，加密存本机）" % (len(accounts), with_key))
    print(" AI ：只用「我的账户」页里的托管 Key；没配则复盘会提示先配置")
    print("=" * 56)
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")


if __name__ == "__main__":
    main()
