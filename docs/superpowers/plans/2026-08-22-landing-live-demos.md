# md-mini.com Landing v2 — Live Editor Demos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the hand-written `docs/index.html` with the Claude Design "mdmini Landing v2" layout, where every editor mockup is replaced by the **real mdmini frontend** — actual CodeMirror 6 instances running the app's own live-preview decorations, themes, mermaid renderer, AI highlights, and AI question widgets.

**Architecture:** A second Vite entry (`site/`, its own config) builds into `docs/` so the existing CI (`rsync docs/` → Caddy) ships it unchanged. All copy lives in `site/index.html` as real markup — never injected by JS — so the page stays crawlable. `site/main.ts` only wires interaction (carousel, theme toggle, copy button) and **lazily mounts live editor demos** into `[data-demo]` slots. The landing's own design tokens are keyed to the same `:root[data-theme='aurora-dark'|'aurora-light']` attribute the app uses, so one attribute themes both the page chrome and every embedded editor.

**Tech Stack:** Vite (second config), Svelte-free vanilla TS for the page shell, the app's own CM6 stack imported directly from `src/lib/editor/*`, Playwright for verification.

**Source design:** Claude Design project `2aa4723f-2bf7-489a-911a-121ee694113b`, file `mdmini Landing v2.dc.html`. That file is a Claude-Design template (`x-dc`, `{{ }}` bindings, `style-hover`, `sc-for`, `<image-slot>`); it is a **design reference, not code to copy** — its inline styles become real CSS classes, `style-hover` becomes `:hover`, `sc-for` becomes real markup, and `<image-slot>` becomes a live demo.

**Reuse facts established by exploration (do not re-derive):**
- The whole editor stack is Tauri-free at module load and during setup. Only two Tauri call sites exist, both lazy `import()` inside click handlers: `src/lib/editor/setup.ts:121-125` (buggy — see Task 2) and `src/lib/editor/preview/tables.ts:506-512` (correct).
- `createExtensions()` from `src/lib/editor/setup.ts` already installs `livePreviewPlugin`, `editorTheme`, `aiHighlightField`, `aiAskField`, `mermaidViewField`, `tableModeField`, folding, and heading slugs. Active-line glow is off by default.
- Nothing in the editor tree imports `src/lib/stores.svelte.ts` — no localStorage or Svelte store stubbing is needed.
- Themes are pure CSS variables under `:root[data-theme='…']` (`src/lib/theme/{light,dark,aurora-light,aurora-dark}.css`). The attribute must be on `<html>`.
- `src/lib/editor/preview/utils.ts:11-26` `cursorInRange()` checks only `state.selection.main` — with the default anchor at offset 0, **line 1 renders as raw markdown**. Every demo must park the selection away from content.
- AI visuals are all plain CM6, driveable with `view.dispatch`: `pulseAiLine`, `setAiHighlights`/`clearAiHighlights` (`src/lib/editor/ai-highlight.ts`), `addAiAsk`/`removeAiAsk` + `AskSpec` (`src/lib/editor/ai-ask.ts`). `AskWidget` is a `WidgetType` with plain-DOM buttons that keep working under `EditorView.editable.of(false)`.
- Helpers that are pure and reusable: `resolveShowTarget` (`src/lib/ai-commands.ts:13-26`), `changedLineRanges` (`:36-47`), `computeReplacement` (`src/lib/editor/content-diff.ts`).
- Fonts: 15 woff2 in `src/assets/fonts/`, all `@font-face` rules in `src/styles/global.css:1-103`. Root-absolute `url('/src/assets/fonts/…')` paths are Vite-safe and get hashed into the build.
- `src/styles/global.css` also carries `body { overflow: hidden }` (`:111-119`) — must NOT be inherited by the landing.

---

### Task 1: Site scaffolding and build wiring

**Files:**
- Create: `vite.config.site.ts`, `site/index.html`, `site/main.ts`, `site/styles/fonts.css`, `site/styles/landing.css`
- Modify: `package.json` (scripts)

- [ ] **Step 1: Vite config for the landing**

`vite.config.site.ts`:

```ts
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Second entry point: the marketing site. Builds into docs/, which the deploy
// workflow rsyncs to md-mini.com. emptyOutDir is off because docs/ also holds
// hand-maintained files (screenshot.png, robots.txt, sitemap.xml, favicons,
// llms.txt, sample.md and the internal *.md docs).
export default defineConfig({
  root: fileURLToPath(new URL('./site', import.meta.url)),
  base: '/',
  publicDir: false,
  resolve: {
    alias: {
      '@app': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: fileURLToPath(new URL('./docs', import.meta.url)),
    emptyOutDir: false,
    assetsDir: 'assets',
    target: 'es2022',
  },
  server: { port: 1421, strictPort: true },
});
```

- [ ] **Step 2: package.json scripts**

Add to `"scripts"` (keep every existing script untouched):

```json
    "dev:site": "vite --config vite.config.site.ts",
    "build:site": "vite build --config vite.config.site.ts",
```

- [ ] **Step 3: fonts.css**

Create `site/styles/fonts.css` containing **only** the `@font-face` block copied verbatim from `src/styles/global.css` lines 1–103. Change every `url('/src/assets/fonts/X.woff2')` to `url('@app/assets/fonts/X.woff2')` so the alias resolves from the site root. Do NOT copy the `*` reset, `body` rules, or `.md-toast*` rules.

- [ ] **Step 4: landing.css — tokens keyed to the app's theme attribute**

Create `site/styles/landing.css`. It starts with the landing's own palette, defined for both Aurora themes so one `data-theme` value drives page chrome and embedded editors together. Values come from the Claude Design file (its `[data-theme="dark"]` / `[data-theme="light"]` blocks):

```css
:root[data-theme='aurora-dark'] {
  --bg: #0e0f16; --bg2: #14151f; --bg3: #1a1c29;
  --border: rgba(210, 214, 255, 0.1); --border2: rgba(210, 214, 255, 0.16);
  --text: #e9e9f2; --muted: #9c9db4; --link: #a29cf0; --linkh: #c0bbff;
  --code-bg: #171825;
  --hl: rgba(245, 144, 225, 0.14); --hl2: rgba(114, 220, 253, 0.14);
  --shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
}

:root[data-theme='aurora-light'] {
  --bg: #fbfbfd; --bg2: #ffffff; --bg3: #f2f2f8;
  --border: rgba(24, 24, 48, 0.1); --border2: rgba(24, 24, 48, 0.16);
  --text: #1d1e2a; --muted: #5d5e72; --link: #5b53c8; --linkh: #3f3894;
  --code-bg: #f4f4fa;
  --hl: rgba(245, 144, 225, 0.18); --hl2: rgba(114, 220, 253, 0.2);
  --shadow: 0 24px 60px rgba(40, 30, 90, 0.12);
}
```

Then a minimal reset (`*, *::before, *::after { box-sizing: border-box }`, `body { margin: 0 }` — **no `overflow: hidden`**), `html { scroll-behavior: smooth }`, and real CSS classes for every section. Convert the design's inline styles into classes; convert each `style-hover="…"` attribute into a matching `:hover` rule. Required brand values, unchanged from the design: brand gradient `linear-gradient(135deg, #7068d5, #6e8cc0, #7dc8c4)`, caret gradient `linear-gradient(180deg, #f590e1, #72dcfd)`, fonts Merriweather (display) / Inter (body) / JetBrains Mono (code).

Also include the two keyframes the design uses:

```css
@keyframes caretBlink { 0%, 55% { opacity: 1; } 60%, 100% { opacity: 0; } }
@keyframes pulseHl { 0%, 100% { background: var(--hl); } 50% { background: var(--hl2); } }
```

And a demo-frame rule set: a `.demo` wrapper (macOS-style title bar with three dots + filename, rounded, `box-shadow: var(--shadow)`, `overflow: hidden`) plus these rules that make an embedded app editor behave inside a card:

```css
/* Embedded editors are read-only exhibits: no insert gutter, no caret,
   no page-height editor, and no horizontal page scroll from wide content. */
.demo .cm-hover-gutter { display: none !important; }
.demo .cm-editor { height: auto; background: transparent; }
.demo .cm-scroller { overflow: auto; }
.demo .cm-cursor, .demo .cm-dropCursor { display: none; }
.demo-body { max-height: var(--demo-h, 320px); overflow: hidden; }
```

- [ ] **Step 5: site/index.html — the full page as real markup**

Create `site/index.html`. Requirements, in order:

1. `<html lang="en">` with **no** `data-theme` attribute in the source — it is set by the bootstrap script below before first paint.
2. In `<head>`, first: the theme bootstrap and the archive redirect, both inline so they run before paint. Copy the redirect **exactly** from the current `docs/index.html` (it must keep working on the Pages archive):

```html
  <script>
    if (location.hostname.endsWith('.github.io')) {
      location.replace('https://md-mini.com' + location.pathname.replace(/^\/mdmini/, '') + location.search + location.hash);
    }
  </script>
  <script>
    // Set the theme before first paint so the page never flashes the wrong palette.
    (function () {
      var stored = null;
      try { stored = localStorage.getItem('mdmini-site:theme'); } catch (e) { /* private mode */ }
      var dark = stored ? stored === 'dark' : !window.matchMedia('(prefers-color-scheme: light)').matches;
      document.documentElement.setAttribute('data-theme', dark ? 'aurora-dark' : 'aurora-light');
    })();
  </script>
```

3. The complete SEO head, carried over from the current `docs/index.html` with values unchanged: `<title>mdmini — Minimalist Markdown Editor for macOS</title>`, meta description, keywords, `<link rel="canonical" href="https://md-mini.com/">`, the `llms.txt` alternate link, full Open Graph and Twitter Card blocks, the `SoftwareApplication` JSON-LD, and the favicon + apple-touch-icon links. Bump `softwareVersion` in the JSON-LD only if Task 5 changes the advertised version; otherwise leave `0.5.1`.
4. `<script type="module" src="/main.ts"></script>` — module, so it defers by default.
5. Body markup for every section of the design, as semantic HTML with the classes from `landing.css`: `nav` (brand mark, anchor links AI-native / Features / Install / Changelog / GitHub, plus a theme-toggle button `#theme-toggle` with `aria-label`), `header#top` (h1 "mdmini" + animated caret span, tagline, four pills, install command + copy button), `section#ai` (the carousel: a viewport div, a track div, five slides, prev/next buttons and five dots), `section#features` (twelve cards), `section#install` (terminal block), `section#changelog`, `footer`.
5a. Exactly one `<h1>`. Section headings are `<h2>`, feature titles `<h3>`.
5b. Every carousel slide keeps the design's two-column grid: copy on one side, demo on the other. Where the design drew a fake editor, put a demo slot instead:

```html
<div class="demo" data-demo="point" data-demo-height="300">
  <div class="demo-bar"><span class="dot red"></span><span class="dot yellow"></span><span class="dot green"></span><span class="demo-name">runbook.md</span></div>
  <div class="demo-body"><noscript>Live editor demo requires JavaScript.</noscript></div>
</div>
```

Slots to create, with these exact `data-demo` values: `point` (slide 1), `edit` (slide 2), `ask` (slide 3), `showcase` (slide 5, replacing the design's `<image-slot>`). Slide 4 ("It can be used any way") stays static markup exactly as designed — no demo. **The hero carries no demo** (revised 2026-08-22 by the owner): the header stays exactly as the design draws it — headline, tagline, pills, install row — and the document render that first lived there moved into the slide-5 ribbon below.
5c. Feature cards keep the design's small static illustrations (they are decorative and cheap); do NOT put live editors in them.
5d. Carousel slides must be reachable without JS: give the track `overflow-x: auto` with scroll-snap as the no-JS baseline, and let `main.ts` upgrade it to the transform-based carousel. Never hide slides with `display: none` — the copy in all five slides must stay in the DOM for crawlers.

- [ ] **Step 6: site/main.ts — page wiring only, no content**

Create `site/main.ts` importing, in this order: `./styles/fonts.css`, `@app/lib/theme/aurora-dark.css`, `@app/lib/theme/aurora-light.css`, `@app/styles/editor.css`, `./styles/landing.css` (landing last so its `--bg` family wins over nothing and stays readable). Then implement:

- **Theme toggle**: cycles `auto → dark → light`, writes `localStorage['mdmini-site:theme']` (`'dark'`/`'light'`, removed for auto), sets `data-theme` to `aurora-dark`/`aurora-light`, updates the button label, and calls `reinitializeTheme()` from `@app/lib/editor/preview/mermaid` so an already-rendered diagram re-themes. Follow the system preference when the stored value is absent, including live `matchMedia('(prefers-color-scheme: light)')` changes.
- **Copy button**: copies `brew tap malinborn/mdmini && brew trust malinborn/mdmini && brew install --cask mdmini`, swaps the label to "Copied" for 1600 ms.
- **Carousel**: index state, `translateX(-${i * 100}%)` on the track, prev/next wrap around, dots reflect and set the index, keyboard `ArrowLeft`/`ArrowRight` when the section has focus, and it must set `aria-hidden` on off-screen slides only if it does not remove them from the accessibility tree for crawlers — prefer `inert` on off-screen slides and leave the DOM intact.
- **Demo mounting**: one `IntersectionObserver` (`rootMargin: '200px'`) that, the first time a `[data-demo]` slot approaches the viewport, dynamically `import()`s the matching demo module and calls its `mount(container)`. Never mount twice. The hero demo may mount eagerly. Guard everything in try/catch so a demo failure degrades to an empty card instead of a blank page.

- [ ] **Step 7: Verify the build and the static content**

```bash
npm run build:site
```

Expected: build succeeds, `docs/index.html` regenerated, `docs/assets/` created. Then verify the deployable extras were **not** wiped:

```bash
ls docs/screenshot.png docs/robots.txt docs/sitemap.xml docs/llms.txt docs/favicon-32.png docs/apple-touch-icon.png docs/sample.md
```

Expected: all present. And confirm the copy is in the HTML rather than in JS:

```bash
grep -c 'It can point\|It can edit\|It can ask\|Live Preview\|Quick start' docs/index.html
```

Expected: at least 5.

- [ ] **Step 8: Commit**

```bash
git add vite.config.site.ts package.json site docs/index.html docs/assets
git commit -m "feat(site): landing v2 shell — real markup, aurora tokens, build wiring"
```

---

### Task 2: Demo runtime (shared editor factory) + the setup.ts link fallback

**Files:**
- Create: `site/demos/editor-demo.ts`
- Modify: `src/lib/editor/setup.ts:121-125`
- Test: `src/lib/editor/__tests__/setup-link.test.ts` (new)

- [ ] **Step 1: Write the failing test for the link fallback**

The app's rendered-link handler never falls back to `window.open` in a browser, because the lazy `open()` promise is not returned, so its rejection escapes instead of being caught. Create `src/lib/editor/__tests__/setup-link.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openExternalUrl } from '../setup';

describe('openExternalUrl', () => {
  beforeEach(() => {
    vi.stubGlobal('open', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('falls back to window.open when the Tauri shell plugin is unavailable', async () => {
    await openExternalUrl('https://example.com');
    expect(window.open).toHaveBeenCalledWith('https://example.com', '_blank');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run --dir src src/lib/editor/__tests__/setup-link.test.ts
```

Expected: FAIL — `openExternalUrl` is not exported from `setup.ts`.

- [ ] **Step 3: Extract and fix the handler**

In `src/lib/editor/setup.ts`, replace the inline body of the link click handler (currently lines 121-125) with a call to a new exported function, and define it next to the handler:

```ts
/**
 * Opens a rendered link. Uses the Tauri shell plugin in the app; falls back to
 * a browser tab when that plugin has no backend (the landing page embeds this
 * same editor). The plugin call must be returned so its rejection reaches the
 * catch — otherwise the fallback never runs.
 */
export function openExternalUrl(url: string): Promise<void> {
  return import('@tauri-apps/plugin-shell')
    .then(({ open }) => open(url))
    .catch(() => {
      window.open(url, '_blank');
    });
}
```

The call site becomes `openExternalUrl(url);` — keep the surrounding event handling, `preventDefault`, and URL-extraction logic exactly as it is.

- [ ] **Step 4: Run the test again, then the whole suite**

```bash
npx vitest run --dir src src/lib/editor/__tests__/setup-link.test.ts
npx vitest run --dir src
```

Expected: the new test passes; the full suite passes with no new failures (note: `npm run test` overcounts by picking up stale copies under `.claude/worktrees/` — always use `npx vitest run --dir src`).

- [ ] **Step 5: The shared demo editor factory**

Create `site/demos/editor-demo.ts`:

```ts
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { createExtensions } from '@app/lib/editor/setup';

export interface DemoEditorOptions {
  /** Markdown shown in the demo. */
  doc: string;
  /** Extra extensions (demo-specific keymaps, effects, etc.). */
  extensions?: Extension[];
  /** Max visible height in px; the card clips beyond it. */
  height?: number;
}

export interface DemoEditor {
  view: EditorView;
  destroy: () => void;
}

/**
 * Mounts a real app editor as a non-interactive exhibit.
 *
 * readOnly blocks user input while still allowing programmatic dispatch, which
 * is what the scripted demos use. editable:false drops contenteditable so the
 * page never steals focus or shows a caret — the AI ask widget's own buttons and
 * input keep working because they are plain DOM with their own listeners.
 *
 * The selection is parked on the last line: cursorInRange() in the preview
 * layer reveals raw markdown wherever the cursor sits, and the default anchor of
 * 0 would leave line 1 unrendered. Every demo doc therefore ends with a blank
 * line to park on.
 */
export function mountDemoEditor(parent: HTMLElement, options: DemoEditorOptions): DemoEditor {
  const doc = options.doc.endsWith('\n\n') ? options.doc : `${options.doc}\n\n`;

  const state = EditorState.create({
    doc,
    selection: { anchor: doc.length },
    extensions: [
      createExtensions(),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      ...(options.extensions ?? []),
    ],
  });

  const view = new EditorView({ state, parent });
  if (options.height) parent.style.setProperty('--demo-h', `${options.height}px`);

  return { view, destroy: () => view.destroy() };
}

/** True when the visitor asked for less motion; looping demos must respect it. */
export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
```

- [ ] **Step 6: (revised) no hero demo**

Superseded by the owner on 2026-08-22: the hero gets no editor. The document render belongs to the slide-5 ribbon (Task 3, Step 4). Remove the `data-demo="hero"` slot from `site/index.html` and delete `site/demos/hero.ts`; the ribbon document in `showcase.ts` inherits its content.

- [ ] **Step 7: Verify in the browser**

```bash
npm run dev:site
```

Open `http://localhost:1421`, confirm: the hero shows a rendered document (headings in the display serif, a real bordered table, highlighted code), there is **no** caret and no insert gutter, line 1 is rendered rather than raw, clicking text does not focus anything, and the page has no horizontal scrollbar. Stop the server.

- [ ] **Step 8: Commit**

```bash
git add src/lib/editor/setup.ts src/lib/editor/__tests__/setup-link.test.ts site/demos
git commit -m "feat(site): demo editor factory and hero demo; fix link fallback outside Tauri"
```

---

### Task 3: The three AI demos

**Files:**
- Create: `site/demos/point.ts`, `site/demos/edit.ts`, `site/demos/ask.ts`

Each module exports `mount(container: HTMLElement): void` and is dynamically imported by `main.ts`.

- [ ] **Step 1: `point.ts` — the real `show` pulse**

Use `mountDemoEditor` with a short runbook document containing the sentence `Rollbacks re-deploy the previous tag.`. Then loop, mirroring what the app does at `src/App.svelte:373-376`:

```ts
import { EditorView } from '@codemirror/view';
import { pulseAiLine, clearAiHighlights } from '@app/lib/editor/ai-highlight';
import { resolveShowTarget } from '@app/lib/ai-commands';

const target = resolveShowTarget(view.state, { find: 'Rollbacks re-deploy' });
// A CSS animation does not restart when an identical decoration is re-added,
// so clear first and re-pulse on a later frame.
view.dispatch({ effects: clearAiHighlights.of(null) });
requestAnimationFrame(() => {
  view.dispatch({
    selection: { anchor: parkAnchor },
    effects: [EditorView.scrollIntoView(target, { y: 'center' }), pulseAiLine.of(target)],
  });
});
```

Repeat every 3200 ms with `setInterval`. Skip the loop entirely when `prefersReducedMotion()` is true — pulse once and stop. Keep the design's `claude · look here` caption as static markup in the card footer. Note: `resolveShowTarget` returns a document offset; keep the parked selection off the target line so the pulsed line stays rendered rather than showing raw markdown.

- [ ] **Step 2: `edit.ts` — a real diff, applied and highlighted**

Two document versions as string constants, `before` and `after`, differing by one rewritten paragraph (the design's copy: the "Database migrations are reverted only by an explicit down-migration — never automatically." sentence replacing a vaguer line). Then replay the app's own edit path (`src/App.svelte:456-471`) using the real helpers:

```ts
import { ChangeSet } from '@codemirror/state';
import { computeReplacement } from '@app/lib/editor/content-diff';
import { setAiHighlights, clearAiHighlights } from '@app/lib/editor/ai-highlight';

const repl = computeReplacement(view.state.doc.toString(), after);
if (repl) {
  view.dispatch({
    changes: ChangeSet.of([repl], view.state.doc.length),
    effects: setAiHighlights.of([{ from: repl.from, to: repl.from + repl.insert.length }]),
  });
}
```

The `.cm-ai-edit-line` shimmer is an infinite CSS animation, so the highlight stays alive on its own. Loop the whole thing on a 7000 ms cycle: revert to `before` (dispatch the reverse replacement plus `clearAiHighlights`), wait ~1200 ms, apply `after` again. With reduced motion, apply `after` once and leave it highlighted. Keep the `AI edit · Esc to accept · ⌘Z to undo` caption from the design as static markup.

- [ ] **Step 3: `ask.ts` — real question widgets the visitor can answer**

Mount a runbook document, then add two real `AskWidget`s through the app's own effect, mirroring `src/App.svelte:415-431`:

```ts
import { addAiAsk, removeAiAsk, type AskSpec } from '@app/lib/editor/ai-ask';
```

- Card 1, single choice: question `Which environment should this runbook target?`, options `['Staging', 'Production', 'Both']`, `multi: false`, `freeText: false`.
- Card 2, multi + free text: question `Which sections should I keep?`, options `['Deployment', 'Rollback', 'On-call escalation']`, `multi: true`, `freeText: true`.

`onAnswer` must close the loop visibly, because this is the one demo a visitor can actually drive: dispatch `removeAiAsk.of(id)`, then apply a small real edit to the document that reflects the answer (for card 1, replace the `**Environment:** …` line with the chosen option; for card 2, drop the unchecked sections' headings) and highlight the changed span with `setAiHighlights` so the visitor sees the agent act on their answer. Result shapes to handle: `string` (single), `string[]` (multi confirm), `{ custom }`, `{ answers, custom }`, and `null` (dismissed — restore the card after ~4 s so the demo does not stay empty).

Add a `resetAfter` timer: 20 s after the last answer, restore both cards and the original document so a later visitor sees the demo intact.

- [ ] **Step 4: `showcase.ts` — the infinite capability ribbon (slide 5)**

This is the slide titled "And it's basically just a good markdown editor." Per the owner (2026-08-22) it is **one tall editor that scrolls itself slowly and endlessly**, like a ribbon, walking the visitor through everything the renderer does. It replaces the design's `<image-slot>`.

Document: long enough to need real scrolling — a plausible project document, in the product's calm voice, that covers **every** headline capability in order: H1 and H2 headings, a paragraph with bold/italic/strikethrough, inline code and a link, a bullet list with checked and unchecked checkboxes, an ordered list, a blockquote, a 3-column GFM table, a fenced `bash` block and a fenced `ts` block, a mermaid flowchart, and a horizontal rule between movements. Reuse the "Deploy runway" document written in Task 2 as its opening section.

Seamless loop: build the doc as **two concatenated copies** of the same body, auto-scroll `view.scrollDOM.scrollTop` with `requestAnimationFrame` at roughly 14 px/s, and when `scrollTop >= scrollHeight / 2` subtract exactly half the scroll height. Because the second copy is identical, the seam is invisible and the ribbon never visibly resets. Notes:
- Pause the animation while the pointer is over the card (`pointerenter`/`pointerleave`) so a visitor can actually read something that caught their eye, and pause when the slide is off-screen or the tab is hidden (`document.hidden`) so the page does not burn CPU.
- `prefersReducedMotion()` → do not animate at all; render the document scrolled to the top.
- Height ~460 so the card shows a generous window of the document.
- Mermaid renders asynchronously behind a 300 ms debounce and a dynamic `import('mermaid')`, so the diagram shows "Rendering diagram…" for a beat and only when it scrolls into the CM6 viewport. That is expected — do not try to defeat it. Verify the diagram does render on both copies as the ribbon passes them.

- [ ] **Step 5: Verify all five demos in the browser**

```bash
npm run dev:site
```

Check, in order: slide 1 pulses a line roughly every 3 s; slide 2 rewrites a paragraph and leaves a shimmering highlight, looping; slide 3 shows two question cards, and **clicking an option really answers it** — the card disappears and the document changes; slide 5 scrolls itself slowly and endlessly, rendering a real mermaid SVG, a real table, and real code blocks as they pass. Open the console: **zero errors**. Stop the server.

- [ ] **Step 6: Commit**

```bash
git add site/demos
git commit -m "feat(site): live AI demos — real pulse, real diff edit, answerable ask cards"
```

---

### Task 4: Content accuracy pass

**Files:**
- Modify: `site/index.html`

The Claude Design file contains invented content that must not ship.

- [ ] **Step 1: Replace the fabricated changelog with the real one**

The design lists `v0.4.0 AI-native release (Aug 2026)`, `v0.3.0 Diagrams and tables (Jun 2026)`, `v0.2.0 Sessions (Apr 2026)` — **none of these are real**. Use the actual release history, which is preserved in git at `docs/index.html` before this branch rewrites it (`git show 918d1ed:docs/index.html`), newest first:

| Version | Date | Tag | Title |
|---|---|---|---|
| v0.5.1 | 2026-07-28 | fix | Close that update notice once |
| v0.5.0 | 2026-07-28 | feature | Your windows come back |
| v0.4.0 | 2026-07-25 | feature | Big diagrams, finally navigable |
| v0.3.5 | 2026-06-16 | fix | Links that work inside tables |
| v0.3.4 | 2026-06-05 | feature | Shell configs come alive |
| v0.3.3 | 2026-06-04 | fix | TOC links that actually jump |
| v0.3.2 | 2026-05-23 | fix | Ordered lists that count themselves |
| v0.3.1 | 2026-05-23 | feature | Tables that fit your viewport |
| v0.3.0 | 2026-05-23 | fix | Inline markdown inside headings |
| v0.2.2 | 2026-04-05 | feature | Line Glow & heading fold redesign |
| v0.2.1 | 2026-04-05 | feature | Heading fold toggle redesign |
| v0.2.0 | 2026-04-05 | feature | Mermaid Diagrams |
| v0.1.6 | 2026-04-03 | fix | Foreground windows |
| v0.1.5 | 2026-04-02 | feature | File associations & smart windows |
| v0.1.4 | 2026-04-02 | fix | Text wrapping & table alignment |
| v0.1.3 | 2026-03-30 | fix | Update checks & theme fixes |
| v0.1.0 | 2026-03-30 | initial | Initial release |

Carry over each entry's bullet list from that same old file verbatim — the wording is the owner's. Render them in the design's collapsible `<details>` pattern with the newest entry open, and close the section with a link to `https://github.com/malinborn/mdmini/releases`.

**Do not invent a release for the AI interface or the Aurora themes.** Both are merged to main but unreleased, so no changelog entry may claim them.

- [ ] **Step 2: Fix the themes feature card**

The design says "Rosé Pine dark and Rosé Pine Dawn. Switch with a single keypress." Aurora Light and Aurora Dark now exist too (merged in PR #7). Update the card copy to name all four and keep the swatch illustration, adding two swatches for the Aurora pair using the brand gradient colors.

- [ ] **Step 3: Sanity-check every remaining factual claim against the repo**

Walk the page and verify each claim, fixing any that drifted: the install/upgrade commands and the `claude mcp add --scope user mdmini -- mdmini mcp` line against `docs/ai-interface.md`; the AI copy (point / edit / ask, single-multi-freetext, Esc and ⌘Z behavior) against `docs/ai-interface.md` and `src/lib/editor/ai-ask.ts`; the twelve feature cards against `docs/superpowers/specs/2026-08-22-claude-design-site-prompt.md`; the keyboard shortcuts (⇧⌘T for session restore, ⌘E for secret reveal). Report anything that cannot be verified rather than guessing.

- [ ] **Step 4: Commit**

```bash
git add site/index.html
git commit -m "fix(site): real changelog and accurate feature copy"
```

---

### Task 5: Verification, performance, and cache headers

**Files:**
- Create: `site/__tests__/landing.spec.ts` (Playwright, run manually — not part of `npm run test`)
- Modify: `deploy/caddy/Caddyfile`, `deploy/README.md`

- [ ] **Step 1: Long-cache the hashed build assets**

Vite emits content-hashed `assets/*.js` and `assets/*.css`. The Caddyfile's asset matcher currently lists only image and font extensions, so those hashed files land in the `no-cache` bucket. In `deploy/caddy/Caddyfile`, extend the `@assets` path matcher with `*.js *.css` and extend the complementary `@everything_else not path` matcher with the same two patterns, keeping the two matchers exact complements. Mirror the edit in `deploy/provision.sh`'s embedded heredoc copy, then confirm they stay byte-identical:

```bash
python3 - <<'PY'
import re
script = open('deploy/provision.sh').read()
body = re.search(r"cat > \"\$CADDY_SITE_CONF\" <<'CADDYFILE'\n(.*?)\nCADDYFILE\n", script, re.S).group(1)
conf = open('deploy/caddy/Caddyfile').read().rstrip('\n')
print('identical:', body == conf)
PY
```

Expected: `identical: True`.

- [ ] **Step 2: Playwright checks against the real build**

```bash
npm run build:site
npx --yes http-server docs -p 8901 --silent &
```

Create `site/__tests__/landing.spec.ts` driving the installed Chrome (`chromium.launch({ channel: 'chrome' })` — this repo's cached chromium lags the CLI) against `http://localhost:8901`, asserting:

1. No console errors and no page errors during load and 8 s of dwell.
2. The slide-5 ribbon produced real decorations: `.demo[data-demo="showcase"] .cm-editor` exists and at least one heading decoration is present (query the class used by `src/lib/editor/preview/headings.ts`), and its `scrollTop` has advanced after 3 s of dwell (proving the ribbon animates).
3. Slide 3 renders real ask cards: `.cm-ai-ask` count is 2. Clicking the first `.cm-ai-ask-option` removes one card (count becomes 1) — this proves the widget is the real component, not a mockup.
4. Slide 2 eventually has a `.cm-ai-edit-line` element.
5. Slide 5 eventually contains an `svg` inside the editor (mermaid rendered) — allow up to 10 s.
6. `document.documentElement.scrollWidth <= window.innerWidth + 1` at 1280×900 and at 390×844 (no horizontal page scroll).
7. The page works with JavaScript disabled: all five slides' headings and the full changelog are present in the served HTML (fetch the raw HTML and assert on the strings, no browser needed).
8. Both themes render: set `localStorage['mdmini-site:theme']` to `light` and to `dark`, reload, and screenshot each into `$CLAUDE_JOB_DIR/tmp/` for visual review.

Run it, fix what it catches, and paste the results. Kill the server afterwards.

- [ ] **Step 3: Payload sanity**

```bash
du -sh docs/assets; ls -la docs/assets | head -20; du -sh docs/index.html
```

Report the totals. The initial HTML should stay well under 200 KB; the mermaid chunk must be a **separate** file (it is dynamically imported), not part of the main bundle — verify by grepping the main JS chunk for `mermaid` internals or by checking that a `mermaid`-named chunk exists.

- [ ] **Step 4: App regression check**

```bash
npx vitest run --dir src
npm run check
```

Expected: both clean. `npm run check` must cover the new `site/` sources too — if `svelte-check` does not pick them up, add a `tsconfig` include and note it.

- [ ] **Step 5: Document the second build in the deploy runbook**

Add a short section to `deploy/README.md`: the site is a Vite build (`npm run build:site`) whose output is committed under `docs/`, sources live in `site/`, and the deploy workflow ships `docs/` unchanged — so a content change means editing `site/`, rebuilding, and committing both.

- [ ] **Step 6: Commit**

```bash
git add deploy site/__tests__ docs
git commit -m "test(site): playwright checks; chore(deploy): long-cache hashed assets"
```

---

## Notes and deliberate exclusions

- **The AI features are unreleased.** They are merged to main but no release contains them, so the landing advertises capabilities a user installing v0.5.1 today would not get. This plan does not resolve that — it is the owner's call whether to publish the page together with the v1.0 release or to add an explicit "coming in v1.0" note. Flag it on completion; do not invent a changelog entry.
- **Feature cards keep their static illustrations.** The owner asked for live demos in the carousel specifically. Twelve more CM6 instances would cost payload for decorative value.
- **One theme at a time.** `:root[data-theme]` is global, so a single page cannot show aurora-light and aurora-dark editors side by side without duplicating the token blocks under a scoped selector. Not needed for this design.
- **`support.js` / `image-slot.js` are not ported.** They are the Claude Design runtime (`{{ }}` bindings, `style-hover`, `sc-for`) and a drag-and-drop image placeholder respectively. Their behavior is reimplemented in real HTML/CSS/TS per the tasks above; `<image-slot>` is replaced by the `showcase` demo.
- **No release is cut and nothing is deployed by this plan.** The branch is merged by the owner; the existing workflow deploys on push to main touching `docs/**`.

---

## Revision 2026-08-23 — fidelity and per-slide themes

The owner compared a demo card against a real mdmini window and the demo "doesn't look like mdmini at all". Root cause is known: the app's real editor metrics live in `src/lib/editor/Editor.svelte`'s **scoped** style block (`:162-166`), which the landing never gets because `mountDemoEditor` constructs its own `EditorView` instead of using the Svelte component:

```css
.editor-container :global(.cm-scroller) { padding: 2rem; font-size: 16px; line-height: 1.6; }
```

Nothing in `editor.css` or `editor-theme.ts` supplies those three values, so every demo renders with zero content padding and the landing's inherited font metrics — which is exactly the difference the owner saw.

### Task 6: Make the demos visually identical to the app

**Files:** Create `src/styles/editor-metrics.css`; modify `src/lib/editor/Editor.svelte`, `site/demos/editor-demo.ts`, `site/styles/landing.css`, `site/index.html`

- [ ] **Step 1: Extract the metrics into a shared stylesheet — one source of truth**

Create `src/styles/editor-metrics.css` defining a host class that carries the app's editor metrics, so the app and the landing cannot drift apart:

```css
/* Editor host metrics shared by the app window and the landing's demo cards.
   These three values are the app's real reading experience; they used to live
   only in Editor.svelte's scoped styles, which meant an editor mounted outside
   that component (the marketing site's demos) silently rendered with no content
   padding and the host page's font metrics. */
.md-editor-host .cm-scroller {
  padding: 2rem;
  font-size: 16px;
  line-height: 1.6;
}

.md-editor-host .cm-focused {
  outline: none;
}
```

Then in `Editor.svelte`: import the new file, add `md-editor-host` to the container's class list, and delete the now-duplicated `.cm-scroller` padding/font-size/line-height and `.cm-focused` outline rules from its scoped block. Keep `height: 100vh`, `width: 100%`, `overflow: auto` and the `.cm-editor { height: 100% }` rule where they are — those are window-shell concerns, not reading metrics.

- [ ] **Step 2: Use the same host class in the demos**

`mountDemoEditor` adds `md-editor-host` to the element it mounts into, and `site/main.ts`'s CSS imports include `@app/styles/editor-metrics.css`. Demo-specific overrides in `landing.css` must not undo the three metrics; a demo card may scale the whole thing with a single `font-size` on the host if a card needs a smaller measure, since everything else is em-relative.

- [ ] **Step 3: Compare against the running app and close every remaining gap**

This step is empirical, not from memory. Run the real app frontend (`npm run dev`, port 1420 — browser-only, no Tauri needed) and the landing (`npm run dev:site`, port 1421) side by side, load **the same markdown** into both, and screenshot both at the same viewport width and DPR. Reach the app's editor from the console: `document.querySelector('.cm-content').cmView.view` (see the CLAUDE.md gotcha for the exact accessor) and dispatch the document into it.

Enumerate every visual difference and fix it in `landing.css` / `editor-demo.ts` until a demo card is indistinguishable from a crop of the real window: font family and size for body, headings, inline code and code fences; heading colour and weight; line height and paragraph rhythm; inline-code and code-fence chrome; table borders and cell padding; checkbox rendering; link colour and underline; blockquote treatment; the ask card's own typography. Report the list of deltas you found with the rule responsible for each.

- [ ] **Step 4: Make the window chrome match a real mdmini window**

The demo cards currently draw a fake bar with a centred filename. A real mdmini window (owner's screenshot) puts the traffic lights at the far left and the title immediately after them, reading `<filename> — md-mini`. Update the `.demo-bar` markup and CSS in `site/index.html` / `landing.css` to match: lights left, title left-aligned next to them in the UI font at the same small size, no centring, no trailing spacer. Keep it consistent across all four demo cards.

- [ ] **Step 5: Verify**

`npx vitest run --dir src` and `npm run check` clean. Then confirm in the browser that the **app itself** is visually unchanged by the Step 1 refactor (this is the risk of the change): open `npm run dev`, compare against a screenshot taken before the refactor, and confirm padding, font size and line height are identical. Re-run the landing's manual Playwright script (`node site/__tests__/landing.manual.ts`) — all eight checks still pass.

- [ ] **Step 6: Commit**

```bash
git add src/styles/editor-metrics.css src/lib/editor/Editor.svelte site
git commit -m "fix(site): demos now render with the app's real editor metrics"
```

### Task 7: A different theme on every carousel slide

The owner wants each carousel screen to show a different one of the product's four themes, instead of all four demos sharing the page's theme. `:root[data-theme]` is global, so the token blocks must be re-declared under a scoped selector.

**Files:** Create `site/styles/demo-themes.css`; modify `site/index.html`, `site/main.ts`, `site/demos/editor-demo.ts`, `src/lib/editor/preview/mermaid.ts` (+ a test)

- [ ] **Step 1: Scoped theme tokens**

Generate `site/styles/demo-themes.css` by re-declaring each of the four theme files' custom properties under `[data-demo-theme='<name>']` instead of `:root[data-theme='<name>']`, for `light`, `dark`, `aurora-light`, `aurora-dark`. Copy the values from `src/lib/theme/*.css` — do not invent any. Add a header comment saying the file mirrors those four and must be regenerated if a theme's tokens change, and note that a scoped block cannot inherit `--bg-image` from `:root`, so aurora-light's gradient must be re-declared here too.

- [ ] **Step 2: Assign one theme per slide**

Wrap each demo card in the attribute and let the editor inherit it. Assignment (fixed, independent of the page's own theme so all four are always on display):

| Slide | Demo | Theme |
|---|---|---|
| 1 | point | `aurora-dark` |
| 2 | edit | `light` |
| 3 | ask | `dark` |
| 5 | showcase (ribbon) | `aurora-light` |

Set `data-demo-theme` on the `.demo` element in `site/index.html`. The card chrome (title bar, border, background) must also follow the card's own theme rather than the page's, so it reads as a real window of that theme — drive those from the scoped tokens too.

- [ ] **Step 3: Let mermaid follow the nearest theme, not the document**

`src/lib/editor/preview/mermaid.ts` resolves its theme from `document.documentElement.dataset.theme` (`:36-38`) and keys its cache on content alone. With a light-themed ribbon on a dark page that renders a dark diagram on a light card. Fix both, TDD:

1. Write a failing test that a view whose DOM sits inside `[data-theme='light']` resolves the light mermaid theme while `documentElement` says `aurora-dark`.
2. Change the resolver to walk up from the rendering view's DOM (`view.dom.closest('[data-theme]')`) and fall back to `document.documentElement`. In the app this is a no-op — `documentElement` *is* the nearest ancestor.
3. Include the resolved theme in the render cache key so two diagrams under different themes cannot collide.
4. Keep `reinitializeTheme()` working: it must still re-init and clear the cache on a page theme change.

Note the scoped attribute for the demos is `data-demo-theme`, so also give each demo host a plain `data-theme` with the same value — that is what both the theme CSS selectors' scoped copies and this resolver key off. Pick whichever single attribute makes Steps 1-3 consistent and say what you chose.

- [ ] **Step 4: Verify**

`npx vitest run --dir src` (including the new mermaid test) and `npm run check` clean. In the browser, at 1280×900 and 390×844, with the **page** in both its themes: each of the four slides shows its own distinct theme, the card chrome matches the card's theme, text contrast is correct in all four, and the ribbon's mermaid diagram renders with light colours on its light card. Screenshot all four slides in both page themes. Zero console errors.

- [ ] **Step 5: Commit**

```bash
git add site src/lib/editor/preview/mermaid.ts src/lib/editor/preview/__tests__
git commit -m "feat(site): one theme per carousel slide; mermaid follows the nearest theme"
```
