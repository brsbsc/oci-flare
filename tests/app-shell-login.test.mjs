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

test("AppShell guards sidebar localStorage access with try/catch", () => {
  const src = fs.readFileSync("web-dist/assets/AppShell-D9QnCYdV.js", "utf8");
  assert.doesNotMatch(src, /ref\(localStorage\.getItem\("oci_mini_sidebar"\)/);
  assert.match(src, /try\{[^}]*localStorage\.getItem\("oci_mini_sidebar"\)[^}]*\}catch/);
  assert.match(src, /try\{[^}]*localStorage\.setItem\("oci_mini_sidebar"[^}]*\}catch/);
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

test("AppShell, LoginView, index.html, and README use OCI Flare branding, contain no upstream Yohann0617 links, and preserve encryption KDF constants", () => {
  const html = fs.readFileSync("web-dist/index.html", "utf8");
  const shell = fs.readFileSync("web-dist/assets/AppShell-D9QnCYdV.js", "utf8");
  const login = fs.readFileSync("web-dist/assets/LoginView-BU-WcVZj.js", "utf8");
  const readme = fs.readFileSync("README.md", "utf8");
  const backend = fs.readFileSync("dist/index.js", "utf8");

  for (const content of [shell, login, readme]) {
    assert.doesNotMatch(content, /Yohann0617/i);
  }
  assert.doesNotMatch(shell, /github\.com/i);
  assert.doesNotMatch(login, /github\.com/i);
  assert.match(html, /<title>OCI Flare<\/title>/);
  assert.match(shell, /"OCI Flare"/);
  assert.match(login, /"OCI Flare"/);
  assert.match(readme, /https:\/\/github\.com\/brsbsc\/oci-flare/);

  // Guardrail: HKDF & legacy key derivation salts MUST remain untouched for D1 data compatibility
  assert.match(backend, /"oci-helper-serverless:enc:v2:aes-gcm"/);
  assert.match(backend, /`oci-helper-serverless:\$\{secret\}`/);
});
