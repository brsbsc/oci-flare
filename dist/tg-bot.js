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

/**
 * 截断 Telegram 消息文本至安全长度并附加省略号。
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
  let end = limit - 1;
  // 避免在 UTF-16 高代理字符中间截断 emoji
  const code = s.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) {
    end -= 1;
  }
  return `${s.slice(0, end)}…`;
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
  const res = await tgFetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload ?? {}),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    const desc = String(data?.description || "");
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

function buildStartMessage() {
  return {
    text: truncateTelegramText(
      [
        "<b>📊 OCI Helper Serverless 控制台</b>",
        "",
        "已接入双向运维交互，可使用下方按钮或斜杠指令快速操作：",
        "• /status — 查看配置与任务运行总览",
        "• /cfgs — 浏览 OCI 账号配置与实例",
        "• /tasks — 管理抢机与换 IP 任务",
        "• /help — 查看指令列表与安全说明",
      ].join("\n")
    ),
    reply_markup: {
      inline_keyboard: [
        [{ text: "📊 运行总览", callback_data: "m:st" }],
        [
          { text: "☁️ OCI 配置", callback_data: "c:ls:1" },
          { text: "🚀 任务管理", callback_data: "t:ls:l:1" },
        ],
      ],
    },
  };
}

function buildHelpMessage() {
  return {
    text: truncateTelegramText(
      [
        "<b>ℹ️ OCI Helper Bot 指令说明</b>",
        "",
        "• /start — 打开主菜单",
        "• /status — 查看全局配置与任务统计",
        "• /cfgs — 分页查看 OCI 配置、测活及实例控制",
        "• /tasks — 分页查看抢机/换 IP 任务并启停或立即执行",
        "• /help — 显示本帮助信息",
        "",
        "<i>安全提示：不提供删除配置、终止实例、删除任务或读取私钥/口令等高危操作；关机、重启、换 IP 等变更操作均需二次确认。</i>",
      ].join("\n")
    ),
    reply_markup: {
      inline_keyboard: [[{ text: "🏠 返回主菜单", callback_data: "m:home" }]],
    },
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

/**
 * 分发并处理单条已鉴权的 Telegram Update（供路由后台任务及单元测试调用）。
 * @param {object} update
 * @param {any} env
 * @param {any} ctx
 * @param {any} app
 * @param {object} deps
 * @param {typeof fetch} [tgFetch=fetch]
 */
export async function handleTelegramUpdate(update, env, ctx, app, deps, tgFetch = fetch) {
  if (!update || typeof update !== "object") return;
  const { msg, cq, chatId: incomingChatId, isBot } = extractUpdateSender(update);
  if (isBot || !incomingChatId) return;

  const botToken = String((await deps.sysGet(env, "notify.tg_bot_token")) || "").trim();
  if (!botToken) return;

  const allowedChatId = String((await deps.sysGet(env, "notify.tg_chat_id")) || "").trim();
  if (allowedChatId && incomingChatId !== allowedChatId) return;

  if (cq?.id) {
    try {
      await callTelegramApi(botToken, "answerCallbackQuery", { callback_query_id: cq.id }, tgFetch);
    } catch {
      // 忽略已过期 callback_query 的应答报错
    }
    return;
  }

  const text = String(msg?.text || "").trim();
  if (!text.startsWith("/")) return;

  const cmd = text.split(/\s+/)[0].split("@")[0].toLowerCase();
  if (cmd === "/start") {
    await sendHtmlMessage(botToken, incomingChatId, buildStartMessage(), tgFetch);
  } else if (cmd === "/help") {
    await sendHtmlMessage(botToken, incomingChatId, buildHelpMessage(), tgFetch);
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
      .then(() => handleTelegramUpdate(update, c.env, execCtx, app, deps, tgFetch))
      .catch((err) => {
        console.error("[tg-bot] webhook dispatch failed:", err?.message ?? err);
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
      await callTelegramApi(botToken, "setMyCommands", { commands: BOT_COMMANDS }, tgFetch);

      return c.json({
        ok: true,
        configured: true,
        enabled: true,
        webhookUrl,
        hasBotToken: true,
        hasChatId: true,
      });
    } catch (e) {
      return c.json({ error: e?.message ?? String(e) }, 400);
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
