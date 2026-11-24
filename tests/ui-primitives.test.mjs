import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("UiButton uses theme semantic classes and preserves _ and c exports", () => {
  const src = fs.readFileSync(
    "web-dist/assets/UiButton.vue_vue_type_script_setup_true_lang-B6_iRLwp.js",
    "utf8"
  );
  assert.match(src, /ui-btn-primary/);
  assert.match(src, /ui-btn-secondary/);
  assert.match(src, /ui-btn-danger/);
  assert.doesNotMatch(src, /from-sky-500 to-cyan-500/);
  assert.match(src, /export\{[A-Za-z0-9_$]+ as _,[A-Za-z0-9_$]+ as c\}/);
});

test("UiBadge uses semantic ui-badge classes and preserves _ export", () => {
  const src = fs.readFileSync(
    "web-dist/assets/UiBadge.vue_vue_type_script_setup_true_lang-BnzI1Z_L.js",
    "utf8"
  );
  assert.match(src, /ui-badge/);
  assert.match(src, /ui-badge-green/);
  assert.match(src, /export\{[A-Za-z0-9_$]+ as _\}/);
});

test("UiDialog supports modal and drawer variants, aria attributes, Escape yielding to alertdialog, and focus restore", () => {
  const src = fs.readFileSync(
    "web-dist/assets/UiDialog.vue_vue_type_script_setup_true_lang-BGya80so.js",
    "utf8"
  );
  assert.match(src, /variant:\{default:"modal"\}/);
  assert.match(src, /ui-dialog-drawer/);
  assert.match(src, /role:"dialog"/);
  assert.match(src, /"aria-modal":"true"/);
  assert.match(src, /"aria-label":"关闭"/);
  assert.match(src, /role="alertdialog"/);
  assert.match(src, /Escape/);
  assert.match(src, /activeElement/);
  assert.match(src, /export\{[A-Za-z0-9_$]+ as _\}/);
});

test("ui-enhance.js closes top alertdialog on Escape without propagating to underlying dialogs and mirrors icon button labels", async () => {
  const { initUiEnhance } = await import("../web-dist/assets/ui-enhance.js");

  let closeClicks = 0;
  let prevented = false;
  let stopped = false;
  let underlyingCalled = false;

  const closeBtn = {
    tagName: "BUTTON",
    textContent: "",
    attrs: { title: "关闭" },
    getAttribute(k) {
      return this.attrs[k] ?? null;
    },
    setAttribute(k, v) {
      this.attrs[k] = v;
    },
    hasAttribute(k) {
      return k in this.attrs;
    },
    querySelector(sel) {
      return sel === "svg" ? { classList: { contains: () => false } } : null;
    },
    click() {
      closeClicks++;
    },
    focus() {},
  };

  const textBtn = {
    tagName: "BUTTON",
    textContent: "保存",
    attrs: { title: "保存配置" },
    getAttribute(k) {
      return this.attrs[k] ?? null;
    },
    setAttribute(k, v) {
      this.attrs[k] = v;
    },
    hasAttribute(k) {
      return k in this.attrs;
    },
    querySelector() {
      return { classList: { contains: () => false } };
    },
  };

  const alertDialog = {
    querySelector(sel) {
      if (sel.includes('title="关闭"')) return closeBtn;
      return null;
    },
    querySelectorAll() {
      return [closeBtn];
    },
    focus() {},
  };

  const listeners = [];
  const mockDoc = {
    readyState: "complete",
    body: {
      querySelectorAll(sel) {
        return sel.includes("button") ? [closeBtn, textBtn] : [];
      },
    },
    activeElement: textBtn,
    querySelector(sel) {
      if (sel === '[role="alertdialog"]') return alertDialog;
      return null;
    },
    querySelectorAll(sel) {
      return sel.includes("button") ? [closeBtn, textBtn] : [];
    },
    addEventListener(type, fn, capture) {
      listeners.push({ type, fn, capture: !!capture });
    },
    removeEventListener() {},
  };

  const mockWin = {
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
  };

  const cleanup = initUiEnhance(mockDoc, mockWin);
  assert.equal(closeBtn.attrs["aria-label"], "关闭");
  assert.equal("aria-label" in textBtn.attrs, false);

  const keyListener = listeners.find((l) => l.type === "keydown" && l.capture);
  assert.ok(keyListener, "must register capture-phase keydown listener");

  keyListener.fn({
    key: "Escape",
    preventDefault() {
      prevented = true;
    },
    stopImmediatePropagation() {
      stopped = true;
    },
  });
  if (!stopped) underlyingCalled = true;

  assert.equal(closeClicks, 1);
  assert.equal(prevented, true);
  assert.equal(stopped, true);
  assert.equal(underlyingCalled, false);

  cleanup();
});
