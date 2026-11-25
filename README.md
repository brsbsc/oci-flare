# OCI Flare

运行在 **Cloudflare Workers + D1 + Durable Objects** 上的 Oracle Cloud (OCI) 多账号实例与自动化任务管理面板，开箱即用、零服务器运维成本。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/brsbsc/oci-flare)

---

## 核心特性

### 1. 多主题现代化 Web UI
- **3 套风格主题 × 深/浅双色（共 6 套完整主题）**：顶栏与登录页随时一键切换并持久记忆，首屏零闪烁，自动同步 **ECharts 图表**与 **noVNC 控制台**配色：
  - **精密云控台（Precision，默认）**：克制极简的 1px 清晰层级（`1200px` 居中容器）
  - **Bento 工作台（Bento）**：柔和圆角与模块化卡片留白（`1160px` 居中容器）
  - **Ops 运维驾驶舱（Cockpit）**：高密度终端遥测与绿光状态强调（`1280px` 居中容器）
- **居中 / 宽屏一键切换**：默认居中限宽排版，告别宽屏左右空白；顶栏一键切换宽屏模式，移动端（`390px` 起）自适应零横向溢出。
- **OCI 卡片 / 列表双模式**：`/cfgs` 默认提供结构化卡片视图（含区域、租户、抢机任务、校验时间 2×2 信息格），可随时切换精简列表视图并记住偏好。
- **精细化交互与无障碍**：任务实时日志在桌面端以右侧滑出抽屉展示；弹窗与确认框支持嵌套 `Escape` 协同与焦点恢复；全局零 `!important` 样式架构并满足 WCAG AA 对比度标准。

### 2. Telegram 机器人双向交互
- **零额外服务器**：基于 Cloudflare Workers Webhook 直接运行在同一 Worker 内，Web 面板一键开启/关闭并自动同步 Bot 指令菜单。
- **随时在手机端运维**：支持 `/status`、`/cfgs`、`/tasks` 等指令与内联键盘，可直接查看状态、账号测活、启停/重启实例、一键换公网 IP，以及暂停/恢复/立即执行抢机与换 IP 任务。
- **纵深安全防误触**：`X-Telegram-Bot-Api-Secret-Token` 常量时间验签 + 单一 `Chat ID` 精确白名单；关机、重启、换 IP 等高影响操作强制内联按钮二次确认；绝不暴露删除配置、终止实例、删除任务等不可逆操作。

### 3. 完整 OCI 与云运维能力
- **多账号与租户管理**：智能解析 OCI config / PEM 私钥、一键测活、套餐刷新、批量免费开机、多区域切换与租户概览。
- **云资源全周期运维**：实例管理（启停/重装/改配/换 IP/noVNC 控制台）、引导卷、VCN/子网/安全组网络、流量监控（ECharts）、配额限额与费用分析。
- **自动化任务与实时日志**：Cron 定时抢机任务、持续换公网 IP 任务（支持联动更新 Cloudflare DNS），基于 Durable Objects 的 WebSocket 内存实时日志流。
- **账号安全与认证**：支持访问密码、TOTP 二次验证、Google OAuth 一键登录以及 Telegram 单向通知推送与双向控制。
- **零手工建库**：首次请求自动执行 `CREATE TABLE IF NOT EXISTS` 初始化表结构，无需手动运行 SQL 迁移。

---

## 部署方式

### 方式一：一键按钮部署（最简，自动创建并绑定 D1）

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/brsbsc/oci-flare)

1. 点击上方 **Deploy to Cloudflare** 按钮并授权 GitHub 与 Cloudflare。
2. 按向导填写 Worker 名称（默认 `oci-flare`），Cloudflare 会自动 Fork 仓库、创建 D1 数据库并完成绑定部署。
3. 部署完成后按下方 **「部署后必做配置」** 设置 `KEY_SECRET` 与 `AUTH_PASSWORD`，访问 Worker 域名即可登录。

### 方式二：连接 GitHub 仓库自动构建（推荐长期维护，永不解绑 D1）

> **为什么推荐此脚本？** Cloudflare Wrangler 每次部署都会以配置文件为准覆盖远端资源绑定，且不支持 `keep_bindings`。如果直接使用不含 D1 声明的 `wrangler.import.toml`，每次推送代码都会把 Dashboard 里手动绑的 `DB` 清掉。使用仓库内置的 [scripts/cf-deploy.mjs](scripts/cf-deploy.mjs) 配合加密构建变量，既能永久保留 `DB` 绑定，又不会在公开仓库泄露你的数据库 ID。

1. **创建（或复用已有）D1 数据库**：
   - 进入 Cloudflare Dashboard → **Storage & Databases → D1 SQL Database**，创建数据库并复制它的 **Database ID（UUID）**（若已有历史数据库，直接复制旧库 ID 即可无缝继承原数据）。
2. **连接 GitHub 仓库**：
   - 进入 **Workers & Pages → 创建 → 连接 GitHub**，选择本仓库（`brsbsc/oci-flare`）。
3. **配置构建变量与命令（Worker → Settings → Build）**：
   - 在 **Build variables（构建变量）** 中添加（建议勾选 **Encrypt** 加密）：
     - `D1_DATABASE_ID` = `<你的 D1 Database ID>`（**必填**，缺失时会主动中止部署，防止误清远端 `DB` 绑定）
     - `WORKER_NAME` = `<你的 Worker 名称>`（与默认 `oci-flare` 一致可不填；若从旧版升级，填原有 Worker 名称即可保持原域名与配置不变）
     - `D1_DATABASE_NAME` = `<你的 D1 数据库名称>`（与默认 `oci-flare` 一致可不填）
   - **Build command（构建命令）**：留空即可
   - **Deploy command（部署命令）**：
     ```bash
     node scripts/cf-deploy.mjs
     ```
4. 保存并触发部署。此后每次 `git push` 自动构建都会自动注入真实 `DB` 绑定，彻底杜绝解绑问题。

<details>
<summary>备选：使用 wrangler.import.toml 手动绑定（仅适合一次性手动部署）</summary>

若不配置构建变量，可将部署命令设为 `npx wrangler deploy --config wrangler.import.toml`，部署后再到 Worker → **Settings → Bindings** 手动添加 D1 绑定（变量名严格填大写 `DB`）。注意此后若再次通过 Git 触发该命令，需重新手动绑定 `DB`。

</details>

### 方式三：本机命令行部署

```bash
git clone https://github.com/brsbsc/oci-flare.git
cd oci-flare
npm install -g wrangler
wrangler login
wrangler d1 create oci-flare   # 将返回的 database_id 填入本地 wrangler.toml（勿提交到公开仓库）
wrangler deploy
```

---

## 部署后必做配置（安全）

进入 Cloudflare Dashboard → **Workers & Pages → 你的 Worker → Settings → Variables and Secrets**，添加以下机密变量（**Secrets 在重新部署时不会被清除**）：

| 变量名 | 是否必填 | 说明 |
| :--- | :---: | :--- |
| `KEY_SECRET` | **必填** | 随机长字符串，用于 HKDF-SHA256 派生 AES-256-GCM 密钥加密 D1 中的 OCI 私钥、口令、root 密码及系统密钥。未设置时 API 返回 `503`；**切勿随意修改**，否则无法解密已有数据。 |
| `AUTH_PASSWORD` | 推荐 | 面板登录密码。修改后已签发的所有登录 token 立即失效；若留空，首次启动会在 Worker 日志中输出随机初始密码。 |
| `AUTH_SECRET` | 推荐 | 另一串独立随机长字符串，专门用于签名登录 token。 |

---

## Telegram 机器人双向交互（可选）

### 启用步骤
1. 通过 `@BotFather` 创建机器人获取 `Bot Token`，并获取你个人的数字 `Chat ID`。
2. 登录 Web 面板进入 **系统设置**，在底部密钥卡片中保存 **`Telegram Bot Token`** 与 **`Telegram Chat ID`**（先点「发送 TG 机器人测试消息」确认单向推送通畅）。
3. 在「Telegram 通知」卡片点击 **开启 TG 交互**（需通过 HTTPS 域名访问面板）：系统会自动生成 64 位加密 Secret Token、向 Telegram 注册 `/api/tg/webhook` 并同步指令菜单；需要停用时点击 **关闭 TG 交互** 即可一键注销并清理密钥。

### 支持指令与内联按钮

| 指令 | 功能说明 | 内联按钮操作 |
| :--- | :--- | :--- |
| `/start` / `/status` | 面板总览（OCI 配置有效/失效数、抢机与换 IP 任务数） | 快捷跳转配置、任务、刷新总览 |
| `/cfgs` | 分页查看 OCI 配置列表与详情 | 账号测活、进入默认主区实例列表 |
| 实例详情（由 `/cfgs` 进入） | 实时拉取实例状态、规格与公网 IP | 开机（直接执行）；软关机、软重启、一键换公网 IP（**需二次确认**）；刷新实时状态 |
| `/tasks` | 分页查看抢机任务与换 IP 任务（支持双 Tab 切换） | 抢机任务暂停/恢复/立即执行；换 IP 任务暂停（直接执行）及恢复/立即执行（**需二次确认**） |
| `/help` | 查看指令说明与操作范围 | 返回主菜单 |

### 安全机制
- **双因子鉴权**：Webhook 请求强制通过 `X-Telegram-Bot-Api-Secret-Token` 常量时间字节比对（失败返回 `401`），并严格校验单一 `notify.tg_chat_id` 精确白名单（非白名单及 Bot 消息静默丢弃、零回复）。
- **抗重试与防误触**：收到更新后立即返回 `200 OK` 并交由 `ctx.waitUntil` 异步执行（配合 `update_id` 去重防重试风暴）；高影响操作全部采用两步确认，且明确不开放删除配置、终止实例、删除任务等不可逆接口。

---

## OCI 最小 IAM 权限策略

在 OCI 控制台创建 IAM 用户并生成 API Key，将其加入专用用户组并配置如下最小权限策略：

```text
Allow group <你的组> to manage instance-family in tenancy
Allow group <你的组> to manage volume-family in tenancy
Allow group <你的组> to manage virtual-network-family in tenancy
Allow group <你的组> to read identities in tenancy
Allow group <你的组> to inspect limits in tenancy
```

> 如需使用「持续换公网 IP」功能，请额外追加 `manage vnic-attachment-family in tenancy`。

---

## Google 一键登录配置（可选）

1. 在 [Google Cloud Console](https://console.cloud.google.com/apis/credentials) 创建 **OAuth 2.0 客户端 ID**（应用类型选 **Web 应用**）。
2. 在 **已获授权的 JavaScript 来源** 中添加你的面板域名（例如 `https://your-domain.com`）；面板采用浏览器弹窗模式完成认证，无需配置重定向 URI。
3. 复制生成的 **Client ID**（无需 Client Secret），回到面板 **系统设置 → Google 一键登录**，填入 Client ID 与允许登录的邮箱白名单（多个用逗号分隔），勾选启用并保存即可。

---

## 常见问题（FAQ）

- **推送更新后页面显示「还没有 OCI 配置」或提示 `Cannot read properties of undefined (reading 'prepare')`？**
  - 你的数据安全留在原有 D1 数据库中并未丢失，这只是旧的 `wrangler.import.toml` 部署命令覆盖清空了 Worker 的 `DB` 绑定。请按上文 **方式二** 配置 `D1_DATABASE_ID` 与 `node scripts/cf-deploy.mjs` 重新部署即可彻底恢复并防止复发。
- **Cloudflare Workers Builds 报错 `The build token selected for this build has been deleted or rolled`？**
  - 进入 Worker → **Settings → Build** 重新选择或生成新的 Build token，保存后在构建记录页点击 **Retry build** 即可。
- **忘记面板密码或 TOTP 认证器丢失？**
  - 在 Worker → **Settings → Variables and Secrets** 修改 `AUTH_PASSWORD` 即可重置密码并令所有旧登录态失效；若 TOTP 丢失，在对应 D1 数据库的 `sys_cfg` 表删除 `key = 'mfa.enabled'` 的记录即可关闭二次验证。

---

## 目录结构与本地验证

```text
├── dist/
│   ├── index.js           # Cloudflare Worker 后端运行产物（Hono API、OCI SDK、Durable Object LogHub）
│   └── tg-bot.js          # Telegram Bot Webhook、鉴权与内联键盘交互模块
├── web-dist/              # 前端静态产物（Vue 3 ESM、6 套多主题 Token 系统、ECharts、noVNC）
├── scripts/
│   └── cf-deploy.mjs      # 基于加密构建变量注入 D1 绑定的自动部署脚本
├── migrations/            # D1 迁移目录（Worker 首次请求亦会自动建表）
├── tests/                 # Node.js 自动化测试套件（主题、部署脚本、TG 机器人及真实 Worker 路由）
├── wrangler.toml          # 默认 Wrangler 部署配置
└── wrangler.import.toml   # 无 D1 声明的手动导入配置
```

运行全量本地自动化测试（需要 Node.js 20+）：

```bash
node --test tests/*.test.mjs
```

---

## 隐私与数据存储

所有 OCI 私钥、私钥口令、实例 root 密码、Telegram Bot Token、Webhook Secret 及第三方凭证均使用你自己的 `KEY_SECRET` 经 **HKDF-SHA256 + AES-256-GCM** 加密后保存在你个人 Cloudflare 账号的 D1 数据库中，登录凭证带 `jti` 与密码版本校验，修改密码即刻全端失效。第三方放货面板上报与公共频道广播均默认关闭，仅在你主动配置放货面板 Token 或手动开启公共频道推送开关时才会发送。
