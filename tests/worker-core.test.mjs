import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as nodeCrypto from "node:crypto";
import worker, { LogHub } from "../dist/index.js";

const { privateKey: TEST_RSA_PRIVATE_KEY } = nodeCrypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const TEST_SSH_PUBKEY =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl test@oci";

function splitSqlList(segment) {
  const out = [];
  let cur = "";
  let depth = 0;
  let inSingle = false;
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];
    if (ch === "'" && segment[i - 1] !== "\\") {
      inSingle = !inSingle;
      cur += ch;
      continue;
    }
    if (!inSingle) {
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      else if (ch === "," && depth === 0) {
        out.push(cur.trim());
        cur = "";
        continue;
      }
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function createMemoryD1(opts = {}) {
  const sysCfg = new Map();
  const ociCfg = new Map();
  const tasks = new Map();
  const schemaStatements = [];
  let batchCalls = 0;
  let inFlightBatch = 0;
  let maxConcurrentBatch = 0;

  function evalSqlLiteralOrParam(expr, args, idxRef) {
    const t = expr.trim();
    if (t === "?") return args[idxRef.i++];
    if (/^NULL$/i.test(t)) return null;
    if (t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1);
    if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
    return t;
  }

  function prepare(rawSql) {
    const sql = rawSql.replace(/\s+/g, " ").trim();
    let args = [];
    const stmt = {
      sql,
      bind(...params) {
        args = params;
        return stmt;
      },
      async first() {
        const res = await stmt.all();
        return res.results?.[0] ?? null;
      },
      async all() {
        if (opts.onQuery) await opts.onQuery(sql, args);

        // sys_cfg queries
        if (sql === "SELECT value FROM sys_cfg WHERE key = ?") {
          const r = sysCfg.get(args[0]);
          return { results: r ? [{ value: r.value }] : [] };
        }
        if (sql === "SELECT value, updated_at FROM sys_cfg WHERE key = ?") {
          const r = sysCfg.get(args[0]);
          return { results: r ? [{ value: r.value, updated_at: r.updated_at }] : [] };
        }
        if (sql === "SELECT key, value, updated_at FROM sys_cfg") {
          return { results: Array.from(sysCfg.values()).map((r) => ({ ...r })) };
        }
        if (sql === "SELECT key, value FROM sys_cfg WHERE key LIKE ?") {
          const prefix = String(args[0] ?? "").replace(/%$/, "");
          const results = Array.from(sysCfg.values())
            .filter((r) => r.key.startsWith(prefix))
            .map((r) => ({ key: r.key, value: r.value }));
          return { results };
        }

        // oci_cfg queries
        if (sql === "SELECT * FROM oci_cfg WHERE id = ?") {
          const r = ociCfg.get(args[0]);
          return { results: r ? [{ ...r }] : [] };
        }
        if (sql.startsWith("SELECT COUNT(*) AS n FROM oci_cfg c")) {
          return { results: [{ n: ociCfg.size }] };
        }
        if (sql.includes("FROM oci_cfg c")) {
          if (sql.includes("WHERE c.id = ?")) {
            const r = ociCfg.get(args[0]);
            if (!r) return { results: [] };
            const allTasks = Array.from(tasks.values()).filter(
              (t) => t.cfg_id === r.id && t.type === "launch"
            );
            return {
              results: [
                {
                  ...r,
                  task_count: allTasks.length,
                  running_task_count: allTasks.filter((t) => t.status === "running").length,
                },
              ],
            };
          }
          const rows = Array.from(ociCfg.values()).map((r) => {
            const allTasks = Array.from(tasks.values()).filter(
              (t) => t.cfg_id === r.id && t.type === "launch"
            );
            return {
              ...r,
              task_count: allTasks.length,
              running_task_count: allTasks.filter((t) => t.status === "running").length,
            };
          });
          return { results: rows };
        }

        // task queries
        if (sql === "SELECT * FROM task WHERE id = ? AND type = 'launch'") {
          const r = tasks.get(args[0]);
          return { results: r && r.type === "launch" ? [{ ...r }] : [] };
        }
        if (sql === "SELECT * FROM task WHERE id = ? AND type = 'ip'") {
          const r = tasks.get(args[0]);
          return { results: r && r.type === "ip" ? [{ ...r }] : [] };
        }
        if (sql === "SELECT * FROM task WHERE id = ?") {
          const r = tasks.get(args[0]);
          return { results: r ? [{ ...r }] : [] };
        }
        if (
          sql.startsWith(
            "SELECT id FROM task WHERE type = 'launch' AND status = 'running' AND next_run_at <= ?"
          )
        ) {
          const [now, lockNow, limit] = args;
          const rows = Array.from(tasks.values())
            .filter(
              (t) =>
                t.type === "launch" &&
                t.status === "running" &&
                (t.next_run_at ?? 0) <= now &&
                (t.locked_until == null || t.locked_until < lockNow)
            )
            .sort((a, b) => (a.next_run_at ?? 0) - (b.next_run_at ?? 0))
            .slice(0, limit ?? 5)
            .map((t) => ({ id: t.id }));
          return { results: rows };
        }
        if (
          sql.startsWith(
            "SELECT id FROM task WHERE type = 'ip' AND status = 'running' AND next_run_at <= ?"
          )
        ) {
          const [now, lockNow] = args;
          const rows = Array.from(tasks.values())
            .filter(
              (t) =>
                t.type === "ip" &&
                t.status === "running" &&
                (t.next_run_at ?? 0) <= now &&
                (t.locked_until == null || t.locked_until < lockNow)
            )
            .sort((a, b) => (a.next_run_at ?? 0) - (b.next_run_at ?? 0))
            .slice(0, 5)
            .map((t) => ({ id: t.id }));
          return { results: rows };
        }
        if (sql === "SELECT COUNT(*) AS n FROM task WHERE type = 'ip'") {
          const n = Array.from(tasks.values()).filter((t) => t.type === "ip").length;
          return { results: [{ n }] };
        }
        if (sql.startsWith("SELECT COUNT(*) AS n FROM task t")) {
          let list = Array.from(tasks.values());
          if (sql.includes("t.type = 'launch'")) list = list.filter((t) => t.type === "launch");
          if (sql.includes("t.type = 'ip'")) list = list.filter((t) => t.type === "ip");
          if (sql.includes("t.cfg_id = ?")) list = list.filter((t) => t.cfg_id === args[0]);
          return { results: [{ n: list.length }] };
        }
        if (sql.startsWith("SELECT t.*, cfg.name AS cfg_name FROM task t")) {
          let list = Array.from(tasks.values());
          if (sql.includes("t.type = 'launch'")) list = list.filter((t) => t.type === "launch");
          if (sql.includes("t.type = 'ip'")) list = list.filter((t) => t.type === "ip");
          let argIdx = 0;
          if (sql.includes("t.cfg_id = ?")) {
            const cid = args[argIdx++];
            list = list.filter((t) => t.cfg_id === cid);
          }
          const limit = args[argIdx++] ?? 20;
          const offset = args[argIdx++] ?? 0;
          const joined = list
            .slice(offset, offset + limit)
            .map((t) => ({ ...t, cfg_name: ociCfg.get(t.cfg_id)?.name ?? "" }));
          return { results: joined };
        }
        if (sql.startsWith("SELECT * FROM task WHERE cfg_id = ? AND type = 'ip'")) {
          const list = Array.from(tasks.values())
            .filter((t) => t.cfg_id === args[0] && t.type === "ip")
            .map((t) => ({ ...t }));
          return { results: list };
        }

        throw new Error(`Unsupported D1 all() SQL in worker-core.test.mjs: ${sql}`);
      },
      async run() {
        if (opts.onRun) await opts.onRun(sql, args);

        // DDL
        if (sql.startsWith("CREATE TABLE") || sql.startsWith("CREATE INDEX")) {
          schemaStatements.push(sql);
          return { meta: { changes: 0 } };
        }

        // sys_cfg mutations
        if (sql.includes("INSERT INTO sys_cfg") && sql.includes("ON CONFLICT(key) DO UPDATE")) {
          const [key, value, updated_at] = args;
          sysCfg.set(key, { key, value, updated_at });
          return { meta: { changes: 1 } };
        }
        if (sql.startsWith("INSERT OR IGNORE INTO sys_cfg")) {
          const [key, value, updated_at] = args;
          if (!sysCfg.has(key)) {
            sysCfg.set(key, { key, value, updated_at });
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        }
        if (sql === "UPDATE sys_cfg SET value = ?, updated_at = ? WHERE key = ?") {
          const [value, updated_at, key] = args;
          if (!sysCfg.has(key)) return { meta: { changes: 0 } };
          sysCfg.set(key, { key, value, updated_at });
          return { meta: { changes: 1 } };
        }
        if (sql === "DELETE FROM sys_cfg WHERE key = ?") {
          const deleted = sysCfg.delete(args[0]);
          return { meta: { changes: deleted ? 1 : 0 } };
        }
        if (sql.startsWith("DELETE FROM sys_cfg WHERE key LIKE 'google.used:%'")) {
          const now = Number(args[0] ?? 0);
          let changes = 0;
          for (const [k, v] of sysCfg.entries()) {
            if (k.startsWith("google.used:") && Number(v.value) * 1000 + 3600000 < now) {
              sysCfg.delete(k);
              changes++;
            }
          }
          return { meta: { changes } };
        }
        if (sql.startsWith("DELETE FROM sys_cfg WHERE key LIKE 'tg.imap:%'")) {
          const cutoff = String(args[0] ?? "");
          let changes = 0;
          for (const [k, v] of sysCfg.entries()) {
            if (k.startsWith("tg.imap:") && String(v.updated_at || "") < cutoff) {
              sysCfg.delete(k);
              changes++;
            }
          }
          return { meta: { changes } };
        }

        // Generic INSERT INTO oci_cfg / task
        const insMatch = sql.match(/^INSERT INTO (oci_cfg|task) \(([^)]+)\) VALUES \((.+)\)$/);
        if (insMatch) {
          const [, table, colList, valList] = insMatch;
          const cols = splitSqlList(colList);
          const vals = splitSqlList(valList);
          const idxRef = { i: 0 };
          const row =
            table === "task"
              ? {
                  type: "launch",
                  status: "running",
                  target_count: 1,
                  success_count: 0,
                  attempt_count: 0,
                  interval_sec: 60,
                  capacity_check: 1,
                  dns_proxied: 0,
                  next_run_at: 0,
                  locked_until: null,
                }
              : { status: "unknown" };
          for (let i = 0; i < cols.length; i++) {
            row[cols[i]] = evalSqlLiteralOrParam(vals[i], args, idxRef);
          }
          if (table === "oci_cfg") ociCfg.set(row.id, row);
          else tasks.set(row.id, row);
          return { meta: { changes: 1 } };
        }

        // UPDATE oci_cfg / task
        const updMatch = sql.match(/^UPDATE (oci_cfg|task) SET (.+) WHERE (.+)$/);
        if (updMatch) {
          const [, table, setPart, wherePart] = updMatch;
          const store = table === "oci_cfg" ? ociCfg : tasks;
          const assignments = splitSqlList(setPart);
          const setParamCount = assignments.reduce(
            (acc, expr) => acc + (expr.includes("?") ? 1 : 0),
            0
          );
          const whereArgs = args.slice(setParamCount);

          let row = null;
          if (wherePart === "id = ? AND (locked_until IS NULL OR locked_until < ?)") {
            const [id, now] = whereArgs;
            const candidate = store.get(id);
            if (candidate && (candidate.locked_until == null || candidate.locked_until < now)) {
              row = candidate;
            }
          } else if (wherePart === "id = ? AND type = 'ip'") {
            const candidate = store.get(whereArgs[0]);
            if (candidate && candidate.type === "ip") row = candidate;
          } else if (wherePart === "id = ?") {
            row = store.get(whereArgs[0]) ?? null;
          } else {
            throw new Error(`Unsupported UPDATE WHERE in worker-core.test.mjs: ${sql}`);
          }

          if (!row) return { meta: { changes: 0 } };

          const idxRef = { i: 0 };
          for (const assign of assignments) {
            const eqIdx = assign.indexOf("=");
            const col = assign.slice(0, eqIdx).trim();
            const rhs = assign.slice(eqIdx + 1).trim();
            const incMatch = rhs.match(/^(\w+)\s*\+\s*(\d+)$/);
            if (incMatch) {
              row[col] = (Number(row[incMatch[1]]) || 0) + Number(incMatch[2]);
            } else {
              row[col] = evalSqlLiteralOrParam(rhs, args, idxRef);
            }
          }
          return { meta: { changes: 1 } };
        }

        // DELETE FROM oci_cfg / task
        if (sql === "DELETE FROM task WHERE id = ?") {
          const deleted = tasks.delete(args[0]);
          return { meta: { changes: deleted ? 1 : 0 } };
        }
        if (sql === "DELETE FROM task WHERE id = ? AND type = 'launch'") {
          const r = tasks.get(args[0]);
          if (r && r.type === "launch") {
            tasks.delete(args[0]);
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        }
        if (sql === "DELETE FROM task WHERE id = ? AND type = 'ip'") {
          const r = tasks.get(args[0]);
          if (r && r.type === "ip") {
            tasks.delete(args[0]);
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        }
        if (sql === "DELETE FROM task WHERE cfg_id = ?") {
          let changes = 0;
          for (const [k, v] of tasks.entries()) {
            if (v.cfg_id === args[0]) {
              tasks.delete(k);
              changes++;
            }
          }
          return { meta: { changes } };
        }
        if (sql === "DELETE FROM oci_cfg WHERE id = ?") {
          const deleted = ociCfg.delete(args[0]);
          return { meta: { changes: deleted ? 1 : 0 } };
        }

        throw new Error(`Unsupported D1 run() SQL in worker-core.test.mjs: ${sql}`);
      },
    };
    return stmt;
  }

  return {
    sysCfg,
    ociCfg,
    tasks,
    schemaStatements,
    get batchCalls() {
      return batchCalls;
    },
    get maxConcurrentBatch() {
      return maxConcurrentBatch;
    },
    prepare,
    async batch(stmts) {
      batchCalls++;
      inFlightBatch++;
      if (inFlightBatch > maxConcurrentBatch) maxConcurrentBatch = inFlightBatch;
      try {
        if (opts.onBatch) await opts.onBatch(batchCalls, stmts);
        const out = [];
        for (const s of stmts) {
          out.push(await s.run());
        }
        return out;
      } finally {
        inFlightBatch--;
      }
    },
  };
}

function createTestEnv(db, extra = {}) {
  return {
    DB: db,
    KEY_SECRET: "unit-test-key-secret-32-bytes-ok!",
    AUTH_SECRET: "unit-test-auth-secret-32-bytes-ok",
    AUTH_PASSWORD: "AdminPassword#2026",
    ...extra,
  };
}

function createExecCtx() {
  const promises = [];
  return {
    promises,
    ctx: {
      waitUntil(p) {
        promises.push(Promise.resolve(p));
      },
    },
    async flush() {
      while (promises.length) {
        const batch = promises.splice(0, promises.length);
        await Promise.allSettled(batch);
      }
    },
  };
}

async function apiJson(env, ctx, path, init = {}) {
  const headers = { ...(init.headers || {}) };
  let body = init.body;
  if (body !== undefined && typeof body !== "string") {
    headers["content-type"] = headers["content-type"] || "application/json";
    body = JSON.stringify(body);
  }
  const res = await worker.fetch(
    new Request(`https://panel.example.com${path}`, {
      method: init.method || "GET",
      headers,
      body,
    }),
    env,
    ctx
  );
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, res };
}

async function loginAndGetToken(env, ctx, ip = "127.0.0.1") {
  const { status, data } = await apiJson(env, ctx, "/api/login", {
    method: "POST",
    headers: { "cf-connecting-ip": ip },
    body: { password: env.AUTH_PASSWORD },
  });
  assert.equal(status, 200);
  assert.ok(data.token);
  return data.token;
}

async function seedOciConfig(env, ctx, token, overrides = {}) {
  const { status, data } = await apiJson(env, ctx, "/api/cfgs", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: {
      name: overrides.name || "SG-Primary",
      tenancyOcid: overrides.tenancyOcid || "ocid1.tenancy.oc1..aaaaaaaaexampletenancy",
      userOcid: overrides.userOcid || "ocid1.user.oc1..aaaaaaaaexampleuser",
      fingerprint: overrides.fingerprint || "aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:99",
      region: overrides.region || "ap-singapore-1",
      compartmentId: overrides.compartmentId || "ocid1.compartment.oc1..defaultcomp",
      privateKey: TEST_RSA_PRIVATE_KEY,
      skipVerify: true,
    },
  });
  assert.equal(status, 200);
  assert.ok(data.item?.id);
  return data.item;
}

async function withMockFetch(handler, fn) {
  const prev = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    return await fn();
  } finally {
    globalThis.fetch = prev;
  }
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// ============================================================================
// 1) #6 ensureSchema 冷启动并发去重、失败重置恢复与 scheduled() 自动建表
// ============================================================================
test("#6 ensureSchema deduplicates concurrent cold-start calls, resets on D1 error, and runs before scheduled()", async () => {
  // 1a. Concurrent cold-start requests share one schemaPromise (single DB.batch call)
  let releaseGate;
  const gate = new Promise((r) => {
    releaseGate = r;
  });
  let notifyEntered;
  const entered = new Promise((r) => {
    notifyEntered = r;
  });

  const dbConcurrent = createMemoryD1({
    async onBatch() {
      notifyEntered();
      await gate;
    },
  });
  const envConcurrent = createTestEnv(dbConcurrent);
  const { ctx } = createExecCtx();

  const reqPromises = Array.from({ length: 6 }, () =>
    worker.fetch(new Request("https://panel.example.com/api/health"), envConcurrent, ctx)
  );
  await entered;
  releaseGate();

  const responses = await Promise.all(reqPromises);
  for (const r of responses) {
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true });
  }
  assert.equal(dbConcurrent.batchCalls, 1, "6 concurrent cold-start requests must share 1 DB.batch");
  assert.equal(dbConcurrent.maxConcurrentBatch, 1);
  assert.ok(dbConcurrent.schemaStatements.some((s) => s.includes("CREATE TABLE IF NOT EXISTS oci_cfg")));
  assert.ok(dbConcurrent.schemaStatements.some((s) => s.includes("CREATE TABLE IF NOT EXISTS task")));
  assert.ok(dbConcurrent.schemaStatements.some((s) => s.includes("CREATE TABLE IF NOT EXISTS sys_cfg")));

  // Follow-up request reuses completed schemaPromise without re-running batch
  const followUp = await worker.fetch(
    new Request("https://panel.example.com/api/health"),
    envConcurrent,
    ctx
  );
  assert.equal(followUp.status, 200);
  assert.equal(dbConcurrent.batchCalls, 1);

  // 1b. Transient DB.batch failure is NOT swallowed and resets schemaPromise so next request recovers
  let failOnce = true;
  const dbRecover = createMemoryD1({
    async onBatch() {
      if (failOnce) {
        failOnce = false;
        throw new Error("D1 cold-start transient failure");
      }
    },
  });
  const envRecover = createTestEnv(dbRecover);

  const failedRes = await worker.fetch(
    new Request("https://panel.example.com/api/health"),
    envRecover,
    ctx
  );
  assert.equal(failedRes.status, 500);
  assert.equal(dbRecover.batchCalls, 1);

  const recoveredRes = await worker.fetch(
    new Request("https://panel.example.com/api/health"),
    envRecover,
    ctx
  );
  assert.equal(recoveredRes.status, 200);
  assert.equal(dbRecover.batchCalls, 2, "schemaPromise must reset after failure and retry on next request");

  // 1c. scheduled() runs ensureSchema(env) before querying task/sys_cfg tables on a cold Worker
  const callOrder = [];
  const dbScheduled = createMemoryD1({
    async onBatch() {
      callOrder.push("ensureSchema.batch");
    },
    async onQuery(sql) {
      if (sql.includes("FROM task") || sql.includes("FROM sys_cfg")) {
        callOrder.push(`query:${sql.slice(0, 28)}`);
      }
    },
  });
  const envScheduled = createTestEnv(dbScheduled);
  const schedCtx = createExecCtx();

  await worker.scheduled({}, envScheduled, schedCtx.ctx);
  await schedCtx.flush();

  assert.equal(dbScheduled.batchCalls, 1);
  assert.equal(callOrder[0], "ensureSchema.batch", "scheduled() must await ensureSchema before running due tasks");
  assert.ok(callOrder.length >= 3);
});

// ============================================================================
// 2) #5 /api/login IP 失败限流、抑制重复 TG 轰炸、以及 TOTP 同窗口防重放
// ============================================================================
test("#5 POST /api/login enforces per-IP 429 rate limit, caps TG failure alerts at 3, and blocks same-step TOTP replay", async (t) => {
  const db = createMemoryD1();
  const env = createTestEnv(db);
  const { ctx, flush } = createExecCtx();
  const tgMessages = [];

  await withMockFetch(
    async (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.startsWith("https://api.telegram.org/")) {
        tgMessages.push({ url, body: JSON.parse(init?.body || "{}") });
        return jsonResponse({ ok: true, result: { message_id: tgMessages.length } });
      }
      return jsonResponse({});
    },
    async () => {
      // Admin bootstrap from trusted IP to configure TG notifications
      const adminToken = await loginAndGetToken(env, ctx, "10.0.0.1");
      await apiJson(env, ctx, "/api/sys", {
        method: "PUT",
        headers: { authorization: `Bearer ${adminToken}` },
        body: { key: "notify.tg_bot_token", value: "123456:TEST_BOT_SECRET" },
      });
      await apiJson(env, ctx, "/api/sys", {
        method: "PUT",
        headers: { authorization: `Bearer ${adminToken}` },
        body: { key: "notify.tg_chat_id", value: "998877" },
      });
      tgMessages.length = 0;

      // Attacker IP: 5 consecutive wrong passwords -> 401 each, TG alerts capped at 3
      const attackerIp = "203.0.113.77";
      for (let i = 1; i <= 5; i++) {
        const res = await apiJson(env, ctx, "/api/login", {
          method: "POST",
          headers: { "cf-connecting-ip": attackerIp },
          body: { password: `wrong-pass-${i}` },
        });
        assert.equal(res.status, 401, `attempt ${i} should return 401`);
      }
      assert.equal(tgMessages.length, 3, "TG failure alerts must be capped at 3 per window");

      // 6th & 7th attempts (even with correct password) from attacker IP -> 429 and 0 extra TG alerts
      for (const pwd of ["wrong-pass-6", env.AUTH_PASSWORD]) {
        const blocked = await apiJson(env, ctx, "/api/login", {
          method: "POST",
          headers: { "cf-connecting-ip": attackerIp },
          body: { password: pwd },
        });
        assert.equal(blocked.status, 429);
        assert.match(blocked.data.error, /登录尝试过于频繁/);
      }
      assert.equal(tgMessages.length, 3, "rate-limited 429 requests must not trigger TG alerts");

      // Separate IP is unaffected; successful login clears its prior failure bucket
      const userIp = "198.51.100.42";
      for (let i = 0; i < 2; i++) {
        const fail = await apiJson(env, ctx, "/api/login", {
          method: "POST",
          headers: { "cf-connecting-ip": userIp },
          body: { password: "bad" },
        });
        assert.equal(fail.status, 401);
      }
      const freshToken = await loginAndGetToken(env, ctx, userIp);

      // Enable MFA and verify TOTP same-step replay protection with deterministic clock
      let fakeNow = 1764057615000; // 15s into a 30s TOTP step
      t.mock.method(Date, "now", () => fakeNow);

      const gen = await apiJson(env, ctx, "/api/sys/totp/generate", {
        method: "POST",
        headers: { authorization: `Bearer ${freshToken}` },
        body: { account: "admin", issuer: "OCI Helper" },
      });
      assert.equal(gen.status, 200);
      assert.ok(gen.data.secret);

      await apiJson(env, ctx, "/api/sys", {
        method: "PUT",
        headers: { authorization: `Bearer ${freshToken}` },
        body: { key: "mfa.secret", value: gen.data.secret },
      });
      const enableMfa = await apiJson(env, ctx, "/api/sys/mfa", {
        method: "POST",
        headers: { authorization: `Bearer ${freshToken}` },
        body: { enabled: true },
      });
      assert.equal(enableMfa.status, 200);

      const totpRes = await apiJson(env, ctx, "/api/sys/totp", {
        method: "POST",
        headers: { authorization: `Bearer ${freshToken}` },
      });
      assert.equal(totpRes.status, 200);
      const codeWindow1 = totpRes.data.code;
      assert.match(codeWindow1, /^\d{6}$/);

      // First login with valid TOTP in window 1 -> 200 OK
      const mfaLogin1 = await apiJson(env, ctx, "/api/login", {
        method: "POST",
        headers: { "cf-connecting-ip": "198.51.100.88" },
        body: { password: env.AUTH_PASSWORD, code: codeWindow1 },
      });
      assert.equal(mfaLogin1.status, 200);
      assert.ok(mfaLogin1.data.token);

      // Replay exact same TOTP code within the same 30s window -> 401 rejected!
      const replayRes = await apiJson(env, ctx, "/api/login", {
        method: "POST",
        headers: { "cf-connecting-ip": "198.51.100.89" },
        body: { password: env.AUTH_PASSWORD, code: codeWindow1 },
      });
      assert.equal(replayRes.status, 401);
      assert.equal(replayRes.data.needCode, true);
      assert.match(replayRes.data.error, /已使用|下一个验证码/);

      // Advance clock by +30s to next TOTP step -> new code succeeds
      fakeNow += 30_000;
      const totpNext = await apiJson(env, ctx, "/api/sys/totp", {
        method: "POST",
        headers: { authorization: `Bearer ${mfaLogin1.data.token}` },
      });
      assert.equal(totpNext.status, 200);

      const mfaLogin2 = await apiJson(env, ctx, "/api/login", {
        method: "POST",
        headers: { "cf-connecting-ip": "198.51.100.89" },
        body: { password: env.AUTH_PASSWORD, code: totpNext.data.code },
      });
      assert.equal(mfaLogin2.status, 200);
      assert.ok(mfaLogin2.data.token);
      await flush();
    }
  );
});

// ============================================================================
// 3) #8 DELETE /api/sys/:key 防 MFA 锁死与拦截未授权内部/隐藏键删除
// ============================================================================
test("#8 DELETE /api/sys/:key blocks deleting mfa.secret while MFA is enabled and rejects hidden/internal keys", async () => {
  const db = createMemoryD1();
  const env = createTestEnv(db);
  const { ctx } = createExecCtx();
  const token = await loginAndGetToken(env, ctx);
  const authHeader = { authorization: `Bearer ${token}` };

  // Seed secret + enable MFA
  await apiJson(env, ctx, "/api/sys", {
    method: "PUT",
    headers: authHeader,
    body: { key: "mfa.secret", value: "JBSWY3DPEHPK3PXP" },
  });
  await apiJson(env, ctx, "/api/sys/mfa", {
    method: "POST",
    headers: authHeader,
    body: { enabled: true },
  });

  // Attempting to delete mfa.secret while mfa.enabled === "1" -> 400 anti-lockout
  const blockedDel = await apiJson(env, ctx, "/api/sys/mfa.secret", {
    method: "DELETE",
    headers: authHeader,
  });
  assert.equal(blockedDel.status, 400);
  assert.match(blockedDel.data.error, /先关闭登录二次验证/);
  assert.equal(db.sysCfg.has("mfa.secret"), true);

  // Attempting to delete hidden SYS_DEFS keys or internal auth/state keys -> 400 rejected
  db.sysCfg.set("auth.password_hash", {
    key: "auth.password_hash",
    value: "keep-hash",
    updated_at: "2026-11-25T00:00:00.000Z",
  });
  for (const forbiddenKey of [
    "mfa.enabled",
    "notify.channel_enabled",
    "google.enabled",
    "tg.webhook_secret",
    "auth.password_hash",
    "auth.session_version",
    "mfa.last_step",
    "unknown.custom_key",
  ]) {
    const res = await apiJson(env, ctx, `/api/sys/${encodeURIComponent(forbiddenKey)}`, {
      method: "DELETE",
      headers: authHeader,
    });
    assert.equal(res.status, 400, `key ${forbiddenKey} must be rejected by DELETE /api/sys/:key`);
    assert.match(res.data.error, /不支持删除该配置项/);
  }
  assert.equal(db.sysCfg.get("auth.password_hash")?.value, "keep-hash");
  assert.equal(db.sysCfg.get("mfa.enabled")?.value, "1");

  // After disabling MFA, deleting mfa.secret succeeds cleanly
  const disableMfa = await apiJson(env, ctx, "/api/sys/mfa", {
    method: "POST",
    headers: authHeader,
    body: { enabled: false },
  });
  assert.equal(disableMfa.status, 200);

  const okDel = await apiJson(env, ctx, "/api/sys/mfa.secret", {
    method: "DELETE",
    headers: authHeader,
  });
  assert.equal(okDel.status, 200);
  assert.deepEqual(okDel.data, { ok: true });
  assert.equal(db.sysCfg.has("mfa.secret"), false);
});

// ============================================================================
// 4) #3 & #10 默认关闭第三方广播 + runTaskOnce 先落库 success_count 再隔离通知
// ============================================================================
test("#3 & #10 launch broadcasts are off by default, opt-in works, and runTaskOnce persists success_count before notification errors/timeouts", async () => {
  const db = createMemoryD1();
  const env = createTestEnv(db);
  const { ctx } = createExecCtx();
  const token = await loginAndGetToken(env, ctx);
  const authHeader = { authorization: `Bearer ${token}` };

  // Verify GET /api/sys reports channelEnabled: false by default
  const sysInit = await apiJson(env, ctx, "/api/sys", { headers: authHeader });
  assert.equal(sysInit.status, 200);
  assert.equal(sysInit.data.channelEnabled, false);

  const cfg = await seedOciConfig(env, ctx, token);

  // Configure TG so notifyLaunchSuccess exercises outbound notification path
  await apiJson(env, ctx, "/api/sys", {
    method: "PUT",
    headers: authHeader,
    body: { key: "notify.tg_bot_token", value: "999888:SECRET_BOT_TOK" },
  });
  await apiJson(env, ctx, "/api/sys", {
    method: "PUT",
    headers: authHeader,
    body: { key: "notify.tg_chat_id", value: "10001" },
  });

  const externalCalls = [];
  let launchAttempt = 0;
  let throwOnNotify = false;
  let failSecondLaunchWithLimit = false;
  let observedDbSuccessDuringNotify = null;
  let activeTaskId = "";

  const mockOciAndBroadcastFetch = async (input, init) => {
    const urlStr = typeof input === "string" ? input : input.url;
    const method = (init?.method || input?.method || "GET").toUpperCase();
    const u = new URL(urlStr);

    if (u.hostname === "backend.oci-helper.de5.net" || u.hostname === "api.telegram.org") {
      externalCalls.push({ url: urlStr, host: u.hostname, pathname: u.pathname, signal: init?.signal });
      if (activeTaskId && observedDbSuccessDuringNotify === null) {
        observedDbSuccessDuringNotify = db.tasks.get(activeTaskId)?.success_count ?? "deleted";
      }
      if (throwOnNotify) {
        const timeoutErr = new Error(
          `Timeout calling https://api.telegram.org/bot999888:SECRET_BOT_TOK/sendMessage`
        );
        timeoutErr.name = "TimeoutError";
        throw timeoutErr;
      }
      return jsonResponse({ ok: true, result: { message_id: 1 } });
    }

    if (u.hostname.endsWith(".oraclecloud.com")) {
      if (u.pathname.endsWith("/images") && method === "GET") {
        return jsonResponse([
          {
            id: "ocid1.image.oc1.ap-singapore-1.ubuntu2204",
            displayName: "Canonical-Ubuntu-22.04",
            lifecycleState: "AVAILABLE",
          },
        ]);
      }
      if (u.pathname.endsWith("/subnets") && method === "GET") {
        return jsonResponse([
          {
            id: "ocid1.subnet.oc1.ap-singapore-1.sub1",
            displayName: "public-subnet",
            cidrBlock: "10.0.0.0/24",
            vcnId: "ocid1.vcn.oc1.ap-singapore-1.vcn1",
            lifecycleState: "AVAILABLE",
            prohibitInternetIngress: false,
          },
        ]);
      }
      if (u.pathname.endsWith("/vcns") && method === "GET") {
        return jsonResponse([
          {
            id: "ocid1.vcn.oc1.ap-singapore-1.vcn1",
            displayName: "main-vcn",
            lifecycleState: "AVAILABLE",
          },
        ]);
      }
      if (u.pathname.endsWith("/instances") && method === "POST") {
        launchAttempt++;
        if (failSecondLaunchWithLimit && launchAttempt === 2) {
          return jsonResponse(
            { code: "LimitExceeded", message: "LimitExceeded: Service limit exceeded" },
            400
          );
        }
        return jsonResponse({
          id: `ocid1.instance.oc1.ap-singapore-1.inst${launchAttempt}`,
          displayName: `instance-${launchAttempt}`,
          lifecycleState: "PROVISIONING",
        });
      }
    }
    return jsonResponse({});
  };

  await withMockFetch(mockOciAndBroadcastFetch, async () => {
    // 4a. Default config: launch 1 instance -> ZERO calls to backend.oci-helper.de5.net; task completed & deleted
    const taskId1 = "task_default_no_broadcast";
    activeTaskId = taskId1;
    db.tasks.set(taskId1, {
      id: taskId1,
      cfg_id: cfg.id,
      type: "launch",
      name: "ARM-1",
      status: "running",
      region: "ap-singapore-1",
      availability_domain: "kIdk:AP-SINGAPORE-1-AD-1",
      compartment_id: cfg.compartmentId,
      shape: "VM.Standard.A1.Flex",
      ocpus: 1,
      memory_gb: 6,
      boot_volume_gb: 50,
      os_name: "Canonical Ubuntu 22.04",
      os_version: "22.04",
      subnet_id: "ocid1.subnet.oc1.ap-singapore-1.sub1",
      ssh_public_key: TEST_SSH_PUBKEY,
      target_count: 1,
      success_count: 0,
      attempt_count: 0,
      interval_sec: 60,
      capacity_check: 1,
      next_run_at: 0,
      locked_until: null,
      created_at: "2026-11-25T00:00:00.000Z",
      updated_at: "2026-11-25T00:00:00.000Z",
    });

    const run1 = await apiJson(env, ctx, `/api/tasks/${taskId1}/run`, {
      method: "POST",
      headers: authHeader,
    });
    assert.equal(run1.status, 200);
    assert.equal(run1.data.ok, true);
    assert.equal(run1.data.launched, 1);
    assert.equal(
      externalCalls.some((c) => c.host === "backend.oci-helper.de5.net"),
      false,
      "must NOT contact backend.oci-helper.de5.net when boot_token and channel_enabled are unset"
    );
    assert.equal(
      observedDbSuccessDuringNotify,
      "deleted",
      "completed target_count=1 task must already be deleted in D1 before notification fires"
    );

    // 4b. Opt-in boot_token + channel_enabled="1", AND notification throws/times out + 2nd round hits LimitExceeded:
    //     success_count=1 from 1st round MUST already be persisted in D1 and preserved!
    await apiJson(env, ctx, "/api/sys", {
      method: "PUT",
      headers: authHeader,
      body: { key: "notify.boot_token", value: "boot-panel-tok-xyz" },
    });
    await apiJson(env, ctx, "/api/sys/notify-channel", {
      method: "POST",
      headers: authHeader,
      body: { enabled: true },
    });

    externalCalls.length = 0;
    launchAttempt = 0;
    throwOnNotify = true;
    failSecondLaunchWithLimit = true;
    observedDbSuccessDuringNotify = null;

    const taskId2 = "task_persist_before_notify_fail";
    activeTaskId = taskId2;
    db.tasks.set(taskId2, {
      id: taskId2,
      cfg_id: cfg.id,
      type: "launch",
      name: "ARM-2",
      status: "running",
      region: "ap-singapore-1",
      availability_domain: "kIdk:AP-SINGAPORE-1-AD-1",
      compartment_id: cfg.compartmentId,
      shape: "VM.Standard.A1.Flex",
      ocpus: 2,
      memory_gb: 12,
      boot_volume_gb: 50,
      os_name: "Canonical Ubuntu 22.04",
      os_version: "22.04",
      subnet_id: "ocid1.subnet.oc1.ap-singapore-1.sub1",
      ssh_public_key: TEST_SSH_PUBKEY,
      target_count: 2,
      success_count: 0,
      attempt_count: 0,
      interval_sec: 60,
      capacity_check: 1,
      next_run_at: 0,
      locked_until: null,
      created_at: "2026-11-25T00:00:00.000Z",
      updated_at: "2026-11-25T00:00:00.000Z",
    });

    const run2 = await apiJson(env, ctx, `/api/tasks/${taskId2}/run`, {
      method: "POST",
      headers: authHeader,
    });
    assert.equal(run2.status, 200);
    assert.equal(run2.data.launched, 1);
    assert.equal(
      observedDbSuccessDuringNotify,
      1,
      "success_count must be persisted in D1 BEFORE outbound notifications execute"
    );

    // Verify both opt-in broadcast endpoints were called with AbortSignal timeouts
    const bootCall = externalCalls.find((c) => c.pathname === "/api/boot");
    const chanCall = externalCalls.find((c) => c.pathname === "/api/notify");
    assert.ok(bootCall, "expected /api/boot call when notify.boot_token is configured");
    assert.ok(bootCall.signal instanceof AbortSignal, "bootBroadcast must pass AbortSignal.timeout");
    assert.ok(chanCall, "expected /api/notify call when notify.channel_enabled === '1'");
    assert.ok(chanCall.signal instanceof AbortSignal, "channelBroadcast must pass AbortSignal.timeout");

    // Verify D1 task row kept success_count === 1 and unlocked locked_until despite notify timeout & round-2 LimitExceeded
    const savedTask2 = db.tasks.get(taskId2);
    assert.ok(savedTask2);
    assert.equal(savedTask2.success_count, 1, "persisted success_count must survive notify throw & round-2 limit failure");
    assert.equal(savedTask2.status, "failed");
    assert.equal(savedTask2.locked_until, null);

    // Also verify sendTelegram redacts bot token on error via /api/sys/notify-test
    const notifyTestRes = await apiJson(env, ctx, "/api/sys/notify-test", {
      method: "POST",
      headers: authHeader,
      body: { text: "ping" },
    });
    assert.equal(notifyTestRes.status, 400);
    assert.match(notifyTestRes.data.error, /\/bot\*\*\*\//);
    assert.equal(notifyTestRes.data.error.includes("SECRET_BOT_TOK"), false);
  });
});

// ============================================================================
// 5) #4 runIpTaskOnce 互斥锁、持续换 IP 保留任务递增计数、以及 8 次未命中保留新 IP
// ============================================================================
test("#4 runIpTaskOnce enforces locked_until mutex, keeps task & increments attempt_count/last_ip, and preserves 8th public IP on CIDR miss", async () => {
  const db = createMemoryD1();
  const env = createTestEnv(db);
  const { ctx } = createExecCtx();
  const token = await loginAndGetToken(env, ctx);
  const authHeader = { authorization: `Bearer ${token}` };
  const cfg = await seedOciConfig(env, ctx, token);

  let currentPublicIp = { id: "pub_initial", ipAddress: "129.150.1.10" };
  let createdCount = 0;
  const deletedPublicIpIds = [];
  let releaseVnicGate = null;

  const mockIpFetch = async (input, init) => {
    const urlStr = typeof input === "string" ? input : input.url;
    const method = (init?.method || input?.method || "GET").toUpperCase();
    const u = new URL(urlStr);

    if (!u.hostname.endsWith(".oraclecloud.com")) return jsonResponse({});

    if (u.pathname.endsWith("/vnicAttachments") && method === "GET") {
      if (releaseVnicGate) await releaseVnicGate;
      return jsonResponse([
        {
          id: "va_1",
          instanceId: "ocid1.instance.oc1.ap-singapore-1.inst_ip",
          vnicId: "ocid1.vnic.oc1.ap-singapore-1.vnic_ip",
          lifecycleState: "ATTACHED",
        },
      ]);
    }
    if (u.pathname.includes("/vnics/") && method === "GET") {
      return jsonResponse({
        id: "ocid1.vnic.oc1.ap-singapore-1.vnic_ip",
        displayName: "primary-vnic",
        isPrimary: true,
        privateIp: "10.0.0.5",
      });
    }
    if (u.pathname.endsWith("/privateIps") && method === "GET") {
      return jsonResponse([
        { id: "ocid1.privateip.oc1.ap-singapore-1.priv_1", ipAddress: "10.0.0.5", isPrimary: true },
      ]);
    }
    if (u.pathname.endsWith("/publicIps/actions/getByPrivateIpId") && method === "POST") {
      if (!currentPublicIp) {
        return jsonResponse({ code: "NotAuthorizedOrNotFound", message: "No public IP" }, 404);
      }
      return jsonResponse(currentPublicIp);
    }
    if (u.pathname.includes("/publicIps/") && method === "DELETE") {
      const pubId = decodeURIComponent(u.pathname.split("/").pop());
      deletedPublicIpIds.push(pubId);
      if (currentPublicIp?.id === pubId) currentPublicIp = null;
      return new Response("", { status: 204 });
    }
    if (u.pathname.endsWith("/publicIps") && method === "POST") {
      createdCount++;
      currentPublicIp = {
        id: `pub_new_${createdCount}`,
        ipAddress: `140.238.10.${createdCount}`,
      };
      return jsonResponse(currentPublicIp);
    }
    if (u.pathname.includes("/instances/") && method === "GET") {
      return jsonResponse({
        id: "ocid1.instance.oc1.ap-singapore-1.inst_ip",
        displayName: "ip-worker-vm",
        lifecycleState: "RUNNING",
      });
    }
    return jsonResponse({});
  };

  await withMockFetch(mockIpFetch, async () => {
    const ipTaskId = "ipt_mutex_and_keep";
    db.tasks.set(ipTaskId, {
      id: ipTaskId,
      cfg_id: cfg.id,
      type: "ip",
      instance_id: "ocid1.instance.oc1.ap-singapore-1.inst_ip",
      instance_name: "ip-worker-vm",
      region: "ap-singapore-1",
      ip_version: "ipv4",
      cidr_list: null,
      interval_sec: 120,
      status: "running",
      attempt_count: 0,
      last_ip: null,
      last_error: "previous transient error",
      next_run_at: 0,
      locked_until: null,
      created_at: "2026-11-25T00:00:00.000Z",
      updated_at: "2026-11-25T00:00:00.000Z",
    });

    // 5a. Concurrent runIpTaskOnce: first acquires locked_until, second returns "任务正在执行中"
    let unblockFirst;
    releaseVnicGate = new Promise((r) => {
      unblockFirst = r;
    });

    const p1 = apiJson(env, ctx, `/api/ip-tasks/${ipTaskId}/run`, {
      method: "POST",
      headers: authHeader,
    });
    // Allow p1 to acquire D1 lock and suspend on releaseVnicGate
    await new Promise((r) => setTimeout(r, 15));

    const p2 = await apiJson(env, ctx, `/api/ip-tasks/${ipTaskId}/run`, {
      method: "POST",
      headers: authHeader,
    });
    assert.equal(p2.status, 200);
    assert.equal(p2.data.ok, false);
    assert.match(p2.data.message, /正在执行中/);

    releaseVnicGate = null;
    unblockFirst();
    const res1 = await p1;
    assert.equal(res1.status, 200);
    assert.equal(res1.data.ok, true);
    assert.equal(res1.data.ip, "140.238.10.1");

    // 5b. Task is NOT deleted after success; attempt_count incremented, last_ip updated, locked_until cleared
    const afterRun1 = db.tasks.get(ipTaskId);
    assert.ok(afterRun1, "IP task must remain in D1 after successful IP rotation");
    assert.equal(afterRun1.status, "running");
    assert.equal(afterRun1.attempt_count, 1);
    assert.equal(afterRun1.last_ip, "140.238.10.1");
    assert.equal(afterRun1.last_error, null);
    assert.equal(afterRun1.locked_until, null);
    assert.ok(afterRun1.next_run_at > Date.now() + 60_000);

    // Run a second time -> attempt_count becomes 2, last_ip becomes 140.238.10.2, GET /api/ip-tasks exposes changeCount
    const res2 = await apiJson(env, ctx, `/api/ip-tasks/${ipTaskId}/run`, {
      method: "POST",
      headers: authHeader,
    });
    assert.equal(res2.data.ok, true);
    assert.equal(res2.data.ip, "140.238.10.2");
    assert.equal(db.tasks.get(ipTaskId)?.attempt_count, 2);

    const listRes = await apiJson(env, ctx, "/api/ip-tasks", { headers: authHeader });
    assert.equal(listRes.status, 200);
    assert.equal(listRes.data.items[0]?.changeCount, 2);
    assert.equal(listRes.data.items[0]?.lastIp, "140.238.10.2");

    // 5c. changePublicIp with unmatched target CIDR: retries 8 times, deletes attempts 1..7, KEEPS 8th IP!
    createdCount = 0;
    deletedPublicIpIds.length = 0;
    currentPublicIp = { id: "pub_before_cidr", ipAddress: "129.150.9.9" };

    const missRes = await apiJson(
      env,
      ctx,
      `/api/cfgs/${cfg.id}/instances/ocid1.instance.oc1.ap-singapore-1.inst_ip/change-ip`,
      {
        method: "POST",
        headers: authHeader,
        body: { cidrList: ["152.67.0.0/16"] },
      }
    );
    assert.equal(missRes.status, 400);
    assert.match(missRes.data.error, /重试 8 次仍未命中目标网段/);
    assert.match(missRes.data.error, /140\.238\.10\.8/);

    assert.equal(createdCount, 8, "must attempt 8 ephemeral public IP creations");
    assert.deepEqual(
      deletedPublicIpIds,
      [
        "pub_before_cidr",
        "pub_new_1",
        "pub_new_2",
        "pub_new_3",
        "pub_new_4",
        "pub_new_5",
        "pub_new_6",
        "pub_new_7",
      ],
      "must delete initial + attempts 1..7 ONLY and NEVER delete pub_new_8"
    );
    assert.deepEqual(currentPublicIp, {
      id: "pub_new_8",
      ipAddress: "140.238.10.8",
    });
  });
});

// ============================================================================
// 6) #2 & #11 多区域与子区间参数在前后端全链路透传 + LogHub 批量推送与流量优化
// ============================================================================
function loadFrontendApiClient(customFetch, bearerToken) {
  const src = fs.readFileSync("web-dist/assets/index-DwZEqr4A.js", "utf8");
  const startIdx = src.indexOf("async function q(e,t={}){");
  const routerMarker = ",jl=Ad({";
  const endIdx = src.indexOf(routerMarker, startIdx);
  assert.ok(startIdx !== -1 && endIdx > startIdx, "failed to locate q()..jd block in index-DwZEqr4A.js");
  const snippet = src.slice(startIdx, endIdx);

  const storage = new Map([["oci_token", bearerToken]]);
  const fakeLocalStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  };
  const fakeLocation = { pathname: "/cfgs", replace() {} };
  const factory = new Function(
    "fetch",
    "localStorage",
    "location",
    "FormData",
    `const qn="oci_token"; const Td=()=>localStorage.removeItem(qn); ${snippet};\nreturn jd;`
  );
  return factory(customFetch, fakeLocalStorage, fakeLocation, FormData);
}

test("#2 & #11 region and compartment query params propagate end-to-end from frontend jd client through Worker routes to OCI SDK, and LogHub batches HTTP traces", async () => {
  const db = createMemoryD1();
  const logHubRequests = [];
  const realLogHub = new LogHub({});
  const mockLogHubNamespace = {
    idFromName(name) {
      return { name };
    },
    get() {
      return {
        async fetch(input, init) {
          const req =
            input instanceof Request
              ? input
              : new Request(input, init);
          logHubRequests.push({
            url: req.url,
            body: await req.clone().json().catch(() => null),
          });
          return realLogHub.fetch(req);
        },
      };
    },
  };

  const env = createTestEnv(db, { LOG_HUB: mockLogHubNamespace });
  const { ctx } = createExecCtx();
  const token = await loginAndGetToken(env, ctx);
  const cfg = await seedOciConfig(env, ctx, token, {
    region: "ap-singapore-1",
    compartmentId: "ocid1.compartment.oc1..defaultcomp",
  });

  await apiJson(env, ctx, "/api/sys", {
    method: "PUT",
    headers: { authorization: `Bearer ${token}` },
    body: { key: "notify.tg_bot_token", value: "123:TOK" },
  });
  await apiJson(env, ctx, "/api/sys", {
    method: "PUT",
    headers: { authorization: `Bearer ${token}` },
    body: { key: "notify.tg_chat_id", value: "10001" },
  });
  await apiJson(env, ctx, "/api/sys", {
    method: "PUT",
    headers: { authorization: `Bearer ${token}` },
    body: { key: "dns.cf_token", value: "cf-tok-123" },
  });

  const ociCalls = [];
  const tgTexts = [];
  const TARGET_REGION = "ap-tokyo-1";
  const TARGET_COMP = "ocid1.compartment.oc1..subcompartment88";

  await withMockFetch(
    async (input, init) => {
      const urlStr = typeof input === "string" ? input : input.url;
      const method = (init?.method || input?.method || "GET").toUpperCase();
      const u = new URL(urlStr);

      if (u.hostname === "api.telegram.org") {
        const b = JSON.parse(init?.body || "{}");
        tgTexts.push(b.text || "");
        return jsonResponse({ ok: true, result: { message_id: 1 } });
      }
      if (u.hostname === "api.cloudflare.com") {
        if (method === "GET" && u.pathname.endsWith("/dns_records")) {
          return jsonResponse({ success: true, result: [] });
        }
        return jsonResponse({ success: true, result: { id: "rec_1" } });
      }
      if (u.hostname.endsWith(".oraclecloud.com")) {
        const rawBody = init?.body
          ? String(init.body)
          : input instanceof Request
            ? await input.clone().text().catch(() => "")
            : "";
        ociCalls.push({
          method,
          host: u.hostname,
          pathname: u.pathname,
          searchParams: Object.fromEntries(u.searchParams.entries()),
          body: rawBody ? JSON.parse(rawBody) : null,
        });

        if (u.pathname.endsWith("/vnicAttachments")) {
          return jsonResponse([{ id: "va1", instanceId: "inst1", vnicId: "vnic1", lifecycleState: "ATTACHED" }]);
        }
        if (u.pathname.includes("/vnics/")) {
          return jsonResponse({
            id: "vnic1",
            displayName: "vnic-tokyo",
            publicIp: "138.2.10.20",
            privateIp: "10.0.0.8",
            isPrimary: true,
            ipv6Addresses: ["2603:c020:1::2"],
          });
        }
        if (u.pathname.endsWith("/privateIps")) {
          return jsonResponse([{ id: "priv1", ipAddress: "10.0.0.8", isPrimary: true }]);
        }
        if (u.pathname.endsWith("/publicIps/actions/getByPrivateIpId")) {
          return jsonResponse({ code: "NotAuthorizedOrNotFound", message: "none" }, 404);
        }
        if (u.pathname.endsWith("/publicIps") && method === "POST") {
          return jsonResponse({ id: "pub_tokyo", ipAddress: "138.2.99.88" });
        }
        if ((u.pathname.endsWith("/ipv6s") || u.pathname.endsWith("/ipv6")) && method === "GET") {
          return jsonResponse([]);
        }
        if ((u.pathname.endsWith("/ipv6s") || u.pathname.endsWith("/ipv6")) && method === "POST") {
          return jsonResponse({ id: "ipv6_1", ipAddress: "2603:c020:1::99" });
        }
        if (u.pathname.includes("/instances/") && method === "GET") {
          return jsonResponse({
            id: "inst1",
            displayName: "tokyo-vm",
            shape: "VM.Standard.A1.Flex",
            lifecycleState: "STOPPED",
            availabilityDomain: "AD-1",
            shapeConfig: { ocpus: 1, memoryInGBs: 6 },
          });
        }
        if (u.pathname.endsWith("/instances") && method === "GET") {
          return jsonResponse([
            { id: "inst1", displayName: "tokyo-vm", lifecycleState: "RUNNING" },
          ]);
        }
        if (u.pathname.endsWith("/bootVolumeAttachments")) {
          return jsonResponse([]);
        }
        if (u.pathname.includes("/securityLists/") && method === "GET") {
          return jsonResponse({
            id: "sl1",
            displayName: "tokyo-sl",
            vcnId: "vcn1",
            ingressSecurityRules: [
              {
                protocol: "6",
                source: "0.0.0.0/0",
                tcpOptions: { destinationPortRange: { min: 22, max: 22 } },
              },
            ],
            egressSecurityRules: [],
          });
        }
        if (u.pathname.includes("/securityLists/") && method === "PUT") {
          return jsonResponse({ id: "sl1", ingressSecurityRules: [], egressSecurityRules: [] });
        }
        if (u.pathname.includes("/summarizeMetricsData") && method === "POST") {
          return jsonResponse([
            {
              aggregatedDatapoints: [
                { timestamp: "2026-11-25T01:00:00.000Z", value: 1024 },
              ],
            },
          ]);
        }
        return jsonResponse({ id: "ok" });
      }
      return jsonResponse({});
    },
    async () => {
      const seenFrontendUrls = [];
      const jd = loadFrontendApiClient(async (relUrl, init) => {
        seenFrontendUrls.push({ url: relUrl, method: init?.method || "GET" });
        return worker.fetch(new Request(`https://panel.example.com${relUrl}`, init), env, ctx);
      }, token);

      const assertLastOciScope = (label, { expectCompInQuery = false, expectCompInBody = false } = {}) => {
        assert.ok(ociCalls.length > 0, `${label}: expected OCI SDK HTTP call`);
        for (const call of ociCalls) {
          assert.ok(
            call.host.includes(TARGET_REGION),
            `${label}: expected OCI host to target ${TARGET_REGION}, got ${call.host}`
          );
        }
        if (expectCompInQuery) {
          assert.ok(
            ociCalls.some((c) => c.searchParams.compartmentId === TARGET_COMP),
            `${label}: expected compartmentId=${TARGET_COMP} in OCI query`
          );
        }
        if (expectCompInBody) {
          assert.ok(
            ociCalls.some((c) => c.body?.compartmentId === TARGET_COMP),
            `${label}: expected compartmentId=${TARGET_COMP} in OCI request body`
          );
        }
      };

      // 6a. Instance operations via real jd client -> real Worker routes -> OCI SDK
      ociCalls.length = 0;
      logHubRequests.length = 0;
      await jd.instanceDetail(cfg.id, "inst1", TARGET_REGION, TARGET_COMP);
      assertLastOciScope("instanceDetail", { expectCompInQuery: true });
      // Verify #11: multiple OCI calls inside instanceDetail produce exactly ONE /publish-batch request to LogHub
      assert.ok(ociCalls.length >= 2, "instanceDetail makes multiple OCI subrequests");
      assert.equal(logHubRequests.length, 1, "traceFor must flush all OCI logs in 1 /publish-batch call");
      assert.ok(logHubRequests[0].url.endsWith("/publish-batch"));
      assert.equal(logHubRequests[0].body.entries.length, ociCalls.length);
      assert.equal(realLogHub.buffer.length, ociCalls.length);

      ociCalls.length = 0;
      await jd.instanceAction(cfg.id, "inst1", "STOP", TARGET_REGION, TARGET_COMP);
      assertLastOciScope("instanceAction");

      ociCalls.length = 0;
      await jd.terminateInstance(cfg.id, "inst1", true, TARGET_REGION, TARGET_COMP);
      assertLastOciScope("terminateInstance");
      assert.equal(ociCalls[0].searchParams.preserveBootVolume, "true");

      ociCalls.length = 0;
      tgTexts.length = 0;
      await jd.changeIp(cfg.id, "inst1", [], undefined, TARGET_REGION, TARGET_COMP);
      assertLastOciScope("changeIp", { expectCompInQuery: true, expectCompInBody: true });
      assert.match(tgTexts[0] || "", /ap-tokyo-1/, "change-ip notification must report overridden region");

      ociCalls.length = 0;
      await jd.changeIpv6(cfg.id, "inst1", undefined, TARGET_REGION, TARGET_COMP);
      assertLastOciScope("changeIpv6", { expectCompInQuery: true });

      ociCalls.length = 0;
      await jd.toggleIpv6(cfg.id, "inst1", true, TARGET_REGION, TARGET_COMP);
      assertLastOciScope("toggleIpv6", { expectCompInQuery: true });

      ociCalls.length = 0;
      await jd.updateSpec(cfg.id, "inst1", { ocpus: 2, memoryGb: 12 }, TARGET_REGION, TARGET_COMP);
      assertLastOciScope("updateSpec");

      ociCalls.length = 0;
      await jd.syncDns(
        cfg.id,
        "inst1",
        { record: "vm.example.com", zoneId: "zone_1", proxied: false },
        TARGET_REGION,
        TARGET_COMP
      );
      assertLastOciScope("syncDns", { expectCompInQuery: true });

      // Direct check on GET /api/cfgs/:id/instance-ips/:iid
      ociCalls.length = 0;
      const ipsRes = await apiJson(
        env,
        ctx,
        `/api/cfgs/${cfg.id}/instance-ips/inst1?region=${TARGET_REGION}&compartment=${TARGET_COMP}`,
        { headers: { authorization: `Bearer ${token}` } }
      );
      assert.equal(ipsRes.status, 200);
      assertLastOciScope("instance-ips", { expectCompInQuery: true });

      // 6b. Boot volume routes
      ociCalls.length = 0;
      await jd.updateBootVolume(cfg.id, "bv1", { sizeInGBs: 60, vpusPerGB: 20 }, TARGET_REGION, TARGET_COMP);
      assertLastOciScope("updateBootVolume");

      ociCalls.length = 0;
      await jd.deleteBootVolume(cfg.id, "bv1", TARGET_REGION, TARGET_COMP);
      assertLastOciScope("deleteBootVolume");

      // 6c. Network & security list routes
      ociCalls.length = 0;
      await jd.securityList(cfg.id, "sl1", TARGET_REGION, TARGET_COMP);
      assertLastOciScope("securityList");

      ociCalls.length = 0;
      await jd.addSecurityRule(
        cfg.id,
        "sl1",
        { direction: "ingress", protocol: "6", portMin: 443, portMax: 443, source: "0.0.0.0/0" },
        TARGET_REGION,
        TARGET_COMP
      );
      assertLastOciScope("addSecurityRule");

      ociCalls.length = 0;
      await jd.removeSecurityRule(cfg.id, "sl1", "ingress", 0, TARGET_REGION, TARGET_COMP);
      assertLastOciScope("removeSecurityRule");

      ociCalls.length = 0;
      await jd.deleteSubnet(cfg.id, "sub1", TARGET_REGION, TARGET_COMP);
      assertLastOciScope("deleteSubnet");

      ociCalls.length = 0;
      await jd.deleteVcn(cfg.id, "vcn1", TARGET_REGION, TARGET_COMP);
      assertLastOciScope("deleteVcn");

      // 6d. Traffic routes (compartment query + body.region) & #11 no redundant bootVolume calls
      ociCalls.length = 0;
      await jd.trafficData(
        cfg.id,
        {
          region: TARGET_REGION,
          vnicId: "vnic1",
          interval: "60m",
          start: "2026-11-25T00:00:00.000Z",
          end: "2026-11-25T02:00:00.000Z",
        },
        TARGET_COMP
      );
      assertLastOciScope("trafficData", { expectCompInQuery: true });

      ociCalls.length = 0;
      const summary = await jd.trafficSummary(
        cfg.id,
        { region: TARGET_REGION, year: 2026, month: 11 },
        TARGET_COMP
      );
      assert.equal(summary.instanceCount, 1);
      assertLastOciScope("trafficSummary", { expectCompInQuery: true });
      assert.equal(
        ociCalls.some((c) => c.pathname.includes("bootVolume")),
        false,
        "getMonthlyTraffic must not call listBootVolumes / listInstances wrapper"
      );

      assert.equal(seenFrontendUrls.length, 17, "all 17 updated jd methods were exercised");
      for (const item of seenFrontendUrls) {
        assert.match(item.url, /compartment=ocid1\.compartment\.oc1\.\.subcompartment88/);
      }
    }
  );
});

// ============================================================================
// 7) #9 安全规则添加 ICMP type=8, code=0 保留 0 值，且不同 type/code 正常共存
// ============================================================================
test("#9 security list rules preserve ICMP 0 values (type=8/code=0, type=0/code=0) and deduplicate by type:code", async () => {
  const db = createMemoryD1();
  const env = createTestEnv(db);
  const { ctx } = createExecCtx();
  const token = await loginAndGetToken(env, ctx);
  const authHeader = { authorization: `Bearer ${token}` };
  const cfg = await seedOciConfig(env, ctx, token);

  let storedIngressRules = [];

  await withMockFetch(
    async (input, init) => {
      const urlStr = typeof input === "string" ? input : input.url;
      const method = (init?.method || input?.method || "GET").toUpperCase();
      const u = new URL(urlStr);

      if (u.hostname.endsWith(".oraclecloud.com") && u.pathname.includes("/securityLists/")) {
        if (method === "GET") {
          return jsonResponse({
            id: "sl_icmp",
            displayName: "icmp-sl",
            vcnId: "vcn_1",
            ingressSecurityRules: storedIngressRules,
            egressSecurityRules: [],
          });
        }
        if (method === "PUT") {
          const raw = init?.body
            ? String(init.body)
            : input instanceof Request
              ? await input.clone().text()
              : "{}";
          const parsed = JSON.parse(raw);
          storedIngressRules = parsed.ingressSecurityRules ?? [];
          return jsonResponse({
            id: "sl_icmp",
            displayName: "icmp-sl",
            vcnId: "vcn_1",
            ingressSecurityRules: storedIngressRules,
            egressSecurityRules: parsed.egressSecurityRules ?? [],
          });
        }
      }
      return jsonResponse({});
    },
    async () => {
      // 7a. Add ICMP Echo Request (type=8, code=0) -> code MUST remain 0 (not fallback to 4!)
      const addEchoReq = await apiJson(env, ctx, `/api/cfgs/${cfg.id}/security-lists/sl_icmp/rules`, {
        method: "POST",
        headers: authHeader,
        body: {
          direction: "ingress",
          protocol: "1",
          icmpType: 8,
          icmpCode: 0,
          source: "0.0.0.0/0",
          description: "ping request",
        },
      });
      assert.equal(addEchoReq.status, 200);
      assert.deepEqual(addEchoReq.data, { added: true });
      assert.equal(storedIngressRules.length, 1);
      assert.deepEqual(storedIngressRules[0].icmpOptions, { type: 8, code: 0 });

      // 7b. Adding duplicate ICMP (type=8, code=0) on same CIDR -> { added: false }
      const dupEchoReq = await apiJson(env, ctx, `/api/cfgs/${cfg.id}/security-lists/sl_icmp/rules`, {
        method: "POST",
        headers: authHeader,
        body: {
          direction: "ingress",
          protocol: "1",
          icmpType: 8,
          icmpCode: 0,
          source: "0.0.0.0/0",
        },
      });
      assert.equal(dupEchoReq.status, 200);
      assert.deepEqual(dupEchoReq.data, { added: false });
      assert.equal(storedIngressRules.length, 1);

      // 7c. Add Path MTU Discovery (type=3, code=4) AND Echo Reply (type="0", code="0") on same source CIDR -> both coexist!
      const addPmtu = await apiJson(env, ctx, `/api/cfgs/${cfg.id}/security-lists/sl_icmp/rules`, {
        method: "POST",
        headers: authHeader,
        body: {
          direction: "ingress",
          protocol: "1",
          icmpType: 3,
          icmpCode: 4,
          source: "0.0.0.0/0",
          description: "pmtu",
        },
      });
      assert.equal(addPmtu.status, 200);
      assert.deepEqual(addPmtu.data, { added: true });

      const addEchoReply = await apiJson(env, ctx, `/api/cfgs/${cfg.id}/security-lists/sl_icmp/rules`, {
        method: "POST",
        headers: authHeader,
        body: {
          direction: "ingress",
          protocol: "1",
          icmpType: "0",
          icmpCode: "0",
          source: "0.0.0.0/0",
          description: "echo reply",
        },
      });
      assert.equal(addEchoReply.status, 200);
      assert.deepEqual(addEchoReply.data, { added: true });
      assert.equal(storedIngressRules.length, 3);
      assert.deepEqual(
        storedIngressRules.map((r) => r.icmpOptions),
        [
          { type: 8, code: 0 },
          { type: 3, code: 4 },
          { type: 0, code: 0 },
        ]
      );

      // Verify GET detail renders 8/0, 3/4, 0/0 accurately
      const detail = await apiJson(env, ctx, `/api/cfgs/${cfg.id}/security-lists/sl_icmp`, {
        headers: authHeader,
      });
      assert.equal(detail.status, 200);
      assert.deepEqual(
        detail.data.item.ingress.map((r) => r.icmp),
        ["8/0", "3/4", "0/0"]
      );
    }
  );
});

// ============================================================================
// 8) #7 TaskFormDialog 支持 hasRootPassword 留空保存与切换登录方式清空旧字段（前后端联调）
// ============================================================================
function createTaskFormDialogHarness(apiOverrides = {}) {
  let code = fs.readFileSync(
    "web-dist/assets/TaskFormDialog.vue_vue_type_script_setup_true_lang-BfUx9eob.js",
    "utf8"
  );
  // Strip static ESM imports/exports and evaluate real TaskFormDialog component definition with minimal Vue runtime shims
  code = code.replace(/import\s*(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)?\s*(?:from\s*)?"[^"]+";/g, "");
  code = code.replace(/export\{[^}]+\};?\s*$/, "");

  const watchers = [];
  const toasts = [];
  const vueShims = {
    pe: (icon) => icon,
    ve: (comp) => comp,
    L: (source, cb) => {
      watchers.push({ source, cb });
    },
    T: (type, props, children) => ({ type, props: props || {}, children }),
    u: (fn) => fn,
    V: (arg) => {
      if (typeof arg === "function") {
        return {
          get value() {
            return arg();
          },
        };
      }
      return {
        get value() {
          return arg.get();
        },
        set value(v) {
          arg.set(v);
        },
      };
    },
    b: (init) => ({ value: init }),
    d: () => {},
    s: (type, props, children) => ({ type, props: props || {}, children }),
    r: (type, props, children) => ({ type, props: props || {}, children }),
    f: (vnode, dirs) => ({ ...vnode, dirs }),
    I: "vModelText",
    c: (type, props, children) => ({ type, props: props || {}, children }),
    m: (v) => String(v ?? ""),
    D: () => null,
    k: (list, fn) => (Array.isArray(list) ? list.map(fn) : []),
    x: "Fragment",
    N: "vModelSelect",
    M: (v) => (v && typeof v === "object" && "value" in v ? v.value : v),
    w: (txt) => ({ type: "text", children: txt }),
    fe: (cls) => (Array.isArray(cls) ? cls.filter(Boolean).join(" ") : String(cls || "")),
    be: (fn) => fn,
    ge: (obj) => obj,
    p: (msg, tone) => toasts.push({ msg, tone }),
    ye: async () => true,
    he: "UploadIcon",
    we: (txt) => String(txt ?? "").trim(),
    X: (k) => /^(ssh-rsa|ssh-ed25519|ecdsa-sha2-nistp\d{3})\s+[A-Za-z0-9+/=]{32,}/.test(String(k ?? "").trim()),
    Ie: async () => ({ publicKey: TEST_SSH_PUBKEY, privateKey: "PRIVATE" }),
    C: "UiButton",
    ke: "UiDialog",
    v: "UiField",
    xe: "NetworkIcon",
    Y: "KeyIcon",
  };

  const h = {
    meta: async () => ({ arches: [{ value: "ARM", label: "ARM", shape: "VM.Standard.A1.Flex" }], systems: [] }),
    cfgRegions: async () => ({ items: ["ap-singapore-1"] }),
    compartments: async () => ({ items: [{ id: "comp_1", path: "root" }], defaultId: "comp_1" }),
    launchOptions: async () => ({ availabilityDomains: ["AD-1"], subnets: [{ id: "sub_1", name: "sub", vcnName: "vcn", cidr: "10.0.0.0/24" }] }),
    shapes: async () => ({ items: [] }),
    randomPassword: async () => ({ password: "Rand#123456" }),
    createNetwork: async () => ({ subnetId: "sub_1", created: [], reused: [] }),
    createTask: async () => ({ id: "task_new" }),
    updateTask: async () => ({ ok: true }),
    ...apiOverrides,
  };

  const argNames = [...Object.keys(vueShims), "h"];
  const argValues = [...Object.values(vueShims), h];
  const comp = new Function(...argNames, `${code};\nreturn ua;`)(...argValues);

  function collectVNodes(node, out = []) {
    if (!node) return out;
    if (Array.isArray(node)) {
      for (const child of node) collectVNodes(child, out);
      return out;
    }
    if (typeof node === "object") {
      out.push(node);
      if (node.children) {
        if (typeof node.children === "object" && !Array.isArray(node.children)) {
          for (const slotFn of Object.values(node.children)) {
            if (typeof slotFn === "function") collectVNodes(slotFn(), out);
          }
        } else {
          collectVNodes(node.children, out);
        }
      }
    }
    return out;
  }

  return { comp, watchers, toasts, collectVNodes };
}

test("#7 TaskFormDialog allows empty password save when hasRootPassword=true and clears stale login credential on mode switch", async () => {
  const db = createMemoryD1();
  const env = createTestEnv(db);
  const { ctx, flush } = createExecCtx();
  const token = await loginAndGetToken(env, ctx);
  const authHeader = { authorization: `Bearer ${token}` };
  const cfg = await seedOciConfig(env, ctx, token);

  await withMockFetch(
    async () => jsonResponse({}),
    async () => {
      // Create a real launch task in Worker D1 with initial rootPassword
      const createRes = await apiJson(env, ctx, "/api/tasks", {
        method: "POST",
        headers: authHeader,
        body: {
          cfgId: cfg.id,
          name: "ARM-Prod",
          region: "ap-singapore-1",
          shape: "ARM",
          ocpus: 1,
          memoryGb: 6,
          bootVolumeGb: 50,
          osName: "Canonical Ubuntu 22.04",
          targetCount: 2,
          intervalSec: 60,
          rootPassword: "InitialPassword#1",
        },
      });
      assert.equal(createRes.status, 200);
      await flush();

      const taskId = createRes.data.id;
      const initialEncryptedPwd = db.tasks.get(taskId)?.root_password;
      assert.ok(initialEncryptedPwd?.startsWith("v2."), "initial root_password must be encrypted in D1");

      // Fetch public task object from GET /api/tasks (hasRootPassword: true, rootPassword: "")
      const list1 = await apiJson(env, ctx, "/api/tasks", { headers: authHeader });
      const fetchedTask1 = list1.data.items.find((x) => x.id === taskId);
      assert.equal(fetchedTask1.hasRootPassword, true);
      assert.equal(fetchedTask1.rootPassword, "");
      assert.equal(fetchedTask1.sshPublicKey, "");

      const updatePayloads = [];
      const createPayloads = [];
      const harness = createTaskFormDialogHarness({
        async updateTask(id, payload) {
          updatePayloads.push({ id, payload });
          const r = await apiJson(env, ctx, `/api/tasks/${id}`, {
            method: "PATCH",
            headers: authHeader,
            body: payload,
          });
          if (r.status >= 400) throw new Error(r.data.error);
          return r.data;
        },
        async createTask(payload) {
          createPayloads.push(payload);
          return { id: "new_1" };
        },
      });

      const props = {
        cfgId: cfg.id,
        cfg,
        modelValue: false,
        task: fetchedTask1,
        defaultRegion: "ap-singapore-1",
        defaultCompartment: cfg.compartmentId,
      };
      const emitted = [];
      const render = harness.comp.setup(props, {
        emit: (ev, val) => {
          emitted.push([ev, val]);
          if (ev === "update:modelValue") props.modelValue = val;
        },
      });

      // Open dialog for task with hasRootPassword: true -> trigger modelValue watcher
      props.modelValue = true;
      const openWatcher = harness.watchers[2];
      await openWatcher.cb(true);

      // Render VNode tree and verify placeholder === "已设置，留空保持不变"
      let vnodes = harness.collectVNodes(render({}, []));
      const pwdInput = vnodes.find(
        (n) => n.type === "input" && n.props?.placeholder?.includes("留空保持不变")
      );
      assert.ok(pwdInput, "password input must render placeholder '已设置，留空保持不变' when hasRootPassword=true");
      assert.equal(pwdInput.props.placeholder, "已设置，留空保持不变");

      // 8a. Submit with empty password field -> succeeds, sends rootPassword: undefined & sshPublicKey: "", preserves D1 password!
      const formVnode = vnodes.find((n) => n.type === "form");
      await formVnode.props.onSubmit();

      assert.equal(updatePayloads.length, 1);
      assert.equal(updatePayloads[0].payload.rootPassword, undefined);
      assert.equal(updatePayloads[0].payload.sshPublicKey, "");
      assert.equal(
        db.tasks.get(taskId)?.root_password,
        initialEncryptedPwd,
        "leaving password blank must preserve existing encrypted root_password in D1"
      );

      // 8b. Switch loginMode to "key", set SSH public key, submit -> sends rootPassword: "" to clear old password in D1!
      props.modelValue = true;
      await openWatcher.cb(true);
      vnodes = harness.collectVNodes(render({}, []));
      const sshModeBtn = vnodes.find(
        (n) => n.type === "button" && n.children === "SSH 密钥"
      );
      assert.ok(sshModeBtn);
      sshModeBtn.props.onClick();

      vnodes = harness.collectVNodes(render({}, []));
      const sshTextarea = vnodes.find((n) => n.type === "textarea");
      assert.ok(sshTextarea);
      sshTextarea.props["onUpdate:modelValue"](TEST_SSH_PUBKEY);

      await vnodes.find((n) => n.type === "form").props.onSubmit();
      assert.equal(updatePayloads.length, 2);
      assert.equal(updatePayloads[1].payload.rootPassword, "", "switching to SSH key must send rootPassword: ''");
      assert.equal(updatePayloads[1].payload.sshPublicKey, TEST_SSH_PUBKEY);
      assert.equal(db.tasks.get(taskId)?.root_password, null, "D1 root_password must be cleared");
      assert.equal(db.tasks.get(taskId)?.ssh_public_key, TEST_SSH_PUBKEY);

      // 8c. Switch back from SSH key task (hasRootPassword: false) to "password":
      //     first verify empty password is REJECTED when hasRootPassword is false, then fill new password -> clears ssh_public_key!
      const list2 = await apiJson(env, ctx, "/api/tasks", { headers: authHeader });
      props.task = list2.data.items.find((x) => x.id === taskId);
      assert.equal(props.task.hasRootPassword, false);
      assert.equal(props.task.sshPublicKey, TEST_SSH_PUBKEY);

      props.modelValue = true;
      await openWatcher.cb(true);
      vnodes = harness.collectVNodes(render({}, []));
      const pwdModeBtn = vnodes.find(
        (n) => n.type === "button" && n.children === "root 密码"
      );
      pwdModeBtn.props.onClick();

      vnodes = harness.collectVNodes(render({}, []));
      const emptyPwdInput = vnodes.find(
        (n) => n.type === "input" && n.props?.placeholder === "请输入 root 密码"
      );
      assert.ok(emptyPwdInput, "when hasRootPassword=false, placeholder must be '请输入 root 密码'");

      harness.toasts.length = 0;
      await vnodes.find((n) => n.type === "form").props.onSubmit();
      assert.equal(updatePayloads.length, 2, "must not submit empty password when hasRootPassword=false");
      assert.match(harness.toasts[0]?.msg || "", /请填写 root 密码/);

      // Fill valid new password and submit -> sends sshPublicKey: "" and clears old SSH key in D1!
      emptyPwdInput.props["onUpdate:modelValue"]("NewRootPass#2026");
      await vnodes.find((n) => n.type === "form").props.onSubmit();
      assert.equal(updatePayloads.length, 3);
      assert.equal(updatePayloads[2].payload.rootPassword, "NewRootPass#2026");
      assert.equal(updatePayloads[2].payload.sshPublicKey, "", "switching to password must send sshPublicKey: ''");
      assert.equal(db.tasks.get(taskId)?.ssh_public_key, null, "D1 ssh_public_key must be cleared");
      assert.ok(db.tasks.get(taskId)?.root_password?.startsWith("v2."));

      // Also verify /api/tasks rejects non-finite numeric params (#17/validation)
      const nanRes = await apiJson(env, ctx, `/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: authHeader,
        body: { ocpus: "not-a-number" },
      });
      assert.equal(nanRes.status, 400);
      assert.match(nanRes.data.error, /数值参数格式不正确/);
    }
  );
});

// ============================================================================
// 9) #15 Google JWKS kid 未命中自动刷新、#18 SettingsView 401 登出跳转、#19 配额缓存淘汰
// ============================================================================
test("#15 Google OAuth refreshes JWKS on kid miss, #18 SettingsView tgWebhookReq handles 401 logout, and #19 queryLimits bounds cache to 50", async () => {
  const db = createMemoryD1();
  const env = createTestEnv(db);
  const { ctx } = createExecCtx();
  const token = await loginAndGetToken(env, ctx);
  const authHeader = { authorization: `Bearer ${token}` };

  // --- #15 Google JWKS kid miss refresh ---
  await apiJson(env, ctx, "/api/sys/google", {
    method: "PUT",
    headers: authHeader,
    body: {
      enabled: true,
      clientId: "test-client-id.apps.googleusercontent.com",
      allowedEmails: "ops@example.com",
    },
  });

  const keyPair1 = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"]
  );
  const keyPair2 = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"]
  );
  const jwk1 = { ...(await crypto.subtle.exportKey("jwk", keyPair1.publicKey)), kid: "kid-initial-1" };
  const jwk2 = { ...(await crypto.subtle.exportKey("jwk", keyPair2.publicKey)), kid: "kid-rotated-2" };

  const b64url = (input) =>
    Buffer.from(input)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  async function signGoogleJwt(privateKey, kid, email, subSuffix) {
    const nowSec = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid }));
    const payload = b64url(
      JSON.stringify({
        iss: "https://accounts.google.com",
        aud: "test-client-id.apps.googleusercontent.com",
        email,
        email_verified: true,
        sub: `sub_${subSuffix}`,
        iat: nowSec - 5,
        exp: nowSec + 300,
      })
    );
    const sig = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      privateKey,
      new TextEncoder().encode(`${header}.${payload}`)
    );
    return `${header}.${payload}.${b64url(Buffer.from(sig))}`;
  }

  let certsFetchCalls = 0;
  let currentJwks = [jwk1];

  await withMockFetch(
    async (input) => {
      const urlStr = typeof input === "string" ? input : input.url;
      if (urlStr === "https://www.googleapis.com/oauth2/v3/certs") {
        certsFetchCalls++;
        return jsonResponse({ keys: currentJwks });
      }
      return jsonResponse({});
    },
    async () => {
      // Prime JWKS cache with kid-initial-1
      const jwt1 = await signGoogleJwt(keyPair1.privateKey, "kid-initial-1", "ops@example.com", "1");
      const gRes1 = await apiJson(env, ctx, "/api/google/login", {
        method: "POST",
        body: { credential: jwt1 },
      });
      assert.equal(gRes1.status, 200);
      assert.ok(gRes1.data.token);
      const callsAfterFirst = certsFetchCalls;
      assert.ok(callsAfterFirst >= 1);

      // Rotate Google's upstream JWKS to kid-rotated-2 while cachedKeys still holds kid-initial-1
      currentJwks = [jwk2];
      const jwt2 = await signGoogleJwt(keyPair2.privateKey, "kid-rotated-2", "ops@example.com", "2");
      const gRes2 = await apiJson(env, ctx, "/api/google/login", {
        method: "POST",
        body: { credential: jwt2 },
      });
      assert.equal(gRes2.status, 200, "rotated kid must trigger force-refresh of Google JWKS and succeed");
      assert.ok(gRes2.data.token);
      assert.equal(certsFetchCalls, callsAfterFirst + 1);
    }
  );

  // --- #18 SettingsView tgWebhookReq 401 clears token & redirects ---
  const settingsSrc = fs.readFileSync("web-dist/assets/SettingsView-w1Y9UJLA.js", "utf8");
  assert.match(settingsSrc, /disabled:!S\.hasValue\|\|\(S\.key==="mfa\.secret"&&t\.value\)/);
  assert.doesNotMatch(settingsSrc, /\/google-callback/);

  const fnStart = settingsSrc.indexOf("async function tgWebhookReq(");
  const fnEnd = settingsSrc.indexOf("async function N()", fnStart);
  assert.ok(fnStart !== -1 && fnEnd > fnStart);
  const tgWebhookReqCode = settingsSrc.slice(fnStart, fnEnd);

  let cleared = 0;
  let replacedTo = "";
  const runTgWebhookReq = new Function(
    "_gt",
    "_ct",
    "fetch",
    "location",
    `${tgWebhookReqCode}\nreturn tgWebhookReq;`
  )(
    () => "expired-tok",
    () => {
      cleared++;
    },
    async () => jsonResponse({ error: "未登录或登录已过期" }, 401),
    {
      pathname: "/settings",
      replace(url) {
        replacedTo = url;
      },
    }
  );

  await assert.rejects(() => runTgWebhookReq("GET"), /未登录或登录已过期/);
  assert.equal(cleared, 1, "tgWebhookReq must invoke clearToken() on 401");
  assert.equal(replacedTo, "/login?expired=1", "tgWebhookReq must redirect to /login?expired=1 on 401");

  // --- #19 queryLimits cache bounded to 50 entries ---
  const freshToken = await loginAndGetToken(env, ctx);
  const cfg = await seedOciConfig(env, ctx, freshToken);
  let limitDefFetches = 0;

  await withMockFetch(
    async (input) => {
      const urlStr = typeof input === "string" ? input : input.url;
      const u = new URL(urlStr);
      if (u.pathname.endsWith("/services")) {
        return jsonResponse([{ name: "compute", description: "Compute" }]);
      }
      if (u.pathname.endsWith("/limitDefinitions")) {
        limitDefFetches++;
        return jsonResponse([]);
      }
      if (u.pathname.endsWith("/limitValues")) {
        return jsonResponse([]);
      }
      return jsonResponse({});
    },
    async () => {
      for (let i = 0; i < 52; i++) {
        const r = await apiJson(
          env,
          ctx,
          `/api/cfgs/${cfg.id}/limits?service=svc_${i}`,
          { headers: { authorization: `Bearer ${freshToken}` } }
        );
        assert.equal(r.status, 200);
      }
      assert.equal(limitDefFetches, 52);

      // svc_51 is still in the 50-item cache -> 0 new limitDefinitions fetches
      await apiJson(env, ctx, `/api/cfgs/${cfg.id}/limits?service=svc_51`, {
        headers: { authorization: `Bearer ${freshToken}` },
      });
      assert.equal(limitDefFetches, 52, "recent cache entry svc_51 must hit cache");

      // svc_0 was evicted when cache exceeded 50 -> triggers refetch
      await apiJson(env, ctx, `/api/cfgs/${cfg.id}/limits?service=svc_0`, {
        headers: { authorization: `Bearer ${freshToken}` },
      });
      assert.equal(limitDefFetches, 53, "oldest cache entry svc_0 must have been evicted at 50-item cap");
    }
  );
});

