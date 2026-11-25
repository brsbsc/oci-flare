import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("SettingsView renders 2-col .settings-secrets-grid, .settings-prose, and preserves QR img.bg-white", () => {
  const src = fs.readFileSync("web-dist/assets/SettingsView-w1Y9UJLA.js", "utf8");
  assert.match(src, /settings-secrets-grid/);
  assert.match(src, /settings-secret-card/);
  assert.match(src, /settings-prose/);
  assert.match(src, /rounded-lg bg-white p-2/);
  assert.doesNotMatch(src, /field max-w-md flex-1 font-mono text-xs/);
  assert.match(src, /export\{[A-Za-z0-9_$]+ as default\}/);
});

test("TaskManageView opens AppLogPanel as drawer variant with full-height .ui-log-terminal", () => {
  const src = fs.readFileSync("web-dist/assets/TaskManageView-C7VfWf-q.js", "utf8");
  assert.match(src, /variant:"drawer"/);
  assert.match(src, /log-panel ui-log-terminal/);
  assert.match(src, /export\{[A-Za-z0-9_$]+ as default\}/);
});

test("TaskManageView guards oci_mini_task_cfg localStorage read/write with try/catch", () => {
  const src = fs.readFileSync("web-dist/assets/TaskManageView-C7VfWf-q.js", "utf8");
  assert.match(src, /try\{[^}]*localStorage\.getItem\("oci_mini_task_cfg"\)[^}]*\}catch/);
  assert.match(src, /try\{[^}]*localStorage\.setItem\("oci_mini_task_cfg"[^}]*\}catch/);
});

test("CloudflareView uses compact .cf-status-bar and flexible .cf-dns-content column", () => {
  const src = fs.readFileSync("web-dist/assets/CloudflareView-Dzih7xW-.js", "utf8");
  assert.match(src, /cf-status-bar/);
  assert.match(src, /cf-dns-content/);
  assert.doesNotMatch(src, /max-w-\[280px\]/);
  assert.match(src, /export\{[A-Za-z0-9_$]+ as default\}/);
});
