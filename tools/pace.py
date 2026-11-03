#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
跑力五区配速（丹尼尔斯 VDOT）—— 纯标准库，供 fetch_data.py 调用。

来源：移植自开源项目 ai-running-coach 的 vdot_calculator.py（MIT 许可），
      并按本项目需要做了两处改动：
        ① 适配本机 Python 3.9（去掉原码里的 3.10+ 类型标注 `X | None`）；
        ② 输入改为「高驰的完赛预测」，自动挑一个可信锚点换算出 VDOT 与五区配速。

数据来源：只用高驰已抓到的 `fitness.predictions`（完赛预测），**不新增任何抓取**。
口径：丹尼尔斯《Running Formula》第 3 版（2013）Table 3.1 & 3.2。
注意：VDOT 与高驰的 VO2max / 跑力值是不同量表，不要混用或并列比较。

对外主函数：
    build_paces(predictions) -> dict | None
    例：build_paces({"Half Marathon": "1:42:14", ...}) ->
        {"vdot": 41, "anchor": "Half Marathon", "anchorLabel": "半马",
         "anchorTime": "1:42:14", "E": "5:54~6:27", "M": "5:33", "T": "5:15",
         "I400": "1:52", "I1000": "4:52", "R200": "0:52", "R400": "1:48"}
    若所有锚点都超表/缺失，返回 None（前端据此隐藏卡片）。
"""

# ══════════════════════════════════════════════════════════════
# 丹尼尔斯 VDOT 对照表（第 3 版 Table 3.1 & 3.2）
# 时间单位: 秒  |  配速单位: 秒/公里  |  I/R 为对应距离的用时（秒）
# ══════════════════════════════════════════════════════════════
VDOT_TABLE = {
    30: {"race": {"5K": 1860, "10K": 3876, "half": 8640, "full": 17820},
         "pace": {"E": (462, 498), "M": 426, "T": 402, "I_400": 144, "I_1000": 375, "R_200": 66, "R_400": 138}},
    31: {"race": {"5K": 1800, "10K": 3750, "half": 8352, "full": 17220},
         "pace": {"E": (450, 486), "M": 414, "T": 390, "I_400": 140, "I_1000": 365, "R_200": 64, "R_400": 134}},
    32: {"race": {"5K": 1740, "10K": 3630, "half": 8082, "full": 16656},
         "pace": {"E": (438, 474), "M": 402, "T": 381, "I_400": 137, "I_1000": 356, "R_200": 63, "R_400": 131}},
    33: {"race": {"5K": 1686, "10K": 3516, "half": 7830, "full": 16128},
         "pace": {"E": (426, 462), "M": 393, "T": 372, "I_400": 133, "I_1000": 347, "R_200": 61, "R_400": 128}},
    34: {"race": {"5K": 1632, "10K": 3408, "half": 7590, "full": 15636},
         "pace": {"E": (417, 450), "M": 384, "T": 363, "I_400": 130, "I_1000": 339, "R_200": 60, "R_400": 125}},
    35: {"race": {"5K": 1578, "10K": 3300, "half": 7356, "full": 15168},
         "pace": {"E": (405, 441), "M": 375, "T": 354, "I_400": 127, "I_1000": 331, "R_200": 58, "R_400": 122}},
    36: {"race": {"5K": 1530, "10K": 3198, "half": 7134, "full": 14724},
         "pace": {"E": (396, 429), "M": 366, "T": 348, "I_400": 124, "I_1000": 324, "R_200": 57, "R_400": 120}},
    37: {"race": {"5K": 1482, "10K": 3102, "half": 6924, "full": 14304},
         "pace": {"E": (387, 420), "M": 360, "T": 339, "I_400": 121, "I_1000": 317, "R_200": 56, "R_400": 117}},
    38: {"race": {"5K": 1434, "10K": 3006, "half": 6726, "full": 13908},
         "pace": {"E": (378, 411), "M": 351, "T": 333, "I_400": 119, "I_1000": 310, "R_200": 55, "R_400": 115}},
    39: {"race": {"5K": 1392, "10K": 2916, "half": 6534, "full": 13530},
         "pace": {"E": (369, 402), "M": 345, "T": 327, "I_400": 116, "I_1000": 304, "R_200": 54, "R_400": 112}},
    40: {"race": {"5K": 1350, "10K": 2832, "half": 6348, "full": 13170},
         "pace": {"E": (363, 396), "M": 339, "T": 321, "I_400": 114, "I_1000": 298, "R_200": 53, "R_400": 110}},
    41: {"race": {"5K": 1308, "10K": 2748, "half": 6174, "full": 12828},
         "pace": {"E": (354, 387), "M": 333, "T": 315, "I_400": 112, "I_1000": 292, "R_200": 52, "R_400": 108}},
    42: {"race": {"5K": 1272, "10K": 2670, "half": 6006, "full": 12498},
         "pace": {"E": (348, 378), "M": 327, "T": 309, "I_400": 110, "I_1000": 287, "R_200": 51, "R_400": 106}},
    43: {"race": {"5K": 1236, "10K": 2592, "half": 5844, "full": 12186},
         "pace": {"E": (339, 372), "M": 321, "T": 306, "I_400": 108, "I_1000": 282, "R_200": 50, "R_400": 104}},
    44: {"race": {"5K": 1200, "10K": 2520, "half": 5694, "full": 11886},
         "pace": {"E": (333, 363), "M": 318, "T": 300, "I_400": 106, "I_1000": 277, "R_200": 49, "R_400": 102}},
    45: {"race": {"5K": 1170, "10K": 2454, "half": 5550, "full": 11598},
         "pace": {"E": (327, 357), "M": 312, "T": 294, "I_400": 104, "I_1000": 272, "R_200": 48, "R_400": 100}},
    46: {"race": {"5K": 1140, "10K": 2388, "half": 5412, "full": 11322},
         "pace": {"E": (321, 351), "M": 309, "T": 291, "I_400": 102, "I_1000": 268, "R_200": 47, "R_400": 99}},
    47: {"race": {"5K": 1110, "10K": 2328, "half": 5280, "full": 11058},
         "pace": {"E": (315, 345), "M": 303, "T": 285, "I_400": 101, "I_1000": 264, "R_200": 47, "R_400": 97}},
    48: {"race": {"5K": 1080, "10K": 2268, "half": 5154, "full": 10806},
         "pace": {"E": (309, 339), "M": 300, "T": 282, "I_400": 99, "I_1000": 260, "R_200": 46, "R_400": 96}},
    49: {"race": {"5K": 1056, "10K": 2214, "half": 5034, "full": 10560},
         "pace": {"E": (306, 333), "M": 294, "T": 279, "I_400": 98, "I_1000": 256, "R_200": 45, "R_400": 94}},
    50: {"race": {"5K": 1032, "10K": 2160, "half": 4920, "full": 10326},
         "pace": {"E": (300, 330), "M": 291, "T": 275, "I_400": 96, "I_1000": 252, "R_200": 45, "R_400": 93}},
    51: {"race": {"5K": 1008, "10K": 2112, "half": 4812, "full": 10104},
         "pace": {"E": (294, 324), "M": 288, "T": 272, "I_400": 95, "I_1000": 249, "R_200": 44, "R_400": 92}},
    52: {"race": {"5K": 984, "10K": 2064, "half": 4710, "full": 9888},
         "pace": {"E": (291, 318), "M": 285, "T": 268, "I_400": 94, "I_1000": 246, "R_200": 43, "R_400": 90}},
    53: {"race": {"5K": 960, "10K": 2016, "half": 4608, "full": 9684},
         "pace": {"E": (285, 315), "M": 279, "T": 265, "I_400": 92, "I_1000": 243, "R_200": 43, "R_400": 89}},
    54: {"race": {"5K": 942, "10K": 1974, "half": 4512, "full": 9486},
         "pace": {"E": (282, 309), "M": 276, "T": 262, "I_400": 91, "I_1000": 240, "R_200": 42, "R_400": 88}},
    55: {"race": {"5K": 918, "10K": 1932, "half": 4416, "full": 9300},
         "pace": {"E": (276, 306), "M": 273, "T": 258, "I_400": 90, "I_1000": 237, "R_200": 42, "R_400": 87}},
    56: {"race": {"5K": 900, "10K": 1890, "half": 4326, "full": 9120},
         "pace": {"E": (273, 300), "M": 270, "T": 255, "I_400": 89, "I_1000": 234, "R_200": 41, "R_400": 86}},
    57: {"race": {"5K": 882, "10K": 1854, "half": 4242, "full": 8946},
         "pace": {"E": (270, 297), "M": 267, "T": 252, "I_400": 88, "I_1000": 231, "R_200": 41, "R_400": 85}},
    58: {"race": {"5K": 864, "10K": 1818, "half": 4158, "full": 8784},
         "pace": {"E": (267, 294), "M": 264, "T": 249, "I_400": 87, "I_1000": 228, "R_200": 40, "R_400": 84}},
    59: {"race": {"5K": 846, "10K": 1782, "half": 4080, "full": 8622},
         "pace": {"E": (264, 291), "M": 261, "T": 246, "I_400": 86, "I_1000": 226, "R_200": 40, "R_400": 83}},
    60: {"race": {"5K": 834, "10K": 1746, "half": 4002, "full": 8472},
         "pace": {"E": (261, 288), "M": 258, "T": 243, "I_400": 85, "I_1000": 224, "R_200": 39, "R_400": 82}},
    65: {"race": {"5K": 762, "10K": 1602, "half": 3678, "full": 7800},
         "pace": {"E": (246, 270), "M": 243, "T": 231, "I_400": 81, "I_1000": 213, "R_200": 37, "R_400": 78}},
}

# 高驰完赛预测的键 → 表内距离键
_COROS_KEY = {"5 km": "5K", "10 km": "10K", "Half Marathon": "half", "Marathon": "full"}
# 锚点优先级（半马最稳；全马预测偏差最大，降为末选）
_ANCHOR_ORDER = ["Half Marathon", "10 km", "5 km", "Marathon"]
# 展示用的中文标签
_ANCHOR_LABEL = {"Half Marathon": "半马", "10 km": "10 km", "5 km": "5 km", "Marathon": "全马"}


def _fmt_time(seconds):
    """秒 → H:MM:SS 或 MM:SS"""
    seconds = int(round(seconds))
    h = seconds // 3600
    m = (seconds % 3600) // 60
    s = seconds % 60
    if h > 0:
        return "%d:%02d:%02d" % (h, m, s)
    return "%d:%02d" % (m, s)


def _fmt_pace(sec_per_km):
    """秒/公里 → M:SS"""
    sec_per_km = int(round(sec_per_km))
    return "%d:%02d" % (sec_per_km // 60, sec_per_km % 60)


def _parse_time(time_str):
    """'1:42:14' / '21:59' → 秒；无法解析返回 None。"""
    if not time_str:
        return None
    parts = str(time_str).strip().split(":")
    try:
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
        if len(parts) == 2:
            return int(parts[0]) * 60 + int(parts[1])
    except ValueError:
        return None
    return None


def lookup_vdot(dist_key, seconds):
    """
    按距离 + 成绩查最接近的 VDOT。超出对照表范围抛 ValueError（不静默钳制）。
    dist_key 取 5K / 10K / half / full。
    """
    if dist_key not in ("5K", "10K", "half", "full"):
        raise ValueError("不支持的距离: %s" % dist_key)
    vdots = sorted(VDOT_TABLE.keys())
    slowest = VDOT_TABLE[vdots[0]]["race"][dist_key]
    fastest = VDOT_TABLE[vdots[-1]]["race"][dist_key]
    if seconds > slowest or seconds < fastest:
        raise ValueError(
            "成绩 %s 超出 VDOT 表范围(%s: %s ~ %s)"
            % (_fmt_time(seconds), dist_key, _fmt_time(fastest), _fmt_time(slowest))
        )
    best_v, best_diff = vdots[0], None
    for v in vdots:
        diff = abs(VDOT_TABLE[v]["race"][dist_key] - seconds)
        if best_diff is None or diff < best_diff:
            best_v, best_diff = v, diff
    return best_v


def paces_for_vdot(vdot):
    """VDOT → 五区配速（格式化字符串）。"""
    vdots = sorted(VDOT_TABLE.keys())
    if vdot not in VDOT_TABLE:
        vdot = min(vdots, key=lambda v: abs(v - vdot))
    data = VDOT_TABLE[vdot]
    p = data["pace"]
    e_min, e_max = p["E"]
    return {
        "vdot": vdot,
        "E": "%s~%s" % (_fmt_pace(e_min), _fmt_pace(e_max)),
        "M": _fmt_pace(p["M"]),
        "T": _fmt_pace(p["T"]),
        "I400": _fmt_time(p["I_400"]),
        "I1000": _fmt_time(p["I_1000"]),
        "R200": _fmt_time(p["R_200"]),
        "R400": _fmt_time(p["R_400"]),
    }


def build_paces(predictions):
    """
    输入高驰完赛预测 { "Half Marathon": "1:42:14", ... }，挑锚点算出五区配速。
    全部锚点缺失或超表时返回 None。
    """
    if not predictions:
        return None
    for key in _ANCHOR_ORDER:
        raw = predictions.get(key)
        secs = _parse_time(raw)
        dist_key = _COROS_KEY.get(key)
        if secs is None or dist_key is None:
            continue
        try:
            vdot = lookup_vdot(dist_key, secs)
        except ValueError:
            continue  # 该锚点超表，换下一个
        out = {"anchor": key, "anchorLabel": _ANCHOR_LABEL[key], "anchorTime": str(raw)}
        out.update(paces_for_vdot(vdot))
        return out
    return None


if __name__ == "__main__":
    # 自测：用本项目 dashboard.json 里的预测跑一遍
    import json
    import os
    here = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(os.path.dirname(here), "web", "data", "dashboard.json")
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        preds = (data.get("fitness") or {}).get("predictions") or {}
    except Exception:
        preds = {"5 km": "21:59", "10 km": "45:39", "Half Marathon": "1:42:14", "Marathon": "3:35:42"}
    print("预测 =", json.dumps(preds, ensure_ascii=False))
    print("结果 =", json.dumps(build_paces(preds), ensure_ascii=False, indent=2))
