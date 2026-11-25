import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

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

test("untouched core runtime, backend, config, and 6 resource chunks remain byte-identical to spec base commit", () => {
  const forbidden = [
    "dist/index.js",
    "wrangler.toml",
    "wrangler.import.toml",
    "package.json",
    "web-dist/assets/index-DwZEqr4A.js",
    "web-dist/assets/InstanceView-BQLVaoH-.js",
    "web-dist/assets/BootVolumeView-BSTURY2P.js",
    "web-dist/assets/NetworkView-B5MET1oN.js",
    "web-dist/assets/LimitsView-C5U4Cjpk.js",
    "web-dist/assets/TaskFormDialog.vue_vue_type_script_setup_true_lang-BfUx9eob.js",
    "web-dist/assets/UiField.vue_vue_type_script_setup_true_lang-CUb7rIgi.js",
  ];
  const diff = execFileSync("git", ["diff", "--name-only", "717851b", "--", ...forbidden], {
    encoding: "utf8",
  }).trim();
  assert.equal(diff, "", `forbidden files modified:\n${diff}`);
});

test("all JavaScript assets in web-dist/assets pass node --check", () => {
  const files = fs
    .readdirSync("web-dist/assets")
    .filter((f) => f.endsWith(".js"))
    .map((f) => `web-dist/assets/${f}`);
  for (const f of files) {
    execFileSync(process.execPath, ["--check", f], { stdio: "pipe" });
  }
  assert.ok(files.length >= 30);
});
