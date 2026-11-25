import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const PLACEHOLDER = "REPLACE_WITH_YOUR_D1_DATABASE_ID";

export function maskId(id) {
  const s = String(id ?? "").trim();
  return s.length > 8 ? `${s.slice(0, 8)}***` : "***";
}

export function buildDeployConfig(baseToml, env = process.env) {
  const dbId = String(env.D1_DATABASE_ID ?? "").trim();
  const dbName = String(env.D1_DATABASE_NAME ?? "").trim();
  const workerName = String(env.WORKER_NAME ?? "").trim();

  if (!dbId) {
    throw new Error(
      "缺少构建环境变量 D1_DATABASE_ID。请在 Cloudflare Worker → Settings → Build → Build variables 中添加 D1_DATABASE_ID（你的 D1 数据库 UUID），避免部署时解绑 DB。"
    );
  }
  if (!/^[A-Za-z0-9_-]+$/.test(dbId)) {
    throw new Error("构建环境变量 D1_DATABASE_ID 格式不合法（仅允许字母、数字、连字符和下划线）。");
  }
  if (dbName && /["\\\r\n]/.test(dbName)) {
    throw new Error("构建环境变量 D1_DATABASE_NAME 包含非法字符。");
  }
  if (workerName && /["\\\r\n]/.test(workerName)) {
    throw new Error("构建环境变量 WORKER_NAME 包含非法字符。");
  }
  if (!baseToml.includes(PLACEHOLDER)) {
    throw new Error(`wrangler.toml 中未找到占位符 ${PLACEHOLDER}。`);
  }

  let out = baseToml.replace(PLACEHOLDER, () => dbId);

  if (dbName) {
    out = out.replace(
      /^(\s*database_name\s*=\s*)"[^"]*"/m,
      (_, prefix) => `${prefix}"${dbName}"`
    );
  }

  if (workerName) {
    out = out.replace(
      /^(\s*name\s*=\s*)"[^"]*"/m,
      (_, prefix) => `${prefix}"${workerName}"`
    );
  }

  return out;
}

function runCli() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const rootDir = path.resolve(scriptDir, "..");
  const basePath = path.join(rootDir, "wrangler.toml");
  const tempPath = path.join(rootDir, ".wrangler-deploy.toml");

  const baseToml = fs.readFileSync(basePath, "utf8");
  const rendered = buildDeployConfig(baseToml, process.env);

  const workerLabel = (process.env.WORKER_NAME || "oci-helper-serverless").trim();
  const dbLabel = (process.env.D1_DATABASE_NAME || "oci-helper-serverless").trim();
  console.log(
    `[cf-deploy] Deploying worker="${workerLabel}" with D1 DB="${dbLabel}" (${maskId(process.env.D1_DATABASE_ID)})`
  );

  fs.writeFileSync(tempPath, rendered, "utf8");
  try {
    const extraArgs = process.argv.slice(2);
    const args = ["wrangler", "deploy", "--config", ".wrangler-deploy.toml", ...extraArgs];
    const isWin = process.platform === "win32";
    const result = spawnSync(isWin ? "npx.cmd" : "npx", args, {
      cwd: rootDir,
      stdio: "inherit",
      shell: isWin,
    });
    if (result.error) throw result.error;
    process.exit(result.status ?? 1);
  } finally {
    try {
      fs.unlinkSync(tempPath);
    } catch {}
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    runCli();
  } catch (err) {
    console.error(`[cf-deploy] 部署中止：${err?.message ?? err}`);
    process.exit(1);
  }
}
