function inferIconLabel(btn) {
  const title = btn.getAttribute("title")?.trim();
  if (title) return title;
  const svg = btn.querySelector("svg");
  if (!svg || !svg.classList) return null;
  if (svg.classList.contains("lucide-x")) return "关闭";
  if (svg.classList.contains("lucide-trash") || svg.classList.contains("lucide-trash-2")) {
    return "删除";
  }
  if (svg.classList.contains("lucide-refresh-cw")) return "刷新";
  if (svg.classList.contains("lucide-copy")) return "复制";
  if (svg.classList.contains("lucide-pencil")) return "编辑";
  return null;
}

function syncIconButtonLabels(root) {
  if (!root || typeof root.querySelectorAll !== "function") return;
  const buttons = root.querySelectorAll("button:not([aria-label])");
  for (const btn of buttons) {
    if ((btn.textContent || "").trim().length > 0) continue;
    if (!btn.querySelector || !btn.querySelector("svg")) continue;
    const label = inferIconLabel(btn);
    if (label) btn.setAttribute("aria-label", label);
  }
}

export function initUiEnhance(doc = document, win = window) {
  if (!doc || !win) return () => {};

  let savedAlertOpener = null;
  let alertWasOpen = false;

  const checkAlertDialogFocus = () => {
    const dlg = doc.querySelector ? doc.querySelector('[role="alertdialog"]') : null;
    if (dlg && !alertWasOpen) {
      alertWasOpen = true;
      savedAlertOpener = doc.activeElement || null;
      if (typeof dlg.setAttribute === "function" && !dlg.hasAttribute?.("tabindex")) {
        dlg.setAttribute("tabindex", "-1");
      }
      if (typeof dlg.focus === "function") {
        try {
          dlg.focus();
        } catch {}
      }
    } else if (!dlg && alertWasOpen) {
      alertWasOpen = false;
      const opener = savedAlertOpener;
      savedAlertOpener = null;
      if (opener && typeof opener.focus === "function" && opener.isConnected !== false) {
        try {
          opener.focus();
        } catch {}
      }
    }
  };

  const onKeyDown = (e) => {
    if (e.key !== "Escape") return;
    const dlg = doc.querySelector ? doc.querySelector('[role="alertdialog"]') : null;
    if (!dlg) return;
    e.preventDefault();
    if (typeof e.stopImmediatePropagation === "function") {
      e.stopImmediatePropagation();
    } else if (typeof e.stopPropagation === "function") {
      e.stopPropagation();
    }
    const closeBtn =
      dlg.querySelector?.('button[title="关闭"]') ||
      dlg.querySelector?.("button[type='button']") ||
      dlg.querySelector?.("button");
    if (closeBtn && typeof closeBtn.click === "function") {
      closeBtn.click();
    }
  };

  syncIconButtonLabels(doc.body || doc);
  doc.addEventListener("keydown", onKeyDown, true);

  let observer = null;
  if (typeof win.MutationObserver === "function" && doc.body) {
    observer = new win.MutationObserver(() => {
      syncIconButtonLabels(doc.body);
      checkAlertDialogFocus();
    });
    try {
      observer.observe(doc.body, { childList: true, subtree: true });
    } catch {}
  }

  return () => {
    doc.removeEventListener("keydown", onKeyDown, true);
    observer?.disconnect();
  };
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  const start = () => initUiEnhance(document, window);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
}
