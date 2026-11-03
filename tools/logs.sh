#!/usr/bin/env bash
# 查看线上云函数日志（腾讯云 CLS 检索）—— 一键查某个函数最近的调用日志。
#
# 用法：
#   bash tools/logs.sh                 # 看用法
#   bash tools/logs.sh review          # 看 review 最近 1 小时的日志
#   bash tools/logs.sh dashboard 30m   # 看 dashboard 最近 30 分钟
#   bash tools/logs.sh account 6h      # 看 account 最近 6 小时
#
# 时间范围可写：30m / 1h / 6h / 1d（默认 1h）。
# 常用函数名：dashboard / review / account / coros-sync / coros-authorize / coros-callback
#
# 依赖：CloudBase CLI（tcb）已安装，且已 `tcb login`（首次需登录，之后免登录）。
# 说明：本脚本只读日志，不改任何数据。日志按量计费、保留 7 天。
set -u

ENV_ID="coros-run-d0g0acnksda36ca62"
FN="${1:-}"
RANGE="${2:-1h}"

if [ -z "$FN" ]; then
  echo "用法：bash tools/logs.sh <函数名> [时间范围]"
  echo "  例：bash tools/logs.sh review 1h"
  echo "  时间范围：30m / 1h / 6h / 1d（默认 1h）"
  echo "  常用函数名：dashboard / review / account / coros-sync"
  exit 1
fi

# 让 Homebrew 装的 tcb 能被找到（默认不在 PATH）
export PATH="/opt/homebrew/bin:$PATH"

if ! command -v tcb >/dev/null 2>&1; then
  echo "找不到 tcb 命令。请先安装 CloudBase CLI："
  echo "  npm i -g @cloudbase/cli --registry=https://registry.npmmirror.com"
  exit 1
fi

echo "查询 [${FN}] 最近 ${RANGE} 的日志（环境 ${ENV_ID}）..."
echo

tcb logs search -e "$ENV_ID" -q "function_name:\"$FN\"" -t "$RANGE" -l 50 --json 2>/dev/null | python3 -c '
import sys, json
raw = sys.stdin.read()
i = raw.find("{")
if i < 0:
    print("（没有返回内容）可能原因：未登录（先跑 tcb login）、或该时间范围内没有日志。")
    sys.exit(0)
data = json.loads(raw[i:])
rows = data.get("data", {}).get("LogResults", {}).get("Results", [])
if not rows:
    print("（该时间范围内没有日志）")
    sys.exit(0)
for r in reversed(rows):   # 检索默认最新在前，这里反转让它按时间正序
    try:
        c = json.loads(r.get("Content", "{}"))
    except Exception:
        c = {}
    print("%s | code %s | %s | %s" % (
        r.get("Timestamp", ""),
        c.get("status_code", ""),
        c.get("src", ""),
        c.get("log", ""),
    ))
'
