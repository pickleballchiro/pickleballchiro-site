# The Pickleball Chiro — pickleballchiro.co

This is the site that lives at **pickleballchiro.co** (deployed via **GitHub Pages** — the
`CNAME` file wires the custom domain, do not delete it). No frameworks, no databases,
no build steps. Push to `main` and the live site updates in a minute or two.

---

## Pages

| URL | File | What it is |
|---|---|---|
| `pickleballchiro.co/` | `index.html` | Main landing page — quiz-first funnel, reviews, offers |
| `pickleballchiro.co/links/` | `links/index.html` | Link-in-bio hub (this is the Instagram bio link) |
| `pickleballchiro.co/quiz/` | `quiz/index.html` | "Why You're Stuck at 3.5" self-diagnosis quiz (+ crawlable question outline below it) |
| `pickleballchiro.co/why-youre-stuck-at-3-5/` | `why-youre-stuck-at-3-5/index.html` | The pillar article (hub): the five leaks, full teach, Article + FAQ schema |
| `pickleballchiro.co/third-shot-drive-or-drop/` | `third-shot-drive-or-drop/index.html` | Spoke article #1: the three-read third-shot checklist (Leak 1). Copy this file's pattern for the next spokes |
| `pickleballchiro.co/pickleball-knee-pain/` | `pickleball-knee-pain/index.html` | Knee-pain article: 3-stage fix, cited references, Course schema for The Pickleball Knee Fix |
| `pickleballchiro.co/mobile-chiro/` | `mobile-chiro/index.html` | Mobile chiropractic service page: pricing, service area, FAQ |
| `pickleballchiro.co/lessons/` | `lessons/index.html` | In-person lessons: pricing, courts, FAQ, Google Form booking |
| `pickleballchiro.co/pickleball-coaches-daytona-beach/` | `pickleball-coaches-daytona-beach/index.html` | "How I'm different from the average lesson" page targeting *pickleball coach Daytona Beach* queries (ChatGPT/Bing). **Names no other coach or facility** (Lane's rule, Sep 15 2026). Article + FAQ schema |
| `pickleballchiro.co/virtual-coaching/` | `virtual-coaching/index.html` | Virtual coaching via Crestline: plans, how it works, FAQ |
| `pickleballchiro.co/about/` | `about/index.html` | Credentials and story |
| `pickleballchiro.co/privacy/`, `/terms/` | `privacy/`, `terms/` | Legal pages (Terms carries the medical disclaimer) |
| `pickleballchiro.co/90daysto40/` | `90daysto40/index.html` | **Retired.** noindex stub pointing at lessons/Crestline; not in the sitemap |
| `pickleballchiro.co/404.html` | `404.html` | Custom not-found page (GitHub Pages serves it for any missing path) |
| `pickleballchiro.co/stats.html` | `stats.html` | Private click-analytics viewer (this browser only) |

**AI / search plumbing** (all at the root): `robots.txt` (every AI crawler allowed + `Content-Signal`), `sitemap.xml`
(only bump `lastmod` on pages you actually changed), `llms.txt` (facts + links for AI systems), `llms-full.txt`
(plain-text mirror of every page — regenerate after any copy change with `python3 build-llms-full.py`), `favicon.ico` / `favicon-32.png` /
`apple-touch-icon.png`, and a 32-hex `*.txt` IndexNow key file (don't delete it; Bing uses it to verify pings).

**Structured data:** every page carries the same `Person` (`#lane-odom`), `LocalBusiness` (`#business`, incl. opening
hours from the Google Business Profile), and `WebSite` (`#website`) JSON-LD in `<head>`; inner pages add a `BreadcrumbList`.
If you change the business node, change it on the homepage and copy it to every other page so the entity stays identical. Postal locality is Daytona Beach 32117 — keep it identical across pages. Canonical facts live in the
main repo's `06 Reference/FACTS.md`.

## Adding an article (the spoke pattern)

1. Copy `third-shot-drive-or-drop/index.html` to `<slug>/index.html`. Change: `<title>`, meta description, canonical, every `og:`/`twitter:` tag, the `Article` node (`@id`, headline, description, url, image, dates, wordCount), the `BreadcrumbList`, and the `FAQPage` (its answers must be the exact visible `.faq-answer` text). Leave the three shared entity nodes (`#lane-odom`, `#business`, `#website`) untouched.
2. Use `/images/og-lane-1200x630.jpg` (or a new 1200×630 image) for `og:image` / `twitter:image` / Article `image`.
3. Link the new page from the hub article (`/why-youre-stuck-at-3-5/`) and the homepage quiz card note.
4. Add a `<url>` to `sitemap.xml`, a bullet under **Free Resources** in `llms.txt`, and a tuple to `PAGES` in `build-llms-full.py`; then run `python3 build-llms-full.py`.
5. Push. Then POST the URL to IndexNow (see below) and request indexing in Search Console.

**IndexNow ping** (Bing/Copilot/ChatGPT search; the key file is already hosted):
```
curl -s -X POST https://api.indexnow.org/indexnow -H 'Content-Type: application/json; charset=utf-8' \
  -d '{"host":"pickleballchiro.co","key":"e3a6ec4da849dba154f7c93884028fa6","keyLocation":"https://pickleballchiro.co/e3a6ec4da849dba154f7c93884028fa6.txt","urlList":["https://pickleballchiro.co/<slug>/"]}'
```

## File Structure

```
pickleballchiro-site/
├── index.html          ← main landing page
├── links/index.html    ← link-in-bio page (own layout, shares styles.css)
├── quiz/index.html     ← quiz (fully self-contained: own styles + scripts)
├── lessons/, virtual-coaching/, about/, privacy/, terms/  ← subpages (share styles.css + main.js)
├── 90daysto40/index.html ← retired stub (noindex)
├── 404.html            ← custom not-found page
├── styles.css          ← design system: colors, fonts, cards, buttons (/, /links, /90daysto40)
├── main.js             ← click tracking, scroll animations, sticky bar (/ and /90daysto40)
├── analytics.js        ← Google Analytics (GA4) config — one ID for every page
├── stats.html          ← click-event viewer
├── CNAME               ← pickleballchiro.co (DO NOT DELETE)
└── images/             ← profile, guide covers, gear tiles, highlight photos
```

---

## Common Edits

**Change a link or price:** open the page's HTML file, search for the button text or
dollar amount, edit the `href="..."` or the number, save, push.

**Change the quiz's coaching link:** in `quiz/index.html`, search for `COACHING_LINK =`
and change the URL in quotes (currently the Crestline coach page). One line updates every button.

**Add a Google review:** in `index.html`, find the comment
`<!-- To add more reviews: ... -->` in the reviews section, copy an existing
`.review-card` block, and paste in the new review text, name, and first initial.

**Change the profile photo:** replace `images/profile.jpg` (must keep that exact
name, lowercase) and also `profile.jpg` at the root (used by the main page).
Then regenerate the small hero variant: `sips --resampleWidth 192 profile.jpg --out images/profile-192.jpg`.
The carousel and gear tiles use `-480`/`-440` variants next to the originals; make one the same way if you add an image.

**Change colors:** everything is defined at the top of `styles.css` in `:root`.
`--orange` is the brand accent; `--dark` is the page background. The quiz has its
own matching `:root` block in `quiz/index.html`.

---

## Analytics

- **Google Analytics 4** runs on every page (`analytics.js`, ID `G-NV3RTC7XXK`).
  Every button click fires a `cta_click` event with a label — see them in
  GA4 → Reports → Engagement → Events.
- **`/stats.html`** shows the same clicks from *this browser only* (localStorage).
  Quick spot-check tool, not real analytics.

---

## How to Push Changes (so the live site updates)

### Option A — GitHub Desktop (easiest)
1. Open **GitHub Desktop** — you'll see the files you changed
2. Type a short note in "Summary" (e.g., "updated lesson price")
3. Click **Commit to main**, then **Push origin**
4. GitHub Pages redeploys automatically in ~1–2 minutes

### Option B — Terminal
```bash
cd path/to/pickleballchiro-site
git add .
git commit -m "describe what you changed"
git push
```

**Changes pushed but site didn't update?** GitHub Pages can take a couple of minutes
and your browser may cache the old page — hard-refresh (Cmd+Shift+R). You can also
check the repo's **Actions** tab on GitHub for the "pages build and deployment" run.

---

## Troubleshooting

**Profile photo not showing?** File must be named exactly `profile.jpg` (lowercase).

**Fonts look wrong locally?** Google Fonts need an internet connection, and the site
must be viewed through a web server (not opened as a file). To preview locally:
```bash
cd path/to/pickleballchiro-site
python3 -m http.server 8000
```
then open http://localhost:8000

**Site down or domain broken?** Make sure `CNAME` still exists in the repo root and
contains exactly `pickleballchiro.co`.
