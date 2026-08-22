# AI Interface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let AI agents drive the running md-mini via `mdmini show` / `mdmini edit` — focus a location with a pulse highlight, and apply edits to the live buffer with the changed spans highlighted.

**Architecture:** A small Unix-socket JSON-lines listener inside the running app (background thread, request/response correlated by id through a pending map). Commands route to the window owning the file via the existing `OpenFiles` registry (windows created on the main thread via `run_on_main_thread`), and reach the frontend as an `ai-command` event or a pull-on-mount queue for freshly created windows. The CLI client lives inside the app binary (`md-mini ai …`, intercepted in `main.rs` before Tauri starts), so the bash wrapper never builds JSON.

**Tech Stack:** Rust std `UnixListener`/`UnixStream` (no new crates), serde/serde_json (already present), CM6 StateField/Decoration, Svelte 5.

**Spec:** `docs/superpowers/specs/2026-08-22-ai-interface-design.md`

---

### Task 1: Rust — protocol types, socket path, listener (`ai_socket.rs`)

**Files:**
- Create: `src-tauri/src/ai_socket.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod ai_socket;`)

- [x] **Step 1: Write failing cargo tests** in `ai_socket.rs` `#[cfg(test)]`:
  - `socket_path_release_and_dev_differ`: `socket_path("md-mini") == /tmp/md_mini_cmd.sock`, `socket_path("md-mini-dev") == /tmp/md_mini_dev_cmd.sock` (non-alphanumeric chars in product name → `_`).
  - `parses_show_with_line`: `{"v":1,"cmd":"show","path":"/a.md","line":42}` → `AiRequest::Show { line: Some(42), find: None, .. }`.
  - `parses_edit_with_default_show`: `{"v":1,"cmd":"edit","path":"/a.md","content":"x"}` → `Edit { show: false, .. }`.
  - `malformed_line_yields_error_response`: `parse_request("not json")` returns `Err(String)`; `AiResponse::error("boom")` serializes to `{"ok":false,"error":"boom"}` (no `changed_lines` key — use `skip_serializing_if = "Option::is_none"`).
- [x] **Step 2: Run** `cargo test --manifest-path src-tauri/Cargo.toml ai_socket` — expect FAIL (module missing).
- [x] **Step 3: Implement** in `ai_socket.rs`:

```rust
#[derive(Debug, serde::Deserialize)]
#[serde(tag = "cmd", rename_all = "lowercase")]
pub enum AiRequest {
    Show { v: u32, path: String, #[serde(default)] line: Option<usize>, #[serde(default)] find: Option<String> },
    Edit { v: u32, path: String, content: String, #[serde(default)] show: bool },
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AiResponse {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")] pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub changed_lines: Option<Vec<[usize; 2]>>,
}
impl AiResponse { pub fn ok() -> Self {..} pub fn error(msg: impl Into<String>) -> Self {..} }

pub fn socket_path(product_name: &str) -> std::path::PathBuf; // sanitize → /tmp/<name>_cmd.sock
pub fn parse_request(line: &str) -> Result<AiRequest, String>;
```

  Listener (`pub fn start(app: &AppHandle)`): resolve path from `app.config().product_name`, `let _ = std::fs::remove_file(&path)` (stale socket), bind `std::os::unix::net::UnixListener`, `std::fs::set_permissions(&path, PermissionsExt::from_mode(0o600))`, then `std::thread::spawn` accept loop; each connection: `BufReader::read_line`, `parse_request`, on Ok → `dispatch` (Task 2) with an `std::sync::mpsc::channel::<AiResponse>()`, `rx.recv_timeout(Duration::from_secs(8))` (timeout → `AiResponse::error("timeout waiting for editor")`), write `serde_json::to_string(&resp) + "\n"`, next line (connection stays usable; parse error → error response, continue).
- [x] **Step 4: Run tests** — expect PASS. Also `cargo clippy --manifest-path src-tauri/Cargo.toml` clean.
- [x] **Step 5: Commit** `feat(ai): command socket protocol and listener`

### Task 2: Rust — dispatch, pending queue, frontend correlation

**Files:**
- Modify: `src-tauri/src/ai_socket.rs`
- Modify: `src-tauri/src/lib.rs` (manage state, register commands, call `ai_socket::start` at the end of `setup`, remove socket file in both exit paths — same dual-path rule as `save_session_on_exit`)

- [ ] **Step 1: Failing tests**: `pending_queue_drains_once` (push two payloads for label, `pull("editor-3")` returns both then empty); `respond_routes_to_waiting_request` (register id in `AiPending`, `respond(id, resp)` → receiver gets it; unknown id is a no-op).
- [ ] **Step 2: Implement state + dispatch:**

```rust
pub struct AiPending { map: Mutex<HashMap<u64, mpsc::Sender<AiResponse>>>, next: AtomicU64 }
/// Commands for windows created by an AI request, pulled by the frontend on mount.
pub struct AiQueue(pub Mutex<HashMap<String, Vec<AiCommandPayload>>>);

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCommandPayload { pub id: u64, pub cmd: String /* "show"|"edit" */, pub path: String,
    pub line: Option<usize>, pub find: Option<String>, pub content: Option<String>, pub show: bool }
```

  `dispatch(app, req, tx)`: id = `AiPending::register(tx)`; build payload; look up label in `OpenFiles`; if the window exists → `win.emit("ai-command", &payload)`; else → push payload into `AiQueue` under a label reserved by opening the window: **window creation must run on the main thread** — `app.run_on_main_thread(move || window::open_file_window(&handle, Some(path)))`. To learn the new label, change nothing in `open_file_window`; after the closure runs, re-read `OpenFiles` for the path (post a second `run_on_main_thread` or poll the map from the socket thread with a short sleep loop, ≤2s) and queue under that label.
  Tauri commands: `#[tauri::command] ai_respond(app, id: u64, response: AiResponse)` → `AiPending::respond`; `#[tauri::command] ai_pull_pending(window: tauri::WebviewWindow) -> Vec<AiCommandPayload>` → drain `AiQueue` for `window.label()`.
- [ ] **Step 3: Run** `cargo test --manifest-path src-tauri/Cargo.toml` + clippy — PASS/clean.
- [ ] **Step 4: Commit** `feat(ai): dispatch AI commands to owning windows`

### Task 3: Frontend — AI highlight CM6 extension

**Files:**
- Create: `src/lib/editor/ai-highlight.ts`
- Test: `src/lib/editor/ai-highlight.test.ts`
- Modify: `src/lib/editor/setup.ts` (add extension), `src/styles/editor.css` (classes)

- [ ] **Step 1: Failing vitest** (CM6 `EditorState.create` in-memory, per repo pattern):
  - set effect installs ranges; a user edit before a range shifts it (`value.map(tr.changes)`);
  - a new set effect replaces old ranges entirely;
  - clear effect empties the field;
  - deleting the whole highlighted span drops the range (mapped to empty → filtered out).
- [ ] **Step 2: Implement** `ai-highlight.ts`:

```ts
export const setAiHighlights = StateEffect.define<readonly {from: number; to: number}[]>();
export const clearAiHighlights = StateEffect.define<null>();
export const aiHighlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(clearAiHighlights)) deco = Decoration.none;
      if (e.is(setAiHighlights)) deco = Decoration.set(
        e.value.filter(r => r.to > r.from).map(r => aiMark.range(r.from, r.to)), true);
    }
    return deco;
  },
  provide: f => EditorView.decorations.from(f),
});
export function aiHighlightRanges(state: EditorState): {from: number; to: number}[]; // for tests/response
export const aiHighlightKeymap = keymap.of([{ key: 'Escape',
  run: v => { if (field empty) return false; v.dispatch({effects: clearAiHighlights.of(null)}); return true; } }]);
```

  Mark: `Decoration.mark({ class: 'cm-ai-edit' })`. Pulse for `show`: `pulseAiLine = StateEffect.define<number>()` adds `Decoration.line({ class: 'cm-ai-pulse' })` to that line in the same field; the App handler clears it via `clearAiHighlights` after 1600ms `setTimeout`. CSS: `.cm-ai-edit { background: var(--ai-edit-bg); }`, `.cm-ai-pulse { animation: ai-pulse 1.6s ease-out; }` with `--ai-edit-bg` defined in both `src/lib/theme/dark.css` and `light.css` (subtle accent tint). Wire `aiHighlightField` + `aiHighlightKeymap` into `createExtensions()` in `setup.ts`.
- [x] **Step 3: Run** `npx vitest run --dir src` + `npm run check` — PASS.
- [x] **Step 4: Commit** `feat(ai): highlight field for AI edits with Esc to clear`

### Task 4: Frontend — handle ai-command (show/edit) and respond

**Files:**
- Create: `src/lib/ai-commands.ts` (pure helpers) + `src/lib/ai-commands.test.ts`
- Modify: `src/lib/tauri/events.ts` (`onAiCommand`), `src/App.svelte` (handler + pull on mount)

- [ ] **Step 1: Failing vitest** for pure helpers in `ai-commands.ts`:
  - `resolveShowTarget(state, {line, find})` → doc position: line is 1-based and clamped to `[1, doc.lines]`; `find` → first `indexOf` in `doc.toString()`, miss → `null`; both absent → 0.
  - `changedLineRanges(state, span)` → 1-based inclusive `[start, end]` for the *inserted* span in the new doc (`{from, from + insert.length}`); empty insert (pure deletion) → the single line containing `from`.
- [ ] **Step 2: Implement helpers + wiring.** `events.ts`:

```ts
export interface AiCommandPayload { id: number; cmd: 'show' | 'edit'; path: string;
  line: number | null; find: string | null; content: string | null; show: boolean; }
export function onAiCommand(handler: (p: AiCommandPayload) => void): Promise<() => void>; // listen('ai-command', …)
```

  `App.svelte` `handleAiCommand(p)`:
  - guard `p.path === fileState.filePath`, else respond `{ok:false, error:'window does not own this file'}`;
  - **show**: `resolveShowTarget`; miss → `{ok:false, error:'target not found'}`; else dispatch `EditorView.scrollIntoView(pos, {y:'center'})` + `pulseAiLine` effect, respond `{ok:true}`;
  - **edit**: `computeReplacement(doc, p.content)`; null → `{ok:true, changed_lines: []}`; else one transaction exactly like `updateContent` (single-span `ChangeSet`, `scrollSnapshot().map(changes)`, `addToHistory.of(false)`) **plus** `setAiHighlights.of([{from: repl.from, to: repl.from + repl.insert.length}])` (mapped: effect ranges are in post-change coordinates — set them via a second dispatch or `StateEffect` appended after `changes` in the same spec, ranges computed against the new doc); `p.show` → also `scrollIntoView(repl.from, {y:'center'})`; respond `{ok:true, changed_lines: changedLineRanges(view.state, repl)}`; autosave: call `handleChange`-equivalent (`fileState.isDirty = true; scheduleAutoSave()`) since `addToHistory(false)` still triggers the update listener — verify, don't double-arm.
  - respond via `invoke('ai_respond', { id: p.id, response })`.
  In `onMount`, after the `get_pending_file` block resolves: `const queued = await invoke<AiCommandPayload[]>('ai_pull_pending'); queued.forEach(handleAiCommand);` and register `onAiCommand(handleAiCommand)` with the other listeners (+ cleanup).
- [ ] **Step 3: Run** `npx vitest run --dir src` + `npm run check` — PASS.
- [ ] **Step 4: Commit** `feat(ai): handle show/edit commands in the editor`

### Task 5: CLI — client in the binary, wrapper subcommands

**Files:**
- Modify: `src-tauri/src/main.rs` (intercept `ai` before Tauri starts), `src-tauri/src/lib.rs` or `ai_socket.rs` (`pub fn run_ai_cli(args: Vec<String>) -> i32`), `scripts/mdmini`

- [ ] **Step 1: Implement `run_ai_cli`** (std only, no Tauri): parse `ai show <file> [--line N | --find TEXT]` / `ai edit <file> [--show]`; resolve the file to an absolute path (reuse the logic of `resolve_path`); `edit` reads full stdin as content; socket = `--socket <path>` flag if given else `/tmp/md_mini_cmd.sock`; connect `UnixStream` (set `read_timeout(10s)`), write request line, read one response line, print it to stdout verbatim, return exit code 0 if `"ok":true` else 1; connection failure → print `{"ok":false,"error":"md-mini is not running"}`, exit 2. In `main.rs`:

```rust
fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("ai") {
        std::process::exit(md_mini_lib::ai_socket::run_ai_cli(args));
    }
    md_mini_lib::run()
}
```

- [ ] **Step 2: Cargo tests** for the arg parser (`ai_cli_args_show_with_line`, `ai_cli_args_edit_reads_flags`, unknown verb → usage error). Run + clippy — PASS.
- [ ] **Step 3: Extend `scripts/mdmini`**: if `$1` is `show` or `edit`: if the command socket is missing → start the app (existing pending-files + `open` path, no file args) and poll for the socket up to 5s; then `exec "$BIN" ai "$@"` (stdin passes through for `edit`). Existing file-open behavior for all other invocations unchanged. Remember the deployed copy rule: `/usr/local/bin/mdmini` is a COPY — doc the re-copy step, do not overwrite it yourself.
- [ ] **Step 4: Manual e2e** (dev build, per CLAUDE.md isolation rules): `npm run build:dev`, launch `md-mini-dev.app` binary from a terminal, then against the dev socket:
  `"$DEVBIN" ai show /tmp/demo.md --line 20 --socket /tmp/md_mini_dev_cmd.sock` → window focuses, line pulses;
  `printf '…new content…' | "$DEVBIN" ai edit /tmp/demo.md --socket /tmp/md_mini_dev_cmd.sock` → span highlighted, `changed_lines` correct, scroll stays put; Esc clears; second edit replaces highlight; edit of a not-open file opens a window and applies.
- [ ] **Step 5: Commit** `feat(ai): mdmini show/edit CLI verbs`

### Task 6: Docs

**Files:**
- Create: `docs/ai-interface.md` (verbs, JSON contract, socket protocol, launch-if-not-running flow, the CLAUDE.md paragraph users paste into their projects)
- Modify: `CLAUDE.md` (Architecture file list + Commands note), `docs/cli-launcher.md` (mention the `ai` passthrough)

- [ ] **Step 1: Write docs, commit** `docs: AI interface usage and protocol`

## Verification (whole feature)

- `npx vitest run --dir src` — all pass (new: ai-highlight, ai-commands).
- `cargo test --manifest-path src-tauri/Cargo.toml` + clippy — pass/clean.
- `npm run check` — 0 errors.
- Manual e2e from Task 5 Step 4.
