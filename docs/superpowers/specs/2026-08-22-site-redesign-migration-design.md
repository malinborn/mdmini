# md-mini.com: Site Migration, New Icon, Claude Design Prompt

**Date:** 2026-08-22
**Status:** Approved (Variant A — infra-first)

## Overview

Three workstreams, shipped in this order:

1. **New app icon** — replace all icon assets with the new 1024px brand icon.
2. **Claude Design prompt** — a self-contained brief for Anthropic's Claude Design tool that will produce the site redesign.
3. **Migration to md-mini.com** — move the site from GitHub Pages to the owner's own server (Caddy) with a GitHub Actions deploy pipeline and full SEO handover. The **current** site ships to the new domain first; the redesigned site from Claude Design replaces the static files later through the same pipeline.

Rationale for infra-first: domain indexing age matters for Google ranking — the sooner md-mini.com serves real content with correct canonicals, the sooner it ranks. The deploy pipeline built now is reused unchanged for the redesigned site.

## Brand tokens (extracted from `md-icon-1024.png`)

| Token | Value | Source |
|-------|-------|--------|
| Gradient start (violet) | `#7068d5` | icon top-left |
| Gradient mid (blue) | `#6e8cc0` | icon center |
| Gradient end (teal) | `#7dc8c4` | icon bottom-right |
| Caret accent top (pink) | `#f590e1` | caret gradient top |
| Caret accent bottom (cyan) | `#72dcfd` | caret gradient bottom |
| Brand letters | `#ffffff`, serif | "md" glyphs |

Typography tie-in with the app's bundled fonts: **Merriweather** (serif, matches the icon's "md") for brand/display, **Inter** for body, **JetBrains Mono** for code.

## Workstream 1: App icon

- Source: `~/Downloads/md-icon-1024.png` (1024×1024 RGBA, rounded square with shadow, transparent corners).
- Copy the source into the repo as `icon.png` (repo root, replacing the old one) so the icon source is versioned.
- Regenerate the full Tauri icon set: `npx tauri icon icon.png` → rewrites `src-tauri/icons/` (icon.icns, icon.ico, all PNG sizes, iOS/Android sets).
- Site favicon: replace the inline-SVG "M" favicon in `docs/index.html` with real assets generated from the icon — `docs/favicon-32.png` (32×32) and `docs/apple-touch-icon.png` (180×180), linked via `<link rel="icon">` and `<link rel="apple-touch-icon">`.
- The new app icon reaches users with the next release via the existing `/brew-release` flow — no release is cut in this project.

## Workstream 2: Claude Design prompt

Deliverable: `docs/superpowers/specs/2026-08-22-claude-design-site-prompt.md` — a copy-paste-ready brief for Claude Design, in English (the site is English). Contents:

1. **Product context**: mdmini — minimalist live-preview markdown editor for macOS; free, open source (GPL-3.0), built with Tauri; audience — developers and technical users who live in the terminal.
2. **Content inventory** (carried over from the current site): hero tagline ("A minimalist live-preview markdown editor for macOS. Lightweight, fast, and distraction-free."), the 12 feature cards (Live Preview, GFM Tables, Collapsible Headings, Syntax-Highlighted Code, Mermaid Diagrams, Secret Masking, File Watching, CLI Launcher, Dock Drop, Session Restore, Dark & Light Themes, Auto-Save & Recovery), terminal quick-start block with the brew tap/trust/install commands, changelog section, GitHub link. Plus a dedicated **AI-native** section (new, from the PR 5–6 AI interface, see `docs/ai-interface.md`): CLI verbs + local MCP server, agent can point (`show` pulse-highlight), edit the live buffer with visibly highlighted undoable changes, and ask anchored in-document questions (single/multi choice, free text, chained) with instant answers.
3. **Brand direction**: the token table above; gradient violet→teal as the brand surface, pink→cyan caret as the single accent; Merriweather/Inter/JetBrains Mono; light **and** dark themes; the new icon as the visual anchor.
4. **Assets to upload into Claude Design**: `md-icon-1024.png`, `docs/screenshot.png`.
5. **Hard constraints**: static output, no build step, no external CDNs (self-hosted fonts ok), semantic HTML, responsive, single-page with anchor nav, Lighthouse ≥95 across categories.
6. **SEO requirements**: canonical `https://md-mini.com/`, complete OG/Twitter meta, JSON-LD SoftwareApplication (as on the current site but with the new domain), one `<h1>`, meaningful heading hierarchy.
7. **Handoff instruction**: package as a handoff bundle for Claude Code; final integration lands in `docs/` of this repo.

## Workstream 3: Migration to md-mini.com

### Server (Caddy + automatic TLS)

Revised 2026-08-22 at the owner's request: nginx on the server was broken, Caddy
was already installed, so Caddy became the web server. This also removes certbot
— Caddy issues and renews certificates itself.

- Static site served from `/var/www/md-mini.com` on the owner's Ubuntu server (147.45.146.94).
- Caddy site config: `www.md-mini.com` → `md-mini.com` permanent redirect, gzip/zstd, long-lived cache headers for images/fonts + `no-cache` for everything else (mutually exclusive matchers so no response gets two `Cache-Control` values), security headers (HSTS, X-Content-Type-Options, Referrer-Policy, frame-ancestors) applied to error responses too, `Server` header stripped. HTTP→HTTPS redirect and TLS issuance/renewal are Caddy's own automatic behavior.
- Config lives in the repo as `deploy/caddy/Caddyfile` and installs as a **fragment** at `/etc/caddy/Caddyfile.d/md-mini.com.caddy`, pulled in by a single `import` line — an existing main Caddyfile is backed up, never overwritten, so other sites on the box survive.
- Provisioning is scripted: `deploy/provision.sh` (idempotent, run as root) creates the `deploy-mdmini` user, its SSH key, the web root, opens 80/443, installs the config, validates and reloads Caddy, then prints the deploy private key.
- Owner provides: DNS A/AAAA records for `md-mini.com` and `www` (done — both resolve to 147.45.146.94), a running Caddy, and root access to run the provisioning script.

### Deploy pipeline (GitHub Actions → SSH)

- Workflow `.github/workflows/deploy-site.yml`: on push to `main` touching `docs/**`, rsync `docs/` (excluding `superpowers/`, `*.md` internals: `cli-launcher.md`, `distribution.md`, `ai-interface.md`) to `/var/www/md-mini.com` over SSH.
- Secrets: `DEPLOY_SSH_KEY` (dedicated deploy key, restricted user), `DEPLOY_HOST`, `DEPLOY_USER`.
- rsync `--delete` so the server mirrors the repo.

### SEO handover

- In `docs/index.html`, `sitemap.xml`, `llms.txt`, JSON-LD: all URLs `https://malinborn.github.io/mdmini/` → `https://md-mini.com/`.
- `robots.txt` updated with the new sitemap URL.
- **Archive on GitHub Pages** (stays up, as requested): `docs/` is both the Pages source and the deploy source, so the same `index.html` serves on both hosts. It always carries `<link rel="canonical" href="https://md-mini.com/">`, which tells Google the new domain is the single canonical copy — no duplicate-content penalty, and ranking signals consolidate on md-mini.com. Additionally a tiny inline script redirects visitors: `if (location.hostname.endsWith('.github.io')) location.replace('https://md-mini.com' + location.pathname.replace(/^\/mdmini/, '') + location.search + location.hash)` — humans land on the new domain, query and fragment preserved, while the Pages URL keeps working as an archive entry point. Pages itself cannot 301 to an external domain, so canonical + JS redirect is the correct maximum.
- Owner action after go-live: add md-mini.com to Google Search Console (DNS TXT verification), submit sitemap. Instruction included in the final report.

### Testing / verification

- Local: `python3 -m http.server -d docs` — visual check of favicon and updated meta.
- After deploy: `curl -sI` checks — HTTP→HTTPS redirect, www→apex redirect, HSTS header present, `curl https://md-mini.com` returns the page, sitemap fetchable.
- GH Actions run green on a real push.
- Icon: `npm run build:dev` NOT required — `npx tauri icon` output verified by file listing + opening icon.icns in Preview; full verification happens at next release.

## Out of scope

- The redesign itself (done externally in Claude Design; integration of its output is a follow-up task).
- Cutting an app release with the new icon (owner-triggered `/brew-release`).
- Server provisioning beyond the Caddy site config and the deploy user (server already exists, Caddy already installed).
