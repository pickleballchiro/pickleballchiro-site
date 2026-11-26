// Same-origin owner-only read route. Cloudflare Access authenticates the user,
// and this Worker validates the application token before consulting Apps Script.
const INTELLIGENCE_PATH = "/dashboard/api/intelligence";
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
    const keys = await network(issuer + "/cdn-cgi/access/certs", { redirect: "error" });
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

async function readSnapshot(env, network, signal) {
  const url = env.PBC_CONTENT_SCRIPT_URL;
  const key = env.PBC_CONTENT_READ_KEY;
  if (!scriptPattern.test(url || "") || typeof key !== "string" || key.length < 32) return null;
  let result = await network(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "dashboard_content_read", key }),
    redirect: "manual",
    signal,
  });
  // Content Service responds with a one-time, credential-free Google content URL.
  if ([302, 303].includes(result.status)) {
    const next = new URL(result.headers.get("Location") || "", url);
    if (next.origin !== "https://script.googleusercontent.com" || next.username || next.password) return null;
    result = await network(next.href, { method: "GET", redirect: "error", signal });
  }
  if (!result.ok || !result.headers.get("Content-Type")?.includes("application/json")) return null;
  const text = await result.text();
  if (text.length > ENCODED_LIMIT) return null;
  const payload = JSON.parse(text);
  return payload.status === "ok" && payload.snapshot?.schema === EXPECTED_SCHEMA ? payload.snapshot : null;
}

export function isIntelligenceApi(path) {
  return path === "/dashboard/api" || path.startsWith("/dashboard/api/");
}

export async function dashboardIntelligence(request, env, network = fetch) {
  const url = new URL(request.url);
  if (url.origin !== "https://pickleballchiro.co" || url.pathname !== INTELLIGENCE_PATH || url.search ||
      env?.PBC_CONTENT_ENABLED !== "1") return response(404, { error: "unavailable" });
  if (request.method !== "GET") return response(405, { error: "read only" });
  const site = request.headers.get("Sec-Fetch-Site");
  if (site && site !== "same-origin") return response(403, { error: "forbidden" });

  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), 12000);
  const fetchWithDeadline = (input, init) => network(input, { ...init, signal: deadline.signal });
  try {
    if (!await checkOwner(request.headers.get("Cf-Access-Jwt-Assertion"), env, fetchWithDeadline)) {
      return response(401, { error: "owner sign-in required" });
    }
    const snapshot = await readSnapshot(env, fetchWithDeadline, deadline.signal);
    if (!snapshot) return response(503, { error: "snapshot unavailable" });
    return response(200, snapshot);
  } catch {
    return response(503, { error: "snapshot unavailable" });
  } finally {
    clearTimeout(timer);
  }
}
