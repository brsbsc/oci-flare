import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("AppShell wraps RouterView in .shell-container, adds width toggle, 3-theme popover, mobile picker, and aria-labels", () => {
  const src = fs.readFileSync("web-dist/assets/AppShell-D9QnCYdV.js", "utf8");
  assert.match(src, /\.\/theme-store\.js/);
  assert.match(src, /STYLE_META/);
  assert.match(src, /shell-container/);
  assert.match(src, /shell-header-inner/);
  assert.match(src, /theme-popover/);
  assert.match(src, /theme-swatches/);
  assert.match(src, /brand-mark/);
  assert.match(src, /aria-expanded/);
  assert.match(src, /aria-label.*切换风格主题/);
  assert.match(src, /aria-label.*退出登录/);
  assert.match(src, /toggleWidth/);
  assert.match(src, /export\{[A-Za-z0-9_$]+ as default\}/);
});

test("LoginView aligns with theme-store, provides corner quick switcher, uses .brand-mark, and preserves auth flows", () => {
  const src = fs.readFileSync("web-dist/assets/LoginView-BU-WcVZj.js", "utf8");
  assert.match(src, /\.\/theme-store\.js/);
  assert.match(src, /STYLE_META/);
  assert.match(src, /login-theme-bar/);
  assert.match(src, /brand-mark/);
  assert.doesNotMatch(src, /from-sky-500 to-cyan-400/);
  assert.match(src, /googleLogin/);
  assert.match(src, /accounts\.google\.com\/gsi\/client/);
  assert.match(src, /export\{[A-Za-z0-9_$]+ as default\}/);
});
