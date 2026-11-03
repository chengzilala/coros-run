#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
佳明（Garmin）数据源适配器 —— 多品牌支持「步 1/2」的骨架（见 RPD §16）。

定位
----
本文件是 **独立新模块**，不改动、不依赖高驰（coros_probe.py / fetch_data.py）任何代码；
只在运行时复用同目录的两个**纯函数**模块：pace.py（跑力五区配速）、readiness.py（今日准备度）。
它负责：登录佳明 → 抓活动/每日指标/资料/恢复 → 映射成与高驰**同一套统一模型** →
写入**独立文件** `web/data/dashboard.garmin.json`（**不覆盖**高驰的 dashboard.json）。

数据源路线（用户已确认）
------------------------
走 **B：非官方 Connect 库**（`garminconnect` + `garth`）。
⚠️ 这是本项目「零第三方依赖」红线的**明确破例**，且**仅限本机抓数脚本**，不进对外版后端。
   安装（需 Python 3.10+；国区实测锁 0.2.40 可用）：
       python3.12 -m venv .venv-garmin
       .venv-garmin/bin/python -m pip install "garminconnect==0.2.40"
   本仓库已把虚拟环境放在 `.venv-garmin/`（已 gitignore），跑佳明命令时用：
       .venv-garmin/bin/python tools/source_garmin.py

⚠️ 中国区登录（实测要点）：garmin.cn 已切换到**新版 SSO 门户**（sso.garmin.cn/portal/...），
   旧库的 /sso/embed 表单流程会统一 401。本文件用 `_portal_login_cn()` 走新链路：
   门户登录拿 CAS ticket → 旧 oauth preauthorized 换 OAuth1（login-url 必须与 ticket 的 service
   完全一致，即 https://connect.garmin.cn/modern/）→ exchange/user/2.0 换 OAuth2，
   再把令牌灌回 garth client，后续 connectapi 调用与旧流程一致。

用法
----
    # 1) 首次：把账号放进环境变量（推荐）或写本地凭据文件（见下）
    export GARMIN_EMAIL="你的佳明账号"
    export GARMIN_PASSWORD="你的密码"
    export GARMIN_REGION="cn"          # cn=中国区(garmin.cn)；global=国际区(默认)

    # 2) 登录并抓最近 90 天、最近 8 次活动详情
    python3 tools/source_garmin.py
    python3 tools/source_garmin.py --days 180 --details 15

    # 3) 首次对接强烈建议先「原样落盘」看清佳明真实字段名（映射以实测为准）
    python3 tools/source_garmin.py --dump-raw

安全（红线）
------------
    - 凭据优先放 macOS **钥匙串**（服务名 coros-run-garmin），其次环境变量，最后才读明文
      `.garmin_secret.json`（仅兼容老配置，已弃用）；令牌存在本机 `.garmin_tokens/`。
    - 以上路径均已在 .gitignore；只读佳明数据，不上传任何地方；抓到的数据落在 web/data/（已整体 gitignore）。

⚠️ 说明：本文件是**骨架**。佳明各接口的**真实字段名**需用你的账号 `--dump-raw` 实测后校准；
   下面凡标注 `TODO(实测)` 处即为待核对点，当前实现是**防御式取值**（取不到就 None，绝不臆造）。
"""
import argparse
import datetime
import importlib.util
import json
import os
import re
import sys
import time
from urllib.parse import parse_qs, quote

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)

# ---------- 复用同目录纯函数模块（与 fetch_data.py 同款加载方式，互不影响） ----------
def _load(name, filename):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, filename))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

pace = _load("pace", "pace.py")
readiness = _load("readiness", "readiness.py")

# ---------- 配置 ----------
REGION = os.environ.get("GARMIN_REGION", "global")          # cn | global
IS_CN = REGION == "cn"
TOKEN_DIR = os.path.join(PROJ, ".garmin_tokens")            # garth 令牌存储目录（gitignored）
SECRET_FILE = os.path.join(PROJ, ".garmin_secret.json")     # 本地凭据（gitignored，已弃用，优先用钥匙串）
KEYCHAIN_SERVICE = "coros-run-garmin"                       # macOS 钥匙串服务名（推荐的凭据存放处）
RAW_DIR = os.path.join(PROJ, "web", "data", "_garmin_raw")  # --dump-raw 落盘目录
OUT_FILE = os.path.join(PROJ, "web", "data", "dashboard.garmin.json")
# 适配器契约（供 tools/adapters.py 动态加载；详见 tools/adapters.py）
PROVIDER = "garmin"
DEFAULT_OUT = os.path.join("web", "data", "dashboard.garmin.json")
RUN_TYPES = {"running", "treadmill_running", "track_running", "trail_running", "indoor_running"}
# 佳明活动类型 → 高驰运动码（尽量对齐，未知则按户外跑 100 处理；TODO(实测) 核对后端是否依赖该码）
SPORT_CODE = {
    "running": 100, "indoor_running": 101, "treadmill_running": 101,
    "track_running": 102, "trail_running": 103,
}


# ---------------- 通用小工具 ----------------
def dig(obj, *path, default=None):
    """安全地按路径取值：dict 用键、list 用下标；任一步取不到就返回 default。"""
    cur = obj
    for p in path:
        if isinstance(cur, dict):
            cur = cur.get(p)
        elif isinstance(cur, list) and isinstance(p, int) and -len(cur) <= p < len(cur):
            cur = cur[p]
        else:
            return default
        if cur is None:
            return default
    return cur


def to_int(v):
    try:
        return int(round(float(v)))
    except (TypeError, ValueError):
        return None


def to_float(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _round1(v):
    f = to_float(v)
    return round(f, 1) if f is not None else None


def fmt_time(seconds):
    """秒 → H:MM:SS / MM:SS（供 pace.build_paces 的完赛预测键用）。"""
    sec = to_int(seconds)
    if sec is None or sec <= 0:
        return None
    h, m, s = sec // 3600, (sec % 3600) // 60, sec % 60
    return "%d:%02d:%02d" % (h, m, s) if h else "%d:%02d" % (m, s)


def speed_to_pace(speed_ms):
    """m/s → 秒/公里；非正数返回 None。"""
    v = to_float(speed_ms)
    return to_int(1000.0 / v) if v and v > 0 else None


def _date_str(d):
    return d.strftime("%Y%m%d")


# ---------------- 依赖加载 ----------------
def require_garminconnect():
    try:
        from garminconnect import Garmin  # noqa: F401
        return Garmin
    except ImportError:
        venv_py = os.path.join(PROJ, ".venv-garmin", "bin", "python")
        hint = (".venv-garmin/bin/python tools/source_garmin.py"
                if os.path.exists(venv_py) else
                ".venv-garmin/bin/python -m pip install \"garminconnect==0.2.40\"")
        sys.exit(
            "缺少依赖 garminconnect。\n"
            "本项目常规「零第三方依赖」，佳明抓数是经用户确认的**唯一破例**，仅限本机脚本。\n"
            "请用佳明专用虚拟环境运行：\n"
            "    %s\n"
            "（国区锁 0.2.x；0.3.x 会导致国区 DI token 失败。）" % hint
        )


def _keychain_credentials():
    """从 macOS 钥匙串读佳明账号（服务名 KEYCHAIN_SERVICE，账户名=邮箱，密码=密码）。

    写入（只需一次，密码不会落进仓库或明文文件）：
        security add-generic-password -U -s coros-run-garmin -a "你的邮箱" -w "你的密码"
    非 macOS 或没录过返回 None，继续走后面的兜底来源。
    """
    if sys.platform != "darwin":
        return None
    try:
        import subprocess

        def _sec(*args):
            return subprocess.run(["security"] + list(args), capture_output=True, text=True, timeout=5)

        pwd = _sec("find-generic-password", "-s", KEYCHAIN_SERVICE, "-w")
        if pwd.returncode != 0:
            return None
        info = _sec("find-generic-password", "-s", KEYCHAIN_SERVICE)
        m = re.search(r'"acct"<blob>="([^"]*)"', info.stdout or "")
        email = m.group(1) if m else ""
        password = (pwd.stdout or "").strip()
        if email and password:
            return email, password
    except Exception:
        return None
    return None


def load_credentials():
    """凭据来源优先级：环境变量 → macOS 钥匙串 → 本地明文文件（已弃用，仅兼容老配置）。"""
    email = os.environ.get("GARMIN_EMAIL")
    password = os.environ.get("GARMIN_PASSWORD")
    if email and password:
        return email, password
    kc = _keychain_credentials()
    if kc:
        return kc
    if os.path.exists(SECRET_FILE):
        try:
            with open(SECRET_FILE, "r", encoding="utf-8") as f:
                s = json.load(f)
            email, password = s.get("email"), s.get("password")
            if email and password:
                print("[提示] 正在使用明文凭据 %s，建议改存系统钥匙串后删除该文件（见 --help 说明）" % SECRET_FILE)
                return email, password
        except Exception:
            pass
    sys.exit(
        "未找到佳明账号凭据。请任选一种：\n"
        "  1) 环境变量：export GARMIN_EMAIL=... GARMIN_PASSWORD=...\n"
        "  2) macOS 钥匙串（推荐，不落明文）：\n"
        '     security add-generic-password -U -s %s -a "你的邮箱" -w "你的密码"\n'
        '  3) 本地文件 %s：{"email": "...", "password": "..."}（已在 .gitignore）' % (KEYCHAIN_SERVICE, SECRET_FILE)
    )


def _portal_login_cn(email, password):
    """中国区**新版 SSO 门户**登录 → (OAuth1Token, OAuth2Token)。

    背景：2025 年起 garmin.cn 把登录换成了新版门户（Vue SPA，sso.garmin.cn/portal/...），
    garth/garminconnect 仍走旧的 /sso/embed 表单流程，因此会统一 401。实测可行的替代链路：
      1) POST portal/api/login 拿 CAS ticket（服务端固定把 service 归到 https://connect.garmin.cn/modern/）
      2) 用该 ticket 走 connectapi 的 oauth preauthorized —— **login-url 必须与 ticket 的 service 完全一致**，
         否则报 "ticket does not match supplied service"
      3) OAuth1 → exchange/user/2.0 换 OAuth2
    拿到令牌后写回 garth client，后续 connectapi 调用与旧流程完全一致。
    """
    import requests
    from requests_oauthlib import OAuth1Session
    from garth.auth_tokens import OAuth1Token, OAuth2Token

    svc = "https://connect.garmin.cn/modern/"
    q = "?clientId=GarminConnect&locale=zh-CN&service=%s" % quote(svc, safe="")
    ua = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
        "Accept-Language": "zh-CN,zh;q=0.9",
    }
    s = requests.Session()
    s.headers.update(ua)
    s.get("https://sso.garmin.cn/portal/sso/zh-CN/sign-in" + q, timeout=60)
    s.get("https://sso.garmin.cn/portal/api/checkLogin" + q, timeout=60)
    r = s.post(
        "https://sso.garmin.cn/portal/api/login" + q,
        json={"username": email, "password": password,
              "rememberMe": False, "captchaToken": ""},
        timeout=60,
    )
    try:
        d = r.json()
    except ValueError:
        raise RuntimeError("佳明门户登录返回非 JSON（HTTP %s）" % r.status_code)
    ticket = d.get("serviceTicketId")
    if not ticket:
        raise RuntimeError("佳明门户登录失败：%s"
                           % json.dumps(d, ensure_ascii=False)[:300])

    consumer = requests.get("https://thegarth.s3.amazonaws.com/oauth_consumer.json",
                            timeout=30).json()
    o1s = OAuth1Session(consumer["consumer_key"], consumer["consumer_secret"])
    r1 = o1s.get(
        "https://connectapi.garmin.cn/oauth-service/oauth/preauthorized"
        "?ticket=%s&login-url=%s&accepts-mfa-tokens=true"
        % (quote(ticket, safe=""), quote(d.get("serviceURL") or svc, safe="")),
        headers={"User-Agent": "com.garmin.android.apps.connectmobile"}, timeout=60,
    )
    r1.raise_for_status()
    t1 = {k: v[0] for k, v in parse_qs(r1.text).items()}

    o2s = OAuth1Session(
        consumer["consumer_key"], consumer["consumer_secret"],
        resource_owner_key=t1["oauth_token"],
        resource_owner_secret=t1["oauth_token_secret"],
    )
    r2 = o2s.post(
        "https://connectapi.garmin.cn/oauth-service/oauth/exchange/user/2.0",
        headers={"User-Agent": "com.garmin.android.apps.connectmobile",
                 "Content-Type": "application/x-www-form-urlencoded"},
        timeout=60,
    )
    r2.raise_for_status()
    t2 = r2.json()
    now = int(time.time())
    t2.setdefault("expires_at", now + int(t2.get("expires_in") or 0))
    t2.setdefault("refresh_token_expires_at",
                  now + int(t2.get("refresh_token_expires_in") or 0))

    oauth1 = OAuth1Token(oauth_token=t1["oauth_token"],
                         oauth_token_secret=t1["oauth_token_secret"],
                         domain="garmin.cn")
    oauth2 = OAuth2Token(**t2)
    return oauth1, oauth2


def login():
    Garmin = require_garminconnect()
    email, password = load_credentials()
    os.makedirs(TOKEN_DIR, exist_ok=True)
    print("佳明区域 = %s（%s）" % (REGION, "中国区 garmin.cn" if IS_CN else "国际区"))
    client = Garmin(email, password, is_cn=IS_CN,
                    prompt_mfa=lambda: input("请输入佳明 MFA 验证码: "))
    token_file = os.path.join(TOKEN_DIR, "oauth1_token.json")

    # 1) 已有本机令牌 → 直接复用，避免每次登录（garminconnect 0.2.x 传不存在的 tokenstore 会抛错）
    if os.path.exists(token_file):
        try:
            client.login(TOKEN_DIR)
            print("复用本机令牌登录成功：%s"
                  % (client.full_name or client.display_name or email))
            return client
        except Exception as e:  # noqa: BLE001
            print("  ! 已存令牌不可用（%s），重新登录…" % e)

    # 2) 重新登录并落盘令牌
    try:
        if IS_CN:
            # 中国区走新版 SSO 门户（旧 /sso/embed 流程已失效）
            oauth1, oauth2 = _portal_login_cn(email, password)
            client.garth.configure(oauth1_token=oauth1, oauth2_token=oauth2)
            client.garth.dump(TOKEN_DIR)
            client.login(TOKEN_DIR)  # 从令牌补齐 profile / settings
        else:
            client.login()
            client.garth.dump(TOKEN_DIR)
    except Exception as e:  # noqa: BLE001
        if "401" in str(e) or "Unauthorized" in str(e) or "Authentication" in type(e).__name__:
            sys.exit(
                "佳明登录失败：账号或密码不被接受（401）。\n"
                "常见原因：① 仍在使用「临时密码」——需先在网页登录并改成正式密码；\n"
                "          ② 密码刚改过，本机 .garmin_secret.json 还是旧密码；\n"
                "          ③ 账号区域选错（中国区用 GARMIN_REGION=cn，国际区不设或 global）。\n"
                "重新录入密码：python3 tools/garmin_credential.py"
            )
        raise
    print("登录成功：%s" % (client.full_name or client.display_name or email))
    return client


def _safe(fn, label, *a, **kw):
    """任一接口失败都只打印告警并返回 None，保证骨架整体可继续。"""
    try:
        return fn(*a, **kw)
    except Exception as e:  # noqa: BLE001
        print("  ! %s 失败：%s" % (label, e))
        return None


# ---------------- 抓取 + 映射（各接口字段名 TODO(实测) 校准） ----------------
def map_profile(g):
    p = _safe(g.get_user_profile, "get_user_profile") or {}
    ud = dig(p, "userData", default=p) or {}
    weight = to_float(ud.get("weight"))
    if weight and weight > 1000:  # 佳明体重以克存储 → 转 kg（实测 75000 → 75.0kg）
        weight = round(weight / 1000.0, 1)
    bd = ud.get("birthDate") or ud.get("birthday")
    age = None
    if bd and len(str(bd)) >= 4:
        try:
            age = datetime.date.today().year - int(str(bd)[:4])
        except ValueError:
            age = None
    return {
        # userData 里没有昵称，用登录时从 socialProfile 拿到的 fullName / displayName
        "nickname": dig(p, "userData", "displayName") or getattr(g, "full_name", None)
                    or getattr(g, "display_name", None) or ud.get("userName"),
        "heightCm": to_float(ud.get("height")),
        "weightKg": weight,
        "gender": ud.get("gender"),
        "birthday": bd,
        "age": age,
    }


def map_fitness(g, today):
    # 国区 get_max_metrics 常返回空，改用训练状态里的 VO2max（实测 53.1）
    ts = _safe(g.get_training_status, "get_training_status", today) or {}
    vo2 = (dig(ts, "mostRecentVO2Max", "generic", "vo2MaxPreciseValue")
           or dig(ts, "mostRecentVO2Max", "generic", "vo2MaxValue"))
    if vo2 is None:
        prof = _safe(g.get_user_profile, "get_user_profile") or {}
        vo2 = dig(prof, "userData", "vo2MaxRunning")

    # 阈值配速：接口返回 speed（m/s）。国区实测该值被缩小 10 倍
    # （0.3722 ↔ 4:29/km，与阈值心率 173、10K 预测 4:19/km 一致）→ 小于 1 时按 ×10 校正。
    lt = _safe(g.get_lactate_threshold, "get_lactate_threshold", latest=True) or {}
    speed = to_float(dig(lt, "speed_and_heart_rate", "speed"))
    threshold = None
    if speed and speed > 0:
        if speed < 1:
            speed *= 10
        threshold = speed_to_pace(speed)

    pred_raw = _safe(g.get_race_predictions, "get_race_predictions") or {}
    # 佳明预测为秒 → 转字符串，键名对齐 pace.build_paces 需要的 4 个锚点
    predictions = {}
    for gk, pk in (("time5K", "5 km"), ("time10K", "10 km"),
                   ("timeHalfMarathon", "Half Marathon"), ("timeMarathon", "Marathon")):
        t = fmt_time(pred_raw.get(gk))
        if t:
            predictions[pk] = t
    fitness = {"vo2max": to_float(vo2), "runningLevel": None, "thresholdPaceSec": threshold,
               "predictions": predictions}
    paces = pace.build_paces(predictions)
    if paces:
        fitness["paces"] = paces
    return fitness


def map_daily_health(g, start, end):
    h = {"restingHr": None, "hrvBaseline": None, "days": []}
    d = start
    while d <= end:
        ds = d.strftime("%Y-%m-%d")
        day = {"date": d.strftime("%Y%m%d")}
        stats = _safe(g.get_stats, "get_stats(%s)" % ds, ds) or {}
        hr = _safe(g.get_heart_rates, "get_heart_rates(%s)" % ds, ds) or {}
        hrv = _safe(g.get_hrv_data, "get_hrv_data(%s)" % ds, ds) or {}
        sleep = _safe(g.get_sleep_data, "get_sleep_data(%s)" % ds, ds) or {}
        day["Steps"] = str(to_int(stats.get("totalSteps")) or 0)
        day["Calories"] = "%s kcal" % int(to_float(stats.get("totalKilocalories")) or 0)
        day["Exercise"] = "%d min" % int((to_float(stats.get("activeSeconds")) or 0) / 60)
        day["restingHr"] = to_int(hr.get("restingHeartRate") or stats.get("restingHeartRate"))
        day["hrv"] = to_int(dig(hrv, "hrvSummary", "lastNightAvg"))
        day["sleepScore"] = dig(sleep, "dailySleepDTO", "sleepScores", "overall", "value")
        if day["restingHr"] is not None:
            h["restingHr"] = day["restingHr"]
        if day["hrv"] is not None:
            h["hrvBaseline"] = dig(hrv, "hrvSummary", "weeklyAvg") or day["hrv"]
        if any(day.get(k) is not None for k in ("Steps", "restingHr", "hrv", "sleepScore")):
            h["days"].append(day)
        d += datetime.timedelta(days=1)
    return h


def _acute_dto(ts):
    """从 get_training_status 返回里挖出 acuteTrainingLoadDTO（不同设备可能多条，取第一条有值的）。"""
    latest = dig(ts, "mostRecentTrainingStatus", "latestTrainingStatusData")
    if isinstance(latest, dict):
        for dev in latest.values():
            dto = dig(dev, "acuteTrainingLoadDTO")
            if dto:
                return dto
    return None


def map_training_load(g, today, days=30):
    """佳明自带真 ACWR（负荷比）——逐日取训练状态，拼出最近 N 天历史（供负荷趋势图用）。
    字段名已按实测校准：acuteTrainingLoadDTO.dailyTrainingLoadAcute / dailyTrainingLoadChronic /
    dailyAcuteChronicWorkloadRatio / acwrStatus。缺失日期跳过，不补 0。"""
    end_d = datetime.datetime.strptime(today, "%Y-%m-%d").date()
    out = []
    for i in range(max(1, int(days or 1))):
        ds = (end_d - datetime.timedelta(days=i)).strftime("%Y-%m-%d")
        ts = _safe(g.get_training_status, "get_training_status(%s)" % ds, ds) or {}
        dto = _acute_dto(ts)
        if not dto:
            continue
        ratio = to_float(dto.get("dailyAcuteChronicWorkloadRatio"))
        acute = to_int(dto.get("dailyTrainingLoadAcute"))
        chronic = to_int(dto.get("dailyTrainingLoadChronic"))
        if ratio is None and acute is None:
            continue
        out.append({
            "date": ds, "comment": "Garmin ACWR",
            "shortLoad": acute, "longLoad": chronic,
            "ratio": ratio, "source": "Garmin ACWR",
            "status": dto.get("acwrStatus"),      # OPTIMAL / HIGH / LOW ...
        })
    out.sort(key=lambda x: x["date"])
    print("  训练负荷（ACWR）%d 天" % len(out))
    return out


def map_body_battery(g, start, end):
    """佳明独有：身体电量（能量）。取每日最高/最低。
    注意：daily 报表接口只接受**最近约 30 天**的窗口（更长会 400），这里自动截断。"""
    start = max(start, end - datetime.timedelta(days=29))
    bb = _safe(g.get_body_battery, "get_body_battery", start.strftime("%Y-%m-%d"),
               end.strftime("%Y-%m-%d"))
    out = []
    for item in bb or []:
        vals = [v[1] for v in (item.get("bodyBatteryValuesArray") or []) if len(v) > 1 and v[1] is not None]
        if not vals:
            continue
        out.append({"date": (item.get("date") or "").replace("-", ""),
                    "high": max(vals), "low": min(vals)})
    return out


def map_readiness(g, day, daily=None, body_battery=None):
    """准备度（默认看今天）：复用 readiness.py，喂入 HRV 跌幅 / 静息心率升幅 / 睡眠分。
    基线口径：HRV 用佳明 hrvSummary.weeklyAvg；静息心率用该日之前最近 7 天均值。
    取不到的信号一律跳过（skipped），绝不臆造。day 可回退到最近一个有数据的日子（凌晨抓数用）。"""
    hr = _safe(g.get_heart_rates, "get_heart_rates", day) or {}
    hrv = _safe(g.get_hrv_data, "get_hrv_data", day) or {}
    sleep = _safe(g.get_sleep_data, "get_sleep_data", day) or {}
    last_avg = to_float(dig(hrv, "hrvSummary", "lastNightAvg"))
    baseline = to_float(dig(hrv, "hrvSummary", "weeklyAvg"))
    hrv_drop = round((baseline - last_avg) / baseline * 100, 1) if last_avg and baseline else None
    sleep_score = to_int(dig(sleep, "dailySleepDTO", "sleepScores", "overall", "value"))

    # 静息心率升幅：该日 vs 该日之前最近 7 天均值（用已抓好的每日指标，避免重复请求）
    rhr_spike = None
    day_key = day.replace("-", "")
    days = (daily or {}).get("days") or []
    day_rhr = to_int(hr.get("restingHeartRate"))
    if day_rhr is None:
        day_rhr = next((d.get("restingHr") for d in reversed(days)
                        if (d.get("date") or "") == day_key), None)
    prev = [d.get("restingHr") for d in days
            if (d.get("date") or "") < day_key and d.get("restingHr") is not None][-7:]
    if day_rhr is not None and prev:
        rhr_spike = round(day_rhr - sum(prev) / len(prev), 1)

    # 佳明独有：当日身体电量峰值（晨起最高值）→ 并入状态灯；缺失则 skipped，不臆造。
    # 注意用峰值而不是日间最低：最低几乎人人耗到底，不能当恢复红旗。
    bb_peak = None
    for item in body_battery or []:
        if item.get("date") == day_key:
            bb_peak = item.get("high")

    # 佳明自有「训练准备度」（0-100 + 等级 LOW/MODERATE/HIGH…）→ 作为补充信号并入状态灯
    tr = _safe(g.get_training_readiness, "get_training_readiness", day)
    item = {}
    if isinstance(tr, list) and tr:
        item = tr[0] if isinstance(tr[0], dict) else {}
    elif isinstance(tr, dict):
        item = tr
    garmin_readiness = to_int(item.get("score"))
    garmin_level = item.get("level")            # POOR / LOW / MODERATE / HIGH / VERY_HIGH
    out = readiness.compute_readiness(hrv_drop_pct=hrv_drop, rhr_spike_bpm=rhr_spike,
                                      sleep_score=sleep_score, body_battery_peak=bb_peak,
                                      vendor_score=garmin_readiness, vendor_level=garmin_level,
                                      vendor_name="佳明")
    out["garminTrainingReadiness"] = garmin_readiness
    out["garminTrainingReadinessLevel"] = garmin_level
    out["date"] = day
    return out


def map_devices(g):
    """设备列表 → 对齐高驰模型（前端读 name / Model Name）。"""
    raw = _safe(g.get_devices, "get_devices") or []
    out = []
    for d in raw:
        if not isinstance(d, dict):
            continue
        out.append({
            "name": d.get("displayName") or d.get("deviceTypeSimpleName")
                    or d.get("productDisplayName") or str(d.get("unitId") or ""),
            "Bluetooth ID": str(d.get("unitId") or d.get("serialNumber") or ""),
            "Model Name": d.get("productDisplayName") or d.get("deviceTypeSimpleName"),
            "Serial Number": d.get("serialNumber"),
            "Warranty Expires": None,
        })
    return out


def map_activities(g, start, end):
    acts = _safe(g.get_activities_by_date, "get_activities_by_date",
                 start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")) or []
    out = []
    for a in acts:
        type_key = dig(a, "activityType", "typeKey") or ""
        if type_key not in RUN_TYPES:
            continue
        st = a.get("startTimeLocal") or ""
        dur = to_int(a.get("duration"))
        end_ts = None
        start_ts = None
        try:
            dt = datetime.datetime.strptime(st[:19], "%Y-%m-%d %H:%M:%S")
            start_ts = int(dt.replace(tzinfo=datetime.timezone.utc).timestamp())
            end_ts = start_ts + dur if dur else None
        except ValueError:
            pass
        lat, lon = a.get("startLatitude"), a.get("startLongitude")
        out.append({
            "title": a.get("activityName") or type_key,
            "date": st[:10],
            "location": a.get("locationName"),
            "coordinates": ("%f, %f" % (lat, lon)) if lat is not None and lon is not None else None,
            "startTs": start_ts, "endTs": end_ts,
            "durationSec": dur,
            "distanceM": to_int(a.get("distance")),
            "paceSec": speed_to_pace(a.get("averageSpeed")),
            "avgHr": to_int(a.get("averageHR")),
            "calories": to_int(a.get("calories")),
            "labelId": str(a.get("activityId")),
            "sportType": SPORT_CODE.get(type_key, 100),
        })
    out.sort(key=lambda x: x.get("startTs") or 0, reverse=True)
    return out


def map_activity_details(g, act):
    """单次详情：从 get_activity 的 summaryDTO 取（字段名已按实测校准），步幅为 cm → m。"""
    aid = act.get("labelId")
    raw = _safe(g.get_activity, "get_activity(%s)" % aid, aid) or {}
    s = raw.get("summaryDTO") or {}
    splits = _safe(g.get_activity_splits, "get_activity_splits(%s)" % aid, aid) or {}
    laps = dig(splits, "lapDTOs") or []
    best_km = None
    for l in laps:
        d, t = to_float(l.get("distance")), to_float(l.get("duration"))
        if d and t and 990 <= d <= 1010:
            if best_km is None or t < best_km:
                best_km = to_int(t)
    stride = to_float(s.get("strideLength"))     # 厘米
    return {
        "workoutTimeSec": to_int(s.get("movingDuration")) or act.get("durationSec"),
        "totalTimeSec": to_int(s.get("elapsedDuration")),
        "distanceM": to_int(s.get("distance")) or act.get("distanceM"),
        "avgPaceSec": speed_to_pace(s.get("averageSpeed")) or act.get("paceSec"),
        "movingAvgPaceSec": speed_to_pace(s.get("averageMovingSpeed")),
        "adjustedPaceSec": speed_to_pace(s.get("avgGradeAdjustedSpeed")),
        "bestKmSec": best_km,
        "avgHr": to_int(s.get("averageHR")) or act.get("avgHr"),
        "maxHr": to_int(s.get("maxHR")),
        "avgCadence": to_int(s.get("averageRunCadence")),
        "avgStrideM": round(stride / 100.0, 2) if stride else None,
        "avgPowerW": to_int(s.get("averagePower")),
        "calories": to_int(s.get("calories")) or act.get("calories"),
        "trainingLoad": to_int(s.get("activityTrainingLoad")),
        "aerobicTE": _round1(s.get("trainingEffect")),
        "anaerobicTE": _round1(s.get("anaerobicTrainingEffect")),
        "trainingFocus": s.get("trainingEffectLabel"),
        "performance": None,
        "elevGainM": to_float(s.get("elevationGain")),
        "elevLossM": to_float(s.get("elevationLoss")),
    }


def map_activity_laps(g, act):
    """分段：映射成与前端一致的 columns + lapGroups 结构；仅填佳明可靠提供的列，其余 None。
    TODO(实测)：列名/单位对齐前端 laps 渲染（对照高驰 laps）。"""
    aid = act.get("labelId")
    splits = _safe(g.get_activity_splits, "get_activity_splits(%s)" % aid, aid) or {}
    dto = dig(splits, "lapDTOs") or []
    if not dto:
        return None
    columns = [
        {"name": "lapIndex", "label": "圈数"}, {"name": "distance", "label": "距离"},
        {"name": "time", "label": "时间"}, {"name": "totalLength", "label": "累计时间"},
        {"name": "avgPace", "label": "平均配速"}, {"name": "avgHr", "label": "平均心率"},
        {"name": "maxHr", "label": "最大心率"}, {"name": "avgCadence", "label": "平均步频"},
        {"name": "elevGain", "label": "累计上升"}, {"name": "totalDescent", "label": "累计下降"},
    ]
    total = 0.0
    laps = []
    for i, l in enumerate(dto, start=1):
        t = to_float(l.get("duration"))
        total += t or 0.0
        laps.append({
            "lapIndex": i,
            # 单位契约：前端按「厘米」消费（高驰同款），佳明 lapDTOs.distance 是「米」→ ×100
            "distance": to_int(round((to_float(l.get("distance")) or 0) * 100)),
            "time": t,
            "totalLength": round(total, 2),
            "avgPace": speed_to_pace(l.get("averageSpeed")),
            "avgHr": to_int(l.get("averageHR")),
            "maxHr": to_int(l.get("maxHR")),
            "avgCadence": to_int(l.get("averageRunCadence")),
            "elevGain": to_float(l.get("elevationGain")),
            "totalDescent": to_float(l.get("elevationLoss")),
        })
    return {"source": "garminSplits", "labelId": str(aid), "sportType": act.get("sportType"),
            "columns": columns, "lapGroups": [{"type": 2, "lapDistance": None,
                                               "fastLapIndexList": [], "laps": laps}]}


# ---------------- 适配器入口 ----------------
def build(opts):
    """抓取 + 映射 → 统一内部模型（不写文件）。opts 见 tools/adapters.py 顶部契约。"""
    opts = opts or {}
    today_d = datetime.date.today()
    end_d = datetime.datetime.strptime(opts["end"], "%Y%m%d").date() if opts.get("end") else today_d
    start_d = (datetime.datetime.strptime(opts["start"], "%Y%m%d").date() if opts.get("start")
               else today_d - datetime.timedelta(days=730))
    days = int(opts.get("days") or 90)
    details_n = int(opts.get("details") if opts.get("details") is not None else 8)
    today = today_d.strftime("%Y-%m-%d")

    g = login()

    print("拉取中……")
    profile = map_profile(g)
    devices = map_devices(g)
    fitness = map_fitness(g, today)
    daily = map_daily_health(g, today_d - datetime.timedelta(days=days), today_d)
    load_days = int(opts.get("load_days") if opts.get("load_days") is not None else 30)
    load = map_training_load(g, today, min(load_days, days))
    body_battery = map_body_battery(g, today_d - datetime.timedelta(days=days), today_d)
    rd = map_readiness(g, today, daily, body_battery)
    # 凌晨（刚过 0 点）当天数据还没生成 → 状态灯回退到最近一天，避免整块「数据不足」
    if rd.get("status") == "unknown":
        prev = (today_d - datetime.timedelta(days=1)).strftime("%Y-%m-%d")
        rd2 = map_readiness(g, prev, daily, body_battery)
        if rd2.get("status") != "unknown":
            rd = rd2
            print("  当天数据尚未生成 → 状态灯改用 %s" % prev)
    activities = map_activities(g, start_d, end_d)

    details, laps = {}, {}
    for act in activities[:details_n]:
        lid = act.get("labelId")
        if not lid:
            continue
        details[lid] = map_activity_details(g, act)
        lp = map_activity_laps(g, act)
        if lp:
            laps[lid] = lp
        print("  详情 %s (%s)" % (lid, act.get("date")))

    # 能力声明（契约 v2）：前端只按「有/没有」决定显示、隐藏或降级占位，不写品牌 if-else
    caps = {
        "recoveryPct": False,                                   # 佳明无高驰式「恢复度」
        "recoveryLevel": False,
        "estFullHours": False,
        "runningLevel": fitness.get("runningLevel") is not None,  # 佳明国区无跑力值
        "loadHistory": len(load) > 1,
        "loadRatio": True,                                      # 真 ACWR
        "acwr": True,
        "bodyBattery": bool(body_battery),
        "vendorReadiness": rd.get("garminTrainingReadiness") is not None,
        "lapsUnit": "cm",
    }

    out = {
        "schemaVersion": 2,
        "generatedAt": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "provider": PROVIDER,
        "capabilities": caps,
        "region": REGION,
        "range": {"start": start_d.strftime("%Y%m%d"), "end": end_d.strftime("%Y%m%d")},
        "profile": profile,
        "devices": devices,
        "fitness": fitness,
        "readiness": rd,
        "trainingLoad": load,
        "dailyHealth": daily,
        "bodyBattery": body_battery,        # 佳明独有
        "activities": activities,
        "details": details,
        "laps": laps,
    }

    if opts.get("dump_raw"):
        os.makedirs(RAW_DIR, exist_ok=True)
        dumps = {
            "profile": profile, "fitness": fitness, "dailyHealth": daily,
            "trainingLoad": load, "bodyBattery": body_battery, "readiness": rd,
            "activities": activities,
        }
        with open(os.path.join(RAW_DIR, "mapped.json"), "w", encoding="utf-8") as f:
            json.dump(dumps, f, ensure_ascii=False, indent=2)
        print("已落盘原始/映射快照 → %s（用于核对字段名）" % RAW_DIR)

    return out


# ---------------- 命令行（独立运行；也可由 fetch_data.py --source garmin 驱动） ----------------
def main():
    ap = argparse.ArgumentParser(description="佳明数据源适配器（多品牌支持，RPD §16）")
    ap.add_argument("--days", type=int, default=90, help="抓最近 N 天的每日指标（默认 90）")
    ap.add_argument("--load-days", type=int, default=30,
                    help="负荷（ACWR）历史天数，逐日请求，默认 30（0=只取当天）")
    ap.add_argument("--details", type=int, default=8, help="为最近 N 次活动抓分段/详情（默认 8）")
    ap.add_argument("--start", default=None, help="活动起始日期 yyyyMMdd（默认两年前）")
    ap.add_argument("--end", default=None, help="活动结束日期 yyyyMMdd（默认今天）")
    ap.add_argument("--dump-raw", action="store_true", help="把各接口原始返回落盘，便于核对字段名")
    ap.add_argument("--out", default=None, help="输出 JSON 路径（默认 web/data/dashboard.garmin.json）")
    args = ap.parse_args()

    model = build({"start": args.start, "end": args.end, "days": args.days,
                   "load_days": args.load_days,
                   "details": args.details, "dump_raw": args.dump_raw})
    out_path = args.out or os.path.join(PROJ, DEFAULT_OUT)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(model, f, ensure_ascii=False, indent=2)
    print("\n完成：%d 条跑步记录、%d 条详情、%d 天每日指标 → %s"
          % (len(model["activities"]), len(model["details"]), len(model["dailyHealth"]["days"]), out_path))


if __name__ == "__main__":
    main()
