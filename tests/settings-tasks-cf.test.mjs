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
  assert.doesNotMatch(src, /Yohann0617/i);
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

test("SettingsView supports one-click Telegram Webhook toggle and status display without exposing webhook_secret", () => {
  const src = fs.readFileSync("web-dist/assets/SettingsView-w1Y9UJLA.js", "utf8");
  assert.match(src, /import\{[^}]*\bU as _gt\b[^}]*\}from"\.\/index-DwZEqr4A\.js"/);
  assert.match(src, /\/api\/tg\/webhook-config/);
  assert.match(src, /Bearer\s+/);
  assert.match(src, /"GET"/);
  assert.match(src, /"POST"/);
  assert.match(src, /"DELETE"/);
  assert.match(src, /交互已开启/);
  assert.match(src, /交互未开启/);
  assert.match(src, /开启 TG 交互/);
  assert.match(src, /关闭 TG 交互/);
  assert.match(src, /lastError/);
  assert.match(src, /最近投递异常/);
  assert.match(src, /break-all font-mono text-slate-200/);
  assert.doesNotMatch(src, /webhook_secret/);
});

test("README.md documents Telegram Bot two-way interaction cleanly", () => {
  const readme = fs.readFileSync("README.md", "utf8");
  assert.match(readme, /Telegram 机器人双向交互/);
  assert.match(readme, /开启 TG 交互/);
  assert.match(readme, /\/status/);
  assert.match(readme, /\/cfgs/);
  assert.match(readme, /\/tasks/);
  assert.match(readme, /X-Telegram-Bot-Api-Secret-Token/);
  assert.doesNotMatch(readme, /Yohann0617/i);
});
