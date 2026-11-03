#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
高驰（COROS）数据源适配器 —— 多品牌支持的「高驰适配器」（见 RPD §16.3）。

职责：授权/换 token（复用 `coros_probe.py` 的 OAuth + MCP 传输层）→ 抓取 → 把高驰
原始文本解析、映射成**统一内部模型**（与佳明适配器同一套结构），交给 `fetch_data.py` 统一落盘。
只读，不上传；token 只存本机。

契约（与 `tools/source_garmin.py` 一致，供 `tools/adapters.py` 动态加载）：
    PROVIDER     = "coros"
    DEFAULT_OUT  = "web/data/dashboard.json"
    build(opts)  -> dict    # 返回统一模型，不写文件

说明：
    - 必须用账号所属区域（本项目账号是 us 北美区；中国区用 cn）：`COROS_REGION=us`。
    - 一般由 `fetch_data.py` 驱动：`COROS_REGION=us python3 tools/fetch_data.py --details 8`。
"""
import datetime
import importlib.util
import json
import os
import re
import time

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)

PROVIDER = "coros"
DEFAULT_OUT = os.path.join("web", "data", "dashboard.json")
RUN_SPORT_CODES = [100, 101, 102, 103]  # 户外跑 / 跑步机 / 田径场 / 越野跑


def _load(name, filename):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, filename))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


cp = _load("coros_probe", "coros_probe.py")   # 传输层：OAuth + MCP 调用
pace = _load("pace", "pace.py")               # 纯函数：跑力五区配速（丹尼尔斯 VDOT）
readiness = _load("readiness", "readiness.py")  # 纯函数：今日身体准备度


# ---------------- 通用小工具 ----------------
def get_text(data):
    """取出 MCP 返回的文本；该文本是被再次 JSON 编码的字符串，需要解一层。"""
    try:
        t = data["result"]["content"][0]["text"]
    except Exception:
        return ""
    if isinstance(t, str):
        try:
            decoded = json.loads(t)
            if isinstance(decoded, str):
                t = decoded
        except Exception:
            t = t.strip()
            if len(t) >= 2 and t[0] == '"' and t[-1] == '"':
                t = t[1:-1]
    return t


def get_json_text(data):
    try:
        return json.loads(get_text(data))
    except Exception:
        return None


def to_sec(s):
    if not s:
        return None
    s = str(s).strip()
    if not re.match(r"^\d+(:\d+)*$", s):
        return None
    sec = 0
    for p in s.split(":"):
        sec = sec * 60 + int(p)
    return sec


def to_m(s):
    if not s:
        return None
    s = str(s).strip()
    m = re.match(r"^([\d.]+)\s*km$", s)
    if m:
        return round(float(m.group(1)) * 1000)
    m = re.match(r"^([\d.]+)\s*m$", s)
    if m:
        return round(float(m.group(1)))
    return None


def to_num(s, cast=float):
    if s is None:
        return None
    m = re.search(r"-?\d+(\.\d+)?", str(s))
    return cast(m.group()) if m else None


def keyvals(text):
    out = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or set(line) <= set("= "):
            continue
        if ":" in line:
            k, v = line.split(":", 1)
            out[k.strip()] = v.strip()
    return out


def pace_head(s):
    """从 '6:39 /km' 取 '6:39'"""
    return (s or "").split("/")[0].strip()


# ---------------- 各工具返回解析 ----------------
def parse_profile(text):
    kv = keyvals(text)
    p = {"nickname": kv.get("Nickname")}
    p["heightCm"] = to_num(kv.get("Height"))
    p["weightKg"] = to_num(kv.get("Weight"))
    p["gender"] = kv.get("Gender")
    bd = kv.get("Birthday")
    if bd:
        m = re.match(r"(\d{4}-\d{2}-\d{2})", bd)
        p["birthday"] = m.group(1) if m else bd
        p["age"] = to_num(re.search(r"Age:\s*(\d+)", bd).group(1), int) if "Age:" in bd else None
    return p


def parse_devices(text):
    out = []
    for blk in re.split(r"\n\s*\n", text):
        m = re.match(r"^\s*\d+\.\s*(.+)", blk)
        if not m:
            continue
        d = {"name": m.group(1).strip()}
        for line in blk.splitlines()[1:]:
            line = line.strip()
            if ":" in line:
                k, v = line.split(":", 1)
                d[k.strip()] = v.strip()
        out.append(d)
    return out


def parse_fitness(text):
    kv = keyvals(text)
    f = {
        "vo2max": to_num(kv.get("VO2max")),
        "runningLevel": to_num(kv.get("Running Level")),
        "thresholdPaceSec": to_sec(pace_head(kv.get("Threshold Pace"))),
        "predictions": {},
    }
    for k, v in kv.items():
        if k.endswith("Prediction"):
            f["predictions"][k[: -len(" Prediction")].strip()] = v
    return f


def parse_training_load(text):
    out = []
    pat = re.compile(
        r"(\d{4}-\d{2}-\d{2})\s*\nComment:\s*(.+?)\nShort-Term Load:\s*(\d+)\s*\n"
        r"Long-Term Load:\s*(\d+)\s*\nLoad Ratio:\s*([\d.]+)"
    )
    for m in pat.finditer(text):
        out.append({
            "date": m.group(1),
            "comment": m.group(2).strip(),
            "shortLoad": int(m.group(3)),
            "longLoad": int(m.group(4)),
            "ratio": float(m.group(5)),
        })
    return out


def parse_daily_health(text):
    h = {}
    m = re.search(r"Resting HR:\s*(\d+)\s*bpm", text)
    if m:
        h["restingHr"] = int(m.group(1))
    m = re.search(r"HRV Baseline:\s*(\d+)\s*ms", text)
    if m:
        h["hrvBaseline"] = int(m.group(1))
    days, cur = [], None
    for line in text.splitlines():
        line = line.strip()
        m = re.match(r"^---\s*(\d{8})\s*---$", line)
        if m:
            cur = {"date": m.group(1)}
            days.append(cur)
            continue
        if cur and ":" in line:
            for seg in line.split("|"):
                seg = seg.strip()
                if ":" in seg:
                    k, v = seg.split(":", 1)
                    cur[k.strip()] = v.strip()
    h["days"] = days
    return h


def parse_recovery(text):
    """解析 queryRecoveryStatus 返回：恢复度% / 等级 / 预计完全恢复小时。无数据返回 None。"""
    if not text or "Recovery" not in text:
        return None
    r = {}
    m = re.search(r"Recovery:\s*(\d+)\s*%", text)
    if m:
        r["recoveryPct"] = int(m.group(1))
    m = re.search(r"Level:\s*(.+)", text)
    if m:
        r["level"] = m.group(1).strip()
    m = re.search(r"Estimated Full Recovery:\s*(\d+)\s*h", text)
    if m:
        r["estFullHours"] = int(m.group(1))
    return r if r else None


def parse_records(text):
    recs = []
    for b in re.split(r"\n\s*\n", text):
        m = re.match(r"^\s*\d+\.\s*(.+?)\s*—\s*(\d{4}-\d{2}-\d{2})", b)
        if not m:
            continue
        r = {"title": m.group(1).strip(), "date": m.group(2)}
        for line in b.splitlines():
            line = line.strip()
            if line.startswith("Location:"):
                r["location"] = line.split(":", 1)[1].strip()
            elif line.startswith("Start Coordinates:"):
                r["coordinates"] = line.split(":", 1)[1].strip()
            elif line.startswith("Time Window:"):
                mm = re.search(r"startTimestamp=(\d+)\s*\|\s*endTimestamp=(\d+)", line)
                if mm:
                    r["startTs"] = int(mm.group(1))
                    r["endTs"] = int(mm.group(2))
            elif line.startswith("Duration:"):
                parts = [p.strip() for p in line.split(":", 1)[1].split("|")]
                r["durationSec"] = to_sec(parts[0])
                for p in parts[1:]:
                    if p.startswith("Distance:"):
                        r["distanceM"] = to_m(p.split(":", 1)[1])
            elif line.startswith("Average Pace:"):
                parts = [p.strip() for p in line.split(":", 1)[1].split("|")]
                r["paceSec"] = to_sec(pace_head(parts[0]))
                for p in parts[1:]:
                    if p.startswith("Avg HR:"):
                        r["avgHr"] = to_num(p.split(":", 1)[1], int)
                    elif p.startswith("Calories:"):
                        r["calories"] = to_num(p.split(":", 1)[1], int)
            elif line.startswith("LabelId:"):
                parts = [p.strip() for p in line.split(":", 1)[1].split("|")]
                r["labelId"] = parts[0]
                for p in parts[1:]:
                    if p.startswith("SportType:"):
                        r["sportType"] = to_num(p.split(":", 1)[1], int)
        recs.append(r)
    return recs


def fetch_records(call, start, end, chunk_days=60, page_limit=200, retries=2, pause=0.4):
    """按时间窗分片抓取运动记录。

    `querySportRecords` 只有 `limit`、没有 offset/分页，单次 200 条会把更早的记录截断
    （实测 2 年窗口只回 200 条、按最新在前，更早的丢失）。故把 [start, end] 切成
    多个 chunk_days 天的小窗逐窗抓取（每片远低于 200 上限），按 labelId 去重，返回**倒序**。
    单窗失败（网络超时等，传输层会抛 SystemExit）时重试 retries 次，仍失败则跳过并记入
    缺口清单，最后统一提示，避免一个窗口拖垮整轮。
    """
    out, seen, missed = [], set(), []
    cur = datetime.datetime.strptime(start, "%Y%m%d").date()
    last = datetime.datetime.strptime(end, "%Y%m%d").date()
    while cur <= last:
        stop = min(cur + datetime.timedelta(days=chunk_days - 1), last)
        recs, err = None, None
        for _ in range(retries + 1):
            try:
                recs = parse_records(get_text(call("querySportRecords", {
                    "startDate": cur.strftime("%Y%m%d"), "endDate": stop.strftime("%Y%m%d"),
                    "sportTypeCodes": RUN_SPORT_CODES, "limit": page_limit,
                })))
                err = None
                break
            except (SystemExit, Exception) as e:   # 传输层网络错误会抛 SystemExit
                err = e
        if err is not None:
            missed.append((cur.strftime("%Y-%m-%d"), stop.strftime("%Y-%m-%d")))
            print("  × %s ~ %s 抓取失败，已跳过：%s" % (
                cur.strftime("%Y-%m-%d"), stop.strftime("%Y-%m-%d"), err))
        else:
            for r in recs:
                lid = r.get("labelId")
                if lid:
                    if lid in seen:
                        continue
                    seen.add(lid)
                out.append(r)
            print("  %s ~ %s：%d 条" % (cur.strftime("%Y-%m-%d"), stop.strftime("%Y-%m-%d"), len(recs)))
        cur = stop + datetime.timedelta(days=1)
        time.sleep(pause)   # 轻微节流，降低被限流/超时概率
    out.sort(key=lambda r: (r.get("date") or ""), reverse=True)
    if missed:
        print("！有 %d 个时间窗未抓到（可重跑补全）：%s" % (
            len(missed), "; ".join("%s~%s" % m for m in missed)))
    return out


def parse_detail(text):
    kv = keyvals(text)
    d = {
        "workoutTimeSec": to_sec(kv.get("Workout Time")),
        "totalTimeSec": to_sec(kv.get("Total Time")),
        "distanceM": to_m(kv.get("Distance")),
        "avgPaceSec": to_sec(pace_head(kv.get("Average Pace"))),
        "movingAvgPaceSec": to_sec(pace_head(kv.get("Moving Average Pace"))),
        "adjustedPaceSec": to_sec(pace_head(kv.get("Adjusted Pace"))),
        "bestKmSec": to_sec(pace_head(kv.get("Best Kilometer"))),
        "avgHr": to_num(kv.get("Average Heart Rate"), int),
        "avgCadence": to_num(kv.get("Average Cadence"), int),
        "avgStrideM": to_num(kv.get("Average Stride Length")),
        "avgPowerW": to_num(kv.get("Average Power"), int),
        "calories": to_num(kv.get("Calories"), int),
        "trainingLoad": to_num(kv.get("Training Load"), int),
        "aerobicTE": to_num(kv.get("Aerobic TE")),
        "anaerobicTE": to_num(kv.get("Anaerobic TE")),
        "trainingFocus": kv.get("Training Focus"),
        "performance": kv.get("Performance"),
    }
    el = kv.get("Elevation Gain / Loss")
    if el:
        m = re.match(r"([\d.]+)\s*m\s*/\s*([\d.]+)\s*m", el)
        if m:
            d["elevGainM"] = float(m.group(1))
            d["elevLossM"] = float(m.group(2))
    return d


# ---------------- 适配器入口 ----------------
def build(opts):
    """抓取 + 解析 → 统一内部模型（不写文件）。opts 见 tools/adapters.py 顶部契约。"""
    opts = opts or {}
    today = datetime.date.today()
    end = opts.get("end") or today.strftime("%Y%m%d")
    start = opts.get("start") or (today - datetime.timedelta(days=730)).strftime("%Y%m%d")
    days = int(opts.get("days") or 90)
    details_n = int(opts.get("details") if opts.get("details") is not None else 8)

    print("区域 = %s | MCP 端点 = %s" % (cp.REGION, cp.MCP_URL))
    tok = cp.valid_token() or cp.do_login()
    session = cp.open_session(tok["access_token"])

    def call(name, a=None, retries=1):
        data = None
        for attempt in range(retries + 1):
            st, data, text = cp.call_tool(name, a or {}, tok, session=session)
            if st == 200 and not (data and data.get("error")):
                return data
            suffix = "，重试 %d/%d" % (attempt + 1, retries) if attempt < retries else ""
            print("  ! %s 失败 [%s]%s" % (name, st, suffix))
        return data

    print("拉取中……")
    profile = parse_profile(get_text(call("queryUserInfo")))
    devices = parse_devices(get_text(call("queryDevices")))
    fitness = parse_fitness(get_text(call("queryFitnessAssessmentOverview")))
    # 用完赛预测换算出五区训练配速（纯函数，失败则不加该字段，前端自动隐藏）
    paces = pace.build_paces(fitness.get("predictions") or {})
    if paces:
        fitness["paces"] = paces
    daily = parse_daily_health(get_text(call("queryDailyHealthData", {"days": days})))
    load = parse_training_load(get_text(call("queryTrainingLoadAssessment", {"days": days})))
    # 今日身体准备度：以高驰「恢复状态」为主信号（HRV/静息心率/睡眠有数据时再补，缺则跳过）
    recovery = parse_recovery(get_text(call("queryRecoveryStatus"))) or {}
    readiness_data = readiness.compute_readiness(
        recovery_pct=recovery.get("recoveryPct"),
        recovery_level=recovery.get("level"),
        est_full_hours=recovery.get("estFullHours"),
    )
    records = fetch_records(call, start, end)
    print("运动记录合计 %d 条（%s ~ %s）" % (
        len(records), records[-1].get("date") if records else "—", records[0].get("date") if records else "—"))

    details, laps = {}, {}
    for r in records[:details_n]:
        lid, st_code = r.get("labelId"), r.get("sportType")
        if not lid or st_code is None:
            continue
        details[lid] = parse_detail(get_text(call("getActivityDetail", {"labelId": lid, "sportType": st_code})))
        laps[lid] = get_json_text(call("queryActivityLapData", {"labelId": lid, "sportType": st_code}))
        print("  详情 %s (%s)" % (lid, r.get("date")))

    # 能力声明（契约 v2）：前端只按「有/没有」决定显示、隐藏或降级占位，不写品牌 if-else
    caps = {
        "recoveryPct": readiness_data.get("recoveryPct") is not None,
        "recoveryLevel": bool(readiness_data.get("level")),
        "estFullHours": readiness_data.get("estFullHours") is not None,
        "runningLevel": fitness.get("runningLevel") is not None,
        "loadHistory": len(load) > 1,
        "loadRatio": any(x.get("ratio") is not None for x in load),
        "acwr": False,                 # 高驰是自家负荷比，不是佳明式 ACWR
        "bodyBattery": False,          # 高驰无身体电量
        "vendorReadiness": False,      # 高驰无「训练准备度」分数（用恢复度）
        "lapsUnit": "cm",
    }

    return {
        "schemaVersion": 2,
        "generatedAt": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "provider": PROVIDER,
        "capabilities": caps,
        "region": cp.REGION,
        "range": {"start": start, "end": end},
        "profile": profile,
        "devices": devices,
        "fitness": fitness,
        "readiness": readiness_data,
        "trainingLoad": load,
        "dailyHealth": daily,
        "activities": records,
        "details": details,
        "laps": {k: v for k, v in laps.items() if v},
    }
