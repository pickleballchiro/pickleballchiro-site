// Markdown content negotiation for pickleballchiro.co (Cloudflare Worker in front of GitHub Pages).
//
// GitHub Pages can't vary a response by the Accept header, so this Worker does it:
//   Accept: text/markdown on a page  -> the page's pre-built Markdown twin (<page>/index.md,
//                                       written by build-llms-full.py), Content-Type text/markdown
//   Accept: text/markdown on a 404   -> 404 with a short Markdown body pointing at llms.txt
//   anything else                    -> the origin response untouched, plus "Accept" in Vary
// Assets (css, js, images, txt, xml...) pass straight through. Any error falls back to origin.

const SITE = "https://pickleballchiro.co";

export const NOT_FOUND_MARKDOWN = `# 404: Page not found

There is no page at this address on pickleballchiro.co (Dr. Lane Odom, The Pickleball Chiro).
The link may be old or mistyped.

Where to go instead:

- [Site index for AI agents (llms.txt)](${SITE}/llms.txt)
- [Sitemap](${SITE}/sitemap.xml)
- [Homepage](${SITE}/)
- [Contact](${SITE}/contact/)
`;

// q-value of `type` in an Accept header, or 0 when it isn't listed. Only exact types count,
// so a crawler sending */* keeps getting HTML.
export function acceptQ(accept, type) {
  let best = 0;
  for (const part of (accept || "").split(",")) {
    const [mediaType, ...params] = part.trim().split(";");
    if (mediaType.trim().toLowerCase() !== type) continue;
    let q = 1;
    for (const p of params) {
      const [k, v] = p.trim().split("=");
      if (k && k.trim().toLowerCase() === "q") q = Number.parseFloat(v);
    }
    if (Number.isFinite(q)) best = Math.max(best, q);
  }
  return best;
}

export function wantsMarkdown(accept) {
  const md = acceptQ(accept, "text/markdown");
  return md > 0 && md >= acceptQ(accept, "text/html");
}

// Paths that are pages: "/", "/about/", "/about", "/404.html". Not "/styles.css", "/llms.txt".
export function isPagePath(pathname) {
  const last = pathname.split("/").pop();
  return last === "" || !last.includes(".") || last.endsWith(".html");
}

// "/" -> "/index.md", "/about/" or "/about" -> "/about/index.md", "/about/index.html" -> "/about/index.md"
export function markdownPath(pathname) {
  if (pathname.endsWith("/index.html")) return pathname.slice(0, -"index.html".length) + "index.md";
  if (pathname.endsWith(".html")) return null;
  return (pathname.endsWith("/") ? pathname : pathname + "/") + "index.md";
}

function withVaryAccept(response) {
  const r = new Response(response.body, response);
  const vary = (r.headers.get("Vary") || "").split(",").map((v) => v.trim()).filter(Boolean);
  if (!vary.some((v) => v.toLowerCase() === "accept")) vary.unshift("Accept");
  r.headers.set("Vary", vary.join(", "));
  return r;
}

function markdownResponse(body, status, extra = {}) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Vary": "Accept",
      "X-Content-Type-Options": "nosniff",
      ...extra,
    },
  });
}

export async function handle(request, fetchImpl = fetch) {
  const url = new URL(request.url);
  if (!["GET", "HEAD"].includes(request.method) || !isPagePath(url.pathname)) {
    return fetchImpl(request);
  }

  const accept = request.headers.get("Accept");
  if (wantsMarkdown(accept)) {
    const mdPath = markdownPath(url.pathname);
    if (mdPath) {
      const md = await fetchImpl(new Request(new URL(mdPath, url), { method: "GET" }));
      if (md.ok) {
        const htmlUrl = new URL(mdPath.slice(0, -"index.md".length), url).href;
        const extra = { Link: `<${htmlUrl}>; rel="canonical"` };
        const cc = md.headers.get("Cache-Control");
        if (cc) extra["Cache-Control"] = cc;
        const body = request.method === "HEAD" ? null : await md.text();
        return markdownResponse(body, 200, extra);
      }
    }
    // No twin: real page without one (e.g. /dashboard/) gets its HTML, a missing page gets Markdown 404.
    const origin = await fetchImpl(request);
    if (origin.status === 404) {
      return markdownResponse(request.method === "HEAD" ? null : NOT_FOUND_MARKDOWN, 404);
    }
    return withVaryAccept(origin);
  }

  return withVaryAccept(await fetchImpl(request));
}

export default {
  async fetch(request) {
    try {
      return await handle(request);
    } catch (err) {
      // Fail open: the site must never go down because of this Worker.
      return fetch(request);
    }
  },
};
