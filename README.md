# The Pickleball Chiro — Link-in-Bio Site

This is the site that lives at your Netlify URL and is linked from your Instagram bio.
It's a single-page HTML site — no frameworks, no databases, no complicated build steps.

---

## File Structure

```
pickleballchiro-site/
├── index.html        ← the main page (edit this for content changes)
├── stats.html        ← visit yoursite.com/stats to see button click data
├── css/
│   └── styles.css    ← all colors, fonts, spacing (edit this for design changes)
├── js/
│   └── main.js       ← button behavior, form behavior, click tracking
├── images/
│   └── profile.jpg   ← your profile photo (replace this file to update the photo)
└── README.md         ← this file
```

---

## How to Change the Profile Photo

1. Take your new photo and rename the file exactly: `profile.jpg`
2. Open the `images/` folder on your computer
3. Drag your new `profile.jpg` into the folder (replace the existing one)
4. Push to GitHub (see "How to Push Changes" below) — Netlify will update automatically

> The photo must be named `profile.jpg` exactly (lowercase). If you use a different name,
> the image will break on the live site.

---

## How to Update a Link

All links are in `index.html`. Open that file in any text editor (TextEdit, Notepad, VS Code).

Search for the label of the button you want to change — for example, `Get the Guide`.
Right above or inside that element you'll see `href="..."`. Replace the URL inside the quotes.

**Example — changing the Knee Pain Guide link:**
Find this:
```html
href="https://pickleballchiro.gumroad.com/l/pickleballkneepain"
```
Replace the URL between the quotes with your new link.

Booking links are currently placeholders (`#book-chiro`, `#book-mobile`, `#book-lesson`).
Each has a comment above it that says `<!-- TODO: Add real booking link here -->`.
Find those comments and replace the `#book-chiro` (etc.) with your real booking URL.

---

## How to Change the Prices

Open `index.html` and search for the dollar amount you want to change (e.g., `$150`).
Edit the number directly. Save the file and push to GitHub.

The pricing is in the "Book a Session" section inside `.pricing-row` elements:
```html
<div class="pricing-row"><span>60-min Intro</span><span>$150</span></div>
```
Change `$150` to whatever the new price is.

---

## How to Change Colors or Fonts

Open `css/styles.css`. The brand colors are all defined at the very top in `:root`:

```css
:root {
  --orange:    #F05A28;   /* Court Orange — used for buttons & accents */
  --dark:      #1A1A1A;   /* Page background */
  --off-white: #F0F0F0;   /* Body text */
  --white:     #FFFFFF;
  --gray-mid:  #888888;   /* Subtle text */
}
```

Change any hex value there and it will update everywhere on the page.

To change fonts, go to the Google Fonts link near the top of `index.html` and swap out
the font names, then update the `font-family` lines in `styles.css`.

---

## How to Connect a Real Email Service (ConvertKit, Mailchimp, etc.)

Right now the two forms (free checklist + virtual coaching interest) just show a
thank-you message — they don't actually send data anywhere.

When you're ready to connect them, search `js/main.js` for:
```
// TODO: Connect to email service (ConvertKit, Mailchimp, etc.)
```

There are two of these — one for each form. Replace those lines with the code snippet
your email service gives you (they all provide a copy-paste snippet for this).

Popular options: **ConvertKit** (great for creators), **Mailchimp** (free tier),
**Beehiiv** (newsletter-focused). All three have free plans to start.

---

## How to Check Button Click Analytics

Visit: `https:///`
(or whatever your Netlify URL is, with `/stats` at the end)

This shows you every button that was clicked, how many times, and when —
pulled from the browser's local storage on that device.

> **Limitation:** This only shows data from *your* browser. To see clicks from all
> visitors, replace the tracking with Plausible ($9/mo) or Fathom ($14/mo). Both are
> privacy-friendly and have simple copy-paste install steps. Look for the TODO comment
> at the top of `js/main.js`.

---

## How to Push Changes to GitHub (so the live site updates)

> Do this every time you make an edit and want it to go live.

### Option A — GitHub Desktop (easiest, no typing)
1. Open **GitHub Desktop**
2. You'll see a list of files you changed
3. Type a short note in the "Summary" box (e.g., "updated booking link")
4. Click **Commit to main**
5. Click **Push origin**
6. Netlify detects the push and rebuilds the site in ~30 seconds

### Option B — Command Line (Terminal)
```bash
cd path/to/pickleballchiro-site
git add .
git commit -m "describe what you changed"
git push
```

---

## GitHub + Netlify Setup (one-time steps)

### Step 1 — Create the GitHub Repository

1. Go to **github.com** and sign in (create a free account if you don't have one)
2. Click the **+** icon (top right) → **New repository**
3. Name it: `pickleballchiro-site`
4. Set it to **Private** (recommended) or Public — your choice
5. Do **not** check "Initialize with README" (you already have one)
6. Click **Create repository**
7. GitHub will show you a page with setup commands — copy the section that says
   **"…or push an existing repository from the command line"**

### Step 2 — Upload These Files to GitHub

**If you have GitHub Desktop (easiest):**
1. Download and install [GitHub Desktop](https://desktop.github.com/)
2. Click **File → Add Local Repository**
3. Select this folder (`IG Bio Link` or wherever these files live)
4. Click **Publish repository** → name it `pickleballchiro-site` → Publish

**If you're using Terminal:**
```bash
cd "/path/to/IG Bio Link"
git init
git add .
git commit -m "initial site build"
git remote add origin https://github.com/YOUR-USERNAME/pickleballchiro-site.git
git branch -M main
git push -u origin main
```
Replace `YOUR-USERNAME` with your actual GitHub username.

### Step 3 — Connect GitHub to Netlify

1. Log in at [app.netlify.com](https://app.netlify.com)
2. Go to your **pickleballchiro** project
3. Click **Site configuration** → **Build & deploy** → **Link repository**
   (or look for **"Connect to Git"** — the exact label may vary)
4. Choose **GitHub** and authorize Netlify to access your account
5. Select the `pickleballchiro-site` repository
6. On the build settings screen:
   - **Branch to deploy:** `main`
   - **Build command:** *(leave blank — this is a plain HTML site, no build step needed)*
   - **Publish directory:** `/` (or just leave it blank / use `.`)
7. Click **Deploy site**

From this point on: every time you push a change to GitHub, Netlify will automatically
rebuild and publish the site within about 30 seconds.

### Step 4 — Add Your Profile Photo to GitHub

Your profile photo (`lane.jpg`) has been copied to `images/profile.jpg` locally.
When you push the repo to GitHub (Step 2 above), it will be included automatically.

---

## Troubleshooting

**Profile photo not showing?**
Make sure the file is named exactly `profile.jpg` (lowercase) and is inside the `images/` folder.

**Fonts look wrong?**
The Google Fonts link requires an internet connection. They won't load if you're opening
the file directly from your computer without a web server. On the live Netlify site they'll
always load correctly.

**Changes pushed but site didn't update?**
Check the Netlify dashboard — go to your project and click **Deploys**. If a deploy failed,
there will be an error message there explaining why.
