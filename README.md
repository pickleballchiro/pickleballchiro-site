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
| `pickleballchiro.co/quiz/` | `quiz/index.html` | "Why You're Stuck at 3.5" self-diagnosis quiz |
| `pickleballchiro.co/stats.html` | `stats.html` | Private click-analytics viewer (this browser only) |

## File Structure

```
pickleballchiro-site/
├── index.html          ← main landing page
├── links/index.html    ← link-in-bio page (own layout, shares styles.css)
├── quiz/index.html     ← quiz (fully self-contained: own styles + scripts)
├── styles.css          ← design system: colors, fonts, cards, buttons (/ and /links)
├── main.js             ← click tracking, scroll animations, sticky bar (/ only)
├── analytics.js        ← Google Analytics (GA4) config — one ID for every page
├── stats.html          ← click-event viewer
├── CNAME               ← pickleballchiro.co (DO NOT DELETE)
└── images/             ← profile, guide covers, gear tiles, highlight photos
```

---

## Common Edits

**Change a link or price:** open the page's HTML file, search for the button text or
dollar amount, edit the `href="..."` or the number, save, push.

**Change the quiz's Calendly link:** in `quiz/index.html`, search for `BOOKING_LINK =`
and change the URL in quotes. One line updates every button.

**Add a Google review:** in `index.html`, find the comment
`<!-- To add more reviews: ... -->` in the reviews section, copy an existing
`.review-card` block, and paste in the new review text, name, and first initial.

**Change the profile photo:** replace `images/profile.jpg` (must keep that exact
name, lowercase) and also `profile.jpg` at the root (used by the main page).

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
