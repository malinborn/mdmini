# md-mini

Minimalist live-preview markdown editor for macOS. Tauri 2 + Svelte 5 + CodeMirror 6.

## Commands

| Command | Description |
|---------|-------------|
| `npm install` | Install frontend dependencies |
| `npm run tauri dev` | Start Tauri dev mode (frontend + native window) |
| `npm run tauri build` | Production build (creates .dmg) |
| `npm run dev` | Frontend only (Vite dev server, no Tauri) |
| `npm run build` | Frontend build only |
| `npm run check` | Svelte type checking |
| `cd src-tauri && cargo test` | Run Rust tests |
| `npm run test` | Run frontend tests (vitest) |
| `cargo clippy --manifest-path src-tauri/Cargo.toml` | Rust linter |

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
    preview/            # Live-preview decorations
      plugin.ts         # Main ViewPlugin (builds DecorationSet)
      headings.ts       # Heading decorations
      inline.ts         # Bold, italic, strikethrough, code, links
      lists.ts          # Lists, checkboxes, blockquotes
      blocks.ts         # Code blocks, HR
      tables.ts         # Table widget
      utils.ts          # cursorInRange() helper
  lib/stores.ts         # Svelte stores (fileState, theme, mode, zoom, recentFiles)
  lib/theme/            # CSS variables + CM6 theme
  lib/tauri/            # Tauri IPC wrappers + event listeners
  styles/               # Global CSS, editor decoration styles
  assets/fonts/         # Bundled woff2 (Inter, Merriweather, JetBrains Mono)
```

## Key Files

- `docs/superpowers/specs/2026-03-19-md-mini-design.md` — Full design specification
- `docs/superpowers/plans/2026-03-20-md-mini-implementation.md` — Implementation plan (16 tasks)
- `src-tauri/tauri.conf.json` — Tauri config (window defaults, CLI args, plugins)
- `src-tauri/capabilities/default.json` — Tauri permissions
- `src/lib/editor/setup.ts` — All CM6 extensions assembled here
- `src/lib/editor/preview/plugin.ts` — Core live-preview logic (ViewPlugin + DecorationSet)

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

## Gotchas

- **GFM required:** `@lezer/markdown` needs explicit `extensions: [Strikethrough, Table]` in the markdown() call — without this, `~~strikethrough~~` and tables don't produce AST nodes
- **Decoration ordering:** CM6 RangeSetBuilder crashes if decorations aren't in `(from, startSide)` order. `Decoration.mark` goes before `Decoration.replace` at the same position.
- **No cross-line Decoration.replace:** Replacing text that crosses `\n` boundaries causes rendering glitches. Use line decorations (e.g., `Decoration.line({ class: 'hidden' })`) instead.
- **Slash commands vs closeBrackets:** Don't use `autocompletion({ override: [...] })` — it replaces ALL completion sources. Use `EditorState.languageData` to add completion sources alongside existing ones.
- **Svelte 5 exports:** `export function` from `<script>` doesn't work in runes mode. Use `bind:this` + public `$state` properties.
- **Tauri 2 MenuId:** Use `event.id().as_ref()` not `event.id().0` to get menu item ID string.
- **Single instance:** `tauri-plugin-single-instance` callback receives `&AppHandle`, not owned. `args[0]` is the binary path — skip it.
- **Font paths:** Vite resolves `url()` in CSS relative to the CSS file. Put fonts in `src/assets/fonts/` and reference as `/src/assets/fonts/Foo.woff2`.

## Workflow

- **Git:** conventional commits, commit after each task completion
- **Testing:** write tests for utility functions and Rust commands. Visual features verified manually.
- **After each major feature/milestone:** run `/claude-md-management:revise-claude-md` to update this file with new learnings
- **Memory:** save project context and learnings to `.claude/projects/` memory after significant sessions
- **Plan:** implementation plan in `docs/superpowers/plans/` — track progress with checkboxes
- **Code review:** run `code-reviewer` agent after completing implementation tasks
- **Context7 MCP:** use `resolve-library-id` + `query-docs` to fetch up-to-date API docs for Tauri, Svelte, CM6 when unsure about APIs
