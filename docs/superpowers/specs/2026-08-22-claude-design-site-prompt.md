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
