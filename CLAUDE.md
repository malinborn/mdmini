# md-mini

Minimalist live-preview markdown editor for macOS. Tauri 2 + Svelte 5 + CodeMirror 6.

# md

## Commands

| Command | Description |
|---------|-------------|
| `npm install` | Install frontend dependencies |
| `npm run dev` | **Default for visual checks.** Frontend only (Vite at http://localhost:1420). No Tauri shell — open the URL in any browser. |
| `npm run dev:app` | Tauri dev with **renamed identifier** (`md-mini-dev` / `com.md-mini.dev`). Own bundle ID, own single-instance socket, and own data directory (`~/Library/Application Support/md-mini-dev/`) — does NOT conflict with an installed production md-mini. Use when you need Tauri IPC (file I/O, menu, native dialogs). |
| `npm run check` | Svelte type checking |
| `npm run test` | Run frontend tests (vitest) |
| `cd src-tauri && cargo test` | Run Rust tests |
| `cargo clippy --manifest-path src-tauri/Cargo.toml` | Rust linter |
| `npm run build:dev` | **Renamed dev .dmg** (`md-mini-dev`). Safe to install alongside production. |
| `npm run check:x86` | Compile for `x86_64-apple-darwin`. Fast guard that an Intel build still works — no bundle, no install. |
| `npm run build:universal` | **Production universal .dmg** (Apple Silicon + Intel). Same owner-triggered rule as `tauri build`. |
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
  paths.rs              # App data directory, named after the product (isolates dev from release)
  recovery.rs           # Crash recovery (temp files)
  session.rs            # Session restore (window list, geometry, caret, untitled buffers)
  watcher.rs            # File watcher (notify crate)
  ai_socket.rs          # AI interface: command socket (mdmini show/edit) + CLI client

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
      mermaid-viewport.ts # Pan/zoom geometry (pure) + frame DOM controller
      mermaid-state.ts  # Per-diagram scale/pan/height (StateField, in-memory)
      utils.ts          # cursorInRange() helper
      flavour.ts        # Per-element reveal policy (Facet) — shouldReveal()
    live-render/        # The Notion-like beta mode; installed only when active
      index.ts          # liveRenderExtensions() bundle for previewCompartment
      atomic.ts         # atomicRanges + the mandatory caret transactionFilter
      block-format.ts   # Backspace strips heading/list/quote formatting
      inline-continuation.ts # Typing at a span boundary continues its format
      selection-toolbar.ts   # Floating inline-format toolbar (floating-ui)
      inspector.ts / inspector-model.ts # Link URL + fenced-code language
    ai-highlight.ts     # AI-edit/pulse highlight StateField (mdmini show/edit), Esc to clear
  lib/ai-commands.ts    # Pure helpers for AI commands (show target resolution, changed-line ranges)
  lib/stores.svelte.ts  # Svelte stores (fileState, theme, mode, zoom, recentFiles)
  lib/toasts.svelte.ts  # Toast stack store (update + session notifications)
  lib/ToastStack.svelte # Bottom-right toast stack
  lib/session-position.ts # Clamps for a restored caret and scroll line
  lib/theme/            # CSS variables (light/dark + aurora-light/aurora-dark) + CM6 theme
  lib/tauri/            # Tauri IPC wrappers + event listeners
  styles/               # Global CSS, editor decoration styles
  assets/fonts/         # Bundled woff2 (Inter, Merriweather, JetBrains Mono)
```

## Key Files

- `docs/superpowers/specs/2026-03-19-md-mini-design.md` — Full design specification
- `docs/superpowers/plans/2026-03-20-md-mini-implementation.md` — Implementation plan (16 tasks)
- `docs/cli-launcher.md` — How the CLI launcher works (two-path approach: `open` + single-instance IPC)
- `docs/ai-interface.md` — `mdmini show`/`edit`: CLI syntax, JSON contract, command socket protocol, CLAUDE.md paragraph to paste into other projects
- `src-tauri/tauri.conf.json` — Tauri config (window defaults, CLI args, plugins)
- `src-tauri/capabilities/default.json` — Tauri permissions
- `src/lib/editor/setup.ts` — All CM6 extensions assembled here
- `src/lib/editor/preview/plugin.ts` — Core live-preview logic (ViewPlugin + DecorationSet)
- `src/lib/editor/preview/CLAUDE.md` — Table implementation deep dive (decorations, operations, gotchas), plus the per-element reveal policy
- `src/lib/editor/live-render/CLAUDE.md` — **Read before touching the live-render beta.** Why atomicity needs two mechanisms, why Backspace needs `Prec.highest` while Escape does not, the two-offsets-one-pixel caret boundary, and the three traps that make this mode's bugs invisible to unit tests
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

- **Never pass a `bool` literal to an Objective-C API.** `objc`'s `BOOL` is `bool` on aarch64 but `c_schar` (`i8`) on every other target, so `ns_app.activateIgnoringOtherApps_(true)` compiles on Apple Silicon and fails the x86_64 build with `expected i8, found bool`. Use `cocoa::base::YES`/`NO`, which are defined per arch. This kept Intel builds broken until 2026-08-23 and is invisible unless you actually cross-compile — `npm run check:x86` is the guard.
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
- **Natural-size SVG needs a contained host line:** giving a widget SVG its intrinsic width (required for exact zoom math) stretches `.cm-content` and breaks line wrapping *document-wide*, even with `overflow: hidden` on an inner wrapper. Put `contain: inline-size` on the hosting `.cm-line` via a line decoration. Symptom: `.cm-scroller` gains horizontal overflow.
- **Block widgets must have ZERO vertical CSS margins on their root element.** CM6's height map measures widget height without margins, so every line below the widget sits lower in the DOM than the map thinks. `posAtCoords`'s vertical-scan mode then mis-resolves ArrowUp/Down across the widget — the caret skips all lines between it and the widget's host line. Put spacing as `padding` on an outer wrapper inside the widget DOM instead (padding is part of offsetHeight).
- **Never dispatch a CM6 transaction per animation frame:** interactive gestures (pan/zoom) must write to the DOM directly and commit to a `StateField` on a trailing debounce. A dispatch per `wheel` event triggers a full decoration rebuild each frame.
- **Widget `eq()` should exclude the document position** when the widget is expensive to build: including it rebuilds the DOM on every keystroke elsewhere in the file. Resolve the live position at commit time with `view.posAtDOM(dom)`, snapped to `doc.lineAt(...).from`.
- **Reach the EditorView from the DOM in browser tests:** `document.querySelector('.cm-content').cmTile.root.view`. Useful with `npm run dev` + Playwright, since Tauri file I/O is unavailable there.
- **Playwright in this repo:** the cached chromium build lags the current Playwright CLI. Launch with `chromium.launch({ channel: 'chrome' })` to use the installed Google Chrome instead of downloading a browser.
- **Don't run `npm init` with `--prefix`:** it writes to the project's `package.json`, not the target directory. `cd` into the scratchpad instead.
- **`RunEvent::ExitRequested` does NOT fire on Cmd+Q or an AppleEvent quit — `RunEvent::Exit` does.** `tauri-runtime-wry` emits `ExitRequested` from only two places: `Message::RequestExit` (i.e. `app.exit()`) and the `Destroyed` arm once the *last* window is gone. `NSApp terminate:` — which is what the predefined Quit item, Cmd+Q, and the `quit` AppleEvent Homebrew sends all do — goes `applicationWillTerminate` → tao `LoopDestroyed` → `RunEvent::Exit` instead. Measured on a real bundle: the AppleEvent quit logged `Exit` only, with **no `ExitRequested` and no `Destroyed`**. Any save-on-exit must handle both events (`save_session_on_exit` in `lib.rs`).
- **Quitting can destroy every window before the process exits,** so per-window cleanup in `WindowEvent::Destroyed` may run for all of them. Session restore guards this with a `quitting` flag that makes `SessionState::remove` a no-op, plus a rule that a quit never writes an *empty* window list over a good file. On macOS terminate the `Destroyed` storm turns out not to happen, but the close-last-window path does emit it.
- **Window geometry getters answer in PHYSICAL pixels; the builder consumes LOGICAL ones.** `outer_position()` / `inner_size()` return physical, while `WebviewWindowBuilder::position` / `inner_size` are documented "in logical pixels". Without `to_logical(scale_factor())` every restored window comes back at double size and offset on a 2× display. Use `session::window_geometry`.
- **`Moved`/`Resized` never fire for a window nobody touches,** so geometry cannot be collected from those events alone — an untouched window stays at 0×0 and restores into the top-left corner under the menu bar. Geometry therefore also rides the frontend heartbeat (`update_session_document`).
- **A file opened via CLI args must be registered in `OpenFiles`, not just `PendingFiles`.** `OpenFiles` is what every dedup check consults, so registering only the pending payload makes the launch file invisible: opening it again, or restoring a session containing it, silently produces a duplicate window. See `assign_file_to_main` in `lib.rs`.
- **Untitled sidecar GC must consider the pending restore.** The live session is deliberately empty at startup so the first write supersedes the file, but `pending` still references the previous run's buffers — pruning on the live set alone deletes exactly the unsaved drafts the user is about to reopen. Use `SessionState::referenced_untitled()`.
- **The update notification is `src/lib/updater.ts` + the toast stack**, not a Tauri updater plugin. It polls the GitHub releases API and compares versions; rendering goes through `toasts.svelte.ts` so it stacks with the session toast instead of overlapping it.
- **Verifying quit/exit behaviour needs both build flavours:** the MCP bridge exists only in debug (`#[cfg(debug_assertions)]`), while AppleScript can only address a registered `.app` bundle — `tauri dev`'s bare binary is invisible to `quit app id "..."`. Build with `npm run build:dev` and launch `md-mini-dev.app/Contents/MacOS/md-mini` **directly from a terminal**: that registers the bundle id *and* keeps stderr attached.
- **`pkill -f "src-tauri/target/debug/md-mini"` does not match the dev app:** its cmdline holds the relative path `target/debug/md-mini`. Use `pkill -f "debug/md-mini"`.
- **Never delete `/tmp/com_md_mini_dev_si.sock` while the dev app is alive:** the single-instance plugin then lets a second instance start alongside the first, and you end up with two dev apps on bridge ports 9223 and 9224.
- **On-disk state must go through `paths::app_data_dir()`,** never `dirs::data_dir().join("md-mini")`. The directory is named after the product name, so a dev build gets `md-mini-dev/` and cannot overwrite an installed release app's `recovery/` (which holds the user's unsaved work) or `session.json`. `paths::init` runs as the first statement in `setup`, before anything reads or writes.
- **`npm run test` overcounts:** vitest picks up stale copies under `.claude/worktrees/`. Use `npx vitest run --dir src` for a true count (513 at the time of writing).
- **Backspace needs `Prec.highest`, not `Prec.high`.** Backspace is in the view's `PendingKeys` table paired with `inputType: "deleteContentBackward"`, so on a contenteditable the native edit is allowed to land and is reconciled afterwards rather than being resolved from `keydown` alone. A binding at `Prec.high` is **never entered at all**, and the failure is not a clean fall-through — the DOM-derived change is applied instead. With the list bullet rendered as a widget, that reconciliation rewrote `- b` as `  b`: a silent outdent, text still inside the item. Measured in a browser; unit tests calling the command directly all passed throughout. Escape at `Prec.high` is fine — this is specific to keys that carry an `inputType`.
- **Reveal policy is per element, not per mode** (`preview/flavour.ts`). Decorators call `shouldReveal(view, kind, from, to, blockLevel?)`, never `cursorInRange` directly; `cursorInRange` stays pure and is called from inside it. `live-preview` is `{default: 'on-cursor'}` — today's behaviour comes out of the same code path instead of being preserved by discipline. Adding a flavour means adding a `Flavour` literal, not a branch.
- **`- [x] done` is `Task > TaskMarker`, never `Link`.** `markdownLanguage` already bundles GFM, so task lists parse natively and there is no checkbox/link collision to guard against. The real lookalike is `- [x](url) text`: `TaskList.parseBlock` requires whitespace after the bracket, so that parses as a plain inline `Link`, while `lists.ts`'s text-only regex still draws a checkbox over it. Also note that regex is case-**sensitive** — `[X]` renders no checkbox at all.
- **Hiding markers permanently does not remove reflow, it moves it.** A marker is only hidden once Lezer has a completed node, so while typing `**bol` you see raw text and the four characters vanish at once when the closing `*` lands. The jump is sharper than the one it replaces, just at a different moment.
- **Search in `live-render` runs against the source, not the screen.** `boldtext` inside `**bold**text` is unfindable, and searching `**` yields hits that are not rendered. A visual-text search index is the only real fix; until then it is a documented limitation of the mode.

## Workflow

- **Git:** conventional commits, commit after each task completion
- **Testing:** write tests for utility functions and Rust commands. Visual features verified manually.
- **After each major feature/milestone:** run `/claude-md-management:revise-claude-md` to update this file with new learnings
- **Memory:** save project context and learnings to `.claude/projects/` memory after significant sessions
- **Plan:** implementation plan in `docs/superpowers/plans/` — track progress with checkboxes
- **Code review:** run `code-reviewer` agent after completing implementation tasks
- **Context7 MCP:** use `resolve-library-id` + `query-docs` to fetch up-to-date API docs for Tauri, Svelte, CM6 when unsure about APIs
