import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildDeployConfig, maskId } from "../scripts/cf-deploy.mjs";

const BASE_TOML = fs.readFileSync("wrangler.toml", "utf8");

test("buildDeployConfig injects D1_DATABASE_ID and keeps defaults when optional vars are omitted", () => {
  const out = buildDeployConfig(BASE_TOML, {
    D1_DATABASE_ID: "12345678-1234-4123-8123-123456789abc",
  });
  assert.match(out, /name\s*=\s*"oci-flare"/);
  assert.match(out, /database_name\s*=\s*"oci-flare"/);
  assert.match(out, /database_id\s*=\s*"12345678-1234-4123-8123-123456789abc"/);
  assert.doesNotMatch(out, /REPLACE_WITH_YOUR_D1_DATABASE_ID/);
});

test("buildDeployConfig overrides D1_DATABASE_NAME and WORKER_NAME accurately without corrupting other fields", () => {
  const out = buildDeployConfig(BASE_TOML, {
    D1_DATABASE_ID: "abcdef12-3456-7890-abcd-ef1234567890",
    D1_DATABASE_NAME: "my-oci-d1",
    WORKER_NAME: "oci-helper-serverless-cf",
  });
  assert.match(out, /^name\s*=\s*"oci-helper-serverless-cf"/m);
  assert.match(out, /database_name\s*=\s*"my-oci-d1"/);
  assert.match(out, /database_id\s*=\s*"abcdef12-3456-7890-abcd-ef1234567890"/);
  assert.match(out, /main\s*=\s*"dist\/index\.js"/);
  assert.match(out, /directory\s*=\s*"web-dist"/);
});

test("buildDeployConfig fails fast when D1_DATABASE_ID is missing or malformed", () => {
  assert.throws(
    () => buildDeployConfig(BASE_TOML, {}),
    /D1_DATABASE_ID/
  );
  assert.throws(
    () => buildDeployConfig(BASE_TOML, { D1_DATABASE_ID: "bad\"value\n" }),
    /D1_DATABASE_ID/
  );
  assert.throws(
    () =>
      buildDeployConfig(BASE_TOML, {
        D1_DATABASE_ID: "12345678-1234-4123-8123-123456789abc",
        WORKER_NAME: 'bad"name',
      }),
    /WORKER_NAME/
  );
});

test("maskId hides full UUID while preserving short diagnostic prefix", () => {
  assert.equal(maskId("12345678-1234-4123-8123-123456789abc"), "12345678***");
  assert.equal(maskId("short"), "***");
});

test("cf-deploy.mjs passes relative .wrangler-deploy.toml to --config to stay safe on paths with spaces", () => {
  const src = fs.readFileSync("scripts/cf-deploy.mjs", "utf8");
  assert.match(src, /"--config",\s*"\.wrangler-deploy\.toml"/);
});
