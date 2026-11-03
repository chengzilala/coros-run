#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
今日身体准备度（Readiness）—— 纯标准库，供 fetch_data.py 调用。

思路移植自开源项目 ai-running-coach 的 readiness_calc.py（MIT），并按本项目实际数据情况调整：
  - 主信号：高驰官方「恢复状态」queryRecoveryStatus（恢复度 % / 等级 / 预计完全恢复小时），几乎总可用；
  - 辅信号：HRV 跌幅 / 静息心率升幅 / 睡眠分 / 身体电量峰值——**有就算、缺就跳过**，绝不把"没测到"当成"正常"。
  - 佳明：无「恢复度」，改由上述辅信号 + 厂商自带「训练准备度」（POOR/LOW 记一条红旗）合成，摘要如实列出依据。
  - 判定：红旗 ≥2 面 → 建议恢复（红）；1 面 → 注意（黄）；0 面 → 状态良好（绿）。

红线：缺失或不确知的信号一律跳过（计入 skipped），不臆造、不默认安全。

对外主函数：
    compute_readiness(recovery_pct=None, recovery_level=None, est_full_hours=None,
                      hrv_drop_pct=None, rhr_spike_bpm=None, sleep_score=None,
                      body_battery_peak=None) -> dict
"""

# 阈值（与参考项目一致，便于日后核对）
HRV_DROP_PCT = 20.0      # HRV 较基线下跌 >= 20% → 红旗
RHR_SPIKE_BPM = 7.0      # 静息心率较基线升高 >= 7bpm → 红旗
SLEEP_SCORE_MIN = 60     # 睡眠分 < 60 → 红旗
RECOVERY_PCT_MIN = 50    # 高驰恢复度 < 50% → 红旗
# 佳明身体电量：用「当日峰值」（晨起最高值）看恢复；日间最低几乎人人耗到底，不能当红旗。
# 高驰无此信号 → 计入 skipped，不臆造。
BODY_BATTERY_PEAK_MIN = 40

# 厂商自带「训练准备度」等级（佳明 POOR/LOW/MODERATE/HIGH/VERY_HIGH）。
# 只用厂商自己的等级判红旗，不自己造阈值；POOR/LOW 视为一条红旗（不叠加臆测）。
VENDOR_LEVEL_ZH = {"POOR": "很低", "LOW": "低", "MODERATE": "中等", "HIGH": "高", "VERY_HIGH": "很高"}
VENDOR_LOW_LEVELS = ("POOR", "LOW")


# 高驰恢复等级英文 → 中文（未知则原样透出）
_LEVEL_ZH = {
    "Training as usual": "正常训练",
    "Heavy training allowed": "可高强度训练",
    "Light training": "仅可轻量训练",
    "Light training only": "仅可轻量训练",
    "Recovery recommended": "建议恢复",
    "Rest recommended": "建议休息",
    "Rest": "建议休息",
}


def compute_readiness(recovery_pct=None, recovery_level=None, est_full_hours=None,
                      hrv_drop_pct=None, rhr_spike_bpm=None, sleep_score=None,
                      body_battery_peak=None,
                      vendor_score=None, vendor_level=None, vendor_name=""):
    """vendor_score / vendor_level：厂商自带的「训练准备度」（佳明）。
    只做**补充信号**：厂商等级为 POOR/LOW 时记一条红旗；高驰不传即跳过。"""
    flags = []

    if hrv_drop_pct is not None and hrv_drop_pct >= HRV_DROP_PCT:
        flags.append("HRV 较基线跌 %.0f%%（≥%.0f%%）" % (hrv_drop_pct, HRV_DROP_PCT))
    if rhr_spike_bpm is not None and rhr_spike_bpm >= RHR_SPIKE_BPM:
        flags.append("静息心率较基线升 %.0fbpm（≥%.0f）" % (rhr_spike_bpm, RHR_SPIKE_BPM))
    if sleep_score is not None and sleep_score < SLEEP_SCORE_MIN:
        flags.append("睡眠分 %d（<%d）" % (sleep_score, SLEEP_SCORE_MIN))
    if recovery_pct is not None and recovery_pct < RECOVERY_PCT_MIN:
        flags.append("高驰恢复度 %d%%（<%d%%）" % (recovery_pct, RECOVERY_PCT_MIN))
    if body_battery_peak is not None and body_battery_peak < BODY_BATTERY_PEAK_MIN:
        flags.append("身体电量峰值仅 %d（<%d）" % (body_battery_peak, BODY_BATTERY_PEAK_MIN))
    if vendor_level in VENDOR_LOW_LEVELS:
        flags.append("%s准备度%s%s" % (
            vendor_name or "厂商", VENDOR_LEVEL_ZH.get(vendor_level, vendor_level),
            "（%s 分）" % vendor_score if vendor_score is not None else ""))

    # 缺失的信号：跳过、不计红旗（不当作正常）
    signals = {"HRV": hrv_drop_pct, "静息心率": rhr_spike_bpm, "睡眠分": sleep_score,
               "身体电量": body_battery_peak, "厂商准备度": vendor_level}
    skipped = [n for n, v in signals.items() if v is None]

    # 完全没有任何信号 → 数据不足（前端隐藏状态灯）
    if not flags and all(v is None for v in signals.values()) and recovery_pct is None:
        return {"status": "unknown", "label": "数据不足", "flags": [], "skipped": skipped, "summary": ""}

    n = len(flags)
    if n >= 2:
        status, label = "recover", "建议恢复"
    elif n == 1:
        status, label = "caution", "注意"
    else:
        status, label = "ok", "状态良好"

    parts = []
    if recovery_pct is not None:
        parts.append("高驰恢复度 %d%%" % recovery_pct)
    if est_full_hours:
        parts.append("预计完全恢复约 %d 小时" % est_full_hours)
    if recovery_level:
        parts.append(_LEVEL_ZH.get(recovery_level, recovery_level))
    # 没恢复度（佳明）时，把用到的四个信号如实写出来，避免「状态良好」却无依据
    if hrv_drop_pct is not None:
        parts.append("HRV 较基线 %+.0f%%" % (-hrv_drop_pct))
    if rhr_spike_bpm is not None:
        parts.append("静息心率较基线 %+.0fbpm" % rhr_spike_bpm)
    if sleep_score is not None:
        parts.append("睡眠分 %d" % sleep_score)
    if body_battery_peak is not None:
        parts.append("身体电量峰值 %d" % body_battery_peak)
    if vendor_level is not None:
        parts.append("%s准备度 %s%s" % (
            vendor_name or "", (VENDOR_LEVEL_ZH.get(vendor_level, vendor_level)),
            "（%s 分）" % vendor_score if vendor_score is not None else ""))

    return {
        "status": status,
        "label": label,
        "recoveryPct": recovery_pct,
        "level": recovery_level,
        "estFullHours": est_full_hours,
        "flags": flags,
        "skipped": skipped,
        "summary": " · ".join(parts),
    }


if __name__ == "__main__":
    import json
    # 自测：三种典型情形
    cases = [
        ("良好（仅恢复度）", dict(recovery_pct=100, recovery_level="Heavy training allowed", est_full_hours=0)),
        ("注意（睡眠差）", dict(recovery_pct=80, sleep_score=55)),
        ("恢复（HRV+RHR 两面旗）", dict(recovery_pct=90, hrv_drop_pct=25, rhr_spike_bpm=9)),
        ("数据不足", dict()),
        ("佳明（四信号 + 准备度低）", dict(hrv_drop_pct=3, rhr_spike_bpm=-1, sleep_score=79,
                                     body_battery_peak=71, vendor_score=25,
                                     vendor_level="LOW", vendor_name="佳明")),
    ]
    for name, kw in cases:
        print(name, "->", json.dumps(compute_readiness(**kw), ensure_ascii=False))
