#!/usr/bin/env python3
"""Regenerate llms-full.txt from the public pages. Run after any copy change: python3 build-llms-full.py"""
import datetime, html, re
from html.parser import HTMLParser

PAGES = [
    ("Homepage", "https://pickleballchiro.co/", "index.html"),
    ("Why You're Stuck at 3.5: The Five Leaks (article)", "https://pickleballchiro.co/why-youre-stuck-at-3-5/", "why-youre-stuck-at-3-5/index.html"),
    ("Third Shot Drive or Drop? The Three-Read Checklist (article)", "https://pickleballchiro.co/third-shot-drive-or-drop/", "third-shot-drive-or-drop/index.html"),
    ("Pickleball Knee Pain: The 3-Stage Fix (article)", "https://pickleballchiro.co/pickleball-knee-pain/", "pickleball-knee-pain/index.html"),
    ("About Dr. Lane Odom", "https://pickleballchiro.co/about/", "about/index.html"),
    ("In-Person Pickleball Lessons", "https://pickleballchiro.co/lessons/", "lessons/index.html"),
    ("Pickleball Coach in Daytona Beach: How I'm Different From the Average Lesson", "https://pickleballchiro.co/pickleball-coaches-daytona-beach/", "pickleball-coaches-daytona-beach/index.html"),
    ("Mobile Chiropractic & Rehab Care", "https://pickleballchiro.co/mobile-chiro/", "mobile-chiro/index.html"),
    ("Virtual Pickleball Coaching", "https://pickleballchiro.co/virtual-coaching/", "virtual-coaching/index.html"),
    ("Why You're Stuck at 3.5 — Free Self-Diagnosis (quiz)", "https://pickleballchiro.co/quiz/", "quiz/index.html"),
    ("Links / Bio Hub", "https://pickleballchiro.co/links/", "links/index.html"),
]

HEADER = """# Dr. Lane Odom — The Pickleball Chiro (full site text)

> Plain-text rendering of every public page on https://pickleballchiro.co/ for AI systems. Generated {date}. Canonical facts: Dr. Lane Odom, DC — Doctor of Chiropractic (Palmer College of Chiropractic Florida, 2025), PCI Level 1 certified pickleball coach, 4.7 DUPR, 13+ years of racket sports experience. Pickleball Chiro LLC, Daytona Beach, FL 32117 (Ormond Beach line), serving Volusia County; virtual coaching anywhere via Crestline. Phone +1 407-995-6966.

"""

SKIP_TAGS = {"script", "style", "noscript", "svg", "template", "nav", "footer", "form", "button", "select", "option", "input"}
VOID = {"br", "img", "input", "meta", "link", "hr", "source", "wbr"}
BLOCK = {"p", "li", "h1", "h2", "h3", "h4", "div", "section", "article", "summary", "details", "tr", "blockquote", "td", "th"}


class Text(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out, self.buf, self.tag = [], [], None
        self.skip_stack, self.in_body = [], False

    @property
    def skip(self):
        return len(self.skip_stack)

    def flush(self):
        t = re.sub(r"\s+", " ", "".join(self.buf)).strip()
        self.buf = []
        if not t:
            return
        prefix = {"h1": "## ", "h2": "### ", "h3": "#### ", "h4": "##### ", "li": "- "}.get(self.tag, "")
        self.out.append(prefix + t)

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "body":
            self.in_body = True
        if tag in VOID:
            if tag == "br":
                self.buf.append(" ")
            return
        if tag in SKIP_TAGS or a.get("aria-hidden") == "true" or a.get("hidden") is not None:
            self.skip_stack.append(tag)
            return
        if self.skip_stack:
            self.skip_stack.append(None)
            return
        if tag in BLOCK:
            self.flush()
            self.tag = tag

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        if self.skip_stack:
            self.skip_stack.pop()
            return
        if tag in BLOCK:
            self.flush()
            self.tag = None

    def handle_data(self, data):
        if self.in_body and not self.skip:
            self.buf.append(data)


def page_text(path):
    src = open(path, encoding="utf-8").read()
    src = re.sub(r"<!--.*?-->", "", src, flags=re.S)
    p = Text()
    p.feed(src)
    p.flush()
    lines, prev = [], None
    for line in p.out:
        if line == prev:
            continue
        lines.append(line)
        prev = line
    return "\n\n".join(lines)


out = [HEADER.format(date=datetime.date.today().isoformat())]
for title, url, path in PAGES:
    out.append(f"---\n\n# {title}\n\nURL: {url}\n\n{page_text(path)}\n\n")
open("llms-full.txt", "w", encoding="utf-8").write("".join(out).rstrip() + "\n")
print("wrote llms-full.txt", len(open("llms-full.txt").read().split()), "words")
