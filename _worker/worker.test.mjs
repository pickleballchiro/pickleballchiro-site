// Run: node --test _worker/
import { test } from "node:test";
import assert from "node:assert/strict";
import worker, { handle, acceptQ, wantsMarkdown, isPagePath, markdownPath, NOT_FOUND_MARKDOWN, movedTarget } from "./worker.js";

const SITE = "https://pickleballchiro.co";

// Fake GitHub Pages origin: a few HTML pages, their Markdown twins, one asset.
const ORIGIN = {
  "/": { type: "text/html; charset=utf-8", body: "<!DOCTYPE html><title>Home</title>" },
  "/index.md": { type: "text/markdown; charset=utf-8", body: "# Homepage\n\nCanonical: https://pickleballchiro.co/\n" },
  "/about/": { type: "text/html; charset=utf-8", body: "<!DOCTYPE html><title>About</title>" },
  "/about/index.md": { type: "text/markdown; charset=utf-8", body: "# About Dr. Lane Odom\n" },
  "/dashboard/": { type: "text/html; charset=utf-8", body: "<!DOCTYPE html><title>Dashboard</title>" },
  "/styles.css": { type: "text/css", body: "body{}" },
};

function fakeOrigin(calls = []) {
  return async (req) => {
    const path = new URL(req.url).pathname;
    calls.push(path);
    const hit = ORIGIN[path];
    const headers = { "Vary": "Accept-Encoding", "Cache-Control": "max-age=600" };
    if (!hit) return new Response("<!DOCTYPE html><title>Not found</title>", { status: 404, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
    return new Response(hit.body, { status: 200, headers: { ...headers, "Content-Type": hit.type } });
  };
}

const get = (path, accept, method = "GET") =>
  new Request(SITE + path, { method, headers: accept ? { Accept: accept } : {} });

test("homepage with Accept: text/markdown returns the Markdown twin", async () => {
  const res = await handle(get("/", "text/markdown"), fakeOrigin());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "text/markdown; charset=utf-8");
  assert.equal(res.headers.get("Vary"), "Accept");
  assert.equal(res.headers.get("Link"), `<${SITE}/>; rel="canonical"`);
  assert.equal(res.headers.get("Cache-Control"), "max-age=600");
  assert.match(await res.text(), /^# Homepage/);
});

test("homepage with Accept: text/html returns HTML and Vary includes Accept and Accept-Encoding", async () => {
  const res = await handle(get("/", "text/html"), fakeOrigin());
  assert.equal(res.status, 200);
  assert.match(res.headers.get("Content-Type"), /^text\/html/);
  assert.equal(res.headers.get("Vary"), "Accept, Accept-Encoding");
  assert.match(await res.text(), /<!DOCTYPE html>/);
});

test("browser-style Accept header still gets HTML", async () => {
  const res = await handle(get("/", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"), fakeOrigin());
  assert.match(res.headers.get("Content-Type"), /^text\/html/);
});

test("subpage with and without trailing slash maps to its twin", async () => {
  for (const path of ["/about/", "/about", "/about/index.html"]) {
    const res = await handle(get(path, "text/markdown"), fakeOrigin());
    assert.equal(res.status, 200, path);
    assert.equal(await res.text(), "# About Dr. Lane Odom\n");
    assert.equal(res.headers.get("Link"), `<${SITE}/about/>; rel="canonical"`);
  }
});

test("missing page with Accept: text/markdown is a 404 with a Markdown body linking llms.txt", async () => {
  const res = await handle(get("/__ora-404-probe-v9hy3oin", "text/markdown"), fakeOrigin());
  assert.equal(res.status, 404);
  assert.equal(res.headers.get("Content-Type"), "text/markdown; charset=utf-8");
  assert.equal(res.headers.get("Vary"), "Accept");
  const body = await res.text();
  assert.equal(body, NOT_FOUND_MARKDOWN);
  assert.ok(body.length >= 20);
  assert.match(body, /https:\/\/pickleballchiro\.co\/llms\.txt/);
  assert.match(body, /https:\/\/pickleballchiro\.co\/sitemap\.xml/);
});

test("missing page with Accept: text/html keeps the origin HTML 404", async () => {
  const res = await handle(get("/nope/", "text/html"), fakeOrigin());
  assert.equal(res.status, 404);
  assert.match(res.headers.get("Content-Type"), /^text\/html/);
  assert.match(res.headers.get("Vary"), /Accept/);
});

test("real page without a twin falls back to its HTML even for Markdown requests", async () => {
  const res = await handle(get("/dashboard/", "text/markdown"), fakeOrigin());
  assert.equal(res.status, 200);
  assert.match(res.headers.get("Content-Type"), /^text\/html/);
  assert.match(res.headers.get("Vary"), /Accept/);
});

test("assets pass through untouched with a single origin call", async () => {
  const calls = [];
  const res = await handle(get("/styles.css", "text/markdown"), fakeOrigin(calls));
  assert.equal(res.headers.get("Content-Type"), "text/css");
  assert.equal(res.headers.get("Vary"), "Accept-Encoding");
  assert.deepEqual(calls, ["/styles.css"]);
});

test("HEAD with Accept: text/markdown returns Markdown headers and no body", async () => {
  const res = await handle(get("/", "text/markdown", "HEAD"), fakeOrigin());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "text/markdown; charset=utf-8");
  assert.equal(await res.text(), "");
});

test("POST is passed through", async () => {
  const calls = [];
  await handle(new Request(SITE + "/", { method: "POST", headers: { Accept: "text/markdown" } }), fakeOrigin(calls));
  assert.deepEqual(calls, ["/"]);
});

test("Accept q-values decide between HTML and Markdown", () => {
  assert.equal(acceptQ("text/markdown", "text/markdown"), 1);
  assert.equal(acceptQ("text/markdown;q=0.5, text/html", "text/markdown"), 0.5);
  assert.equal(acceptQ("*/*", "text/markdown"), 0);
  assert.equal(wantsMarkdown("text/markdown"), true);
  assert.equal(wantsMarkdown("text/markdown, text/html;q=0.9"), true);
  assert.equal(wantsMarkdown("text/html;q=1, text/markdown;q=0.5"), false);
  assert.equal(wantsMarkdown("text/markdown;q=0"), false);
  assert.equal(wantsMarkdown("*/*"), false);
  assert.equal(wantsMarkdown(null), false);
});

test("page path detection and twin mapping", () => {
  assert.equal(isPagePath("/"), true);
  assert.equal(isPagePath("/about/"), true);
  assert.equal(isPagePath("/about"), true);
  assert.equal(isPagePath("/404.html"), true);
  assert.equal(isPagePath("/llms.txt"), false);
  assert.equal(isPagePath("/images/profile.jpg"), false);
  assert.equal(markdownPath("/"), "/index.md");
  assert.equal(markdownPath("/about"), "/about/index.md");
  assert.equal(markdownPath("/about/index.html"), "/about/index.md");
  assert.equal(markdownPath("/stats.html"), null);
});

test("default export fails open to origin when handling throws", async () => {
  const realFetch = globalThis.fetch;
  let n = 0;
  globalThis.fetch = async (req) => {
    n += 1;
    if (n === 1) throw new Error("boom");
    return new Response("origin", { status: 200 });
  };
  try {
    const res = await worker.fetch(get("/", "text/markdown"));
    assert.equal(await res.text(), "origin");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("old /mobile-chiro/ links 301 to /rehab-plan/, keeping the query string", async () => {
  let called = false;
  const res = await handle(new Request("https://pickleballchiro.co/mobile-chiro/?utm_source=text"), async () => { called = true; return new Response("x"); });
  assert.equal(res.status, 301);
  assert.equal(res.headers.get("Location"), "https://pickleballchiro.co/rehab-plan/?utm_source=text");
  assert.equal(called, false);
  assert.equal(movedTarget("/mobile-chiro"), "/rehab-plan/");
  assert.equal(movedTarget("/mobile-chiro/index.md"), "/rehab-plan/index.md");
  assert.equal(movedTarget("/mobile-chiropractic/"), null);
  assert.equal(movedTarget("/rehab-plan/"), null);
});
