import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("index-BbaPobom.css has zero html.light patches and zero !important except Tailwind [hidden]", () => {
  const css = fs.readFileSync("web-dist/assets/index-BbaPobom.css", "utf8");
  assert.doesNotMatch(css, /html\.light/);
  assert.doesNotMatch(css, /\.aurora\{/);
  const cleaned = css.replace(
    /\[hidden\]:where\(:not\(\[hidden=until-found\]\)\)\{display:none!important\}/g,
    ""
  );
  assert.doesNotMatch(cleaned, /!important/);
  assert.match(css, /@layer utilities\{/);
  assert.match(css, /\.fade-enter-active/);
  assert.match(css, /@property --tw-translate-x/);
  assert.match(css, /@keyframes spin/);
});

test("theme-system.css uses zero !important and defines all 6 theme x mode token palettes", () => {
  const css = fs.readFileSync("web-dist/assets/theme-system.css", "utf8");
  assert.doesNotMatch(css, /!important/);

  for (const selector of [
    /html\[data-style="precision"\]/,
    /html\[data-style="bento"\]/,
    /html\[data-style="cockpit"\]/,
    /html\[data-style="precision"\]\.light/,
    /html\[data-style="bento"\]\.light/,
    /html\[data-style="cockpit"\]\.light/,
  ]) {
    assert.match(css, selector);
  }

  for (const tokenVal of [
    "#090D16",
    "#F8FAFC",
    "#0C111D",
    "#F3F5F9",
    "#070B14",
    "#EFF3F8",
    "#2563EB",
    "#1D4ED8",
    "#22C55E",
    "#047857",
    "1200px",
    "1160px",
    "1280px",
  ]) {
    assert.ok(css.includes(tokenVal), `missing spec color/size value: ${tokenVal}`);
  }
});

test("theme-system.css protects TOTP QR img.bg-white, keeps .log-panel dark, and defines a11y rules", () => {
  const css = fs.readFileSync("web-dist/assets/theme-system.css", "utf8");
  // Must NOT have a bare `.bg-white {` rule that breaks QR code white background
  assert.doesNotMatch(css, /(^|[\s,}])\.bg-white\s*\{/);
  assert.match(css, /\.log-panel/);
  assert.match(css, /input\[type="checkbox"\]/);
  assert.match(css, /\[role="alertdialog"\]/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});

test("theme-system.css defines all semantic layout and component classes", () => {
  const css = fs.readFileSync("web-dist/assets/theme-system.css", "utf8");
  const requiredClasses = [
    ".shell-container",
    ".shell-header-inner",
    ".shell-sidebar",
    ".shell-header",
    ".shell-mobile-nav",
    ".brand-mark",
    ".theme-popover",
    ".theme-option",
    ".theme-swatches",
    ".theme-swatch-dot",
    ".segmented-group",
    ".segmented-btn",
    ".ui-btn",
    ".ui-btn-sm",
    ".ui-btn-md",
    ".ui-btn-primary",
    ".ui-btn-secondary",
    ".ui-btn-outline",
    ".ui-btn-ghost",
    ".ui-btn-danger",
    ".ui-badge",
    ".ui-badge-green",
    ".ui-badge-red",
    ".ui-badge-amber",
    ".ui-badge-sky",
    ".ui-badge-violet",
    ".ui-badge-slate",
    ".ui-dialog-backdrop",
    ".ui-dialog-modal",
    ".ui-dialog-drawer",
    ".ui-dialog-drawer-wrap",
    ".cfg-toolbar",
    ".cfg-grid",
    ".cfg-card",
    ".cfg-card-header",
    ".cfg-card-meta",
    ".cfg-meta-tile",
    ".cfg-card-footer",
    ".cfg-list",
    ".cfg-list-row",
    ".cfg-context-card",
    ".cfg-context-top",
    ".cfg-context-scope",
    ".cfg-tabs",
    ".cfg-tab",
    ".tenant-split-grid",
    ".settings-prose",
    ".settings-secrets-grid",
    ".settings-secret-card",
    ".cf-status-bar",
    ".cf-dns-content",
  ];
  for (const cls of requiredClasses) {
    assert.ok(css.includes(cls), `missing required semantic class: ${cls}`);
  }
});

test("theme-system.css places .field and .header-icon-btn inside @layer components and sets header stacking + nowrap", () => {
  const css = fs.readFileSync("web-dist/assets/theme-system.css", "utf8");
  const compStart = css.indexOf("@layer components");
  assert.ok(compStart !== -1, "must wrap base component styles in @layer components so Tailwind utilities like pl-9/w-24/md:hidden win");
  const compSlice = css.slice(compStart);
  assert.match(compSlice, /\.field\s*\{/);
  assert.match(compSlice, /\.header-icon-btn\s*\{/);
  assert.match(css, /\.shell-header\s*\{[^}]*z-index:\s*30/);
  assert.match(css, /\.segmented-btn\s*\{[^}]*white-space:\s*nowrap/);
});

test("theme-system.css meets WCAG AA contrast on solid danger/warning buttons and bridges light hover utilities", () => {
  const css = fs.readFileSync("web-dist/assets/theme-system.css", "utf8");

  // Solid danger token (#DC2626 gives 4.83:1 with #FFFFFF, >= 4.5:1 WCAG AA)
  assert.match(css, /--color-danger-solid:\s*#(?:DC2626|B91C1C)/i);
  assert.match(
    css,
    /\.ui-btn-danger:hover:not\(:disabled\)\s*\{[^}]*background-color:\s*var\(--color-danger-solid\)/
  );
  assert.match(
    css,
    /\[role="alertdialog"\]\s+\.bg-rose-500\\\/90\s*\{[^}]*background-color:\s*var\(--color-danger-solid\)/
  );

  // Theme-aware warning button foreground (#0F172A on dark bright amber, #FFFFFF on light #B45309 -> 5.02:1)
  assert.match(css, /--color-warning-on:\s*#0F172A/i);
  for (const style of ["precision", "bento", "cockpit"]) {
    const lightBlockRe = new RegExp(
      `html\\[data-style="${style}"\\]\\.light\\s*\\{[\\s\\S]*?--color-warning-on:\\s*#FFFFFF`,
      "i"
    );
    assert.match(css, lightBlockRe, `missing light --color-warning-on: #FFFFFF for ${style}`);
  }
  assert.match(
    css,
    /\[role="alertdialog"\]\s+\.bg-amber-500\\\/90\s*\{[^}]*color:\s*var\(--color-warning-on\)/
  );

  // Light-mode hover utility bridges for delete buttons and muted links
  assert.match(css, /\.hover\\:bg-rose-500\\\/20:hover\s*\{[^}]*background-color:\s*var\(--tone-red-bg\)/);
  assert.match(css, /\.hover\\:text-rose-300:hover\s*\{[^}]*color:\s*var\(--tone-red-fg\)/);
  assert.match(css, /\.hover\\:text-slate-400:hover\s*\{[^}]*color:\s*var\(--text-secondary\)/);
});
