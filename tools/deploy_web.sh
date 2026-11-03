#!/usr/bin/env bash
# 一键部署「前端看板」到 CloudBase 静态网站托管。
#
# 只上传 web/ 里的**公开前端文件**（白名单）；个人数据与凭据（web/data/*、llm_config.json、serve.py）
# 绝不进入待上传目录，脚本内还加了一道安全护栏二次确认。
#
# 用法：
#   bash tools/deploy_web.sh
# 首次需先登录（浏览器授权一次即可，之后免登录）：
#   export PATH="/opt/homebrew/bin:$PATH" && tcb login
set -euo pipefail

ENV_ID="coros-run-d0g0acnksda36ca62"
SITE_URL="https://run.chesterlee.cn"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/web"
DIST="/tmp/coros-web-dist"

# Node 与 CloudBase CLI 由 Homebrew 安装，需手动进 PATH
export PATH="/opt/homebrew/bin:$PATH"
if ! command -v tcb >/dev/null 2>&1; then
  echo "✗ 未找到 tcb 命令。请先安装："
  echo "  npm i -g @cloudbase/cli --registry=https://registry.npmmirror.com"
  exit 1
fi

FILES=(
  index.html style.css theme-v2.css app.js store.js ui.js pwa.js sw.js places.js
  manifest.webmanifest icon.svg
  landing.html landing.css landing.js
  help.html help.css
  account.html account.js login.html login.js auth.js privacy.html
  pace-calc.html pace-calc.js
  coach.html coach.js nutrition.js
  knowledge.html knowledge.js
  thinking.html
  i18n.js
)
LIBS=( echarts.min.js cloudbase.full.js )
# 公开数据（非个人数据）：离线行政区划中心点，供「地点分布」自动识别城市
DATA=( cn_regions.json )

rm -rf "$DIST"; mkdir -p "$DIST/lib" "$DIST/data" "$DIST/assets"
for f in "${FILES[@]}"; do cp "$SRC/$f" "$DIST/"; done
for f in "${LIBS[@]}";  do cp "$SRC/lib/$f" "$DIST/lib/"; done
for f in "${DATA[@]}";  do cp "$SRC/data/$f" "$DIST/data/"; done
# 多语言文案表（英文词表 + 简繁转换表）
cp -R "$SRC/i18n" "$DIST/i18n"
# 前端组件（AI Key 面板：被 account.html 引用）
cp -R "$SRC/assets/ai-key" "$DIST/assets/"
# 统一账户中心 SDK + 接入脚本（ps-auth.js 整文件来自账户中心，不手改）
cp -R "$SRC/assets/js" "$DIST/assets/"
# 页脚用的公安备案图标（§2.3）
cp -R "$SRC/assets/img" "$DIST/assets/"

# 安全护栏：待上传目录里绝不允许出现个人数据 / 凭据文件
if find "$DIST" \( -name "dashboard.json" -o -name "accounts.json" -o -name "secret.key" \
                  -o -name "llm_config.json" -o -name "serve.py" \) | grep -q .; then
  echo "✗ 待上传目录里发现个人数据/凭据文件，已中止上传。" >&2
  exit 1
fi

echo "→ 待上传 $(find "$DIST" -type f | wc -l | tr -d ' ') 个文件，开始部署…"
tcb hosting deploy "$DIST" / -e "$ENV_ID"
echo "✅ 已上线：$SITE_URL"
