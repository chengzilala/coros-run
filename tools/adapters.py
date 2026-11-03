#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
数据源适配层 —— 统一「适配器」契约 + 注册/动态加载（多品牌支持，见 RPD §16.3）。

设计目标：**加品牌＝加一个适配器**，看板 / 单次详情 / AI 复盘等业务逻辑不动。
每条数据源 = 同目录一个 `source_<provider>.py`，须提供：

    PROVIDER      : str               # 数据源标识："coros" | "garmin"
    DEFAULT_OUT   : str               # 默认输出路径（相对项目根），如 web/data/dashboard.json
    build(opts)   : dict              # 授权 + 抓取 + 映射 → 统一内部模型（不写文件）

统一内部模型（各适配器输出一致，业务层/前端只认它；等价现有 dashboard.json）：
    generatedAt, provider, region, range{start,end},
    profile{}, devices[], fitness{}, readiness{},
    trainingLoad[], dailyHealth{}, activities[], details{}, laps{}
    （佳明额外：bodyBattery[]）

opts 约定（由 fetch_data.py 传入）：
    {"start": "yyyyMMdd"|None, "end": "yyyyMMdd"|None,
     "days": int, "details": int, "dump_raw": bool}
"""
import importlib.util
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def available():
    """列出已安装的数据源（tools/source_<provider>.py 的名字部分）。"""
    out = []
    for f in sorted(os.listdir(HERE)):
        if f.startswith("source_") and f.endswith(".py"):
            out.append(f[len("source_"):-len(".py")])
    return out


def load(provider):
    """按 provider 名动态加载适配器模块（tools/source_<provider>.py）。

    动态加载（而非 import）是为与现有 coros_probe/pace/readiness 的加载方式保持一致，
    并避免各适配器的同名模块相互污染。返回已执行完毕的模块对象。
    """
    path = os.path.join(HERE, "source_%s.py" % provider)
    if not os.path.exists(path):
        raise SystemExit("未知数据源：%s（找不到 %s）；可用：%s"
                         % (provider, os.path.basename(path), "、".join(available()) or "无"))
    spec = importlib.util.spec_from_file_location("source_%s" % provider, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod
