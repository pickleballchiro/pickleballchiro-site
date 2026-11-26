import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { test } from "node:test";
import worker from "./worker.js";
import { dashboardIntelligence } from "./dashboard-intelligence.mjs";

const key = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...key.publicKey.export({ format: "jwk" }), kid: "synthetic", alg: "RS256" };
const env = {
  PBC_CONTENT_ENABLED: "1",
  PBC_ACCESS_ISSUER: "https://synthetic.cloudflareaccess.com",
  PBC_ACCESS_AUDIENCE: "synthetic-audience",
  PBC_ACCESS_OWNER_EMAIL: "owner@example.test",
  PBC_CONTENT_SCRIPT_URL: "https://script.google.com/macros/s/synthetic/exec",
  PBC_CONTENT_READ_KEY: "synthetic-read-key-for-unit-tests-only",
};
const path = "https://pickleballchiro.co/dashboard/api/intelligence";
const b64 = (object) => Buffer.from(JSON.stringify(object)).toString("base64url");
function token(overrides = {}, header = {}) {
  const now = Math.floor(Date.now() / 1000);
  const prefix = b64({ alg: "RS256", kid: jwk.kid, ...header }) + "." + b64({
    type: "app", iss: env.PBC_ACCESS_ISSUER, aud: [env.PBC_ACCESS_AUDIENCE], sub: "owner",
    email: env.PBC_ACCESS_OWNER_EMAIL, exp: now + 300, nbf: now - 60, ...overrides,
  });
  return prefix + "." + sign("RSA-SHA256", Buffer.from(prefix), key.privateKey).toString("base64url");
}

function request(t, attrs = {}) {
  return new Request(path, { ...attrs, headers: { "Sec-Fetch-Site": "same-origin",
    ...(t && { "Cf-Access-Jwt-Assertion": t }), ...attrs.headers } });
}

const snapshot = { schema: "pbc-content-intelligence/1", creatives: [], observations: [], experiments: [] };
const json = (data) => Response.json(data);

test("private route stays closed by default and never hits the public origin", async () => {
  const result = await worker.fetch(request(token()), {});
  assert.equal(result.status, 404);
  assert.match(result.headers.get("Cache-Control"), /no-store/);
});

test("missing, foreign, expired and malformed identity cannot reach Apps Script", async () => {
  const checks = [null, "not-a-token", token({ aud: ["different-app"] }), token({ email: "other@example.test" }),
    token({ exp: 0 }), token({ type: "org" }), token({ iss: "https://elsewhere.cloudflareaccess.com" }),
    token({}, { alg: "none" }), token({ nbf: Math.floor(Date.now() / 1000) + 60 })];
  for (const t of checks) {
    const result = await dashboardIntelligence(request(t), env, () => assert.fail("unauthorized network call"));
    assert.equal(result.status, 401);
  }
  assert.equal((await dashboardIntelligence(request(token(), { headers: { "Sec-Fetch-Site": "cross-site" } }), env)).status, 403);
  assert.equal((await dashboardIntelligence(request(token(), { method: "POST" }), env)).status, 405);
});

test("invalid signature stops at the keyset", async () => {
  const [head, body, sig] = token().split(".");
  const bad = [head, body, (sig[0] === "A" ? "B" : "A") + sig.slice(1)].join(".");
  const rejected = await dashboardIntelligence(request(bad), env, async (url) => {
    assert.match(url, /\/certs$/);
    return json({ keys: [jwk] });
  });
  assert.equal(rejected.status, 401);
});

test("owner receives the scoped snapshot and a separate credential stays server-side", async () => {
  const calls = [];
  const result = await dashboardIntelligence(request(token()), env, async (url, opts) => {
    calls.push([url, opts]);
    if (calls.length === 1) return json({ keys: [jwk] });
    if (calls.length === 2) return new Response(null, { status: 302,
      headers: { Location: "https://script.googleusercontent.com/mock-result" } });
    return json({ status: "ok", snapshot });
  });
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), snapshot);
  assert.match(result.headers.get("Cache-Control"), /no-store/);
  assert.deepEqual(JSON.parse(calls[1][1].body), { action: "dashboard_content_read", key: env.PBC_CONTENT_READ_KEY });
  assert.equal(calls[2][1].body, undefined);
  assert.equal(calls[2][1].method, "GET");
});

test("origin redirect and missing upstream snapshot both fail closed", async () => {
  let count = 0;
  const result = await dashboardIntelligence(request(token()), env, async () => {
    count++;
    if (count === 1) return json({ keys: [jwk] });
    if (count === 2) return new Response(null, { status: 302, headers: { Location: "https://elsewhere.test/" } });
    assert.fail("unexpected redirect was followed");
  });
  assert.equal(result.status, 503);
  const unavailable = await dashboardIntelligence(request(token()), env, async (url) =>
    url.endsWith("/certs") ? json({ keys: [jwk] }) : json({ status: "error" }));
  assert.equal(unavailable.status, 503);
});

test("business RPC requires owner JWT and same-origin POST, and forwards only scoped fields", async () => {
  const stagingOrigin = "https://stage.example.test";
  const businessEnv = { ...env, PBC_DASHBOARD_ORIGIN: stagingOrigin, PBC_BUSINESS_ENABLED: "1",
    PBC_BUSINESS_SCRIPT_URL: env.PBC_CONTENT_SCRIPT_URL, PBC_BUSINESS_KEY: "synthetic-business-worker-only-secret" };
  const post = (jwt, content, headers = {}) => new Request(stagingOrigin + "/dashboard/api/business", {
    method: "POST",
    body: JSON.stringify(content),
    headers: { Origin: stagingOrigin, "Content-Type": "application/json", "X-PBC-Request": "1",
      ...(jwt && { "Cf-Access-Jwt-Assertion": jwt }), ...headers },
  });
  for (const jwt of [null, token({ exp: 0 }), token({ email: "other@example.test" }), token({ aud: ["wrong"] })]) {
    const result = await dashboardIntelligence(post(jwt, { action: "get_dashboard_data" }), businessEnv,
      () => assert.fail("unauthorized upstream request"));
    assert.equal(result.status, 401);
    assert.equal(result.headers.get("Cache-Control"), "private, no-store");
  }
  const foreign = await dashboardIntelligence(post(token(), { action: "add_task", task: "synthetic" },
    { Origin: "https://other.example.test" }), businessEnv, () => assert.fail("cross-origin upstream request"));
  assert.equal(foreign.status, 403);

  const keysOnly = async (url) => {
    assert.match(url, /\/certs$/);
    return json({ keys: [jwk] });
  };
  for (const body of [{ action: "find_rows" }, { action: "add_task", key: "caller key" }, { action: "toString" }]) {
    assert.equal((await dashboardIntelligence(post(token(), body), businessEnv, keysOnly)).status, 400);
  }
  const input = { action: "add_task", task: "synthetic task", deadline: "2026-11-26" };
  const ok = await dashboardIntelligence(post(token(), input), businessEnv, async (url, init) => {
    if (url.endsWith("/certs")) return keysOnly(url);
    assert.equal(url, businessEnv.PBC_BUSINESS_SCRIPT_URL);
    assert.deepEqual(JSON.parse(init.body), { action: "dashboard_business", key: businessEnv.PBC_BUSINESS_KEY, request: input });
    return json({ status: "ok" });
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(await ok.json(), { status: "ok" });
});

test("service worker skips both private RPCs and pre-caches the v27 shell only", async () => {
  const { readFile } = await import("node:fs/promises");
  const vm = await import("node:vm");
  const handlers = new Map();
  let cached;
  const self = {
    location: new URL("https://pickleballchiro.co/dashboard/sw.js"),
    addEventListener: (name, fn) => handlers.set(name, fn),
    skipWaiting() {},
  };
  const caches = {
    open: async (name) => ({
      addAll: (paths) => { cached = { name, paths }; },
    }),
  };
  vm.runInNewContext(await readFile(new URL("../dashboard/sw.js", import.meta.url), "utf8"), { self, caches, URL });
  let install;
  handlers.get("install")({ waitUntil: (result) => { install = result; } });
  await install;
  assert.equal(cached.name, "pbc-shell-v27");
  assert.ok(cached.paths.includes("./dashboard.js?v=27"));
  assert.ok(cached.paths.every((p) => !p.includes("/api")));
  for (const [pathname, method] of [["/dashboard/api/intelligence", "GET"], ["/dashboard/api/business", "POST"],
    ["/dashboard/api", "GET"], ["/dashboard/api/business", "GET"]]) {
    handlers.get("fetch")({ request: new Request(self.location.origin + pathname, { method }),
      respondWith: () => assert.fail("Private request must remain network-only") });
  }
});
