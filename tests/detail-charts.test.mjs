import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("CfgDetailView uses unified .cfg-context-card, clickable OCID copy, distinct account-refresh button, and .cfg-tabs", () => {
  const src = fs.readFileSync("web-dist/assets/CfgDetailView-Dlm4x8bL.js", "utf8");
  assert.match(src, /cfg-context-card/);
  assert.match(src, /cfg-context-top/);
  assert.match(src, /cfg-context-scope/);
  assert.match(src, /cfg-tabs/);
  assert.match(src, /cfg-tab/);
  assert.match(src, /clipboard\.writeText/);
  assert.match(src, /刷新账号配置/);
  assert.match(src, /whitespace-nowrap/);
  assert.match(src, /export\{[A-Za-z0-9_$]+ as default\}/);
});

test("TenantView groups tenant settings and subscribed regions in .tenant-split-grid", () => {
  const src = fs.readFileSync("web-dist/assets/TenantView-CESpkrmJ.js", "utf8");
  assert.match(src, /tenant-split-grid/);
  assert.match(src, /租户级设置/);
  assert.match(src, /已订阅区域/);
  assert.match(src, /export\{[A-Za-z0-9_$]+ as default\}/);
});

test("TrafficView removes duplicate region select and subscribes ECharts option to oci-theme-change via getChartTheme", () => {
  const src = fs.readFileSync("web-dist/assets/TrafficView-gyV2LYjA.js", "utf8");
  assert.match(src, /\.\/theme-store\.js/);
  assert.match(src, /onThemeChange/);
  assert.match(src, /getChartTheme/);
  // Should not have the duplicate region <select> binding `u` inside TrafficView filter bar
  assert.doesNotMatch(src, /label:"区域"\},\{default:c\(\(\)=>\[y\(a\("select"/);
  assert.match(src, /当前区域/);
  assert.match(src, /export\{[A-Za-z0-9_$]+ as default\}/);
});

test("CostView subscribes ECharts option to oci-theme-change via getChartTheme", () => {
  const src = fs.readFileSync("web-dist/assets/CostView-DMCrmlrj.js", "utf8");
  assert.match(src, /\.\/theme-store\.js/);
  assert.match(src, /onThemeChange/);
  assert.match(src, /getChartTheme/);
  assert.match(src, /export\{[A-Za-z0-9_$]+ as default\}/);
});
