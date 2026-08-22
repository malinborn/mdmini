# md-mini.com Migration, New Icon, Claude Design Prompt — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the new app icon across all assets, produce a copy-paste-ready Claude Design brief, and move the site from GitHub Pages to md-mini.com (nginx + GH Actions deploy) with full SEO handover.

**Architecture:** Static site stays a single `docs/index.html`; the same file serves on both GitHub Pages (archive, canonical → new domain, JS redirect) and md-mini.com (nginx). Deploy is rsync-over-SSH from GitHub Actions on push to main. Icon set regenerated from one versioned 1024px source via `tauri icon`.

**Tech Stack:** Tauri CLI (icon gen), macOS `sips` (favicon resize), nginx + certbot, GitHub Actions, rsync.

**Spec:** `docs/superpowers/specs/2026-08-22-site-redesign-migration-design.md`

---

### Task 1: New icon assets

**Files:**
- Modify: `icon.png` (repo root — replaced by new source)
- Modify: `src-tauri/icons/*` (regenerated)
- Create: `docs/favicon-32.png`, `docs/apple-touch-icon.png`
- Modify: `docs/index.html:43` (favicon links)

- [ ] **Step 1: Copy new icon source into the repo**

```bash
cp ~/Downloads/md-icon-1024.png icon.png
```

Verify: `sips -g pixelWidth -g pixelHeight icon.png` → `pixelWidth: 1024`, `pixelHeight: 1024`.

- [ ] **Step 2: Regenerate the Tauri icon set**

```bash
npx tauri icon icon.png
```

Expected: log lines for `icons/32x32.png`, `icons/128x128.png`, `icons/icon.icns`, `icons/icon.ico`, iOS/Android sets. Verify: `git status --short src-tauri/icons | head` shows modified files, and `open src-tauri/icons/icon.icns` shows the new icon in Preview.

- [ ] **Step 3: Generate site favicons with sips**

```bash
sips -z 32 32 icon.png --out docs/favicon-32.png
sips -z 180 180 icon.png --out docs/apple-touch-icon.png
```

Verify: `file docs/favicon-32.png docs/apple-touch-icon.png` → both `PNG image data`, 32x32 and 180x180.

- [ ] **Step 4: Replace the inline-SVG favicon in index.html**

In `docs/index.html` line 43, replace the whole `<link rel="icon" type="image/svg+xml" ... />` line with:

```html
  <link rel="icon" type="image/png" sizes="32x32" href="favicon-32.png" />
  <link rel="apple-touch-icon" href="apple-touch-icon.png" />
```

- [ ] **Step 5: Visual check**

```bash
python3 -m http.server 8899 -d docs &
sleep 1 && curl -sI http://localhost:8899/favicon-32.png | head -1
kill %1
```

Expected: `HTTP/1.0 200 OK`. (Full favicon render check happens in Task 3's browser check.)

- [ ] **Step 6: Commit**

```bash
git add icon.png src-tauri/icons docs/favicon-32.png docs/apple-touch-icon.png docs/index.html
git commit -m "feat: new app icon — gradient md with caret"
```

---

### Task 2: Claude Design prompt

**Files:**
- Create: `docs/superpowers/specs/2026-08-22-claude-design-site-prompt.md`

- [ ] **Step 1: Write the prompt file with exactly this content**

````markdown
# Claude Design Brief — md-mini.com

> Paste everything below the line into Claude Design. Upload two assets alongside it:
> `icon.png` (1024px app icon) and `docs/screenshot.png` (app screenshot).

---

Design a product landing page for **mdmini** — a minimalist live-preview markdown editor for macOS. Free, open source (GPL-3.0), built with Tauri. The audience is developers and technical users who live in the terminal and care about speed, focus, and native feel.

## Brand

The uploaded app icon is the visual anchor: a rounded square with a violet→teal gradient, white serif "md" letters, and a pink→cyan text caret. Derive the design system from it:

- Gradient (brand surface): `#7068d5` → `#6e8cc0` → `#7dc8c4`
- Accent (the caret — use sparingly, as THE single accent): `#f590e1` → `#72dcfd`
- Brand letters: white, serif
- Typography: **Merriweather** (serif) for display/brand moments, **Inter** for body, **JetBrains Mono** for code and terminal blocks — these exact fonts ship inside the app, so the site and app feel like one product
- Both **light and dark** themes, honoring `prefers-color-scheme`; dark is the primary mood

Tone: calm, precise, quietly confident. No marketing fluff, no exclamation marks. The page should feel like a well-typeset document — fitting for a markdown editor.

## Page structure (single page, anchor nav)

1. **Hero** — app icon, name "mdmini", tagline: "A minimalist live-preview markdown editor for macOS. Lightweight, fast, and distraction-free." Install command in a copyable code block: `brew tap malinborn/mdmini && brew trust malinborn/mdmini && brew install --cask mdmini`. Badges: macOS · free · open source. The uploaded screenshot displayed prominently.
2. **Features** — 12 cards:
   - **Live Preview** — Markdown renders inline as you type. No split pane, no preview toggle.
   - **GFM Tables** — Create, edit, reorder, and delete table rows and columns. Drag to reorder.
   - **Collapsible Headings** — Click any heading to fold the section below it. Keeps long docs navigable.
   - **Syntax-Highlighted Code** — Fenced code blocks render with language-aware syntax highlighting.
   - **Mermaid Diagrams** — Flowcharts, sequence, class, Gantt, ER, pie, mindmap — all render inline as SVG. Pinch to zoom, swipe to pan around the big ones.
   - **Secret Masking** — Secret values in `.env` and shell configs (`.zshrc`, `.bashrc`) are masked by default. Cursor or Cmd+E to reveal.
   - **File Watching** — External changes to open files are detected and reloaded automatically.
   - **CLI Launcher** — Open files instantly from the terminal with `mdmini file.md`.
   - **Dock Drop** — Drag any file onto the Dock icon to open it. Works with multiple files at once.
   - **Session Restore** — Reopen the windows you had last time with ⇧⌘T — files, positions, scroll, and unsaved drafts.
   - **Dark & Light Themes** — Rosé Pine dark and Rosé Pine Dawn. Switch with a single keypress.
   - **Auto-Save & Recovery** — Changes are saved continuously. Crash recovery restores your last session.
3. **Quick start** — a styled macOS terminal window showing: the brew install command, `mdmini README.md` ("Opens in a native macOS window"), `mdmini *.md notes/*.md` ("Each file gets its own window"), and `brew update && brew upgrade --cask mdmini`.
4. **Changelog** — collapsible or compact release list (content will be carried over during integration; design the pattern for a version number + date + a few short entries per release).
5. **Footer** — GitHub link (https://github.com/malinborn/mdmini), GPL-3.0 license note.

## Hard constraints

- Static output only: plain HTML/CSS/JS, no build step, no frameworks
- No external CDNs or third-party requests; fonts self-hosted (woff2)
- Semantic HTML: exactly one `<h1>`, meaningful heading hierarchy, `<nav>`, `<section>`, alt texts
- Responsive from 360px to wide desktop; wide content scrolls in its own container
- Lighthouse ≥95 in all categories (performance, accessibility, best practices, SEO)

## SEO (must be present in the generated HTML)

- `<title>`: "mdmini — Minimalist Markdown Editor for macOS"
- Meta description: "Free minimalist markdown editor for macOS with live preview, mermaid diagrams, GFM tables, syntax highlighting. Built with Tauri, lightweight and fast."
- `<link rel="canonical" href="https://md-mini.com/">`
- Full Open Graph + Twitter Card meta (og:url https://md-mini.com/, og:image https://md-mini.com/screenshot.png)
- JSON-LD `SoftwareApplication`: name mdmini, applicationCategory DeveloperApplication, operatingSystem macOS, price 0 USD, url https://md-mini.com/, downloadUrl https://github.com/malinborn/mdmini/releases, license GPL-3.0

## Handoff

When the design is approved, package it as a handoff bundle for Claude Code. Integration target: the `docs/` directory of the mdmini repo (single `index.html` plus assets), deployed to https://md-mini.com/ via existing CI.
````

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-08-22-claude-design-site-prompt.md
git commit -m "docs: add claude design brief for site redesign"
```

---

### Task 3: Domain switch in site files

**Files:**
- Modify: `docs/index.html` (6 URL lines + JS redirect snippet)
- Modify: `docs/sitemap.xml`, `docs/robots.txt`, `docs/llms.txt`

- [ ] **Step 1: Replace all github.io URLs in index.html**

```bash
sed -i '' 's|https://malinborn\.github\.io/mdmini/|https://md-mini.com/|g' docs/index.html
```

Verify: `grep -c 'malinborn.github.io' docs/index.html` → `0`, and `grep -n 'md-mini.com' docs/index.html` shows lines 9, 10, 16, 17, 24, 36 (canonical, llms alternate, og:url, og:image, twitter:image, JSON-LD url).

- [ ] **Step 2: Add the archive JS redirect**

In `docs/index.html`, immediately after the canonical link (line 9), insert:

```html
  <script>
    if (location.hostname.endsWith('.github.io')) {
      location.replace('https://md-mini.com' + location.pathname.replace(/^\/mdmini/, '') + location.search + location.hash);
    }
  </script>
```

- [ ] **Step 3: Update sitemap.xml**

Replace the `<loc>` line and bump lastmod:

```xml
    <loc>https://md-mini.com/</loc>
    <lastmod>2026-08-22</lastmod>
```

- [ ] **Step 4: Update robots.txt**

```
User-agent: *
Allow: /

Sitemap: https://md-mini.com/sitemap.xml
```

- [ ] **Step 5: Update llms.txt**

Line 30: `- Website: https://malinborn.github.io/mdmini/` → `- Website: https://md-mini.com/`

- [ ] **Step 6: Verify no old URLs remain in deployable files**

```bash
grep -rn 'malinborn.github.io' docs --include='*.html' --include='*.xml' --include='*.txt'
```

Expected: no output.

- [ ] **Step 7: Browser check**

```bash
python3 -m http.server 8899 -d docs
```

Open http://localhost:8899 — page renders, new favicon visible in the tab, no redirect fires (hostname is localhost). Stop the server.

- [ ] **Step 8: Commit**

```bash
git add docs/index.html docs/sitemap.xml docs/robots.txt docs/llms.txt
git commit -m "feat: point site at md-mini.com — canonical, sitemap, archive redirect"
```

---

### Task 4: nginx config + server setup guide

**Files:**
- Create: `deploy/nginx/md-mini.com.conf`
- Create: `deploy/nginx/md-mini.com-bootstrap.conf`
- Create: `deploy/README.md`

- [ ] **Step 1: Write the bootstrap config (pre-certificate, port 80 only)**

`deploy/nginx/md-mini.com-bootstrap.conf`:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name md-mini.com www.md-mini.com;

    root /var/www/md-mini.com;
    index index.html;
}
```

- [ ] **Step 2: Write the final config**

`deploy/nginx/md-mini.com.conf`:

```nginx
# md-mini.com — static site
# Applied after certbot has issued the certificate (see deploy/README.md).

server {
    listen 80;
    listen [::]:80;
    server_name md-mini.com www.md-mini.com;
    return 301 https://md-mini.com$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name www.md-mini.com;

    ssl_certificate     /etc/letsencrypt/live/md-mini.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/md-mini.com/privkey.pem;
    include             /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam         /etc/letsencrypt/ssl-dhparams.pem;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    return 301 https://md-mini.com$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name md-mini.com;

    root /var/www/md-mini.com;
    index index.html;

    ssl_certificate     /etc/letsencrypt/live/md-mini.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/md-mini.com/privkey.pem;
    include             /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam         /etc/letsencrypt/ssl-dhparams.pem;

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml text/plain application/xml;
    gzip_min_length 1024;
    gzip_vary on;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Content-Security-Policy "frame-ancestors 'none'" always;

    location / {
        try_files $uri $uri/ =404;
        add_header Cache-Control "no-cache" always;
        # add_header in a location replaces ALL inherited add_header directives,
        # so security headers are repeated here.
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Content-Security-Policy "frame-ancestors 'none'" always;
    }

    location ~* \.(png|jpg|jpeg|webp|ico|woff2)$ {
        add_header Cache-Control "public, max-age=2592000" always;
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Content-Security-Policy "frame-ancestors 'none'" always;
    }
}
```

- [ ] **Step 3: Write the setup guide**

`deploy/README.md`:

````markdown
# Deploying md-mini.com

Static site lives in `docs/`, served by nginx from `/var/www/md-mini.com`.
Pushes to `main` touching `docs/**` auto-deploy via `.github/workflows/deploy-site.yml`.

## One-time server setup

1. **DNS** — create records pointing at the server:
   - `A md-mini.com → <server IP>`
   - `A www.md-mini.com → <server IP>`
   (plus AAAA if the server has IPv6)

2. **Web root + deploy user access**
   ```bash
   sudo mkdir -p /var/www/md-mini.com
   sudo chown <deploy-user>:<deploy-user> /var/www/md-mini.com
   ```

3. **Bootstrap nginx (port 80, needed for the certbot challenge)** — run from the repo root:
   ```bash
   sudo cp deploy/nginx/md-mini.com-bootstrap.conf /etc/nginx/sites-available/md-mini.com.conf
   sudo ln -s /etc/nginx/sites-available/md-mini.com.conf /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   ```

4. **Install certbot** (skip if already installed)
   ```bash
   sudo apt install certbot python3-certbot-nginx
   ```

5. **Certificate**
   ```bash
   sudo certbot certonly --nginx -d md-mini.com -d www.md-mini.com
   ```

   Before applying the final config, confirm certbot's nginx plugin created its snippets:
   ```bash
   ls /etc/letsencrypt/options-ssl-nginx.conf /etc/letsencrypt/ssl-dhparams.pem
   ```

6. **Final config** — run from the repo root:
   ```bash
   sudo cp deploy/nginx/md-mini.com.conf /etc/nginx/sites-available/md-mini.com.conf
   sudo nginx -t && sudo systemctl reload nginx
   ```

7. **GitHub secrets** (repo → Settings → Secrets → Actions):
   - `DEPLOY_SSH_KEY` — private key of a dedicated deploy keypair; public half in the deploy user's `~/.ssh/authorized_keys`
   - `DEPLOY_HOST` — server hostname or IP
   - `DEPLOY_USER` — deploy username

8. **First deploy** — push to main (or run the workflow manually via workflow_dispatch).

## Post-go-live checks

```bash
curl -sI http://md-mini.com | head -3          # 301 → https://md-mini.com/
curl -sI https://www.md-mini.com | head -3     # 301 → https://md-mini.com/
curl -sI https://md-mini.com | grep -i strict  # HSTS present
curl -s https://md-mini.com/sitemap.xml | head -3
```

## Google Search Console

1. Add property `md-mini.com` (Domain type), verify via DNS TXT record.
2. Submit `https://md-mini.com/sitemap.xml`.
3. Old github.io page keeps `rel=canonical` → md-mini.com; expect Google to
   re-attribute within a few weeks.
````

- [ ] **Step 4: Commit**

```bash
git add deploy/
git commit -m "feat: nginx configs and server setup guide for md-mini.com"
```

---

### Task 5: GitHub Actions deploy workflow

**Files:**
- Create: `.github/workflows/deploy-site.yml`

- [ ] **Step 1: Write the workflow**

```yaml
name: Deploy site

on:
  push:
    branches: [main]
    paths: ['docs/**']
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up SSH
        run: |
          mkdir -p ~/.ssh
          printf '%s\n' "${{ secrets.DEPLOY_SSH_KEY }}" > ~/.ssh/deploy_key
          chmod 600 ~/.ssh/deploy_key
          ssh-keyscan -H "${{ secrets.DEPLOY_HOST }}" >> ~/.ssh/known_hosts

      - name: Rsync docs to server
        run: |
          rsync -avz --delete \
            -e "ssh -i ~/.ssh/deploy_key" \
            --exclude 'superpowers/' \
            --exclude 'cli-launcher.md' \
            --exclude 'distribution.md' \
            --exclude 'ai-interface.md' \
            docs/ "${{ secrets.DEPLOY_USER }}@${{ secrets.DEPLOY_HOST }}:/var/www/md-mini.com/"
```

- [ ] **Step 2: Validate YAML**

```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/deploy-site.yml')); print('ok')"
```

Expected: `ok`. (If PyYAML is missing, `npx --yes yaml-lint .github/workflows/deploy-site.yml` or visual review.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy-site.yml
git commit -m "ci: deploy docs/ to md-mini.com over ssh on push to main"
```

---

### Task 6: Hand off — push branch and owner checklist

- [ ] **Step 1: Push the worktree branch**

```bash
git push -u origin worktree-site-redesign-migration
```

- [ ] **Step 2: Final report to owner with the go-live checklist**

Owner actions (in order):
1. Review + merge `worktree-site-redesign-migration` into main. **Merging does not go live yet** — the workflow will fail until secrets exist; that's expected and harmless (or merge after step 4).
2. DNS: A records for `md-mini.com` and `www.md-mini.com` → server IP.
3. Server: follow `deploy/README.md` steps 2–5 (web root, bootstrap nginx, certbot, final config).
4. GitHub: add `DEPLOY_SSH_KEY`, `DEPLOY_HOST`, `DEPLOY_USER` secrets.
5. Merge/push → workflow deploys; run the post-go-live curl checks from `deploy/README.md`.
6. Google Search Console: add domain property, submit sitemap.
7. Separately: paste `docs/superpowers/specs/2026-08-22-claude-design-site-prompt.md` into Claude Design with `icon.png` + `docs/screenshot.png` attached; bring the handoff bundle back to Claude Code for integration.
8. Next `/brew-release` ships the new app icon.

---

## Self-review notes

- Spec coverage: icon (Task 1), prompt (Task 2), SEO/domain switch (Task 3), nginx+TLS (Task 4), CI deploy (Task 5), owner actions incl. Search Console (Task 6). Changelog carry-over and redesign integration are explicitly out of scope per spec.
- No TDD tasks: this plan produces static assets, configs, and docs — verification is command-based (grep/curl/nginx -t at apply time), not unit tests.
- `sample.md` / `sample_image.png` stay deployable (not excluded) — harmless, and sample.md may be linked in future content.
