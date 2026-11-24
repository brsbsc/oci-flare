export const STORAGE_KEYS = Object.freeze({
  style: "oci_mini_style",
  theme: "oci_mini_theme",
  width: "oci_mini_width",
  cfgView: "oci_mini_cfg_view",
  sidebar: "oci_mini_sidebar",
});

export const VALID_STYLES = Object.freeze(["precision", "bento", "cockpit"]);
export const VALID_THEMES = Object.freeze(["dark", "light"]);
export const VALID_WIDTHS = Object.freeze(["boxed", "wide"]);
export const VALID_CFG_VIEWS = Object.freeze(["card", "list"]);

export const STYLE_META = Object.freeze([
  {
    id: "precision",
    name: "精密云控台",
    shortName: "精密",
    desc: "Linear / Vercel 极简精密 · 1px 清晰层级",
    swatches: {
      dark: ["#090D16", "#111827", "#2563EB"],
      light: ["#F8FAFC", "#FFFFFF", "#1D4ED8"],
    },
  },
  {
    id: "bento",
    name: "Bento 工作台",
    shortName: "Bento",
    desc: "Cloudflare / Apple 模块卡片 · 柔和透气",
    swatches: {
      dark: ["#0C111D", "#161F30", "#FB923C"],
      light: ["#F3F5F9", "#FFFFFF", "#2563EB"],
    },
  },
  {
    id: "cockpit",
    name: "Ops 驾驶舱",
    shortName: "驾驶舱",
    desc: "高密度终端风格 · 绿光状态遥测",
    swatches: {
      dark: ["#070B14", "#10192B", "#22C55E"],
      light: ["#EFF3F8", "#FFFFFF", "#047857"],
    },
  },
]);

function readStorage(key) {
  try {
    return typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(key, value);
    }
  } catch {}
}

function pickValid(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

export function getStyle() {
  return pickValid(readStorage(STORAGE_KEYS.style), VALID_STYLES, "precision");
}

export function getTheme() {
  return pickValid(readStorage(STORAGE_KEYS.theme), VALID_THEMES, "dark");
}

export function getWidth() {
  return pickValid(readStorage(STORAGE_KEYS.width), VALID_WIDTHS, "boxed");
}

export function getCfgView() {
  return pickValid(readStorage(STORAGE_KEYS.cfgView), VALID_CFG_VIEWS, "card");
}

export function applyPrefs(partial = {}) {
  const style = pickValid(
    partial.style !== undefined ? partial.style : getStyle(),
    VALID_STYLES,
    "precision"
  );
  const theme = pickValid(
    partial.theme !== undefined ? partial.theme : getTheme(),
    VALID_THEMES,
    "dark"
  );
  const width = pickValid(
    partial.width !== undefined ? partial.width : getWidth(),
    VALID_WIDTHS,
    "boxed"
  );

  writeStorage(STORAGE_KEYS.style, style);
  writeStorage(STORAGE_KEYS.theme, theme);
  writeStorage(STORAGE_KEYS.width, width);

  if (typeof document !== "undefined" && document.documentElement) {
    const el = document.documentElement;
    el.dataset.style = style;
    el.dataset.width = width;
    el.classList.toggle("light", theme === "light");
    el.classList.toggle("dark", theme === "dark");
    el.style.colorScheme = theme;
  }

  const detail = { style, theme, width };
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    try {
      window.dispatchEvent(new CustomEvent("oci-theme-change", { detail }));
    } catch {}
  }
  return detail;
}

export function setStyle(style) {
  return applyPrefs({ style });
}

export function setTheme(theme) {
  return applyPrefs({ theme });
}

export function toggleTheme() {
  return applyPrefs({ theme: getTheme() === "dark" ? "light" : "dark" });
}

export function setWidth(width) {
  return applyPrefs({ width });
}

export function toggleWidth() {
  return applyPrefs({ width: getWidth() === "boxed" ? "wide" : "boxed" });
}

export function setCfgView(mode) {
  const valid = pickValid(mode, VALID_CFG_VIEWS, "card");
  writeStorage(STORAGE_KEYS.cfgView, valid);
  return valid;
}

export function onThemeChange(callback) {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") {
    return () => {};
  }
  const handler = (event) => {
    callback(event?.detail || { style: getStyle(), theme: getTheme(), width: getWidth() });
  };
  window.addEventListener("oci-theme-change", handler);
  return () => window.removeEventListener("oci-theme-change", handler);
}

const FALLBACK_SERIES = [
  "#3B82F6",
  "#22C55E",
  "#F59E0B",
  "#EC4899",
  "#A78BFA",
  "#06B6D4",
  "#F97316",
  "#14B8A6",
];

export function getChartTheme() {
  const isLight = getTheme() === "light";
  const defaults = isLight
    ? {
        textPrimary: "#0F172A",
        textSecondary: "#334155",
        textMuted: "#475569",
        border: "#CBD5E1",
        gridLine: "rgba(15, 23, 42, 0.08)",
        surface: "#FFFFFF",
      }
    : {
        textPrimary: "#F8FAFC",
        textSecondary: "#CBD5E1",
        textMuted: "#94A3B8",
        border: "#334155",
        gridLine: "rgba(148, 163, 184, 0.14)",
        surface: "#111827",
      };

  if (
    typeof document === "undefined" ||
    !document.documentElement ||
    typeof getComputedStyle !== "function"
  ) {
    return { ...defaults, series: [...FALLBACK_SERIES] };
  }

  const cs = getComputedStyle(document.documentElement);
  const readVar = (name, fallback) => {
    const val = cs.getPropertyValue(name)?.trim();
    return val || fallback;
  };

  return {
    textPrimary: readVar("--text-primary", defaults.textPrimary),
    textSecondary: readVar("--text-secondary", defaults.textSecondary),
    textMuted: readVar("--text-muted", defaults.textMuted),
    border: readVar("--border", defaults.border),
    gridLine: readVar("--chart-grid", defaults.gridLine),
    surface: readVar("--surface", defaults.surface),
    series: FALLBACK_SERIES.map((fallback, idx) => readVar(`--chart-${idx + 1}`, fallback)),
  };
}
