"""Checks for the agent-readiness files. Run from the repo root: python3 -m unittest discover _tests"""
import glob
import json
import os
import re
import unittest
import xml.dom.minidom

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = "https://pickleballchiro.co"


def read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return f.read()


def json_ld_nodes(html):
    nodes = []
    for block in re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, re.S):
        data = json.loads(block)
        nodes.extend(data.get("@graph", [data]))
    return nodes


def business_node(html):
    for node in json_ld_nodes(html):
        if node.get("@id") == SITE + "/#business":
            return node
    return None


def visible_text(html):
    body = html.split("<body", 1)[1]
    body = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", body, flags=re.S)
    body = re.sub(r"<!--.*?-->", " ", body, flags=re.S)
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", body)).strip()


def pages_list():
    # PAGES from the build script, without running its file-writing body
    src = read("build-llms-full.py")
    block = re.search(r"^PAGES = \[.*?^\]", src, re.S | re.M).group(0)
    scope = {}
    exec(block, scope)
    return scope["PAGES"]


PAGE_FILES = ["index.html"] + sorted(
    f for f in (os.path.relpath(p, ROOT) for p in glob.glob(os.path.join(ROOT, "*/index.html")))
    if not f.startswith(("dashboard/", "_"))
)


class OrganizationSchema(unittest.TestCase):
    def test_every_page_business_node_has_contact_point_and_address(self):
        for f in PAGE_FILES:
            node = business_node(read(f))
            self.assertIsNotNone(node, f)
            self.assertEqual(node["address"]["@type"], "PostalAddress", f)
            cps = node["contactPoint"]
            self.assertTrue(cps, f)
            for cp in cps:
                self.assertEqual(cp["@type"], "ContactPoint", f)
                self.assertTrue(cp["contactType"], f)
                self.assertEqual(cp["telephone"], node["telephone"], f)
                self.assertEqual(cp["email"], node["email"], f)

    def test_business_node_identical_across_pages(self):
        home = business_node(read("index.html"))
        for f in PAGE_FILES:
            node = business_node(read(f))
            # The homepage node also carries the visible reviews; compare everything else.
            strip = lambda n: {k: v for k, v in n.items() if k not in ("review", "@context")}
            self.assertEqual(strip(node), strip(home), f)


class WikidataLinks(unittest.TestCase):
    def test_person_and_business_link_their_wikidata_items(self):
        expected = {SITE + "/#lane-odom": "https://www.wikidata.org/wiki/Q141693778",
                    SITE + "/#business": "https://www.wikidata.org/wiki/Q141693780"}
        for f in PAGE_FILES:
            for node in json_ld_nodes(read(f)):
                if node.get("@id") in expected and "sameAs" in node:
                    self.assertIn(expected[node["@id"]], node["sameAs"], (f, node["@id"]))


class ContactPage(unittest.TestCase):
    def setUp(self):
        self.html = read("contact/index.html")

    def test_has_substantial_content(self):
        self.assertGreaterEqual(len(visible_text(self.html)), 500)

    def test_shows_contact_details_and_survives_email_obfuscation(self):
        self.assertIn("<!--email_off-->", self.html)
        self.assertIn("mailto:drlanepickleballchiro@gmail.com", self.html)
        self.assertIn("tel:+14079956966", self.html)
        self.assertIn('<link rel="canonical" href="https://pickleballchiro.co/contact/" />', self.html)

    def test_contact_page_schema(self):
        types = [n.get("@type") for n in json_ld_nodes(self.html)]
        self.assertIn("ContactPage", types)
        self.assertIn("BreadcrumbList", types)

    def test_linked_from_footers(self):
        for f in ["index.html", "404.html", "about/index.html", "lessons/index.html", "privacy/index.html"]:
            self.assertIn('href="/contact/"', read(f), f)

    def test_no_retired_or_private_names(self):
        for f in ["contact/index.html", "llms.txt"]:
            text = read(f)
            for banned in ["Insight", "Calendly", "calendly.com"]:
                self.assertNotIn(banned, text, f)


class LlmsTxt(unittest.TestCase):
    def setUp(self):
        self.text = read("llms.txt")
        self.lines = self.text.splitlines()

    def test_spec_shape(self):
        # llmstxt.org: H1, then a blockquote, then non-heading sections, then H2 link lists
        self.assertTrue(self.lines[0].startswith("# "))
        first_content = next(l for l in self.lines[1:] if l.strip())
        self.assertTrue(first_content.startswith("> "))
        first_h2 = next(i for i, l in enumerate(self.lines) if l.startswith("## "))
        for l in self.lines[1:first_h2]:
            self.assertFalse(l.startswith("#"), l)

    def test_agent_guidance(self):
        self.assertIn("When to use Pickleball Chiro", self.text)
        self.assertIn("How to send someone here", self.text)
        self.assertIn("https://pickleballchiro.co/contact/", self.text)
        self.assertIn("text/markdown", self.text)


class MarkdownTwins(unittest.TestCase):
    def test_every_published_page_has_a_markdown_twin(self):
        for title, url, path in pages_list():
            md = os.path.join(os.path.dirname(path), "index.md")
            text = read(md)
            self.assertTrue(text.startswith("# " + title), md)
            self.assertIn("Canonical: " + url, text, md)
            self.assertGreater(len(text), 200, md)

    def test_twins_have_no_front_matter(self):
        # Jekyll would turn a front-mattered index.md into index.html and clobber the real page
        for md in glob.glob(os.path.join(ROOT, "**/index.md"), recursive=True):
            with open(md, encoding="utf-8") as f:
                self.assertFalse(f.read().startswith("---"), md)

    def test_nojekyll_present(self):
        # Without it, GitHub Pages' optional-front-matter plugin can render index.md over index.html
        self.assertTrue(os.path.exists(os.path.join(ROOT, ".nojekyll")))

    def test_contact_in_build_pages(self):
        self.assertIn("contact/index.html", [p for _, _, p in pages_list()])


class Sitemap(unittest.TestCase):
    def test_valid_and_lists_contact(self):
        doc = xml.dom.minidom.parseString(read("sitemap.xml"))
        locs = [n.firstChild.nodeValue for n in doc.getElementsByTagName("loc")]
        self.assertIn(SITE + "/contact/", locs)
        for loc in locs:
            path = loc[len(SITE):].lstrip("/")
            self.assertTrue(os.path.exists(os.path.join(ROOT, path, "index.html")) or os.path.exists(os.path.join(ROOT, path)), loc)


if __name__ == "__main__":
    unittest.main()
