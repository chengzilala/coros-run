# 会话记录 — coros-run（高驰跑步看板）

> 格式：每个阶段一段摘要（固定 6 段）。详见 [可复制项目指南.md](./可复制项目指南.md) §5.1。
> 红线：不写密钥 / token / 隐私。

---

## 2026-10-09 会话条目：可行性分析 → 本机版跑通 → 补标准骨架（已完成）

- **目标**：评估「给高驰跑步用户做数据展示」这个方向能不能做、值不值得做；定案后先做网页/H5 最小版，并把它搭成规范项目骨架。
- **已做**：
  1. 做可行性分析（核实高驰用户对官方数据展示的痛点、竞品与可行路径），产出 `plan/可行性分析_高驰跑步数据分析.md`，结论：需求真实但非蓝海，推荐「数据看板 + 中文 AI 复盘」最小版，先不自建小程序；
  2. 跑通高驰**官方 MCP**：OAuth（PKCE）授权 → `initialize` → `tools/list`（34 个）→ `tools/call` 读到真实数据；
  3. 定位并纠正**区域端点**问题（账号属北美/国际区，须用 `mcpus.coros.com`）；
  4. 写 `tools/fetch_data.py`，修复 MCP 文本**二次 JSON 编码**的解析问题，成功抓到 200 条运动记录 + 8 条详情；
  5. 搭前端看板（`web/index.html` / `style.css` / `app.js`）：KPI + 跑量/配速心率/训练负荷三图 + 活动列表 + 单次详情弹窗；本地 ECharts；
  6. 写 `web/serve.py`（本机静态服务 + `/api/review` AI 接口），接入 DeepSeek，AI 中文复盘端到端跑通；
  7. 加**设置页**（`web/config.html` / `config.js` + `/api/config` 接口）：浏览器内配置大模型 Key（预设 + 测试连接 + 掩码）；
  8. 用 `new-project-scaffold` 技能**增量补齐**项目骨架（`.trae/` 规则与 6 个技能副本、`usage/`、`plan/RPD`、`dev/` 等），并登记进分发体系。
- **关键结论/决定**：
  - **路线**：先做**本机自用**的网页看板 + AI 复盘；对外官网/H5 属**另一套**（需自建授权后端），暂缓。
  - **区域端点**：本账号属北美/国际区，命令统一 `COROS_REGION=us`（这是最容易踩的坑）。
  - **技术栈**：前端原生 + 本地 ECharts；后端仅 Python 3 标准库，**零第三方依赖**。
  - **隐私**：高驰 token、大模型 Key、训练数据**只存本机**，全部 gitignore。
- **产出物（文件/链接）**：
  - `plan/可行性分析_高驰跑步数据分析.md`、`plan/RPD_需求文档.md`（v0.1）
  - `tools/coros_probe.py`、`tools/fetch_data.py`
  - `web/index.html`、`web/style.css`、`web/app.js`、`web/serve.py`、`web/config.html`、`web/config.js`、`web/lib/echarts.min.js`
  - `README.md`、`usage/Running.md`、`.trae/rules/{general_rules,project_rules}.md`、`coros-run.code-workspace`
- **待办**：① 用户实测设置页换 Key/换服务商；② 可选：手机端 PWA、更多数据维度（睡眠/HRV/步频步幅）；③ 远期：对外版官网/H5。
- **风险/注意事项**：`.trae/` 是副本，改规则须改母本再同步；高驰 token 会过期，报错时跑 `coros_probe.py relogin`；**Key/token/训练数据不得入库**。

---

## 2026-10-09 会话条目：注入 H5 交互经验 + 本机版账户体系原型（已完成）

- **目标**：把「微信读书插件」里验证过的**好经验**——H5/网页端交互、账户体系——注入 coros-run；落地方式＝**交互经验全注入 + 账户体系按对外版 1:1 结构做本机原型**（以后换云函数只改 endpoint），先打对外版地基。
- **已做**：
  1. 抽出可复用交互件：新增 `web/store.js`（本机存储层：账户码 / 端点 / 字号档位 / 带 TTL 缓存）、`web/ui.js`（`toast` / `copyText` 带降级 / `stateHtml` 三态占位 / `confirmDialog` 站内弹层）；
  2. 账户体系本机版：`serve.py` 新增账户存储 + **本机应用层加密**（Python 无内置 AES，改用 HMAC-SHA256 流密钥 + 认证标签，密文外壳 `v1:<nonce>:<tag>:<ct>`，与对外版 AES-256-GCM 同壳）+ `/api/account` 接口（`keySave/keyClear/profileSave/bindCreate/bindRedeem/test`）；
  3. 新「我的账户」页 `account.html` / `account.js`（替代并删除原 `config.html`/`config.js`）：账户码掩码·显示·复制、AI Key 加密托管、跨设备登录（6 位一次性码 + 粘贴账户码）、字号档位、退出防呆；
  4. 看板接入：`index.html`（footer 改「⚙ 我的账户」+ PWA meta）、`app.js`（复盘三态 loading / 错误占位 / toast，body 带 `device`）、`style.css`（字号变量 + 弹层/toast/状态样式）；
  5. 上 PWA：`manifest.webmanifest` + `icon.svg` + `sw.js`（直通不缓存）+ `pwa.js`；「加到桌面」可用。
- **关键结论/决定**：
  - **账户码心智**：账户码＝账号＋登录凭证（一体），**本机唯一持有**；无注册/密码，浏览器首访自动生成 32 位随机串当账户。退出登录＝本机不再持有账户码，故必须做**退出防呆**（先弹完整码 + 一键复制，确认后再退）。
  - **加密落点**：本机版用同壳流加密，机器密钥 `web/data/secret.key`（600，自动生成，或环境变量覆盖）；对外版换 AES-256-GCM 只换函数、**不改密文外壳与前端调用**。
  - **安全边界**：`llm_config.json` / `data/accounts.json` / `data/secret.key` **禁止被网页静态下载**（服务端 403）；三者全部 gitignore。
- **产出物（文件/链接）**：
  - 交互层：`web/store.js`、`web/ui.js`
  - 账户：`web/account.html`、`web/account.js`、`web/serve.py`（账户/加密/接口）
  - PWA：`web/manifest.webmanifest`、`web/icon.svg`、`web/sw.js`、`web/pwa.js`
  - 接入：`web/index.html`、`web/app.js`、`web/style.css`
  - 文档：`plan/RPD_需求文档.md`（→v0.2，增 F10/F11 + §10 账户体系落点表）、`README.md`（第四节改「我的账户」+ 新增第五节账户体系）、`.gitignore`
- **待办**：① 用户实测：账户页存 Key → 回看板生成复盘；② 手机加桌面（PWA）体验确认；③ 远期对外版：把本机加密换云函数 AES-256-GCM、账户接口换线上 endpoint。
- **风险/注意事项**：账户码即凭证，退出前**务必抄好**；`secret.key` 丢失＝已托管 Key 不可解（需重填）；密钥 / token / 账户码 / 训练数据**一律不得入库或写日志**。

---

## 2026-10-11 会话条目：前端上线公网（CloudBase 静态托管，MVP）（已完成）

- **目标**：把看板**前端**发布到互联网（用户选定平台＝腾讯云 CloudBase，范围＝先上静态看板前端 MVP）。
- **已做**：
  1. 确认机器已装 Node（Homebrew，默认不在 PATH）+ 装 CloudBase CLI（`npm i -g @cloudbase/cli`，国内镜像）；`tcb login` 授权登录。
  2. 确认环境 `coros-run-d0g0acnksda36ca62` 为**个人版**、**静态网站托管已开通**。
  3. 新增一键发布脚本 `tools/deploy_web.sh`：按**白名单**把 `web/` 公开前端文件复制到 `/tmp/coros-web-dist`，内置安全护栏（发现 `dashboard.json/accounts.json/secret.key/llm_config.json/serve.py` 即中止），再 `tcb hosting deploy` 上线。
  4. 为「公网未登录」做两处最小改造：`web/app.js` 未登录改为**友好登录引导**（不再回退读本机数据）；`web/account.js` + `account.html` 线上**隐藏「AI Key 托管」卡**（其接口属本机服务）。
  5. 部署 + 验证：首页/登录页 200；`data/*`、`llm_config.json`、`serve.py`、`secret.key` 全 **404**；浏览器实测未登录看板出「登录 / 注册」引导、账户页无红色报错、AI Key 卡已隐藏、控制台零报错。
- **关键结论/决定**：**托管路径定案＝CloudBase 静态网站托管**（替代此前"托管路径待定"）；线上只放前端，**未登录看不到任何人的数据**；云端登录/绑定/数据/AI 仍属后续阶段（C3/D/E）。
- **产出物（文件/链接）**：
  - `tools/deploy_web.sh`（新增，一键发布）
  - 改动：`web/app.js`、`web/account.js`、`web/account.html`
  - 文档：`README.md`、`usage/Running.md`（§6 上线）、`plan/RPD_需求文档.md`（→v0.17，§11.7/§11.8）
  - 线上地址：https://run.chesterlee.cn
- **待办**：① 部署 C3 `dashboard` 云函数并联调看板读云端；② 阶段 D AI 复盘（平台 Key + 额度）；③ 阶段 E 账户页升级 + 隐私政策；④ 线上登录需确认新域名在「WEB 安全域名」内（否则登录/绑定不通）。
- **风险/注意事项**：现用自有域名 `run.chesterlee.cn`（已备案，无腾讯云「风险提醒」中间页）；Node/CLI 默认不在 PATH，需 `export PATH="/opt/homebrew/bin:$PATH"`；**发布脚本只传白名单，绝不把个人数据/凭据传到公网**。

### 阶段：线上登录联调（阶段 C / C3+C4 跑通）— 2026-10-11

- **目标**：验证对外版「登录 → 看本人云端数据」全链路在线上可用。
- **已做**：
  1. 核查线上环境：5 个云函数（`me`/`coros-authorize`/`coros-callback`/`coros-sync`/`dashboard`）**均已部署**；线上域名已在「WEB 安全域名」白名单内。
  2. 用浏览器在**线上登录页**发验证码成功（页面提示「验证码已发送，请查收邮箱。」，控制台无报错）。
  3. 用户在邮箱收到验证码并**登录成功**；线上看板显示**本人真实训练数据**。
  4. 服务端核对：`tcb fn invoke dashboard`（无登录态）返回「未登录」，验证鉴权逻辑生效。
- **关键结论/决定**：✅ **C3/C4 联调成功，阶段十一（阶段 C）完成**——对外版「登录 → 看自己云端数据」全链路线上跑通。跨账号隔离由「按登录 uid 取数」保证（未双账号实测）。
- **产出物（文件/链接）**：`plan/RPD_需求文档.md`（→**v0.18**，§11.8 状态与「C3/C4 线上联调记录」）；线上地址 https://run.chesterlee.cn
- **待办**：① 双账号实测「看不到别人数据」；② 开启线上云函数 **CLS 日志**（当前 `tcb fn log` 报 `topic not exist`，线上排障暂无服务端日志）；③ 进入**阶段 D**（AI 复盘：平台统一 Key + 每日额度）；④ 阶段 E 合规。
- **风险/注意事项**：邮箱验证码一次性、有时效；`/api/review`（AI）仍属本机服务，线上 AI 复盘待阶段 D 接入；验证码/邮箱属隐私，**不写入文档或日志**。

---

### 阶段：AI 复盘上云（阶段 D / D1+D2 代码完成，待部署）— 2026-10-11

- **目标**：把线上 AI 复盘从「本机服务 `/api/review` + 用户自填 Key」升级为「**云函数 `review` + 平台统一 Key + 每日额度**」，让线上用户零配置即可生成复盘。
- **已做**：
  1. 新增云函数 `cloud/functions/review/`：`index.js`（主流程）+ `lib/context.js`（复盘上下文拼装，纯函数）——取 uid → **先查额度**（`usage_quota`）→ 超额直接返回可读提示 → 按 uid 读 `profiles`/`activities`/`metrics_daily` → 用**平台统一 Key**（环境变量）调大模型 → **成功后再计数 +1**（失败不计费）。
  2. 新增集合安全规则 `cloud/collections/usage_quota.json`（`read: doc._openid==auth.uid`、`write:false`）。
  3. 前端 `web/app.js` 复盘改**双源**：新增 `DATA_SOURCE` 标记，登录读云端走 `CorosAuth.callFunction('review')`、本机预览仍走 `/api/review`；成功 toast 附「今日剩余 N 次」。
  4. 口径校验：把 `lib/context.js` 与 `web/serve.py` 的 `build_context` 用同一份 `dashboard.json` 逐行比对——结构一致，仅浮点尾数（`160` vs `160.0`）等无意义差异；并修掉一个真差异（`shortLoad/longLoad` 为 `0` 被 JS `||` 吞掉）。
- **关键结论/决定**：**额度在「成功调用后」才 +1**（失败不计费）；**平台 Key 只走云函数环境变量**，绝不入库/进代码库；本机版与对外版**共用同一套 prompt 口径**（`lib/context.js` ↔ `serve.py`，改一处须同步另一处）。
- **产出物（文件/链接）**：
  - 新增：`cloud/functions/review/index.js`、`cloud/functions/review/lib/context.js`、`cloud/functions/review/package.json`、`cloud/collections/usage_quota.json`
  - 改动：`web/app.js`（复盘双源 + 额度提示）
  - 文档：`plan/RPD_需求文档.md`（→**v0.19**，§6 阶段十二、§11.8 阶段 D 实现记录 + 部署清单）、`README.md`（线上「AI 复盘上云」说明）
- **部署与验证（已完成，2026-10-11）**：
  - `usage_quota` 集合已在控制台创建，安全规则 `{"read":"doc._openid == auth.uid","write":false}`。
  - 云函数 `review` 已部署（Node.js 18.15、超时 60s、内存 256MB；环境变量 4 个已生效）。部署方式：`cloudbaserc.json`（**含 Key、已 `.gitignore`，不入库**）+ `tcb fn deploy review --force`。
  - 前端已 `bash tools/deploy_web.sh` 重新发布。
  - **后端全链路验证通过**：带身份直接调用 → 返回四段中文复盘 + `usage_quota` 正确写入；计数「新建=1、再次自增 2→3」均正确。
  - **修复时区**：`todayKey` 改用 UTC+8（北京时间）取日，保证额度在用户本地 0 点重置（原按 UTC，会在北京 8 点重置）。
- **待办**：① 前端 UI 端到端点击复验（仅差**本人邮箱验证码登录**，登录只能本人完成）；② D3（用户自填 Key 加密托管）可选、未做；③ 阶段 E 合规。
- **风险/注意事项**：平台 `LLM_API_KEY` 属敏感信息，**只在控制台配置，不入库/不进仓库/不写日志**；`usage_quota` 计数只由云函数维护（客户端不可写）；`lib/context.js` 与 `serve.py` 的 prompt 口径需保持同步。

---

### 阶段：账户页升级 + 合规（阶段 E / E1+E2 完成并部署）— 2026-10-11

- **目标**：把账户页升级为「登录 + 绑定高驰 + 偏好 + 退出」四块齐全，并补齐**上线前合规项**——隐私政策页 + 用户可**一键删除**自己的全部云端数据（对外版必做阶段收官）。
- **已做**：
  1. 新增云函数 `cloud/functions/account/`（`index.js` + `package.json`）：`action=status` 只读 `coros_links` 返回绑定状态（不回 token）；`action=delete` 按调用上下文 uid 逐集合删除本人数据（`profiles`/`activities`/`metrics_daily`/`coros_links`/`usage_quota` 用 `_openid`，`coros_oauth_state` 用 `uid`；**全站配置 `coros_app` 不删**）。
  2. 新增隐私政策页 `web/privacy.html`（8 节：收集哪些数据 / 来源与授权（只读）/ 用途 / 存储与安全 / 共享与第三方（含 AI 复盘会把数据摘要发给大模型服务商）/ 你的权利：查看与删除 / 数据保留 / 更新与联系），复用站点样式与脚本，无构建。
  3. 账户页 `web/account.html`：加**绑定状态显示**（登录后自动调 `account{action:status}`，显示已绑定/未绑定 + 区域 + 上次更新时间；同步成功后刷新）；加「**数据与隐私**」卡（链接隐私政策 + 「删除我的全部云端数据」按钮，`U.confirmDialog` 二次确认后调 `account{action:delete}`）。
  4. `web/account.js`：线上把「AI 复盘 Key」卡改为显示「**平台统一提供**」（本机自填区块仅本机预览可见）；`web/index.html`、`web/login.html` 页脚加**隐私政策**入口。
  5. `tools/deploy_web.sh` 白名单加 `privacy.html`；`cloudbaserc.json` 加 `account` 函数定义（文件已 `.gitignore`，不入库）。
- **关键结论/决定**：**账户数据删除只按登录 uid 操作，绝不动别人数据**；**`coros_app`（全站 client_id 配置）不属于用户数据，删除时不删**；删除**不可恢复**，前端必做二次确认。
- **产出物（文件/链接）**：
  - 新增：`cloud/functions/account/index.js`、`cloud/functions/account/package.json`、`web/privacy.html`
  - 改动：`web/account.html`（绑定状态 + 数据与隐私卡 + 内联脚本）、`web/account.js`（线上 Key 卡分流）、`web/index.html`、`web/login.html`（隐私入口）、`tools/deploy_web.sh`（白名单）、`cloudbaserc.json`（加 account，不入库）
  - 文档：`plan/RPD_需求文档.md`（→**v0.21**，§6 阶段十三、§11.8 阶段 E 实现记录；B3 绑定状态一并打勾）、`README.md`
- **部署与验证（已完成，2026-10-11）**：
  - `tcb fn deploy account --force` 部署成功。
  - 带身份直接调用 `action=status` → `{ok:true,bound:true,provider:"coros",region:"us",updatedAt:…}`。
  - 用**假 uid** 调 `action=delete` → 6 个集合计数全 0、无报错（**未动真实数据**）。
  - 前端已 `bash tools/deploy_web.sh` 重新发布（18 个文件，含 `privacy.html`）。
- **待办**：① 前端 UI 端到端点击（绑定状态显示 / 一键删数据）待**本人邮箱验证码登录**后在浏览器复验；② 真实删除动作未执行（逻辑已用假 uid 验证）；③ 对外版必做阶段（A–E）已全部完成，剩余可选扩展（阶段 F/十五）与两项待补实测（双账号隔离、线上 CLS 日志）。
- **风险/注意事项**：`delete` 不可恢复，务必二次确认；云函数一律只按登录 uid 操作；`cloudbaserc.json` 含平台 Key，**已 `.gitignore`，不入库**。

---

### 阶段：看板变强·第二波（阶段十五 / F20–F23 完成并部署）— 2026-10-11

- **目标**：借鉴 GitHub 项目 `claude-fitness-cn` 的看板表达，做第二波「看板变强」——新增**强度分布 80/20**、**心率效率趋势**、**图表目标线 + 洞察脚注**，并把两条工程准则内化进 AI 复盘 prompt（F20–F23，零新增操作、零第三方依赖）。
- **已做**：
  1. **F20 强度分布（`app.js` `computeIntensity()`/`renderIntensity()`）**：用已有五区配速的阈值 T（`fitness.paces.T`，实测 5:15/km）当分界，配速慢于 T=轻松、快于 T=高强度；按周（UTC 周一）汇总 `distanceM`，渲染堆叠柱 + 高强度占比折线（含 hard%≤20% 目标线）+ 洞察脚注。无数据则隐藏卡片。
  2. **F21 心率效率（`app.js` `computeHrGroups()`/`renderHrEfficiency()`）**：只取「有距离+时长+平均心率」的训练，`效率 = 速度(m/min) ÷ 平均心率`，**按 `sportType` 分组、同类只比同类**；每类一条线 + 均值 `markLine` + 脚注。
  3. **F22 目标线 + 洞察**：给跑量卡加**月均基准虚线**、强度卡加**hard%≤20% 目标线**、心率效率卡加**均值线**；图下一句前端生成的洞察（不交给 AI）。新增 `style.css` `.chart-foot`。
  4. **F23 AI 口径内化**：`web/serve.py` `SYSTEM_PROMPT` 加两条硬准则，**云端 `cloud/functions/review/index.js` 同步**：「① 确定性算术不交给 AI；② 无数据不推断」。
  5. **`index.html`**：跑量卡加脚注位，新增 `#intensityCard`/`#hrEffCard`（默认 `hidden`，有数据才显示）。
- **关键结论/决定**：**实现方式改为「前端纯函数」**（偏离原计划的 `tools/intensity.py` + 写 `dashboard.json` 字段）——输入字段本机 `dashboard.json` 与云端 `dashboard` 云函数**都已下发**，放前端一套逻辑即可**本机与线上同时生效**，避免 python/node 两套算术口径漂移（详见 RPD §14.6「实现取舍」）。
- **产出物（文件/链接）**：
  - 改动：`web/app.js`（`renderVolume` 月均线 + F20/F21 纯函数与渲染 + `renderCharts` 挂载）、`web/index.html`（两张新卡 + 脚注位）、`web/style.css`（`.chart-foot`）
  - 口径：`web/serve.py`、`cloud/functions/review/index.js`（两条硬准则，双端同步）
  - 文档：`plan/RPD_需求文档.md`（→**v0.22**，§2 F20–F23 打勾、§6 阶段十五打勾、§14/§14.6 实现取舍与实测）、`README.md`（看板新增卡片说明）
- **部署与验证（已完成，2026-10-11）**：
  - `tcb fn deploy review --force` 重发（prompt 变更生效）；`bash tools/deploy_web.sh` 重发前端。
  - **无浏览器验证**：写一次性 Node 脚本（DOM/echarts 桩 + 真实 `web/data/dashboard.json` 跑 `app.js`），断言无 NaN：强度分布 12 周、脚注「近 4 周：轻松 105.1 km、高强度 34.9 km，占比 25%——偏高」；心率效率分「户外跑(93)/跑步机(27)」两类，范围 0.62~1.41；跑量脚注「本月 110.4 km，较上月 减少 51%，月均 141.4 km」。脚本用完即删。
  - **修复 UTC 周起点**：`weekKey` 原用本地时区导致 x 轴误标周日（`11-30`），改为按 UTC（`T00:00:00Z` + `setUTCDate/getUTCDay`）取周一。
- **待办**：① 前端卡片视觉效果待**本人邮箱验证码登录**后在浏览器复验；② 更长期：双账号隔离实测、线上云函数 CLS 日志、阶段 F（睡眠/HRV/步频步幅）。
- **风险/注意事项**：三条前端算术（阈值配速分界、效率口径、周起点）**改一处即双端同时生效**，但需与 RPD §14 口径保持一致；`review` 云函数 prompt 与 `serve.py` 必须同步；`tcb fn detail` 会明文显示环境变量（含 LLM Key），**勿外发截图**。

---

### 阶段：近一周小结（阶段十六 / F24 完成并部署）— 2026-10-11

- **目标**：看板顶部加一张**整行宽卡「近一周小结」**，让用户打开即见「这周 vs 上周」的直接对比 + 一句人话点评（F24）。零新增交互、零第三方依赖。
- **已做**：
  1. **`web/app.js` 前端纯函数**：`computeWeekly()` 算全部数值与点评、`renderWeekly()` 渲染；辅助 `shiftDate()`/`todayLocalStr()`/`rangeStats()`。对比 7 项：跑量 / 时长 / 次数 / 平均配速 / 平均心率 / 高强度占比 / 短期负荷。
  2. **`web/index.html`**：`.board-main` 开头新增 `#weeklyCard`（`section.card.wide`，默认 `hidden`），含 `#weekHint`/`#weekTable`/`#weekFoot`。
  3. **`web/style.css`**：`.wk-table`/`.wk-row`/`.wk-k`/`.wk-v`/`.wk-d` + 变化色 `.wk-up`/`.wk-down`/`.wk-fast`/`.wk-slow`/`.wk-flat`；手机端（≤640px）收紧列宽/间距。
  4. **`applyData()` 挂载** `renderWeekly()`（在 `renderPaces()` 之后、`renderCharts()` 之前）。
- **关键结论/决定（两处取舍）**：
  - **窗口取「滚动 7 天」而非「自然周」**：数据同步有滞后，"自然周"会让"本周"只剩半天、与完整上周不公平（首版实测本周 5.0 km vs 上周 52.1 km，环比 -90% 失真）。改为**最近 7 天（`end-6`..`end`）vs 前 7 天（`end-13`..`end-7`）**，两段各完整 7 天。`end` 取数据最新训练日，点评在滞后时加「（数据截至 MM/DD）」。
  - **仍走前端纯函数**（沿用阶段十五取舍）：输入字段双端都已下发，一套逻辑本机与线上同时生效，数据层零改动。
- **产出物（文件/链接）**：
  - 代码：`web/app.js`（`computeWeekly()`/`renderWeekly()`/`rangeStats()`/`shiftDate()`/`todayLocalStr()`）、`web/index.html`（`#weeklyCard`）、`web/style.css`（`.wk-*`）
  - 文档：`plan/RPD_需求文档.md`（→**v0.24**，因 v0.23 已被「AI 复盘排版」占用；§2 F24、§6 阶段十六、新增 §15）、`README.md`（看板特性补「近一周小结」）
- **部署与验证（已完成，2026-10-11）**：
  - **无浏览器验证**：一次性 Node 脚本（DOM/echarts 桩 + 真实 `web/data/dashboard.json` 跑 `app.js`），断言无 NaN。
    - 主用例：`hidden=false`，区间 `02/13–02/19`，点评「（数据截至 02/19）跑量较前 7 天减少 52%（最近 7 天 25.7 km / 8 次）；高强度占比 22%（高于 20% 目标，注意多安排轻松跑）。」；表格 7 行齐全（跑量↓52%、时长↓53%、次数+1、配速快 10s、心率+3 bpm、高强度↑3pp…）。
    - 边界 A（仅今天 1 次、无 paces/load）：`hidden=false`，5 行，点评「前 7 天没有训练记录；最近 7 天 5.0 km / 1 次。」。
    - 边界 B（无任何活动）：`hidden=true`。脚本用完即删。
  - `bash tools/deploy_web.sh` 重发前端 18 文件，线上生效。
- **待办**：前端卡片视觉效果待**本人邮箱验证码登录**后在浏览器复验；更长期同阶段十五（双账号隔离实测、线上 CLS 日志、阶段 F 睡眠/HRV/步频步幅）。
- **风险/注意事项**：`computeWeekly()` 的"滚动 7 天"口径与 §15 绑定，改动需同步文档；「短期负荷」取窗口内 `shortLoad` 峰值（非均值），与曲线图口径不同，勿混；缺数据行自动隐藏，不得臆造。

---

### 阶段：下周训练建议（阶段十八 / F29 完成并验证）— 2026-10-11

- **目标**：看板加一张「教练建议卡」——让用户打开即知「**下周该怎么练**」（对应 §13.5 ③ 暂缓项，做成**不填目标也能用**）。零新增交互、零第三方依赖、不越界（只做负荷管理建议，非医疗建议、不出课表）。
- **已做**：
  1. **抽公共窗口**：`web/app.js` 新增 `weeklyWindows()`（滚动 7 天原始数据），**「近一周小结」与「下周建议」共用同一套窗口口径**（`computeWeekly()` 改为调用它）。
  2. **规则引擎**：`computeNextWeek()` —— 量档位五档（重启 / 恢复 / 减量 / 加量 / 保持，按优先级取首个命中）+ 强度占比 + 频次 + 配速参考，生成一句总判 + 3–4 条建议；`renderNextWeek()` 渲染。
  3. **`web/index.html`**：`#weeklyCard` 之后新增 `#nextWeekCard`（`section.card.wide`，默认 `hidden`），含 `#nextWeekHeadline`/`#nextWeekList`/`#nextWeekFoot`。
  4. **`web/style.css`**：`.nw-headline`/`.nw-list`/`.nw-item`/`.nw-tag`/`.nw-text` + 标签色 `.nw-build`/`.nw-hold`/`.nw-cut`/`.nw-recover`/`.nw-intensity`/`.nw-pace`。
  5. **`applyData()` 挂载** `renderNextWeek()`（在 `renderWeekly()` 之后）。
- **关键结论/决定**：
  - **档位规则**：本周无训练→重启；状态灯非"良好"→恢复（-20%）；环比 >+30%→减量（≤10% 增幅红线）；<−30%→加量（+10%）；否则保持。km 目标由本周跑量折算取整。
  - **不臆造**：前 7 天无量→不做环比（退化）；无 paces→不出强度/配速条；无活动→整卡隐藏。
  - **仍走前端纯函数**（沿用 §14.6/§15 取舍），数据层零改动。
- **产出物（文件/链接）**：
  - 代码：`web/app.js`（`weeklyWindows()`/`computeNextWeek()`/`renderNextWeek()`）、`web/index.html`（`#nextWeekCard`）、`web/style.css`（`.nw-*`）
  - 文档：`plan/RPD_需求文档.md`（→**v0.26**，因 v0.25 已被「佳明支持规划」占用；§2 F29、§6 阶段十八、新增 §17）、`README.md`（看板特性补「下周训练建议」）
- **部署与验证（2026-10-11）**：
  - **无浏览器验证（通过）**：一次性 Node 脚本（DOM/echarts 桩 + 真实 `web/data/dashboard.json` 跑 `app.js`），5 用例全过、无 NaN。
    - 主用例：总判「下周：逐步回升，稳步加量」；4 条（加量→28 km、强度 22% 压回、恢复留 1 天、配速 E/T）。
    - 边界 A（仅今天 1 次、无 paces/load/readiness）：「保持稳定节奏」，2 条。
    - 边界 B（无活动）：整卡 `hidden`。
    - 边界 C（状态灯"注意"）：「以恢复为主，先别上强度」，首条减量→约 21 km。
    - 边界 D（跑量 +700%）：「稳住别加量，控制力度」，首条减量。脚本用完即删。
  - **部署**：先因 CloudBase CLI 登录态失效受阻，用户 `tcb login` 后 `bash tools/deploy_web.sh` 重发前端 **18 文件全部上传成功**，线上 `https://run.chesterlee.cn` 生效。
- **待办**：① 卡片视觉效果待本人登录后浏览器复验；② 更长期同阶段十五/十六。
- **风险/注意事项**：档位阈值（±30%、强度 20%、频次 3/6）与 §17 绑定，改动需同步文档；建议**只做负荷管理**，不得扩展成医疗/伤痛建议；`tcb login` 由用户本人执行，勿在仓库留任何腾讯云密钥。

---

### 阶段：数据源适配层抽取（阶段十七·步 1 / 行为不变）— 2026-10-11

- **目标**：把高驰抓数链路重构为「**适配器 + 统一模型**」（RPD §16.6 步 1），为佳明等多品牌支持铺路；**铁律：行为不变、高驰现状零回归**（旧看板照常）。
- **已做**：
  1. **新增 `tools/adapters.py`**（适配器契约 + 动态加载）：`available()` 列出已装数据源、`load(provider)` 动态加载 `tools/source_<provider>.py`；契约＝适配器须有 `PROVIDER`(str)、`DEFAULT_OUT`(str, 相对项目根)、`build(opts)->dict`。
  2. **新增 `tools/source_coros.py`**（高驰适配器）：把原 `fetch_data.py` 的**全部抓取/解析逻辑**（`parse_profile`/`parse_devices`/`parse_fitness`/`parse_training_load`/`parse_daily_health`/`parse_recovery`/`parse_records`/`parse_detail` 等）搬入，暴露 `build(opts)` 输出**统一内部模型**；传输层仍复用 `tools/coros_probe.py`。
  3. **改写 `tools/fetch_data.py`** 为**公共编排 / 输出层**：只做参数解析（`--source`/`--out`/`--start`/`--end`/`--days`/`--details`/`--dump-raw`）+ 调适配器 `build` + 落盘；命令行用法与原来一致。
  4. **重构 `tools/source_garmin.py`** 适配统一契约：新增 `PROVIDER`/`DEFAULT_OUT`，原 `main()` 主体改为 `build(opts)`（返回模型、不再自己写文件），保留独立 CLI 包装；`map_*` 映射、`login()`、`SPORT_CODE` 不变。
- **关键结论/决定**：
  - **加品牌＝加一个适配器**：业务层与前端只认统一模型，`web/` **零改动**；`tools/coros_probe.py` 仍是高驰传输层（授权 + MCP 调用）。
  - **等价性优先**：统一模型即现有 `dashboard.json` 结构；仅**有意**新增一个顶层 `provider` 键，其余键名/类型/字段一字不动。
- **产出物（文件/链接）**：
  - 代码：`tools/adapters.py`（新）、`tools/source_coros.py`（新）、`tools/fetch_data.py`（重写为编排层）、`tools/source_garmin.py`（契约化）
  - 文档：`plan/RPD_需求文档.md`（→**v0.28**，因 v0.27 已被「版式 + 导航升级」占用；§3 数据链路、§6 阶段十七、§8 风险表、§16.3 落点、§16.6 步 1 状态 ✅ + 进展 note）、`README.md`（文件树 tools 段）、`usage/Running.md`（模块对照表）
- **验证（已完成，行为不变）**：
  - `py_compile` 全过；`adapters.available()` 返回 `['coros','garmin']`；两适配器 `PROVIDER`/`DEFAULT_OUT`/`build` 均正确；`fetch_data.py --help` 正常。
  - **真实回归**：`COROS_REGION=us python3 tools/fetch_data.py --details 8 --out /tmp/dashboard.after.json` 抓数成功（200 记录 / 8 详情）；与旧 `dashboard.json` 逐键比对——**唯一新增键 `provider`（有意）**，活动记录 13 字段、详情字段、`fitness` keys **完全一致**；前端用新数据跑 `app.js` 冒烟（kpis / 周报 / 下周建议 / 活动列表均有内容）**无 NaN**。临时文件用完即删。
- **待办**：① 阶段十七·步 2～4（佳明实机接入，**待用户佳明账号**）；② 前端卡片端到端视觉复验仍待本人登录后在浏览器进行；③ 更长期同阶段十五～十八（双账号隔离实测、线上 CLS 日志、阶段 F）。
- **风险/注意事项**：改动集中 `tools/`，**前端与云端口径不受影响**；云端 `cloud/functions/coros-sync/lib/parse.js` 是高驰解析的 JS 移植，若后续调整 `source_coros.py` 解析口径，须同步核对；佳明依赖（`garminconnect`/`garth`）是零依赖红线的**唯一经批准例外**，仅限本机抓数脚本。

---

### 阶段：线上云函数 CLS 日志开启（运维 / 线上排障）— 2026-10-12

- **目标**：让线上云函数（`dashboard`/`review`/`account`/`coros-sync`）产生**服务端日志**，线上排障不再只能靠前端提示（对应此前 RPD §11.8 待补项②「CLS 日志未开」）。
- **已做**：
  1. **恢复登录**：用户 `tcb login`（设备授权，用户码 `7JA3-MU28`），CLI 登录态恢复（`tcb env list` 正常）。
  2. **确认现状**：`tcb api tcb DescribeEnvs --api-version 2018-06-08` 显示 `LogServices: []`（未开）。
  3. **开通日志资源**：`tcb api tcb CreateEnvResource --api-version 2018-06-08 --body '{"EnvId":"coros-run-d0g0acnksda36ca62","Resources":["log"]}'` → 返回 RequestId；轮询 `DescribeEnvs` 得到日志集 `tcb-logset-coros-run-d0g0acnksda36ca62`、主题 `tcb-topic-coros-run-d0g0acnksda36ca62`（TopicId `fc6d54ed-…`，保留 7 天、`BillingMode: payg`）。
- **关键结论/决定**：
  - 开通日志走**环境级** CLS 资源（`CreateEnvResource`），**不用进控制台**；该接口是异步的，用 `DescribeEnvs` 的 `LogServices` 轮询确认。
  - 查询统一用 **`tcb logs search -e <env> -q 'function_name:"xxx"' -t 1h`**；`tcb fn log <函数名>` 仍走**旧路径**、恒返回「无调用日志」，**弃用**。
  - 日志**按量计费**（保留 7 天）：系统调用日志已产生；高级检索/分析按量，留意用量。
- **产出物（文件/链接）**：
  - 脚本：`tools/logs.sh`（一键查线上云函数日志，`bash tools/logs.sh <函数名> [30m/1h/6h/1d]`）
  - 文档：`plan/RPD_需求文档.md`（→**v0.31**，新增条目 + §11.8 待补项②标记**已解决**）、`usage/Running.md`（新增「查看线上云函数日志」小节）、`README.md`（运维一行 + 文件树）
- **验证（已完成）**：
  - `tcb fn invoke dashboard`（无登录态，返回「未登录」）后 → `tcb logs search -e coros-run-d0g0acnksda36ca62 -q 'function_name:"dashboard"' -t 1h` **检索到该次调用的系统日志**（START / Response / END / Report，`status_code` 200/202，TopicId 与新主题一致）。此前同命令报 `topic not exist`。
- **待办**：① 后续真实线上排障按需查日志；② 若要查**用户代码 `console.log`**（`src:app`）待实际触发后再验。
- **风险/注意事项**：日志主题**保留 7 天、按量计费**；`tcb login` 由用户本人授权，**勿在仓库留任何腾讯云密钥**；查询命令统一用 `tcb logs search`，勿用 `tcb fn log`。

---

### 阶段：前端卡片复验清单（验收文档）— 2026-10-12

- **目标**：产出一份**可照着点一遍**的线上前端验收清单，覆盖看板卡片渲染 + 账户页 + AI 复盘 + 交互持久化 + 边界（尤其新增的 4 张卡），供本人登录后逐项验收。
- **已做**：
  1. 核对真实交互与元素（读 `web/index.html` / `app.js` / `account.html` / `login.html`）：卡片清单与 id（`raceCard`/`cardCalendar`/`cardStats`/`weeklyCard`/`nextWeekCard`/`intensityCard`/`hrEffCard`/`aiCard`/`actCard`）、登录与未登录跳转（`renderNeedLogin` → `landing.html`）、AI 复盘口径（云端 `review` vs 本机 `api/review`）、账户页三块（绑定同步 / AI Key / 数据隐私）、持久化（主题 · 字号 · 比赛标记）。
  2. 按「功能子项 + 边界项」编写勾选清单，落盘 `test/前端卡片复验清单.md`（七组：登录身份 / 账户页 / 看板卡片 / AI 复盘 / 交互持久化 / 边界协同 / 数据一致性抽查）。
- **关键结论/决定**：
  - **复验必须由本人在浏览器完成**（需邮箱登录 + 高驰账号数据），AI 无法代跑；清单作为人工验收的操作脚本。
  - 明确标注**「四张新卡」**= 跑量日历 / 跑量规律&纪录 / 近一周小结 / 下周训练建议；边界项重点含「未登录跳落地页」「空数据无 NaN」「刷新后持久化」。
- **产出物（文件/链接）**：`test/前端卡片复验清单.md`（新建）；`usage/Running.md`（发布后自验指针）。
- **验证（已完成）**：清单条目均对照代码核实（卡片 id、按钮行为、跳转逻辑、持久化 key），无臆造。
- **待办**：本人登录后按清单点一遍，把问题（卡片名 + 现象 + 截图 + URL）回传，再定点修复。
- **风险/注意事项**：若线上不是最新前端，先 `bash tools/deploy_web.sh` 再验；清单随卡片增减需同步维护。

---

### 阶段：丹尼尔斯对话教练（α 地基，本机自用）— 2026-10-12

- **目标**：把 v0.33 立项的「**专门的跑步教练角色（独立对话框）**」落成**本机可跑**的 α 地基——不是给通用模型贴「教练」标签，而是以**丹尼尔斯跑步公式**为内核的多轮对话角色，直接吃看板已算好的数据。
- **已做**：
  1. **后端**（`web/serve.py`）：把原 `call_llm(system, user)` 拆出 `call_llm_chat(messages, cfg, max_tokens, temperature)`（payload 直传 `messages` 列表），`call_llm` 保留为薄包装（复盘调用不变）；新增教练常量 `COACH_METHODOLOGY`（丹尼尔斯方法论：五区 / 80-20 / 10% 递增 / 周期化 / 降级 / 硬准则 5 条）、`COACH_PERSONAS`（geek / veteran / straight / companion，默认 companion）与 `build_coach_context(data)`（复用 `build_context`，补**五区配速**与**今日状态灯**）；`_sanitize_messages()` 只留 user/assistant、限 24 条 / 单条 4000 字符；新增路由 `/api/coach` → `api_coach()`（读 device/persona/messages，无数据提示先抓数、未配 Key 返回可读提示）。
  2. **前端**：新建 `web/coach.html` + `web/coach.js`——多轮对话（前端持全部 `messages`、服务端无状态）、人格分段切换、`UI.md()` 渲染助手气泡 / `UI.esc()` 渲染用户气泡、`localStorage` 留存对话、建议问题 chip、Enter 发送 / Shift+Enter 换行 / 自动增高、清空用 `UI.confirmDialog`；底部纯文本免责声明（「仅供参考」，避免 HTML 里字面显示 `**`）。
  3. **样式**（`web/style.css`）：追加 `.coach-card` / `.chat-log` / `.chat-msg`（用户靠右橙色、助手靠左）/ `.chat-chip` / `.chat-form` 等，全部沿用看板配色变量。
  4. **入口**（`web/index.html`）：hero 右侧加「🏃 教练」→ `coach.html`。
- **关键结论/决定**：
  - **形态**＝独立对话框（多轮），**不新建数据链路**——复用 `build_context` 已算好的数字，服务端**无状态**（易上云）。
  - **硬准则**照旧：确定性算术不交 AI、无数据不推断、健康类标「仅供参考」、**不回写手表**（高驰只读）。
  - **共用账户托管 Key**，本机零新增依赖；对外版（γ）将换云函数 `coach` + 平台 Key + 按消息计额度。
- **产出物（文件/链接）**：
  - 代码：`web/serve.py`、`web/coach.html`、`web/coach.js`、`web/style.css`、`web/index.html`
  - 文档：`plan/方案_丹尼尔斯对话教练.md`（主方案，§8 交付/验收）、`plan/RPD_需求文档.md`（→**v0.36**，F33 行 + 阶段二十）、`README.md`（功能条目 + 第四节入口说明）
- **验证（已完成）**：
  - `python3 -m py_compile web/serve.py` 通过；`coach.html` 静态返回 **200**；`/api/coach` 传空消息返回 `{"error":"消息为空。"}`、未配 Key 返回可读提示（「还没有配置大模型…」）；`build_coach_context` 实测读到真实数据（VO2max=53.0、阈值配速 4:35/km、含五区配速与近期负荷，`has_paces=True / has_readiness=True`）。
- **待办**：① **β 能力域**——伤病知识卡关键词路由（自撰）+ 营养/补给纯函数计算；② **γ 对外版**——云函数 `coach`（多轮 + 平台 Key + 额度）+ 合规文案 + 前端双源；③ 用户配好 Key 后**实聊回归**（连续多轮追问、回答数字与看板一致）。
- **风险/注意事项**：本机 `web/data/accounts.json` 当前**无托管 Key**，故只能验到接口层、**真实多轮输出待用户配 Key 后实聊**；验证时端口 8920 被旧实例占用，改用 `PORT=8931` 起新代码核对（未动他人进程）；对话内容留浏览器本地、**不入库**。

### 阶段：对外版「官网」单页升级（介绍 + 跳转入口）— 2026-10-12

- **目标**：把 v0.29 的「官网落地页」升级为**完整单页官网**——主介绍 + 跳转「对应网站（看板）」与「H5 移动端功能」；**参考微信悦读官网的导航 / 入口结构，但不照搬其多页文档站形态**，保持本项目现有深色橙调与 `.wrap` / `.board-nav` 风格。
- **已做**：
  1. `web/landing.html`：加**吸顶胶囊导航**（复用看板 `.board-nav`：能做什么 / H5 移动端 / 三步开始 / 隐私与安全 / 开始使用）；新增「**H5 移动端**」区块（6 张功能卡 + 「手机打开看板」入口）；新增「**开始使用**」四条跳转入口（进入看板 / H5 移动端 / 登录·注册 / 我的账户 + 隐私政策）；首屏文案点明「电脑看板 + 手机 H5，同一份数据」。
  2. `web/landing.css`：加导航锚点留白 + 平滑滚动（`prefers-reduced-motion` 降级为静态）、H5 卡 / 入口卡栅格、≤640px 单列。
  3. `web/landing.js`：加**导航滚动高亮**（`IntersectionObserver`）；**入口按登录态自适应**——已登录时 `lpPrimary` / `lpTopLogin` / `lpBottomLogin` 及 `[data-gate]` 入口直指看板，未登录保持 `login.html?next=./`。
- **关键结论/决定**：
  - 形态定为**单页官网**（非多页文档站）；四个跳转入口均指向**项目已有页面**，不新增后端。
  - 改动只落 3 个**已在部署白名单**的文件，`tools/deploy_web.sh` **无需改**。
- **产出物（文件/链接）**：`web/landing.html`、`web/landing.css`、`web/landing.js`（改）；文档回灌 `README.md`、`usage/Running.md`、`plan/RPD_需求文档.md`（→ **v0.35**，§11.9 重写）。
- **验证（已完成，本机预览）**：浏览器实测桌面 1280 / 手机 375 两档 `scrollWidth == clientWidth`（无整页横向滚动）；8 张功能卡 / 6 张 H5 卡 / 4 张入口卡在 375px 下均单列；吸顶导航跳 `#h5` 正常；`landing.js` `node --check` 通过。
- **待办**：确认无误后 `bash tools/deploy_web.sh` 发布到线上。
- **风险/注意事项**：未登录时「进入看板 / H5」入口先走登录页（`next=./`），登录后回看板，符合门禁逻辑；吸顶导航在手机端为横向可滑动胶囊条（与看板一致），非缺陷。

### 阶段：官网新增「数据来源」说明（为什么只做高驰和佳明）— 2026-10-12

- **目标**：用户要求官网讲清**为何只接高驰（COROS）+ 佳明（Garmin）**两个数据源，让访客明白依据（这两家最专业、用的人多、数据开放度高）。
- **已做**：`web/landing.html` 新增 `#sources` 区块（导航加「数据来源」项，插入「能做什么」与「H5 移动端」之间）：① 引导句给三条判据（**专业 / 人多 / 数据开放**）；② 3 张说明卡（专业=专攻耐力运动、指标最深；人多=数据型运动员里佳明主导、高驰增长最快；开放=高驰官方只读接口 OAuth+原始 FIT、佳明官方平台级接口）；③ 高亮框讲**为何不是其他品牌**（苹果/华为/小米数据封闭且偏健康监测；颂拓/Polar 用户偏少）；④ **如实现状**——高驰已完整支持、佳明在接入规划中（官方接口仅面向企业）。`web/landing.css` 加 `.lp-src-*` 样式（沿用主题变量；浅色/深色均验证可读）。`landing.js` 无需改（滚动高亮自动纳入新锚点）。
- **关键结论/决定**：文案**以事实与代码为准**——事实依据为 COROS Partner API / 高驰官方 MCP、佳明 Connect Developer Program、Runalyze / Strava 2026 品牌分布；**不写会被证伪的精确百分比**，只作定性说明；**如实标注佳明为规划中**（对外版暂不上佳明，见 RPD §16.2），不夸大。
- **产出物（文件/链接）**：`web/landing.html`、`web/landing.css`（改）；文档回灌 `plan/RPD_需求文档.md`（→ **v0.38**，§11.9 加「数据来源说明」行）、`README.md`。
- **验证（已完成，本机预览）**：浏览器实测——`#sources` 区块结构与文案齐全；导航「数据来源」存在且点击滚动到位（标题 `top=64`，与 `scroll-margin-top:64px` 吻合）；1280 / 375 两档 `scrollWidth == clientWidth`（无整页横向滚动），375px 下 3 张卡单列；切浅色主题后新章节文字对比度均达标（无隐形文字）。
- **待办**：随官网一并 `bash tools/deploy_web.sh` 发布。
- **风险/注意事项**：浅色主题下橙色胶囊徽标（12px 小字）对比度约 3.2，略低于 WCAG AA 小字标准，但可读、且沿用全站既有 accent 用法，暂不特调。

### 阶段：官网「开始使用」区块上移至首屏正下方 — 2026-10-12

- **目标**：用户贴两张截图（图 1＝页面底部「开始使用」区块、图 2＝首屏 hero），要求把「开始使用」放到**首屏正下方**（经澄清）。
- **已做**：`web/landing.html` 把 `#entry`（「开始使用」四条跳转入口）从「隐私与安全」之后**移到 `lp-hero` 之后、看板示意 `lp-preview` 之前**；吸顶导航 `.lp-nav` 首项同步改为「开始使用」（`#entry`），顺序为 **开始使用 / 能做什么 / 数据来源 / H5 移动端 / 三步开始 / 隐私与安全**。`landing.css` / `landing.js` **未改**（滚动高亮自动覆盖新锚点，`scroll-margin-top` 复用）。
- **关键结论/决定**：访客第一屏之后**先给入口**（进看板 / H5 / 登录 / 账户），再往下看介绍；**纯版序调整**，零第三方依赖、手机单列自适应不变。
- **产出物（文件/链接）**：`web/landing.html`（改）；文档回灌 `plan/RPD_需求文档.md`（→ **v0.42**，§11.9 标题 + 「结构」行更新）、`README.md`。
- **验证（已完成）**：`curl` 实测页面区块顺序为 `#entry` → `lp-preview` → `#features` → `#sources` → `#h5`，与预期一致；导航首项＝「开始使用」。
- **待办**：随官网一并 `bash tools/deploy_web.sh` 发布。
- **风险/注意事项**：本次只挪版序、未改样式与逻辑；线上生效需重新发布（当前线上仍是旧版序）。

---

### 阶段：丹尼尔斯对话教练 β 能力域（伤病 + 营养，本机自用）— 2026-10-12

- **目标**：在 α 对话框基础上补两块能力——① **伤病预警与降级**（用户问「膝盖疼能跑吗」能给分级 + 降级建议）；② **营养 / 补给计算**（问「帮我算补给」能给可执行数字）。
- **已做**：
  1. **自撰知识卡**（新目录 `tools/coach_knowledge/`，10 张）：伤病 6 张（跑者膝 / 髂胫束 / 跟腱 / 足底筋膜 / 胫骨应力 / 过度使用通用降级）+ 营养 4 张（赛前饮食 / 比赛补给 / 补水电解质 / 恢复营养）；统一格式＝`# 标题` + `keywords: ...` + 正文，全部自写、标「仅供参考」。
  2. **后端知识路由**（`web/serve.py`）：新增 `KNOWLEDGE_DIR` 常量、`_parse_card()`、`load_knowledge_cards()`（一次性缓存）、`route_knowledge()`（回看最近 4 条用户消息做**关键词命中**，最多注入 2 张 / 2600 字，**不引向量库**）；`api_coach()` 命中即把卡片拼进教练 system，并追加前端传来的 `req.calc`（已算好的补给数字，限 1500 字）。
  3. **前端补给纯函数**（新 `web/nutrition.js`）：`plan(体重, 时长, 强度)` / `format()` / `parse(text)`（从「90 分钟 / 2 小时」+ 强度词解析）/ `hasIntent()`；纯函数、零依赖，本机与将来云函数共一份口径。
  4. **教练页**：`coach.html` 加「🧮 补给计算器」`<details>` 面板（体重 / 时长 / 强度 + 计算）；`coach.js` 读本机 `dashboard.json` 的 `profile.weightKg` 作默认体重、绑定计算、并在**补给类提问**里先算好数字随请求 `calc` 字段喂给教练（只复述不重算；给不出时长则让教练先问时长/强度，不猜数）；`style.css` 加 `.coach-tool` / `.fuel-grid` / `.fuel-out` 样式。
- **关键结论/决定**：
  - **知识路由用关键词、不引向量库**（零依赖）；伤病属健康类，卡片 + 硬准则双重确保「不做诊断、标仅供参考」。
  - **营养数字来自纯函数**（确定性算术不交给 AI），前端一份逻辑，α 提到的「双端一份」得以落实。
  - 卡片放仓库 `tools/`（自撰、无版权、可入库）；对话内容仍只留浏览器本地。
- **产出物（文件/链接）**：
  - 知识卡：`tools/coach_knowledge/*.md`（10 张）
  - 代码：`web/serve.py`、`web/nutrition.js`（新）、`web/coach.html`、`web/coach.js`、`web/style.css`
  - 文档：`plan/方案_丹尼尔斯对话教练.md`（§5 β 标记完成 + §8 交付/验收）、`plan/RPD_需求文档.md`（→ **v0.37**，F33 行 + 阶段二十）、`README.md`、`usage/Running.md`
- **验证（已完成）**：
  - `python3 -m py_compile web/serve.py` 通过；10 张知识卡全部加载；`route_knowledge` 实测「膝盖」→ 跑者膝卡、「能量胶」→ 比赛补给卡、无关问题返回空（不误注入）。
  - `node --check web/nutrition.js` / `web/coach.js` 通过；`parse('我跑90分钟比赛')` → `{minutes:90, level:hard}`、`parse('2小时慢跑')` → `{minutes:120, level:easy}`、无时长 → `null`；`plan(61.7,90,'moderate')` → 碳水 60 g/h · 水 600 ml/h · 钠 600 mg/h，45min 不补糖。
  - 临时服务（`PORT=8932`）冒烟：`coach.html` / `nutrition.js` 均 200；`/api/coach`（含 `calc`）路径正常执行，未配 Key 返回可读提示（证明知识路由 + calc 注入不报错）。
- **待办**：① **γ 对外版**——云函数 `coach`（多轮 + 平台 Key + 按消息计额度）+ 合规文案 + 前端双源；② 用户配好 Key 后**实聊回归**（伤病分级是否合理、补给数字表述是否清楚）。
- **风险/注意事项**：`req.calc` 由前端传入，本机自用无碍，**上云前需在云函数侧做长度/内容清洗**（防提示注入）；知识卡口径为自撰一般性参考，**非医疗建议**，重度症状一律引导就医；验证用的 8932 临时服务已停，8920 上仍是**旧实例**（需重启才生效）。

---

### 阶段：马拉松配速计算器（复刻 COROS「配速计算」/ F34）— 2026-10-12

- **目标**：按用户附的 COROS 官方 App「配速计算」页 4 张截图，**复刻设计**一个**马拉松配速计算器**——选距离 + 输入用时/配速，即时算**跑力**、**配速区间**、**五区训练参考**、**赛事预测**。
- **已做**：
  1. **页面**（新 `web/pace-calc.html`，自包含、仅引 `pace-calc.js`）：红色 sticky 顶栏「配速计算」+ 返回；表单区（距离下拉浮层 / 用时 / 配速 + km·mi 单位切换 / 步频步幅两列 + 数字输入提示）；奶油底结果区（标题 + 副标题 + 圆形红橙「即时跑力」徽章 + 三张斑马纹表）；`max-width:480px` 居中模拟手机。
  2. **逻辑**（新 `web/pace-calc.js`，纯函数零依赖、暴露 `window.CorosPace`）：`vo2At`/`pctMax`/`vdotOf`（**丹尼尔斯 VDOT 公式直算**）、`vdotVelocity`（VDOT→vVO₂max）、`predictTime`（**二分反解**赛事用时）、五区百分比换算（Easy 69~75% / M 85% / T 90% / I 98.6% / R 105.8%）、`fmtClock`/`fmtPad`/`secFromDigits`（数字式输入 415→4:15、25920→2:59:20）、`compute` 一次性出全部结果；页面交互（`render()` 统一刷新、单位切换、步频↔步幅互算、距离下拉 `renderSheet()` + `data-key` 事件委托）。
  3. **接入**：`web/index.html` `.hero-side` 加「⏱ 配速计算」入口；`tools/deploy_web.sh` 白名单加 `pace-calc.html` + `pace-calc.js`（仅加这两个，不多加）。
  4. **实测验后修复**（用户反馈）：① 距离下拉打开为空白 → `openSheet()` 内先 `renderSheet()` 并在初始化再渲染一次；② 按用户要求把界面英文全改中文——距离（全马/半马/10 公里/5 公里/1500 米）、五区（轻松跑/马拉松配速/阈值跑/间歇跑/重复跑）、列头（1 公里/1 英里）；`key` 仍英文用于逻辑，显示走 `cn`；③ 去掉底部两个占位 tab（训练计划 / 赛训助手，非真实功能）——移除整条底部导航（含 CSS 与占位 toast 逻辑），本页只保留「配速计算」一个功能。
- **关键结论/决定**：
  - **跑力＝丹尼尔斯 VDOT，用公式不用查表**——这样任意「距离 + 用时」都能即时算并反解各标准距离（与既有 `tools/pace.py` 查表版**口径同源、互为独立实现**）。
  - **五区配速＝vVO₂max 固定百分比**；**赛事预测＝保持同 VDOT 二分反解**。
  - **版本号递增**：本功能落地时仓库 RPD 已是 v0.38（被「官网数据来源」占用），故本功能记为 **v0.39**。
- **产出物（文件/链接）**：
  - 代码：`web/pace-calc.html`（新）、`web/pace-calc.js`（新）、`web/index.html`（入口）、`tools/deploy_web.sh`（白名单）
  - 文档：`plan/RPD_需求文档.md`（→ **v0.39**，F34 + 新增 §20 + 顶部条目）、`README.md`（功能条目 + 文件树）、`dev/session_log.md`（本条）
- **验证（从简）**：
  - `node --check web/pace-calc.js` 通过（Node 需 `export PATH="/opt/homebrew/bin:$PATH"`）。
  - node 跑纯函数与截图逐项比对：**全马 2:59:20 / 4:15 → 跑力 53.8** ✅；配速区间全部吻合（2:59:20 / 4:15 / 6:50 / 3:24 / 1:42）；赛事预测全部吻合（Half 1:25:57 4:04 6:33、10K 38:50 3:53 6:15、5K 18:44 3:45 6:02）；**半马 1:29:40 / 4:15 → 跑力 51.2** ✅；五区训练参考与截图差 **≤1~2 秒**（边界取整所致）；`415→4:15`、`25920→2:59:20` ✅。
- **待办**：① 用户「看效果」时在浏览器复验视觉还原（尤其距离下拉浮层 / 单位切换 / 步频步幅互算）；② 如需上线，`bash tools/deploy_web.sh` 发布（白名单已含两文件）。
- **风险/注意事项**：数字仅供训练参考、非医疗建议；`pace-calc.js` 为**独立模块**（不引 store.js/ui.js），改 VDOT 系数或五区百分比须与 `tools/pace.py` / `plan` 口径同步；本机 node 默认不在 PATH。

---

### 阶段：丹尼尔斯对话教练 γ 对外版（云函数 coach + 前端双源）— 2026-10-12

- **目标**：把教练从「本机自用」推到**线上可用**——云函数 `coach`（多轮对话 + 平台统一 Key + 按消息计额度）+ 前端双源 + 合规文案。
- **已做**：
  1. **云函数**（新目录 `cloud/functions/coach/`，照 `review` 模板）：
     - `index.js`：JWT 取 uid（网关已验签）→ 先校验消息（最新一条须为 user）→ 查当天额度（`usage_quota`，字段 `coach_count`，与 `review` **共用同一条**记录、按北京时间 0 点重置）→ 读 `profiles`/`activities`/`metrics_daily` 拼上下文 → 调大模型（多轮 `messages[]` + 教练 system）→ **成功后才计数**；返回 `{ok,text,persona,quota,ms}`。
     - `lib/prompt.js`：`COACH_METHODOLOGY` + `COACH_PERSONAS` + 限额常量（与 `serve.py` **逐字一致**）。
     - `lib/context.js`：移植 `review/lib/context.js` 的 `buildContext`，并新增 `buildCoachContext`（补**五区配速**与**今日状态 Readiness**，只注入已算好的数字）。
     - `lib/knowledge.js`：10 张自撰知识卡的**云端内联副本** + `routeKnowledge()`（回看最近 4 条用户消息、关键词命中、最多 2 张 / 2600 字，不引向量库）。
     - `package.json`：仅 `@cloudbase/node-sdk`。
  2. **前端双源**（`web/coach.js`）：拆出 `callLocal()`（本机 `/api/coach`）/ `callCloud()`（`CorosAuth.callFunction('coach', …)`）/ `pickSource()`——已登录走云函数、未登录 / 无 SDK 走本机；成功回显额度 `toast`。
  3. **页面**（`web/coach.html`）：补加载 `lib/cloudbase.full.js` + `auth.js`（在 `coach.js` 之前），使云函数调用可用。
- **关键结论/决定**：
  - **额度口径＝按每条消息计数**（多轮每条各算 1 条），字段 `coach_count` 与复盘 `review_count` 分开、共用同一 `usage_quota` 文档，互不干扰。
  - **云端知识卡为内联副本**（云函数独立部署、读不到本机 `tools/coach_knowledge/*.md`），遵循项目既有「本机↔云端口径镜像、改一处同步另一处」约定（同 `review/lib/context.js` 之于 `serve.py`）。
  - **防提示注入**：前端 `calc` 仅做**长度截断**（1500 字）；系统提示词硬准则保留「非医疗、仅供参考」。
- **产出物（文件/链接）**：
  - 代码：`cloud/functions/coach/index.js`（新）、`cloud/functions/coach/package.json`（新）、`cloud/functions/coach/lib/{prompt,context,knowledge}.js`（新）、`web/coach.js`、`web/coach.html`
  - 文档：`plan/方案_丹尼尔斯对话教练.md`（§5 γ 完成 + §8 γ 交付/验收）、`plan/RPD_需求文档.md`（→ **v0.40**，F33 行 + 阶段二十）、`dev/session_log.md`（本条）
- **验证（从简）**：
  - `node --check` 通过：`coach/index.js` + 3 个 lib + `web/coach.js`。
  - node 单测：`routeKnowledge` 命「我膝盖疼怎么办」→ 注入知识块、「跑全马能量胶怎么吃」→ 注入、「今天天气不错」→ 不注入；`buildCoachContext` 在样例数据下正确输出「五区配速（E/M/T/I400/I1000/R200/R400）+ Today Readiness（label/summary/flags）」。
  - **已上线**：`cloudbaserc.json` 中 `coach` 条目已就绪（handler `index.main` / Nodejs18.15 / 60s / 256MB / 环境变量 4 个含 `LLM_API_KEY`）；`tcb fn deploy coach --force` 部署成功；`tcb fn invoke coach`（无登录态）返回 `{"ok":false,"error":"未登录（拿不到用户身份），请先登录"}`（鉴权逻辑生效）。`bash tools/deploy_web.sh` 发布成功，线上 `/coach.html`、`/coach.js`、`/nutrition.js`、`/auth.js` 均返回 200，且 `/coach.js` 含云函数调用 `callFunction('coach'…)`。
- **待办**：① 用户登录**实聊回归**（连续多轮不失忆、数字与看板一致；伤病分级合理、补给数字清楚；额度 toast 正确）；② 本机 β 与线上 γ 各验一次。
- **风险/注意事项**：`coach` 云函数依赖集合 `profiles`/`activities`/`metrics_daily`/`usage_quota`（阶段 C/D 已建）；云端 `profiles` 已含 `fitness.paces` 与 `readiness`（`coros-sync` 写入），故上下文可用；知识卡为**两处副本**（`tools/*.md` 与 `cloud/.../lib/knowledge.js`），新增/改卡须同步；本机未配置托管 Key 时只能验到接口层，真实输出需配 Key 后实聊。

---

### 阶段：AI Key 改为「用户自填 + 加密托管」（线上/本机统一，兼容国内平台）— 2026-10-13

- **目标**：按用户明确要求——"AI 的 Key **不是平台统一提供**，而是**用户自行填入**，要**兼容主流国内 AI 平台**"；并回应其担忧"不填会不会用平台 DeepSeek、消耗我的 token"。参考「微信悦读」的**加密托管**范式落地。
- **已做**：
  1. **云函数 `account`**：新增 `keyGet / keySave / keyClear / keyTest` 四个动作 + `user_llm` 集合；`encryptSecret`/`decryptSecret`（AES-256-GCM，外壳 `v1:iv:tag:ct`，密钥由 `KEY_SECRET` 经 SHA-256 派生）、`maskKey`（头4尾4）、`cleanBaseUrl`、`testLLM`；`KEY_SECRET` 未配置时明确报错；`delete` 一并删 `user_llm`。
  2. **云函数 `review` / `coach`**：新增 `lib/userllm.js`（与 account 同口径解密、`loadUserLlm`）；`index.js` 加 `PLATFORM_ENABLED`（`PLATFORM_LLM_ENABLED==='true'`，**默认 false**），改 `callLLM(..., cfg)` 接收 `{base,key,model}`，主流程**三分支取 Key**：用户托管 Key → 平台兜底（仅启用时）→ 否则返回 `code:'ai_nokey'`；**额度仅平台模式**查/记。
  3. **前端账户页**：`account.html` 标题改「AI 复盘 Key · 自行填写 · 加密托管」+ 折叠引导 `<details class="key-guide">`；`account.js` 重写为**线上/本机统一**逻辑（`LOCAL` 判定切后端；预设 **6 家国产大模型 + 自定义端点**，**DeepSeek 首推且默认选中**）；**地址与模型自动配置、默认只读锁定**（`readOnly` + `.locked`），用户**只选平台 + 填 Key**，仅「自定义端点」解锁手填；`style.css` 加 `.key-guide` / `.auto-tag` / `.locked` 样式。
  4. **前端引导**：`app.js` 的 `bindAI` 加 `renderNoKey()`；`coach.js` 的 `callCloud` 标 `err.aiNoKey` + 新增 `noKeyMsg()`；两处未配 Key → 「去配置 Key」并跳 `account.html`。
  5. **配置**：`cloudbaserc.json` 三函数加 `KEY_SECRET`（同值）、`PLATFORM_LLM_ENABLED=false`，**移除**原本硬编码的 `LLM_API_KEY`。
  6. **文案/合规/文档**：`privacy.html`（§1 加"AI 大模型 Key（由你自行填写）"、§5 改"你自己配置的服务商 + 你自填的 Key"、更新日期）；`landing.html`（首屏注记 + 三步开始第 3 步）；`test/前端卡片复验清单.md`（2.5 组改写）；`RPD_需求文档.md`（→ **v0.47**，F15 + 阶段 D 补充 + 新增 **§23**）；`README.md`（线上 AI 段 + 开启复线段）。
- **关键结论/决定**：
  - **Key 优先级**：用户自填优先（不计额度）→ 平台兜底**默认关闭**（启用才计额度）→ 都没有则 `ai_nokey` 引导配置。**"不填就没有 Key"，绝不默默消耗平台 token**（直接回应用户顾虑）。
  - **加密口径**：与「微信悦读」一致（应用层加密、只回掩码、明文只在内存）；云端用 AES-256-GCM，`KEY_SECRET` 三个云函数须一致且**设定后勿改**。
  - **两套后端同界面**：`LOCAL` 判定（localhost/127.0.0.1）→ 本机 `/api/account`；线上 → 云函数 `account`。
- **产出物（文件/链接）**：
  - 云端：`cloud/functions/account/index.js`、`cloud/functions/review/index.js` + `lib/userllm.js`、`cloud/functions/coach/index.js` + `lib/userllm.js`
  - 前端：`web/account.html`、`web/account.js`、`web/style.css`、`web/app.js`、`web/coach.js`、`web/landing.html`、`web/privacy.html`
  - 配置/文档：`cloudbaserc.json`、`plan/RPD_需求文档.md`（v0.47 + §23）、`README.md`、`test/前端卡片复验清单.md`、`dev/session_log.md`（本条）
- **验证（从简）**：`node --check` 过三处云函数 `index.js` + 两个 `lib/userllm.js`；静态核对前端调用名（本机 `test`、线上 `keyTest`）与 serve.py 已支持的动作（`keySave/keyClear/test`）一致；`cloudbaserc.json` 语法有效且已无明文平台 Key。
- **待办**：① 部署（`account`/`review`/`coach`）+ 建 `user_llm` 集合 + 配 `KEY_SECRET`；② `bash tools/deploy_web.sh` 重发前端；③ **本人登录线上复验**（自填→保存→掩码、测试连接、未配 Key 的"去配置"引导）。
- **风险/注意事项**：`KEY_SECRET` **一旦设定不要再改**（改了已托管 Key 无法解密）；`user_llm` 集合线上首建可能需手动确认权限；平台 `LLM_API_KEY` 只进控制台/本机 `cloudbaserc.json`（gitignored），**不入库**。

### 阶段：看板加「官网」入口 + 整页垂直居中 — 2026-10-13

- **目标**：用户贴两张看板截图，要求 ① 看板顶栏**也要加「官网」跳转入口**；② 看板**整页在视口中垂直居中**（经 AskUserQuestion 确认为「整页垂直居中」，入口放「顶部按钮行」）。
- **已做**：
  1. `web/index.html` 顶栏 `hero-side` 在「知识库」后新增 `🌐 官网` 按钮（`href="landing.html"`，标题「官网介绍页（产品介绍 / 数据来源 / H5 说明）」）。
  2. `web/index.html` 的 `<body>` 加类 `page-home`；`web/style.css` 新增 `body.page-home{display:flex;flex-direction:column;min-height:100vh}` + `body.page-home .wrap{width:100%;margin:auto}`。
- **关键结论/决定**：
  - 垂直居中用 **`margin:auto` 而非 `justify-content:center`**——内容不足一屏时居中，**超过一屏时自动退回顶部、正常滚动**（`justify-content:center` 会把长内容顶部裁掉）。
  - **仅作用于看板主页**（`body.page-home`）——其他页 body 无此类，`style.css` 各页共用也不受影响。
- **产出物（文件/链接）**：`web/index.html`、`web/style.css`（改）；文档回灌 `plan/RPD_需求文档.md`（→ **v0.48**）。
- **验证（从简）**：静态核对改动；完整视觉需登录后在看板页查看（首页未登录会转 `landing.html`，本机同样如此）。
- **待办**：随前端一并 `bash tools/deploy_web.sh` 发布（本次改动含在部署白名单 `index.html` / `style.css` 内）。
- **风险/注意事项**：若用户本意是「短内容页居中」，本改动即生效；长看板页视觉不变（无横竖留白时本就顶对齐）。

### 阶段：新增「比赛」模块 + 自动识别 + 修复云端只同步 200 条导致「14 vs 8」 — 2026-10-13

- **目标**：给看板加「比赛」模块——① 能标记某次跑步为比赛；② 有专门区域集中展示（倒计时 + PB + 专项分析）；③ 结合跑步人关注的比赛参数（先联网调研）。用户进一步要求：**系统要能自动判断哪些是比赛**，不能全靠手选。最后用户质疑「你识别出 14 场，我在线上只看到 8 场」，要求解释并修复。
- **已做**：
  1. **服务端**：`web/serve.py` 新增 `GET/POST /api/races`（按账户码存本机 `web/data/races.json`），白名单清洗 + 去重限 500 条，`races.json` 列入敏感文件拦截。
  2. **前端结构**：`web/index.html` 顶栏加「比赛」页签 + `#raceCard` 卡片区 + 两个表头按钮（`#raceMarkBtn`「🏁 标记比赛」、`#raceAddBtn`「＋ 计划比赛」）。
  3. **前端逻辑**：`web/app.js` 比赛模块（标记 / 计划倒计时 / 专项分析：正负分割·半程比值 R·匀速·撞墙·配速波动 CV·心率漂移 / 编辑 / PB 表）。**自动识别**：`raceBaseline()`（配速中位数 + 距离 90/95 分位基线）→ `detectRaces()`（按「标准距离 + 快于日常 + 超长距离 + 周末」打分 ≥50 判疑似比赛），`openMarkRace()` 弹窗分「系统识别到 N 场疑似比赛」「全部跑步记录」两段，含「一键标记」。
  4. **样式**：`web/style.css` 追加 `.race-*` / `.ra-*` / `.pb-*`（含浅色主题与手机端）。
  5. **修 bug**：`半程比值 R` 文案判断反了 → 改为 `s.neg ? "（>1，后半程更快）" : "（<1，前半程更快）"`。
  6. **修复「14 vs 8」根因**：云端 `coros-sync` 原先单次 `limit: 200` 拉活动（`querySportRecords` 无 offset 分页），只会拿到最近 200 条 → 正好 8 场；本机 `dashboard.json` 296 条 → 14 场。把 `cloud/functions/coros-sync/index.js` 改为**按 60 天窗口分片 + `labelId` 去重 + 按日期倒序**（与 `tools/source_coros.py` 同法）；`cloudbaserc.json` 补 `coros-sync` 条目并把超时 **60s→300s**（保留线上环境变量），`tcb fn deploy coros-sync --force` 部署成功。
- **关键结论/决定**：
  - **比赛识别口径**：不依赖手选，用「标准距离权重 + 相对平时配速 + 距离分位 + 周末」启发式打分，≥50 判疑似；基线随数据量浮动，边界条目会一进一出（这正是 14/8 差异的另一半原因）。
  - **200 上限是真坑**：高驰 `querySportRecords` 单次上限 200、无分页——本机早已用分片解决，云端一直没同步该口径。**云函数抓历史必须分片**。
  - **云端拉全历史**（用户选择）：730 天按 60 天切片，节流 250ms/片；分片后调用变多，超时须调大（300s）。
- **产出物（文件/链接）**：`web/serve.py`、`web/index.html`、`web/app.js`、`web/style.css`、`cloud/functions/coros-sync/index.js`、`cloudbaserc.json`；文档回灌 `plan/RPD_需求文档.md`（F36 + §22，含 §22.6 自动识别）+ `README.md`。
- **验证（从简）**：
  - 本机浏览器实测（标记 / 计划倒计时 / 分析面板有·无分段 / PB 表 / 自动识别 / 一键标记），控制台零 JS 报错；本机 296 条识别 **14 场**（全为 21.0–21.4km 周日半马）。
  - 线上**重跑同步核验**：`tcb fn invoke coros-sync`（按 uid）→ 日志返回 `{"activities":296,"ms":64896,"errors":[]}`（此前为 `"activities":200`）；`cloud/functions/dashboard/index.js` 的 `fetchAll` 按 1000/页 `skip` 分页拉全，无二次截断。
- **待办**：本人**登录线上**复验比赛模块与「识别到 14 场」（数据侧已就绪，前端识别在浏览器内运行）。
- **风险/注意事项**：云端 `coros-sync` 超时已设 300s（实测分片抓全约 65s）；单次触发即可，勿频繁重跑以免被高驰限流。

### 阶段：修「显示/隐藏」按钮失效 + 支持按需查看完整 Key，并发布上线 — 2026-10-13

- **目标**：账户页 AI Key 的「显示/隐藏」按钮点了没反应（用户截图）。修复，并让「显示」真能看完整 Key；随后把改动**发布上线**（用户口令「1+2」＝①发布 ②改成能看完整 Key）。
- **已做**：
  1. **根因定位**：输入框 `value` 始终为空，`sk-3****260c` 是写在 **`placeholder`** 上；placeholder 在 `password`/`text` 两种 type 下显示一模一样 → 点按钮视觉无变化，看起来「坏了」。
  2. **方案**：点「显示」时按需向服务端取一次本人明文（新增动作 `keyReveal`）。
  3. **本机后端**：`web/serve.py` 加 `keyReveal` 路由 + `api_key_reveal()`（只回本机账户自己的明文）。
  4. **云函数**：`cloud/functions/account/index.js` 加 `keyReveal` 动作（按 uid 回一次本人明文）；文件头注释同步（动作清单 + 安全口径）。
  5. **前端**：`web/account.js` 重写按钮逻辑（调 `keyReveal` 取明文，点「隐藏」即清空回掩码）；`account.html` 按钮初始 `disabled`；`style.css` 补 `#toggleKey:disabled{cursor:not-allowed}`。
  6. **文档回灌**：`web/privacy.html`、`README.md`、`plan/RPD_需求文档.md`（4 处）、`test/前端卡片复验清单.md`（2.5.1）同步为「平时只显示掩码，点『显示』才按 uid 回一次本人明文」。
- **关键结论/决定**：
  - **placeholder 不是 value**：用 placeholder 承载掩码时，切换 `type` 不会有任何视觉变化——这是按钮「失效」的直接原因。
  - **按需取明文（`keyReveal`）**：破掉原先「明文不下发前端」的绝对约束，但收窄为「仅用户主动点『显示』时、仅按本人 uid、回一次、不常驻页面、不写日志」，并同步隐私政策口径。
- **产出物（文件/链接）**：`web/serve.py`、`cloud/functions/account/index.js`、`web/account.js`、`web/account.html`、`web/style.css`、`web/privacy.html`、`README.md`、`plan/RPD_需求文档.md`、`test/前端卡片复验清单.md`。
- **验证（从简）**：
  - 本机（换端口 `PORT=8931` 避开占用）实测：`keySave` → `keyGet` 仅回掩码 `sk-TES……cdef` → `keyReveal` 回完整明文；测完 `keyClear` 清理测试数据。语法：`python3 -m py_compile web/serve.py`、`node --check` 均过。
  - 发布：`bash tools/deploy_web.sh`（30 文件）+ `tcb fn deploy account --force` 均成功。
  - 线上复验：`account.js?cb=` 含 `keyReveal`（2 处）、`account.html?cb=` 按钮 `disabled`、两页均 200。
- **待办**：本人**登录线上**点「显示」复验完整 Key（前端与云函数均已就绪）。
- **风险/注意事项**：`keyReveal` 会回一次明文，属「本人可对自己查看」的口径；`KEY_SECRET` 一旦设定不可更改（否则已托管 Key 无法解密）。

### 阶段：账户页显示「用户名」与「高驰用户资料」并发布上线 — 2026-10-13

- **目标**：用户要求"这里显示出用户名，以及高驰里面的用户（登录之后）"——账户页当前只显示邮箱 `2195542745@qq.com`，需显示**自定义用户名**与**高驰账号资料**。
- **已做**：
  1. **取用户名**：`web/auth.js` 的 `sdkCurrent()` 增补返回 `username`（CloudBase 登录态 user 本就带 `username` 字段，此前只映射了 uid/email/name）。
  2. **账户页展示**：`web/account.html` 内联脚本——`renderState()` 登录态行优先显示**自定义用户名**（与邮箱不同时附显邮箱小字，否则只显邮箱）；`renderBindStatus()` 在「已绑定」下方追加一行 **「高驰用户：昵称 · 身高 · 体重 · 性别 · 年龄」**，无资料时提示先「同步高驰数据」。新增本地 `esc()` 转义。
  3. **取高驰资料**：云函数 `cloud/functions/account/index.js` 的 `status` 动作顺带回一次 `profiles.profile`（高驰 `queryUserInfo` 解析结果 `nickname/heightCm/weightKg/gender/birthday/age`；未同步过为 `null`，异常静默不报错）；文件头注释同步。
- **关键结论/决定**：
  - **用户名来源是登录态**（`username`），**高驰资料在云端集合**（`profiles.profile`）——故由 `account.status` 一并返回，避免为展示新增接口。
- **产出物（文件/链接）**：`web/auth.js`、`web/account.html`、`cloud/functions/account/index.js`、`plan/RPD_需求文档.md`（v0.49）。
- **验证（从简）**：`node --check` 过 `web/auth.js` + `cloud/functions/account/index.js`；抽取 `account.html` 内联脚本过 `node --check`；发布后线上 `curl` 复验 `account.html` 含 `fmtCorosProfile`（2 处）、`auth.js` 含 `username: u.username`（1 处）。
- **待办**：本人**登录线上**hard-refresh 账户页，确认显示用户名与高驰资料（若高驰资料为空，先点一次「同步高驰数据」）。
- **风险/注意事项**：高驰资料仅在有 `profiles` 记录（同步过）后才有；用户名若当初未成功写入，会回退显示邮箱。

### 阶段：修看板图表「错乱」（同行卡片显隐后宽度没重算）— 2026-10-13

- **目标**：用户反馈看板「训练负荷」与「强度分布」两张卡片图例/坐标轴错位重叠（"改一下这里的样式，有点错乱了"）。
- **根因**：`renderCharts()` 里各卡片按序渲染时会「显隐」卡片（如 `renderIntensity` 把「强度分布」由 `hidden` 变可见），使同一行的「训练负荷」由**整宽变半宽**；ECharts 只在 `init` 时量一次容器宽度，卡片宽度随后变化**不会自动跟随** → 画布仍按旧（整宽）尺寸绘制并溢出到相邻卡片，两图图例在中间重叠。
- **修法**：`web/app.js` 的 `renderCharts()` 末尾对全部图表补一次 `charts.forEach(c=>c.resize())`，按最终布局重算尺寸。
- **产出物（文件/链接）**：`web/app.js`、`plan/RPD_需求文档.md`（v0.51）。
- **验证（从简）**：`node --check web/app.js` 通过；`bash tools/deploy_web.sh` 发布成功；线上 `curl` 复验 `app.js` 含该 resize 注释行。
- **待办**：本人**hard-refresh 线上看板**，确认两图不再重叠。
- **风险/注意事项**：若后续新增「会显隐的卡片」，统一在 `renderCharts()` 末尾重算即可覆盖；`bindTheme` 热重绘路径卡片显隐已稳定、无需额外 resize。

### 阶段：对外版云端「AI Key 加密托管」部署核验（补齐交付）— 2026-10-13

- **目标**：用户要求「直接开始补齐」对外版未完成项（此前记录：`account`/`review`/`coach` 线上待部署、`user_llm` 待建、前端待重发、线上待复验）。
- **已做 / 核查**：
  1. 重新 `tcb login`（设备码授权）→ `tcb fn list`：8 个云函数均「部署完成」。
  2. **下载线上代码核验**（`tcb fn code download`）：`account` 含 `keyReveal/keySave/keyTest/keyGet/keyClear/user_llm`；`review`/`coach` 均含 `loadUserLlm`、`user_llm`、`ai_nokey`、`PLATFORM_LLM_ENABLED`，`coach` 另含 `coach_count` → **线上跑的就是 v0.47+ 新代码**。
  3. `tcb fn detail` 核对环境变量：`ac存/review/coach` 的 `KEY_SECRET` **三者完全一致**（sha256 前 12 位相同），`PLATFORM_LLM_ENABLED=false`，**无残留 `LLM_API_KEY`**。
  4. `tcb db nosql execute --listCollections`：**`user_llm` 集合已存在**（另有 activities/coros_app/coros_links/coros_oauth_state/metrics_daily/profiles/usage_quota 等）。
  5. 线上前端 `curl` 核验：`account.js` 含全部 Key 动作（含 `keyReveal`）、`coach.js` 走 `callFunction('coach')` → 前端也是最新。
- **关键结论/决定**：**「线上待部署复验」的旧记录已不成立**——代码、环境变量、集合、前端四处均已就绪，无需再部署。剩下的是**需要本人登录**的交互复验。
- **产出物（文件/链接）**：`plan/RPD_需求文档.md`（→ **v0.52**：D3/D4、§23、阶段二十状态改为「已部署并核验」）；本条 session_log。未改业务代码。
- **验证（从简）**：见「已做/核查」1–5；均为线上只读核验，未触碰用户数据、未打印任何密钥（仅比较哈希/长度）。
- **待办**：① 本人登录线上：账户页填 Key → 保存 → 看掩码 → 点「显示」→ 「测试连接」；② 工作台教练连续多轮实聊；③ 双账号隔离实测（换账号看不到彼此数据）。
- **风险/注意事项**：`tcb fn detail` 会明文显示环境变量，**勿外发截图**；本轮所有密钥只做了哈希/长度比对；`KEY_SECRET` 设定后不可更改。

### 阶段：佳明（Garmin 中国区）数据全面接入本机看板 — 2026-11-02

- **目标**：把佳明账号数据接入现有看板（原只接高驰），支持中国区登录、抓取跑步记录/详情/每日指标，并在看板内与高驰双数据源切换，落地佳明独有维度（身体电量、真 ACWR）。
- **已做**：
  1. **本机凭据**：`tools/garmin_credential.py`（getpass 录入）→ `.garmin_secret.json`（600 权限、已在 `.gitignore`），密码不进代码库、不进日志。
  2. **虚拟环境**：`.venv-garmin/`（Python 3.12，`garminconnect==0.2.40` + `garth==0.6.3`，清华镜像安装）。**国区必须锁 0.2.x**，0.3.x 的 DI token 在国区失败。
  3. **登录链路（本轮最大卡点）**：国区 `sso.garmin.cn` 已切**新版 SSO 门户**（Vue SPA），旧库 `/sso/embed` 一律 401。新增 `_portal_login_cn()`：`/portal/api/checkLogin` → `/portal/api/login`（`clientId=GarminConnect`）拿 `serviceTicketId` → 用门户返回的 `serviceURL`（**恒为 `https://connect.garmin.cn/modern/`**）作 `login-url` 走旧 `oauth-service/oauth/preauthorized` 换 OAuth1 → `exchange/user/2.0` 换 OAuth2，令牌落盘 `.garmin_tokens/`；二次运行直接复用令牌免登录（已验证）。
  4. **字段校准（全部按实测）**：VO2max 取 `get_training_status().mostRecentVO2Max.generic.vo2MaxPreciseValue`（国区 `get_max_metrics` 返回 `[]`）；ACWR 取 `acuteTrainingLoadDTO.dailyAcuteChronicWorkloadRatio`（另有 `acwrStatus`）；详情改读 `get_activity().summaryDTO`（`get_activity_splits` 缺整体值）；阈值配速取 `get_lactate_threshold().speed`，国区实测缩小 10 倍（`<1` 时 ×10 → 4:29/km）；体重克转 kg；新增 `map_devices()`。
  5. **看板双源切换**：`web/app.js` 新增 `pickedSource()`（`?source=garmin` 优先，其次 `localStorage['coros.dataSource']`），两品牌各读各的 JSON（`dashboard.json` / `dashboard.garmin.json`）互不混用；页脚显示来源 + 一键「切换数据源」；`serve.py` 的 `/api/review`、`/api/coach` 按 `source` 分流文件与提示词；`coach.js` 同步按源取数。
  6. **佳明独有维度**：身体电量并入今日状态灯（`readiness.py` 新增 `body_battery_peak` 参数，**用当日峰值 high** 判恢复，阈值 40；日间最低几乎人人耗到底，不能当红旗），状态条追加「身体电量 low~high」；负荷图 tooltip 标注 `Garmin ACWR` 与 `acwrStatus`。
  7. **文档回灌**：README 新增「佳明（Garmin，本机自用 · 已实测跑通）」整段；RPD F25–F28 状态改 ✅、§16.6 步 2/3/4 标 ✅ 并补「进展」段。
- **关键结论/决定**：
  - **不复用旧库登录**，改用「新版门户 ticket + 旧 preauthorized + exchange/user/2.0」合成标准 OAuth2，绕开国区 `/modern/di-oauth/exchange/` 恒 409 的死路。
  - `login-url` 必须与 ticket 的 service **完全一致**，否则 `ticket 'ST-...' does not match supplied service`。
  - 身体电量口径定为**当日峰值**（看恢复），不用日间最低。
  - 佳明抓数脚本是本项目**零第三方依赖的唯一破例**，且仅限本机脚本，不进对外版后端。
- **产出物（文件/链接）**：`tools/source_garmin.py`、`tools/readiness.py`、`web/serve.py`、`web/app.js`、`web/coach.js`、`web/index.html`、`README.md`、`plan/RPD_需求文档.md`、`web/data/dashboard.garmin.json`（本机产物，不入库）。
- **验证（从简）**：实跑 `GARMIN_REGION=cn .venv-garmin/bin/python tools/source_garmin.py --days 90 --details 8` → **42 条跑步记录 / 8 条详情 / 31 天每日指标 / Forerunner 265**；`node --check web/app.js`、`node --check web/coach.js`、`py_compile` 全过；`python3 tools/readiness.py` 四用例正常；`PORT=8921 python3 web/serve.py` 起服，`index=200`、`data/dashboard.garmin.json=200`，`/api/review` 带 `source=garmin` 正确进入 LLM 环节（本机未配 Key 故返回提示）。
- **待办**：① 本人目视确认 `http://127.0.0.1:8921/?source=garmin` 渲染（KPI/五区/负荷/状态灯/活动详情弹窗）；② 本机配 AI Key 后实测佳明版中文复盘。
- **风险/注意事项**：佳明令牌与 `dashboard.garmin.json` 只存本机、均在 `.gitignore`；脚本非官方库，接口字段可能随佳明改版变动，出问题先跑 `--dump-raw` 复核字段。



### 阶段：多品牌统一（登录后二选一）评估 + 批次 1/2/3 落地 — 2026-11-03

- **目标**：用户要求「登录后二选一（佳明 / 高驰）+ 评估两品牌功能模块是否一致 + 合到一起 + 全面分析现存问题」。用户选定：线上佳明入口「先引导/占位」，本轮范围「全做（1 修错 + 2 对齐 + 3 合并骨架）」。
- **已做**：
  1. **全面评估（文档）**：RPD 新增 §16.8 —— 线上接佳明三条路（官方 Personal 只能覆盖开发者本人 / Business Starter 需组织申请且 Push-only / 非官方库不能替他人授权）→ 结论「线上不能存用户佳明密码」；13 行功能模块一致性矩阵；10 条缺陷清单（P0×2 / P1×5 / P2×3）；契约 v2 方案；5 批施工顺序。
  2. **P0-1 分段距离单位归一**：契约定为「分段距离一律厘米」（高驰原生厘米、100000=1km；佳明 `lapDTOs.distance` 是米 → 适配器 ×100）。展示层只做一次 cm→km：`app.js` 新增 `fmtDistCm()`、`serve.py` 新增 `_dist_cm()`。修复前高驰分段显示 100.00km、佳明分析缩小 100 倍。
  3. **P0-2 线上无效切源**：`app.js` 切源按钮改为 `isLocalHost() && DATA_SOURCE !== "cloud"` 才显示（云端只有一份数据，切换无意义 → 直接隐藏）。
  4. **P1 状态灯口径**：`readiness.py` 支持厂商准备度（`vendor_score/vendor_level/vendor_name`），POOR/LOW 记红旗；摘要改为「用到哪些写哪些」。实测佳明当日 25 分 LOW → 状态灯「注意」，摘要「HRV +3% · 静息心率 -3bpm · 睡眠分 79 · 身体电量峰值 70 · 佳明准备度 低（25 分）」。
  5. **P1 负荷历史**：`map_training_load()` 改为逐日拉取（`_acute_dto()` 抽 device 下的 `acuteTrainingLoadDTO`），实测补到 29 天 ACWR（0.40→1.00 OPTIMAL），负荷图不再是单点。
  6. **P1 跑力值降级**：佳明无跑力值 → `renderHero` 用 VDOT 推算值顶上并标注「跑力 VDOT」，不假装是厂商跑力值。
  7. **P1 比赛隔离**：`scopedRaces()` + 写入 `provider`，老记录无 provider 视为 coros；两品牌比赛不串台。
  8. **P1 健康字段归一**：`map_daily_health` 统一 Steps/Calories/Exercise 为字符串（`"8231"` / `"612 kcal"` / `"48 min"`）。
  9. **契约 v2 / 合并骨架**：两个适配器同时输出 `schemaVersion:2` + `capabilities`（recoveryPct/recoveryLevel/estFullHours/runningLevel/loadHistory/loadRatio/acwr/bodyBattery/vendorReadiness/lapsUnit）；前端按「有/没有」降级，不写品牌 if-else。
  10. **本机「选择手表」页**：首次进入（localStorage 无值、URL 无 `?source=`）弹两张卡（高驰 / 佳明），各自显示「已抓取 N 次记录 · 更新于 X」或「本机还没有数据」，选择后写 localStorage 再 reload。
  11. **顺带 P2 修复**：`map_body_battery` 自动截断 30 天窗口（佳明 daily 报表更长会 400）。
- **关键结论/决定**：
  - 「合到一起」= 同一套统一模型 + 能力声明 + 一套前端渲染；品牌差异只体现在数据（有没有）与文案，不在代码分支。
  - 分段距离的唯一真源是「厘米」，任何新数据源接入都必须 ×100 归一。
  - 佳明状态灯不再只靠恢复度（佳明没有恢复度），改用厂商准备度 + HRV/静息心率/睡眠/身体电量四项信号。
  - 线上继续只服务高驰；佳明入口只做引导/占位（官方 API 无法覆盖他人账号）。
- **产出物**：`tools/source_garmin.py`、`tools/source_coros.py`、`tools/readiness.py`、`web/serve.py`、`web/app.js`、`plan/RPD_需求文档.md`（§16.8 + 进展段）、本条 session_log。
- **验证（从简）**：`py_compile` 四个 Python 文件通过；`node --check web/app.js` / `web/coach.js` 通过；`readiness.py` 五用例（含佳明新用例）全过；佳明实跑 42 记录 / 8 详情 / 91 天指标 / 29 天 ACWR / 29 天身体电量；高驰实跑 282 记录且 capabilities 正确；`PORT=8921` 起服，`/`、两份 JSON、`/app.js` 均 200；`build_context` 双品牌分段均输出 1.00km（修复前 100.00km）。
- **待办**：① 本人目视确认选择页与佳明/高驰两块看板；② 下一批：线上 `provider` 数据模型（activities/metrics_daily/profiles/links 加 provider + 云函数过滤 + dashboard 返回 provider）+ 线上选择页；③ 本机佳明改官方 Personal API（免密码）。
- **风险/注意事项**：项目目录仍不是 git 仓库，`.gitignore` 实际未生效；`.garmin_secret.json` 为明文密码（600 权限，勿外发）；佳明接口字段可能随改版变动，出问题先跑 `--dump-raw`。

### 阶段：批次 4 —— 线上「登录后二选一」+ provider 数据模型（已部署）— 2026-11-03

- **目标**：把「登录后二选一（佳明 / 高驰）」落到线上；线上佳明按既定方案「引导 / 占位」，不做真接入。
- **已做**：
  1. **云函数 `dashboard`**：新增入参 `provider`（默认 `coros`）；profiles / activities / metrics_daily 统一按 `(row.provider || 'coros')` 过滤（老数据无字段按 coros，历史不受影响）；返回新增 `schemaVersion: 2` / `provider` / `capabilities`（与本机两个适配器同一套能力声明）。
  2. **佳明线上入口 = 引导**：`provider=garmin` 返回 `{ok:false, code:"PROVIDER_UNSUPPORTED"}` + 人话原因，不返回空数据。
  3. **前端**：登录后若无品牌选择 → 弹「选择你的手表」（高驰卡先探云端真实状态：已同步 N 次记录 / 尚无数据；佳明卡标「线上暂不支持」）；选佳明 → 原因页（官方接口只能读开发者本人、不代存密码）+「改用高驰」；选择存 `localStorage['coros.dataProvider']`，支持 `?provider=coros|garmin`。本机预览未选品牌仍走本机文件（不误弹线上选择页）。
  4. **`coros-sync`**：写入 activities / metrics_daily 时补 `provider: 'coros'`（代码已改，**未部署**，见下）。
- **关键结论/决定**：
  - 线上只用「provider 过滤 + 能力声明」，不在前端写品牌分支；老数据零迁移。
  - `coros-sync` 暂不部署：`cloudbaserc.json` 只剩 `ps-login`，默认配置部署可能覆盖该函数的 `COROS_TOKEN_KEY` / `COROS_REGION` 环境变量；等发版时在控制台核对后再部署（不部署也不影响，老数据按 coros 处理）。
  - 真要做线上佳明，集合 `_id` 必须带 provider（`uid_provider_labelId` / `uid_provider_date` / `uid_provider`），否则两品牌互相覆盖。
- **产出物**：`cloud/functions/dashboard/index.js`、`cloud/functions/coros-sync/index.js`、`web/app.js`、`plan/RPD_需求文档.md`（§16.8 追加批次 4 进展）、本条 session_log。
- **验证（从简）**：`node --check` 三个文件通过；`tcb fn deploy dashboard --force` 成功；`tcb fn invoke` 自测 —— `provider=garmin` → `PROVIDER_UNSUPPORTED`，`provider=coros`（假 uid）→「云端暂无你的数据」；`bash tools/deploy_web.sh` 发布成功，线上 `https://run.chesterlee.cn/app.js` 已含 `coros.dataProvider`，首页 200。
- **待办**：① 本人线上登录后确认「选择手表」弹窗（无痕窗口可复现首次状态）；② 发版时部署 `coros-sync` 并在控制台核对两个环境变量；③ 本机佳明改官方 Personal API（免密码）。
- **风险/注意事项**：线上首次进入会多一次选择（每个浏览器一次）；若云端 `dashboard` 报错，本机仍会回退本地数据；佳明选择后每次都会看到原因页（故意的，不给假数据）。

### 阶段：「二选一」升级为「接入设备」（可同时接入高驰 + 佳明）— 2026-11-03

- **目标**：用户同时拥有高驰和佳明（原话：「我刚选了高驰，但我还有同时佳明」）→ 需要多设备接入，而不是排他式二选一。
- **已做**：
  1. `web/index.html` 页脚新增「接入设备」（`#devicesLink`，紧跟数据更新时间）。
  2. `web/app.js` 新增 `renderDevices()`：弹「接入设备」面板，两张设备卡 —— 本机读两份 JSON 显示真实状态（`已接入 · N 次记录 · 更新于 X` / `还没有数据：运行对应抓取命令`）；云端显示高驰已同步条数、佳明「线上暂不支持 · 本机可接入」。点「显示」切换当前品牌（本机写 `coros.dataSource`，云端写 `coros.dataProvider`，然后刷新），无数据的按钮禁用。
  3. 首次「选择手表」文案改为「两个品牌可以同时接入……先选一个显示，之后页脚『接入设备』随时切换」。
  4. 本机免登录：`127.0.0.1 / localhost` 未登录时直接读本机 JSON（此前被踢到官网 `landing.html`，本机等于看不了自己的数据）；线上仍强制登录。
- **关键结论/决定**：设备接入 ≠ 显示切换 —— 接入状态按「实际有没有数据」如实展示，切换只改当前显示品牌，不影响另一台数据。
- **产出物**：`web/index.html`、`web/app.js`、`plan/RPD_需求文档.md`（§16.8 追加「接入设备」进展）、本条 session_log。
- **验证（从简）**：`node --check web/app.js` 通过；`deploy_web.sh` 发布成功（线上 `/index.html` 含 `devicesLink`）；本机标签页已刷新到新版本。
- **待办**：本人点页脚「接入设备」目视确认两张卡状态与「显示」切换。
- **风险/注意事项**：云端佳明仍不可用（官方接口限制），面板里明确写「线上暂不支持」而不是灰着不说原因。

---

## 2026-11-03 会话条目：多语言（简体 / English / 繁體）（已完成代码，待上线）

- **目标**：用户要求「跑步网站接了高驰和佳明，很多国外用户也在用，同步做英文版和繁体中文版」——简体仍为默认，英文/繁体可切换。
- **已做**：
  1. `web/i18n.js`：零依赖运行时翻译。语言判定 `?lang=` → `localStorage['coros:lang']` → 默认简体中文（不按浏览器语言猜）；`TreeWalker` 遍历文本 + `title/placeholder/aria-label/alt`，三级降级「精确词表 → 正则模板 → 原样」；`MutationObserver` 16ms 批处理跟随动态 `innerHTML`；包裹 `echarts.init` 递归翻译 `setOption`；右上角「简 / EN / 繁」胶囊切换。
  2. `web/i18n/en.js`（1368 条英文词表，6 份分片合并 + 冲突 OVERRIDE）与 `web/i18n/zh-hant-data.js`（zhconv zh2Hant+zh2TW，2758 单字 + 4472 词组，最长匹配；只收 BMP 单字避免 UTF-16 错位）。
  3. 10 个 HTML 页在 `</body>` 前按序引入三支脚本；`tools/deploy_web.sh` 白名单加 `i18n.js` 并整体复制 `i18n/`。
  4. AI 跟随语言：`app.js` / `coach.js` 请求带 `lang`；`serve.py` 新增 `system_prompt_for()`，云函数 `review` / `coach` 只替换「回答语言」一句。
- **关键结论/决定**：不改 2100 行业务代码——用运行时翻译解决「动态拼接 + 用户数据 + AI 输出」三类文本；繁体用字符级转换保证 100% 覆盖，英文对未收录文案保留中文（不机翻，避免误译）；备案号与 AI 正文不翻译。
- **产出物**：`web/i18n.js`、`web/i18n/en.js`、`web/i18n/zh-hant-data.js`、10 个 HTML、`web/app.js`、`web/coach.js`、`web/serve.py`、`cloud/functions/review/index.js`、`cloud/functions/coach/index.js`、`tools/deploy_web.sh`、README / Running / RPD v0.56 / 本条日志。
- **验证（从简）**：`node --check` 全通过（i18n.js / app.js / coach.js / 两个云函数）；`python3 -m py_compile web/serve.py` 通过；本机服务 200 返回三支脚本；node 实测词表与简繁转换（`训练数据看板与比赛分析 → 訓練資料看板與比賽分析`，重复转换稳定）。
- **待办**：① 浏览器目视确认中/英/繁三版与切换胶囊；② 补英文未覆盖词条；③ `bash tools/deploy_web.sh` + 重新部署 `review` / `coach` 云函数（须用户确认）。
- **风险/注意事项**：英文词表是「按页面文案抽取」生成的，新增文案需补词条；繁体为字符转换，个别台湾用词（如 周/週）保持中性写法。

---

## 2026-11-03 会话条目：多语言翻译技能 `translate-site` + 英文词表补齐至 100%

- **目标**：用户要求「做成一个 skill 翻译网站，并能记录翻译进度，方便下一步的翻译继续不重复」——把多语言翻译沉淀为可复用技能，核心是进度台账。
- **已做**：
  1. 技能母本 `AI协作规划库/2-技能_Skills/translate-site/`（`SKILL.md` + `scripts/i18n_progress.py`，零第三方依赖），四个子命令 `scan / merge / status / skip`；并复制到本项目 `.trae/skills/translate-site/` 生效。
  2. 台账回灌母本库：`_索引.md`、`_分发清单.md`（升 v1.34）、`README.md` 三处登记（当前仅 coros-run 生效）。
  3. 用该技能跑通本项目：`scan` 出 99 条待译 → 人工填 `plan/i18n/pending.en.tsv` 第二列 → `merge` 写回 `web/i18n/en.js` 并记台账 `done`。
- **关键结论/决定**：判「已译」= 词典键 ∪ 台账 done ∪ 台账 skip，三者都不再进 pending，这是「下次只翻新增、不重复」的机制；繁體是字符转换表（`zh-hant-data.js`），没有「待译条目」概念，故不建 hant 台账。
- **产出物**：`web/i18n/en.js`（1368 → 1477 条）、`plan/i18n/translation-progress.json`、`plan/i18n/pending.en.tsv`、母本与项目两份 `translate-site` 技能、本条日志。
- **验证（从简）**：`node --check web/i18n/en.js` 通过；重扫结果「文案 1432 / 已译 1432 / 待译 0 / 覆盖率 100.0%」。
- **待办**：① 浏览器目视确认中/英/繁三版；② 后续新增文案直接跑 `scan` 只出增量；③ `bash tools/deploy_web.sh` + 重新部署 `review` / `coach` 云函数（须用户确认）。
- **风险/注意事项**：`merge` 只会追加到词典末尾，不覆盖已有词条；词条以「精确整句」匹配，改文案就会重新变成待译（属预期）。

---

## 2026-11-03 会话条目：多语言上线（run.chesterlee.cn）

- **目标**：把多语言版本（简体默认 / EN / 繁）发到线上 `run.chesterlee.cn`。
- **已做**：
  1. `bash tools/deploy_web.sh` → CloudBase 静态托管上传 53 个文件（含 `i18n/` 三支脚本）。
  2. 云函数 `review` / `coach` 用 `tcb fn code update` 更新代码（**只更新代码、不动环境变量**，避免覆盖 `KEY_SECRET`）；此前线上版本没有 `lang` 分支。
  3. 回填部署台账 `部署上线备案/README.md` §六。
- **关键结论/决定**：后端用 `fn code update` 而不是整体 `fn deploy`，因为 `cloudbaserc.json` 里只声明了 `ps-login`，整体部署有覆盖环境变量的风险（与 2026-10-27 `coros-sync` 的教训一致）。
- **产出物**：线上静态站、两个云函数新版本、部署台账 §六一条。
- **验证（从简）**：`curl -H "Cache-Control: no-cache" https://run.chesterlee.cn/i18n/en.js` 已含新词条；云函数重新下载后确认含 `lang` 分支；空参调用返回「未登录（拿不到用户身份）」未崩；`health.sh run.chesterlee.cn` → HTTP 200 / 备案号 ✅ / 证书剩 82 天。
- **待办**：① 浏览器目视确认默认简体 + EN / 繁切换 + 英文 AI 复盘；② ~~页脚「版权/公安」⚠️~~（已同一会话对齐：`index / landing / help` 三页改为 `© 2026 Chester` 超链接 + `theme-v2.css` 补 `.foot-copy a` 样式，重跑 `deploy_web.sh` 后 `health.sh` 全绿）。
- **补记（页脚对齐）**：`web/index.html`、`web/landing.html`、`web/help.html` 三页 `© 2026 跑不快` → `© 2026 <a href="https://chesterlee.cn/">Chester</a>`（品牌名「跑不快」不动）；线上 `/`、`/landing.html`、`/help.html` 复核均含该超链接。
- **风险/注意事项**：CloudBase CDN 可能数分钟内仍返回旧 `en.js`，用无痕或带 `Cache-Control: no-cache` 验证。


### 阶段：安全收尾（纳入 git + 佳明凭据改钥匙串）— 2026-11-03

- **目标**：清掉两条 P2 遗留 —— ① 项目目录不是 git 仓库，`.gitignore` 实际没生效；② 佳明账号密码以明文存在 `.garmin_secret.json`。
- **已做**：
  1. `git init -b main`（**仅初始化，未提交**），`.gitignore` 补齐 `.trae-html-share-packages/`、`*.log`，并注明钥匙串用法。
  2. 实测忽略生效：`.garmin_tokens`、`.coros_token*.json`、`.coros_client*.json`、`web/data/*`（含两份 dashboard、accounts.json、secret.key）、`web/llm_config.json`、`cloudbaserc.json`、`.trae/` 全部被 `git check-ignore` 命中。
  3. 待入库 144 个文件，自查无 token/secret/key 类文件；最大文件为 `web/assets/img/hero-run.jpg`（1.4MB）。
  4. 佳明凭据迁到 macOS 钥匙串（服务 `coros-run-garmin`），`tools/source_garmin.py` 取值顺序改为「环境变量 → 钥匙串 → 明文文件（弃用并提示）」，明文 `.garmin_secret.json` 已删除。
  5. `tools/garmin_credential.py` 重写：getpass 录入 → 写钥匙串 → 自动删除旧明文文件（非 macOS 才退回 600 权限文件）。
- **关键结论/决定**：仓库里只允许出现代码；凭据一律走系统钥匙串或环境变量，明文文件只作为非 macOS 兜底。
- **验证**：`py_compile` 通过；用钥匙串凭据跑 `_portal_login_cn` 成功返回两项令牌（国区）。
- **待办（需用户确认）**：是否做首次提交并推送 GitHub/Gitee（红线：未经确认不 commit）。
