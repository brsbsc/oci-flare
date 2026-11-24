import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("CfgView supports persistent Card/List view switcher, structured cards, refined list, and preserves all 4 dialogs", () => {
  const src = fs.readFileSync("web-dist/assets/CfgView-BJjU6PMD.js", "utf8");
  assert.match(src, /\.\/theme-store\.js/);
  assert.match(src, /getCfgView/);
  assert.match(src, /setCfgView/);
  assert.match(src, /segmented-group/);
  assert.match(src, /aria-pressed/);
  assert.match(src, /卡片/);
  assert.match(src, /列表/);
  assert.match(src, /cfg-grid/);
  assert.match(src, /cfg-card/);
  assert.match(src, /cfg-card-header/);
  assert.match(src, /cfg-card-meta/);
  assert.match(src, /cfg-meta-tile/);
  assert.match(src, /cfg-card-footer/);
  assert.match(src, /cfg-list/);
  assert.match(src, /cfg-list-row/);
  assert.match(src, /"aria-label":"删除配置"/);
  // Preserves all 4 dialogs & actions
  assert.match(src, /配置详情/);
  assert.match(src, /新增 OCI 配置/);
  assert.match(src, /编辑配置/);
  assert.match(src, /批量开机/);
  assert.match(src, /refreshPlanType/);
  assert.match(src, /export\{[A-Za-z0-9_$]+ as default\}/);
});
