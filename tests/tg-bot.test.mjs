import test from "node:test";
import assert from "node:assert/strict";
import {
  constantTimeEqual,
  escapeHtml,
  truncateTelegramText,
  shortInstanceId,
  parseCallbackData,
  callTelegramApi,
  callInternalApi,
  registerTgBot,
  handleTelegramUpdate,
} from "../dist/tg-bot.js";

function createMockRouter() {
  const routes = new Map();
  const app = {
    get(path, handler) {
      routes.set(`GET ${path}`, handler);
    },
    post(path, handler) {
      routes.set(`POST ${path}`, handler);
    },
    delete(path, handler) {
      routes.set(`DELETE ${path}`, handler);
    },
    async fetch(request, env = {}, executionCtx) {
      const url = new URL(request.url);
      const key = `${request.method.toUpperCase()} ${url.pathname}`;
      const handler = routes.get(key);
      if (!handler) {
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
      return handler(c);
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
