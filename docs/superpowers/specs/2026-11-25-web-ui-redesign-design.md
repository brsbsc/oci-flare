# OCI Helper Serverless Web UI 重新设计方案

- **日期**：2026-11-25
- **项目**：`oci-helper-serverless-cf`
- **落地方式**：方案 A — 无破坏式深度重构 `web-dist/`（保留现有 85+ API 业务核心，新增 Token 化多主题样式系统与关键视图结构增强）
- **设计参考**：基于 `ui-ux-pro-max` 设计系统检索与线上实机浏览器只读巡检结论

---

## 1. 意图与背景（Why）

当前面板在功能上完整覆盖 OCI 多账号管理、实例/引导卷/网络/流量/配额/成本/IAM、抢机与换 IP 任务、实时日志、Cloudflare DNS、系统设置与 noVNC 控制台，但在日常使用与实机巡检中暴露出 5 类核心体验痛点：

1. **全站无上限拉宽，桌面端元素“左右分家”**：`AppShell` 主内容区无 `max-width` 约束，宽屏下撑至 ~1390px+，工具栏按钮、表单说明、设置页 6 张密钥卡片右侧均出现 500–900px 空白黑洞。
2. **OCI 配置页缺少卡片视图，信息过载**：`/cfgs` 只有单行列表，把 10+ 项同质化灰色胶囊与重复状态图标塞在同一行，扫描困难；手机端胶囊折成 4 行且底部 5 个操作按钮拥挤易误触。
3. **租户详情页顶部三层套娃与控件重复**：进入账号后正文前堆叠账号栏 + 全局范围栏 + 7 个子标签栏（近 200px），顶部与子页存在视觉重复的「刷新」按钮，流量页存在重复「区域」选择框，OCID 对比度过低。
4. **视觉缺乏层次，浅色模式体验割裂**：深色背景依赖极光渐变与高饱和发光青蓝按钮；浅色模式靠 25+ 条 `html.light ... !important` 硬覆盖拼接，残留青绿渐变脏影，禁用态按钮与正常主按钮几乎无法区分；原生白底 checkbox 在深色模式下极其刺眼。
5. **交互细节与一致性缺口**：任务管理「实时日志」采用居中全遮罩弹窗阻断上下文；`novnc/vnc.html` 与主站视觉脱节；部分纯图标按钮缺少 `aria-label`，弹窗缺少 `Escape` 关闭与焦点管理，全站缺少 `prefers-reduced-motion` 支持。

用户明确希望：
- 解决“太宽”问题，提供居中舒适布局并可随时切换宽屏；
- 为 OCI 管理增加「卡片 / 列表」模式切换；
- 同时内置 **3 套风格迥异且可随时一键切换的主题**（精密云控台 / 现代 Bento 工作台 / Ops 运维驾驶舱），并与深色/浅色模式自由组合。

---

## 2. 目标、非目标与反目标

### 目标（Goals）
1. **3 套风格 × 明暗双色 = 6 套完整主题**：顶栏与移动端抽屉随时一键切换，刷新零闪烁（inline 启动脚本同步写入 DOM 属性），自动持久化到 `localStorage` 并同步到 `web-dist/novnc/vnc.html`。
2. **居中收窄与宽窄切换**：主内容区默认收窄居中（按主题 `1160px–1280px`），顶栏提供一键切换「居中 / 宽屏」，适配从 `375px` 到 `1920px+` 屏幕。
3. **OCI 管理双视图模式**：`/cfgs` 新增「卡片 / 列表」切换（默认卡片，记住偏好），卡片模式结构化分层展示关键状态、区域/租户/任务元数据和主次操作；列表模式去噪对齐。
4. **重点页面布局重构**：
   - `/settings` 底部 6 张密钥配置卡改为响应式双列网格，说明文案限制可读行宽；
   - `/cfgs/:cfgId/*` 收紧顶部上下文栏、区分刷新语义、提亮 OCID 并提供快捷复制、移除流量页重复区域选择框；
   - `/tasks` 实时日志在桌面宽屏改为右侧滑出抽屉（移动端平滑适配全宽），补齐 `Escape` 关闭与 `aria-label`；
   - `/cloudflare` 收紧顶部状态条，优化 DNS 记录表列宽比例；
   - `TrafficView` / `CostView` 的 ECharts 图表坐标轴与系列色响应当前主题与明暗模式；
   - `LoginView` 与当前主题保持一致并提供角落快速切换入口。
5. **无障碍与表单质感达标**：WCAG AA 正常文本对比度 ≥ 4.5:1，清晰区分禁用态按钮，统一自定义 checkbox 样式，全站可见 `focus-visible` 焦点环，尊重 `prefers-reduced-motion`。

### 非目标（Non-Goals）
- 不修改后端 `dist/index.js` 的 85+ `/api/*`、WebSocket 协议或 D1 数据库表结构。
- 不引入前端打包工具链（不新增 Vite/Tailwind 编译流程，保持 `package.json` 和 `wrangler.toml` 一键部署体验不变）。
- 不新增或删减业务功能（不改动 OCI 抢机、批量开机、换 IP、安全组、IAM、TOTP、Google 登录、Cloudflare DNS 的任何业务逻辑与接口参数）。
- 不强制加载外部 CDN 字体（默认零外链本地优先字体栈，确保弱网快开与隐私洁净）。

### 反目标（Anti-Goals）
- **绝不破坏现有编译模块依赖关系**：不得修改原有带 hash 的 JS 文件名或导出符号名，以免 `index-DwZEqr4A.js` 动态导入断裂。
- **绝不依赖未编译的 Tailwind 工具类**：由于 `index-BbaPobom.css` 是预编译产物，所有新增的布局与样式必须通过语义化 CSS 类写在 `web-dist/assets/theme-system.css` 中。
- **绝不回退到 `!important` 补丁式浅色主题**：所有颜色、表面、边框、文字、按钮与禁用态必须由 CSS Custom Properties（Token）统一驱动。
- **绝不破坏现有 `localStorage` 键兼容性**：保留 `oci_mini_theme`、`oci_mini_sidebar`、`oci_mini_token`、`oci_mini_task_cfg` 的既有语义。

---

## 3. 工程约束

1. **产物形态约束**：本仓库为 Cloudflare Workers 预编译部署包，静态资源位于 `web-dist/`，`wrangler.toml` 配置 `directory = "web-dist"` 与 `not_found_handling = "single-page-application"`。
2. **模块文件名锁定与改动边界**：以下既有编译入口与 chunk 文件名必须保持不变（仅原地增强内容）：
   - `web-dist/index.html`
   - `web-dist/assets/index-BbaPobom.css`（保留 Tailwind v4 `@layer properties / theme / base / components / utilities` 基础与工具类，移除末尾脆弱的 `html.light ... !important` 硬覆盖与旧 `.aurora/.panel/.field` 硬编码块，由新样式表接管）
   - `web-dist/assets/AppShell-D9QnCYdV.js`
   - `web-dist/assets/CfgView-BJjU6PMD.js`
   - `web-dist/assets/CfgDetailView-Dlm4x8bL.js`
   - `web-dist/assets/TenantView-CESpkrmJ.js`
   - `web-dist/assets/SettingsView-w1Y9UJLA.js`
   - `web-dist/assets/TaskManageView-C7VfWf-q.js`
   - `web-dist/assets/CloudflareView-Dzih7xW-.js`
   - `web-dist/assets/TrafficView-gyV2LYjA.js`
   - `web-dist/assets/CostView-DMCrmlrj.js`
   - `web-dist/assets/LoginView-BU-WcVZj.js`
   - `web-dist/assets/UiButton.vue_vue_type_script_setup_true_lang-B6_iRLwp.js`
   - `web-dist/assets/UiDialog.vue_vue_type_script_setup_true_lang-BGya80so.js`
   - `web-dist/assets/UiBadge.vue_vue_type_script_setup_true_lang-BnzI1Z_L.js`
   - `web-dist/novnc/vnc.html`
   - **明确保持原样、不触碰的核心/资源文件（工程决策）**：`web-dist/assets/index-DwZEqr4A.js`（136 KB 核心入口含 Vue 运行时、Router、API 客户端与 `UiConfirmHost`）、`InstanceView-BQLVaoH-.js`、`BootVolumeView-BSTURY2P.js`、`NetworkView-B5MET1oN.js`、`LimitsView-C5U4Cjpk.js`、`TaskFormDialog...js`、`UiField...js`。这些视图通过下方 5.2.1 的 CSS Cascade Layer Token 桥接与 5.3.4 的轻量增强脚本自动获得完整 6 套主题与无障碍支持，最大程度降低对预编译 JS 的侵入风险。
3. **新增静态资源文件**：
   - `web-dist/assets/theme-system.css`：在 `web-dist/index.html` 中紧跟 `index-BbaPobom.css` 引入（加 `?v=20261125` 避免缓存陈旧）。
   - `web-dist/assets/ui-enhance.js`：轻量无依赖 ES 模块（约 40–60 行），在 `web-dist/index.html` 中引入，专门负责全局 `alertdialog` 的 `Escape` 协同关闭与全站纯图标按钮 `aria-label` 兜底。
4. **语法与运行时安全**：所有修改后的 ESM `.js` 文件必须通过 `node --check` 语法校验，且在无真实 OCI 凭证时可通过本地预览/Mock 验证所有视图与交互无控制台报错。

---

## 4. 方案对比与决策

| 维度 | 方案 A：无破坏式深度重构 `web-dist/`（**已选定**） | 方案 B：新建 `web/` Vue 3 + Vite 工程重写全部 12 个视图 |
|---|---|---|
| 业务与接口回归风险 | **极低**：保留 12 个视图原有状态机与 85+ API 调用，仅重构样式 Token 与精准 DOM 布局 | **高**：需重写并回归验证 85+ 接口与数十个复杂弹窗（SSH 生成、批量开机、IAM、安全组、WS 日志等） |
| 仓库与部署复杂度 | 保持零新增构建依赖，`wrangler deploy` 一键部署完全不变 | 需引入 Node/Vite/Tailwind 构建链并维护编译产物同步 |
| 视觉与结构自由度 | 可完整落地 3 套主题 × 双色、居中宽窄切换、OCI 卡片/列表、设置页双列、日志右侧抽屉与 VNC 皮肤统一 | 100% 自由，适合未来还要持续大规模新增业务模块时采用 |
| 上游 Sync 维护成本 | 90% 视觉集中在独立 `theme-system.css`，JS 补丁范围明确且集中在少量视图文件 | 彻底分叉，无法直接同步上游产物 |

**选定结论**：采用**方案 A**，以最低回归风险一次性解决全部已确认的视觉、宽度、卡片模式、多主题与重点页面结构问题。

---

## 5. 详细设计规范

### 5.1 偏好存储与零闪烁初始化契约

| `localStorage` Key | 允许值 | 默认值 | 绑定位置 |
|---|---|---|---|
| `oci_mini_style` | `"precision"` \| `"bento"` \| `"cockpit"` | `"precision"` | `<html data-style="...">` |
| `oci_mini_theme` | `"dark"` \| `"light"` | `"dark"` | `<html class="dark \| light">` + `color-scheme` |
| `oci_mini_width` | `"boxed"` \| `"wide"` | `"boxed"` | `<html data-width="...">` |
| `oci_mini_cfg_view` | `"card"` \| `"list"` | `"card"` | `CfgView` 视图模式 |
| `oci_mini_sidebar` | `"0"` \| `"1"` | `"0"` | `AppShell` 侧边栏收起状态（沿用） |

- **零闪烁启动**：`web-dist/index.html` 的 `<head>` 末尾（或 `<body>` 首行渲染 `#app` 之前）运行同步内联脚本，读取上述前 3 个键并写入 `document.documentElement`，对非法值自动回落默认值。
- **跨组件联动事件**：切换主题或明暗时，统一更新 DOM 属性、写入 `localStorage`，并派发 `window.dispatchEvent(new CustomEvent("oci-theme-change", { detail: { style, theme, width } }))`，供 `TrafficView`、`CostView` 的 ECharts 配置即时重绘。

---

### 5.2 三套风格主题 × 深/浅双色 Token 体系

所有语义 Token 统一定义在 `web-dist/assets/theme-system.css`，覆盖背景层、侧栏、卡片、浮层、边框、正文/次文/弱文、主色/悬停/主色字、危险/警告/成功语义色、圆角、阴影、字体与容器宽度：

#### 主题 1：`precision` — 精密云控台（默认 · Linear / Vercel 气质）
- **结构特征**：默认居中宽 `--shell-max-w: 1200px`；卡片圆角 `10px`，控件圆角 `8px`；干净的 1px 细边框与明确的三层灰阶，无极光光斑、无霓虹按钮发光；阴影极克制。
- **字体栈**：`--font-ui: "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`；`--font-code: "JetBrains Mono", ui-monospace, "Cascadia Mono", Consolas, monospace`。
- **深色色板**：
  - Page `#090D16` / Sidebar `#0C1220` / Surface `#111827` / Surface-2 `#182235` / Input `#0B1120`
  - Border `rgba(148, 163, 184, 0.16)` / Border-strong `rgba(148, 163, 184, 0.28)`
  - Text Primary `#F8FAFC` / Secondary `#CBD5E1` / Muted `#94A3B8`
  - Primary `#2563EB`（hover `#3B82F6`，On-Primary `#FFFFFF`，对比度 ≥ 5.1:1）
  - Success `#22C55E` / Warning `#F59E0B` / Danger `#EF4444`
- **浅色色板**：
  - Page `#F8FAFC` / Sidebar `#F1F5F9` / Surface `#FFFFFF` / Surface-2 `#F8FAFC` / Input `#FFFFFF`
  - Border `#E2E8F0` / Border-strong `#CBD5E1`
  - Text Primary `#0F172A` / Secondary `#334155` / Muted `#475569`
  - Primary `#1D4ED8`（hover `#1E40AF`，On-Primary `#FFFFFF`，对比度 ≥ 6.7:1）
  - Success `#15803D` / Warning `#B45309` / Danger `#DC2626`

#### 主题 2：`bento` — 现代 Bento 卡片工作台（Cloudflare / Apple 气质）
- **结构特征**：默认居中宽 `--shell-max-w: 1160px`；大圆角模块化卡片（卡片 `16px`，控件 `10px`），柔和层次阴影，卡片悬停带轻微抬升与边框提亮（`prefers-reduced-motion` 下关闭位移），顶部微弱清爽品牌色点缀。
- **字体栈**：`--font-ui: "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`；`--font-code: "JetBrains Mono", ui-monospace, Consolas, monospace`。
- **深色色板**：
  - Page `#0C111D` / Sidebar `#101828` / Surface `#161F30` / Surface-2 `#1D2939` / Input `#0E1525`
  - Border `rgba(255, 255, 255, 0.10)` / Border-strong `rgba(255, 255, 255, 0.18)`
  - Text Primary `#F9FAFB` / Secondary `#D0D5DD` / Muted `#98A2B3`
  - Primary `#2563EB`（hover `#3B82F6`，On-Primary `#FFFFFF`）；Brand Warm Accent `#FB923C`（用于图标/高亮徽章/当前激活指示）
  - Success `#34D399` / Warning `#FBBF24` / Danger `#F87171`
- **浅色色板**：
  - Page `#F3F5F9` / Sidebar `#FFFFFF` / Surface `#FFFFFF` / Surface-2 `#F8FAFC` / Input `#FFFFFF`
  - Border `#E2E8F0` / Shadow `0 1px 3px rgba(15,23,42,0.06), 0 8px 24px -14px rgba(15,23,42,0.12)`
  - Text Primary `#0F172A` / Secondary `#334155` / Muted `#475569`
  - Primary `#2563EB`（hover `#1D4ED8`，On-Primary `#FFFFFF`）；Brand Warm Accent `#C2410C`（文本/徽章对比度 ≥ 5.1:1）
  - Success `#047857` / Warning `#B45309` / Danger `#DC2626`

#### 主题 3：`cockpit` — Ops 运维驾驶舱（极客终端气质）
- **结构特征**：默认居中宽 `--shell-max-w: 1280px`；卡片圆角 `8px`，控件圆角 `6px`；深邃石板底配细微战术网格/冷调边框，强调状态指示灯、等宽数据密度与终端一致性，与实时日志流和 noVNC 风格无缝衔接。
- **字体栈**：`--font-ui: "Fira Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`；`--font-code: "Fira Code", "JetBrains Mono", ui-monospace, Consolas, monospace`。
- **深色色板**：
  - Page `#070B14` / Sidebar `#0B1220` / Surface `#10192B` / Surface-2 `#162238` / Input `#080E1A`
  - Border `rgba(56, 189, 248, 0.16)` / Border-strong `rgba(34, 197, 94, 0.35)`
  - Text Primary `#F1F5F9` / Secondary `#CBD5E1` / Muted `#94A3B8`
  - Primary `#22C55E`（hover `#4ADE80`，On-Primary `#052E16`，对比度 ≥ 8.3:1）
  - Info `#38BDF8` / Warning `#F59E0B` / Danger `#EF4444`
- **浅色色板**：
  - Page `#EFF3F8` / Sidebar `#E5ECF4` / Surface `#FFFFFF` / Surface-2 `#F4F7FB` / Input `#FFFFFF`
  - Border `#CBD5E1` / Border-strong `#94A3B8`
  - Text Primary `#0F172A` / Secondary `#334155` / Muted `#475569`
  - Primary `#047857`（hover `#065F46`，On-Primary `#FFFFFF`，对比度 ≥ 5.4:1）
  - Info `#0369A1` / Warning `#B45309` / Danger `#DC2626`

#### 5.2.1 CSS Cascade Layer 零 `!important` 全站主题桥接（设计决策）
未修改的 7 个 JS chunk（含 `InstanceView`、`NetworkView`、`BootVolumeView`、`LimitsView`、`index-DwZEqr4A.js` 等）以及保留的次级弹窗内仍存在硬编码深色 Tailwind 工具类（如 `.text-white`、`.text-slate-200..600`、`.bg-white\/\[0\.03\]`、`.border-white\/\[0\.06\]`、`.divide-white\/\[0\.06\]`、`.ring-white\/10`、`bg-ink-900/*`）。
- **桥接机制**：利用 `index-BbaPobom.css` 中全部 Tailwind v4 工具类位于 `@layer utilities` 的原生层叠特性，在 `theme-system.css` 中使用**无层（unlayered）精确类选择器**将上述深色工具类统一映射到语义 Token（`var(--text-primary)`、`var(--surface-2)`、`var(--border)` 等），**全程不使用 `!important`**，即可让全部 12 个视图无缝支持 3 套风格 × 深/浅双色。
- **必须遵守的安全豁免清单**：
  1. **TOTP 二维码白底**：不得覆盖纯 `.bg-white`（仅映射半透明 `.bg-white\/[...]` 表面类），确保 `SettingsView` 中 `img.bg-white` 二维码在所有深色主题下始终保持高对比纯白底。
  2. **主色实底容器内的前景文字/图标**：`.ui-btn-primary`、`.brand-mark`、`.bg-gradient-to-r` / `.bg-gradient-to-br`（如保留的图标底块）及 `[role="alertdialog"]` 主确认按钮内的文字/图标显式使用 `var(--color-on-primary)` 或 `#FFFFFF`，不受浅色模式 `.text-white → var(--text-primary)` 映射影响。
  3. **实时日志暗色终端**：`.log-panel` 及其内部日志行、时间戳、级别高亮保持独立终端 Token（深色底 + 高可读语法色），浅色模式下依然清晰专业，不被浅色文字映射冲淡。
  4. **低字号暗灰兜底**：通过精确选择器将全站过暗的 `.text-slate-600` 映射到保证对比度达标的 `var(--text-muted)`，并提升 `10px` 关键元数据（如 OCID、表头、提示）至 `11px–12px` 可读下限。

---

### 5.3 基础控件与无障碍统一规则

1. **按钮状态（`UiButton` + `theme-system.css`）**：
   - `primary` 使用当前主题 `--color-primary` / `--color-on-primary`，彻底移除高饱和荧光青蓝渐变和过重投影。
   - **禁用态（`:disabled`）**：在深色和浅色模式下均采用明确去饱和的灰底灰字（`var(--btn-disabled-bg)` / `var(--btn-disabled-fg)`），与可用主按钮形成清晰视觉区分，杜绝浅色模式下“禁用按钮依然亮蓝”的问题。
   - 所有可点击按钮强制 `cursor: pointer`，悬停过渡 `150ms–200ms`，统一 `focus-visible` 2px 高对比外轮廓。
2. **自定义复选框**：在 `theme-system.css` 中对 `input[type="checkbox"]` 应用自定义 `appearance: none` 样式（匹配主题底色、边框、圆角、选中态主色与 SVG 白色/深色对勾），彻底消除深色模式下刺眼的原生白方块。
3. **无障碍基线**：
   - 顶栏、侧栏折叠按钮、关闭 `×` 按钮、删除图标按钮补齐语义化 `aria-label`（与 `title` 并存）。
   - `UiDialog` 支持 `Escape` 键关闭、点击遮罩关闭、`role="dialog"` + `aria-modal="true"`，打开后聚焦容器或首控元素、关闭时恢复焦点到触发按钮；且当顶层存在 `[role="alertdialog"]`（如弹窗内触发二次删除确认）时，`UiDialog` 的 `Escape` 监听自动让位，绝不误关底层弹窗。
   - `prefers-reduced-motion: reduce` 下禁用位移、缩放、过渡与脉冲动画。
   - 最小可读字号控制：核心正文 ≥ `13px–14px`，辅助元数据 ≥ `11px–12px`（不再使用几乎看不清的低对比 `10px` 暗灰字）。
4. **全局确认框与全站无障碍增强（`web-dist/assets/ui-enhance.js`，设计决策）**：
   - **保持 `index-DwZEqr4A.js` 零修改**：`UiConfirmHost`（`[role="alertdialog"]`）的外观（顶条渐变、主确认按钮、阴影、面板底色、次要按钮）通过 `theme-system.css` 中的 `[role="alertdialog"]` 精确样式同步适配 3 套主题 × 双色，移除硬编码天蓝渐变。
   - **轻量 `ui-enhance.js` 负责三件事**：
     1. 监听 `keydown(Escape)`：当 DOM 中存在可见的 `[role="alertdialog"]` 时，优先触发其关闭/取消按钮并阻止向下冒泡，确保确认弹窗支持 `Escape` 且与底层 `UiDialog` 嵌套不冲突；
     2. 监听弹窗打开/关闭，为 `[role="alertdialog"]` 自动补齐打开聚焦与关闭后恢复触发焦点；
     3. 通过轻量 `MutationObserver` 扫描全站（覆盖未修改的 `InstanceView` / `BootVolumeView` / `NetworkView` / `LimitsView` / `UiConfirmHost`）无可见文本的纯图标 `<button>`，自动将 `title` 镜像为 `aria-label`（并给无 `title` 的纯图标删除/关闭按钮补齐语义标签），在不触碰 7 个额外压缩 JS 文件的前提下达成全站一致无障碍基线。

---

### 5.4 核心页面与组件改造详规

#### 1. 全局壳层（`AppShell-D9QnCYdV.js`）
- **居中容器与宽窄切换**：
  - `<main>` 滚动区内包一层 `.shell-container`：`width: 100%; margin-inline: auto;`。
  - 当 `html[data-width="boxed"]` 时，`max-width: var(--shell-max-w)`；当 `html[data-width="wide"]` 时，`max-width: 100%`。
  - 顶栏右侧（桌面端 `md+`）增加「居中 / 宽屏」切换图标按钮（带 tooltip 与 `aria-label`，如 `切换为宽屏布局` / `切换为居中布局`）。
- **随时切换主题的浮层选择器**：
  - 顶栏新增「风格主题」按钮（调色板图标 + 当前主题简称，桌面端显示简称、小屏仅图标），点击打开轻量浮层菜单（点击外部或按 `Escape` 关闭）：
    - 3 个风格卡片项（精密云控台 / Bento 工作台 / Ops 驾驶舱），每项带 3 色预览圆点（背景/卡片/主色）+ 一句话气质说明 + 当前勾选态；
    - 浮层底部顺带展示「明暗模式（深色 / 浅色）」与「内容宽度（居中 / 宽屏）」快捷分段开关；
  - 顶栏仍保留独立的日/月明暗一键切换按钮，高频操作一步直达。
  - 移动端抽屉菜单同步加入 3 套风格主题分段选择器，手机端也能随时切换。
- **顶栏对齐**：顶栏内部也受同源容器最大宽度对齐（或保持全宽边栏分割、内容区居中对齐，保证视觉规整不飘散）。

#### 2. OCI 配置管理页（`CfgView-BJjU6PMD.js`）
- **工具栏重构**：
  - 左侧：搜索框（`w-full sm:w-64`）+ 状态统计胶囊（有效 / 失效 / 未校验，紧凑高对比）+ 批量操作组（全选、一键测活、批量开机、刷新）。
  - 右侧：分段式视图切换器 **`[⊞ 卡片 | ☰ 列表]`**（支持 `aria-pressed`，状态持久化到 `oci_mini_cfg_view`）+ 主按钮 **`+ 新增配置`**。
- **卡片模式（默认，`viewMode === "card"`）**：
  - 容器采用响应式网格 `.cfg-grid`：移动端 1 列、平板 2 列（`≥ 768px`）、桌面居中宽 3 列（`≥ 1100px`，宽屏模式可自然扩至 3–4 列 `repeat(auto-fill, minmax(330px, 1fr))`）。
  - 每张卡片 `.cfg-card` 分三层清晰结构（移除重复的绿色对勾图标，状态由统一徽章 + 状态点表达）：
    1. **Header**：自定义复选框 + 账号名称（点击进入租户详情）+ 状态徽章（已连接/不可用/未校验）+ 套餐徽章（免费号/升级号/未知 + 紧凑刷新图标按钮）。
    2. **Meta Grid（2×2 结构化信息格子）**：
       - 区域：`region` 等宽代码（多区时显示 `+N 区` 标签）
       - 租户：脱敏租户名 + 显隐眼图标按钮
       - 抢机任务：总数（运行中高亮）
       - 校验 / 创建：上次校验时间（未校验时琥珀提示）与租户创建时间
    3. **Footer 操作条**：左侧主按钮「进入」，中部次按钮「详情 / 测活 / 编辑」，右侧独立危险按钮「删除」（带 `aria-label="删除配置"`，降低误触风险）。
- **列表模式（`viewMode === "list"`）**：
  - 保留紧凑多行管理体验，但重构内部排版为清晰的左（勾选 + 名称 + 状态/套餐）、中（等宽区域 + 租户 + 任务 + 校验，去掉多余背景胶囊噪音）、右（固定宽度操作组）结构，窄屏平滑折行且操作按钮组整洁对齐。

#### 3. 租户详情与子视图（`CfgDetailView`、`TenantView`、`TrafficView`、`CostView`）
- **`CfgDetailView-Dlm4x8bL.js`**：
  - 将原先分散的「账号栏 + 全局范围栏」整合为一张紧凑的**租户上下文头卡**（上行：返回按钮 + 名称 + 状态徽章 + 区域/多区数 + 可一键复制的高对比 OCID + 紧凑图标按钮「刷新配置信息」；下行：全局区域/区间选择器紧凑排布），减少垂直冗余并消除与子页「刷新」按钮的视觉重复。
  - 下方 7 个子标签改为风格适配的精致下划线/胶囊标签栏，与内容区等宽对齐。
- **`TenantView-CESpkrmJ.js`**：
  - 优化 `租户信息` 卡片为紧凑 2–3 列元数据格；`租户级设置` 与 `已订阅区域` 在宽屏下合并为响应式 2 列并排区块（或各自收紧比例），避免单条短内容撑满 1200px 整行。
- **`TrafficView-gyV2LYjA.js` & `CostView-DMCrmlrj.js`**：
  - `TrafficView` 筛选栏移除与顶部全局范围重复的「区域」下拉框，改为只读当前区域标签提示（仍完全通过 `useCfgScope` 联动顶部全局区域切换，不破坏任何接口逻辑）。
  - 两个视图的 ECharts `option` 动态读取 CSS Token（或监听 `oci-theme-change` 事件响应式刷新），使坐标轴文字、网格线、图例和柱状图色系在 3 套主题 × 深/浅模式下均清晰高对比。

#### 4. 系统设置页（`SettingsView-w1Y9UJLA.js`）
- TOTP、Telegram 通知、Google 一键登录卡片内的说明段落设置最大阅读行宽（`max-width: 72ch`），提升长段说明的可读性；TOTP 底部操作按钮区收紧对齐，避免左右跨屏漂移。
- **底部 6 张密钥配置项（MFA 密钥、认证器名称、TG Bot Token、TG Chat ID、放货面板 Token、Cloudflare API Token）**：由单个全宽列表重构为**响应式双列卡片网格**（`.settings-secrets-grid`：桌面 `≥ 900px` 为 2 列，每项独立卡片，输入框自适应拉满剩余宽度，彻底消除右侧 800px 空白黑洞；小屏自然单列）。

#### 5. 任务管理与实时日志（`TaskManageView-C7VfWf-q.js` + `UiDialog`）
- `UiDialog` 新增可选属性 `variant`（`"modal"` 默认 | `"drawer"`）：
  - `drawer` 模式下，在 `≥ 768px` 屏幕从右侧滑出（宽度 `min(680px, 92vw)`，全高 `100vh`，日志区自适应铺满剩余高度 `flex-1`），遮罩更轻透，不再把用户压在屏幕中央小框里看日志；小屏自动铺满视口。
  - 统一补充 `Escape` 键监听、焦点恢复和关闭按钮 `aria-label="关闭"`。
- `AppLogPanel` 启用 `variant="drawer"`，日志终端保持独立暗色等宽代码区（随主题微调边框和状态高亮色，保证浅色模式下日志依然专业易读）。
- 优化 `TaskManageView` 顶栏筛选与操作条间距，与居中容器协调。

#### 6. Cloudflare DNS（`CloudflareView-Dzih7xW-.js`）
- 顶部状态条收紧为轻量紧凑横幅（单行高度更克制），减少垂直占位。
- 右侧 DNS 记录表移除 `max-w-[280px]` 对「内容」列的过度硬截断，改为弹性列宽分配，给长 TXT / DKIM / SPF 值更舒适的展示空间（仍保留悬停完整 `title`）。

#### 7. 登录页与 noVNC 终端（`LoginView-BU-WcVZj.js`、`web-dist/novnc/vnc.html`）
- `LoginView` 复用同一套主题背景与卡片 Token，右上角提供轻量的「主题风格 + 明暗模式」快捷切换，让未登录状态也能体验一致的视觉设计。
- `web-dist/novnc/vnc.html` 启动时读取 `localStorage` 中的 `oci_mini_style` 与 `oci_mini_theme`，动态为 `<html>` 写入相同的 `data-style` 与 `dark/light` 类，并映射工具栏、按钮、状态条、快捷按键与虚拟键盘配色，使远程控制台与主面板浑然一体。

---

## 6. 留给实现者决定的事项（Left to the Builder）

以下细节无需反复向用户确认，由实现者在编写计划与代码时按 `ui-ux-pro-max` 原则自行把握：
1. `theme-system.css` 内部具体 CSS 变量与语义类命名规范（保证零命名冲突、易读可维护）。
2. 主题切换图标与卡片/列表切换图标的具体 Lucide 节点路径（复刻项目中已使用的 `@lucide/vue` 风格即可，严禁使用 Emoji 替代图标）。
3. 微交互过渡曲线与时长（控制在 `150ms–220ms`，遵循 `prefers-reduced-motion`）。
4. 主题切换浮层的具体定位细节、键盘方向键/Tab 交互细节及移动端触控热区尺寸（≥ 40–44px）。
5. 本地预览与自动化/浏览器视觉验收脚本的组织方式（验收完成后不留临时垃圾文件在仓库内）。

---

## 7. 验收标准

1. **多主题与零闪烁**：3 套风格 × 深/浅模式共 6 种状态均可随时一键切换并刷新保持，首屏无闪烁；切换后主面板、登录页、ECharts 图表与 `novnc/vnc.html` 风格同步一致。
2. **宽度与响应**：桌面 `1440px+` 默认居中显示（`1160–1280px`），可一键切宽屏；`390px` 移动端无横向滚动条、无按钮溢出或严重折行混乱。
3. **OCI 卡片/列表模式**：`/cfgs` 默认卡片模式，可一键切换列表模式并刷新记住；卡片与列表的勾选、测活、批量开机、查看租户名、刷新套餐、进入/详情/编辑/删除功能全部正常。
4. **重点页面重构**：设置页 6 张密钥卡在桌面端双列排布无大块空洞；租户详情头紧凑清晰、无重复区域下拉框；任务实时日志在桌面端以右侧抽屉打开且支持 `Escape` 关闭。
5. **代码与无障碍质量**：所有编辑后的 JS 文件通过 `node --check`；浅色模式彻底无旧版 `!important` 补丁残影与亮蓝禁用按钮；深色模式 checkbox 样式统一；浏览器控制台无新增报错。
