/**
 * Telegram Bot 双向交互独立 ESM 模块。
 * 负责 Webhook 鉴权与去重、Telegram Bot API 调用、内部路由透传、以及 Webhook 管理接口。
 */

const enc = new TextEncoder();
const MAX_SEEN_UPDATES = 500;
const DEFAULT_TG_TIMEOUT_MS = 10000;
const WEBHOOK_INFO_TIMEOUT_MS = 5000;

const BOT_COMMANDS = [
  { command: "start", description: "打开主菜单与运行总览" },
  { command: "status", description: "查看配置与任务运行状态" },
  { command: "cfgs", description: "浏览 OCI 账号配置与实例" },
  { command: "tasks", description: "查看与管理抢机/换IP任务" },
  { command: "help", description: "查看可用指令与安全说明" },
];

/**
 * 常量时间字符串比对，防止计时侧信道攻击。
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = enc.encode(a);
  const bufB = enc.encode(b);
  const maxLen = Math.max(bufA.length, bufB.length);
  let diff = bufA.length ^ bufB.length;
  for (let i = 0; i < maxLen; i++) {
    diff |= (i < bufA.length ? bufA[i] : 0) ^ (i < bufB.length ? bufB[i] : 0);
  }
  return diff === 0;
}

/**
 * 对动态文本执行 Telegram HTML 模式所需转义（& < >）。
 * @param {unknown} text
 * @returns {string}
 */
export function escapeHtml(text) {
  if (text === null || text === undefined) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const PAGE_SIZE = 5;
const OPEN_HTML_TAG_RE = /<(\/?)([a-zA-Z0-9-]+)(?:\s[^>]*)?>/g;

function findSafeHtmlCutIndex(s, rawEnd) {
  let end = Math.max(0, Math.min(rawEnd, s.length));
  if (end > 0) {
    const code = s.charCodeAt(end - 1);
    if (code >= 0xd800 && code <= 0xdbff) {
      end -= 1;
    }
  }
  const lastLt = s.lastIndexOf("<", end - 1);
  const lastGt = s.lastIndexOf(">", end - 1);
  if (lastLt > lastGt) {
    end = lastLt;
  }
  const tail = s.slice(Math.max(0, end - 10), end);
  const entityMatch = tail.match(/&[a-zA-Z0-9#]*$/);
  if (entityMatch) {
    end -= entityMatch[0].length;
  }
  return Math.max(0, end);
}

function getUnclosedHtmlTags(htmlPrefix) {
  const stack = [];
  OPEN_HTML_TAG_RE.lastIndex = 0;
  let m;
  while ((m = OPEN_HTML_TAG_RE.exec(htmlPrefix)) !== null) {
    const isClose = m[1] === "/";
    const tag = m[2].toLowerCase();
    if (!isClose) {
      stack.push(tag);
    } else {
      const idx = stack.lastIndexOf(tag);
      if (idx !== -1) {
        stack.splice(idx, 1);
      }
    }
  }
  return stack;
}

/**
 * 截断 Telegram HTML 消息文本至安全长度：避免截断代理对/HTML 标签/实体，并自动闭合未关闭标签。
 * @param {string} text
 * @param {number} [maxLen=3800]
 * @returns {string}
 */
export function truncateTelegramText(text, maxLen = 3800) {
  const s = text == null ? "" : String(text);
  const limit = Number.isFinite(maxLen) ? Math.floor(maxLen) : 3800;
  if (limit <= 0) return "";
  if (s.length <= limit) return s;
  if (limit === 1) return "…";

  let end = findSafeHtmlCutIndex(s, limit - 1);
  let closing = "";
  for (let i = 0; i < 4; i++) {
    const openTags = getUnclosedHtmlTags(s.slice(0, end));
    closing = openTags.reverse().map((t) => `</${t}>`).join("");
    if (end + closing.length + 1 <= limit) {
      break;
    }
    const nextRawEnd = Math.max(0, limit - 1 - closing.length);
    end = findSafeHtmlCutIndex(s, nextRawEnd);
  }
  if (end + closing.length + 1 > limit) {
    closing = "";
    end = findSafeHtmlCutIndex(s, limit - 1);
  }
  return `${s.slice(0, end)}${closing}…`;
}

/**
 * 基于 Web Crypto SHA-256 为长 OCID 生成确定性 8 位小写十六进制短标识。
 * @param {string} ocid
 * @returns {Promise<string>}
 */
export async function shortInstanceId(ocid) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(String(ocid ?? "")));
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < 4; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * 解析并校验 Telegram callback_data（须非空、冒号分段不少于 2 段且 UTF-8 <= 64 字节）。
 * @param {string} raw
 * @returns {{ scope: string, action: string, args: string[] } | null}
 */
export function parseCallbackData(raw) {
  if (typeof raw !== "string" || !raw) return null;
  if (enc.encode(raw).length > 64) return null;
  const parts = raw.split(":");
  if (parts.length < 2 || parts.some((p) => p.length === 0)) return null;
  return { scope: parts[0], action: parts[1], args: parts.slice(2) };
}

function redactBotToken(msg) {
  return String(msg ?? "").replace(/\/bot[^/\s]+\//g, "/bot***/");
}

function backHomeKeyboard(label, callbackData) {
  return {
    inline_keyboard: [
      [
        { text: label, callback_data: callbackData },
        { text: "🏠 主菜单", callback_data: "m:home" },
      ],
    ],
  };
}

/**
 * 调用 Telegram Bot API，默认 10s 超时，并静默忽略 editMessageText 的无变更提示。
 * @param {string} token
 * @param {string} method
 * @param {object} [payload={}]
 * @param {typeof fetch} [tgFetch=fetch]
 * @param {number} [timeoutMs=10000]
 * @returns {Promise<any>}
 */
export async function callTelegramApi(
  token,
  method,
  payload = {},
  tgFetch = fetch,
  timeoutMs = DEFAULT_TG_TIMEOUT_MS
) {
  let res;
  try {
    res = await tgFetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload ?? {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new Error(redactBotToken(err?.message ?? err));
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    const desc = redactBotToken(data?.description || "");
    if (method === "editMessageText" && desc.toLowerCase().includes("message is not modified")) {
      return null;
    }
    throw new Error(desc || `Telegram 返回 ${res.status}`);
  }
  return data.result !== undefined ? data.result : data;
}

/**
 * 通过 60 秒短效内部 Token 调用 Hono app 现有业务路由，透传真实 env 与 ctx。
 * @param {any} app
 * @param {object} deps
 * @param {any} env
 * @param {any} ctx
 * @param {string} path
 * @param {{ method?: string, body?: any }} [opts]
 * @returns {Promise<{ ok: boolean, status: number, data: any, error?: string }>}
 */
export async function callInternalApi(app, deps, env, ctx, path, opts = {}) {
  try {
    const token = await deps.issueToken(await deps.authSecret(env), await deps.authVersion(env), 60);
    const method = (opts?.method || "GET").toUpperCase();
    const headers = { authorization: `Bearer ${token}` };
    const init = { method, headers };
    if (opts?.body !== undefined && method !== "GET" && method !== "HEAD") {
      headers["content-type"] = "application/json";
      init.body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
    }
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const req = new Request(`https://internal.local${normalizedPath}`, init);
    const res = await app.fetch(req, env, ctx);
    const rawText = await res.text();
    let data = null;
    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      data = rawText;
    }
    if (!res.ok) {
      const error =
        data && typeof data === "object" && (data.error || data.message)
          ? String(data.error || data.message)
          : `HTTP ${res.status}`;
      return { ok: false, status: res.status, data, error };
    }
    return { ok: true, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 500, data: null, error: e?.message ?? String(e) };
  }
}

function imapKey(cfgId) {
  return `tg.imap:${cfgId}`;
}

function truncateLabel(text, maxLen = 22) {
  const s = String(text ?? "").trim();
  if (s.length <= maxLen) return s;
  return `${s.slice(0, Math.max(1, maxLen - 1))}…`;
}

function cfgStatusBadge(status) {
  if (status === "active") return "✅ 已连接";
  if (status === "invalid") return "❌ 失效";
  return "⚪ 未校验";
}

function instanceStateBadge(state) {
  const upper = String(state || "").toUpperCase();
  if (upper === "RUNNING") return "🟢";
  if (upper === "TERMINATED" || upper === "TERMINATING") return "🔴";
  if (upper === "STARTING" || upper === "STOPPING" || upper === "PROVISIONING") return "🟡";
  return "⚪";
}

function taskStatusBadge(status) {
  if (status === "running") return "🟢 运行中";
  if (status === "paused") return "⏸ 已暂停";
  if (status === "completed") return "✅ 已完成";
  if (status === "failed") return "❌ 失败";
  return escapeHtml(status || "未知");
}

function normalizeInstanceEntry(inst, fallbackRegion) {
  let publicIps = [];
  if (Array.isArray(inst?.publicIps)) {
    publicIps = inst.publicIps.map(String).filter(Boolean);
  } else if (Array.isArray(inst?.vnics)) {
    publicIps = inst.vnics.map((v) => v?.publicIp).filter(Boolean).map(String);
  }
  const entry = {
    id: String(inst?.id ?? ""),
    name: String(inst?.displayName ?? inst?.name ?? inst?.id ?? ""),
    state: String(inst?.lifecycleState ?? inst?.state ?? "UNKNOWN"),
    shape: String(inst?.shape ?? ""),
    publicIps,
    region: String(inst?.region ?? fallbackRegion ?? ""),
  };
  if (inst?.ocpus !== undefined && inst?.ocpus !== null) {
    entry.ocpus = inst.ocpus;
  }
  const mem = inst?.memoryInGBs ?? inst?.memoryGb;
  if (mem !== undefined && mem !== null) {
    entry.memoryGb = mem;
  }
  return entry;
}

async function buildAndSaveInstanceMap(deps, env, cfgId, items, fallbackRegion) {
  const map = {};
  for (const inst of items) {
    if (!inst?.id) continue;
    const short8 = await shortInstanceId(inst.id);
    map[short8] = normalizeInstanceEntry(inst, fallbackRegion);
  }
  await deps.sysSet(env, imapKey(cfgId), JSON.stringify({ ts: Date.now(), map }));
  return map;
}

async function resolveInstanceEntry(app, deps, env, ctx, cfgId, short8) {
  if (!cfgId || !short8) return null;
  const raw = await deps.sysGet(env, imapKey(cfgId));
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      const hit = parsed?.map?.[short8];
      if (hit?.id) {
        return {
          entry: normalizeInstanceEntry(hit, hit.region),
          fromCache: true,
          map: parsed.map,
        };
      }
    } catch {
      // 缓存损坏时回源重建
    }
  }

  const res = await callInternalApi(
    app,
    deps,
    env,
    ctx,
    `/api/cfgs/${encodeURIComponent(cfgId)}/instances`
  );
  if (!res.ok) return null;
  const items = Array.isArray(res.data?.items) ? res.data.items : [];
  const fallbackRegion = String(res.data?.region || "");
  const map = await buildAndSaveInstanceMap(deps, env, cfgId, items, fallbackRegion);
  return map[short8]?.id ? { entry: map[short8], fromCache: false, map } : null;
}

/**
 * 通过 8 位实例短 ID 解析完整 OCID 与摘要信息，缓存未命中时自动回源拉取并刷新 tg.imap:<cfgId>。
 * @param {any} app
 * @param {object} deps
 * @param {any} env
 * @param {any} ctx
 * @param {string} cfgId
 * @param {string} short8
 * @returns {Promise<{ id: string, name: string, state: string, shape: string, publicIps: string[], region: string, ocpus?: number, memoryGb?: number } | null>}
 */
export async function resolveInstanceByShortId(app, deps, env, ctx, cfgId, short8) {
  const resolved = await resolveInstanceEntry(app, deps, env, ctx, cfgId, short8);
  return resolved?.entry ?? null;
}

function buildHelpMessage() {
  return {
    text: truncateTelegramText(
      [
        "<b>ℹ️ OCI Helper Bot 指令说明</b>",
        "",
        "• /start — 打开主菜单与运行总览",
        "• /status — 查看全局配置与任务统计",
        "• /cfgs — 分页查看 OCI 配置、测活及实例控制",
        "• /tasks — 分页查看抢机/换 IP 任务并启停或立即执行",
        "• /help — 显示本帮助信息",
        "",
        "<i>安全提示：破坏性操作（删除配置、终止实例、删除任务、修改密钥/口令）仅保留在 Web 面板；关机、重启、换 IP 等变更操作均需二次确认。</i>",
      ].join("\n")
    ),
    reply_markup: {
      inline_keyboard: [[{ text: "🏠 主菜单", callback_data: "m:home" }]],
    },
  };
}

async function buildOverviewView(app, deps, env, ctx) {
  const [cfgsRes, launchRes, ipRes] = await Promise.all([
    callInternalApi(app, deps, env, ctx, "/api/cfgs?page=1&pageSize=100"),
    callInternalApi(app, deps, env, ctx, "/api/tasks?type=launch&page=1&pageSize=100"),
    callInternalApi(app, deps, env, ctx, "/api/ip-tasks?page=1&pageSize=100"),
  ]);
  const failed = [cfgsRes, launchRes, ipRes].find((r) => !r.ok);
  if (failed) {
    return {
      text: truncateTelegramText(
        `<b>❌ 获取总览失败</b>\n<code>${escapeHtml(failed.error || "内部接口异常")}</code>`
      ),
      reply_markup: backHomeKeyboard("🔄 重试", "m:st"),
    };
  }

  const cfgs = Array.isArray(cfgsRes.data?.items) ? cfgsRes.data.items : [];
  const cfgTotal = Number(cfgsRes.data?.total ?? cfgs.length);
  const cfgValid = cfgs.filter((c) => c.status === "active").length;
  const cfgInvalid = cfgs.filter((c) => c.status === "invalid").length;

  const launchItems = Array.isArray(launchRes.data?.items) ? launchRes.data.items : [];
  const launchTotal = Number(launchRes.data?.total ?? launchItems.length);
  const launchRunning = launchItems.filter((t) => t.status === "running").length;

  const ipItems = Array.isArray(ipRes.data?.items) ? ipRes.data.items : [];
  const ipTotal = Number(ipRes.data?.total ?? ipItems.length);
  const ipRunning = ipItems.filter((t) => t.status === "running").length;

  return {
    text: truncateTelegramText(
      [
        "<b>📊 OCI Helper 总览</b>",
        "",
        `☁️ OCI 配置：${cfgTotal} 个（有效 ${cfgValid} · 失效 ${cfgInvalid}）`,
        `🚀 抢机任务：${launchTotal} 个（运行中 ${launchRunning}）`,
        `🔄 换 IP 任务：${ipTotal} 个（运行中 ${ipRunning}）`,
      ].join("\n")
    ),
    reply_markup: {
      inline_keyboard: [
        [
          { text: "☁️ OCI 配置", callback_data: "c:ls:1" },
          { text: "🚀 任务管理", callback_data: "t:ls:l:1" },
        ],
        [{ text: "🔄 刷新总览", callback_data: "m:st" }],
      ],
    },
  };
}

async function buildConfigListView(app, deps, env, ctx, page = 1) {
  const safeReqPage = Math.max(1, Number(page) || 1);
  let res = await callInternalApi(
    app,
    deps,
    env,
    ctx,
    `/api/cfgs?page=${safeReqPage}&pageSize=${PAGE_SIZE}`
  );
  if (!res.ok) {
    return {
      text: truncateTelegramText(`<b>❌ 获取配置列表失败</b>\n<code>${escapeHtml(res.error)}</code>`),
      reply_markup: backHomeKeyboard("🔄 刷新", `c:ls:${safeReqPage}`),
    };
  }

  let items = Array.isArray(res.data?.items) ? res.data.items : [];
  let total = Number(res.data?.total ?? items.length);
  let totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  let curPage = Math.min(safeReqPage, totalPages);
  if (items.length === 0 && total > 0 && safeReqPage > totalPages) {
    const retry = await callInternalApi(app, deps, env, ctx, `/api/cfgs?page=${totalPages}&pageSize=${PAGE_SIZE}`);
    if (retry.ok) {
      res = retry;
      items = Array.isArray(res.data?.items) ? res.data.items : [];
      total = Number(res.data?.total ?? items.length);
      totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      curPage = Math.min(totalPages, curPage);
    }
  }

  const lines = [`<b>☁️ OCI 配置列表</b>（第 ${curPage}/${totalPages} 页 · 共 ${total} 个）`, ""];
  const keyboard = [];

  if (items.length === 0) {
    lines.push("暂无 OCI 配置，请在 Web 面板中添加。");
  } else {
    items.forEach((cfg, idx) => {
      const num = (curPage - 1) * PAGE_SIZE + idx + 1;
      const icon = cfg.status === "active" ? "✅" : cfg.status === "invalid" ? "❌" : "⚪";
      lines.push(
        `${num}. ${icon} <b>${escapeHtml(cfg.name || cfg.id)}</b> · <code>${escapeHtml(
          cfg.region || "-"
        )}</code> · 任务 ${Number(cfg.runningTaskCount ?? 0)}/${Number(cfg.taskCount ?? 0)}`
      );
      keyboard.push([{ text: `${num}. ${truncateLabel(cfg.name || cfg.id)}`, callback_data: `c:v:${cfg.id}` }]);
    });
  }

  const navRow = [];
  if (curPage > 1) navRow.push({ text: "⬅️ 上一页", callback_data: `c:ls:${curPage - 1}` });
  if (curPage < totalPages) navRow.push({ text: "下一页 ➡️", callback_data: `c:ls:${curPage + 1}` });
  if (navRow.length) keyboard.push(navRow);

  keyboard.push([
    { text: "🔄 刷新", callback_data: `c:ls:${curPage}` },
    { text: "🏠 主菜单", callback_data: "m:home" },
  ]);

  return {
    text: truncateTelegramText(lines.join("\n")),
    reply_markup: { inline_keyboard: keyboard },
  };
}

async function buildConfigDetailView(app, deps, env, ctx, cfgId) {
  const res = await callInternalApi(app, deps, env, ctx, `/api/cfgs/${encodeURIComponent(cfgId)}`);
  if (!res.ok || !res.data?.item) {
    return {
      text: truncateTelegramText(`<b>❌ 获取配置详情失败</b>\n<code>${escapeHtml(res.error || "配置不存在")}</code>`),
      reply_markup: backHomeKeyboard("⬅️ 返回列表", "c:ls:1"),
    };
  }

  const item = res.data.item;
  const regionCount = Array.isArray(item.regions) ? item.regions.length : 0;
  const lines = [
    `<b>☁️ ${escapeHtml(item.name || item.id)}</b>`,
    "",
    `状态：${cfgStatusBadge(item.status)} · 套餐：<code>${escapeHtml(item.planType || "-")}</code>`,
    `主区域：<code>${escapeHtml(item.region || "-")}</code>${regionCount ? `（订阅 ${regionCount} 区）` : ""}`,
    `关联任务：${Number(item.taskCount ?? 0)} 个（运行中 ${Number(item.runningTaskCount ?? 0)}）`,
    `上次校验：<code>${escapeHtml(item.lastCheckedAt || "尚未校验")}</code>`,
  ];
  if (item.lastError) {
    lines.push(`最近错误：<code>${escapeHtml(item.lastError)}</code>`);
  }

  return {
    text: truncateTelegramText(lines.join("\n")),
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🩺 立即测活", callback_data: `c:chk:${cfgId}` },
          { text: "🖥 查看实例", callback_data: `c:ins:${cfgId}:1` },
        ],
        [
          { text: "⬅️ 返回列表", callback_data: "c:ls:1" },
          { text: "🏠 主菜单", callback_data: "m:home" },
        ],
      ],
    },
  };
}

async function buildConfigCheckView(app, deps, env, ctx, cfgId) {
  const res = await callInternalApi(app, deps, env, ctx, `/api/cfgs/${encodeURIComponent(cfgId)}/check`, {
    method: "POST",
  });
  let lines;
  if (res.ok) {
    const regionsCount = Array.isArray(res.data?.regions) ? res.data.regions.length : 0;
    const adsCount = Array.isArray(res.data?.availabilityDomains) ? res.data.availabilityDomains.length : 0;
    lines = [
      "<b>✅ 配置测活成功</b>",
      "",
      ...(res.data?.tenancyName ? [`租户：<code>${escapeHtml(res.data.tenancyName)}</code>`] : []),
      `订阅区域：${regionsCount} 个`,
      `可用域 (AD)：${adsCount} 个`,
      ...(res.data?.planType ? [`套餐类型：<code>${escapeHtml(res.data.planType)}</code>`] : []),
    ];
  } else {
    lines = [
      "<b>❌ 配置测活失败</b>",
      "",
      `错误：<code>${escapeHtml(res.error || res.data?.error || "校验失败")}</code>`,
    ];
  }

  return {
    text: truncateTelegramText(lines.join("\n")),
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🔁 再次测活", callback_data: `c:chk:${cfgId}` },
          { text: "🖥 查看实例", callback_data: `c:ins:${cfgId}:1` },
        ],
        [{ text: "⬅️ 配置详情", callback_data: `c:v:${cfgId}` }],
      ],
    },
  };
}

async function buildInstanceListView(app, deps, env, ctx, cfgId, page = 1) {
  const [cfgRes, insRes] = await Promise.all([
    callInternalApi(app, deps, env, ctx, `/api/cfgs/${encodeURIComponent(cfgId)}`),
    callInternalApi(app, deps, env, ctx, `/api/cfgs/${encodeURIComponent(cfgId)}/instances`),
  ]);

  if (!insRes.ok) {
    return {
      text: truncateTelegramText(`<b>❌ 获取实例列表失败</b>\n<code>${escapeHtml(insRes.error)}</code>`),
      reply_markup: {
        inline_keyboard: [
          [
            { text: "🔄 重试", callback_data: `c:ins:${cfgId}:1` },
            { text: "⬅️ 配置详情", callback_data: `c:v:${cfgId}` },
          ],
        ],
      },
    };
  }

  const cfgItem = cfgRes.data?.item || {};
  const cfgName = String(cfgItem.name || cfgId);
  const cfgRegion = String(cfgItem.region || insRes.data?.region || "");
  const items = Array.isArray(insRes.data?.items) ? insRes.data.items : [];
  await buildAndSaveInstanceMap(deps, env, cfgId, items, cfgRegion);

  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const curPage = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const pageItems = items.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);

  const lines = [
    `<b>🖥 ${escapeHtml(cfgName)} · 实例列表</b>`,
    `默认主区域：<code>${escapeHtml(cfgRegion || "-")}</code>（第 ${curPage}/${totalPages} 页 · 共 ${total} 台）`,
    "",
  ];
  const keyboard = [];

  if (pageItems.length === 0) {
    lines.push("当前默认主区域下暂无实例。");
  } else {
    for (let i = 0; i < pageItems.length; i++) {
      const inst = pageItems[i];
      const norm = normalizeInstanceEntry(inst, cfgRegion);
      const short8 = await shortInstanceId(norm.id);
      const num = (curPage - 1) * PAGE_SIZE + i + 1;
      const ipsText = norm.publicIps.length ? norm.publicIps.join(", ") : "无公网IP";
      lines.push(
        `${num}. ${instanceStateBadge(norm.state)} <b>${escapeHtml(norm.name)}</b> · <code>${escapeHtml(
          norm.state
        )}</code>\n   IP：<code>${escapeHtml(ipsText)}</code>`
      );
      keyboard.push([
        {
          text: `${num}. ${truncateLabel(norm.name)}`,
          callback_data: `i:v:${cfgId}:${short8}`,
        },
      ]);
    }
  }

  const navRow = [];
  if (curPage > 1) navRow.push({ text: "⬅️ 上一页", callback_data: `c:ins:${cfgId}:${curPage - 1}` });
  if (curPage < totalPages) navRow.push({ text: "下一页 ➡️", callback_data: `c:ins:${cfgId}:${curPage + 1}` });
  if (navRow.length) keyboard.push(navRow);

  keyboard.push([
    { text: "🔄 刷新", callback_data: `c:ins:${cfgId}:${curPage}` },
    { text: "⬅️ 配置详情", callback_data: `c:v:${cfgId}` },
  ]);

  return {
    text: truncateTelegramText(lines.join("\n")),
    reply_markup: { inline_keyboard: keyboard },
  };
}

async function refreshLiveInstanceEntry(app, deps, env, ctx, cfgId, short8, resolved) {
  let inst = resolved.entry;
  if (!resolved.fromCache) return inst;

  const detailRes = await callInternalApi(
    app,
    deps,
    env,
    ctx,
    `/api/cfgs/${encodeURIComponent(cfgId)}/instances/${encodeURIComponent(inst.id)}`
  );
  const rawItem = detailRes.data?.item ?? detailRes.data?.instance ?? (detailRes.data?.id ? detailRes.data : null);
  if (detailRes.ok && rawItem) {
    const live = normalizeInstanceEntry(rawItem, inst.region);
    const merged = {
      ...inst,
      ...live,
      id: live.id || inst.id,
      name: rawItem?.displayName || rawItem?.name ? live.name : inst.name,
      state: rawItem?.lifecycleState || rawItem?.state ? live.state : inst.state,
      shape: rawItem?.shape ? live.shape : inst.shape,
      region: rawItem?.region ? live.region : inst.region,
      publicIps:
        Array.isArray(rawItem?.publicIps) || Array.isArray(rawItem?.vnics)
          ? live.publicIps
          : inst.publicIps,
    };
    const nextMap = { ...(resolved.map || {}), [short8]: merged };
    await deps.sysSet(env, imapKey(cfgId), JSON.stringify({ ts: Date.now(), map: nextMap }));
    return merged;
  }

  const listRes = await callInternalApi(
    app,
    deps,
    env,
    ctx,
    `/api/cfgs/${encodeURIComponent(cfgId)}/instances`
  );
  if (listRes.ok) {
    const items = Array.isArray(listRes.data?.items) ? listRes.data.items : [];
    const fallbackRegion = String(listRes.data?.region || inst.region || "");
    const map = await buildAndSaveInstanceMap(deps, env, cfgId, items, fallbackRegion);
    return map[short8]?.id ? map[short8] : null;
  }
  return inst;
}

async function buildInstanceDetailView(app, deps, env, ctx, cfgId, short8) {
  const resolved = await resolveInstanceEntry(app, deps, env, ctx, cfgId, short8);
  const inst = resolved?.entry
    ? await refreshLiveInstanceEntry(app, deps, env, ctx, cfgId, short8, resolved)
    : null;
  if (!inst) {
    return {
      text: truncateTelegramText("<b>⚠️ 未找到该实例</b>\n实例可能已终止或配置已移除。"),
      reply_markup: backHomeKeyboard("⬅️ 实例列表", `c:ins:${cfgId}:1`),
    };
  }

  const specExtra =
    inst.ocpus !== undefined || inst.memoryGb !== undefined
      ? ` (${inst.ocpus ?? "-"}C / ${inst.memoryGb ?? "-"}G)`
      : "";
  const ipsText = inst.publicIps.length ? inst.publicIps.join(", ") : "无";

  return {
    text: truncateTelegramText(
      [
        `<b>🖥 ${escapeHtml(inst.name || inst.id)}</b>`,
        "",
        `区域：<code>${escapeHtml(inst.region || "-")}</code>`,
        `状态：${instanceStateBadge(inst.state)} <code>${escapeHtml(inst.state)}</code>`,
        `规格：<code>${escapeHtml(inst.shape || "-")}${escapeHtml(specExtra)}</code>`,
        `公网 IP：<code>${escapeHtml(ipsText)}</code>`,
      ].join("\n")
    ),
    reply_markup: {
      inline_keyboard: [
        [
          { text: "▶️ 开机", callback_data: `i:do:st:${cfgId}:${short8}` },
          { text: "⏹ 关机", callback_data: `i:ask:sp:${cfgId}:${short8}` },
          { text: "🔁 重启", callback_data: `i:ask:rs:${cfgId}:${short8}` },
        ],
        [{ text: "🌐 一键换公网 IP", callback_data: `i:ask:ip:${cfgId}:${short8}` }],
        [
          { text: "🔄 刷新", callback_data: `i:v:${cfgId}:${short8}` },
          { text: "⬅️ 实例列表", callback_data: `c:ins:${cfgId}:1` },
        ],
      ],
    },
  };
}

async function buildInstanceAskView(app, deps, env, ctx, op, cfgId, short8) {
  const opMeta = {
    sp: { title: "软关机 (SOFTSTOP)", warn: "关机后实例将停止对外服务，可通过 Telegram 再次开机。" },
    rs: { title: "软重启 (SOFTRESET)", warn: "重启期间实例将短暂失联。" },
    ip: { title: "一键换公网 IP", warn: "更换公网 IP 期间网络会短暂中断，原临时公网 IP 将释放。" },
  }[op];
  if (!opMeta) return null;

  const inst = await resolveInstanceByShortId(app, deps, env, ctx, cfgId, short8);
  const name = inst?.name || short8;
  const ips = inst?.publicIps?.length ? inst.publicIps.join(", ") : "无";

  return {
    text: truncateTelegramText(
      [
        `<b>⚠️ 确认执行：${escapeHtml(opMeta.title)}？</b>`,
        "",
        `实例：<b>${escapeHtml(name)}</b>`,
        `当前公网 IP：<code>${escapeHtml(ips)}</code>`,
        escapeHtml(opMeta.warn),
      ].join("\n")
    ),
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ 确认执行", callback_data: `i:do:${op}:${cfgId}:${short8}` },
          { text: "❌ 取消", callback_data: `i:v:${cfgId}:${short8}` },
        ],
      ],
    },
  };
}

async function buildInstanceDoView(app, deps, env, ctx, op, cfgId, short8) {
  const actionMap = { st: "START", sp: "SOFTSTOP", rs: "SOFTRESET" };
  if (op !== "ip" && !actionMap[op]) return null;

  const inst = await resolveInstanceByShortId(app, deps, env, ctx, cfgId, short8);
  if (!inst) {
    return {
      text: truncateTelegramText("<b>❌ 操作失败</b>\n未找到对应实例，请返回实例列表刷新。"),
      reply_markup: backHomeKeyboard("⬅️ 实例列表", `c:ins:${cfgId}:1`),
    };
  }

  let res;
  let successLines;
  if (op === "ip") {
    res = await callInternalApi(
      app,
      deps,
      env,
      ctx,
      `/api/cfgs/${encodeURIComponent(cfgId)}/instances/${encodeURIComponent(inst.id)}/change-ip`,
      { method: "POST", body: {} }
    );
    const newIp = res.data?.ip || res.data?.publicIp || "";
    successLines = [
      "<b>✅ 更换公网 IP 已完成</b>",
      "",
      `实例：<b>${escapeHtml(inst.name)}</b>`,
      ...(newIp ? [`新公网 IP：<code>${escapeHtml(newIp)}</code>`] : []),
    ];
  } else {
    const action = actionMap[op];
    res = await callInternalApi(
      app,
      deps,
      env,
      ctx,
      `/api/cfgs/${encodeURIComponent(cfgId)}/instances/${encodeURIComponent(inst.id)}/action`,
      { method: "POST", body: { action } }
    );
    successLines = [
      `<b>✅ 实例指令已下发（${escapeHtml(action)}）</b>`,
      "",
      `实例：<b>${escapeHtml(inst.name)}</b>`,
    ];
  }

  const bizOk = res.ok && res.data?.ok !== false;
  if (bizOk) {
    await deps.sysSet(env, imapKey(cfgId), "");
  }

  const lines = bizOk
    ? successLines
    : [
        "<b>❌ 实例操作失败</b>",
        "",
        `实例：<b>${escapeHtml(inst.name)}</b>`,
        `错误：<code>${escapeHtml(res.data?.message || res.data?.error || res.error || "执行失败")}</code>`,
      ];

  return {
    text: truncateTelegramText(lines.join("\n")),
    reply_markup: backHomeKeyboard("⬅️ 实例详情", `i:v:${cfgId}:${short8}`),
  };
}

async function buildTaskListView(app, deps, env, ctx, kind = "l", page = 1) {
  const k = kind === "p" ? "p" : "l";
  const safeReqPage = Math.max(1, Number(page) || 1);
  const makeEndpoint = (p) =>
    k === "p" ? `/api/ip-tasks?page=${p}&pageSize=${PAGE_SIZE}` : `/api/tasks?type=launch&page=${p}&pageSize=${PAGE_SIZE}`;
  let res = await callInternalApi(app, deps, env, ctx, makeEndpoint(safeReqPage));

  const tabRow = [
    { text: k === "l" ? "🚀 抢机任务 ✓" : "🚀 抢机任务", callback_data: "t:ls:l:1" },
    { text: k === "p" ? "🔄 换IP任务 ✓" : "🔄 换IP任务", callback_data: "t:ls:p:1" },
  ];

  if (!res.ok) {
    return {
      text: truncateTelegramText(`<b>❌ 获取任务列表失败</b>\n<code>${escapeHtml(res.error)}</code>`),
      reply_markup: {
        inline_keyboard: [
          tabRow,
          [
            { text: "🔄 刷新", callback_data: `t:ls:${k}:${safeReqPage}` },
            { text: "🏠 主菜单", callback_data: "m:home" },
          ],
        ],
      },
    };
  }

  let items = Array.isArray(res.data?.items) ? res.data.items : [];
  let total = Number(res.data?.total ?? items.length);
  let totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  let curPage = Math.min(safeReqPage, totalPages);
  if (items.length === 0 && total > 0 && safeReqPage > totalPages) {
    const retry = await callInternalApi(app, deps, env, ctx, makeEndpoint(totalPages));
    if (retry.ok) {
      res = retry;
      items = Array.isArray(res.data?.items) ? res.data.items : [];
      total = Number(res.data?.total ?? items.length);
      totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      curPage = Math.min(totalPages, curPage);
    }
  }

  const title = k === "p" ? "🔄 换 IP 任务" : "🚀 抢机任务";
  const lines = [`<b>${title}</b>（第 ${curPage}/${totalPages} 页 · 共 ${total} 个）`, ""];
  const keyboard = [tabRow];

  if (items.length === 0) {
    lines.push("暂无此类任务。");
  } else {
    items.forEach((t, idx) => {
      const num = (curPage - 1) * PAGE_SIZE + idx + 1;
      const titleName = k === "p" ? t.instanceName || t.name || t.id : t.name || t.id;
      const statText =
        k === "p"
          ? `${Number(t.changeCount ?? t.attemptCount ?? 0)} 次`
          : `${Number(t.successCount ?? 0)}/${Number(t.targetCount ?? 1)} · ${Number(t.attemptCount ?? 0)} 次`;
      lines.push(
        `${num}. ${taskStatusBadge(t.status)} · <b>${escapeHtml(titleName)}</b> (${escapeHtml(statText)})`
      );
      keyboard.push([{ text: `${num}. ${truncateLabel(titleName)}`, callback_data: `t:v:${k}:${t.id}` }]);
    });
  }

  const navRow = [];
  if (curPage > 1) navRow.push({ text: "⬅️ 上一页", callback_data: `t:ls:${k}:${curPage - 1}` });
  if (curPage < totalPages) navRow.push({ text: "下一页 ➡️", callback_data: `t:ls:${k}:${curPage + 1}` });
  if (navRow.length) keyboard.push(navRow);

  keyboard.push([
    { text: "🔄 刷新", callback_data: `t:ls:${k}:${curPage}` },
    { text: "🏠 主菜单", callback_data: "m:home" },
  ]);

  return {
    text: truncateTelegramText(lines.join("\n")),
    reply_markup: { inline_keyboard: keyboard },
  };
}

async function fetchSingleTask(app, deps, env, ctx, kind, taskId) {
  const endpoint =
    kind === "p" ? "/api/ip-tasks?page=1&pageSize=100" : "/api/tasks?type=launch&page=1&pageSize=100";
  const res = await callInternalApi(app, deps, env, ctx, endpoint);
  if (!res.ok) return { ok: false, error: res.error, task: null };
  const items = Array.isArray(res.data?.items) ? res.data.items : [];
  const task = items.find((item) => item.id === taskId) || null;
  return { ok: true, task };
}

function renderTaskDetailView(kind, taskId, task, banner = "") {
  const k = kind === "p" ? "p" : "l";
  if (!task) {
    return {
      text: truncateTelegramText("<b>⚠️ 未找到该任务</b>\n任务可能已完成或被删除。"),
      reply_markup: backHomeKeyboard("⬅️ 任务列表", `t:ls:${k}:1`),
    };
  }

  const titleName = k === "p" ? task.instanceName || task.name || task.id : task.name || task.id;
  const lines = [];
  if (banner) {
    lines.push(banner, "");
  }
  lines.push(`<b>${k === "p" ? "🔄" : "🚀"} ${escapeHtml(titleName)}</b>`, "");
  if (task.cfgName) lines.push(`配置：${escapeHtml(task.cfgName)}`);
  lines.push(`区域：<code>${escapeHtml(task.region || "-")}</code>`);
  lines.push(`状态：${taskStatusBadge(task.status)}`);
  if (k === "p") {
    lines.push(
      `协议：<code>${escapeHtml(task.ipVersion || "ipv4")}</code> · 换 IP 次数：${Number(
        task.changeCount ?? task.attemptCount ?? 0
      )}`
    );
    if (task.lastIp) lines.push(`最近 IP：<code>${escapeHtml(task.lastIp)}</code>`);
  } else {
    lines.push(
      `进度：${Number(task.successCount ?? 0)}/${Number(task.targetCount ?? 1)}（已尝试 ${Number(
        task.attemptCount ?? 0
      )} 次）`
    );
    if (task.shape) {
      lines.push(
        `规格：<code>${escapeHtml(task.shape)} (${task.ocpus ?? "-"}C/${task.memoryGb ?? "-"}G)</code>`
      );
    }
  }
  lines.push(`执行间隔：${Number(task.intervalSec ?? 60)} 秒`);
  if (task.lastMessage) lines.push(`最新动态：${escapeHtml(task.lastMessage)}`);
  if (task.lastError) lines.push(`最近错误：<code>${escapeHtml(task.lastError)}</code>`);

  const actionRow =
    k === "l"
      ? [
          {
            text: task.status === "running" ? "⏸ 暂停" : "▶️ 恢复",
            callback_data: `t:tog:l:${taskId}`,
          },
          { text: "⚡ 立即执行", callback_data: `t:run:l:${taskId}` },
        ]
      : task.status === "running"
        ? [
            { text: "⏸ 暂停", callback_data: `t:tog:p:${taskId}` },
            { text: "⚡ 立即换IP", callback_data: `t:ask:run:${taskId}` },
          ]
        : [
            { text: "▶️ 恢复运行", callback_data: `t:ask:res:${taskId}` },
            { text: "⚡ 立即换IP", callback_data: `t:ask:run:${taskId}` },
          ];

  return {
    text: truncateTelegramText(lines.join("\n")),
    reply_markup: {
      inline_keyboard: [
        actionRow,
        [
          { text: "⬅️ 任务列表", callback_data: `t:ls:${k}:1` },
          { text: "🏠 主菜单", callback_data: "m:home" },
        ],
      ],
    },
  };
}

async function buildTaskDetailView(app, deps, env, ctx, kind, taskId, banner = "") {
  const { ok, error, task } = await fetchSingleTask(app, deps, env, ctx, kind, taskId);
  if (!ok) {
    return {
      text: truncateTelegramText(`<b>❌ 获取任务详情失败</b>\n<code>${escapeHtml(error)}</code>`),
      reply_markup: backHomeKeyboard("⬅️ 任务列表", `t:ls:${kind === "p" ? "p" : "l"}:1`),
    };
  }
  return renderTaskDetailView(kind, taskId, task, banner);
}

async function buildIpTaskAskView(app, deps, env, ctx, op, taskId, preloadedTask = null) {
  if (op !== "run" && op !== "res") return null;
  let task = preloadedTask;
  if (!task) {
    const found = await fetchSingleTask(app, deps, env, ctx, "p", taskId);
    task = found.task;
  }
  if (!task) return renderTaskDetailView("p", taskId, null);
  const titleName = task.instanceName || task.name || taskId;
  const actionLabel = op === "res" ? "恢复运行并立即换 IP" : "立即执行一次换 IP";

  return {
    text: truncateTelegramText(
      [
        `<b>⚠️ 确认执行：${escapeHtml(actionLabel)}？</b>`,
        "",
        `任务：<b>${escapeHtml(titleName)}</b>`,
        "该操作会立即触发公网 IP 更换，更换期间实例网络会短暂中断。",
      ].join("\n")
    ),
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ 确认执行", callback_data: `t:do:${op}:${taskId}` },
          { text: "❌ 取消", callback_data: `t:v:p:${taskId}` },
        ],
      ],
    },
  };
}

async function buildTaskToggleView(app, deps, env, ctx, kind, taskId) {
  const k = kind === "p" ? "p" : "l";
  const found = await fetchSingleTask(app, deps, env, ctx, k, taskId);
  if (!found.ok || !found.task) return renderTaskDetailView(k, taskId, null);
  if (k === "p") {
    if (found.task.status !== "running") {
      return buildIpTaskAskView(app, deps, env, ctx, "res", taskId, found.task);
    }
    const patchRes = await callInternalApi(app, deps, env, ctx, `/api/ip-tasks/${encodeURIComponent(taskId)}`, {
      method: "PATCH",
      body: { status: "paused" },
    });
    const banner =
      patchRes.ok && patchRes.data?.ok !== false
        ? "<b>✅ 已暂停换 IP 任务</b>"
        : `<b>❌ 暂停失败：</b><code>${escapeHtml(patchRes.data?.error || patchRes.error)}</code>`;
    return buildTaskDetailView(app, deps, env, ctx, "p", taskId, banner);
  }
  const nextStatus = found.task.status === "running" ? "paused" : "running";
  const patchRes = await callInternalApi(app, deps, env, ctx, `/api/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    body: { status: nextStatus },
  });
  const banner =
    patchRes.ok && patchRes.data?.ok !== false
      ? `<b>✅ 任务状态已切换为：${nextStatus === "running" ? "运行中" : "已暂停"}</b>`
      : `<b>❌ 状态更新失败：</b><code>${escapeHtml(patchRes.data?.error || patchRes.error)}</code>`;
  return buildTaskDetailView(app, deps, env, ctx, "l", taskId, banner);
}

async function buildLaunchTaskRunView(app, deps, env, ctx, taskId) {
  const res = await callInternalApi(app, deps, env, ctx, `/api/tasks/${encodeURIComponent(taskId)}/run`, {
    method: "POST",
  });
  const bizOk = res.ok && res.data?.ok !== false;
  const lines = bizOk
    ? ["<b>⚡ 抢机任务已执行</b>", "", `结果：${escapeHtml(res.data?.message || "执行完成")}`]
    : [
        "<b>❌ 抢机任务执行失败</b>",
        "",
        `错误：<code>${escapeHtml(res.data?.message || res.data?.error || res.error || "执行失败")}</code>`,
      ];
  return {
    text: truncateTelegramText(lines.join("\n")),
    reply_markup: backHomeKeyboard("⬅️ 任务详情", `t:v:l:${taskId}`),
  };
}

async function buildIpTaskDoView(app, deps, env, ctx, op, taskId) {
  const res =
    op === "run"
      ? await callInternalApi(app, deps, env, ctx, `/api/ip-tasks/${encodeURIComponent(taskId)}/run`, {
          method: "POST",
        })
      : await callInternalApi(app, deps, env, ctx, `/api/ip-tasks/${encodeURIComponent(taskId)}`, {
          method: "PATCH",
          body: { status: "running" },
        });
  const bizOk = res.ok && res.data?.ok !== false;
  const lines = bizOk
    ? op === "run"
      ? [
          "<b>✅ 换 IP 任务执行完成</b>",
          "",
          ...(res.data?.ip ? [`新公网 IP：<code>${escapeHtml(res.data.ip)}</code>`] : []),
          ...(res.data?.message ? [`信息：${escapeHtml(res.data.message)}`] : []),
        ]
      : ["<b>✅ 换 IP 任务已恢复运行</b>", "", "系统已触发后台换 IP 调度。"]
    : [
        op === "run" ? "<b>❌ 换 IP 任务执行失败</b>" : "<b>❌ 换 IP 任务操作失败</b>",
        "",
        `错误：<code>${escapeHtml(res.data?.message || res.data?.error || res.error || "执行失败")}</code>`,
      ];
  return {
    text: truncateTelegramText(lines.join("\n")),
    reply_markup: backHomeKeyboard("⬅️ 任务详情", `t:v:p:${taskId}`),
  };
}

function extractUpdateSender(update) {
  const msg = update?.message ?? null;
  const cq = update?.callback_query ?? null;
  const rawChatId = msg?.chat?.id ?? cq?.message?.chat?.id ?? null;
  const chatId = rawChatId === null || rawChatId === undefined ? "" : String(rawChatId).trim();
  const isBot = Boolean(msg?.from?.is_bot || cq?.from?.is_bot);
  return { msg, cq, chatId, isBot };
}

async function sendHtmlMessage(botToken, chatId, view, tgFetch) {
  return callTelegramApi(
    botToken,
    "sendMessage",
    {
      chat_id: chatId,
      text: view.text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: view.reply_markup,
    },
    tgFetch
  );
}

async function editOrSendHtml(botToken, chatId, messageId, view, tgFetch) {
  if (messageId !== undefined && messageId !== null) {
    return callTelegramApi(
      botToken,
      "editMessageText",
      {
        chat_id: chatId,
        message_id: messageId,
        text: view.text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: view.reply_markup,
      },
      tgFetch
    );
  }
  return sendHtmlMessage(botToken, chatId, view, tgFetch);
}

async function showLoading(botToken, chatId, messageId, label, tgFetch) {
  if (messageId === undefined || messageId === null) return;
  try {
    await editOrSendHtml(
      botToken,
      chatId,
      messageId,
      { text: `⏳ ${escapeHtml(label)}`, reply_markup: { inline_keyboard: [] } },
      tgFetch
    );
  } catch {
    // 忽略加载态提示渲染异常，继续执行主流程
  }
}

async function handleCallbackQuery(cq, botToken, chatId, env, ctx, app, deps, tgFetch) {
  const parsed = parseCallbackData(cq.data);
  if (cq.id) {
    try {
      await callTelegramApi(
        botToken,
        "answerCallbackQuery",
        parsed ? { callback_query_id: cq.id } : { callback_query_id: cq.id, text: "无效或过期的操作" },
        tgFetch
      );
    } catch {
      // 忽略已过期 callback_query 的应答报错
    }
  }
  if (!parsed) return;

  const messageId = cq.message?.message_id;
  const { scope, action, args } = parsed;

  if (scope === "m" && (action === "home" || action === "st")) {
    const view = await buildOverviewView(app, deps, env, ctx);
    await editOrSendHtml(botToken, chatId, messageId, view, tgFetch);
    return;
  }

  if (scope === "c") {
    if (action === "ls") {
      const view = await buildConfigListView(app, deps, env, ctx, args[0] || 1);
      await editOrSendHtml(botToken, chatId, messageId, view, tgFetch);
      return;
    }
    if (action === "v" && args[0]) {
      const view = await buildConfigDetailView(app, deps, env, ctx, args[0]);
      await editOrSendHtml(botToken, chatId, messageId, view, tgFetch);
      return;
    }
    if (action === "chk" && args[0]) {
      await showLoading(botToken, chatId, messageId, "正在测活 OCI 配置，请稍候…", tgFetch);
      const view = await buildConfigCheckView(app, deps, env, ctx, args[0]);
      await editOrSendHtml(botToken, chatId, messageId, view, tgFetch);
      return;
    }
    if (action === "ins" && args[0]) {
      await showLoading(botToken, chatId, messageId, "正在拉取实例列表，请稍候…", tgFetch);
      const view = await buildInstanceListView(app, deps, env, ctx, args[0], args[1] || 1);
      await editOrSendHtml(botToken, chatId, messageId, view, tgFetch);
      return;
    }
  }

  if (scope === "i") {
    if (action === "v" && args[0] && args[1]) {
      const view = await buildInstanceDetailView(app, deps, env, ctx, args[0], args[1]);
      await editOrSendHtml(botToken, chatId, messageId, view, tgFetch);
      return;
    }
    if (action === "ask" && args[0] && args[1] && args[2]) {
      const view = await buildInstanceAskView(app, deps, env, ctx, args[0], args[1], args[2]);
      if (view) await editOrSendHtml(botToken, chatId, messageId, view, tgFetch);
      return;
    }
    if (action === "do" && args[0] && args[1] && args[2]) {
      if (!["st", "sp", "rs", "ip"].includes(args[0])) return;
      await showLoading(botToken, chatId, messageId, "正在执行实例操作，请稍候…", tgFetch);
      const view = await buildInstanceDoView(app, deps, env, ctx, args[0], args[1], args[2]);
      if (view) await editOrSendHtml(botToken, chatId, messageId, view, tgFetch);
      return;
    }
  }

  if (scope === "t") {
    if (action === "ls" && args[0]) {
      const view = await buildTaskListView(app, deps, env, ctx, args[0], args[1] || 1);
      await editOrSendHtml(botToken, chatId, messageId, view, tgFetch);
      return;
    }
    if (action === "v" && args[0] && args[1]) {
      const view = await buildTaskDetailView(app, deps, env, ctx, args[0], args[1]);
      await editOrSendHtml(botToken, chatId, messageId, view, tgFetch);
      return;
    }
    if (action === "tog" && args[0] && args[1]) {
      const view = await buildTaskToggleView(app, deps, env, ctx, args[0], args[1]);
      if (view) await editOrSendHtml(botToken, chatId, messageId, view, tgFetch);
      return;
    }
    if (action === "run" && args[0] === "l" && args[1]) {
      await showLoading(botToken, chatId, messageId, "正在立即执行抢机任务，请稍候…", tgFetch);
      const view = await buildLaunchTaskRunView(app, deps, env, ctx, args[1]);
      await editOrSendHtml(botToken, chatId, messageId, view, tgFetch);
      return;
    }
    if (action === "ask" && args[0] && args[1]) {
      const view = await buildIpTaskAskView(app, deps, env, ctx, args[0], args[1]);
      if (view) await editOrSendHtml(botToken, chatId, messageId, view, tgFetch);
      return;
    }
    if (action === "do" && (args[0] === "run" || args[0] === "res") && args[1]) {
      await showLoading(botToken, chatId, messageId, "正在执行换 IP 任务，请稍候…", tgFetch);
      const view = await buildIpTaskDoView(app, deps, env, ctx, args[0], args[1]);
      await editOrSendHtml(botToken, chatId, messageId, view, tgFetch);
    }
  }
}

/**
 * 分发并处理单条已鉴权的 Telegram Update（供路由后台任务及单元测试调用）。
 * @param {object} update
 * @param {any} env
 * @param {any} ctx
 * @param {any} app
 * @param {object} deps
 * @param {typeof fetch} [tgFetch=fetch]
 * @param {string | null} [precheckedChatId=null]
 */
export async function handleTelegramUpdate(
  update,
  env,
  ctx,
  app,
  deps,
  tgFetch = fetch,
  precheckedChatId = null
) {
  if (!update || typeof update !== "object") return;
  const { msg, cq, chatId: incomingChatId, isBot } = extractUpdateSender(update);
  if (isBot || !incomingChatId) return;

  const botToken = String((await deps.sysGet(env, "notify.tg_bot_token")) || "").trim();
  if (!botToken) return;

  const allowedChatId =
    precheckedChatId !== null && precheckedChatId !== undefined
      ? String(precheckedChatId).trim()
      : String((await deps.sysGet(env, "notify.tg_chat_id")) || "").trim();
  if (!allowedChatId || incomingChatId !== allowedChatId) return;

  if (cq) {
    await handleCallbackQuery(cq, botToken, incomingChatId, env, ctx, app, deps, tgFetch);
    return;
  }

  const text = String(msg?.text || "").trim();
  if (!text.startsWith("/")) return;

  const cmd = text.split(/\s+/)[0].split("@")[0].toLowerCase();
  if (cmd === "/start" || cmd === "/status") {
    const view = await buildOverviewView(app, deps, env, ctx);
    await sendHtmlMessage(botToken, incomingChatId, view, tgFetch);
  } else if (cmd === "/help") {
    await sendHtmlMessage(botToken, incomingChatId, buildHelpMessage(), tgFetch);
  } else if (cmd === "/cfgs") {
    const view = await buildConfigListView(app, deps, env, ctx, 1);
    await sendHtmlMessage(botToken, incomingChatId, view, tgFetch);
  } else if (cmd === "/tasks") {
    const view = await buildTaskListView(app, deps, env, ctx, "l", 1);
    await sendHtmlMessage(botToken, incomingChatId, view, tgFetch);
  }
}

function readExecutionCtx(c) {
  try {
    return c.executionCtx ?? null;
  } catch {
    return null;
  }
}

/**
 * 向 Hono app 注册 Telegram Bot Webhook 入口及管理接口。
 * @param {any} app
 * @param {object} deps
 * @param {typeof fetch} [tgFetch=fetch]
 */
export function registerTgBot(app, deps, tgFetch = fetch) {
  const seenUpdateIds = new Set();

  app.post("/api/tg/webhook", async (c) => {
    const expectedSecret = String((await deps.sysGet(c.env, "tg.webhook_secret")) || "").trim();
    const providedSecret = String(
      c.req.header("x-telegram-bot-api-secret-token") ??
        c.req.header("X-Telegram-Bot-Api-Secret-Token") ??
        ""
    ).trim();

    if (!expectedSecret || !providedSecret || !constantTimeEqual(providedSecret, expectedSecret)) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const update = await c.req.json().catch(() => null);
    if (!update || typeof update !== "object") {
      return c.json({ ok: true });
    }

    if (update.update_id !== undefined && update.update_id !== null) {
      const uid = String(update.update_id);
      if (seenUpdateIds.has(uid)) {
        return c.json({ ok: true });
      }
      if (seenUpdateIds.size >= MAX_SEEN_UPDATES) {
        const oldest = seenUpdateIds.values().next().value;
        if (oldest !== undefined) seenUpdateIds.delete(oldest);
      }
      seenUpdateIds.add(uid);
    }

    const { chatId: incomingChatId, isBot } = extractUpdateSender(update);
    const allowedChatId = String((await deps.sysGet(c.env, "notify.tg_chat_id")) || "").trim();

    if (isBot || !allowedChatId || !incomingChatId || incomingChatId !== allowedChatId) {
      return c.json({ ok: true });
    }

    const execCtx = readExecutionCtx(c);
    const work = Promise.resolve()
      .then(() => handleTelegramUpdate(update, c.env, execCtx, app, deps, tgFetch, allowedChatId))
      .catch((err) => {
        console.error("[tg-bot] webhook dispatch failed:", redactBotToken(err?.message ?? err));
      });

    if (execCtx && typeof execCtx.waitUntil === "function") {
      execCtx.waitUntil(work);
    } else {
      await work;
    }

    return c.json({ ok: true });
  });

  app.get("/api/tg/webhook-config", async (c) => {
    const botToken = String((await deps.sysGet(c.env, "notify.tg_bot_token")) || "").trim();
    const chatId = String((await deps.sysGet(c.env, "notify.tg_chat_id")) || "").trim();
    const webhookSecret = String((await deps.sysGet(c.env, "tg.webhook_secret")) || "").trim();
    const webhookUrl = String((await deps.sysGet(c.env, "tg.webhook_url")) || "").trim();

    const hasBotToken = Boolean(botToken);
    const hasChatId = Boolean(chatId);
    const configured = hasBotToken && hasChatId;
    const enabled = Boolean(configured && webhookSecret && webhookUrl);

    const payload = {
      configured,
      enabled,
      webhookUrl,
      hasBotToken,
      hasChatId,
    };

    if (hasBotToken) {
      try {
        const info = await callTelegramApi(
          botToken,
          "getWebhookInfo",
          {},
          tgFetch,
          WEBHOOK_INFO_TIMEOUT_MS
        );
        if (info && typeof info === "object") {
          payload.telegramInfo = {
            url: String(info.url || ""),
            pendingUpdateCount: Number(info.pending_update_count ?? 0),
            lastErrorMessage: String(info.last_error_message || ""),
            lastErrorDate: info.last_error_date ? Number(info.last_error_date) : null,
          };
        }
      } catch {
        // 查询 Telegram 状态失败时不阻断返回本地配置状态
      }
    }

    return c.json(payload);
  });

  app.post("/api/tg/webhook-config", async (c) => {
    const botToken = String((await deps.sysGet(c.env, "notify.tg_bot_token")) || "").trim();
    const chatId = String((await deps.sysGet(c.env, "notify.tg_chat_id")) || "").trim();
    if (!botToken || !chatId) {
      return c.json({ error: "请先在下方配置并保存 Telegram Bot Token 和 Chat ID" }, 400);
    }

    const body = await c.req.json().catch(() => ({}));
    const rawOrigin =
      typeof body?.origin === "string" && body.origin.trim()
        ? body.origin.trim()
        : new URL(c.req.url).origin;

    let origin = "";
    try {
      const parsed = new URL(rawOrigin);
      if (parsed.protocol === "https:") {
        origin = parsed.origin;
      }
    } catch {
      origin = "";
    }
    if (!origin || !origin.startsWith("https://")) {
      return c.json({ error: "Webhook 地址必须使用 https:// 协议" }, 400);
    }

    let secret = String((await deps.sysGet(c.env, "tg.webhook_secret")) || "").trim();
    if (!secret) {
      const rand = new Uint8Array(32);
      crypto.getRandomValues(rand);
      secret = Array.from(rand, (b) => b.toString(16).padStart(2, "0")).join("");
    }

    const webhookUrl = `${origin}/api/tg/webhook`;
    try {
      await callTelegramApi(
        botToken,
        "setWebhook",
        {
          url: webhookUrl,
          secret_token: secret,
          allowed_updates: ["message", "callback_query"],
          drop_pending_updates: true,
        },
        tgFetch
      );
      await deps.sysSet(c.env, "tg.webhook_secret", secret);
      await deps.sysSet(c.env, "tg.webhook_url", webhookUrl);
      try {
        await callTelegramApi(botToken, "setMyCommands", { commands: BOT_COMMANDS }, tgFetch);
      } catch (cmdErr) {
        console.warn("[tg-bot] setMyCommands failed:", redactBotToken(cmdErr?.message ?? cmdErr));
      }

      return c.json({
        ok: true,
        configured: true,
        enabled: true,
        webhookUrl,
        hasBotToken: true,
        hasChatId: true,
      });
    } catch (e) {
      return c.json({ error: redactBotToken(e?.message ?? String(e)) }, 400);
    }
  });

  app.delete("/api/tg/webhook-config", async (c) => {
    const botToken = String((await deps.sysGet(c.env, "notify.tg_bot_token")) || "").trim();
    if (botToken) {
      try {
        await callTelegramApi(botToken, "deleteWebhook", { drop_pending_updates: true }, tgFetch);
      } catch {
        // 即使 Telegram 侧 Token 已失效，仍继续清理本地状态
      }
    }

    await deps.sysSet(c.env, "tg.webhook_secret", "");
    await deps.sysSet(c.env, "tg.webhook_url", "");

    return c.json({
      ok: true,
      enabled: false,
      webhookUrl: "",
    });
  });
}
