import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { buildDeployConfig } from "../scripts/cf-deploy.mjs";

test("novnc/vnc.html syncs oci_mini_style and oci_mini_theme across all 6 modes and keeps #screen #000 + RFB logic", () => {
  const html = fs.readFileSync("web-dist/novnc/vnc.html", "utf8");
  assert.match(html, /oci_mini_style/);
  assert.match(html, /oci_mini_theme/);
  assert.match(html, /data-style/);
  assert.match(html, /html\[data-style="precision"\]/);
  assert.match(html, /html\[data-style="bento"\]/);
  assert.match(html, /html\[data-style="cockpit"\]/);
  assert.match(html, /html\[data-style="precision"\]\.light/);
  assert.match(html, /html\[data-style="bento"\]\.light/);
  assert.match(html, /html\[data-style="cockpit"\]\.light/);
  assert.match(html, /#screen\s*\{[^}]*background:\s*#000/);
  assert.match(html, /#bar\s*\{[^}]*z-index:\s*35/);
  assert.match(html, /import RFB from '\.\/core\/rfb\.js'/);
});

test("wrangler configs and deploy renderer include LOG_HUB + VNC_TUNNEL bindings and v1/v2 migrations, and dead noVNC files are pruned", () => {
  const wranglerToml = fs.readFileSync("wrangler.toml", "utf8");
  const wranglerImportToml = fs.readFileSync("wrangler.import.toml", "utf8");
  const renderedToml = buildDeployConfig(wranglerToml, {
    D1_DATABASE_ID: "12345678-1234-4123-8123-123456789abc",
  });

  for (const [label, cfg] of [
    ["wrangler.toml", wranglerToml],
    ["wrangler.import.toml", wranglerImportToml],
    ["buildDeployConfig output", renderedToml],
  ]) {
    assert.match(
      cfg,
      /\[\[durable_objects\.bindings\]\]\s+name\s*=\s*"LOG_HUB"\s+class_name\s*=\s*"LogHub"/,
      `${label} missing LOG_HUB binding`
    );
    assert.match(
      cfg,
      /\[\[durable_objects\.bindings\]\]\s+name\s*=\s*"VNC_TUNNEL"\s+class_name\s*=\s*"VncTunnel"/,
      `${label} missing VNC_TUNNEL binding`
    );
    assert.match(
      cfg,
      /\[\[migrations\]\]\s+tag\s*=\s*"v1"\s+new_sqlite_classes\s*=\s*\["LogHub"\]/,
      `${label} missing v1 LogHub migration`
    );
    assert.match(
      cfg,
      /\[\[migrations\]\]\s+tag\s*=\s*"v2"\s+new_sqlite_classes\s*=\s*\["VncTunnel"\]/,
      `${label} missing v2 VncTunnel migration`
    );
  }

  for (const removedPath of [
    "web-dist/novnc/app",
    "web-dist/novnc/vnc_lite.html",
    "web-dist/novnc/defaults.json",
  ]) {
    assert.equal(fs.existsSync(removedPath), false, `expected ${removedPath} to be removed`);
  }

  for (const keptPath of [
    "web-dist/novnc/vnc.html",
    "web-dist/novnc/core/rfb.js",
    "web-dist/novnc/vendor/pako",
  ]) {
    assert.equal(fs.existsSync(keptPath), true, `expected ${keptPath} to exist`);
  }

  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  assert.equal(pkg.type, "module");
  assert.equal(pkg.scripts?.test, "node --test tests/*.test.mjs");

  const readme = fs.readFileSync("README.md", "utf8");
  assert.doesNotMatch(readme, /\/google-callback/);
  assert.match(readme, /已获授权的 JavaScript 来源/);
  assert.match(readme, /默认关闭/);
});

test("all JavaScript assets in web-dist/assets and Worker/deploy scripts pass node --check", () => {
  const files = fs
    .readdirSync("web-dist/assets")
    .filter((f) => f.endsWith(".js"))
    .map((f) => `web-dist/assets/${f}`);
  for (const f of files) {
    execFileSync(process.execPath, ["--check", f], { stdio: "pipe" });
  }
  assert.ok(files.length >= 30);

  for (const workerFile of ["dist/index.js", "dist/tg-bot.js", "scripts/cf-deploy.mjs"]) {
    execFileSync(process.execPath, ["--check", workerFile], { stdio: "pipe" });
  }
});
