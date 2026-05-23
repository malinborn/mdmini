# md-mini

Minimalist live-preview markdown editor for macOS. Tauri 2 + Svelte 5 + CodeMirror 6.

# md

## Commands

| Command | Description |
|---------|-------------|
| `npm install` | Install frontend dependencies |
| `npm run dev` | **Default for visual checks.** Frontend only (Vite at http://localhost:1420). No Tauri shell — open the URL in any browser. |
| `npm run dev:app` | Tauri dev with **renamed identifier** (`md-mini-dev` / `com.md-mini.dev`). Uses its own bundle ID + single-instance socket — does NOT conflict with an installed production md-mini. Use when you need Tauri IPC (file I/O, menu, native dialogs). |
| `npm run check` | Svelte type checking |
| `npm run test` | Run frontend tests (vitest) |
| `cd src-tauri && cargo test` | Run Rust tests |
| `cargo clippy --manifest-path src-tauri/Cargo.toml` | Rust linter |
| `npm run build:dev` | **Renamed dev .dmg** (`md-mini-dev`). Safe to install alongside production. |
| `npm run tauri build` | **Production build (creates .dmg).** Replaces the user's installed md-mini if installed. **Explicit, owner-triggered only — do NOT run as part of routine dev/QA.** |
| `npm run tauri dev` | Tauri dev with **production identifier**. Conflicts with running production md-mini (shares single-instance socket, app data, recovery files). **Avoid while the user is actively using md-mini — use `npm run dev` or `npm run dev:app` instead.** |
| `npm run build` | Frontend build only (no Tauri bundle) |

### Build / Test Policy While User Is Working

- **Default for visual verification:** `npm run dev` (browser). Most md-mini features are frontend; the editor, CodeMirror, decorations, mermaid all run in the browser context.
- **When Tauri features are needed:** `npm run dev:app`. Different identifier → different bundle ID → independent of the installed production app.
- **NEVER run `npm run tauri dev` or `npm run tauri build` as part of routine development or QA.** Both share state with the installed production md-mini and can disrupt the user's active session. Production build is an **explicit owner-triggered action**, never an automated step.

## Architecture

```
src-tauri/src/          # Rust (Tauri backend)
  lib.rs                # App builder, plugin registration, setup
  main.rs               # Entry point
  commands.rs           # IPC commands: read_file, write_file, file_exists
  menu.rs               # macOS native app menu
  window.rs             # Window creation with cascade + file dedup
  recovery.rs           # Crash recovery (temp files)
  watcher.rs            # File watcher (notify crate)

src/                    # Frontend (Svelte + TypeScript)
  App.svelte            # Root component, event wiring
  main.ts               # Svelte mount
  lib/editor/           # CodeMirror 6 editor
    Editor.svelte       # CM6 wrapper component
    setup.ts            # Extension assembly
    keybindings.ts      # Cmd+B/I/X formatting toggles
    autocomplete.ts     # List continuation, bracket pairing, code fence close
    slash-commands.ts   # "/" block insertion
    hover-menu.ts       # Gutter "+" menu
    block-templates.ts  # Shared block insertion templates (headings, lists, table, etc.)
    folding.ts          # Heading fold/collapse (foldService + mousedown click handler)
    preview/            # Live-preview decorations
      plugin.ts         # Main ViewPlugin (builds DecorationSet)
      headings.ts       # Heading decorations
      inline.ts         # Bold, italic, strikethrough, code, links
      lists.ts          # Lists, checkboxes, blockquotes
      blocks.ts         # Code blocks, HR
      tables.ts         # Table widget
      mermaid.ts        # Mermaid diagram rendering (lazy-loaded, async SVG via StateEffect)
      utils.ts          # cursorInRange() helper
  lib/stores.svelte.ts  # Svelte stores (fileState, theme, mode, zoom, recentFiles)
  lib/theme/            # CSS variables + CM6 theme
  lib/tauri/            # Tauri IPC wrappers + event listeners
  styles/               # Global CSS, editor decoration styles
  assets/fonts/         # Bundled woff2 (Inter, Merriweather, JetBrains Mono)
```

## Key Files

- `docs/superpowers/specs/2026-03-19-md-mini-design.md` — Full design specification
- `docs/superpowers/plans/2026-03-20-md-mini-implementation.md` — Implementation plan (16 tasks)
- `docs/cli-launcher.md` — How the CLI launcher works (two-path approach: `open` + single-instance IPC)
- `src-tauri/tauri.conf.json` — Tauri config (window defaults, CLI args, plugins)
- `src-tauri/capabilities/default.json` — Tauri permissions
- `src/lib/editor/setup.ts` — All CM6 extensions assembled here
- `src/lib/editor/preview/plugin.ts` — Core live-preview logic (ViewPlugin + DecorationSet)
- `src/lib/editor/preview/CLAUDE.md` — Table implementation deep dive (decorations, operations, gotchas)
- `src/lib/editor/block-templates.ts` — Single source of truth for block insertion templates (hover menu + slash commands)
- `src/lib/editor/folding.ts` — Heading fold service + click handler

## Tech Stack

| Layer | Technology | Docs |
|-------|-----------|------|
| Native shell | Tauri 2 | https://v2.tauri.app |
| Frontend | Svelte 5 (runes: `$state`, `$derived`, `$effect`, `$props`) | https://svelte.dev |
| Editor | CodeMirror 6 | https://codemirror.net |
| MD parser | `@lezer/markdown` with GFM extensions (Strikethrough, Table) | |
| Build | Vite | |
| Fonts | Inter, Merriweather, JetBrains Mono (bundled woff2) | |

## Code Style

### TypeScript / Svelte
- Svelte 5 runes API only — `$state`, `$derived`, `$effect`, `$props`. No Svelte 4 syntax.
- Strict TypeScript. No `any`.
- CM6 extensions: one file per concern, assembled in `setup.ts`
- Preview decorations: one file per markdown element category
- **RangeSetBuilder ordering:** `Decoration.mark()` BEFORE `Decoration.replace()` at same position (mark has lower startSide)
- Stores: Svelte 5 runes-based (not Svelte stores). Document content lives in CodeMirror state, NOT in Svelte stores.
- Imports: use `@tauri-apps/api` for Tauri JS, `@codemirror/*` for CM6

### Rust
- Tauri 2 command pattern: `#[tauri::command]` async functions in `commands.rs`
- Atomic file writes: write to `.tmp`, then `fs::rename`
- Error handling: return `Result<T, String>` from commands
- Use `tauri::Manager` trait for `app.get_webview_window()`, `app.webview_windows()`
- Note: Tauri 2 has NO `app.get_focused_window()` — iterate `webview_windows()` instead

## Testing

- `npm run test` — Vitest for frontend (stores, utility functions, CM6 extensions where testable)
- `cargo test` — Rust unit tests for commands (file I/O, recovery)
- After each task: manually verify in `npm run tauri dev` — many features are visual
- CM6 decoration logic: test with CM6's `EditorState.create()` in Vitest, inspect decoration ranges
- **Tauri MCP Bridge:** In dev mode, `mcp__tauri__webview_screenshot`, `webview_execute_js`, `read_logs` available for automated UI testing. Plugin only in debug builds (`#[cfg(debug_assertions)]`).

## Gotchas

- **Svelte 5 runes require `.svelte.ts` extension:** Files using `$state`, `$derived`, `$effect` outside `.svelte` components MUST be named `*.svelte.ts`, not `*.ts`. Plain `.ts` files won't compile runes — the app loads a white screen with no errors. `npm run check` does NOT catch this.
- **Kill port 1420 before `npm run tauri dev`:** Previous dev sessions leave Vite running. Use `lsof -ti:1420 | xargs kill -9` to free the port.
- **GFM required:** `@lezer/markdown` needs explicit `extensions: [Strikethrough, Table]` in the markdown() call — without this, `~~strikethrough~~` and tables don't produce AST nodes
- **Decoration ordering:** CM6 RangeSetBuilder crashes if decorations aren't in `(from, startSide)` order. `Decoration.mark` goes before `Decoration.replace` at the same position.
- **No cross-line Decoration.replace:** Replacing text that crosses `\n` boundaries causes rendering glitches. Use line decorations (e.g., `Decoration.line({ class: 'hidden' })`) instead.
- **Slash commands vs closeBrackets:** Don't use `autocompletion({ override: [...] })` — it replaces ALL completion sources. Use `EditorState.languageData` to add completion sources alongside existing ones.
- **Svelte 5 exports:** `export function` from `<script>` doesn't work in runes mode. Use `bind:this` + public `$state` properties.
- **Svelte 5 `$bindable` for handles:** To expose EditorView from Editor.svelte, use a `$bindable()` handle prop with an interface, not `export let` or `export function`.
- **Tauri 2 MenuId:** Use `event.id().as_ref()` not `event.id().0` to get menu item ID string.
- **Single instance:** `tauri-plugin-single-instance` callback receives `&AppHandle`, not owned. `args[0]` is the binary path — skip it.
- **Font paths:** Vite resolves `url()` in CSS relative to the CSS file. Put fonts in `src/assets/fonts/` and reference as `/src/assets/fonts/Foo.woff2`.
- **macOS CLI launcher:** GUI apps cannot be backgrounded with `&` / `disown` / `nohup` — lose window server access. Use `open /path/to/app.app` for launch, single-instance socket IPC for file args. See `docs/cli-launcher.md`.
- **Single-instance stale socket:** `kill -9` leaves `/tmp/com_md_mini_app_si.sock` — new instances think app is running and exit silently. Delete socket to fix: `rm -f /tmp/com_md_mini_app_si.sock`
- **Tauri 2 `onCloseRequested`:** Registering a JS listener automatically calls `api.prevent_close()`. The handler MUST call `window.destroy()` or the window will never close. Prefer handling close in Rust `on_window_event` instead.
- **Lezer GFM tables exclude whitespace-only rows:** New/empty table rows must contain visible content (e.g., `-`) or Lezer won't include them in the Table syntax node.
- **Table delimiter detection:** Use position-based (2nd line of table), NOT regex. Regex `\|[\s|:-]+\|` matches data rows containing dashes.
- **CM6 widget `eq()` must compare structural context:** If a widget holds document positions (like TableContext), `eq()` must compare them. Otherwise CM6 reuses stale widgets after edits.
- **CM6 fold API:** Use `foldable(state, from, to)` to query fold ranges. Do NOT access `foldService.value` directly.
- **CM6 gutter elements get clipped:** `overflow: hidden` on `.cm-content` clips absolute-positioned elements. Use `padding-left` + `::before` within the line instead of negative `left` offsets.
- **`/usr/local/bin/mdmini` must be a COPY** of `scripts/mdmini`, not a symlink to the binary. `cp` over a symlink follows the symlink and corrupts the target.
- **CM6 CSS specificity:** CM6 uses generated selectors like `.ͼ1 .cm-line` (2 classes). To override, use `.cm-line.cm-md-table-line` (also 2 classes), not just `.cm-md-table-line` (1 class).
- **CM6 `cm-widgetBuffer` images:** CM6 adds hidden `<img>` elements around widget decorations. In inline formatting context they add ~14px height per line. Use `display: flex` on parent line to eliminate this.
- **CSS `contain: inline-size` for wide widgets:** Prevents wide tables/widgets from expanding `.cm-content` (which breaks `lineWrapping`). Apply on `.cm-line`, move visual styles (background, border) to widget wrapper so they match content width, not viewport width.
- **CM6 widget-hosting line must stay visible:** When replacing a fenced block with a widget (`Decoration.replace`), the `.cm-line` that hosts the widget must NOT have `height: 0` or `overflow: hidden`. The widget is a child of `.cm-line` — hiding it clips the widget. Only hide subsequent lines.
- **Mermaid render is async:** `mermaid.render()` returns a Promise but CM6 `WidgetType.toDOM()` is sync. Use placeholder widget + `StateEffect` to trigger decoration rebuild when SVG is ready. See `preview/mermaid.ts`.

## Workflow

- **Git:** conventional commits, commit after each task completion
- **Testing:** write tests for utility functions and Rust commands. Visual features verified manually.
- **After each major feature/milestone:** run `/claude-md-management:revise-claude-md` to update this file with new learnings
- **Memory:** save project context and learnings to `.claude/projects/` memory after significant sessions
- **Plan:** implementation plan in `docs/superpowers/plans/` — track progress with checkboxes
- **Code review:** run `code-reviewer` agent after completing implementation tasks
- **Context7 MCP:** use `resolve-library-id` + `query-docs` to fetch up-to-date API docs for Tauri, Svelte, CM6 when unsure about APIs
