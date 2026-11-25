# Telegram 机器人双向交互设计方案

- **日期**：2026-11-25
- **项目**：`oci-helper-serverless-cf`
- **选定方案**：方案 A — 独立 ESM 模块 [dist/tg-bot.js](file:///j:/abu_workspace/github/oci-helper-serverless-cf/dist/tg-bot.js) + [dist/index.js](file:///j:/abu_workspace/github/oci-helper-serverless-cf/dist/index.js) 极薄挂接 + [SettingsView-w1Y9UJLA.js](file:///j:/abu_workspace/github/oci-helper-serverless-cf/web-dist/assets/SettingsView-w1Y9UJLA.js) 一键注册面板

---

## 1. 意图与背景（Why）

当前项目已支持通过「系统设置」配置的 `notify.tg_bot_token` 与 `notify.tg_chat_id` 进行单向 Telegram 推送（开机成功、换 IP 成功、登录告警、手动测试消息），但日常在手机端收到通知或外出排查时，无法直接在 Telegram 中查看账号/任务状态或执行常用操作，仍需打开浏览器登录 Web 面板。

由于项目本身运行在 Cloudflare Workers 上且 `/api/*` 已由 `run_worker_first` 优先交由 Worker 处理，直接在同一 Worker 内接入 **Telegram Bot Webhook** 即可实现零额外服务器、低延迟、强鉴权的双向运维交互。

---

## 2. 目标、非目标与反目标

### Goals（要做的）
1. **指令入口**：支持 `/start`、`/help`、`/status`、`/cfgs`、`/tasks`（含自动注册 Telegram 指令菜单 `setMyCommands`）。
2. **内联键盘交互**：
   - **OCI 配置**：分页浏览配置列表、查看配置摘要、一键**测活**、进入该配置下的**实例列表**。
   - **实例操作**：查看实例状态/公网 IP/配置规格、一键**开机（START）**、**软关机（SOFTSTOP）**、**软重启（SOFTRESET）**、**一键换公网 IP（IPv4）**。
   - **任务管理**：分 Tab 查看**抢机任务**与**换 IP 任务**，支持一键**暂停 / 恢复**与**立即执行**。
3. **防误触二次确认**：对影响线上运行的写操作（实例关机、实例重启、实例一键换 IP、以及会立刻触发换 IP 的「换 IP 任务立即执行 / 恢复运行」）提供内联按钮二次确认（`确认执行` / `取消`），防止手机端误触。
4. **Web 面板一键管理 Webhook**：在「系统设置 → Telegram 通知」卡片内增加 TG 交互 Webhook 状态显示与**一键开启（注册 Webhook + 同步菜单）/ 关闭（解除 Webhook）**按钮，无需手动执行 `curl`。
5. **强安全与零泄露**：所有 Webhook 请求必须同时通过 `X-Telegram-Bot-Api-Secret-Token` 常量时间校验与 `notify.tg_chat_id` 白名单校验；回复文本中严禁输出私钥、密码、Token 等敏感信息。

### Non-Goals（明确不做）
- **不开放不可逆破坏性操作**：不提供删除 OCI 配置、终止/删除实例、删除任务、修改系统密钥或修改密码指令。
- **不提供复杂表单创建流程**：不在 TG 内做多步会话式新增 OCI 配置、新建抢机任务或编辑安全组规则（这些留在 Web UI）。
- **不改动 `wrangler.toml` / `wrangler.import.toml` / `package.json` / `web-dist/assets/index-DwZEqr4A.js`**，不引入新 npm 依赖或新 D1 数据表。
- **不替代现有单向推送逻辑**：保持 `notifyLaunchSuccess`、`notifyIpChanged`、`notifyLogin` 行为不变。

### Anti-Goals（绝对不能出现的问题）
- **Webhook 重试风暴**：长耗时 OCI 操作（测活、拉实例列表、换 IP 动辄 5–20 秒）不得阻塞 Webhook HTTP 响应导致 Telegram 判定超时反复重发同一 `update_id`。
- **陌生人越权操控**：未配置 `tg_bot_token` / `tg_chat_id` 或 Webhook 未开启时拒绝执行；任何非白名单 `chat_id` 或缺失/错误 `Secret Token` 的请求不得触发任何业务操作。
- **64 字节 `callback_data` 溢出**：OCI 实例 OCID 约 85 字节，直接塞入 `callback_data` 会导致 Telegram API 返回 `400 BUTTON_DATA_INVALID`。
- **破坏既有 87 个 API 或前端打包契约**：不得改变现有 `/api/*` 的认证规则、响应格式或导出签名。

---

## 3. 架构方案对比与选型

| 方案 | 做法 | 权衡与结论 |
| :--- | :--- | :--- |
| **方案 A（已选定）** | 新增独立 ESM 模块 `dist/tg-bot.js`，仅在 `dist/index.js` 做 ~10 行极薄挂接（放行 `/api/tg/webhook` + 传入内部 `deps`），复用现有 `/api/*` | **`wrangler.toml` / `wrangler.import.toml` 零改动**；零重复实现加解密/OCI 逻辑；独立模块易读易测（`node --test`）。代价是 `dist/index.js` 有 ~10 行固定挂接点。 |
| 方案 B | 保持 `dist/index.js` 逐字节不动，新增 `dist/worker.js` 作为入口并修改两份 `wrangler*.toml` 的 `main` | 需改部署入口配置，且外层必须重复抄写一套与内部完全一致的 `KEY_SECRET` 解密与 HMAC Token 签发逻辑，维护脆弱。 |
| 方案 C | 单独部署一个 Cloudflare Worker 或常驻轮询 Bot | 额外引入第二套 Worker、D1 绑定与密钥同步，违背单 Worker 零运维定位，直接淘汰。 |

---

## 4. 系统设计与核心机制

### 4.1 文件改动边界

| 文件 | 变更性质 | 职责 |
| :--- | :--- | :--- |
| `dist/tg-bot.js` | **新增**（独立 ESM） | Telegram Webhook 鉴权、去重、指令与回调路由、内联键盘渲染、64 字节短 ID 解析、Telegram Bot API 封装、`/api/tg/webhook-config` 管理接口 |
| `dist/index.js` | **极薄挂接**（~15 行） | ① 顶部 `import { registerTgBot } from "./tg-bot.js"`；② `SYS_DEFS` 新增隐藏项 `tg.webhook_secret`（`secret: true, hidden: true`）与 `tg.webhook_url`（`secret: false, hidden: true`）；③ `PUBLIC_API_PATHS` 加入 `"/api/tg/webhook"`（仅放行 Webhook 回调入口，`/api/tg/webhook-config` 仍受登录态 Bearer Token 保护）；④ 路由末尾调用 `registerTgBot(app, { sysGet, sysSet, authSecret, authVersion, issueToken, nowIso: nowIso2 })` |
| `web-dist/assets/SettingsView-w1Y9UJLA.js` | **局部增强** | 在「Telegram 通知」卡片内增加 TG 交互 Webhook 状态徽章 + 「开启交互 Webhook / 关闭交互」按钮（通过 `index-DwZEqr4A.js` 已导出的 `getToken` (`U`) 直接调用 `/api/tg/webhook-config`） |
| `tests/tg-bot.test.mjs` | **新增** | 全覆盖测试 Webhook 鉴权、64 字节回调限制、命令与内联按钮流程、二次确认、异步 `waitUntil`、Webhook 注册/解绑与前端集成 |
| `tests/vnc-theme.test.mjs` | **更新边界清单** | 将 `dist/index.js` 从 UI 重构期的“零改动列表”移出，并新增对 `dist/tg-bot.js` 语法检查与 `dist/index.js` 挂接点完整性的校验（其余 `wrangler*.toml`、`package.json`、`index-DwZEqr4A.js` 及 6 个未改动前端 chunk 继续保持逐字节锁定） |

### 4.2 内部业务复用机制（零逻辑分叉）

`dist/tg-bot.js` 通过 `callInternalApi(env, ctx, path, { method, body })` 复用现有 Hono `app`：
1. 调用传入的 `issueToken(await authSecret(env), await authVersion(env), 60)` 生成仅内存使用的 60 秒短效内部 Token。
2. 构造 `new Request("https://internal.local" + path, { method, headers: { authorization: "Bearer " + token, "content-type": "application/json" }, body })`。
3. 调用 `app.fetch(internalReq, env, ctx)`——**务必透传真实的 `ctx`（`c.executionCtx`）**，确保 `PATCH /api/tasks/:id` 和 `PATCH /api/ip-tasks/:tid` 内部的 `c.executionCtx.waitUntil(...)` 正常运行，同时所有 OCI 调用自动写入 `LogHub` 实时日志与触发原有通知。
4. **已知区域边界说明**：现有 `dist/index.js` 中 `POST /api/cfgs/:id/instances/:iid/action` 仅使用配置默认主区 `row.region`（不读取 `?region=`）；因此 TG 机器人查看与操控实例均基于各配置的默认主区 `row.region`，并在实例列表标题中明确标注当前区域代码，避免多区账号误判。

### 4.3 安全模型（四层防线）

1. **Webhook Secret Token 强制校验**：
   - 启用交互 Webhook 时，系统生成 32 字节（64 位 hex，满足 Telegram `[A-Za-z0-9_-]{1,256}` 规范）随机密钥加密存入 `sys_cfg['tg.webhook_secret']`，并在调用 Telegram `setWebhook` 时通过 `secret_token` 下发。
   - 每次 `POST /api/tg/webhook` 必须校验请求头 `X-Telegram-Bot-Api-Secret-Token` 与 `tg.webhook_secret` 的**常量时间字节比对**；未设置密钥或校验不通过直接返回 `401`。
2. **Chat ID 严格白名单**：
   - 从 `sys_cfg['notify.tg_chat_id']` 读取已配置的单一 Chat ID（自动 `trim()`；*设计决策*：保持与现有单向推送 `sendTelegram` 相同的单 ID 语义，不引入逗号多 ID，避免破坏既有单向通知且零修改原推送函数）。
   - 提取 `message.chat.id` 或 `callback_query.message.chat.id`，与配置值精确字符串匹配；未配置或不匹配直接返回 `200 { ok: true }` 且**不回复任何内容**（静默丢弃，不向陌生人泄露 Bot 是否存在）。
   - 若请求体中 `from.is_bot === true`，直接忽略。
3. **非阻塞快速响应 + 去重**：
   - Webhook 路由在完成 Secret Token 校验与 JSON 解析后，立刻将实际处理交给 `c.executionCtx.waitUntil(handleUpdate(...))` 并立即返回 HTTP `200 { ok: true }`（耗时 < 50ms），彻底杜绝 Telegram 超时重试风暴。
   - 针对 `callback_query`，在处理函数第一步立刻调用 `answerCallbackQuery`（消除手机端按钮转圈加载态），耗时操作先将消息编辑为「⏳ 正在执行…」，完成后再 `editMessageText` 更新最终结果与按钮。
   - 额外使用短生命周期内存 `Set`（或 `sys_cfg` 记录最近 `update_id`）做幂等去重，防止网络重传导致重复执行换 IP/开机。
4. **零破坏性操作 + 敏感信息脱敏**：
   - 仅暴露查状态、测活、任务启停/立即执行、实例启停/重启/换 IP，绝不暴露删除配置/任务、终止实例或读取私钥/口令接口。
   - 文本统一使用 Telegram `HTML` `parse_mode`，所有来自用户配置名/实例名/报错信息的动态文本均经过严格 HTML 转义（`& < >`），并截断单条消息 ≤ 3800 字符（留足 Telegram 4096 上限余量）。

### 4.4 64 字节安全 `callback_data` 协议与实例短 ID 映射

现有 ID 长度：`oci_cfg.id` 为 `cfg_<11位>`（15 字节），`task.id` 为 `task_<11位>`（16 字节）或 `ipt_<11位>`（15 字节），解析时按通用非冒号字符串处理，均可直接放入 `callback_data`。

仅 **OCI 实例 OCID（~85 字节）** 超过 Telegram 64 字节限制。解决方案：
- 为每个实例 OCID 计算确定性 8 位十六进制短标识 `shortId = sha256(ocid).slice(0, 8)`（Web Crypto `crypto.subtle.digest("SHA-256", ...)`）。
- 拉取某配置实例列表时，将 `{ ts, map: { [shortId]: { id: ocid, name, state, shape, publicIps } } }` 写入 `sys_cfg` 的 `tg.imap:<cfgId>`（无额外建表，跨 Cloudflare 边缘节点一致）。
- 点击实例按钮时，先读 `tg.imap:<cfgId>` 解析真实 OCID；若缓存缺失或未命中，自动回源调一次 `GET /api/cfgs/:cfgId/instances` 重建映射并按 `shortId` 匹配——因此哪怕几天前的历史消息按钮依然有效。

完整 `callback_data` 编码（全部 ≤ 38 字节，远低于 64 字节上限）：

| 用途 | 格式 | 示例（长度） |
| :--- | :--- | :--- |
| 返回主菜单 / 刷新总览 | `m:home` / `m:st` | `m:st` (4B) |
| 配置列表分页 | `c:ls:<page>` | `c:ls:1` (6B) |
| 配置详情 | `c:v:<cfgId>` | `c:v:cfg_AbCdEfGhIjK` (19B) |
| 配置测活 | `c:chk:<cfgId>` | `c:chk:cfg_AbCdEfGhIjK` (21B) |
| 配置下实例列表 | `c:ins:<cfgId>:<page>` | `c:ins:cfg_AbCdEfGhIjK:1` (23B) |
| 实例详情 | `i:v:<cfgId>:<short8>` | `i:v:cfg_AbCdEfGhIjK:a1b2c3d4` (28B) |
| 实例操作确认页 | `i:ask:<op>:<cfgId>:<short8>` | `i:ask:ip:cfg_AbCdEfGhIjK:a1b2c3d4` (33B) |
| 实例操作执行 | `i:do:<op>:<cfgId>:<short8>` | `i:do:st:cfg_AbCdEfGhIjK:a1b2c3d4` (32B) |
| 任务列表（`l`=抢机 / `p`=换IP） | `t:ls:<l\|p>:<page>` | `t:ls:l:1` (8B) |
| 任务详情 | `t:v:<l\|p>:<taskId>` | `t:v:l:task_AbCdEfGhIjK` (22B) |
| 抢机任务暂停/恢复，或换 IP 任务暂停 | `t:tog:<l\|p>:<taskId>` | `t:tog:l:task_AbCdEfGhIjK` (24B) |
| 抢机任务立即执行 | `t:run:l:<taskId>` | `t:run:l:task_AbCdEfGhIjK` (24B) |
| 换 IP 任务确认页（`run`=立即执行 / `res`=恢复运行） | `t:ask:<run\|res>:<taskId>` | `t:ask:res:ipt_AbCdEfGhIjK` (25B) |
| 换 IP 任务确认执行（`run` / `res`） | `t:do:<run\|res>:<taskId>` | `t:do:run:ipt_AbCdEfGhIjK` (24B) |

> *设计决策（防误触补强）*：因 `PATCH /api/ip-tasks/:tid` 将换 IP 任务由 `paused` 切为 `running` 时会立即在后台执行 `runIpTaskOnce` 换 IP（造成瞬时断网），故换 IP 任务的「恢复运行」与「立即执行」统一走 `t:ask:<res|run>:<taskId>` → `t:do:<res|run>:<taskId>` 二次确认；暂停操作（`running -> paused`）则直接生效无需确认。

其中实例操作码 `<op>`：
- `st` → `START`（直接执行，无需二次确认）
- `sp` → `SOFTSTOP`（需二次确认）
- `rs` → `SOFTRESET`（需二次确认）
- `ip` → `POST /api/cfgs/:cfgId/instances/:iid/change-ip`（需二次确认）

### 4.5 指令与交互界面草图

```text
/start 或 /status：
┌──────────────────────────────────────┐
│ 📊 OCI Helper 总览                    │
│                                      │
│ ☁️ OCI 配置：5 个（有效 4 · 失效 1）  │
│ 🚀 抢机任务：3 个（运行中 2）          │
│ 🔄 换IP任务：2 个（运行中 1）          │
├──────────────────────────────────────┤
│ [☁️ OCI 配置]      [🚀 任务管理]      │
│ [🔄 刷新总览]                        │
└──────────────────────────────────────┘

点击配置 → 配置详情（c:v:<cfgId>）：
┌──────────────────────────────────────┐
│ ☁️ 新加坡主账号                        │
│ 状态：✅ 已连接 · 套餐：升级号          │
│ 区域：ap-singapore-1（2 区）          │
│ 任务：1 个（运行中 1）                 │
│ 上次校验：5 分钟前                     │
├──────────────────────────────────────┤
│ [🩺 立即测活]      [🖥 查看实例]      │
│ [⬅️ 返回列表]      [🏠 主菜单]        │
└──────────────────────────────────────┘

点击实例 → 实例详情（i:v:<cfgId>:<short8>）：
┌──────────────────────────────────────┐
│ 🖥 instance-arm-01                    │
│ 所属：新加坡主账号 · ap-singapore-1   │
│ 状态：🟢 RUNNING                      │
│ 规格：VM.Standard.A1.Flex (2C / 12G) │
│ 公网 IP：1.2.3.4                      │
├──────────────────────────────────────┤
│ [▶️ 开机]    [⏹ 关机]    [🔁 重启]    │
│ [🌐 一键换公网 IP]                    │
│ [🔄 刷新]    [⬅️ 实例列表]            │
└──────────────────────────────────────┘

点击「🌐 一键换公网 IP」/「⏹ 关机」/「🔁 重启」→ 二次确认：
┌──────────────────────────────────────┐
│ ⚠️ 确认执行：一键换公网 IP？           │
│ 实例：instance-arm-01                 │
│ 当前公网 IP：1.2.3.4                  │
│ 更换期间网络会短暂中断。               │
├──────────────────────────────────────┤
│ [✅ 确认更换 IP]   [❌ 取消]           │
└──────────────────────────────────────┘

/tasks → 任务管理（支持 抢机 / 换 IP 切换）：
┌──────────────────────────────────────┐
│ 🚀 抢机任务（第 1/1 页 · 共 2 个）     │
│                                      │
│ 1. 🟢 新加坡 ARM · 运行中 (0/1 · 12次) │
│ 2. ⏸ 东京 AMD · 已暂停 (0/1 · 5次)    │
├──────────────────────────────────────┤
│ [🚀 抢机任务 ✓]    [🔄 换IP任务]      │
│ [1. 新加坡 ARM]    [2. 东京 AMD]      │
│ [🔄 刷新]          [🏠 主菜单]        │
└──────────────────────────────────────┘
```

### 4.6 Webhook 管理 API 与设置页 UI

新增 3 个受现有登录态（Bearer Token）保护的后端管理接口（在 `dist/tg-bot.js` 中注册；*设计决策*：路径选用 `/api/tg/webhook-config` 而非 `/api/sys/tg-webhook`，彻底避开 `dist/index.js` 中既有 `DELETE /api/sys/:key` 的 Hono 路由遮蔽冲突且保持 `RegExpRouter` 零降级）：

1. **`GET /api/tg/webhook-config`**：
   - 返回 `{ configured: boolean, enabled: boolean, webhookUrl: string, hasBotToken: boolean, hasChatId: boolean, telegramInfo?: { url, pendingUpdateCount, lastErrorMessage, lastErrorDate } }`。
   - 当 `hasBotToken` 为 true 时顺带查询 Telegram `getWebhookInfo`（超时 5s，失败不阻断返回）以展示真实在线状态与最近错误。
2. **`POST /api/tg/webhook-config`**：
   - 前置校验 `notify.tg_bot_token` 和 `notify.tg_chat_id` 均已保存，否则返回 `400` 明确提示。
   - 生成（或复用已有）`tg.webhook_secret`（32 字节 hex）。
   - 取请求 `origin`（或 body 显式 `origin`，必须为 `https://`）拼出 `webhookUrl = "${origin}/api/tg/webhook"`。
   - 调用 Telegram `setWebhook`（`url`, `secret_token`, `allowed_updates: ["message", "callback_query"]`, `drop_pending_updates: true`）。
   - 调用 Telegram `setMyCommands` 注册 `/start`、`/status`、`/cfgs`、`/tasks`、`/help` 中文菜单说明。
   - 持久化 `tg.webhook_url` 并返回最新状态。
3. **`DELETE /api/tg/webhook-config`**：
   - 若存在 `notify.tg_bot_token`，调用 Telegram `deleteWebhook({ drop_pending_updates: true })`。
   - 清空 `sys_cfg` 中的 `tg.webhook_secret` 与 `tg.webhook_url`（即使 Bot Token 已失效也允许本地彻底解绑），返回 `{ ok: true }`。

前端 [SettingsView-w1Y9UJLA.js](file:///j:/abu_workspace/github/oci-helper-serverless-cf/web-dist/assets/SettingsView-w1Y9UJLA.js)「Telegram 通知」卡片增强：
- 标题栏新增「交互 Webhook 已开启 / 未开启」状态 `UiBadge`。
- 按钮栏新增「开启 TG 交互」/「关闭 TG 交互」按钮（加载态 + 成功/失败 Toast 提示），未填写 Bot Token 或 Chat ID 时给出清晰引导；开启后在卡片内展示当前已注册的 Webhook 地址（脱敏展示域名路径，不显示 Secret Token）与最近投递错误（如有）。

---

## 5. 留给实现者决定的事项（Left to the Builder）

1. 每页展示条数（建议配置列表与任务列表每页 5 条、实例列表每页 5 条，保证手机端一屏展示不拥挤）。
2. Telegram API 调用超时时间（建议 `AbortSignal.timeout(10000)`）及 `editMessageText` 遇到 `"message is not modified"` 时的静默忽略处理。
3. `tg.imap:<cfgId>` 缓存过期清理策略（在 `cleanupTempData` 或按需覆盖写入，确保不无限增长）。
4. `SettingsView-w1Y9UJLA.js` 中复用现有 `UiButton` / `UiBadge` 样式与 `theme-system.css` 语义类，确保 6 套主题均显示协调。

---

## 6. 验收标准

1. **安全与鉴权**：缺少或错误 `X-Telegram-Bot-Api-Secret-Token` 返回 `401`；非白名单 `chat_id` 静默忽略且不调用任何业务接口；错误配置状态下安全失败。
2. **完整指令与回调闭环**：`/start`、`/help`、`/status`、`/cfgs`、`/tasks` 正常返回格式化 HTML 与内联键盘；测活、查看实例、开机、关机（二次确认）、重启（二次确认）、一键换 IP（二次确认）、抢机/换 IP 任务暂停/恢复/立即执行全部打通；所有生成的 `callback_data` 字节长度均 ≤ 64 字节。
3. **非阻塞防重试**：Webhook 在 `waitUntil` 投递后台任务后立刻返回 `200 OK`，回调先 `answerCallbackQuery` 再编辑消息状态。
4. **设置页一键开关**：Web 面板「Telegram 通知」卡片支持一键开启/关闭交互 Webhook 并展示真实状态，6 套主题下视觉无异常。
5. **测试与兼容性**：新增 `tests/tg-bot.test.mjs` 全量通过；现有 `tests/*.test.mjs` 全量通过（含 `dist/index.js`、`dist/tg-bot.js` 及全部 `web-dist/assets/*.js` 的 `node --check`）；`wrangler.toml`、`wrangler.import.toml`、`package.json`、`index-DwZEqr4A.js` 零修改。
