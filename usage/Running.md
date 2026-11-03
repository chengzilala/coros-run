# 运行手册 — coros-run（零基础照着做）

> 目标：从零把「跑不快」在本机跑起来。全程在本机完成，**数据不上传**。
> 环境：macOS + Python 3（本机已装 3.9）。**不需要安装任何第三方库。**

---

## 0. 先确认项目在哪
所有命令都在项目根目录下执行：

```bash
cd /Users/Admin/Knowledge/Coding/coros-run
```

---

## 1. 第一步：跑通高驰授权（只需一次）

```bash
COROS_REGION=us python3 tools/coros_probe.py
```

会发生什么：
1. 自动打开浏览器，让你登录**高驰账号**并点「同意」；
2. 同意后浏览器跳回本地 `127.0.0.1:8765` 显示「授权完成」，关掉即可；
3. 终端会列出 34 个可用的 MCP 工具。

**区域说明（容易踩坑）**：区域必须和账号归属一致 ——
`cn`=中国区 / `us`=北美·国际区 / `eu`=欧洲区。
> 本账号属**北美/国际区**，所以命令里都用 `COROS_REGION=us`。

报错应对：若提示 `Client authentication credentials missing...`，多半是区域选错，换 `cn` / `eu` 再试。

产物：`.coros_token_us.json`（凭据，已在 `.gitignore`，不会进仓库）。

---

## 2. 第二步：抓取数据

```bash
COROS_REGION=us python3 tools/fetch_data.py --details 8
```

- `--details 8` = 额外抓最近 8 次的详细数据（可改大改小）。
- 看到「完成：N 条运动记录、M 条详情」即成功。
- 产物：`web/data/dashboard.json`（已在 `.gitignore`）。

数据是哪来的：走**高驰官方 MCP**，**只读**你的账号，不写不改。

---

## 3. 第三步：启动看板

```bash
python3 web/serve.py
```

终端出现 `打开：http://127.0.0.1:8920` 即成功。浏览器打开：

**http://127.0.0.1:8920**

停止服务：在终端按 `Ctrl + C`。

---

## 4. 第四步：配置 AI 复盘

看板底部点「**⚙ 我的账户**」，或直接打开 **http://127.0.0.1:8920/account.html**

1. 点「DeepSeek」等预设，自动填好服务地址与模型；
2. 粘贴你的 API Key；
3. 点「测试连接」看到「连接正常」，再点「保存」；
4. 回看板刷新，点「生成复盘」。

> 支持国产大模型（**DeepSeek 首推**）：DeepSeek / 通义千问 / Kimi / 智谱 GLM / 豆包 / 硅基流动，也可选「自定义端点」。
> Key 会**加密托管在本机**（`web/data/accounts.json`，密文）。**网页复盘只用这把账户 Key**：没配就会提示你先去配置，不会自动用别处的 Key。（`web/llm_config.json` / 环境变量仅供命令行/开发用，已 `.gitignore`。）

> **AI 跑步教练**共用这把 Key：配好后点看板右上「**🏃 教练**」（或打开 http://127.0.0.1:8920/coach.html ）即可多轮对话，无需另外配置。教练走本机 `/api/coach`，只读数据、不回写手表。

---

## 5. 日常使用（第二次起）

只需两条命令：

```bash
cd /Users/Admin/Knowledge/Coding/coros-run
COROS_REGION=us python3 tools/fetch_data.py --details 8   # 更新数据
python3 web/serve.py                                      # 起服务，浏览器看
```

> 授权（第一步）不用重复做；token 过期时报错，就再跑一次 `coros_probe.py relogin`。

### 换语言（简体 / English / 繁體）
- 页面右上角有 **「简 / EN / 繁」** 小胶囊，点一下整页即时切换（会重新加载一次，选择记在本机）。
- 也可以直接在地址后加参数：`?lang=en`（英文）、`?lang=hant`（繁体）、`?lang=hans`（简体），例如
  `http://127.0.0.1:8920/index.html?lang=en`。
- 默认就是**简体中文**（不按浏览器语言猜）；切换过会记在本机，下次沿用。
- AI 复盘 / 教练会跟随当前语言作答（简体 / 英文 / 繁体）。

---

## 6. 上线到互联网（CloudBase 静态托管）

> 把**前端**发布到公网（腾讯云 CloudBase 静态托管）。
> **未登录访问首页会转到「官网」`landing.html`**（单页官网：吸顶导航 + 产品介绍 + **首屏紧接「开始使用」跳转入口**（进入看板 / H5 移动端 / 登录·注册 / 我的账户·隐私政策）+ 功能说明 + **「数据来源」说明（为什么只做高驰和佳明）** + H5 说明），看不到任何人的数据；登录后才能查看本人云端数据。
> 现状：静态前端 + 云端登录 / 绑定高驰 / 数据看板 / AI 复盘 / 官网**均已上线**。

**一次性准备（已做过，可跳过）**
- 安装 Node + CloudBase CLI：`npm i -g @cloudbase/cli --registry=https://registry.npmmirror.com`
- 登录腾讯云一次：`tcb login`（会打开浏览器授权，之后免登录）

**以后每次发布，一条命令**

```bash
bash tools/deploy_web.sh
```

成功后终端会打印线上地址：

**https://run.chesterlee.cn**

注意：
- 脚本只上传**公开前端文件**（白名单），个人数据 / 凭据（`web/data/*`、`llm_config.json`、`serve.py`）绝不会上传。
- 若报 `tcb: command not found`，先执行 `export PATH="/opt/homebrew/bin:$PATH"`（Node/CLI 装在 Homebrew 里，默认不在 PATH）。
- 页面改了但线上没更新 → 浏览器**硬刷新**（Cmd+Shift+R）；CDN 刷新需几分钟。
- 发布后自验：照 [test/前端卡片复验清单.md](../test/前端卡片复验清单.md) 在浏览器点一遍（需本人登录）。

### 统一账户中心（本站唯一登录入口）

线上**只有一套登录**：点顶部「登录」→ 账户中心（`productId = coros-run`、站点 `https://run.chesterlee.cn`、配色 `light #f2620a`）→ 登录回来带 `ps_ticket` → 前端调云函数 `ps-login` 换一张 **CloudBase 自定义登录票** → 自动登录本站（`CorosAuth` 会话），看板 / 高驰同步 / AI Key 全部照旧。

```bash
# 1) 本机（已做过）：在 account-center 项目根目录登记
cd /Users/Admin/Knowledge/Coding/account-center
node tools/register-product.js coros-run "跑不快" https://run.chesterlee.cn light '#f2620a'

# 2) 线上（服务器上，账户中心目录）：登记后必须重启服务
DATA_FILE=/var/lib/account-center/store.json \
  node tools/register-product.js coros-run "跑不快" https://run.chesterlee.cn light '#f2620a'
sudo systemctl restart account-center
```

- 服务器环境文件里的 `ALLOWED_ORIGINS` 要包含 `https://run.chesterlee.cn`（**不要用 `*`**），改完重启。
- 本机（`127.0.0.1:8920`）**不接管登录**，仍是旧邮箱登录页 `login.html`——避免静默跳转打断本机调试。

**身份桥（云函数 `ps-login` + 自定义登录私钥）**

```bash
# 私钥：用云开发 API 生成一次（私钥只在创建时返回一次），写进函数目录的 tcb_custom_login.json（已 gitignore）
tcb api tcb CreateCustomLoginKey --body '{"EnvId":"coros-run-d0g0acnksda36ca62"}' --json

# 部署函数（--path 会同时创建 HTTP 访问路径 /ps-login）
tcb fn deploy ps-login -e coros-run-d0g0acnksda36ca62 --force --path /ps-login
```

- 函数会用私钥签票；票据里的 uid 取自集合 `ps_uid_map`（`ps_uid_map._id = ps_<hash>` → `cloudUid`）。
- **老数据不丢**：第一次换票时若还处于旧本站会话，函数会把旧 uid 记进 `ps_uid_map`（`via=legacy`）；单账号环境也可手动把 `cloudUid` 改成旧 uid。
- 换票失败（如私钥缺失）时前端不会死循环：本次会话只试一次，入口照常可点，`login.html` 仍可直连兜底。

---

## 查看线上云函数日志（线上排障用）

线上云函数（`dashboard` / `review` / `account` / `coros-sync` 等）的**调用日志已开启**（腾讯云 CLS，保留 7 天）。查某个函数最近的日志，用**一键脚本**：

```bash
bash tools/logs.sh review 1h       # 看 review 最近 1 小时
bash tools/logs.sh dashboard 30m   # 看 dashboard 最近 30 分钟
```

- 时间范围可写 `30m` / `1h` / `6h` / `1d`（默认 1h）。
- 首次需先登录：`export PATH="/opt/homebrew/bin:$PATH" && tcb login`（之后免登录）。
- 进阶（按关键字找报错）：`tcb logs search -e coros-run-d0g0acnksda36ca62 -q 'function_name:"review" AND "出错了"' -t 1h`。
- ⚠️ `tcb fn log <函数名>` 这条命令**取不到日志**（它走旧路径，总显示「无调用日志」）——**别用它**，统一用上面的脚本 / `tcb logs search`。

---

## 想改东西时，看哪个文件？

| 想改什么 | 改哪个文件 |
| --- | --- |
| 页面布局 / 新增卡片 | `web/index.html` |
| 配色 / 样式 | `web/style.css` |
| 图表 / 交互 / 列表逻辑 | `web/app.js` |
| 「我的账户」页（账户码 / 填 Key / 字号） | `web/account.html` + `web/account.js` |
| AI 跑步教练对话框（多轮 / 人格 / 上下文） | `web/coach.html` + `web/coach.js`（后端 `serve.py` 的 `/api/coach`） |
| 补给计算（碳水 / 水 / 钠，纯函数） | `web/nutrition.js` |
| 教练伤病 / 营养知识卡（自撰，关键词注入） | `tools/coach_knowledge/*.md` |
| 本机存储 / 交互件（toast / 弹层 / 复制） | `web/store.js` + `web/ui.js` |
| 本地服务 / AI 与账户接口 | `web/serve.py` |
| 抓哪些数据 / 字段解析 | `tools/source_coros.py`（高驰适配器） |
| 数据源适配层（加品牌 / `--source`） | `tools/adapters.py` + `tools/source_<provider>.py` |
| 编排与落盘（选数据源 → 统一模型 → JSON） | `tools/fetch_data.py` |
| 授权与 MCP 调用 | `tools/coros_probe.py` |

改完前端 → 浏览器**硬刷新**（Cmd+Shift+R）；改完 `serve.py` → 重启服务（Ctrl+C 再跑）。

---

## 常见问题

| 现象 | 处理 |
| --- | --- |
| 页面提示「读取数据失败」 | 没抓数据或没起服务：先第 2 步再第 3 步 |
| 点「生成复盘」提示未配置 | 去设置页填 Key（第 4 步） |
| 抓数据报错、认证失败 | 区域选错，换 `COROS_REGION` 再试；或 `coros_probe.py relogin` |
| 端口 8920 被占用 | `PORT=8930 python3 web/serve.py` |

---

## 相关文档
- 项目总览与目录结构：[../README.md](../README.md)
- 需求文档：[../plan/RPD_需求文档.md](../plan/RPD_需求文档.md)
- 可行性分析：[../plan/可行性分析_高驰跑步数据分析.md](../plan/可行性分析_高驰跑步数据分析.md)
