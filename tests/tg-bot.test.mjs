import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  constantTimeEqual,
  escapeHtml,
  truncateTelegramText,
  shortInstanceId,
  parseCallbackData,
  callTelegramApi,
  callInternalApi,
  resolveInstanceByShortId,
  registerTgBot,
  handleTelegramUpdate,
} from "../dist/tg-bot.js";

function matchRoutePattern(pattern, pathname) {
  const patParts = pattern.split("/").filter(Boolean);
  const pathParts = pathname.split("/").filter(Boolean);
  if (patParts.length !== pathParts.length) return null;
  const params = {};
  for (let i = 0; i < patParts.length; i++) {
    if (patParts[i].startsWith(":")) {
      params[patParts[i].slice(1)] = decodeURIComponent(pathParts[i]);
    } else if (patParts[i] !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

function createMockRouter() {
  const routes = [];
  function add(method, path, handler) {
    routes.push({ method, path, handler });
  }
  const app = {
    get(path, handler) {
      add("GET", path, handler);
    },
    post(path, handler) {
      add("POST", path, handler);
    },
    patch(path, handler) {
      add("PATCH", path, handler);
    },
    delete(path, handler) {
      add("DELETE", path, handler);
    },
    async fetch(request, env = {}, executionCtx) {
      const url = new URL(request.url);
      const method = request.method.toUpperCase();
      let matched = null;
      let params = {};
      for (const route of routes) {
        if (route.method !== method) continue;
        const p = matchRoutePattern(route.path, url.pathname);
        if (p) {
          matched = route;
          params = p;
          break;
        }
      }
      if (!matched) {
        return Response.json({ error: "Not Found" }, { status: 404 });
      }
      const c = {
        env,
        req: {
          url: request.url,
          method: request.method,
          path: url.pathname,
          header(name) {
            return request.headers.get(name) ?? undefined;
          },
          param(name) {
            return params[name];
          },
          query(name) {
            return url.searchParams.get(name) ?? undefined;
          },
          async json() {
            return request.clone().json();
          },
        },
        json(data, status = 200) {
          return Response.json(data, { status });
        },
        text(txt, status = 200) {
          return new Response(txt, { status });
        },
      };
      Object.defineProperty(c, "executionCtx", {
        get() {
          if (executionCtx) return executionCtx;
          throw new Error("This context has no ExecutionContext");
        },
      });
      return matched.handler(c);
    },
  };
  return app;
}

function createMockDeps(initialStore = {}) {
  const store = new Map(Object.entries(initialStore));
  const issued = [];
  const deps = {
    store,
    issued,
    async sysGet(_env, key) {
      return store.has(key) ? store.get(key) : null;
    },
    async sysSet(_env, key, value) {
      store.set(key, String(value ?? ""));
    },
    async authSecret() {
      return "test-auth-secret";
    },
    async authVersion() {
      return "v1";
    },
    async issueToken(secret, version, ttlSeconds) {
      const token = `tok:${secret}:${version}:${ttlSeconds}`;
      issued.push({ secret, version, ttlSeconds, token });
      return token;
    },
    nowIso() {
      return "2026-11-25T00:00:00.000Z";
    },
  };
  return deps;
}

test("constantTimeEqual handles equal, unequal, different-length, empty, and non-string inputs", () => {
  assert.equal(constantTimeEqual("secret-token-123", "secret-token-123"), true);
  assert.equal(constantTimeEqual("secret-token-123", "secret-token-124"), false);
  assert.equal(constantTimeEqual("secret-token-123", "secret"), false);
  assert.equal(constantTimeEqual("short", "much-longer-string"), false);
  assert.equal(constantTimeEqual("", ""), true);
  assert.equal(constantTimeEqual("", "a"), false);
  assert.equal(constantTimeEqual(null, "a"), false);
  assert.equal(constantTimeEqual("a", undefined), false);
  assert.equal(constantTimeEqual(12345, "12345"), false);
});

test("escapeHtml escapes &, <, > and handles null/undefined", () => {
  assert.equal(escapeHtml("a & b <tag> > end"), "a &amp; b &lt;tag&gt; &gt; end");
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(undefined), "");
  assert.equal(escapeHtml(42), "42");
});

test("truncateTelegramText preserves short text and truncates over maxLen with ellipsis", () => {
  assert.equal(truncateTelegramText("hello", 10), "hello");

  const exact = "a".repeat(3800);
  assert.equal(truncateTelegramText(exact), exact);

  const over = "b".repeat(4000);
  const truncated = truncateTelegramText(over);
  assert.equal(truncated.length, 3800);
  assert.ok(truncated.endsWith("…"));

  const custom = truncateTelegramText("abcdefghij", 6);
  assert.ok(custom.length <= 6);
  assert.ok(custom.endsWith("…"));
});

test("shortInstanceId returns deterministic 8 lowercase hex chars for 88-byte OCI OCID", async () => {
  const ocid =
    "ocid1.instance.oc1.ap-singapore-1.anuwgljr76q54nyczzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz";
  assert.equal(Buffer.byteLength(ocid, "utf8"), 88);

  const id1 = await shortInstanceId(ocid);
  const id2 = await shortInstanceId(ocid);
  const idOther = await shortInstanceId(ocid.slice(0, -1) + "a");

  assert.match(id1, /^[0-9a-f]{8}$/);
  assert.equal(id1, id2);
  assert.notEqual(id1, idOther);
});

test("parseCallbackData parses valid colon-delimited tokens and rejects invalid/empty/over-64-byte inputs", () => {
  assert.deepEqual(parseCallbackData("m:home"), {
    scope: "m",
    action: "home",
    args: [],
  });
  assert.deepEqual(parseCallbackData("i:ask:ip:cfg_AbCdEfGhIjK:a1b2c3d4"), {
    scope: "i",
    action: "ask",
    args: ["ip", "cfg_AbCdEfGhIjK", "a1b2c3d4"],
  });

  assert.equal(parseCallbackData(""), null);
  assert.equal(parseCallbackData(null), null);
  assert.equal(parseCallbackData("single"), null);
  assert.equal(parseCallbackData(":action"), null);
  assert.equal(parseCallbackData("scope:"), null);
  assert.equal(parseCallbackData("scope::arg"), null);

  const exact64 = `m:x:${"a".repeat(60)}`;
  assert.equal(Buffer.byteLength(exact64, "utf8"), 64);
  assert.ok(parseCallbackData(exact64) !== null);

  const over64 = `m:x:${"a".repeat(61)}`;
  assert.equal(Buffer.byteLength(over64, "utf8"), 65);
  assert.equal(parseCallbackData(over64), null);

  const multibyteOver64 = `m:x:${"中".repeat(21)}`;
  assert.ok(Buffer.byteLength(multibyteOver64, "utf8") > 64);
  assert.equal(parseCallbackData(multibyteOver64), null);
});

test("callTelegramApi sends JSON POST, ignores 'message is not modified' on editMessageText, and throws on API errors", async () => {
  const calls = [];
  const mockFetch = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/editMessageText")) {
      return Response.json(
        { ok: false, error_code: 400, description: "Bad Request: message is not modified" },
        { status: 400 }
      );
    }
    if (url.endsWith("/badMethod")) {
      return Response.json(
        { ok: false, error_code: 400, description: "Bad Request: chat not found" },
        { status: 400 }
      );
    }
    return Response.json({ ok: true, result: { message_id: 99 } });
  };

  const res = await callTelegramApi("BOT_TOK", "sendMessage", { chat_id: "123", text: "hi" }, mockFetch);
  assert.deepEqual(res, { message_id: 99 });
  assert.equal(calls[0].url, "https://api.telegram.org/botBOT_TOK/sendMessage");
  assert.equal(calls[0].init.method, "POST");
  assert.ok(calls[0].init.signal instanceof AbortSignal);

  // Silent ignore for "message is not modified" on editMessageText
  const editRes = await callTelegramApi(
    "BOT_TOK",
    "editMessageText",
    { chat_id: "123", message_id: 1, text: "same" },
    mockFetch
  );
  assert.equal(editRes, null);

  await assert.rejects(
    () => callTelegramApi("BOT_TOK", "badMethod", {}, mockFetch),
    /chat not found/
  );
});

test("callInternalApi issues 60s token, forwards env and real ctx, and parses success/error responses", async () => {
  const app = createMockRouter();
  const deps = createMockDeps();
  let seenAuth = "";
  let seenCtx = null;

  app.post("/api/echo", async (c) => {
    seenAuth = c.req.header("authorization") || "";
    seenCtx = c.executionCtx;
    const body = await c.req.json();
    return c.json({ echoed: body.msg });
  });
  app.get("/api/fail", async (c) => c.json({ error: "Forbidden action" }, 403));

  const fakeCtx = { waitUntil() {} };
  const okRes = await callInternalApi(app, deps, { DB: "mock" }, fakeCtx, "/api/echo", {
    method: "POST",
    body: { msg: "hello" },
  });
  assert.equal(okRes.ok, true);
  assert.equal(okRes.status, 200);
  assert.deepEqual(okRes.data, { echoed: "hello" });
  assert.equal(deps.issued[0].ttlSeconds, 60);
  assert.equal(seenAuth, `Bearer ${deps.issued[0].token}`);
  assert.equal(seenCtx, fakeCtx);

  const errRes = await callInternalApi(app, deps, {}, fakeCtx, "/api/fail");
  assert.equal(errRes.ok, false);
  assert.equal(errRes.status, 403);
  assert.equal(errRes.error, "Forbidden action");
});

test("POST /api/tg/webhook rejects missing, wrong, or different-length secret token with 401", async () => {
  const app = createMockRouter();
  const deps = createMockDeps({
    "tg.webhook_secret": "a".repeat(64),
    "notify.tg_chat_id": "10001",
    "notify.tg_bot_token": "bot-token",
  });
  const tgCalls = [];
  registerTgBot(app, deps, async (url) => {
    tgCalls.push(url);
    return Response.json({ ok: true, result: {} });
  });

  for (const headerVal of [undefined, "", "wrong", "b".repeat(64)]) {
    const headers = { "content-type": "application/json" };
    if (headerVal !== undefined) {
      headers["X-Telegram-Bot-Api-Secret-Token"] = headerVal;
    }
    const res = await app.fetch(
      new Request("https://example.com/api/tg/webhook", {
        method: "POST",
        headers,
        body: JSON.stringify({ update_id: 1, message: { chat: { id: 10001 }, text: "/start" } }),
      }),
      {}
    );
    assert.equal(res.status, 401);
  }
  assert.equal(tgCalls.length, 0);
});

test("POST /api/tg/webhook silently drops unauthorized chat_id or is_bot=true with 200 and zero API calls", async () => {
  const app = createMockRouter();
  const secret = "s".repeat(64);
  const deps = createMockDeps({
    "tg.webhook_secret": secret,
    "notify.tg_chat_id": "10001",
    "notify.tg_bot_token": "bot-token",
  });
  const tgCalls = [];
  registerTgBot(app, deps, async (url) => {
    tgCalls.push(url);
    return Response.json({ ok: true, result: {} });
  });

  // Unauthorized chat_id
  const res1 = await app.fetch(
    new Request("https://example.com/api/tg/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": secret,
      },
      body: JSON.stringify({
        update_id: 101,
        message: { chat: { id: 99999 }, from: { is_bot: false }, text: "/start" },
      }),
    }),
    {}
  );
  assert.equal(res1.status, 200);
  assert.deepEqual(await res1.json(), { ok: true });

  // Bot sender (is_bot: true)
  const res2 = await app.fetch(
    new Request("https://example.com/api/tg/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": secret,
      },
      body: JSON.stringify({
        update_id: 102,
        message: { chat: { id: 10001 }, from: { is_bot: true }, text: "/start" },
      }),
    }),
    {}
  );
  assert.equal(res2.status, 200);
  assert.deepEqual(await res2.json(), { ok: true });
  assert.equal(tgCalls.length, 0);
  assert.equal(deps.issued.length, 0);
});

test("POST /api/tg/webhook uses ctx.waitUntil, sends /start and /help replies, and deduplicates update_id", async () => {
  const app = createMockRouter();
  const secret = "c".repeat(64);
  const deps = createMockDeps({
    "tg.webhook_secret": secret,
    "notify.tg_chat_id": "10001",
    "notify.tg_bot_token": "bot-token",
  });
  const tgCalls = [];
  registerTgBot(app, deps, async (url, init) => {
    tgCalls.push({ url, body: JSON.parse(init.body) });
    return Response.json({ ok: true, result: { message_id: tgCalls.length } });
  });

  const waitUntilPromises = [];
  const ctx = {
    waitUntil(p) {
      waitUntilPromises.push(p);
    },
  };

  // 1. /start via waitUntil
  const resStart = await app.fetch(
    new Request("https://example.com/api/tg/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": secret,
      },
      body: JSON.stringify({
        update_id: 500,
        message: { chat: { id: 10001 }, from: { is_bot: false }, text: "/start" },
      }),
    }),
    {},
    ctx
  );
  assert.equal(resStart.status, 200);
  assert.deepEqual(await resStart.json(), { ok: true });
  assert.equal(waitUntilPromises.length, 1);
  await Promise.all(waitUntilPromises);

  assert.equal(tgCalls.length, 1);
  assert.match(tgCalls[0].url, /\/sendMessage$/);
  assert.equal(tgCalls[0].body.chat_id, "10001");
  assert.equal(tgCalls[0].body.parse_mode, "HTML");
  assert.match(tgCalls[0].body.text, /OCI Helper/);

  // Verify any callback_data in reply_markup is <= 64 bytes
  const rows = tgCalls[0].body.reply_markup?.inline_keyboard || [];
  for (const row of rows) {
    for (const btn of row) {
      if (btn.callback_data) {
        assert.ok(Buffer.byteLength(btn.callback_data, "utf8") <= 64);
      }
    }
  }

  // 2. Duplicate update_id=500 triggers zero Telegram calls
  const resDup = await app.fetch(
    new Request("https://example.com/api/tg/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": secret,
      },
      body: JSON.stringify({
        update_id: 500,
        message: { chat: { id: 10001 }, from: { is_bot: false }, text: "/start" },
      }),
    }),
    {},
    ctx
  );
  assert.equal(resDup.status, 200);
  await Promise.all(waitUntilPromises);
  assert.equal(tgCalls.length, 1);

  // 3. /help without executionCtx (fallback to awaited call)
  const resHelp = await app.fetch(
    new Request("https://example.com/api/tg/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": secret,
      },
      body: JSON.stringify({
        update_id: 501,
        message: { chat: { id: 10001 }, from: { is_bot: false }, text: "/help@my_bot" },
      }),
    }),
    {}
  );
  assert.equal(resHelp.status, 200);
  assert.equal(tgCalls.length, 2);
  assert.match(tgCalls[1].body.text, /\/status/);
  assert.match(tgCalls[1].body.text, /\/cfgs/);
  assert.match(tgCalls[1].body.text, /\/tasks/);
});

test("POST /api/tg/webhook deduplication Set is bounded to 500 entries", async () => {
  const app = createMockRouter();
  const secret = "d".repeat(64);
  const deps = createMockDeps({
    "tg.webhook_secret": secret,
    "notify.tg_chat_id": "10001",
    "notify.tg_bot_token": "bot-token",
  });
  let sendCount = 0;
  registerTgBot(app, deps, async () => {
    sendCount++;
    return Response.json({ ok: true, result: {} });
  });

  const sendUpdate = (updateId) =>
    app.fetch(
      new Request("https://example.com/api/tg/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Telegram-Bot-Api-Secret-Token": secret,
        },
        body: JSON.stringify({
          update_id: updateId,
          message: { chat: { id: 10001 }, from: { is_bot: false }, text: "/help" },
        }),
      }),
      {}
    );

  for (let i = 1; i <= 501; i++) {
    await sendUpdate(i);
  }
  assert.equal(sendCount, 501);

  // 501 is still in the 500-item set -> deduplicated
  await sendUpdate(501);
  assert.equal(sendCount, 501);

  // 1 was evicted when 501 was inserted -> processed again
  await sendUpdate(1);
  assert.equal(sendCount, 502);
});

test("POST /api/tg/webhook-config validates prerequisites and https origin, registers webhook & commands, and persists config", async () => {
  const app = createMockRouter();
  const deps = createMockDeps();
  const tgCalls = [];
  registerTgBot(app, deps, async (url, init) => {
    tgCalls.push({ url, body: JSON.parse(init.body) });
    return Response.json({ ok: true, result: true });
  });

  // Missing token/chatId -> 400
  const missingRes = await app.fetch(
    new Request("https://panel.example.com/api/tg/webhook-config", { method: "POST" }),
    {}
  );
  assert.equal(missingRes.status, 400);

  // Set token + chatId, test non-https origin -> 400
  await deps.sysSet({}, "notify.tg_bot_token", "123:ABC");
  await deps.sysSet({}, "notify.tg_chat_id", "10001");

  const httpRes = await app.fetch(
    new Request("http://localhost:8787/api/tg/webhook-config", { method: "POST" }),
    {}
  );
  assert.equal(httpRes.status, 400);

  // Valid https request -> registers setWebhook + setMyCommands + persists secret & url
  const okRes = await app.fetch(
    new Request("https://panel.example.com/api/tg/webhook-config", { method: "POST" }),
    {}
  );
  assert.equal(okRes.status, 200);
  const okJson = await okRes.json();
  assert.deepEqual(okJson, {
    ok: true,
    configured: true,
    enabled: true,
    webhookUrl: "https://panel.example.com/api/tg/webhook",
    hasBotToken: true,
    hasChatId: true,
  });

  const savedSecret = await deps.sysGet({}, "tg.webhook_secret");
  const savedUrl = await deps.sysGet({}, "tg.webhook_url");
  assert.match(savedSecret, /^[0-9a-f]{64}$/);
  assert.equal(savedUrl, "https://panel.example.com/api/tg/webhook");

  const setWebhookCall = tgCalls.find((c) => c.url.endsWith("/setWebhook"));
  assert.ok(setWebhookCall);
  assert.deepEqual(setWebhookCall.body, {
    url: "https://panel.example.com/api/tg/webhook",
    secret_token: savedSecret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  });

  const setCmdsCall = tgCalls.find((c) => c.url.endsWith("/setMyCommands"));
  assert.ok(setCmdsCall);
  assert.deepEqual(
    setCmdsCall.body.commands.map((c) => c.command),
    ["start", "status", "cfgs", "tasks", "help"]
  );

  // Calling POST again reuses existing secret and respects valid explicit body.origin
  const okRes2 = await app.fetch(
    new Request("https://panel.example.com/api/tg/webhook-config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ origin: "https://custom.example.com/" }),
    }),
    {}
  );
  assert.equal(okRes2.status, 200);
  const okJson2 = await okRes2.json();
  assert.equal(okJson2.webhookUrl, "https://custom.example.com/api/tg/webhook");
  assert.equal(await deps.sysGet({}, "tg.webhook_secret"), savedSecret);

  // Explicit non-https body.origin -> 400
  const badOriginRes = await app.fetch(
    new Request("https://panel.example.com/api/tg/webhook-config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ origin: "http://insecure.example.com" }),
    }),
    {}
  );
  assert.equal(badOriginRes.status, 400);
});

test("GET /api/tg/webhook-config returns status with telegramInfo and degrades gracefully on getWebhookInfo error", async () => {
  const app = createMockRouter();
  const deps = createMockDeps({
    "notify.tg_bot_token": "123:ABC",
    "notify.tg_chat_id": "10001",
    "tg.webhook_secret": "f".repeat(64),
    "tg.webhook_url": "https://panel.example.com/api/tg/webhook",
  });

  let shouldThrow = false;
  registerTgBot(app, deps, async (url) => {
    if (shouldThrow) throw new Error("network timeout");
    assert.match(url, /\/getWebhookInfo$/);
    return Response.json({
      ok: true,
      result: {
        url: "https://panel.example.com/api/tg/webhook",
        pending_update_count: 2,
        last_error_message: "Read timeout",
        last_error_date: 1700000000,
      },
    });
  });

  const res1 = await app.fetch(
    new Request("https://panel.example.com/api/tg/webhook-config", { method: "GET" }),
    {}
  );
  assert.equal(res1.status, 200);
  const body1 = await res1.json();
  assert.deepEqual(body1, {
    configured: true,
    enabled: true,
    webhookUrl: "https://panel.example.com/api/tg/webhook",
    hasBotToken: true,
    hasChatId: true,
    telegramInfo: {
      url: "https://panel.example.com/api/tg/webhook",
      pendingUpdateCount: 2,
      lastErrorMessage: "Read timeout",
      lastErrorDate: 1700000000,
    },
  });
  // Never expose secret or token
  assert.equal(JSON.stringify(body1).includes("f".repeat(64)), false);
  assert.equal(JSON.stringify(body1).includes("123:ABC"), false);

  // When getWebhookInfo throws, still returns 200 with local status
  shouldThrow = true;
  const res2 = await app.fetch(
    new Request("https://panel.example.com/api/tg/webhook-config", { method: "GET" }),
    {}
  );
  assert.equal(res2.status, 200);
  const body2 = await res2.json();
  assert.equal(body2.enabled, true);
  assert.equal(body2.telegramInfo, undefined);
});

test("DELETE /api/tg/webhook-config calls deleteWebhook and still clears local keys if deleteWebhook throws", async () => {
  const app = createMockRouter();
  const deps = createMockDeps({
    "notify.tg_bot_token": "123:ABC",
    "notify.tg_chat_id": "10001",
    "tg.webhook_secret": "e".repeat(64),
    "tg.webhook_url": "https://panel.example.com/api/tg/webhook",
  });

  const tgCalls = [];
  registerTgBot(app, deps, async (url, init) => {
    tgCalls.push({ url, body: JSON.parse(init.body) });
    throw new Error("Telegram bot token revoked");
  });

  const res = await app.fetch(
    new Request("https://panel.example.com/api/tg/webhook-config", { method: "DELETE" }),
    {}
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    ok: true,
    enabled: false,
    webhookUrl: "",
  });

  assert.equal(tgCalls.length, 1);
  assert.match(tgCalls[0].url, /\/deleteWebhook$/);
  assert.deepEqual(tgCalls[0].body, { drop_pending_updates: true });
  assert.equal(await deps.sysGet({}, "tg.webhook_secret"), "");
  assert.equal(await deps.sysGet({}, "tg.webhook_url"), "");
});

test("handleTelegramUpdate is directly testable for /start and /help", async () => {
  const app = createMockRouter();
  const deps = createMockDeps({
    "notify.tg_bot_token": "123:ABC",
    "notify.tg_chat_id": "10001",
  });
  const sent = [];
  const tgFetch = async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body) });
    return Response.json({ ok: true, result: { message_id: 1 } });
  };

  await handleTelegramUpdate(
    { update_id: 1, message: { chat: { id: 10001 }, from: { is_bot: false }, text: "/start" } },
    {},
    null,
    app,
    deps,
    tgFetch
  );
  assert.equal(sent.length, 1);
  assert.match(sent[0].body.text, /OCI Helper/);
});

test("handleTelegramUpdate and POST /api/tg/webhook fail closed when notify.tg_chat_id is empty", async () => {
  const secret = "g".repeat(64);
  for (const emptyChatId of [undefined, "", "   "]) {
    const app = createMockRouter();
    const initial = {
      "notify.tg_bot_token": "123:ABC",
      "tg.webhook_secret": secret,
    };
    if (emptyChatId !== undefined) {
      initial["notify.tg_chat_id"] = emptyChatId;
    }
    const deps = createMockDeps(initial);
    const tgCalls = [];
    const tgFetch = async (url, init) => {
      tgCalls.push({ url, body: JSON.parse(init.body) });
      return Response.json({ ok: true, result: { message_id: 1 } });
    };
    registerTgBot(app, deps, tgFetch);

    // Direct call to handleTelegramUpdate must fail closed (0 Telegram API calls)
    await handleTelegramUpdate(
      { update_id: 1, message: { chat: { id: 10001 }, from: { is_bot: false }, text: "/start" } },
      {},
      null,
      app,
      deps,
      tgFetch
    );
    assert.equal(tgCalls.length, 0);

    // POST /api/tg/webhook must also silently drop with 200 and 0 Telegram API calls
    const res = await app.fetch(
      new Request("https://panel.example.com/api/tg/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Telegram-Bot-Api-Secret-Token": secret,
        },
        body: JSON.stringify({
          update_id: 2,
          message: { chat: { id: 10001 }, from: { is_bot: false }, text: "/start" },
        }),
      }),
      {}
    );
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(tgCalls.length, 0);
  }
});


function assertAllButtonsValid(replyMarkup) {
  const rows = replyMarkup?.inline_keyboard || [];
  for (const row of rows) {
    for (const btn of row) {
      if (btn.callback_data !== undefined) {
        assert.ok(
          Buffer.byteLength(btn.callback_data, "utf8") <= 64,
          `callback_data exceeds 64 bytes: ${btn.callback_data}`
        );
      }
    }
  }
}

function collectCallbackDatas(replyMarkup) {
  const out = [];
  for (const row of replyMarkup?.inline_keyboard || []) {
    for (const btn of row) {
      if (btn.callback_data) out.push(btn.callback_data);
    }
  }
  return out;
}

function createInteractiveMockBackend() {
  const app = createMockRouter();
  const mutations = [];
  const OCID_1 =
    "ocid1.instance.oc1.ap-singapore-1.anuwgljr76q54nyczzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz1";
  const OCID_2 =
    "ocid1.instance.oc1.ap-singapore-1.anuwgljr76q54nyczzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz2";

  const cfgs = [
    {
      id: "cfg_AbCdEfGhIjK",
      name: "Prod <script>&1",
      region: "ap-singapore-1",
      regions: [{ regionName: "ap-singapore-1" }, { regionName: "ap-tokyo-1" }],
      status: "active",
      planType: "PAID",
      taskCount: 2,
      runningTaskCount: 1,
      lastCheckedAt: "2026-11-25T01:00:00Z",
      lastError: null,
      privateKey: "-----BEGIN PRIVATE KEY-----\nSECRET_KEY_DATA\n-----END PRIVATE KEY-----",
      passphrase: "secret-passphrase",
    },
    {
      id: "cfg_22222222222",
      name: "Backup & Test",
      region: "us-ashburn-1",
      regions: [{ regionName: "us-ashburn-1" }],
      status: "invalid",
      planType: "FREE_TIER",
      taskCount: 0,
      runningTaskCount: 0,
      lastCheckedAt: "2026-11-25T00:30:00Z",
      lastError: "Auth <failed> & expired",
    },
  ];

  const instancesByCfg = {
    cfg_AbCdEfGhIjK: [
      {
        id: OCID_1,
        displayName: "arm-<prod>&01",
        lifecycleState: "RUNNING",
        shape: "VM.Standard.A1.Flex",
        ocpus: 4,
        memoryInGBs: 24,
        publicIps: ["1.2.3.4"],
        availabilityDomain: "AD-1",
      },
      {
        id: OCID_2,
        name: "amd-free-02",
        state: "STOPPED",
        shape: "VM.Standard.E2.1.Micro",
        ocpus: 1,
        memoryGb: 1,
        publicIps: [],
        availabilityDomain: "AD-2",
      },
    ],
  };

  const launchTasks = [
    {
      id: "task_11111111111",
      cfgId: "cfg_AbCdEfGhIjK",
      cfgName: "Prod <script>&1",
      name: "ARM <4C24G>&",
      region: "ap-singapore-1",
      shape: "VM.Standard.A1.Flex",
      ocpus: 4,
      memoryGb: 24,
      targetCount: 1,
      successCount: 0,
      attemptCount: 12,
      intervalSec: 60,
      status: "running",
      lastMessage: "Out of host capacity",
      lastError: null,
      rootPassword: "SuperSecretRootPassword!",
      sshPrivateKey: "SECRET_SSH_PRIV",
    },
    {
      id: "task_22222222222",
      cfgId: "cfg_AbCdEfGhIjK",
      cfgName: "Prod <script>&1",
      name: "AMD Micro",
      region: "ap-singapore-1",
      shape: "VM.Standard.E2.1.Micro",
      ocpus: 1,
      memoryGb: 1,
      targetCount: 1,
      successCount: 1,
      attemptCount: 3,
      intervalSec: 120,
      status: "paused",
      lastMessage: "Completed",
      lastError: null,
    },
  ];

  const ipTasks = [
    {
      id: "ipt_11111111111",
      cfgId: "cfg_AbCdEfGhIjK",
      cfgName: "Prod <script>&1",
      instanceId: OCID_1,
      instanceName: "arm-<prod>&01",
      region: "ap-singapore-1",
      ipVersion: "ipv4",
      intervalSec: 60,
      status: "running",
      lastIp: "1.2.3.4",
      changeCount: 2,
      lastError: null,
    },
    {
      id: "ipt_22222222222",
      cfgId: "cfg_AbCdEfGhIjK",
      cfgName: "Prod <script>&1",
      instanceId: OCID_2,
      instanceName: "amd-free-02",
      region: "ap-singapore-1",
      ipVersion: "ipv4",
      intervalSec: 120,
      status: "paused",
      lastIp: "5.6.7.8",
      attemptCount: 4,
      lastError: "Rate limited & retry",
    },
  ];

  app.get("/api/cfgs", async (c) => {
    const page = Math.max(1, Number(c.req.query("page") ?? 1));
    const pageSize = Math.max(1, Number(c.req.query("pageSize") ?? 10));
    const start = (page - 1) * pageSize;
    return c.json({ items: cfgs.slice(start, start + pageSize), total: cfgs.length, page, pageSize });
  });

  app.get("/api/cfgs/:id", async (c) => {
    const item = cfgs.find((x) => x.id === c.req.param("id"));
    if (!item) return c.json({ error: "Not found" }, 404);
    return c.json({ item });
  });

  app.post("/api/cfgs/:id/check", async (c) => {
    const id = c.req.param("id");
    mutations.push({ type: "cfg_check", id });
    if (id === "cfg_22222222222") {
      return c.json({ error: "Invalid credentials <401>" }, 400);
    }
    return c.json({
      ok: true,
      tenancyName: "my-tenancy",
      regions: [{ regionName: "ap-singapore-1" }, { regionName: "ap-tokyo-1" }],
      availabilityDomains: [{ name: "AD-1" }, { name: "AD-2" }, { name: "AD-3" }],
    });
  });

  app.get("/api/cfgs/:id/instances", async (c) => {
    const id = c.req.param("id");
    const cfg = cfgs.find((x) => x.id === id);
    if (!cfg) return c.json({ error: "Not found" }, 404);
    mutations.push({ type: "list_instances", id });
    return c.json({ items: instancesByCfg[id] || [], region: cfg.region });
  });

  app.post("/api/cfgs/:id/instances/:iid/action", async (c) => {
    const body = await c.req.json();
    mutations.push({
      type: "instance_action",
      cfgId: c.req.param("id"),
      iid: c.req.param("iid"),
      action: body.action,
    });
    return c.json({ ok: true });
  });

  app.post("/api/cfgs/:id/instances/:iid/change-ip", async (c) => {
    mutations.push({
      type: "instance_change_ip",
      cfgId: c.req.param("id"),
      iid: c.req.param("iid"),
    });
    return c.json({ ok: true, ip: "9.8.7.6" });
  });

  app.get("/api/tasks", async (c) => {
    const page = Math.max(1, Number(c.req.query("page") ?? 1));
    const pageSize = Math.max(1, Number(c.req.query("pageSize") ?? 10));
    const start = (page - 1) * pageSize;
    return c.json({
      items: launchTasks.slice(start, start + pageSize),
      total: launchTasks.length,
      page,
      pageSize,
    });
  });

  app.patch("/api/tasks/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    mutations.push({ type: "patch_task", id, status: body.status });
    const t = launchTasks.find((x) => x.id === id);
    if (t && body.status) t.status = body.status;
    return c.json({ ok: true });
  });

  app.post("/api/tasks/:id/run", async (c) => {
    const id = c.req.param("id");
    mutations.push({ type: "run_task", id });
    return c.json({ ok: true, message: "Capacity checked: retrying next interval" });
  });

  app.get("/api/ip-tasks", async (c) => {
    const page = Math.max(1, Number(c.req.query("page") ?? 1));
    const pageSize = Math.max(1, Number(c.req.query("pageSize") ?? 20));
    const start = (page - 1) * pageSize;
    return c.json({
      items: ipTasks.slice(start, start + pageSize),
      total: ipTasks.length,
      page,
      pageSize,
    });
  });

  app.patch("/api/ip-tasks/:tid", async (c) => {
    const tid = c.req.param("tid");
    const body = await c.req.json();
    mutations.push({ type: "patch_ip_task", tid, status: body.status });
    const t = ipTasks.find((x) => x.id === tid);
    if (t && body.status) t.status = body.status;
    return c.json({ ok: true });
  });

  app.post("/api/ip-tasks/:tid/run", async (c) => {
    const tid = c.req.param("tid");
    mutations.push({ type: "run_ip_task", tid });
    return c.json({ ok: true, ip: "11.22.33.44", message: "IPv4 changed to 11.22.33.44" });
  });

  return { app, mutations, cfgs, instancesByCfg, launchTasks, ipTasks, OCID_1, OCID_2 };
}

function createTgSpy() {
  const calls = [];
  const tgFetch = async (url, init) => {
    const method = url.split("/").pop();
    const body = JSON.parse(init.body);
    calls.push({ method, body });
    return Response.json({ ok: true, result: { message_id: 500 + calls.length } });
  };
  return { calls, tgFetch };
}

test("/status and /status@MyOciBot return aggregate overview with HTML escaping and <= 64 byte buttons", async () => {
  const { app } = createInteractiveMockBackend();
  const deps = createMockDeps({
    "notify.tg_bot_token": "123:SECRET_TOKEN",
    "notify.tg_chat_id": "10001",
  });
  const { calls, tgFetch } = createTgSpy();

  for (const cmdText of ["/status", "/status@MyOciBot"]) {
    await handleTelegramUpdate(
      { update_id: 10, message: { chat: { id: 10001 }, from: { is_bot: false }, text: cmdText } },
      {},
      null,
      app,
      deps,
      tgFetch
    );
  }

  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.method, "sendMessage");
    assert.equal(call.body.parse_mode, "HTML");
    assert.match(call.body.text, /OCI Helper 总览/);
    assert.match(call.body.text, /2/); // 2 configs / 2 tasks
    assert.match(call.body.text, /1/); // 1 valid / 1 invalid / 1 running
    assertAllButtonsValid(call.body.reply_markup);
    const dataList = collectCallbackDatas(call.body.reply_markup);
    assert.ok(dataList.includes("c:ls:1"));
    assert.ok(dataList.includes("t:ls:l:1"));
    assert.ok(dataList.includes("m:st"));
  }
});

test("/cfgs -> c:v:<cfgId> -> c:chk:<cfgId> escapes HTML, answers callback immediately, shows loading state, and hides secrets", async () => {
  const { app, mutations } = createInteractiveMockBackend();
  const deps = createMockDeps({
    "notify.tg_bot_token": "123:SECRET_TOKEN",
    "notify.tg_chat_id": "10001",
  });
  const { calls, tgFetch } = createTgSpy();

  // 1. /cfgs command
  await handleTelegramUpdate(
    { update_id: 20, message: { chat: { id: 10001 }, from: { is_bot: false }, text: "/cfgs" } },
    {},
    null,
    app,
    deps,
    tgFetch
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "sendMessage");
  assert.match(calls[0].body.text, /Prod &lt;script&gt;&amp;1/);
  assert.equal(calls[0].body.text.includes("<script>"), false);
  assertAllButtonsValid(calls[0].body.reply_markup);
  assert.ok(collectCallbackDatas(calls[0].body.reply_markup).includes("c:v:cfg_AbCdEfGhIjK"));

  // 2. c:v:cfg_AbCdEfGhIjK
  calls.length = 0;
  await handleTelegramUpdate(
    {
      update_id: 21,
      callback_query: {
        id: "cq-1",
        from: { is_bot: false },
        message: { chat: { id: 10001 }, message_id: 77 },
        data: "c:v:cfg_AbCdEfGhIjK",
      },
    },
    {},
    null,
    app,
    deps,
    tgFetch
  );
  assert.equal(calls[0].method, "answerCallbackQuery");
  assert.equal(calls[0].body.callback_query_id, "cq-1");
  const detailCall = calls.find((c) => c.method === "editMessageText");
  assert.ok(detailCall);
  assert.match(detailCall.body.text, /Prod &lt;script&gt;&amp;1/);
  assert.match(detailCall.body.text, /ap-singapore-1/);
  assert.equal(detailCall.body.text.includes("SECRET_KEY_DATA"), false);
  assert.equal(detailCall.body.text.includes("secret-passphrase"), false);
  assertAllButtonsValid(detailCall.body.reply_markup);
  assert.ok(collectCallbackDatas(detailCall.body.reply_markup).includes("c:chk:cfg_AbCdEfGhIjK"));
  assert.ok(collectCallbackDatas(detailCall.body.reply_markup).includes("c:ins:cfg_AbCdEfGhIjK:1"));

  // 3. c:chk:cfg_AbCdEfGhIjK -> answerCallbackQuery -> loading edit -> POST check -> result edit
  calls.length = 0;
  await handleTelegramUpdate(
    {
      update_id: 22,
      callback_query: {
        id: "cq-2",
        from: { is_bot: false },
        message: { chat: { id: 10001 }, message_id: 77 },
        data: "c:chk:cfg_AbCdEfGhIjK",
      },
    },
    {},
    null,
    app,
    deps,
    tgFetch
  );
  assert.equal(calls[0].method, "answerCallbackQuery");
  const edits = calls.filter((c) => c.method === "editMessageText");
  assert.ok(edits.length >= 2);
  assert.match(edits[0].body.text, /⏳/);
  const finalEdit = edits[edits.length - 1];
  assert.match(finalEdit.body.text, /2/); // 2 regions
  assert.match(finalEdit.body.text, /3/); // 3 ADs
  assert.equal(mutations.some((m) => m.type === "cfg_check" && m.id === "cfg_AbCdEfGhIjK"), true);
  assertAllButtonsValid(finalEdit.body.reply_markup);
});

test("c:ins:<cfgId>:1 persists tg.imap:<cfgId>, hashes 88-byte OCIDs to 8-char shortIds, and displays config region", async () => {
  const { app, OCID_1, OCID_2 } = createInteractiveMockBackend();
  const deps = createMockDeps({
    "notify.tg_bot_token": "123:SECRET_TOKEN",
    "notify.tg_chat_id": "10001",
  });
  const { calls, tgFetch } = createTgSpy();

  assert.equal(Buffer.byteLength(OCID_1, "utf8"), 88);
  const short1 = await shortInstanceId(OCID_1);
  const short2 = await shortInstanceId(OCID_2);

  await handleTelegramUpdate(
    {
      update_id: 30,
      callback_query: {
        id: "cq-ins",
        from: { is_bot: false },
        message: { chat: { id: 10001 }, message_id: 88 },
        data: "c:ins:cfg_AbCdEfGhIjK:1",
      },
    },
    {},
    null,
    app,
    deps,
    tgFetch
  );

  assert.equal(calls[0].method, "answerCallbackQuery");
  const finalEdit = calls.filter((c) => c.method === "editMessageText").pop();
  assert.ok(finalEdit);
  assert.match(finalEdit.body.text, /ap-singapore-1/);
  assert.match(finalEdit.body.text, /arm-&lt;prod&gt;&amp;01/);
  assert.match(finalEdit.body.text, /1\.2\.3\.4/);
  assertAllButtonsValid(finalEdit.body.reply_markup);

  const btnDatas = collectCallbackDatas(finalEdit.body.reply_markup);
  assert.ok(btnDatas.includes(`i:v:cfg_AbCdEfGhIjK:${short1}`));
  assert.ok(btnDatas.includes(`i:v:cfg_AbCdEfGhIjK:${short2}`));

  const cachedRaw = await deps.sysGet({}, "tg.imap:cfg_AbCdEfGhIjK");
  assert.ok(cachedRaw);
  const cached = JSON.parse(cachedRaw);
  assert.equal(cached.map[short1].id, OCID_1);
  assert.equal(cached.map[short2].id, OCID_2);
});

test("Instance actions enforce 2-step confirmation for sp/rs/ip while st runs directly, and resolveInstanceByShortId falls back when cache is cleared", async () => {
  const { app, mutations, OCID_1 } = createInteractiveMockBackend();
  const deps = createMockDeps({
    "notify.tg_bot_token": "123:SECRET_TOKEN",
    "notify.tg_chat_id": "10001",
  });
  const { calls, tgFetch } = createTgSpy();
  const short1 = await shortInstanceId(OCID_1);

  // Stale button fallback: cache empty -> resolveInstanceByShortId fetches instances and persists cache
  const resolved = await resolveInstanceByShortId(app, deps, {}, null, "cfg_AbCdEfGhIjK", short1);
  assert.equal(resolved.id, OCID_1);
  assert.equal(resolved.region, "ap-singapore-1");
  assert.ok(await deps.sysGet({}, "tg.imap:cfg_AbCdEfGhIjK"));

  // i:v shows detail + buttons (st is i:do:st, sp/rs/ip are i:ask:*)
  await handleTelegramUpdate(
    {
      update_id: 40,
      callback_query: {
        id: "cq-iv",
        from: { is_bot: false },
        message: { chat: { id: 10001 }, message_id: 90 },
        data: `i:v:cfg_AbCdEfGhIjK:${short1}`,
      },
    },
    {},
    null,
    app,
    deps,
    tgFetch
  );
  const ivEdit = calls.filter((c) => c.method === "editMessageText").pop();
  const ivBtns = collectCallbackDatas(ivEdit.body.reply_markup);
  assert.ok(ivBtns.includes(`i:do:st:cfg_AbCdEfGhIjK:${short1}`));
  assert.ok(ivBtns.includes(`i:ask:sp:cfg_AbCdEfGhIjK:${short1}`));
  assert.ok(ivBtns.includes(`i:ask:rs:cfg_AbCdEfGhIjK:${short1}`));
  assert.ok(ivBtns.includes(`i:ask:ip:cfg_AbCdEfGhIjK:${short1}`));
  assertAllButtonsValid(ivEdit.body.reply_markup);

  // i:ask:sp, i:ask:rs, i:ask:ip MUST do ZERO mutating OCI calls
  mutations.length = 0;
  for (const op of ["sp", "rs", "ip"]) {
    calls.length = 0;
    await handleTelegramUpdate(
      {
        update_id: 41,
        callback_query: {
          id: `cq-ask-${op}`,
          from: { is_bot: false },
          message: { chat: { id: 10001 }, message_id: 90 },
          data: `i:ask:${op}:cfg_AbCdEfGhIjK:${short1}`,
        },
      },
      {},
      null,
      app,
      deps,
      tgFetch
    );
    const askEdit = calls.filter((c) => c.method === "editMessageText").pop();
    const askBtns = collectCallbackDatas(askEdit.body.reply_markup);
    assert.ok(askBtns.includes(`i:do:${op}:cfg_AbCdEfGhIjK:${short1}`));
    assert.ok(askBtns.includes(`i:v:cfg_AbCdEfGhIjK:${short1}`));
  }
  assert.equal(
    mutations.some((m) => m.type === "instance_action" || m.type === "instance_change_ip"),
    false
  );

  // Clear cache before i:do:st to prove stale-button fallback works end-to-end!
  await deps.sysSet({}, "tg.imap:cfg_AbCdEfGhIjK", "");
  mutations.length = 0;
  await handleTelegramUpdate(
    {
      update_id: 42,
      callback_query: {
        id: "cq-do-st",
        from: { is_bot: false },
        message: { chat: { id: 10001 }, message_id: 90 },
        data: `i:do:st:cfg_AbCdEfGhIjK:${short1}`,
      },
    },
    {},
    null,
    app,
    deps,
    tgFetch
  );
  assert.deepEqual(
    mutations.find((m) => m.type === "instance_action"),
    { type: "instance_action", cfgId: "cfg_AbCdEfGhIjK", iid: OCID_1, action: "START" }
  );

  // Execute sp, rs, ip
  for (const [op, expectedAction] of [
    ["sp", "SOFTSTOP"],
    ["rs", "SOFTRESET"],
  ]) {
    mutations.length = 0;
    await handleTelegramUpdate(
      {
        update_id: 43,
        callback_query: {
          id: `cq-do-${op}`,
          from: { is_bot: false },
          message: { chat: { id: 10001 }, message_id: 90 },
          data: `i:do:${op}:cfg_AbCdEfGhIjK:${short1}`,
        },
      },
      {},
      null,
      app,
      deps,
      tgFetch
    );
    assert.deepEqual(
      mutations.find((m) => m.type === "instance_action"),
      { type: "instance_action", cfgId: "cfg_AbCdEfGhIjK", iid: OCID_1, action: expectedAction }
    );
  }

  mutations.length = 0;
  calls.length = 0;
  await handleTelegramUpdate(
    {
      update_id: 44,
      callback_query: {
        id: "cq-do-ip",
        from: { is_bot: false },
        message: { chat: { id: 10001 }, message_id: 90 },
        data: `i:do:ip:cfg_AbCdEfGhIjK:${short1}`,
      },
    },
    {},
    null,
    app,
    deps,
    tgFetch
  );
  assert.deepEqual(
    mutations.find((m) => m.type === "instance_change_ip"),
    { type: "instance_change_ip", cfgId: "cfg_AbCdEfGhIjK", iid: OCID_1 }
  );
  const ipDoneEdit = calls.filter((c) => c.method === "editMessageText").pop();
  assert.match(ipDoneEdit.body.text, /9\.8\.7\.6/);
});

test("/tasks, launch task toggle/run, and IP task 2-step confirmation guards work end-to-end", async () => {
  const { app, mutations } = createInteractiveMockBackend();
  const deps = createMockDeps({
    "notify.tg_bot_token": "123:SECRET_TOKEN",
    "notify.tg_chat_id": "10001",
  });
  const { calls, tgFetch } = createTgSpy();

  // 1. /tasks -> launch task list
  await handleTelegramUpdate(
    { update_id: 50, message: { chat: { id: 10001 }, from: { is_bot: false }, text: "/tasks" } },
    {},
    null,
    app,
    deps,
    tgFetch
  );
  assert.equal(calls[0].method, "sendMessage");
  assert.match(calls[0].body.text, /ARM &lt;4C24G&gt;&amp;/);
  assertAllButtonsValid(calls[0].body.reply_markup);
  assert.ok(collectCallbackDatas(calls[0].body.reply_markup).includes("t:ls:p:1"));
  assert.ok(collectCallbackDatas(calls[0].body.reply_markup).includes("t:v:l:task_11111111111"));

  // 2. Launch task detail -> never leak rootPassword/sshPrivateKey
  calls.length = 0;
  await handleTelegramUpdate(
    {
      update_id: 51,
      callback_query: {
        id: "cq-tvl",
        from: { is_bot: false },
        message: { chat: { id: 10001 }, message_id: 91 },
        data: "t:v:l:task_11111111111",
      },
    },
    {},
    null,
    app,
    deps,
    tgFetch
  );
  const launchDetail = calls.find((c) => c.method === "editMessageText");
  assert.equal(launchDetail.body.text.includes("SuperSecretRootPassword!"), false);
  assert.equal(launchDetail.body.text.includes("SECRET_SSH_PRIV"), false);
  assert.ok(collectCallbackDatas(launchDetail.body.reply_markup).includes("t:tog:l:task_11111111111"));
  assert.ok(collectCallbackDatas(launchDetail.body.reply_markup).includes("t:run:l:task_11111111111"));

  // 3. Toggle launch task (running -> paused) & run launch task
  mutations.length = 0;
  await handleTelegramUpdate(
    {
      update_id: 52,
      callback_query: {
        id: "cq-togl",
        from: { is_bot: false },
        message: { chat: { id: 10001 }, message_id: 91 },
        data: "t:tog:l:task_11111111111",
      },
    },
    {},
    null,
    app,
    deps,
    tgFetch
  );
  assert.deepEqual(
    mutations.find((m) => m.type === "patch_task"),
    { type: "patch_task", id: "task_11111111111", status: "paused" }
  );

  mutations.length = 0;
  await handleTelegramUpdate(
    {
      update_id: 53,
      callback_query: {
        id: "cq-runl",
        from: { is_bot: false },
        message: { chat: { id: 10001 }, message_id: 91 },
        data: "t:run:l:task_11111111111",
      },
    },
    {},
    null,
    app,
    deps,
    tgFetch
  );
  assert.deepEqual(
    mutations.find((m) => m.type === "run_task"),
    { type: "run_task", id: "task_11111111111" }
  );

  // 4. IP tasks list (t:ls:p:1) & paused IP task detail (t:v:p:ipt_22222222222)
  calls.length = 0;
  await handleTelegramUpdate(
    {
      update_id: 54,
      callback_query: {
        id: "cq-tlsp",
        from: { is_bot: false },
        message: { chat: { id: 10001 }, message_id: 91 },
        data: "t:ls:p:1",
      },
    },
    {},
    null,
    app,
    deps,
    tgFetch
  );
  const ipListEdit = calls.find((c) => c.method === "editMessageText");
  assert.ok(collectCallbackDatas(ipListEdit.body.reply_markup).includes("t:v:p:ipt_11111111111"));
  assert.ok(collectCallbackDatas(ipListEdit.body.reply_markup).includes("t:v:p:ipt_22222222222"));

  // Paused IP task detail shows t:ask:res (not t:tog:p!)
  calls.length = 0;
  await handleTelegramUpdate(
    {
      update_id: 55,
      callback_query: {
        id: "cq-tvp2",
        from: { is_bot: false },
        message: { chat: { id: 10001 }, message_id: 91 },
        data: "t:v:p:ipt_22222222222",
      },
    },
    {},
    null,
    app,
    deps,
    tgFetch
  );
  const pausedIpDetail = calls.find((c) => c.method === "editMessageText");
  const pausedBtns = collectCallbackDatas(pausedIpDetail.body.reply_markup);
  assert.ok(pausedBtns.includes("t:ask:res:ipt_22222222222"));
  assert.ok(pausedBtns.includes("t:ask:run:ipt_22222222222"));
  assert.equal(pausedBtns.includes("t:tog:p:ipt_22222222222"), false);

  // Defense-in-depth: calling t:tog:p on paused IP task MUST NOT mutate, redirects to confirm!
  mutations.length = 0;
  calls.length = 0;
  await handleTelegramUpdate(
    {
      update_id: 56,
      callback_query: {
        id: "cq-togp-paused",
        from: { is_bot: false },
        message: { chat: { id: 10001 }, message_id: 91 },
        data: "t:tog:p:ipt_22222222222",
      },
    },
    {},
    null,
    app,
    deps,
    tgFetch
  );
  assert.equal(mutations.length, 0);
  const redirectEdit = calls.find((c) => c.method === "editMessageText");
  assert.ok(collectCallbackDatas(redirectEdit.body.reply_markup).includes("t:do:res:ipt_22222222222"));

  // Calling t:tog:p on running IP task pauses immediately
  mutations.length = 0;
  await handleTelegramUpdate(
    {
      update_id: 57,
      callback_query: {
        id: "cq-togp-running",
        from: { is_bot: false },
        message: { chat: { id: 10001 }, message_id: 91 },
        data: "t:tog:p:ipt_11111111111",
      },
    },
    {},
    null,
    app,
    deps,
    tgFetch
  );
  assert.deepEqual(
    mutations.find((m) => m.type === "patch_ip_task"),
    { type: "patch_ip_task", tid: "ipt_11111111111", status: "paused" }
  );

  // t:ask:run and t:ask:res do zero mutations; t:do:run and t:do:res mutate
  mutations.length = 0;
  for (const op of ["run", "res"]) {
    calls.length = 0;
    await handleTelegramUpdate(
      {
        update_id: 58,
        callback_query: {
          id: `cq-task-${op}`,
          from: { is_bot: false },
          message: { chat: { id: 10001 }, message_id: 91 },
          data: `t:ask:${op}:ipt_22222222222`,
        },
      },
      {},
      null,
      app,
      deps,
      tgFetch
    );
    const askEdit = calls.find((c) => c.method === "editMessageText");
    assert.ok(collectCallbackDatas(askEdit.body.reply_markup).includes(`t:do:${op}:ipt_22222222222`));
  }
  assert.equal(mutations.length, 0);

  await handleTelegramUpdate(
    {
      update_id: 59,
      callback_query: {
        id: "cq-tdo-res",
        from: { is_bot: false },
        message: { chat: { id: 10001 }, message_id: 91 },
        data: "t:do:res:ipt_22222222222",
      },
    },
    {},
    null,
    app,
    deps,
    tgFetch
  );
  assert.deepEqual(
    mutations.find((m) => m.type === "patch_ip_task"),
    { type: "patch_ip_task", tid: "ipt_22222222222", status: "running" }
  );

  mutations.length = 0;
  calls.length = 0;
  await handleTelegramUpdate(
    {
      update_id: 60,
      callback_query: {
        id: "cq-tdo-run",
        from: { is_bot: false },
        message: { chat: { id: 10001 }, message_id: 91 },
        data: "t:do:run:ipt_22222222222",
      },
    },
    {},
    null,
    app,
    deps,
    tgFetch
  );
  assert.deepEqual(
    mutations.find((m) => m.type === "run_ip_task"),
    { type: "run_ip_task", tid: "ipt_22222222222" }
  );
  const ipRunEdit = calls.filter((c) => c.method === "editMessageText").pop();
  assert.match(ipRunEdit.body.text, /11\.22\.33\.44/);
});

test("Security hygiene: unknown callback_data does not throw, and long HTML output truncates <= 3800 chars without unclosed tags", async () => {
  const { app } = createInteractiveMockBackend();
  const deps = createMockDeps({
    "notify.tg_bot_token": "123:SECRET_TOKEN",
    "notify.tg_chat_id": "10001",
  });
  const { calls, tgFetch } = createTgSpy();

  for (const badData of ["", "bad", "z:unknown:123", "c:v", "i:do:unknown:cfg_1:abcd1234"]) {
    await handleTelegramUpdate(
      {
        update_id: 70,
        callback_query: {
          id: "cq-bad",
          from: { is_bot: false },
          message: { chat: { id: 10001 }, message_id: 92 },
          data: badData,
        },
      },
      {},
      null,
      app,
      deps,
      tgFetch
    );
  }
  assert.equal(calls.filter((c) => c.method === "answerCallbackQuery").length, 5);

  // Very long HTML message truncation never leaves unclosed HTML tags or slices mid-tag
  const longHtml = `<b>Header</b>\n<code>${"x".repeat(4500)}</code>`;
  const truncated = truncateTelegramText(longHtml, 3800);
  assert.ok(truncated.length <= 3800);
  assert.ok(truncated.endsWith("…"));
  assert.equal((truncated.match(/<code>/g) || []).length, (truncated.match(/<\/code>/g) || []).length);
  assert.equal((truncated.match(/<b>/g) || []).length, (truncated.match(/<\/b>/g) || []).length);

  // Slicing right inside a tag `<b` or `<b>`
  const midTag = `hello <b>${"y".repeat(50)}</b>`;
  const truncSmall = truncateTelegramText(midTag, 9);
  assert.ok(truncSmall.length <= 9);
  assert.equal(truncSmall.includes("<b"), false);
});

function createInMemoryD1(initialRows = []) {
  const rows = new Map(initialRows.map((r) => [r.key, { ...r }]));
  return {
    rows,
    prepare(sql) {
      let args = [];
      const stmt = {
        bind(...params) {
          args = params;
          return stmt;
        },
        async first() {
          const allRes = await stmt.all();
          return allRes.results[0] ?? null;
        },
        async all() {
          if (sql.includes("FROM task")) {
            return { results: [] };
          }
          if (sql.startsWith("SELECT value FROM sys_cfg WHERE key = ?")) {
            const row = rows.get(args[0]);
            return { results: row ? [{ value: row.value }] : [] };
          }
          if (sql.startsWith("SELECT key, value, updated_at FROM sys_cfg")) {
            return { results: Array.from(rows.values()).map((r) => ({ ...r })) };
          }
          if (sql.startsWith("SELECT key, value FROM sys_cfg WHERE key LIKE ?")) {
            const prefix = String(args[0] ?? "").replace(/%$/, "");
            const matched = Array.from(rows.values())
              .filter((r) => r.key.startsWith(prefix))
              .map((r) => ({ key: r.key, value: r.value }));
            return { results: matched };
          }
          throw new Error(`Unsupported D1 all() SQL in test mock: ${sql}`);
        },
        async run() {
          if (sql.includes("INSERT INTO sys_cfg") && sql.includes("ON CONFLICT(key) DO UPDATE")) {
            const [key, value, updated_at] = args;
            rows.set(key, { key, value, updated_at });
            return { meta: { changes: 1 } };
          }
          if (sql.includes("INSERT OR IGNORE INTO sys_cfg")) {
            const [key, value, updated_at] = args;
            if (!rows.has(key)) {
              rows.set(key, { key, value, updated_at });
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
          }
          if (sql.startsWith("DELETE FROM sys_cfg WHERE key = ?")) {
            const existed = rows.delete(args[0]);
            return { meta: { changes: existed ? 1 : 0 } };
          }
          if (sql.includes("DELETE FROM sys_cfg WHERE key LIKE 'google.used:%'")) {
            return { meta: { changes: 0 } };
          }
          if (sql.includes("DELETE FROM sys_cfg WHERE key LIKE 'tg.imap:%'")) {
            const cutoff = String(args[0] ?? "");
            let changes = 0;
            for (const [k, v] of rows.entries()) {
              if (k.startsWith("tg.imap:") && String(v.updated_at || "") < cutoff) {
                rows.delete(k);
                changes += 1;
              }
            }
            return { meta: { changes } };
          }
          throw new Error(`Unsupported D1 run() SQL in test mock: ${sql}`);
        },
      };
      return stmt;
    },
  };
}

test("dist/index.js hooks registerTgBot, SYS_DEFS hidden keys, PUBLIC_API_PATHS, and tg.imap:% cleanup cleanly", () => {
  const src = fs.readFileSync("dist/index.js", "utf8");

  assert.match(src.slice(0, 200), /import\s*\{\s*registerTgBot\s*\}\s*from\s*"\.\/tg-bot\.js";/);

  const sysDefsMatch = src.match(/var SYS_DEFS = \[([\s\S]*?)\];/);
  assert.ok(sysDefsMatch, "SYS_DEFS block should exist");
  assert.match(
    sysDefsMatch[1],
    /\{\s*key:\s*"tg\.webhook_secret",\s*label:\s*"Telegram Webhook Secret",\s*secret:\s*true,\s*hidden:\s*true\s*\}/
  );
  assert.match(
    sysDefsMatch[1],
    /\{\s*key:\s*"tg\.webhook_url",\s*label:\s*"Telegram Webhook URL",\s*secret:\s*false,\s*hidden:\s*true\s*\}/
  );

  const publicPathsMatch = src.match(/var PUBLIC_API_PATHS =[\s\S]*?new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(publicPathsMatch, "PUBLIC_API_PATHS Set should exist");
  assert.match(publicPathsMatch[1], /"\/api\/tg\/webhook"/);
  assert.equal(publicPathsMatch[1].includes("/api/tg/webhook-config"), false);

  const registerIdx = src.indexOf("registerTgBot(app,");
  const notFoundIdx = src.lastIndexOf("app.notFound(");
  assert.ok(registerIdx !== -1, "registerTgBot(app, ...) call should exist");
  assert.ok(notFoundIdx !== -1 && registerIdx < notFoundIdx, "registerTgBot must be registered before app.notFound");

  const registerSnippet = src.slice(registerIdx, notFoundIdx);
  for (const depName of ["sysGet", "sysSet", "authSecret", "authVersion", "issueToken", "nowIso: nowIso2"]) {
    assert.ok(registerSnippet.includes(depName), `registerTgBot deps should include ${depName}`);
  }

  const cleanupMatch = src.match(/async function cleanupTempData\(env\) \{([\s\S]*?)\r?\n\}\r?\n__name\(cleanupTempData/);
  assert.ok(cleanupMatch, "cleanupTempData should exist");
  assert.match(cleanupMatch[1], /tg\.imap:%/);
});

test("Real Worker dist/index.js Hono routing: /api/tg/webhook public auth, /api/tg/webhook-config Bearer & DELETE precedence, hidden /api/sys, and tg.imap:% cleanup", async () => {
  const { default: worker } = await import("../dist/index.js");
  const db = createInMemoryD1([
    {
      key: "tg.webhook_secret",
      value: "plain-or-fallback-secret",
      updated_at: "2026-11-25T00:00:00.000Z",
    },
    {
      key: "tg.webhook_url",
      value: "https://example.workers.dev/api/tg/webhook",
      updated_at: "2026-11-25T00:00:00.000Z",
    },
  ]);
  const env = {
    DB: db,
    KEY_SECRET: "test-key-secret-for-real-worker-32b",
    AUTH_SECRET: "test-auth-secret-for-real-worker",
    AUTH_PASSWORD: "super-secret-password",
  };
  const waitUntilPromises = [];
  const ctx = {
    waitUntil(p) {
      waitUntilPromises.push(Promise.resolve(p));
    },
  };

  // 1. /api/tg/webhook-config without Bearer token must return 401
  const unauthCfgRes = await worker.fetch(new Request("https://example.workers.dev/api/tg/webhook-config"), env, ctx);
  assert.equal(unauthCfgRes.status, 401);

  // 2. /api/tg/webhook without secret header must return 401 from tg-bot.js (not 404, not Bearer middleware)
  const unauthWebhookRes = await worker.fetch(
    new Request("https://example.workers.dev/api/tg/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ update_id: 1 }),
    }),
    env,
    ctx
  );
  assert.equal(unauthWebhookRes.status, 401);
  const unauthWebhookJson = await unauthWebhookRes.json();
  assert.equal(unauthWebhookJson.error, "Unauthorized");

  // 3. Login via /api/login to obtain a real Bearer token
  const loginRes = await worker.fetch(
    new Request("https://example.workers.dev/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "super-secret-password" }),
    }),
    env,
    ctx
  );
  assert.equal(loginRes.status, 200);
  const { token } = await loginRes.json();
  assert.ok(token);

  // 4. Write encrypted tg.webhook_secret & tg.webhook_url via PUT /api/sys
  const putSecretRes = await worker.fetch(
    new Request("https://example.workers.dev/api/sys", {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ key: "tg.webhook_secret", value: "real-webhook-secret-xyz" }),
    }),
    env,
    ctx
  );
  assert.equal(putSecretRes.status, 200);
  const putUrlRes = await worker.fetch(
    new Request("https://example.workers.dev/api/sys", {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ key: "tg.webhook_url", value: "https://example.workers.dev/api/tg/webhook" }),
    }),
    env,
    ctx
  );
  assert.equal(putUrlRes.status, 200);

  // 4b. POST /api/tg/webhook with valid X-Telegram-Bot-Api-Secret-Token succeeds without Bearer token
  const authWebhookRes = await worker.fetch(
    new Request("https://example.workers.dev/api/tg/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": "real-webhook-secret-xyz",
      },
      body: JSON.stringify({ update_id: 2 }),
    }),
    env,
    ctx
  );
  assert.equal(authWebhookRes.status, 200);
  assert.deepEqual(await authWebhookRes.json(), { ok: true });

  // 4c. Authenticated GET /api/tg/webhook-config returns webhookUrl without Bearer rejection
  const authCfgRes = await worker.fetch(
    new Request("https://example.workers.dev/api/tg/webhook-config", {
      headers: { authorization: `Bearer ${token}` },
    }),
    env,
    ctx
  );
  assert.equal(authCfgRes.status, 200);
  const authCfgJson = await authCfgRes.json();
  assert.equal(authCfgJson.webhookUrl, "https://example.workers.dev/api/tg/webhook");

  // 4d. GET /api/sys must NOT expose hidden tg.webhook_secret or tg.webhook_url in items
  const sysRes = await worker.fetch(
    new Request("https://example.workers.dev/api/sys", {
      headers: { authorization: `Bearer ${token}` },
    }),
    env,
    ctx
  );
  assert.equal(sysRes.status, 200);
  const sysData = await sysRes.json();
  const keys = (sysData.items || []).map((i) => i.key);
  assert.equal(keys.includes("tg.webhook_secret"), false);
  assert.equal(keys.includes("tg.webhook_url"), false);

  // 5. Authenticated DELETE /api/tg/webhook-config must hit tg-bot.js (NOT swallowed by DELETE /api/sys/:key)
  const delRes = await worker.fetch(
    new Request("https://example.workers.dev/api/tg/webhook-config", {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    }),
    env,
    ctx
  );
  assert.equal(delRes.status, 200);
  const delJson = await delRes.json();
  assert.deepEqual(delJson, { ok: true, enabled: false, webhookUrl: "" });
  assert.equal(db.rows.get("tg.webhook_secret")?.value, null);
  assert.equal(db.rows.get("tg.webhook_url")?.value, null);

  // 6. cleanupTempData via worker.scheduled deletes tg.imap:* older than 7 days and keeps fresh rows
  const now = Date.now();
  const tenDaysAgo = new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString();
  const oneDayAgo = new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString();
  db.rows.set("tg.imap:old_cfg", { key: "tg.imap:old_cfg", value: "{}", updated_at: tenDaysAgo });
  db.rows.set("tg.imap:fresh_cfg", { key: "tg.imap:fresh_cfg", value: "{}", updated_at: oneDayAgo });

  await worker.scheduled(null, env, ctx);
  await Promise.all(waitUntilPromises);

  assert.equal(db.rows.has("tg.imap:old_cfg"), false);
  assert.equal(db.rows.has("tg.imap:fresh_cfg"), true);
});

test("HTTP 200 { ok: false } business failures on t:do:run and t:run:l render failure messages instead of success", async () => {
  const app = createMockRouter();
  app.post("/api/ip-tasks/:tid/run", async (c) =>
    c.json({ ok: false, message: "任务不存在" }, 200)
  );
  app.post("/api/tasks/:id/run", async (c) =>
    c.json({ ok: false, message: "配额超限" }, 200)
  );

  const deps = createMockDeps({
    "notify.tg_bot_token": "123:SECRET_TOKEN",
    "notify.tg_chat_id": "10001",
  });
  const { calls, tgFetch } = createTgSpy();

  // 1. t:do:run:<id> with HTTP 200 { ok: false, message: "任务不存在" }
  await handleTelegramUpdate(
    {
      update_id: 201,
      callback_query: {
        id: "cq-ip-biz-fail",
        from: { is_bot: false },
        message: { chat: { id: 10001 }, message_id: 101 },
        data: "t:do:run:ipt_missing",
      },
    },
    {},
    null,
    app,
    deps,
    tgFetch
  );
  const ipEdit = calls.filter((c) => c.method === "editMessageText").pop();
  assert.ok(ipEdit);
  assert.match(ipEdit.body.text, /❌/);
  assert.match(ipEdit.body.text, /任务不存在/);
  assert.equal(ipEdit.body.text.includes("✅ 换 IP 任务执行完成"), false);

  // 2. t:run:l:<id> with HTTP 200 { ok: false, message: "配额超限" }
  calls.length = 0;
  await handleTelegramUpdate(
    {
      update_id: 202,
      callback_query: {
        id: "cq-launch-biz-fail",
        from: { is_bot: false },
        message: { chat: { id: 10001 }, message_id: 102 },
        data: "t:run:l:task_over_quota",
      },
    },
    {},
    null,
    app,
    deps,
    tgFetch
  );
  const launchEdit = calls.filter((c) => c.method === "editMessageText").pop();
  assert.ok(launchEdit);
  assert.match(launchEdit.body.text, /❌/);
  assert.match(launchEdit.body.text, /配额超限/);
  assert.equal(launchEdit.body.text.includes("⚡ 抢机任务已执行"), false);
});

test("Instance detail i:v refreshes stale tg.imap cache from live OCI and i:do:ip invalidates stale cache", async () => {
  const OCID =
    "ocid1.instance.oc1.ap-singapore-1.anuwgljr76q54nyczzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz9";
  const cfgId = "cfg_LiveRefresh";
  const short8 = await shortInstanceId(OCID);

  let liveState = "RUNNING";
  let liveIp = "2.2.2.2";

  const app = createMockRouter();
  app.get("/api/cfgs/:id/instances", async (c) =>
    c.json({
      region: "ap-singapore-1",
      items: [
        {
          id: OCID,
          displayName: "live-arm-01",
          lifecycleState: liveState,
          shape: "VM.Standard.A1.Flex",
          ocpus: 4,
          memoryInGBs: 24,
          publicIps: [liveIp],
        },
      ],
    })
  );
  // Real dist/index.js shape: returns { item } with state + vnics[].publicIp
  app.get("/api/cfgs/:id/instances/:iid", async (c) =>
    c.json({
      item: {
        id: c.req.param("iid"),
        displayName: "live-arm-01",
        state: liveState,
        shape: "VM.Standard.A1.Flex",
        ocpus: 4,
        memoryInGBs: 24,
        region: "ap-singapore-1",
        vnics: [{ publicIp: liveIp }],
      },
    })
  );
  app.post("/api/cfgs/:id/instances/:iid/change-ip", async (c) => {
    liveIp = "3.3.3.3";
    return c.json({ ok: true, ip: "3.3.3.3" });
  });

  const deps = createMockDeps({
    "notify.tg_bot_token": "123:SECRET_TOKEN",
    "notify.tg_chat_id": "10001",
    [`tg.imap:${cfgId}`]: JSON.stringify({
      ts: 1700000000000,
      map: {
        [short8]: {
          id: OCID,
          name: "live-arm-01",
          state: "STOPPED",
          shape: "VM.Standard.A1.Flex",
          ocpus: 4,
          memoryGb: 24,
          publicIps: ["1.1.1.1"],
          region: "ap-singapore-1",
        },
      },
    }),
  });
  const { calls, tgFetch } = createTgSpy();

  // 1. i:v with stale tg.imap (STOPPED, 1.1.1.1) -> fetches live RUNNING & 2.2.2.2 and updates tg.imap
  await handleTelegramUpdate(
    {
      update_id: 210,
      callback_query: {
        id: "cq-iv-refresh",
        from: { is_bot: false },
        message: { chat: { id: 10001 }, message_id: 110 },
        data: `i:v:${cfgId}:${short8}`,
      },
    },
    {},
    null,
    app,
    deps,
    tgFetch
  );
  const refreshEdit = calls.filter((c) => c.method === "editMessageText").pop();
  assert.ok(refreshEdit);
  assert.match(refreshEdit.body.text, /RUNNING/);
  assert.match(refreshEdit.body.text, /2\.2\.2\.2/);
  assert.equal(refreshEdit.body.text.includes("STOPPED"), false);
  assert.equal(refreshEdit.body.text.includes("1.1.1.1"), false);

  const updatedMap = JSON.parse(await deps.sysGet({}, `tg.imap:${cfgId}`));
  assert.equal(updatedMap.map[short8].state, "RUNNING");
  assert.deepEqual(updatedMap.map[short8].publicIps, ["2.2.2.2"]);

  // 2. Seed stale cache 1.1.1.1 again, run i:do:ip -> succeeds with 3.3.3.3, then click i:v -> must show 3.3.3.3!
  await deps.sysSet(
    {},
    `tg.imap:${cfgId}`,
    JSON.stringify({
      ts: 1700000000000,
      map: {
        [short8]: {
          id: OCID,
          name: "live-arm-01",
          state: "RUNNING",
          shape: "VM.Standard.A1.Flex",
          ocpus: 4,
          memoryGb: 24,
          publicIps: ["1.1.1.1"],
          region: "ap-singapore-1",
        },
      },
    })
  );
  calls.length = 0;
  await handleTelegramUpdate(
    {
      update_id: 211,
      callback_query: {
        id: "cq-do-ip-live",
        from: { is_bot: false },
        message: { chat: { id: 10001 }, message_id: 110 },
        data: `i:do:ip:${cfgId}:${short8}`,
      },
    },
    {},
    null,
    app,
    deps,
    tgFetch
  );
  const doIpEdit = calls.filter((c) => c.method === "editMessageText").pop();
  assert.match(doIpEdit.body.text, /3\.3\.3\.3/);

  calls.length = 0;
  await handleTelegramUpdate(
    {
      update_id: 212,
      callback_query: {
        id: "cq-iv-after-ip",
        from: { is_bot: false },
        message: { chat: { id: 10001 }, message_id: 110 },
        data: `i:v:${cfgId}:${short8}`,
      },
    },
    {},
    null,
    app,
    deps,
    tgFetch
  );
  const afterIpEdit = calls.filter((c) => c.method === "editMessageText").pop();
  assert.ok(afterIpEdit);
  assert.match(afterIpEdit.body.text, /3\.3\.3\.3/);
  assert.equal(afterIpEdit.body.text.includes("1.1.1.1"), false);
});
