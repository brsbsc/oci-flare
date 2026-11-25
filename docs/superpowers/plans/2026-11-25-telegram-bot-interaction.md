# Telegram Bot Interactive Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add secure, non-blocking Telegram Bot bidirectional interaction (`/start`, `/help`, `/status`, `/cfgs`, `/tasks` + inline keyboard actions for check, task pause/resume/run, instance start/stop/reboot/change-IP) via Cloudflare Workers Webhook and a one-click Webhook toggle in `SettingsView`.

**Architecture:** Place all Telegram Bot logic, formatting, security checks, and `/api/tg/webhook` + `/api/tg/webhook-config` handlers in a clean standalone ESM module `dist/tg-bot.js`. Add a minimal ~15-line hook in `dist/index.js` so `dist/tg-bot.js` reuses the existing 87 Hono `/api/*` routes through short-lived internal tokens with real `ctx` passthrough (`ctx.waitUntil`). Enhance `web-dist/assets/SettingsView-w1Y9UJLA.js` to display Webhook status and provide one-click enable/disable using the existing exported `getToken` (`U`) from `index-DwZEqr4A.js`.

**Tech Stack:** Cloudflare Workers ESM (`dist/tg-bot.js`, `dist/index.js`), Hono, Web Crypto API (`SHA-256`, `getRandomValues`), D1 (`sys_cfg` table), Telegram Bot HTTP API (`setWebhook`, `deleteWebhook`, `getWebhookInfo`, `setMyCommands`, `sendMessage`, `editMessageText`, `answerCallbackQuery`), Vue 3 pre-compiled chunk (`SettingsView-w1Y9UJLA.js`), Node.js built-in test runner (`node --test`).

**Spec:** [docs/superpowers/specs/2026-11-25-telegram-bot-interaction-design.md](../../specs/2026-11-25-telegram-bot-interaction-design.md)

## Global Constraints

- Do NOT modify `wrangler.toml`, `wrangler.import.toml`, `package.json`, `migrations/`, `web-dist/assets/index-DwZEqr4A.js`, or the 6 untouched frontend resource chunks (`InstanceView`, `BootVolumeView`, `NetworkView`, `LimitsView`, `TaskFormDialog`, `UiField`).
- Do NOT introduce new npm dependencies or new D1 tables (store webhook secret/url and `tg.imap:<cfgId>` in existing `sys_cfg` table).
- Keep `notify.tg_chat_id` single-ID semantics untouched so existing one-way `sendTelegram` notifications never regress.
- Keep `dist/index.js` modifications strictly minimal (~15 lines: top import, 2 `SYS_DEFS` entries, `PUBLIC_API_PATHS` entry for `"/api/tg/webhook"`, `registerTgBot(...)` call right before `app.notFound`, and optional `tg.imap:` cleanup in `cleanupTempData`).
- Every generated Telegram `callback_data` MUST be ≤ 64 UTF-8 bytes (target ≤ 38 bytes).
- Never expose destructive actions (delete config, terminate instance, delete task) or sensitive secrets (private keys, root passwords, webhook secret, bot token) in Telegram replies.
- All JavaScript files (`dist/index.js`, `dist/tg-bot.js`, `scripts/cf-deploy.mjs`, `web-dist/assets/*.js`) must pass `node --check`.

## Review Focus

1. **Constant-time secret verification & unauthorized callers:** Missing, wrong, or different-length `X-Telegram-Bot-Api-Secret-Token` returns `401`; non-matching `chat_id` or `from.is_bot === true` silently returns `200 { ok: true }` with zero Telegram API calls and zero internal API calls (pinned in Task 1).
2. **Non-blocking `waitUntil` & duplicate `update_id` idempotency:** Webhook returns HTTP `200` immediately while delegating slow OCI actions to `c.executionCtx.waitUntil(...)`; a retried identical `update_id` is deduplicated and does not re-execute state-changing operations (pinned in Task 1 & Task 2).
3. **64-byte `callback_data` ceiling & stale-button fallback:** Every button generated across status, configs, instances (with 85+ byte OCI OCIDs), tasks, and confirmations is ≤ 64 bytes; clicking an instance button when `tg.imap:<cfgId>` cache is absent automatically fetches `GET /api/cfgs/:cfgId/instances`, matches by `shortInstanceId(inst.id)`, and completes the action (pinned in Task 2).
4. **Two-step confirmation & HTML injection / length safety:** Instance `SOFTSTOP`, `SOFTRESET`, `change-ip`, and IP-task `resume` (`paused -> running`) / `run` must render a confirmation view before mutating; dynamic config/instance names containing `<script>&"` are HTML-escaped and replies exceeding 3800 chars are truncated cleanly (pinned in Task 2).
5. **Non-shadowed Webhook management route & resilient `DELETE`:** `DELETE /api/tg/webhook-config` is handled by `tg-bot.js` (never swallowed by `DELETE /api/sys/:key`) and still clears local `tg.webhook_secret` + `tg.webhook_url` even if Telegram `deleteWebhook` throws (pinned in Task 1 & Task 3).

---

### Task 1: Core Telegram Bot Security, Helpers & Webhook Management API

**Files:**
- Create: `dist/tg-bot.js`
- Test: `tests/tg-bot.test.mjs`

**Interfaces:**
- Consumes: `deps = { sysGet(env, key), sysSet(env, key, value), authSecret(env), authVersion(env), issueToken(secret, version, ttlSeconds), nowIso() }`
- Produces (exported from `dist/tg-bot.js`):
  - `constantTimeEqual(a: string, b: string): boolean`
  - `escapeHtml(text: unknown): string`
  - `truncateTelegramText(text: string, maxLen?: number): string`
  - `shortInstanceId(ocid: string): Promise<string>` (8 lowercase hex chars via SHA-256)
  - `parseCallbackData(raw: string): { scope: string, action: string, args: string[] } | null`
  - `registerTgBot(app, deps): void` — mounts:
    - `POST /api/tg/webhook` (authenticated via `X-Telegram-Bot-Api-Secret-Token` + single `notify.tg_chat_id`, deduplicates `update_id`, dispatches via `c.executionCtx.waitUntil`)
    - `GET /api/tg/webhook-config`
    - `POST /api/tg/webhook-config`
    - `DELETE /api/tg/webhook-config`
  - `handleTelegramUpdate(update, env, ctx, app, deps, tgFetch?)`: exported testable dispatcher (Task 2 extends command & callback handlers inside it)

- [ ] **Step 1: Write failing unit tests in `tests/tg-bot.test.mjs`**

Cover:
1. `constantTimeEqual` matches identical strings and rejects mismatched or different-length strings.
2. `escapeHtml` escapes `&`, `<`, `>` and handles `null`/`undefined`; `truncateTelegramText` caps length at ≤ 3800 chars with ellipsis.
3. `shortInstanceId` produces deterministic 8-char lowercase hex for ~88-byte OCI OCIDs.
4. `POST /api/tg/webhook`:
   - Rejects missing/wrong `X-Telegram-Bot-Api-Secret-Token` with `401`.
   - Silently returns `200 { ok: true }` with zero fetch/internal calls for non-matching `chat_id` or `from.is_bot === true`.
   - Returns `200 { ok: true }` immediately via `ctx.waitUntil(...)` for valid secret + authorized `chat_id`, and ignores duplicate `update_id`.
5. `GET / POST / DELETE /api/tg/webhook-config`:
   - `POST` returns `400` if `notify.tg_bot_token` or `notify.tg_chat_id` is missing, or if origin is not `https://`.
   - `POST` generates 64-hex `tg.webhook_secret`, calls Telegram `setWebhook` (`url`, `secret_token`, `allowed_updates: ["message", "callback_query"]`, `drop_pending_updates: true`) and `setMyCommands` (`/start`, `/status`, `/cfgs`, `/tasks`, `/help`), persists `tg.webhook_url` and returns `{ ok: true, enabled: true, webhookUrl }`.
   - `GET` returns status including `telegramInfo` from `getWebhookInfo` (and does not fail if `getWebhookInfo` network call rejects).
   - `DELETE` calls `deleteWebhook` and clears `tg.webhook_secret` + `tg.webhook_url` even if Telegram `deleteWebhook` fails.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/tg-bot.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `dist/tg-bot.js`.

- [ ] **Step 3: Implement Task 1 foundation in `dist/tg-bot.js`**

Implement the pure utilities (`constantTimeEqual`, `escapeHtml`, `truncateTelegramText`, `shortInstanceId`, `parseCallbackData`), `callTelegramApi(token, method, payload, tgFetch)` (with `AbortSignal.timeout(10000)` and silent handling for `"message is not modified"`), `callInternalApi(app, deps, env, ctx, path, opts)` (using 60s `issueToken` and forwarding real `ctx`), bounded in-memory `Set` deduper for recent `update_id` (cap 500 entries), `GET / POST / DELETE /api/tg/webhook-config`, `POST /api/tg/webhook`, and initial `handleTelegramUpdate` skeleton responding to `/start` and `/help`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/tg-bot.test.mjs`
Expected: All Task 1 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add dist/tg-bot.js tests/tg-bot.test.mjs
git commit -m "feat(tg-bot): add core security primitives, webhook handler, and webhook config API"
```

---

### Task 2: Commands (`/status`, `/cfgs`, `/tasks`) & Full Inline Keyboard Workflows

**Files:**
- Modify: `dist/tg-bot.js`
- Test: `tests/tg-bot.test.mjs`

**Interfaces:**
- Consumes: Task 1 `callTelegramApi`, `callInternalApi`, `shortInstanceId`, `escapeHtml`, `truncateTelegramText`, `parseCallbackData`, `sysGet`/`sysSet`
- Produces: Complete `handleTelegramUpdate` supporting:
  - Commands: `/start`, `/help`, `/status`, `/cfgs`, `/tasks` (tolerating `@BotUsername` suffix such as `/status@my_bot`)
  - Config callbacks: `m:home`, `m:st`, `c:ls:<page>`, `c:v:<cfgId>`, `c:chk:<cfgId>`, `c:ins:<cfgId>:<page>`
  - Instance callbacks: `i:v:<cfgId>:<short8>`, `i:ask:<op>:<cfgId>:<short8>`, `i:do:<op>:<cfgId>:<short8>` (`op` ∈ `st`→`START`, `sp`→`SOFTSTOP`, `rs`→`SOFTRESET`, `ip`→`change-ip`)
  - Task callbacks: `t:ls:<l|p>:<page>`, `t:v:<l|p>:<taskId>`, `t:tog:<l|p>:<taskId>` (pauses/resumes launch tasks directly; pauses running IP tasks directly), `t:run:l:<taskId>`, `t:ask:<run|res>:<taskId>`, `t:do:<run|res>:<taskId>`
  - `resolveInstanceByShortId(app, deps, env, ctx, cfgId, short8)`: reads `sys_cfg['tg.imap:' + cfgId]`; on cache miss/expired, refreshes via `GET /api/cfgs/:cfgId/instances`, persists refreshed map, and resolves by `shortInstanceId(inst.id)`.

- [ ] **Step 1: Add failing behavioral tests to `tests/tg-bot.test.mjs`**

Add tests using a mocked `app.fetch` + in-memory D1 `sys_cfg` + recorded Telegram API calls verifying:
1. `/status` (and `/status@MyOciBot`) aggregates `/api/cfgs?page=1&pageSize=100`, `/api/tasks?type=launch&page=1&pageSize=100`, `/api/ip-tasks?page=1&pageSize=100`, escapes HTML special chars in names, renders counts & inline buttons, and every button's UTF-8 byte length is ≤ 64 bytes.
2. `/cfgs` → `c:v:<cfgId>` → `c:chk:<cfgId>` calls `answerCallbackQuery` first, shows loading state, calls `POST /api/cfgs/:id/check`, and edits message with check result.
3. `c:ins:<cfgId>:1` calls `GET /api/cfgs/:id/instances`, persists `tg.imap:<cfgId>`, renders 8-char shortId buttons (all ≤ 64 bytes even for 88-byte OCIDs), and shows config region in header.
4. Instance operations:
   - `i:do:st:<cfgId>:<short8>` executes `POST /api/cfgs/:id/instances/:ocid/action` with `{ action: "START" }` directly.
   - `i:ask:sp:...`, `i:ask:rs:...`, `i:ask:ip:...` render confirmation keyboards WITHOUT firing any OCI mutation; confirming via `i:do:sp:...` / `i:do:rs:...` / `i:do:ip:...` executes `SOFTSTOP` / `SOFTRESET` / `POST .../change-ip` respectively.
   - Stale-button fallback: deleting `tg.imap:<cfgId>` from D1 and sending `i:v:<cfgId>:<short8>` or `i:do:st:<cfgId>:<short8>` triggers automatic fallback `GET /api/cfgs/:id/instances`, resolves exact OCID, and succeeds.
5. Tasks workflow:
   - `/tasks` lists launch tasks; switching tab `t:ls:p:1` lists IP tasks.
   - Launch task `t:tog:l:<taskId>` toggles `running <-> paused` via `PATCH /api/tasks/:id`; `t:run:l:<taskId>` calls `POST /api/tasks/:id/run`.
   - IP task: running task shows direct pause (`t:tog:p:<taskId>` → `PATCH /api/ip-tasks/:tid` `{ status: "paused" }`); paused task shows confirmation button (`t:ask:res:<taskId>`) which does NOT mutate until confirmed via `t:do:res:<taskId>`; immediate run button (`t:ask:run:<taskId>`) does NOT mutate until confirmed via `t:do:run:<taskId>` (`POST /api/ip-tasks/:tid/run`).
6. Security hygiene: no generated reply contains private keys, root password, bot token, or webhook secret; unknown/malformed `callback_data` answers callback gracefully without throwing.

- [ ] **Step 2: Run test to verify new tests fail**

Run: `node --test tests/tg-bot.test.mjs`
Expected: New Task 2 tests FAIL while Task 1 tests PASS.

- [ ] **Step 3: Implement command & callback workflows in `dist/tg-bot.js`**

Implement clean view renderers (page size 5 for configs, instances, and tasks), `resolveInstanceByShortId` with `tg.imap:<cfgId>` persistence + fallback, instant `answerCallbackQuery` + loading `editMessageText` + final result update, and all 14 callback routes.

- [ ] **Step 4: Run tests to verify all pass**

Run: `node --test tests/tg-bot.test.mjs`
Expected: All Task 1 + Task 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add dist/tg-bot.js tests/tg-bot.test.mjs
git commit -m "feat(tg-bot): implement /status, /cfgs, /tasks commands and inline keyboard workflows"
```

---

### Task 3: Minimal Hook in `dist/index.js` & Real-Router Integration Verification

**Files:**
- Modify: `dist/index.js:1`, `dist/index.js:202248`, `dist/index.js:203646`, `dist/index.js:205415`, `dist/index.js:205444`
- Modify: `tests/vnc-theme.test.mjs`
- Test: `tests/tg-bot.test.mjs`

**Interfaces:**
- Consumes: `registerTgBot(app, deps)` from `./tg-bot.js`
- Produces: Mounted live Worker routes `/api/tg/webhook` (public, secret-token guarded) and `GET/POST/DELETE /api/tg/webhook-config` (Bearer-token guarded, never shadowed by `DELETE /api/sys/:key`), plus `tg.imap:` >7-day cleanup in `cleanupTempData`.

- [ ] **Step 1: Add failing integration & boundary assertions**

In `tests/tg-bot.test.mjs`:
- Assert `dist/index.js` imports `registerTgBot` from `./tg-bot.js`, registers `tg.webhook_secret` (secret+hidden) & `tg.webhook_url` (hidden) in `SYS_DEFS`, includes `"/api/tg/webhook"` (and NOT `"/api/tg/webhook-config"`) in `PUBLIC_API_PATHS`, and invokes `registerTgBot(app, ...)`.
- Import the real Worker `default` export from `../dist/index.js` in Node with a mocked D1 `env` (`KEY_SECRET`, `AUTH_SECRET`, `AUTH_PASSWORD`, in-memory `DB`) and exercise real Hono routing end-to-end:
  - `GET /api/tg/webhook-config` without Bearer token → `401`.
  - `POST /api/tg/webhook` without secret header → `401` (not `404` and not Bearer-rejected).
  - Login / obtain token, then `DELETE /api/tg/webhook-config` → hits `tg-bot.js` handler (clears `tg.webhook_secret` and `tg.webhook_url`, NOT swallowed by `DELETE /api/sys/:key`!).

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/tg-bot.test.mjs`
Expected: New integration tests FAIL because `dist/index.js` does not yet mount `registerTgBot`.

- [ ] **Step 3: Apply the minimal ~15-line hook in `dist/index.js` and update `tests/vnc-theme.test.mjs`**

1. In `dist/index.js`:
   - Line 1: `import { registerTgBot } from "./tg-bot.js";`
   - In `SYS_DEFS` (after `dns.cf_token`): add `{ key: "tg.webhook_secret", label: "Telegram Webhook Secret", secret: true, hidden: true }` and `{ key: "tg.webhook_url", label: "Telegram Webhook URL", secret: false, hidden: true }`.
   - In `PUBLIC_API_PATHS`: add `"/api/tg/webhook"`.
   - Right before `app.notFound(...)`: call `registerTgBot(app, { sysGet, sysSet, authSecret, authVersion, issueToken, nowIso: nowIso2 });`.
   - In `cleanupTempData(env)`: add a safe `try/catch` cleanup removing `tg.imap:%` rows older than 7 days (`updated_at`).
2. In `tests/vnc-theme.test.mjs`:
   - Remove `"dist/index.js"` from the UI-redesign untouched list (keeping `wrangler.toml`, `wrangler.import.toml`, `package.json`, `index-DwZEqr4A.js`, and all 6 untouched frontend views strictly byte-identical).
   - Add `node --check` assertions for `dist/index.js`, `dist/tg-bot.js`, and `scripts/cf-deploy.mjs`.

- [ ] **Step 4: Run full test suite to verify green**

Run: `node --test tests/*.test.mjs`
Expected: ALL tests PASS (including real-Worker Hono routing integration tests and `node --check` on `dist/index.js` & `dist/tg-bot.js`).

- [ ] **Step 5: Commit**

```bash
git add dist/index.js tests/tg-bot.test.mjs tests/vnc-theme.test.mjs
git commit -m "feat(tg-bot): wire registerTgBot into Worker dist/index.js with Hono routing tests"
```

---

### Task 4: Web UI One-Click Webhook Toggle (`SettingsView`) & README Documentation

**Files:**
- Modify: `web-dist/assets/SettingsView-w1Y9UJLA.js`
- Modify: `README.md`
- Test: `tests/settings-tasks-cf.test.mjs`

**Interfaces:**
- Consumes: `GET /api/tg/webhook-config`, `POST /api/tg/webhook-config`, `DELETE /api/tg/webhook-config`; `U` (`getToken`) already exported from `./index-DwZEqr4A.js`
- Produces: In `SettingsView`'s「Telegram 通知」section:
  - Status `UiBadge` showing `交互已开启` (`green`) / `交互未开启` (`slate`)
  - Button「开启 TG 交互」/「关闭 TG 交互」calling `POST` / `DELETE /api/tg/webhook-config` with loading state, error toast, and auto-refresh of status
  - Compact status line showing registered `webhookUrl` (and `telegramInfo.lastErrorMessage` in amber/rose tone if present, never showing secret token)

- [ ] **Step 1: Add failing assertions to `tests/settings-tasks-cf.test.mjs`**

Assert `SettingsView-w1Y9UJLA.js`:
- Calls `/api/tg/webhook-config` (supports GET, POST, DELETE with Bearer token from `index-DwZEqr4A.js` export `U`)
- Renders TG interaction status badge (`交互已开启` / `交互未开启`) and enable/disable button (`开启 TG 交互` / `关闭 TG 交互`)
- Still preserves `settings-secrets-grid`, `settings-prose`, `rounded-lg bg-white p-2`, zero `Yohann0617`, and `export{... as default}`
- Passes `node --check`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/settings-tasks-cf.test.mjs`
Expected: FAIL on missing `/api/tg/webhook-config` / TG interaction UI strings.

- [ ] **Step 3: Enhance `web-dist/assets/SettingsView-w1Y9UJLA.js` and update `README.md`**

1. In `web-dist/assets/SettingsView-w1Y9UJLA.js`:
   - Import `U as _gt` (`getToken`) from `./index-DwZEqr4A.js` (zero edits to `index-DwZEqr4A.js`; avoids colliding with existing local `Ut`).
   - Add reactive state for webhook status (`enabled`, `webhookUrl`, `lastError`, `loading`) fetched inside `g()` via `GET /api/tg/webhook-config`.
   - Add toggle handler calling `POST /api/tg/webhook-config` (sending `{ origin: window.location.origin }`) when disabled, or `DELETE /api/tg/webhook-config` when enabled, displaying clear success/error toast messages.
   - Render the status badge, toggle button, and compact webhook status box cleanly inside the existing「Telegram 通知」`<section>` (careful with Vue static cache slots — use fresh cache indices or non-cached dynamic nodes so zero existing slots collide!).
2. In `README.md`:
   - Add a concise「Telegram 机器人双向交互」section documenting setup (fill Bot Token + Chat ID → click「开启 TG 交互」in 系统设置) and supported commands (`/status`, `/cfgs`, `/tasks`, `/help`).

- [ ] **Step 4: Run full test suite & verify everything**

Run: `node --test tests/*.test.mjs`
Expected: ALL tests PASS, 0 failures, `node --check` passes on all backend/frontend JS files, and all locked files remain byte-identical.

- [ ] **Step 5: Commit**

```bash
git add web-dist/assets/SettingsView-w1Y9UJLA.js README.md tests/settings-tasks-cf.test.mjs
git commit -m "feat(ui): add one-click Telegram Webhook toggle in SettingsView and update README"
```
