#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
抓训练数据 → 统一内部模型 → 写入 web/data/dashboard.json，供网页/H5 看板读取。

本文件是**公共编排 / 输出层**：按数据源调用对应「适配器」（`tools/source_<provider>.py`），
适配器负责授权 + 抓取 + 映射成统一模型，这里只做参数解析与落盘（业务逻辑不在此）。

用法：
    COROS_REGION=us python3 tools/fetch_data.py                 # 默认高驰，拉最近 8 次活动详情
    COROS_REGION=us python3 tools/fetch_data.py --details 15    # 多拉几次详情
    COROS_REGION=us python3 tools/fetch_data.py --start 20230101
    python3 tools/fetch_data.py --source garmin                 # 佳明（需先装 garminconnect，见 source_garmin.py）
    python3 tools/fetch_data.py --source garmin --out web/data/dashboard.garmin.json

说明：
    - 高驰适配器复用 coros_probe.py 的 OAuth（token 已在本机；未授权会自动弹浏览器）。
    - 只读，不上传任何数据。多品牌与适配层细节见 RPD §16。
"""
import argparse
import importlib.util
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)

# 公共适配层（动态加载 tools/adapters.py，与各适配器的加载方式一致）
_spec = importlib.util.spec_from_file_location("adapters", os.path.join(HERE, "adapters.py"))
adapters = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(adapters)


def main():
    ap = argparse.ArgumentParser(description="抓数 → 统一内部模型 → dashboard.json")
    ap.add_argument("--source", default="coros", help="数据源：coros / garmin（对应 tools/source_*.py）")
    ap.add_argument("--out", default=None, help="输出 JSON 路径（默认按适配器的 DEFAULT_OUT）")
    ap.add_argument("--start", default=None, help="起始日期 yyyyMMdd，默认两年前")
    ap.add_argument("--end", default=None, help="结束日期 yyyyMMdd，默认今天")
    ap.add_argument("--days", type=int, default=90, help="每日指标 / 负荷回看天数（默认 90）")
    ap.add_argument("--details", type=int, default=8, help="为最近 N 次活动拉取详情 / 圈数据")
    ap.add_argument("--dump-raw", action="store_true", help="把原始 / 映射快照落盘（佳明字段核对用）")
    args = ap.parse_args()

    mod = adapters.load(args.source)
    out_path = args.out or os.path.join(PROJ, mod.DEFAULT_OUT)

    model = mod.build({
        "start": args.start,
        "end": args.end,
        "days": args.days,
        "details": args.details,
        "dump_raw": args.dump_raw,
    })

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(model, f, ensure_ascii=False, indent=2)
    print("\n完成：%d 条运动记录、%d 条详情 → %s"
          % (len(model.get("activities") or []), len(model.get("details") or {}), out_path))


if __name__ == "__main__":
    main()
