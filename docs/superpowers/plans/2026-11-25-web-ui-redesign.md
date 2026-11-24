# OCI Helper Serverless Web UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a multi-theme (3 switchable styles × dark/light = 6 full themes), centered-width-with-wide-toggle, Card/List OCI management, and structurally refactored Web UI directly on `web-dist/` with zero regressions to the 85+ backend APIs.

**Architecture:** Keep the compiled Worker backend (`dist/index.js`), core runtime bundle (`web-dist/assets/index-DwZEqr4A.js`), and 6 untouched resource chunks byte-identical. Introduce a pure ESM preference store (`theme-store.js`), a zero-`!important` tokenized stylesheet (`theme-system.css`) that overrides Tailwind v4 `@layer utilities` via standard CSS Cascade Layers with safe exemptions, a tiny global a11y enhancer (`ui-enhance.js`), targeted template enhancements to the 13 specified UI/view chunks, and theme synchronization for `web-dist/novnc/vnc.html`.

**Tech Stack:** Pre-compiled Vue 3 ESM runtime (`web-dist/assets/index-DwZEqr4A.js`), Tailwind CSS v4 utilities (`index-BbaPobom.css`), CSS Custom Properties & Cascade Layers (`theme-system.css`), ECharts, noVNC (`vnc.html`), Node.js built-in test runner (`node --test`) for unit/contract verification.

**Spec:** [docs/superpowers/specs/2026-11-25-web-ui-redesign-design.md](../../specs/2026-11-25-web-ui-redesign-design.md)

## Global Constraints

- Do NOT modify `dist/index.js`, `wrangler.toml`, `wrangler.import.toml`, `package.json`, or `migrations/`.
- Do NOT modify `web-dist/assets/index-DwZEqr4A.js`, `InstanceView-BQLVaoH-.js`, `BootVolumeView-BSTURY2P.js`, `NetworkView-B5MET1oN.js`, `LimitsView-C5U4Cjpk.js`, `TaskFormDialog.vue_vue_type_script_setup_true_lang-BfUx9eob.js`, or `UiField.vue_vue_type_script_setup_true_lang-CUb7rIgi.js`.
- Preserve EVERY existing hashed filename and ESM export signature in `web-dist/assets/`.
- Zero `!important` rules in `web-dist/assets/theme-system.css` and zero `html.light ... !important` rules remaining in `web-dist/assets/index-BbaPobom.css`.
- Do NOT reference uncompiled Tailwind utility classes in modified JS views; define all new layout/component classes explicitly in `web-dist/assets/theme-system.css`.
- Preserve existing `localStorage` keys (`oci_mini_theme`, `oci_mini_sidebar`, `oci_mini_token`, `oci_mini_task_cfg`) and add `oci_mini_style`, `oci_mini_width`, `oci_mini_cfg_view`.
- Zero external font CDN requests required; use local-first system + technical font stacks.
- All modified `.js` files must pass `node --check <file>`.
- No emojis as UI icons (SVG / Lucide path nodes only); `prefers-reduced-motion: reduce` respected; WCAG AA ≥ 4.5:1 normal text contrast across all 6 theme×mode combinations.

## Review Focus

- Corrupted `localStorage` values (e.g., `oci_mini_style="invalid"`) or throwing `Storage` (private browsing `SecurityError`) → must fall back safely to defaults (`precision`, `dark`, `boxed`, `card`) without throwing during boot or runtime. *(Tested in Task 1)*
- TOTP QR code `img.bg-white` in Dark Mode across all 3 styles → must remain true `#ffffff` background, never remapped by dark surface bridge rules. *(Tested in Task 2)*
- Nested dialog `Escape` handling when `[role="alertdialog"]` (`UiConfirmHost`) opens on top of `UiDialog` → `Escape` must close ONLY the top `alertdialog` and must NOT close the underlying `UiDialog`. *(Tested in Task 3)*
- Live theme/mode switching while viewing `TrafficView` or `CostView` → ECharts option reactivity must immediately recompute axis/grid/legend/series colors via `oci-theme-change` without page reload. *(Tested in Task 6)*
- Untouched chunk integrity & export compatibility → untouched core/resource chunks remain byte-identical via `git diff`, every modified JS chunk passes `node --check`, and all 6 theme×mode combinations render legibly in browser QA (desktop `1440×900` + mobile `390×844`). *(Tested in Task 8)*

---

### Task 1: Theme State Store & Zero-FOUC Boot Infrastructure

**Files:**
- Create: `web-dist/assets/theme-store.js`
- Modify: `web-dist/index.html`
- Test: `tests/theme-store.test.mjs`

**Interfaces:**
- Consumes: Browser `document.documentElement`, `localStorage`, `window.dispatchEvent`, `getComputedStyle`.
- Produces (from `web-dist/assets/theme-store.js`):
  - `STYLE_META`: array of 3 objects `{ id: "precision"|"bento"|"cockpit", name: string, shortName: string, desc: string, swatches: { dark: [string,string,string], light: [string,string,string] } }`
  - `STORAGE_KEYS`: `{ style: "oci_mini_style", theme: "oci_mini_theme", width: "oci_mini_width", cfgView: "oci_mini_cfg_view", sidebar: "oci_mini_sidebar" }`
  - `VALID_STYLES`: `["precision", "bento", "cockpit"]`
  - `VALID_THEMES`: `["dark", "light"]`
  - `VALID_WIDTHS`: `["boxed", "wide"]`
  - `VALID_CFG_VIEWS`: `["card", "list"]`
  - `getStyle() -> "precision"|"bento"|"cockpit"`
  - `getTheme() -> "dark"|"light"`
  - `getWidth() -> "boxed"|"wide"`
  - `getCfgView() -> "card"|"list"`
  - `applyPrefs(partial?: { style?, theme?, width? }) -> { style, theme, width }`
  - `setStyle(style: string) -> { style, theme, width }`
  - `setTheme(theme: string) -> { style, theme, width }`
  - `toggleTheme() -> { style, theme, width }`
  - `setWidth(width: string) -> { style, theme, width }`
  - `toggleWidth() -> { style, theme, width }`
  - `setCfgView(mode: string) -> "card"|"list"`
  - `onThemeChange(cb: (detail) => void) -> () => void`
  - `getChartTheme() -> { textPrimary, textSecondary, textMuted, border, gridLine, surface, series: string[] }`

- [ ] **Step 1: Write failing unit tests for `theme-store.js` and `index.html` boot contract**

Create `tests/theme-store.test.mjs` testing:
```js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("theme-store falls back to defaults on empty, invalid, or throwing storage", async () => {
  const store = await import("../web-dist/assets/theme-store.js");
  // stub globalThis.localStorage with invalid values and verify defaults
  // stub globalThis.localStorage throwing SecurityError and verify no throw
  assert.deepEqual(store.VALID_STYLES, ["precision", "bento", "cockpit"]);
  assert.equal(store.STORAGE_KEYS.style, "oci_mini_style");
  assert.equal(store.STORAGE_KEYS.theme, "oci_mini_theme");
  assert.equal(store.STORAGE_KEYS.width, "oci_mini_width");
  assert.equal(store.STORAGE_KEYS.cfgView, "oci_mini_cfg_view");
});

test("applyPrefs updates html data attributes, dark/light classes, colorScheme, and dispatches oci-theme-change", async () => {
  // stub document.documentElement + window + localStorage
  // verify setStyle("cockpit"), setTheme("light"), setWidth("wide") mutate attrs & dispatch CustomEvent("oci-theme-change")
});

test("setCfgView persists card/list and falls back to card for unknown value", async () => {
  // verify setCfgView("list") -> "list", setCfgView("bogus") -> "card"
});

test("index.html loads theme-system.css, ui-enhance.js, and sets data-style/data-width/theme synchronously before #app", () => {
  const html = fs.readFileSync("web-dist/index.html", "utf8");
  assert.match(html, /\/assets\/theme-system\.css\?v=20261125/);
  assert.match(html, /\/assets\/ui-enhance\.js\?v=20261125/);
  assert.match(html, /oci_mini_style/);
  assert.match(html, /oci_mini_width/);
  assert.match(html, /data-style/);
  assert.match(html, /data-width/);
  assert.ok(html.indexOf("data-style") < html.indexOf('<div id="app">'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/theme-store.test.mjs`
Expected: FAIL (`Cannot find module .../theme-store.js` and `index.html` assertion failures).

- [ ] **Step 3: Implement `web-dist/assets/theme-store.js`**

Implement all exported constants and functions listed in the Interfaces block. Wrap every `localStorage` access in `try { ... } catch {}`. Validate all inputs against the allowlists (`precision` / `dark` / `boxed` / `card` defaults). In `applyPrefs`, set `document.documentElement.dataset.style`, `dataset.width`, toggle `light`/`dark` classes, set `document.documentElement.style.colorScheme = theme`, and dispatch `CustomEvent("oci-theme-change", { detail })`. In `getChartTheme()`, read `--text-primary`, `--text-secondary`, `--text-muted`, `--border`, `--chart-grid`, `--surface`, `--chart-1`..`--chart-8` via `getComputedStyle(document.documentElement)` with sensible fallbacks for non-DOM environments.

- [ ] **Step 4: Update `web-dist/index.html`**

Keep `<script type="module" crossorigin src="/assets/index-DwZEqr4A.js"></script>` and `<link rel="stylesheet" crossorigin href="/assets/index-BbaPobom.css">`. Immediately after `index-BbaPobom.css`, add `<link rel="stylesheet" href="/assets/theme-system.css?v=20261125">` and `<script type="module" src="/assets/ui-enhance.js?v=20261125"></script>`. Replace the inline `<script>` inside `<body>` (before `<div id="app">`) with a safe try/catch zero-FOUC boot snippet that validates and applies `oci_mini_style` (`data-style`), `oci_mini_width` (`data-width`), and `oci_mini_theme` (`dark`/`light` classes + `colorScheme`). Also set `<html lang="zh-CN" class="dark" data-style="precision" data-width="boxed">` as static fallback defaults.

- [ ] **Step 5: Run tests and syntax check**

Run: `node --check web-dist/assets/theme-store.js && node --test tests/theme-store.test.mjs`
Expected: PASS (0 failures).

- [ ] **Step 6: Commit**

```bash
git add web-dist/assets/theme-store.js web-dist/index.html tests/theme-store.test.mjs
git commit -m "feat(ui): add theme preference store and zero-FOUC boot config"
```

---

### Task 2: Tokenized Multi-Theme Design System CSS & Cascade Layer Bridge

**Files:**
- Create: `web-dist/assets/theme-system.css`
- Modify: `web-dist/assets/index-BbaPobom.css` (remove `.aurora{...}` and `html.light ... !important` tail while preserving `.fade-*`, `@property`, `@keyframes`, and all `@layer` blocks)
- Test: `tests/theme-css.test.mjs`

**Interfaces:**
- Consumes: `<html data-style="precision|bento|cockpit" data-width="boxed|wide" class="dark|light">` from Task 1.
- Produces (CSS tokens & semantic layout/component classes consumed by Tasks 3–7):
  - Tokens: `--shell-max-w`, `--font-ui`, `--font-code`, `--radius-card`, `--radius-control`, `--shadow-card`, `--shadow-popover`, `--bg-page`, `--bg-sidebar`, `--surface`, `--surface-2`, `--surface-hover`, `--bg-input`, `--border`, `--border-strong`, `--text-primary`, `--text-secondary`, `--text-muted`, `--color-primary`, `--color-primary-hover`, `--color-on-primary`, `--color-accent`, `--color-success`, `--color-warning`, `--color-danger`, `--btn-disabled-bg`, `--btn-disabled-fg`, `--btn-disabled-border`, `--focus-ring`, `--chart-grid`, `--chart-1`..`--chart-8`.
  - Shell & layout classes: `.shell-container`, `.shell-header-inner`, `.shell-sidebar`, `.shell-header`, `.shell-mobile-nav`, `.brand-mark`.
  - Theme popover classes: `.theme-popover`, `.theme-option`, `.theme-option.is-active`, `.theme-swatches`, `.theme-swatch-dot`, `.segmented-group`, `.segmented-btn`, `.segmented-btn.is-active`.
  - Primitive classes: `.ui-btn`, `.ui-btn-sm`, `.ui-btn-md`, `.ui-btn-primary`, `.ui-btn-secondary`, `.ui-btn-outline`, `.ui-btn-ghost`, `.ui-btn-danger`, `.ui-badge`, `.ui-badge-green|red|amber|sky|violet|slate`, `.ui-dialog-backdrop`, `.ui-dialog-modal`, `.ui-dialog-drawer`, `.ui-dialog-drawer-wrap`.
  - View layout classes: `.cfg-toolbar`, `.cfg-grid`, `.cfg-card`, `.cfg-card-header`, `.cfg-card-meta`, `.cfg-meta-tile`, `.cfg-card-footer`, `.cfg-list`, `.cfg-list-row`, `.cfg-context-card`, `.cfg-context-top`, `.cfg-context-scope`, `.cfg-tabs`, `.cfg-tab`, `.cfg-tab.is-active`, `.tenant-split-grid`, `.settings-prose`, `.settings-secrets-grid`, `.settings-secret-card`, `.cf-status-bar`, `.cf-dns-content`.

- [ ] **Step 1: Write failing CSS contract tests**

Create `tests/theme-css.test.mjs` verifying:
1. `web-dist/assets/index-BbaPobom.css` has ZERO occurrences of `html.light` and ZERO `!important` outside `[hidden]:where(:not([hidden=until-found])){display:none!important}` (Tailwind's own hidden rule), while still containing `@layer utilities`, `.fade-enter-active`, `@property --tw-translate-x`, and `@keyframes spin`.
2. `web-dist/assets/theme-system.css` contains ZERO `!important` declarations.
3. `theme-system.css` defines all 6 theme×mode selectors (`data-style="precision"`, `data-style="bento"`, `data-style="cockpit"` paired with `.dark` and `.light`) with exact spec hex values (`#090D16`, `#F8FAFC`, `#0C111D`, `#F3F5F9`, `#070B14`, `#EFF3F8`, `#2563EB`, `#1D4ED8`, `#22C55E`, `#047857`, `--shell-max-w: 1200px`, `1160px`, `1280px`).
4. `theme-system.css` does NOT remap bare `.bg-white` (Review Focus: TOTP QR code safe exemption), DOES preserve `.log-panel` dark terminal styling, DOES style `input[type="checkbox"]`, `[role="alertdialog"]`, `:focus-visible`, and `@media (prefers-reduced-motion: reduce)`.
5. `theme-system.css` defines every semantic layout/component class listed in the Interfaces block.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/theme-css.test.mjs`
Expected: FAIL (`theme-system.css` missing, `index-BbaPobom.css` still has `html.light ... !important`).

- [ ] **Step 3: Clean up `web-dist/assets/index-BbaPobom.css`**

Remove only the `.aurora{...}` rule and the entire `html.light ... !important` patch block (between `.fade-leave-to{opacity:0}` and `@property --tw-translate-x`). Preserve `.fade-enter-active,.fade-leave-active{transition:opacity .16s}.fade-enter-from,.fade-leave-to{opacity:0}` and every `@layer` / `@property` / `@keyframes` rule.

- [ ] **Step 4: Create `web-dist/assets/theme-system.css`**

Write a clean, well-sectioned stylesheet (zero `!important`):
1. **Token definitions for all 6 theme×mode combinations** matching Section 5.2 of the spec verbatim (plus `--chart-1..8`, `--chart-grid`, `--btn-disabled-*`, `--badge-*` tones for dark & light with WCAG AA ≥ 4.5:1 contrast).
2. **Base body, typography, scrollbars, `.aurora` (neutralized/subtle per theme: clean in `precision`, whisper-soft top ambient tint in `bento`, crisp subtle technical grid in `cockpit`), `.panel`, `.field`, custom `input[type="checkbox"]`, `:focus-visible`, `prefers-reduced-motion`**.
3. **Unlayered Tailwind v4 utility bridge** (wins over `@layer utilities` with zero `!important`) mapping `.text-white`, `.text-slate-200..600`, `.text-sky-*`, `.text-emerald-*`, `.text-amber-*`, `.text-rose-*`, `.text-violet-*`, `.text-indigo-*`, `.bg-white\/\[...\]`, `.bg-ink-900\/50`, `.bg-ink-900\/95`, `.border-white\/...`, `.divide-white\/...`, `.ring-white\/...`, `.hover\:bg-white\/...`, `.hover\:text-white` to semantic tokens — strictly exempting bare `.bg-white` (QR code), `.brand-mark` / `.ui-btn-primary` / `.bg-gradient-to-br` foreground white icons/text, and `.log-panel` dark terminal zone; elevating `.text-\[10px\]` to `11px` minimum legibility.
4. **Global `[role="alertdialog"]` (`UiConfirmHost`) styling** so its top accent strip, primary confirm button, secondary cancel button, panel, and backdrop follow the active theme tokens (eliminating hardcoded sky-cyan gradients).
5. **All semantic component & view layout classes** listed in the Interfaces block (`.shell-container`, `.cfg-grid`, `.cfg-card`, `.cfg-list`, `.cfg-context-card`, `.settings-secrets-grid`, `.ui-dialog-drawer`, `.theme-popover`, `.ui-btn-*`, `.ui-badge-*`, `.cf-status-bar`, `.cf-dns-content`, responsive breakpoints at `640px`, `768px`, `900px`, `1100px`).

- [ ] **Step 5: Run tests**

Run: `node --test tests/theme-css.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web-dist/assets/index-BbaPobom.css web-dist/assets/theme-system.css tests/theme-css.test.mjs
git commit -m "feat(ui): add 6-mode tokenized theme system CSS and remove !important hacks"
```

---

### Task 3: Base UI Primitives (`UiButton`, `UiDialog`, `UiBadge`) & Global A11y Enhancer (`ui-enhance.js`)

**Files:**
- Create: `web-dist/assets/ui-enhance.js`
- Modify: `web-dist/assets/UiButton.vue_vue_type_script_setup_true_lang-B6_iRLwp.js`
- Modify: `web-dist/assets/UiDialog.vue_vue_type_script_setup_true_lang-BGya80so.js`
- Modify: `web-dist/assets/UiBadge.vue_vue_type_script_setup_true_lang-BnzI1Z_L.js`
- Test: `tests/ui-primitives.test.mjs`

**Interfaces:**
- Consumes: `.ui-btn*`, `.ui-badge*`, `.ui-dialog-*` from Task 2.
- Produces:
  - `UiButton` (`export { Ye as _, Fe as c }`): preserves exact props (`variant`, `size`, `loading`, `disabled`, `block`, `type`) and `c` (`cn`) export; emits semantic `.ui-btn`, `.ui-btn-${size}`, `.ui-btn-${variant}` classes.
  - `UiDialog` (`export { N as _ }`): preserves existing props (`modelValue`, `title`, `description`, `width`) + adds optional prop `variant: { default: "modal" }` (`"modal" | "drawer"`), `role="dialog"`, `aria-modal="true"`, close button `aria-label="关闭"`, `Escape` handler that yields whenever `[role="alertdialog"]` is in DOM, focus-into-panel on open, focus-restore to opener on close.
  - `UiBadge` (`export { x as _ }`): preserves `tone` prop (`green|red|amber|sky|violet|slate`) and emits `.ui-badge ui-badge-${tone}`.
  - `web-dist/assets/ui-enhance.js`: exports `initUiEnhance(doc?, win?)` and auto-runs in browser; handles `[role="alertdialog"]` `Escape` (clicks cancel/close button and calls `stopImmediatePropagation`), restores focus when `[role="alertdialog"]` closes, and mirrors `title` → `aria-label` on icon-only `<button>` elements site-wide via `MutationObserver`.

- [ ] **Step 1: Write failing tests for primitives and `ui-enhance.js`**

Create `tests/ui-primitives.test.mjs` testing:
1. `UiButton` source uses `ui-btn-primary` (not `from-sky-500 to-cyan-500`) and preserves `export{... as _,... as c}`.
2. `UiBadge` source uses `ui-badge` semantic classes and preserves `export{... as _}`.
3. `UiDialog` source supports `variant` (`modal` / `drawer`), `role:"dialog"`, `"aria-modal":"true"`, `"aria-label":"关闭"`, `Escape` listener checking `querySelector('[role="alertdialog"]')`, and focus restoration.
4. `ui-enhance.js` unit test (with minimal DOM/event stubs):
   - Pressing `Escape` while a visible `[role="alertdialog"]` exists triggers its close/cancel button and prevents propagation so an underlying `UiDialog` is NOT closed (Review Focus #3).
   - Icon-only `<button title="删除"><svg></svg></button>` gets `aria-label="删除"` automatically; buttons with visible text are left untouched.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/ui-primitives.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement `web-dist/assets/ui-enhance.js`**

Implement `initUiEnhance(doc = document, win = window)` with:
- `syncIconButtonLabels(root)`: finds `button:not([aria-label])` with empty trimmed textContent and an `<svg>` child; copies `title` if present, otherwise infers fallback (`关闭` if `lucide-x`, `删除` if `lucide-trash*`, `刷新` if `lucide-refresh*`).
- `MutationObserver` on `doc.body` calling `syncIconButtonLabels` on added nodes + tracking `[role="alertdialog"]` appearance (saves `doc.activeElement`, focuses the alertdialog container/button) and removal (restores saved focus if still connected).
- Capture-phase `keydown` listener for `Escape`: when `doc.querySelector('[role="alertdialog"]')` exists, calls `e.preventDefault(); e.stopImmediatePropagation()` and clicks the close/cancel button inside it (`button[title="关闭"]` or first non-danger button).
- Auto-invoke on `DOMContentLoaded` (or immediately if `readyState !== "loading"`) when `typeof document !== "undefined"`.

- [ ] **Step 4: Update `UiButton`, `UiDialog`, and `UiBadge` chunks**

- Update `UiButton.vue_vue_type_script_setup_true_lang-B6_iRLwp.js` variant/base strings to use `.ui-btn`, `.ui-btn-sm`/`.ui-btn-md`, `.ui-btn-primary|secondary|ghost|danger|outline` (keeping `Fe` / `twMerge` export `c` intact so all callers keep working).
- Update `UiBadge.vue_vue_type_script_setup_true_lang-BnzI1Z_L.js` to emit `.ui-badge` + `.ui-badge-${tone}`.
- Update `UiDialog.vue_vue_type_script_setup_true_lang-BGya80so.js` to add `variant: { default: "modal" }`, `role="dialog"`, `aria-modal="true"`, `tabindex="-1"`, close button `aria-label="关闭"`, `watch(() => props.modelValue, ...)` handling `Escape` (yielding if `document.querySelector('[role="alertdialog"]')` exists) and saving/restoring `document.activeElement`, plus `.ui-dialog-drawer-wrap` / `.ui-dialog-drawer` classes when `variant === "drawer"`.

- [ ] **Step 5: Verify syntax and run tests**

Run: `node --check web-dist/assets/ui-enhance.js && node --check web-dist/assets/UiButton.vue_vue_type_script_setup_true_lang-B6_iRLwp.js && node --check web-dist/assets/UiDialog.vue_vue_type_script_setup_true_lang-BGya80so.js && node --check web-dist/assets/UiBadge.vue_vue_type_script_setup_true_lang-BnzI1Z_L.js && node --test tests/ui-primitives.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web-dist/assets/ui-enhance.js web-dist/assets/UiButton.vue_vue_type_script_setup_true_lang-B6_iRLwp.js web-dist/assets/UiDialog.vue_vue_type_script_setup_true_lang-BGya80so.js web-dist/assets/UiBadge.vue_vue_type_script_setup_true_lang-BnzI1Z_L.js tests/ui-primitives.test.mjs
git commit -m "feat(ui): modernize UiButton/UiDialog/UiBadge and add global a11y enhancer"
```

---

### Task 4: Global `AppShell` (Centered Container, Width Toggle, Theme Switcher) & `LoginView`

**Files:**
- Modify: `web-dist/assets/AppShell-D9QnCYdV.js`
- Modify: `web-dist/assets/LoginView-BU-WcVZj.js`
- Test: `tests/app-shell-login.test.mjs`

**Interfaces:**
- Consumes: `STYLE_META`, `getStyle`, `getTheme`, `getWidth`, `setStyle`, `setTheme`, `toggleTheme`, `setWidth`, `toggleWidth`, `onThemeChange` from Task 1; `.shell-container`, `.shell-header-inner`, `.theme-popover`, `.brand-mark`, `.segmented-group` from Task 2.
- Produces: Topbar theme switcher popover (3 themes with 3-dot swatches + dark/light + boxed/wide controls), topbar boxed/wide quick toggle, mobile drawer theme picker, `.shell-container` around `<RouterView />`, and `LoginView` corner theme/mode switcher.

- [ ] **Step 1: Write failing contract tests for `AppShell` and `LoginView`**

Create `tests/app-shell-login.test.mjs` asserting:
1. `AppShell-D9QnCYdV.js` imports from `./theme-store.js`, renders `.shell-container` wrapping `RouterView`, includes topbar width toggle (`boxed`/`wide`), theme popover button with `aria-expanded` & `aria-label`, 3 theme entries driven by `STYLE_META`, mobile drawer theme switcher, and `aria-label` on sidebar collapse/expand, menu, theme, and logout icon buttons.
2. `LoginView-BU-WcVZj.js` imports from `./theme-store.js`, renders corner style/theme quick switcher with `aria-label`, uses `.brand-mark` instead of hardcoded `from-sky-500 to-cyan-400`, and preserves login, TOTP, and Google Sign-In flows verbatim.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/app-shell-login.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Refactor `web-dist/assets/AppShell-D9QnCYdV.js`**

- Import `STYLE_META`, `getStyle`, `getTheme`, `getWidth`, `setStyle`, `setTheme`, `toggleTheme`, `setWidth`, `toggleWidth`, `onThemeChange` from `./theme-store.js`.
- Add reactive refs `style`, `theme`, `width`, `themeMenuOpen` synced via `onThemeChange` (and cleaned up on unmount via `S` / `onUnmounted` from `index-DwZEqr4A.js`).
- Add `palette`, `maximize-2`, `minimize-2`, `check` Lucide icon nodes using `f(...)` (existing `createLucideIcon` import).
- Wrap `<header>` inner row in `.shell-header-inner` and `<RouterView />` inside `<div class="shell-container">`.
- Add topbar controls:
  1. Theme popover trigger button (`aria-haspopup="menu"`, `aria-expanded`, `aria-label="切换风格主题"`) + popover panel (`.theme-popover`) listing the 3 themes from `STYLE_META` with 3 color swatch dots + short description + active checkmark, plus quick Dark/Light & Boxed/Wide segmented controls at bottom; closes on outside pointerdown or `Escape`.
  2. Desktop (`md+`) 1-click Boxed/Wide toggle button (`aria-label` + `title`).
  3. Existing Sun/Moon 1-click Dark/Light toggle button (with `aria-label`).
  4. Existing GitHub link & Logout button (with `aria-label="退出登录"`).
- Add 3-style segmented selector in the mobile slide-out drawer above the light/dark toggle.
- Replace brand icon container gradient with `.brand-mark`.

- [ ] **Step 4: Enhance `web-dist/assets/LoginView-BU-WcVZj.js`**

- Import `STYLE_META`, `getStyle`, `getTheme`, `setStyle`, `toggleTheme`, `onThemeChange` from `./theme-store.js`.
- Add a clean floating top-right quick bar (3-style compact pills + dark/light icon toggle) on the login screen.
- Replace hardcoded `bg-gradient-to-br from-sky-500 to-cyan-400 shadow-lg shadow-sky-500/30` with `.brand-mark`.
- Keep all login, TOTP, redirect, and Google Identity Services (`gsi/client`) logic completely intact.

- [ ] **Step 5: Verify syntax and run tests**

Run: `node --check web-dist/assets/AppShell-D9QnCYdV.js && node --check web-dist/assets/LoginView-BU-WcVZj.js && node --test tests/app-shell-login.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web-dist/assets/AppShell-D9QnCYdV.js web-dist/assets/LoginView-BU-WcVZj.js tests/app-shell-login.test.mjs
git commit -m "feat(ui): add centered container, width toggle, and 3-theme switcher to AppShell and LoginView"
```

---

### Task 5: OCI Management (`CfgView`) Card / List Mode Switcher & Layout Refactor

**Files:**
- Modify: `web-dist/assets/CfgView-BJjU6PMD.js`
- Test: `tests/cfg-view.test.mjs`

**Interfaces:**
- Consumes: `getCfgView`, `setCfgView` from Task 1; `.cfg-toolbar`, `.cfg-grid`, `.cfg-card`, `.cfg-card-header`, `.cfg-card-meta`, `.cfg-meta-tile`, `.cfg-card-footer`, `.cfg-list`, `.cfg-list-row`, `.segmented-group`, `.segmented-btn` from Task 2.
- Produces: Reactive `viewMode` (`"card"` default | `"list"`) persisted to `oci_mini_cfg_view`; dual-layout OCI account list with full feature parity (select, bulk check, bulk launch, refresh plan, reveal tenant, enter, detail, check, edit, delete).

- [ ] **Step 1: Write failing contract tests for `CfgView`**

Create `tests/cfg-view.test.mjs` verifying `web-dist/assets/CfgView-BJjU6PMD.js`:
1. Imports `getCfgView` and `setCfgView` from `./theme-store.js`.
2. Renders a segmented Card/List switcher with `aria-pressed` and labels `卡片` / `列表`.
3. Renders `.cfg-grid` + `.cfg-card` (header + 2×2 `.cfg-card-meta` + `.cfg-card-footer`) when `viewMode === "card"`, and `.cfg-list` + `.cfg-list-row` when `viewMode === "list"`.
4. Removes the redundant inline green checkmark icon next to `UiBadge` (`已连接`) while preserving `status`, `planType`, `refreshPlanType`, tenant reveal toggle, `taskCount` / `runningTaskCount`, `lastCheckedAt`, `tenantCreatedAt`, and all 5 actions (`进入`, `详情`, `测活`, `编辑`, `删除` with `aria-label="删除配置"`).
5. Preserves all 4 dialogs (详情、新增配置含智能导入、编辑配置、批量开机含 SSH 密钥生成) intact.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/cfg-view.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Refactor `web-dist/assets/CfgView-BJjU6PMD.js`**

- Import `getCfgView`, `setCfgView` from `./theme-store.js`.
- Add `layout-grid` and `list` Lucide icon nodes via `Z(...)`.
- Add `viewMode = f(getCfgView())` and `switchView(m) { viewMode.value = setCfgView(m); }`.
- Reorganize top toolbar (`.cfg-toolbar`): search input + compact health summary pill (`有效 / 失效 / 未校验`) + bulk actions (`刷新`, `全选`, `一键测活`, `批量开机`) on left; spacer; segmented `[卡片 | 列表]` toggle + `+ 新增配置` on right.
- Implement Card mode (`.cfg-grid` → `.cfg-card`):
  - Header (`.cfg-card-header`): checkbox + clickable name + status `UiBadge` + plan `UiBadge` + compact refresh-plan icon button (`aria-label`).
  - Meta 2×2 grid (`.cfg-card-meta` → 4 `.cfg-meta-tile` cells):
    1. 区域 (`region` mono + multi-region `+N 区` tag if `regions.length > 1`)
    2. 租户 (masked tenant name + reveal eye button with `aria-label`)
    3. 抢机任务 (`taskCount` + highlighted `runningTaskCount` if > 0)
    4. 校验 / 创建 (`lastCheckedAt` relative/formatted + `tenantCreatedAt` hint)
  - Footer (`.cfg-card-footer`): primary `进入` button, secondary `详情` / `测活` / `编辑`, and right-aligned danger `删除` icon button (`aria-label="删除配置"`).
- Implement refined List mode (`.cfg-list` → `.cfg-list-row`): clean left identity + status/plan badges, structured middle metadata (no gray pill clutter), right-aligned action bar.

- [ ] **Step 4: Verify syntax and run tests**

Run: `node --check web-dist/assets/CfgView-BJjU6PMD.js && node --test tests/cfg-view.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web-dist/assets/CfgView-BJjU6PMD.js tests/cfg-view.test.mjs
git commit -m "feat(ui): add Card/List view switcher and structured cards to OCI CfgView"
```

---

### Task 6: Config Detail Header, `TenantView`, and Theme-Reactive ECharts (`TrafficView`, `CostView`)

**Files:**
- Modify: `web-dist/assets/CfgDetailView-Dlm4x8bL.js`
- Modify: `web-dist/assets/TenantView-CESpkrmJ.js`
- Modify: `web-dist/assets/TrafficView-gyV2LYjA.js`
- Modify: `web-dist/assets/CostView-DMCrmlrj.js`
- Test: `tests/detail-charts.test.mjs`

**Interfaces:**
- Consumes: `onThemeChange`, `getChartTheme` from Task 1; `.cfg-context-card`, `.cfg-context-top`, `.cfg-context-scope`, `.cfg-tabs`, `.cfg-tab`, `.tenant-split-grid` from Task 2.
- Produces: Unified compact Config Detail header with clickable-copy OCID and distinct account-refresh icon button, balanced `TenantView` 2-col sections, deduplicated `TrafficView` region scope display, and live theme-reactive ECharts in `TrafficView` and `CostView`.

- [ ] **Step 1: Write failing contract tests for Config Detail, Tenant, Traffic, and Cost views**

Create `tests/detail-charts.test.mjs` verifying:
1. `CfgDetailView-Dlm4x8bL.js` renders `.cfg-context-card` combining top identity + inline `.cfg-context-scope`, includes clickable OCID copy action, uses distinct `aria-label="刷新账号配置"` / `title="刷新账号配置"` (not duplicating tab `刷新` label visually), and renders `.cfg-tabs` / `.cfg-tab`.
2. `TenantView-CESpkrmJ.js` wraps `租户级设置` and `已订阅区域` inside `.tenant-split-grid` for balanced desktop proportions and keeps all IAM dialogs/actions intact.
3. `TrafficView-gyV2LYjA.js` imports `onThemeChange` and `getChartTheme` from `./theme-store.js`, increments a reactive tick ref on `oci-theme-change` inside `H = computed(...)` (Review Focus #4), and replaces the duplicate `区域` `<select>` with a read-only current-region badge linked to `useCfgScope`.
4. `CostView-DMCrmlrj.js` imports `onThemeChange` and `getChartTheme` from `./theme-store.js` and recomputes ECharts `option` reactively on `oci-theme-change` (Review Focus #4).

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/detail-charts.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Refactor `CfgDetailView-Dlm4x8bL.js` and `TenantView-CESpkrmJ.js`**

- In `CfgDetailView-Dlm4x8bL.js`: combine header row and global scope row into a single compact `.panel.cfg-context-card` (top row: back link with `aria-label="返回配置列表"`, config name, status `UiBadge`, default region + multi-region badge, legible OCID with inline copy button + toast feedback, compact secondary icon button `刷新账号配置`; bottom strip: compact `区域` + `区间` selects without verbose wrapping). Upgrade sub-tab `<nav>` to `.cfg-tabs` + `.cfg-tab` / `.is-active`.
- In `TenantView-CESpkrmJ.js`: pair `租户级设置` and `已订阅区域` in a `.tenant-split-grid` container (`grid-cols-1 lg:grid-cols-2`) so neither stretches into an empty 1200px horizontal bar.

- [ ] **Step 4: Update `TrafficView-gyV2LYjA.js` and `CostView-DMCrmlrj.js`**

- Import `onThemeChange`, `getChartTheme` from `./theme-store.js` (and `S` = `onUnmounted` from `./index-DwZEqr4A.js`).
- Add `themeTick = ref(0)` incremented by `onThemeChange(() => { themeTick.value++; })`, cleaned up on unmount.
- Inside chart `computed`, read `themeTick.value` and `const ct = getChartTheme()`, applying `ct.textSecondary`, `ct.textMuted`, `ct.border`, `ct.gridLine`, `ct.surface`, `ct.textPrimary` (tooltip bg/border/text), and `ct.series` colors.
- In `TrafficView`, replace the duplicate `区域` `<select>` inside the filter bar with a compact read-only scope indicator (`当前区域：{region}`) while keeping `useCfgScope` reactivity and all query logic untouched.

- [ ] **Step 5: Verify syntax and run tests**

Run: `node --check web-dist/assets/CfgDetailView-Dlm4x8bL.js && node --check web-dist/assets/TenantView-CESpkrmJ.js && node --check web-dist/assets/TrafficView-gyV2LYjA.js && node --check web-dist/assets/CostView-DMCrmlrj.js && node --test tests/detail-charts.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web-dist/assets/CfgDetailView-Dlm4x8bL.js web-dist/assets/TenantView-CESpkrmJ.js web-dist/assets/TrafficView-gyV2LYjA.js web-dist/assets/CostView-DMCrmlrj.js tests/detail-charts.test.mjs
git commit -m "feat(ui): consolidate config detail header, balance tenant layout, and sync ECharts to active theme"
```

---

### Task 7: `SettingsView` 2-Column Secrets Grid, `TaskManageView` Log Drawer & `CloudflareView` Polish

**Files:**
- Modify: `web-dist/assets/SettingsView-w1Y9UJLA.js`
- Modify: `web-dist/assets/TaskManageView-C7VfWf-q.js`
- Modify: `web-dist/assets/CloudflareView-Dzih7xW-.js`
- Test: `tests/settings-tasks-cf.test.mjs`

**Interfaces:**
- Consumes: `UiDialog` `variant="drawer"` from Task 3; `.settings-prose`, `.settings-secrets-grid`, `.settings-secret-card`, `.cf-status-bar`, `.cf-dns-content` from Task 2.
- Produces: Balanced 2-col secrets grid on `/settings`, right-side slide-over real-time log drawer on `/tasks`, compact header & cleaner DNS table proportions on `/cloudflare`.

- [ ] **Step 1: Write failing contract tests**

Create `tests/settings-tasks-cf.test.mjs` verifying:
1. `SettingsView-w1Y9UJLA.js` renders the 6 secret items inside `.settings-secrets-grid` with individual `.panel.settings-secret-card` items, adds `.settings-prose` to long helper paragraphs, and preserves QR code `img.bg-white` + all TOTP/TG/Google/Sys API calls.
2. `TaskManageView-C7VfWf-q.js` passes `variant:"drawer"` to `UiDialog` inside `AppLogPanel` and uses full-height flex layout for `.log-panel` instead of cramped `h-[60vh]`.
3. `CloudflareView-Dzih7xW-.js` uses `.cf-status-bar` for the top strip and `.cf-dns-content` instead of hard `max-w-[280px]` truncation on DNS record content while keeping `title: s.content`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/settings-tasks-cf.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Refactor `SettingsView`, `TaskManageView`, and `CloudflareView`**

- `SettingsView-w1Y9UJLA.js`: change `qn` from `panel divide-y divide-white/[0.06]` to `settings-secrets-grid`; wrap each `o.value` item as `panel settings-secret-card`; remove `max-w-md` from the secret input so it expands cleanly inside each 2-column card; add `settings-prose` to the TOTP and Telegram descriptions and keep TOTP action buttons cleanly grouped.
- `TaskManageView-C7VfWf-q.js`: in `AppLogPanel` (`pe`), pass `variant:"drawer"` to `UiDialog` (`$e`) and give `.log-panel` class `log-panel ui-log-terminal` so it fills the drawer vertically cleanly; add `aria-label` on icon-only delete buttons.
- `CloudflareView-Dzih7xW-.js`: replace `Me` (`panel flex flex-wrap items-center gap-3 p-4`) with `panel cf-status-bar`; update DNS content cell class to `cf-dns-content py-2 pr-3 font-mono text-slate-400` so long TXT/DKIM values use available table width comfortably.

- [ ] **Step 4: Verify syntax and run tests**

Run: `node --check web-dist/assets/SettingsView-w1Y9UJLA.js && node --check web-dist/assets/TaskManageView-C7VfWf-q.js && node --check web-dist/assets/CloudflareView-Dzih7xW-.js && node --test tests/settings-tasks-cf.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web-dist/assets/SettingsView-w1Y9UJLA.js web-dist/assets/TaskManageView-C7VfWf-q.js web-dist/assets/CloudflareView-Dzih7xW-.js tests/settings-tasks-cf.test.mjs
git commit -m "feat(ui): 2-col secrets grid, right log drawer, and Cloudflare table polish"
```

---

### Task 8: `novnc/vnc.html` Theme Sync & Full Automated + Browser Visual Verification

**Files:**
- Modify: `web-dist/novnc/vnc.html`
- Test: `tests/vnc-theme.test.mjs`

**Interfaces:**
- Consumes: `localStorage` keys `oci_mini_style` and `oci_mini_theme` from Task 1.
- Produces: Theme-synchronized noVNC console matching all 3 styles × dark/light modes + full verification report across all tests, untouched-file audit, and live browser screenshots.

- [ ] **Step 1: Write failing contract tests for `vnc.html` and untouched chunk integrity**

Create `tests/vnc-theme.test.mjs` asserting:
1. `web-dist/novnc/vnc.html` reads `oci_mini_style` and `oci_mini_theme` from `localStorage` inside a safe `try/catch`, applies `data-style` and `dark`/`light` classes to `document.documentElement`, and defines CSS custom properties for all 3 styles (`precision`, `bento`, `cockpit`) × `dark`/`light` while keeping `#screen` pure `#000` canvas and preserving all RFB/WebSocket/hotkey/paste/keypad JS logic verbatim.
2. Untouched-files integrity check: verifies every untouched chunk (`index-DwZEqr4A.js`, `InstanceView`, `BootVolumeView`, `NetworkView`, `LimitsView`, `TaskFormDialog`, `UiField`, `dist/index.js`, `wrangler.toml`) has no unstaged/committed diffs relative to spec commit `717851b`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/vnc-theme.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Update `web-dist/novnc/vnc.html`**

Add a synchronous inline boot `<script>` right in `<head>` (or top of `<body>`) reading `oci_mini_style` and `oci_mini_theme` with safe fallback (`precision` + `dark`), plus CSS variables in `<style>` mapping all 6 theme×mode palettes onto `#bar`, `#bar button`, `#bar select`, `#keypad`, `#paste-box`, `#paste-preview`, `#quick button`, and `#error` (leaving `#screen` black `#000` and keeping the RFB module script completely untouched).

- [ ] **Step 4: Run full unit/contract test suite and JS syntax verification**

Run:
```bash
node --test tests/*.test.mjs
```
And verify every `.js` file in `web-dist/assets/` passes `node --check`.
Expected: All tests PASS, zero syntax errors, zero modifications to forbidden core/backend files.

- [ ] **Step 5: Browser Visual QA via temporary local static + mock-API preview server**

Spin up a temporary local Node preview server (serving `web-dist/` + lightweight mock `/api/*` fixture responses for `/cfgs`, `/cfgs/:id`, `/tenant`, `/instances`, `/traffic/*`, `/cost`, `/tasks`, `/cf/*`, `/sys`, `/sys/google` — never touching production data or leaving temp scripts in repo), open it in the browser subagent, and visually verify screenshots for:
1. All 3 themes (`precision`, `bento`, `cockpit`) × both modes (`dark`, `light`) = 6 states on `/cfgs` (Card mode + List mode + Boxed vs Wide)
2. `/cfgs/:id/tenant`, `/cfgs/:id/traffic` (live ECharts re-theme on switch), `/tasks` (right-side slide-over live log drawer + Escape), `/cloudflare`, `/settings` (2-col secrets grid + QR code white background), `/login`, and `/novnc/vnc.html`
3. Mobile `390×844` responsive check (zero horizontal overflow, clean drawer theme switcher, clean OCI card stacking)
4. Zero console errors and zero broken asset requests.

Fix any visual/contrast/alignment polish issue uncovered during Browser Visual QA, re-run `node --test tests/*.test.mjs`, and tear down the temporary server.

- [ ] **Step 6: Commit**

```bash
git add web-dist/novnc/vnc.html tests/vnc-theme.test.mjs
git commit -m "feat(ui): sync noVNC console theme and verify all 6 theme modes"
```
