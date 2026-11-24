import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function makeMockDom(initialStorage = {}, throwing = false) {
  const store = new Map(Object.entries(initialStorage));
  const classes = new Set(["dark"]);
  const events = [];
  const listeners = new Map();

  const localStorage = {
    getItem(k) {
      if (throwing) throw new Error("SecurityError");
      return store.has(k) ? store.get(k) : null;
    },
    setItem(k, v) {
      if (throwing) throw new Error("SecurityError");
      store.set(k, String(v));
    },
  };

  const documentElement = {
    dataset: {},
    style: {},
    classList: {
      toggle(name, force) {
        if (force === undefined) {
          if (classes.has(name)) classes.delete(name);
          else classes.add(name);
        } else if (force) {
          classes.add(name);
        } else {
          classes.delete(name);
        }
      },
      contains(name) {
        return classes.has(name);
      },
    },
  };

  const win = {
    dispatchEvent(evt) {
      events.push(evt);
      for (const fn of listeners.get(evt.type) || []) fn(evt);
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
  };

  const computed = {
    getPropertyValue(prop) {
      const map = {
        "--text-primary": "#F8FAFC",
        "--text-secondary": "#CBD5E1",
        "--text-muted": "#94A3B8",
        "--border": "#334155",
        "--chart-grid": "rgba(148,163,184,0.16)",
        "--surface": "#111827",
        "--chart-1": "#3B82F6",
        "--chart-2": "#22C55E",
        "--chart-3": "#F59E0B",
        "--chart-4": "#EC4899",
        "--chart-5": "#A78BFA",
        "--chart-6": "#06B6D4",
        "--chart-7": "#F97316",
        "--chart-8": "#14B8A6",
      };
      return map[prop] || "";
    },
  };

  globalThis.localStorage = localStorage;
  globalThis.document = { documentElement };
  globalThis.window = win;
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  };
  globalThis.getComputedStyle = () => computed;

  return { store, classes, events, documentElement };
}

test("theme-store falls back to defaults on empty, invalid, or throwing storage", async () => {
  const store = await import("../web-dist/assets/theme-store.js");
  assert.deepEqual(store.VALID_STYLES, ["precision", "bento", "cockpit"]);
  assert.deepEqual(store.VALID_THEMES, ["dark", "light"]);
  assert.deepEqual(store.VALID_WIDTHS, ["boxed", "wide"]);
  assert.deepEqual(store.VALID_CFG_VIEWS, ["card", "list"]);
  assert.equal(store.STYLE_META.length, 3);
  assert.equal(store.STORAGE_KEYS.style, "oci_mini_style");
  assert.equal(store.STORAGE_KEYS.theme, "oci_mini_theme");
  assert.equal(store.STORAGE_KEYS.width, "oci_mini_width");
  assert.equal(store.STORAGE_KEYS.cfgView, "oci_mini_cfg_view");
  assert.equal(store.STORAGE_KEYS.sidebar, "oci_mini_sidebar");

  makeMockDom({
    oci_mini_style: "neon-garbage",
    oci_mini_theme: "sepia",
    oci_mini_width: "ultra",
    oci_mini_cfg_view: "kanban",
  });
  assert.equal(store.getStyle(), "precision");
  assert.equal(store.getTheme(), "dark");
  assert.equal(store.getWidth(), "boxed");
  assert.equal(store.getCfgView(), "card");

  makeMockDom({}, true);
  assert.equal(store.getStyle(), "precision");
  assert.equal(store.getTheme(), "dark");
  assert.equal(store.getWidth(), "boxed");
  assert.equal(store.getCfgView(), "card");
  assert.doesNotThrow(() => store.setStyle("bento"));
  assert.doesNotThrow(() => store.setCfgView("list"));
});

test("applyPrefs mutates html attrs, classes, colorScheme, persists storage, and dispatches oci-theme-change", async () => {
  const store = await import("../web-dist/assets/theme-store.js");
  const { store: mem, classes, events, documentElement } = makeMockDom();

  const received = [];
  const off = store.onThemeChange((d) => received.push(d));

  const res1 = store.setStyle("cockpit");
  assert.deepEqual(res1, { style: "cockpit", theme: "dark", width: "boxed" });
  assert.equal(documentElement.dataset.style, "cockpit");
  assert.equal(mem.get("oci_mini_style"), "cockpit");

  const res2 = store.toggleTheme();
  assert.deepEqual(res2, { style: "cockpit", theme: "light", width: "boxed" });
  assert.equal(classes.has("light"), true);
  assert.equal(classes.has("dark"), false);
  assert.equal(documentElement.style.colorScheme, "light");
  assert.equal(mem.get("oci_mini_theme"), "light");

  const res3 = store.toggleWidth();
  assert.deepEqual(res3, { style: "cockpit", theme: "light", width: "wide" });
  assert.equal(documentElement.dataset.width, "wide");
  assert.equal(mem.get("oci_mini_width"), "wide");

  assert.equal(events.length, 3);
  assert.equal(events[2].type, "oci-theme-change");
  assert.equal(received.length, 3);
  assert.deepEqual(received[2], res3);

  off();
  store.setStyle("bento");
  assert.equal(received.length, 3);
});

test("setCfgView persists card/list and rejects unknown values to card", async () => {
  const store = await import("../web-dist/assets/theme-store.js");
  const { store: mem } = makeMockDom();
  assert.equal(store.setCfgView("list"), "list");
  assert.equal(mem.get("oci_mini_cfg_view"), "list");
  assert.equal(store.getCfgView(), "list");
  assert.equal(store.setCfgView("bogus"), "card");
  assert.equal(mem.get("oci_mini_cfg_view"), "card");
});

test("getChartTheme reads computed CSS tokens cleanly", async () => {
  const store = await import("../web-dist/assets/theme-store.js");
  makeMockDom();
  const ct = store.getChartTheme();
  assert.equal(ct.textPrimary, "#F8FAFC");
  assert.equal(ct.surface, "#111827");
  assert.equal(ct.series.length, 8);
  assert.equal(ct.series[0], "#3B82F6");
});

test("index.html loads theme-system.css, ui-enhance.js, and sets data-style/data-width/theme synchronously before #app", () => {
  const html = fs.readFileSync("web-dist/index.html", "utf8");
  assert.match(html, /\/assets\/theme-system\.css\?v=20261125/);
  assert.match(html, /\/assets\/ui-enhance\.js\?v=20261125/);
  assert.match(html, /oci_mini_style/);
  assert.match(html, /oci_mini_width/);
  assert.match(html, /data-style/);
  assert.match(html, /data-width/);
  assert.ok(html.indexOf("oci_mini_style") < html.indexOf('<div id="app">'));
});
