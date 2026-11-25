# OCI Helper Serverless

运行在 **Cloudflare Workers + D1 + Durable Objects** 上的 Oracle Cloud (OCI) 多账号实例与任务管理面板，开箱即用、零服务器运维成本。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/brsbsc/oci-helper-serverless-cf)

---

## 核心特性

### 全新多主题 Web UI
- **3 套风格主题 × 深/浅双色（共 6 套完整主题）**：支持在顶栏与登录页随时一键切换并持久记忆，首屏零闪烁，自动同步 ECharts 图表与 noVNC 控制台配色：
  - **精密云控台（Precision，默认）**：克制极简的 1px 层级质感（`1200px` 居中容器）
  - **Bento 工作台（Bento）**：柔和圆角与模块化卡片留白（`1160px` 居中容器）
  - **Ops 运维驾驶舱（Cockpit）**：高密度终端遥测与绿光状态强调（`1280px` 居中容器）
- **居中 / 宽屏一键切换**：默认居中收窄排版，告别大屏左右空洞；顶栏可随时切回宽屏模式，移动端（`390px` 起）自适应零溢出。
- **OCI 卡片 / 列表双模式**：`/cfgs` 默认提供结构化卡片视图（含区域、租户、抢机任务、校验时间 2×2 信息格），支持一键切换精简列表视图并记住偏好。
- **精细化交互与无障碍**：任务实时日志在桌面端改为右侧滑出抽屉；弹窗与确认框支持嵌套 `Escape` 协同与焦点恢复；全局零 `!important` 样式架构并满足 WCAG AA 对比度标准。

### 完整业务能力
- **多账号与租户管理**：智能解析 OCI config / PEM 私钥、一键测活、套餐刷新、批量免费开机、多区域切换与租户概览。
- **云资源全周期运维**：实例管理（启停/重装/改配/换 IP/noVNC 控制台）、引导卷、VCN/子网/安全组网络、流量监控（ECharts）、配额限额与费用分析。
- **自动化任务与实时日志**：Cron 定时抢机任务、持续换公网 IP 任务（支持联动更新 DNS），基于 Durable Objects 的 WebSocket 内存实时日志流。
- **Cloudflare DNS 与安全登录**：内置 Cloudflare 域名解析管理；支持访问密码、TOTP 二次验证、Google OAuth 一键登录以及 Telegram 通知推送。
- **零手工建库**：首次请求自动执行 `CREATE TABLE IF NOT EXISTS` 初始化表结构，无需手动运行 SQL 迁移。

---

## 部署方式

### 方式一：一键按钮部署（最简，自动创建 D1）

1. 点击顶部 **Deploy to Cloudflare** 按钮并授权 GitHub 与 Cloudflare。
2. 按向导填写 Worker 名称（默认 `oci-helper-serverless`），Cloudflare 会自动创建并绑定 D1 数据库完成部署。
3. 部署完成后按下方 **「部署后必做配置」** 设置 `KEY_SECRET` 与 `AUTH_PASSWORD`，访问 Worker 域名即可登录。

### 方式二：连接 GitHub 仓库自动构建（推荐长期维护）

> **重要提示**：Wrangler 每次部署都会以配置文件为准同步资源绑定。如果只用 `wrangler.import.toml`（不声明 D1）部署，**每次推送代码后都会把 Dashboard 里手动添加的 `DB` 绑定清掉**。请按下方推荐配置用加密构建变量注入 `D1_DATABASE_ID`，一劳永逸且不会在公开仓库泄露数据库 ID。

1. **创建（或复用已有）D1 数据库**：
   - 进入 Cloudflare Dashboard → **Storage & Databases → D1 SQL Database**，创建数据库并复制它的 **Database ID（UUID）**（若已有历史数据库，直接复制旧库的 ID 即可无缝继承数据）。
2. **连接 GitHub 仓库**：
   - 进入 **Workers & Pages → 创建 → 连接 GitHub**，选择本仓库（`brsbsc/oci-helper-serverless-cf`）。
3. **配置构建变量与命令（Worker → Settings → Build）**：
   - 在 **Build variables（构建变量）** 中添加（建议勾选 Encrypt 加密）：
     - `D1_DATABASE_ID` = `<你的 D1 Database ID>`
     - 若你的 D1 数据库名称不是 `oci-helper-serverless`，再添加一个 `D1_DATABASE_NAME` = `<你的 D1 数据库名称>`
   - **Build command（构建命令）**：
     - 如果 D1 名称为 `oci-helper-serverless`：
       ```bash
       sed -i "s/REPLACE_WITH_YOUR_D1_DATABASE_ID/${D1_DATABASE_ID}/g" wrangler.toml
       ```
     - 如果使用了自定义 D1 名称：
       ```bash
       sed -i "s/REPLACE_WITH_YOUR_D1_DATABASE_ID/${D1_DATABASE_ID}/g; s/database_name = \"oci-helper-serverless\"/database_name = \"${D1_DATABASE_NAME}\"/g" wrangler.toml
       ```
   - **Deploy command（部署命令）**（把 `<你的Worker名>` 替换为实际的 Worker 名称，如 `oci-helper-serverless-cf`）：
     ```bash
     npx wrangler deploy --name <你的Worker名>
     ```
4. 保存并触发部署，后续每次 `git push` 自动部署都会自动保持 `DB` 绑定不丢失。

<details>
<summary>备选：使用 wrangler.import.toml 手动绑定（仅适合一次性手动部署）</summary>

若不配置构建变量，可将部署命令设为 `npx wrangler deploy --config wrangler.import.toml`，部署后再到 Worker → **Settings → Bindings** 手动添加 D1 绑定（变量名填 `DB`）。注意此后若再次通过 Git 自动触发该命令，需重新绑定 `DB`。

</details>

### 方式三：本机命令行部署

```bash
git clone https://github.com/brsbsc/oci-helper-serverless-cf.git
cd oci-helper-serverless-cf
npm install -g wrangler
wrangler login
wrangler d1 create oci-helper-serverless   # 将返回的 database_id 填入 wrangler.toml（勿提交到公开仓库）
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
2. 在 **已获授权的 JavaScript 来源** 中添加你的面板域名（例如 `https://your-domain.com`）。
3. 在 **已获授权的重定向 URI** 中添加 `https://your-domain.com/google-callback`（用于移动端重定向模式；桌面端弹窗模式可不依赖回调）。
4. 复制生成的 **Client ID**（无需 Client Secret），回到面板 **系统设置 → Google 一键登录**，填入 Client ID 与允许登录的邮箱白名单（多个用逗号分隔），勾选启用并保存即可。

---

## 目录结构与本地验证

```text
├── dist/              # Cloudflare Worker 后端运行产物（含 Hono API、OCI SDK、Durable Object LogHub）
├── web-dist/          # 前端静态产物（Vue 3 ESM、多主题 Token 样式系统、ECharts、noVNC）
├── migrations/        # D1 迁移目录（Worker 首次请求亦会自动建表）
├── tests/             # Node.js 自动化契约与语法测试套件
├── wrangler.toml      # 默认 Wrangler 部署配置
└── wrangler.import.toml
```

运行本地前端与产物完整性测试（需要 Node.js 20+）：

```bash
node --test tests/*.test.mjs
```

---

## 隐私与数据存储

所有 OCI 私钥、私钥口令、实例 root 密码及第三方 Token 均使用你自己的 `KEY_SECRET` 经 **HKDF-SHA256 + AES-256-GCM** 加密后保存在你个人 Cloudflare 账号的 D1 数据库中，登录凭证带 `jti` 与密码版本校验，修改密码即刻全端失效。
