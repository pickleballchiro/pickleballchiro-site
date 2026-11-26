// Same-origin owner-only read route. Cloudflare Access authenticates the user,
// and this Worker validates the application token before consulting Apps Script.
const INTELLIGENCE_PATH = "/dashboard/api/intelligence";
const BUSINESS_PATH = "/dashboard/api/business";
const SIGN_OUT_PATH = "/dashboard/api/sign-out";
const BUSINESS_ACTIONS = {
  get_dashboard_data: [], get_calendar_events: ["range_start", "range_end"],
  add_task: ["task", "deadline"], complete_task: ["id"], delete_task: ["id"],
  add_video: ["client", "video", "due"], complete_video: ["id"], delete_video: ["id"],
};
const EXPECTED_SCHEMA = "pbc-content-intelligence/1";
const ENCODED_LIMIT = 550_000;
const issuerPattern = /^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/;
const scriptPattern = /^https:\/\/script\.google\.com\/macros\/s\/[a-zA-Z0-9_-]+\/exec$/;
const base64url = /^[a-zA-Z0-9_-]+$/;

function b64(value) {
  if (!base64url.test(value)) throw new Error("Invalid encoding");
  return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));
}

function readPart(value) {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(b64(value)));
}

function response(code, body) {
  return new Response(JSON.stringify(body), {
    status: code,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export async function checkOwner(token, env, network, now = Date.now() / 1000) {
  const issuer = env.PBC_ACCESS_ISSUER;
  const audience = env.PBC_ACCESS_AUDIENCE;
  const owner = env.PBC_ACCESS_OWNER_EMAIL?.trim().toLowerCase();
  if (!issuerPattern.test(issuer || "") || !audience || !owner || !token || token.length > 8192) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  try {
    const header = readPart(parts[0]);
    const claims = readPart(parts[1]);
    if (header.alg !== "RS256" || typeof header.kid !== "string" ||
        !base64url.test(header.kid) || header.crit !== undefined ||
        claims.iss !== issuer || claims.type !== "app" ||
        !Array.isArray(claims.aud) || !claims.aud.includes(audience) ||
        !Number.isFinite(claims.exp) || claims.exp <= now ||
        (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > now)) ||
        typeof claims.email !== "string" || claims.email.trim().toLowerCase() !== owner ||
        typeof claims.sub !== "string" || !claims.sub) return false;
    // Workers supports manual redirects. The status check below rejects every redirect.
    const keys = await network(issuer + "/cdn-cgi/access/certs", { redirect: "manual" });
    if (!keys.ok) return false;
    const jwks = await keys.json();
    const key = jwks.keys?.find((candidate) => candidate.kid === header.kid && candidate.kty === "RSA" &&
      (!candidate.alg || candidate.alg === "RS256") && (!candidate.use || candidate.use === "sig"));
    if (!key) return false;
    const algorithm = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
    const publicKey = await crypto.subtle.importKey("jwk", key, algorithm, false, ["verify"]);
    return await crypto.subtle.verify(algorithm, publicKey, b64(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1]));
  } catch {
    return false;
  }
}

async function callScript(url, key, action, fields, network, maximumLength) {
  if (!scriptPattern.test(url || "") || typeof key !== "string" || key.length < 32) return null;
  let result = await network(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, key, ...fields }),
    redirect: "manual",
  });
  // Content Service responds with a one-time, credential-free Google content URL.
  if ([302, 303].includes(result.status)) {
    const next = new URL(result.headers.get("Location") || "", url);
    if (next.origin !== "https://script.googleusercontent.com" || next.username || next.password) return null;
    result = await network(next.href, { method: "GET", redirect: "manual" });
  }
  if (!result.ok || !result.headers.get("Content-Type")?.includes("application/json")) return null;
  const text = await result.text();
  return text.length <= maximumLength ? JSON.parse(text) : null;
}

export function isIntelligenceApi(path) {
  return path === "/dashboard/api" || path.startsWith("/dashboard/api/");
}

function clearAccessSession(hostname, issuer) {
  const result = response(200, { logoutUrl: issuer + "/cdn-cgi/access/logout" });
  // The Cloudflare logout page can leave an application cookie scoped to the dashboard.
  for (const name of ["CF_Authorization", "CF_AppSession", "CF_Binding"]) {
    for (const path of ["/", "/dashboard", "/dashboard/"]) {
      const expired = `${name}=; Path=${path}; Max-Age=0; Secure; HttpOnly; SameSite=Lax`;
      result.headers.append("Set-Cookie", expired);
      result.headers.append("Set-Cookie", `${expired}; Domain=${hostname}`);
    }
  }
  return result;
}

export async function dashboardIntelligence(request, env, network = fetch) {
  const url = new URL(request.url);
  const business = url.pathname === BUSINESS_PATH;
  const signOut = url.pathname === SIGN_OUT_PATH;
  const usesPost = business || signOut;
  const expectedOrigin = env?.PBC_DASHBOARD_ORIGIN ?? "https://pickleballchiro.co";
  if (url.origin !== expectedOrigin || url.search ||
      (usesPost ? env?.PBC_BUSINESS_ENABLED !== "1" :
        url.pathname !== INTELLIGENCE_PATH || env?.PBC_CONTENT_ENABLED !== "1")) {
    return response(404, { error: "unavailable" });
  }
  if (request.method !== (usesPost ? "POST" : "GET")) return response(405, { error: "method not allowed" });
  const site = request.headers.get("Sec-Fetch-Site");
  if ((site && site !== "same-origin") || (usesPost &&
      (request.headers.get("Origin") !== url.origin ||
       request.headers.get("X-PBC-Request") !== "1")) ||
      (business && request.headers.get("Content-Type") !== "application/json")) {
    return response(403, { error: "forbidden" });
  }

  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), 16000);
  const fetchWithDeadline = (input, init) => network(input, { ...init, signal: deadline.signal });
  try {
    if (!await checkOwner(request.headers.get("Cf-Access-Jwt-Assertion"), env, fetchWithDeadline)) {
      return response(401, { error: "owner sign-in required" });
    }
    if (signOut) return clearAccessSession(url.hostname, env.PBC_ACCESS_ISSUER);
    if (business) {
      const raw = await request.text();
      let input;
      try {
        if (raw.length <= 8192) input = JSON.parse(raw);
      } catch {
        return response(400, { error: "invalid dashboard request" });
      }
      const allowed = input && typeof input.action === "string" &&
        Object.hasOwn(BUSINESS_ACTIONS, input.action) && BUSINESS_ACTIONS[input.action];
      if (!allowed || !Object.entries(input).every(([field, value]) =>
        field === "action" || (allowed.includes(field) && typeof value === "string"))) {
        return response(400, { error: "invalid dashboard request" });
      }
      const result = await callScript(env.PBC_BUSINESS_SCRIPT_URL, env.PBC_BUSINESS_KEY,
        "dashboard_business", { request: input }, fetchWithDeadline, 5_000_000);
      if (result?.status === "ok" || result?.status === "error" && result.message !== "unauthorized") {
        return response(200, result);
      }
    } else {
      const result = await callScript(env.PBC_CONTENT_SCRIPT_URL, env.PBC_CONTENT_READ_KEY,
        "dashboard_content_read", {}, fetchWithDeadline, ENCODED_LIMIT);
      if (result?.status === "ok" && result.snapshot?.schema === EXPECTED_SCHEMA) {
        return response(200, result.snapshot);
      }
    }
    return response(503, { error: "dashboard data unavailable" });
  } catch {
    return response(503, { error: "dashboard data unavailable" });
  } finally {
    clearTimeout(timer);
  }
}
