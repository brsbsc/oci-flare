<div align="center">

# OCI Flare

**基于 Cloudflare Workers + D1 构建的 Oracle Cloud (OCI) 无服务器多租户运维面板**

零服务器成本 · 多账号集中纳管 · 定时抢机与自动换 IP · 浏览器直连 noVNC · Telegram 双向遥控

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](#快速部署)
[![Cloudflare D1](https://img.shields.io/badge/Database-Cloudflare%20D1-F38020?logo=sqlite&logoColor=white)](#快速部署)
[![Telegram Bot](https://img.shields.io/badge/Telegram-双向运维-26A5E4?logo=telegram&logoColor=white)](#telegram-机器人双向交互)
[![Zero VPS](https://img.shields.io/badge/架构-100%25%20Serverless-2563EB)](#架构与安全隐私)

<br />

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/brsbsc/oci-flare)

[功能亮点](#功能亮点) · [快速部署](#快速部署) · [必做安全配置](#必做安全配置) · [Telegram 机器人](#telegram-机器人双向交互) · [权限与进阶配置](#权限与进阶配置) · [常见问题](#常见问题)

</div>

---

## 功能亮点

| 模块 | 核心能力 |
| :--- | :--- |
| **☁️ 多租户集中纳管** | 智能解析 OCI 配置文件与 PEM 私钥，支持一键测活、多区域与区间切换、免费/付费套餐识别、服务配额查询及租户 IAM 概览。 |
| **🖥️ 实例与网络运维** | 实例开关机、重启、重装系统、在线改配、引导卷扩容与 VPU 调整、VCN 安全规则管理；内置 **noVNC 串口控制台**（支持一键重启进 BIOS 与移动端虚拟键盘）。 |
| **🚀 自动抢机与换 IP** | 基于 Workers Cron 定时执行免费/指定规格抢机，支持公网 IP 自动轮换（可按目标 CIDR 筛选，换 IP 后自动同步更新 **Cloudflare DNS** 记录），配套 WebSocket 实时日志流。 |
| **📊 流量与成本洞察** | 内置 VNIC 出入站流量趋势图与 OCI Usage 账单费用统计（ECharts），直观掌握各租户资源消耗。 |
| **🤖 Telegram 双向交互** | 无需额外部署中转服务，通过同一 Worker 处理 Webhook，在手机端即可查总览、账号测活、启停实例、换 IP 与管理任务。 |
| **🎨 多主题现代控台** | 提供 **精密 / Bento / 驾驶舱** 3 套视觉风格 × 深浅双色（共 6 套主题），支持居中/宽屏布局切换、卡片/列表双视图及桌面端日志抽屉。 |

---

## 快速部署

面板首次收到请求时会自动执行 `CREATE TABLE IF NOT EXISTS` 完成建表，**无需手动执行任何 SQL 迁移**。请根据使用习惯任选一种方式：

### 方式一：一键按钮部署（最快上手）

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/brsbsc/oci-flare)

1. 点击上方按钮，按向导授权 GitHub 与 Cloudflare 账号。
2. 确认 Worker 名称（默认 `oci-flare`），向导会自动 Fork 仓库、创建并绑定 D1 数据库。
3. 部署完成后，按下方 [必做安全配置](#必做安全配置) 添加机密变量即可登录使用。

---

### 方式二：连接 GitHub 自动构建（长期维护推荐）

> [!TIP]
> Cloudflare Wrangler 每次部署都会以配置文件为准覆盖远端绑定。通过仓库内置的 [scripts/cf-deploy.mjs](scripts/cf-deploy.mjs) 配合加密构建变量，可在每次 `git push` 自动更新时**永久保留 D1 数据库绑定**，同时避免在公开仓库暴露数据库 ID。

1. **准备 D1 数据库**：进入 Cloudflare Dashboard → **Storage & Databases → D1 SQL Database**，新建数据库（或直接复用旧数据库）并复制其 **Database ID（UUID）**。
2. **连接仓库**：进入 **Workers & Pages → 创建 → 连接 GitHub**，选择 `brsbsc/oci-flare`。
3. **配置构建参数**（进入 Worker → **Settings → Build**）：
   - **Build command（构建命令）**：留空
   - **Deploy command（部署命令）**：
     ```bash
     node scripts/cf-deploy.mjs
     ```
   - **Build variables（构建变量，建议勾选 Encrypt 加密）**：

     | 构建变量名 | 必填 | 说明 |
     | :--- | :---: | :--- |
     | `D1_DATABASE_ID` | **是** | 你的 D1 数据库 UUID。缺失时脚本会主动中止部署，防止误清线上 `DB` 绑定。 |
     | `WORKER_NAME` | 否 | 默认为 `oci-flare`；若线上 Worker 使用了其他名称，在此填入对应名称即可。 |
     | `D1_DATABASE_NAME` | 否 | 默认为 `oci-flare`；与你的 D1 库名不同时可按需填写。 |

4. 保存并触发构建，此后每次推送代码都会自动完成无损更新。

<details>
<summary>备选方案：使用 <code>wrangler.import.toml</code> 手动绑定（仅适合一次性手动部署）</summary>

若不配置构建变量，可将部署命令设为 `npx wrangler deploy --config wrangler.import.toml`，部署完成后再到 Worker → **Settings → Bindings** 手动绑定 D1 数据库（变量名严格填大写 `DB`）。注意后续若再次通过 Git 触发该命令，需重新手动绑定 `DB`。

</details>

---

### 方式三：本地命令行部署

```bash
git clone https://github.com/brsbsc/oci-flare.git
cd oci-flare
npm install -g wrangler
wrangler login
wrangler d1 create oci-flare   # 将返回的 database_id 填入本地 wrangler.toml（勿提交到公开仓库）
wrangler deploy
```

---

## 必做安全配置

部署完成后，进入 Cloudflare Dashboard → **Workers & Pages → `oci-flare` → Settings → Variables and Secrets**，添加以下机密变量（重新部署不会清除 Secrets）：

| 变量名 | 必填 | 作用说明 |
| :--- | :---: | :--- |
| `KEY_SECRET` | **必填** | 主加密密钥（填一串随机长字符串），用于派生 AES-256-GCM 密钥加密 D1 中的 OCI 私钥、口令、root 密码及 Bot Token。未配置时 API 返回 `503`。 |
| `AUTH_PASSWORD` | 推荐 | Web 面板登录密码。修改后所有历史登录态立即失效；若未设置，首次访问会在 Worker 实时日志输出随机初始密码。 |
| `AUTH_SECRET` | 推荐 | 独立随机长字符串，专门用于签名登录会话令牌。 |

> [!IMPORTANT]
> `KEY_SECRET` 一旦投入使用**请勿随意更改**，否则已有 D1 数据库中加密保存的私钥与凭证将无法解密。建议登录面板后在「系统设置」中一并开启 **TOTP 二次验证**。

---

## Telegram 机器人双向交互

除单向消息推送外，OCI Flare 支持直接在 Telegram 内完成日常巡检与实例运维。

### 开启步骤

1. 通过 `@BotFather` 创建机器人获取 `Bot Token`，并获取你个人的数字 `Chat ID`。
2. 登录面板进入 **系统设置**，保存 `Telegram Bot Token` 与 `Telegram Chat ID`（可先点击「发送 TG 机器人测试消息」验证连通性）。
3. 在「Telegram 通知」卡片点击 **开启 TG 交互**（需通过 HTTPS 域名访问面板）：系统会自动生成 64 位随机密钥、注册 `/api/tg/webhook` 并同步指令菜单；无需使用时点击 **关闭 TG 交互** 即可一键注销。

### 指令与操作一览

| 指令 | 视图内容 | 支持的内联按钮操作 |
| :--- | :--- | :--- |
| `/start` · `/status` | 全局运行总览（有效/失效账号数、抢机与换 IP 任务数） | 跳转配置列表、任务列表、刷新总览 |
| `/cfgs` | 分页浏览 OCI 账号配置与状态详情 | 在线测活、查看默认主区实例列表 |
| 实例控制（从 `/cfgs` 进入） | 实例实时状态、规格（OCPU/内存）与公网 IP | 直接开机；软关机、软重启、一键换公网 IP（**强制二次确认**） |
| `/tasks` | 抢机任务与换 IP 任务分页视图 | 抢机任务启停/立即执行；换 IP 任务暂停及恢复/立即执行（**强制二次确认**） |
| `/help` | 查看指令速查与安全边界说明 | 返回主菜单 |

### 安全边界设计

- **双重鉴权**：所有 Webhook 请求均通过 `X-Telegram-Bot-Api-Secret-Token` 进行常量时间比对（不匹配直接返回 `401`），并严格限制仅响应已配置的单一 `Chat ID` 白名单，其余请求静默丢弃。
- **防误触隔离**：关机、重启、换 IP 等状态变更均需二次确认；删除账号配置、终止实例、删除任务等不可逆高危操作仅限 Web 面板执行，不在 Bot 端开放。

---

## 权限与进阶配置

### OCI 最小 IAM 权限策略

在甲骨文云控制台创建 IAM 用户并生成 API Key 后，建议为其所在用户组配置如下最小权限策略：

```text
Allow group <你的组名> to manage instance-family in tenancy
Allow group <你的组名> to manage volume-family in tenancy
Allow group <你的组名> to manage virtual-network-family in tenancy
Allow group <你的组名> to read identities in tenancy
Allow group <你的组名> to inspect limits in tenancy
```

> 如需使用「持续换公网 IP」功能，请额外追加一条：`Allow group <你的组名> to manage vnic-attachment-family in tenancy`。

### Google 一键登录（可选）

1. 前往 [Google Cloud Console](https://console.cloud.google.com/apis/credentials) 创建 **OAuth 2.0 客户端 ID**（应用类型选择 **Web 应用**）。
2. 在 **已获授权的 JavaScript 来源** 中添加你的面板域名（如 `https://oci.example.com`）；认证采用浏览器弹窗模式，无需配置回调重定向 URI。
3. 复制生成的 **Client ID**，在面板 **系统设置 → Google 一键登录** 中填入 Client ID 与允许登录的邮箱白名单（多个邮箱用英文逗号分隔），勾选启用并保存即可。

---

## 常见问题

<details>
<summary><b>推送更新后配置列表变空，或提示 <code>Cannot read properties of undefined (reading 'prepare')</code>？</b></summary>

数据仍在原 D1 数据库中并未丢失，原因是未使用构建脚本导致 Wrangler 部署时清空了 Worker 的 `DB` 绑定。请按上文「方式二」配置 `D1_DATABASE_ID` 并将部署命令设为 `node scripts/cf-deploy.mjs`，重新触发一次部署即可恢复并彻底避免复发。

</details>

<details>
<summary><b>Cloudflare 自动构建报错 <code>The build token selected for this build has been deleted or rolled</code>？</b></summary>

进入 Worker → **Settings → Build**，重新选择或生成一个新的 API Build Token，保存后在部署记录中点击 **Retry build** 即可。

</details>

<details>
<summary><b>忘记面板登录密码，或丢失了 TOTP 二次验证设备怎么办？</b></summary>

- **重置登录密码**：在 Worker → **Settings → Variables and Secrets** 中直接修改 `AUTH_PASSWORD`，新密码立即生效且旧会话全部登出。
- **关闭二次验证**：在 Cloudflare D1 控制台打开对应数据库，删除 `sys_cfg` 表中 `key = 'mfa.enabled'` 的记录即可恢复纯密码登录。

</details>

---

## 架构与安全隐私

```text
├── dist/
│   ├── index.js           # Worker 后端核心（Hono API、OCI SDK、LogHub & VncTunnel Durable Objects）
│   └── tg-bot.js          # Telegram Webhook 鉴权、会话编排与内联键盘模块
├── web-dist/              # 前端静态资源（Vue 3、6 套多主题 Token 系统、ECharts、noVNC）
├── scripts/
│   └── cf-deploy.mjs      # Cloudflare 自动构建 D1 绑定注入脚本
├── migrations/            # D1 初始化 SQL（Worker 首次请求亦会自动幂等建表）
├── tests/                 # Node.js 自动化回归测试套件
├── wrangler.toml          # 默认 Wrangler 部署配置
└── wrangler.import.toml   # 无 D1 声明的手动导入配置
```

本地运行全量自动化测试（需 Node.js 20+）：

```bash
npm test
```

**隐私与加密说明**：所有敏感字段（OCI 私钥、私钥口令、实例 root 密码、Telegram Bot Token、Webhook 密钥及第三方凭证）均通过你的专属 `KEY_SECRET` 经 **HKDF-SHA256 + AES-256-GCM** 加密后存储在你自己的 Cloudflare D1 数据库中；会话令牌内置 `jti` 与密码版本校验，改密即刻全端失效；第三方放货统计上报与公共频道广播均**默认关闭**，仅在你主动配置对应开关或凭证后才会启用。
