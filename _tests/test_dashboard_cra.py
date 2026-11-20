"""Dashboard Video Queue -> "Open in CRA" (roadmap W7 M1d). Run from the repo root: python3 -m unittest discover _tests

Static checks on dashboard/ plus the link/copy helpers run under Node with synthetic ids. No network, no live data.
"""
import json
import os
import re
import shutil
import subprocess
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE = shutil.which("node")


def read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return f.read()


JS = read("dashboard/dashboard.js")
HTML = read("dashboard/index.html")
SW = read("dashboard/sw.js")
LINK_RE = r"^http://127\.0\.0\.1:8765/\?request=V\d{14,15}$"


def between(src, start, end):
    i = src.index(start)
    return src[i:src.index(end, i)]


@unittest.skipUnless(NODE, "Node.js not installed")
class HelpersUnderNode(unittest.TestCase):
    """Runs the real helper source from dashboard.js (esc/escAttr + the CRA block) with a fake localStorage."""

    def js(self, body):
        helpers = between(JS, "const esc = ", "const escAttr") + between(JS, "const escAttr", "\n") + "\n" + \
            between(JS, "const CRA_HERE_STORE", "async function copyRequestId")
        prelude = """
const assert = require('assert');
const store = new Map();
global.localStorage = { getItem: (k) => store.has(k) ? store.get(k) : null,
                        setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
""" + helpers + "\nconst LINK_RE = new RegExp(%s);\n" % json.dumps(LINK_RE)
        p = subprocess.run([NODE, "-e", prelude + body + "\nconsole.log('JS-OK');"], capture_output=True, text=True, timeout=30)
        self.assertEqual(p.returncode, 0, p.stderr[-2000:])
        self.assertIn("JS-OK", p.stdout)

    def test_setting_defaults_off_and_round_trips(self):
        self.js("""
assert.strictEqual(craHere(), false);
setCraHere(true);  assert.strictEqual(craHere(), true);
setCraHere(false); assert.strictEqual(craHere(), false);
global.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
assert.strictEqual(craHere(), false, 'storage unavailable = off');
setCraHere(true);   // must not throw
""")

    def test_link_only_with_the_setting_and_only_the_id(self):
        self.js("""
const id = 'V176360000000001';
assert.ok(LINK_RE.test(craOpenHref(id)));
const on = craAction(id, true);
assert.ok(on.includes('href="http://127.0.0.1:8765/?request=V176360000000001"'));
assert.ok(on.includes('target="_blank"') && on.includes('rel="noopener noreferrer"'));
assert.ok(on.includes('Open in CRA'));
const off = craAction(id, false);
assert.ok(off.includes('data-copy="V176360000000001"') && off.includes('Copy ID'));
assert.ok(!off.includes('href') && !off.includes('127.0.0.1'), 'no link without the setting');
for (const h of [on, off]) assert.ok(!h.includes('data-action'), 'never a complete/delete control');
assert.ok(LINK_RE.test(craOpenHref('V17636000000000')));   // 14 digits
""")

    def test_bad_ids_get_nothing(self):
        self.js("""
for (const bad of ['', null, undefined, 'V1763', 'v176360000000001', 'V1763600000000012345', ' V176360000000001',
                   'V176360000000001"><script>', 'Synthetic Player', 'rev_abc', 42])
  for (const here of [true, false]) {
    assert.strictEqual(craOpenHref(bad), null, String(bad));
    assert.strictEqual(craAction(bad, here), '', String(bad));
  }
""")


class StaticChecks(unittest.TestCase):
    def test_no_background_calls_to_cra(self):
        csp = re.search(r'Content-Security-Policy" content="(.*?)"', HTML, re.S).group(1)
        connect = re.search(r"connect-src([^;]*)", csp).group(1)
        self.assertNotIn("127.0.0.1", connect)
        self.assertNotIn("localhost", connect)
        # the only place 127.0.0.1 appears in the script is the link builder
        self.assertEqual(len(re.findall(r"127\.0\.0\.1", JS)),
                         len(re.findall(r"127\.0\.0\.1", between(JS, "/* ------- open a request's review", "async function copyRequestId"))))
        block = between(JS, "/* ------- open a request's review", "/* ------- ")
        for word in ("fetch(", "XMLHttpRequest", "sendBeacon", "WebSocket", "webhookGet", "videoAction"):
            self.assertNotIn(word, block)

    def test_complete_and_delete_unchanged_and_separate(self):
        render = between(JS, "function renderVideoQueue(", "function showVideoError(")
        self.assertIn('data-action="complete" data-id="${escAttr(v.id)}"', render)
        self.assertIn('data-action="delete" data-id="${escAttr(v.id)}"', render)
        self.assertIn('querySelectorAll("[data-action]")', render)
        self.assertIn('querySelectorAll("[data-copy]")', render)
        self.assertIn('videoAction(btn.getAttribute("data-action") === "complete" ? "complete_video" : "delete_video", { id })', render)
        # the open/copy control sits inside the text, not beside the buttons
        self.assertIn("${esc(v.video)}${craAction(v.id, here)}</span>", render)

    def test_setting_and_hint_in_page(self):
        self.assertIn('id="cra-here"', HTML)
        self.assertRegex(HTML, r'id="cra-hint" class="cra-hint hidden"')
        hint = re.search(r'id="cra-hint"[^>]*>(.*?)</p>', HTML, re.S).group(1)
        self.assertIn("Start Coaching Review from the Dock", hint)
        self.assertIn("creates nothing", hint)

    def test_cache_versions_move_together(self):
        shell = re.search(r'SHELL_VERSION = "v(\d+)"', SW).group(1)
        for ref in re.findall(r'dashboard\.(?:js|css)\?v=(\d+)', HTML) + re.findall(r'dashboard\.(?:js|css)\?v=(\d+)', SW):
            self.assertEqual(ref, shell)
        self.assertGreaterEqual(int(shell), 24)


if __name__ == "__main__":
    unittest.main()
