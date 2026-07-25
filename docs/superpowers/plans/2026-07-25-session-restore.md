# Session Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remember the windows that were open when md-mini exited — their files, geometry, cursor and scroll position, and unsaved Untitled content — and offer to reopen them with `⇧⌘T` via a dismissible toast.

**Architecture:** A Rust-side `SessionState` holds the live session in memory, updated by window events (geometry) and an IPC command from the frontend (cursor, scroll line, Untitled content). It is written to `~/Library/Application Support/md-mini/session.json` by a ticker thread and, authoritatively, on `RunEvent::ExitRequested`. At startup the file is read into `pending_restore` and the live session starts empty, so the offer describes only the previous run. Restore reuses the existing `open_file_window` path. The existing imperative update banner is ported into a shared Svelte toast stack so the two notifications stack with a gap instead of overlapping.

**Tech Stack:** Rust / Tauri 2 (`serde`, `dirs`, `AtomicBool`, `WindowEvent`, `RunEvent`), Svelte 5 runes, CodeMirror 6, Vitest, `cargo test`.

**Spec:** `docs/superpowers/specs/2026-07-25-session-restore-design.md`

---

## Orientation for the implementer

Read these before starting. They are short and they explain the constraints that
this plan depends on.

| File | Why it matters |
|------|----------------|
| `src-tauri/src/window.rs` | `OpenFiles`, `PendingFiles`, `FileWatchers`, `open_file_window`, `untrack_window`. You will extend `PendingFiles` and add a restore variant of the window builder. |
| `src-tauri/src/lib.rs` | Plugin/state registration, `invoke_handler`, `setup`, `on_window_event`, and the `app.run(...)` event loop where `ExitRequested` belongs. |
| `src-tauri/src/recovery.rs` | The pattern to copy for on-disk state: `dirs::data_dir()`, `md-mini/` subdirectory, atomic `write` + `rename`. |
| `src/App.svelte` | `onMount` pulls the pending file via `get_pending_file`; auto-save is a 300 ms debounce; recovery runs on a 5 s interval (line ~201); the update checker is started at the end of `onMount`. |
| `src/lib/updater.ts` | Existing GitHub-API version check. Keeps its logic, loses its DOM building. |
| `src/styles/global.css` (~line 123) | `.md-update-banner` styles that become the shared `.md-toast`. |

**Project rules that apply here (from `CLAUDE.md`):**

- Svelte 5 runes only (`$state`, `$derived`, `$effect`, `$props`). No Svelte 4 syntax.
- **A file using runes outside a `.svelte` component MUST be named `*.svelte.ts`.** A plain `.ts` file with runes compiles to a white screen with no error, and `npm run check` does not catch it. This is why the toast store is `toasts.svelte.ts`.
- Strict TypeScript, no `any`.
- Rust commands return `Result<T, String>`.
- Conventional commits, commit after each task.

**Build/test commands:**

| Command | Use |
|---------|-----|
| `npm run test` | Vitest (frontend) |
| `npx vitest run <path>` | A single test file |
| `cd src-tauri && cargo test` | Rust tests |
| `npm run check` | Svelte/TS typecheck |
| `cargo clippy --manifest-path src-tauri/Cargo.toml` | Rust lint |
| `npm run dev:app` | Tauri dev under the `md-mini-dev` identifier — safe alongside an installed production md-mini |

**Never run `npm run tauri dev` or `npm run tauri build`.** They share the
single-instance socket and app data with the user's installed md-mini.

**Killing the dev app:** its cmdline is the *relative* path `target/debug/md-mini`,
so `pkill -f "src-tauri/target/debug/md-mini"` does **not** match. Use
`pkill -f "debug/md-mini"`. Do not delete `/tmp/com_md_mini_dev_si.sock` while the
app is alive — a second instance will then start alongside the first.

---

## Task 1: Fix the two pre-existing typecheck errors

`npm run check` currently reports two errors. Fix them first so that a clean
typecheck is a usable signal for the rest of this plan.

**Files:**
- Modify: `src/lib/tauri/events.ts`

- [ ] **Step 1: Confirm the current failure**

Run: `npm run check 2>&1 | tail -4`

Expected output contains:
```
ERROR "src/App.svelte" 242:14 "Type '"select_all"' is not comparable to type 'MenuAction'."
ERROR "src/App.svelte" 265:14 "Type '"toggle_line_glow"' is not comparable to type 'MenuAction'."
```

- [ ] **Step 2: Add the missing members to the union**

In `src/lib/tauri/events.ts`, replace the `MenuAction` type with:

```typescript
export type MenuAction =
  | 'new'
  | 'open'
  | 'save'
  | 'save_as'
  | 'close'
  | 'select_all'
  | 'find'
  | 'toggle_mode'
  | 'zoom_in'
  | 'zoom_out'
  | 'zoom_reset'
  | 'toggle_line_glow'
  | 'theme_light'
  | 'theme_dark'
  | 'theme_system'
  | 'recent_files';
```

- [ ] **Step 3: Verify the typecheck is clean**

Run: `npm run check 2>&1 | tail -3`
Expected: `COMPLETED 416 FILES 0 ERRORS 0 WARNINGS`

- [ ] **Step 4: Commit**

```bash
git add src/lib/tauri/events.ts
git commit -m "fix(types): add select_all and toggle_line_glow to MenuAction"
```

---

## Task 2: Session types and pure state logic

**Files:**
- Create: `src-tauri/src/session.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod session;`)

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/session.rs` with only the test module and the imports it
needs, so the compile failure is about missing items:

```rust
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

#[cfg(test)]
mod tests {
    use super::*;

    fn snap(path: Option<&str>) -> WindowSnapshot {
        WindowSnapshot {
            path: path.map(|p| p.to_string()),
            untitled: None,
            x: 10,
            y: 20,
            width: 900,
            height: 700,
            cursor: 5,
            top_line: 3,
        }
    }

    #[test]
    fn json_roundtrip_uses_camel_case() {
        let session = Session {
            version: SESSION_VERSION,
            saved_at: 42,
            windows: vec![snap(Some("/tmp/a.md"))],
        };
        let json = serde_json::to_string(&session).unwrap();
        assert!(json.contains("\"topLine\":3"), "got {}", json);
        assert!(json.contains("\"savedAt\":42"), "got {}", json);

        let back: Session = serde_json::from_str(&json).unwrap();
        assert_eq!(back.windows.len(), 1);
        assert_eq!(back.windows[0].top_line, 3);
        assert_eq!(back.windows[0].path.as_deref(), Some("/tmp/a.md"));
    }

    #[test]
    fn missing_top_line_defaults_to_one() {
        let json = r#"{"version":1,"savedAt":0,"windows":[
            {"path":"/tmp/a.md","untitled":null,"x":0,"y":0,"width":900,"height":700}
        ]}"#;
        let session: Session = serde_json::from_str(json).unwrap();
        assert_eq!(session.windows[0].top_line, 1);
        assert_eq!(session.windows[0].cursor, 0);
    }

    #[test]
    fn zero_top_line_is_normalized_to_one() {
        let mut s = snap(Some("/tmp/a.md"));
        s.top_line = 0;
        assert_eq!(s.normalized().top_line, 1);
    }

    #[test]
    fn remove_drops_entry_when_not_quitting() {
        let state = SessionState::new();
        state.set_geometry("editor-1", 1, 2, 300, 400);
        assert_eq!(state.snapshot(0).windows.len(), 1);
        state.remove("editor-1");
        assert_eq!(state.snapshot(0).windows.len(), 0);
    }

    #[test]
    fn remove_is_ignored_while_quitting() {
        let state = SessionState::new();
        state.set_geometry("editor-1", 1, 2, 300, 400);
        state.mark_quitting();
        state.remove("editor-1");
        assert_eq!(
            state.snapshot(0).windows.len(),
            1,
            "quitting must freeze the session, otherwise closing every window on \
             exit writes an empty session"
        );
    }

    #[test]
    fn snapshot_orders_main_first_then_numerically() {
        let state = SessionState::new();
        for label in ["editor-10", "editor-2", "main"] {
            state.set_geometry(label, 0, 0, 900, 700);
            state.set_document(label, Some(format!("/tmp/{}.md", label)), 0, 1);
        }
        let paths: Vec<String> = state
            .snapshot(0)
            .windows
            .into_iter()
            .filter_map(|w| w.path)
            .collect();
        assert_eq!(
            paths,
            vec![
                "/tmp/main.md".to_string(),
                "/tmp/editor-2.md".to_string(),
                "/tmp/editor-10.md".to_string()
            ]
        );
    }

    #[test]
    fn set_document_keeps_geometry() {
        let state = SessionState::new();
        state.set_geometry("editor-1", 7, 8, 500, 600);
        state.set_document("editor-1", Some("/tmp/a.md".to_string()), 99, 12);
        let w = &state.snapshot(0).windows[0];
        assert_eq!((w.x, w.y, w.width, w.height), (7, 8, 500, 600));
        assert_eq!((w.cursor, w.top_line), (99, 12));
    }

    #[test]
    fn prune_missing_drops_gone_files_but_keeps_untitled() {
        let mut untitled = snap(None);
        untitled.untitled = Some("untitled-editor-3.md".to_string());
        let session = Session {
            version: SESSION_VERSION,
            saved_at: 0,
            windows: vec![snap(Some("/tmp/gone.md")), snap(Some("/tmp/here.md")), untitled],
        };
        let pruned = prune_missing(session, |p| p == "/tmp/here.md");
        assert_eq!(pruned.windows.len(), 2);
        assert_eq!(pruned.windows[0].path.as_deref(), Some("/tmp/here.md"));
        assert!(pruned.windows[1].untitled.is_some());
    }

    #[test]
    fn take_pending_empties_the_queue() {
        let state = SessionState::new();
        state.set_pending(vec![snap(Some("/tmp/a.md"))]);
        assert_eq!(state.pending_count(), 1);
        assert_eq!(state.take_pending().len(), 1);
        assert_eq!(state.pending_count(), 0);
        assert_eq!(state.take_pending().len(), 0);
    }

    #[test]
    fn untitled_file_name_is_derived_from_label() {
        assert_eq!(untitled_file_name("editor-3"), "untitled-editor-3.md");
        assert_eq!(untitled_file_name("main"), "untitled-main.md");
    }
}
```

- [ ] **Step 2: Register the module and run the tests to see them fail**

In `src-tauri/src/lib.rs`, add `mod session;` after `mod recovery;`:

```rust
mod commands;
mod menu;
mod recovery;
mod session;
mod watcher;
mod window;
```

Run: `cd src-tauri && cargo test session::`
Expected: compile errors — `cannot find type 'WindowSnapshot'`, `cannot find type 'Session'`, `cannot find function 'prune_missing'`, etc.

- [ ] **Step 3: Implement the types and state**

Insert this **above** the `#[cfg(test)] mod tests` block in `src-tauri/src/session.rs`:

```rust
pub const SESSION_VERSION: u32 = 1;

fn default_top_line() -> usize {
    1
}

/// One window as it was when the session was captured.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowSnapshot {
    /// Absolute path of the open file, or `None` for an Untitled window.
    #[serde(default)]
    pub path: Option<String>,
    /// File name inside the `session/` directory holding an unsaved buffer.
    #[serde(default)]
    pub untitled: Option<String>,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub cursor: usize,
    #[serde(default = "default_top_line")]
    pub top_line: usize,
}

impl WindowSnapshot {
    fn empty() -> Self {
        Self {
            path: None,
            untitled: None,
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            cursor: 0,
            top_line: 1,
        }
    }

    /// Line numbers are 1-based; a stored 0 would panic CodeMirror's `doc.line`.
    pub fn normalized(&self) -> Self {
        let mut out = self.clone();
        if out.top_line == 0 {
            out.top_line = 1;
        }
        out
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub version: u32,
    pub saved_at: u64,
    pub windows: Vec<WindowSnapshot>,
}

impl Default for Session {
    fn default() -> Self {
        Self {
            version: SESSION_VERSION,
            saved_at: 0,
            windows: Vec::new(),
        }
    }
}

/// Name of the sidecar file that stores an Untitled window's text.
pub fn untitled_file_name(label: &str) -> String {
    format!("untitled-{}.md", label)
}

/// Drop snapshots whose file no longer exists. Untitled snapshots are always kept
/// — their content lives in our own directory, not at a user path.
pub fn prune_missing(session: Session, exists: impl Fn(&str) -> bool) -> Session {
    // Destructure rather than `..session` — moving `windows` out first would make
    // struct-update syntax a partial-move error.
    let Session {
        version,
        saved_at,
        windows,
    } = session;
    let windows = windows
        .into_iter()
        .filter(|w| match &w.path {
            Some(p) => exists(p),
            None => w.untitled.is_some(),
        })
        .collect();
    Session {
        version,
        saved_at,
        windows,
    }
}

/// Sort key that puts `main` first, then `editor-N` in numeric order. Without
/// this, HashMap iteration order makes both tests and restore order random.
fn label_order(label: &str) -> (u8, u32) {
    if label == "main" {
        return (0, 0);
    }
    let n = label
        .rsplit('-')
        .next()
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(u32::MAX);
    (1, n)
}

/// The live session plus whatever was loaded from disk at startup.
pub struct SessionState {
    entries: Mutex<HashMap<String, WindowSnapshot>>,
    pending: Mutex<Vec<WindowSnapshot>>,
    quitting: AtomicBool,
    dirty: AtomicBool,
}

impl SessionState {
    pub fn new() -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
            pending: Mutex::new(Vec::new()),
            quitting: AtomicBool::new(false),
            dirty: AtomicBool::new(false),
        }
    }

    pub fn mark_quitting(&self) {
        self.quitting.store(true, Ordering::SeqCst);
    }

    pub fn is_quitting(&self) -> bool {
        self.quitting.load(Ordering::SeqCst)
    }

    pub fn take_dirty(&self) -> bool {
        self.dirty.swap(false, Ordering::SeqCst)
    }

    fn touch(&self) {
        self.dirty.store(true, Ordering::SeqCst);
    }

    pub fn set_geometry(&self, label: &str, x: i32, y: i32, width: u32, height: u32) {
        if self.is_quitting() {
            return;
        }
        let mut map = self.entries.lock().unwrap();
        let entry = map
            .entry(label.to_string())
            .or_insert_with(WindowSnapshot::empty);
        entry.x = x;
        entry.y = y;
        entry.width = width;
        entry.height = height;
        drop(map);
        self.touch();
    }

    pub fn set_document(
        &self,
        label: &str,
        path: Option<String>,
        cursor: usize,
        top_line: usize,
    ) {
        if self.is_quitting() {
            return;
        }
        let mut map = self.entries.lock().unwrap();
        let entry = map
            .entry(label.to_string())
            .or_insert_with(WindowSnapshot::empty);
        entry.path = path;
        entry.cursor = cursor;
        entry.top_line = top_line.max(1);
        drop(map);
        self.touch();
    }

    /// Record that this window holds an unsaved buffer stored under `file_name`.
    pub fn set_untitled(&self, label: &str, file_name: Option<String>) {
        if self.is_quitting() {
            return;
        }
        let mut map = self.entries.lock().unwrap();
        let entry = map
            .entry(label.to_string())
            .or_insert_with(WindowSnapshot::empty);
        entry.untitled = file_name;
        drop(map);
        self.touch();
    }

    /// Forget a window. A no-op while quitting — see the module docs on why.
    pub fn remove(&self, label: &str) {
        if self.is_quitting() {
            return;
        }
        let mut map = self.entries.lock().unwrap();
        map.remove(label);
        drop(map);
        self.touch();
    }

    pub fn snapshot(&self, saved_at: u64) -> Session {
        let map = self.entries.lock().unwrap();
        let mut labelled: Vec<(&String, &WindowSnapshot)> = map.iter().collect();
        labelled.sort_by_key(|(label, _)| label_order(label));
        Session {
            version: SESSION_VERSION,
            saved_at,
            windows: labelled.into_iter().map(|(_, w)| w.normalized()).collect(),
        }
    }

    pub fn set_pending(&self, windows: Vec<WindowSnapshot>) {
        *self.pending.lock().unwrap() = windows;
    }

    pub fn pending_count(&self) -> usize {
        self.pending.lock().unwrap().len()
    }

    pub fn take_pending(&self) -> Vec<WindowSnapshot> {
        std::mem::take(&mut *self.pending.lock().unwrap())
    }
}

impl Default for SessionState {
    fn default() -> Self {
        Self::new()
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test session::`
Expected: `test result: ok. 10 passed`

- [ ] **Step 5: Lint**

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml 2>&1 | grep -A 3 "session.rs" | head -20`
Expected: no warnings pointing at `session.rs`.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/session.rs src-tauri/src/lib.rs
git commit -m "feat(session): add session snapshot types and in-memory state"
```

---

## Task 3: Read and write session.json

**Files:**
- Modify: `src-tauri/src/session.rs`

- [ ] **Step 1: Write the failing tests**

Append these tests inside the existing `mod tests` block in
`src-tauri/src/session.rs`:

```rust
    #[test]
    fn parse_session_accepts_current_version() {
        let json = r#"{"version":1,"savedAt":7,"windows":[
            {"path":"/tmp/a.md","untitled":null,"x":1,"y":2,"width":900,"height":700,
             "cursor":4,"topLine":5}
        ]}"#;
        let session = parse_session(json).expect("should parse");
        assert_eq!(session.saved_at, 7);
        assert_eq!(session.windows[0].cursor, 4);
    }

    #[test]
    fn parse_session_rejects_future_version() {
        let json = r#"{"version":99,"savedAt":0,"windows":[]}"#;
        assert!(
            parse_session(json).is_none(),
            "a newer on-disk format must be ignored, not misread"
        );
    }

    #[test]
    fn parse_session_rejects_garbage() {
        assert!(parse_session("not json at all").is_none());
        assert!(parse_session("").is_none());
    }

    #[test]
    fn parse_session_normalizes_entries() {
        let json = r#"{"version":1,"savedAt":0,"windows":[
            {"path":"/tmp/a.md","x":0,"y":0,"width":900,"height":700,"topLine":0}
        ]}"#;
        let session = parse_session(json).unwrap();
        assert_eq!(session.windows[0].top_line, 1);
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src-tauri && cargo test session::parse_session`
Expected: compile error — `cannot find function 'parse_session' in this scope`.

- [ ] **Step 3: Implement parsing and disk IO**

Add these imports at the top of `src-tauri/src/session.rs`, joining the existing
ones:

```rust
use std::fs;
use std::path::PathBuf;
use std::time::SystemTime;
```

Then add, above the test module:

```rust
/// Parse `session.json`. Returns `None` for anything unusable — a corrupt or
/// newer-format file must never take the app down or be half-applied.
pub fn parse_session(data: &str) -> Option<Session> {
    let session: Session = serde_json::from_str(data).ok()?;
    if session.version != SESSION_VERSION {
        return None;
    }
    let Session {
        version,
        saved_at,
        windows,
    } = session;
    Some(Session {
        version,
        saved_at,
        windows: windows.iter().map(|w| w.normalized()).collect(),
    })
}

/// `~/Library/Application Support/md-mini/`
fn app_data_dir() -> Result<PathBuf, String> {
    let base = dirs::data_dir().ok_or("Cannot determine application data directory")?;
    let dir = base.join("md-mini");
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("Failed to create data dir: {}", e))?;
    }
    Ok(dir)
}

fn session_file() -> Result<PathBuf, String> {
    Ok(app_data_dir()?.join("session.json"))
}

/// `~/Library/Application Support/md-mini/session/` — holds Untitled buffers.
pub fn session_dir() -> Result<PathBuf, String> {
    let dir = app_data_dir()?.join("session");
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("Failed to create session dir: {}", e))?;
    }
    Ok(dir)
}

pub fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Atomic write, same tmp+rename shape as `recovery.rs` and `commands::write_file`.
pub fn write_session(session: &Session) -> Result<(), String> {
    let path = session_file()?;
    let tmp = path.with_extension("json.tmp");
    let data = serde_json::to_string_pretty(session)
        .map_err(|e| format!("Failed to serialize session: {}", e))?;
    fs::write(&tmp, &data).map_err(|e| format!("Failed to write session: {}", e))?;
    fs::rename(&tmp, &path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("Failed to save session: {}", e)
    })
}

/// Read the session, dropping windows whose file has since disappeared.
pub fn read_session() -> Option<Session> {
    let path = session_file().ok()?;
    let data = fs::read_to_string(path).ok()?;
    let session = parse_session(&data)?;
    Some(prune_missing(session, |p| std::path::Path::new(p).exists()))
}

pub fn read_untitled(file_name: &str) -> Option<String> {
    let dir = session_dir().ok()?;
    fs::read_to_string(dir.join(file_name)).ok()
}

pub fn write_untitled(file_name: &str, content: &str) -> Result<(), String> {
    let dir = session_dir()?;
    let path = dir.join(file_name);
    let tmp = dir.join(format!("{}.tmp", file_name));
    fs::write(&tmp, content).map_err(|e| format!("Failed to write untitled buffer: {}", e))?;
    fs::rename(&tmp, &path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("Failed to save untitled buffer: {}", e)
    })
}

/// Delete Untitled sidecars no session entry refers to any more.
pub fn prune_untitled_files(session: &Session) {
    let Ok(dir) = session_dir() else { return };
    let referenced: Vec<&str> = session
        .windows
        .iter()
        .filter_map(|w| w.untitled.as_deref())
        .collect();
    let Ok(entries) = fs::read_dir(&dir) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if !name.starts_with("untitled-") || !name.ends_with(".md") {
            continue;
        }
        if !referenced.contains(&name) {
            let _ = fs::remove_file(entry.path());
        }
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test session::`
Expected: `test result: ok. 14 passed`

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/session.rs
git commit -m "feat(session): persist session.json with atomic writes"
```

---

## Task 4: Wire SessionState into the app lifecycle

This is the task the whole feature hinges on. Read the two barriers in the spec
("The Trap") before writing it.

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Register the state and load the previous session**

In `src-tauri/src/lib.rs`, add to the imports at the top:

```rust
use session::SessionState;
```

Change the `.manage(...)` chain (currently at lines ~41-43) to include the new
state:

```rust
    let builder = builder
        .manage(OpenFiles::new())
        .manage(PendingFiles::new())
        .manage(FileWatchers::new())
        .manage(SessionState::new())
```

- [ ] **Step 2: Load the file into `pending_restore` at the start of `setup`**

In the `.setup(|app| { ... })` closure, insert this as the **first** statement,
before `menu::build_menu`:

```rust
            // Load the previous session before the menu is built — the menu item's
            // enabled state depends on whether there is anything to restore.
            let pending_count = {
                let state = app.state::<SessionState>();
                match session::read_session() {
                    Some(loaded) => {
                        let count = loaded.windows.len();
                        state.set_pending(loaded.windows);
                        count
                    }
                    None => 0,
                }
            };
```

- [ ] **Step 3: Start the ticker thread at the end of `setup`**

Still inside `.setup(...)`, immediately before the final `Ok(())`:

```rust
            // Crash-safety net. The authoritative save happens in ExitRequested;
            // this only catches a hard kill between changes.
            let ticker_handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_millis(1000));
                let state = ticker_handle.state::<SessionState>();
                if state.is_quitting() {
                    return;
                }
                if state.take_dirty() {
                    let snapshot = state.snapshot(session::now_secs());
                    let _ = session::write_session(&snapshot);
                    session::prune_untitled_files(&snapshot);
                }
            });
```

- [ ] **Step 4: Freeze and save on exit**

In the `app.run(|_app_handle, event| { ... })` match block, add a new arm
alongside `RunEvent::Opened` and `RunEvent::Reopen`:

```rust
            tauri::RunEvent::ExitRequested { .. } => {
                // Fires while the windows still exist. Freeze first so the
                // Destroyed events that follow cannot empty the session, then
                // write what was actually open.
                let state = _app_handle.state::<SessionState>();
                let snapshot = state.snapshot(session::now_secs());
                state.mark_quitting();
                let _ = session::write_session(&snapshot);
            }
```

- [ ] **Step 5: Forget windows the user closes deliberately**

In the `.on_window_event(|window, event| { ... })` block, extend the `Destroyed`
arm (currently lines ~106-110):

```rust
                tauri::WindowEvent::Destroyed => {
                    let app = window.app_handle();
                    let label = window.label();
                    // No-op while quitting, so an exit keeps every window.
                    app.state::<SessionState>().remove(label);
                    window::untrack_window(app, label);
                }
```

- [ ] **Step 6: Build and check it compiles**

Run: `cd src-tauri && cargo build 2>&1 | tail -5`
Expected: `Finished` with no errors. `pending_count` is unused for now — if
clippy complains, leave it; Task 9 consumes it.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(session): load, tick and freeze the session across app lifecycle"
```

---

## Task 5: Track window geometry

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Record moves and resizes**

In `.on_window_event(...)`, add two arms before the `_ => {}` catch-all:

```rust
                tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
                    let app = window.app_handle();
                    let label = window.label().to_string();
                    if let (Ok(pos), Ok(size)) = (window.outer_position(), window.inner_size()) {
                        app.state::<SessionState>().set_geometry(
                            &label,
                            pos.x,
                            pos.y,
                            size.width,
                            size.height,
                        );
                    }
                }
```

Note: `outer_position` is paired with `inner_size` on purpose — that is the pair
`WebviewWindowBuilder::position` / `inner_size` consumes when the window is
rebuilt, so a restored window lands where it was.

- [ ] **Step 2: Build**

Run: `cd src-tauri && cargo build 2>&1 | tail -3`
Expected: `Finished`

- [ ] **Step 3: Verify geometry actually reaches the session file**

```bash
pkill -f "debug/md-mini" 2>/dev/null
rm -f ~/Library/Application\ Support/md-mini/session.json
npm run dev:app > /tmp/session-dev.log 2>&1 &
```

Wait for `MCP Bridge plugin initialized` in `/tmp/session-dev.log`, drag the
window, wait 2 seconds, then:

Run: `cat ~/Library/Application\ Support/md-mini/session.json`
Expected: JSON with one window whose `x`/`y` match where you dragged it, `width`
and `height` around 900×700.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(session): record window geometry from move and resize events"
```

---

## Task 6: Carry restore data to the frontend via PendingFiles

`PendingFiles` maps a window label to a path string. It needs to carry cursor,
scroll line and Untitled content as well.

**Files:**
- Modify: `src-tauri/src/window.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs` (the `RunEvent::Opened` handler)
- Modify: `src/lib/tauri/commands.ts`
- Modify: `src/App.svelte`

- [ ] **Step 1: Define the payload struct**

In `src-tauri/src/window.rs`, replace the `PendingFiles` declaration and its
`impl` (currently lines ~18-20 and ~30-34) with:

```rust
/// What a freshly created window should load once its frontend mounts.
#[derive(Clone, Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingOpen {
    pub path: Option<String>,
    /// Text for an Untitled window being restored.
    pub content: Option<String>,
    pub cursor: usize,
    pub top_line: usize,
}

impl PendingOpen {
    pub fn from_path(path: String) -> Self {
        Self {
            path: Some(path),
            content: None,
            cursor: 0,
            top_line: 1,
        }
    }
}

/// Stores a pending payload per window label, pulled by the frontend on mount.
pub struct PendingFiles(pub Mutex<HashMap<String, PendingOpen>>);

impl PendingFiles {
    pub fn new() -> Self {
        Self(Mutex::new(HashMap::new()))
    }
}
```

- [ ] **Step 2: Update the one insertion site inside `open_file_window`**

In `src-tauri/src/window.rs`, inside `open_file_window`, replace:

```rust
                let pending = app.state::<PendingFiles>();
                let mut pending_map = pending.0.lock().unwrap();
                pending_map.insert(label.clone(), file_path.clone());
```

with:

```rust
                let pending = app.state::<PendingFiles>();
                let mut pending_map = pending.0.lock().unwrap();
                pending_map.insert(label.clone(), PendingOpen::from_path(file_path.clone()));
```

- [ ] **Step 3: Update the command's return type**

In `src-tauri/src/commands.rs`, change `get_pending_file`:

```rust
/// Returns and removes the pending payload for the calling window, if any.
/// Called by the frontend in onMount to pick up files passed via CLI args,
/// a new-window open, or a session restore.
#[command]
pub async fn get_pending_file(
    window: tauri::Window,
    state: tauri::State<'_, crate::window::PendingFiles>,
) -> Result<Option<crate::window::PendingOpen>, String> {
    let mut map = state.0.lock().map_err(|e| e.to_string())?;
    Ok(map.remove(window.label()))
}
```

- [ ] **Step 4: Update the `RunEvent::Opened` insertion site**

In `src-tauri/src/lib.rs`, in the `RunEvent::Opened` arm, replace:

```rust
                                let mut pmap = pending.0.lock().unwrap();
                                pmap.insert("main".to_string(), file_path.clone());
```

with:

```rust
                                let mut pmap = pending.0.lock().unwrap();
                                pmap.insert(
                                    "main".to_string(),
                                    window::PendingOpen::from_path(file_path.clone()),
                                );
```

- [ ] **Step 5: Build the Rust side**

Run: `cd src-tauri && cargo build 2>&1 | tail -5`
Expected: `Finished`

- [ ] **Step 6: Mirror the type on the frontend**

In `src/lib/tauri/commands.ts`, add at the end of the file:

```typescript
/** Matches `PendingOpen` in src-tauri/src/window.rs. */
export interface PendingOpen {
  path: string | null;
  content: string | null;
  cursor: number;
  topLine: number;
}
```

- [ ] **Step 7: Adapt the single consumer**

In `src/App.svelte`, add `PendingOpen` to the existing import from
`./lib/tauri/commands`:

```typescript
  import { readFile, writeFile, fileExists, showOpenDialog, showSaveDialog, type PendingOpen } from './lib/tauri/commands';
```

Then replace the `get_pending_file` block at the top of `onMount` (currently
lines ~221-225) with:

```typescript
    invoke<PendingOpen | null>('get_pending_file').then((pending) => {
      if (!pending) return;
      if (pending.path) {
        handleOpenFilePath(pending.path);
      } else if (pending.content !== null) {
        // Restored Untitled window — no file on disk, just the buffer.
        editorHandle?.replaceContent(pending.content);
        fileState.isDirty = true;
      }
    });
```

- [ ] **Step 8: Typecheck**

Run: `npm run check 2>&1 | tail -3`
Expected: `0 ERRORS`

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/window.rs src-tauri/src/commands.rs src-tauri/src/lib.rs src/lib/tauri/commands.ts src/App.svelte
git commit -m "refactor(window): carry cursor, scroll and content through PendingFiles"
```

---

## Task 7: Report cursor, scroll and Untitled content from the frontend

**Files:**
- Create: `src/lib/session-position.ts`
- Create: `src/lib/session-position.test.ts`
- Modify: `src-tauri/src/session.rs` (add the IPC command)
- Modify: `src-tauri/src/lib.rs` (register it)
- Modify: `src/App.svelte`

- [ ] **Step 1: Write the failing test for the pure helpers**

Create `src/lib/session-position.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { clampCursor, clampTopLine } from './session-position';

describe('clampCursor', () => {
  it('InsideDocument_Unchanged', () => {
    expect(clampCursor(50, 100)).toBe(50);
  });

  it('PastEnd_ClampedToLength', () => {
    // the file shrank on disk while the app was closed
    expect(clampCursor(5000, 100)).toBe(100);
  });

  it('Negative_ClampedToZero', () => {
    expect(clampCursor(-10, 100)).toBe(0);
  });

  it('EmptyDocument_Zero', () => {
    expect(clampCursor(42, 0)).toBe(0);
  });
});

describe('clampTopLine', () => {
  it('InsideDocument_Unchanged', () => {
    expect(clampTopLine(12, 100)).toBe(12);
  });

  it('PastLastLine_ClampedToLastLine', () => {
    expect(clampTopLine(900, 100)).toBe(100);
  });

  it('ZeroOrNegative_ClampedToOne', () => {
    // CodeMirror doc.line() is 1-based and throws on 0
    expect(clampTopLine(0, 100)).toBe(1);
    expect(clampTopLine(-5, 100)).toBe(1);
  });

  it('SingleLineDocument_AlwaysOne', () => {
    expect(clampTopLine(7, 1)).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/session-position.test.ts`
Expected: FAIL — `Failed to resolve import "./session-position"`

- [ ] **Step 3: Implement the helpers**

Create `src/lib/session-position.ts`:

```typescript
/**
 * Clamps for a restored caret and scroll line.
 *
 * A session can outlive the file it points at: the document may have been edited
 * or truncated on disk while md-mini was closed, so stored offsets are only
 * hints. CodeMirror's `doc.line()` is 1-based and throws on 0.
 */

export function clampCursor(cursor: number, docLength: number): number {
  if (!Number.isFinite(cursor) || cursor < 0) return 0;
  return Math.min(cursor, docLength);
}

export function clampTopLine(topLine: number, docLines: number): number {
  if (!Number.isFinite(topLine) || topLine < 1) return 1;
  return Math.min(topLine, Math.max(1, docLines));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/session-position.test.ts`
Expected: `8 passed`

- [ ] **Step 5: Add the IPC command on the Rust side**

Append to `src-tauri/src/session.rs`, above the test module:

```rust
/// Frontend heartbeat: where the caret and viewport are, and the text of an
/// Untitled buffer. Called on the existing 5s recovery cadence.
#[tauri::command]
pub async fn update_session_document(
    window: tauri::Window,
    state: tauri::State<'_, SessionState>,
    path: Option<String>,
    cursor: usize,
    top_line: usize,
    content: Option<String>,
) -> Result<(), String> {
    let label = window.label().to_string();
    state.set_document(&label, path.clone(), cursor, top_line);

    match (path, content) {
        // Untitled window with text — mirror it to a sidecar file.
        (None, Some(text)) => {
            let file_name = untitled_file_name(&label);
            write_untitled(&file_name, &text)?;
            state.set_untitled(&label, Some(file_name));
        }
        // Saved file, or an empty Untitled window — no sidecar needed.
        _ => state.set_untitled(&label, None),
    }
    Ok(())
}
```

- [ ] **Step 6: Register the command**

In `src-tauri/src/lib.rs`, add to the `invoke_handler` list after
`recovery::check_recovery,`:

```rust
            session::update_session_document,
```

- [ ] **Step 7: Report from the frontend**

In `src/App.svelte`, add this function next to `startRecoveryInterval` (around
line 199):

```typescript
  // --- Session heartbeat (rides the recovery interval) ---
  function topVisibleLine(): number {
    const view = editorHandle?.view;
    if (!view) return 1;
    // posAtCoords against the top edge of the scroller is stable across font
    // size and zoom changes, unlike a raw pixel offset.
    const rect = view.scrollDOM.getBoundingClientRect();
    const pos = view.posAtCoords({ x: rect.left + 1, y: rect.top + 1 });
    if (pos === null) return 1;
    return view.state.doc.lineAt(pos).number;
  }

  function reportSession(): void {
    const view = editorHandle?.view;
    if (!view) return;
    invoke('update_session_document', {
      path: fileState.filePath,
      cursor: view.state.selection.main.head,
      topLine: topVisibleLine(),
      content: fileState.filePath ? null : view.state.doc.toString(),
    }).catch(() => {
      // Session tracking is best-effort; never surface it to the user.
    });
  }
```

Then extend the recovery interval body so both run on the same tick:

```typescript
  function startRecoveryInterval(): void {
    recoveryInterval = setInterval(() => {
      if (fileState.isDirty && fileState.filePath) {
        const content = editorHandle?.view?.state.doc.toString() ?? '';
        invoke('save_recovery', { path: fileState.filePath, content }).catch((err: unknown) => {
          console.error('Recovery save failed:', err);
        });
      }
      reportSession();
    }, 5000);
  }
```

Also call `reportSession()` once at the end of `onMount`, so a window that is
never edited still lands in the session — insert immediately before the
`return () => {` cleanup block:

```typescript
    // Register this window in the session right away, not 5s later.
    reportSession();
```

- [ ] **Step 8: Typecheck and test**

Run: `npm run check 2>&1 | tail -3 && npx vitest run src/lib/session-position.test.ts`
Expected: `0 ERRORS`, then `8 passed`

- [ ] **Step 9: Verify the heartbeat reaches disk**

```bash
pkill -f "debug/md-mini" 2>/dev/null
rm -f ~/Library/Application\ Support/md-mini/session.json
npm run dev:app -- -- -- "$(pwd)/test-fixtures/mermaid-pan-zoom.md" > /tmp/session-dev.log 2>&1 &
```

Wait for the window, click somewhere in the middle of the document, wait 7
seconds, then:

Run: `cat ~/Library/Application\ Support/md-mini/session.json`
Expected: one window with `"path"` ending in `mermaid-pan-zoom.md`, a non-zero
`cursor`, and a `topLine` greater than 1 if you scrolled.

- [ ] **Step 10: Commit**

```bash
git add src/lib/session-position.ts src/lib/session-position.test.ts src-tauri/src/session.rs src-tauri/src/lib.rs src/App.svelte
git commit -m "feat(session): report caret, scroll line and untitled buffers"
```

---

## Task 8: Restore windows

**Files:**
- Modify: `src-tauri/src/window.rs`
- Modify: `src-tauri/src/session.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add a restore-aware window builder**

Append to `src-tauri/src/window.rs`:

```rust
/// Recreate a window from a session snapshot: saved geometry, and a payload the
/// frontend picks up on mount.
///
/// Files already open are focused rather than duplicated, reusing the dedup in
/// `open_file_window`.
pub fn open_restored_window(app: &AppHandle, snapshot: &crate::session::WindowSnapshot) {
    if let Some(path) = &snapshot.path {
        let already_open = {
            let open_files = app.state::<OpenFiles>();
            let map = open_files.0.lock().unwrap();
            map.get(path).and_then(|label| app.get_webview_window(label))
        };
        if let Some(window) = already_open {
            let _ = window.set_focus();
            return;
        }
    }

    let content = snapshot
        .untitled
        .as_deref()
        .and_then(crate::session::read_untitled);

    // An Untitled snapshot whose sidecar has gone is not worth an empty window.
    if snapshot.path.is_none() && content.is_none() {
        return;
    }

    let count = WINDOW_COUNTER.fetch_add(1, Ordering::SeqCst);
    let label = format!("editor-{}", count);

    let product_name = app
        .config()
        .product_name
        .clone()
        .unwrap_or_else(|| "md-mini".to_string());
    let window_title = format!("Untitled — {}", product_name);

    let width = if snapshot.width >= 400 {
        snapshot.width as f64
    } else {
        DEFAULT_WIDTH
    };
    let height = if snapshot.height >= 300 {
        snapshot.height as f64
    } else {
        DEFAULT_HEIGHT
    };

    let builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title(&window_title)
        .inner_size(width, height)
        .min_inner_size(400.0, 300.0)
        .position(snapshot.x as f64, snapshot.y as f64)
        .background_color(tauri::utils::config::Color(25, 23, 36, 255));

    match builder.build() {
        Ok(window) => {
            let _ = window.set_focus();
            #[cfg(target_os = "macos")]
            unsafe {
                use cocoa::appkit::{NSApplication, NSApplicationActivationPolicy};
                let ns_app = cocoa::appkit::NSApp();
                ns_app.activateIgnoringOtherApps_(true);
            }

            let pending = app.state::<PendingFiles>();
            let mut pending_map = pending.0.lock().unwrap();
            pending_map.insert(
                label.clone(),
                PendingOpen {
                    path: snapshot.path.clone(),
                    content,
                    cursor: snapshot.cursor,
                    top_line: snapshot.top_line.max(1),
                },
            );
            drop(pending_map);

            if let Some(path) = &snapshot.path {
                let open_files = app.state::<OpenFiles>();
                let mut map = open_files.0.lock().unwrap();
                map.insert(path.clone(), label.clone());
                drop(map);

                if let Ok(watcher) =
                    crate::watcher::watch_file(app, label.clone(), path.clone())
                {
                    let watchers = app.state::<FileWatchers>();
                    let mut wmap = watchers.0.lock().unwrap();
                    wmap.insert(label.clone(), watcher);
                }
            }
        }
        Err(e) => {
            eprintln!("Failed to restore window: {}", e);
        }
    }
}
```

Note the unused-import risk: `PendingOpen` is already declared in this file, so
no new `use` is needed.

- [ ] **Step 2: Add the restore entry point and the count command**

Append to `src-tauri/src/session.rs`, above the test module:

```rust
/// Reopen every window from the previous session. Returns how many were opened.
/// The pending list is consumed, so a second call is a no-op.
pub fn restore_pending(app: &tauri::AppHandle) -> usize {
    use tauri::{Emitter, Manager};

    let snapshots = app.state::<SessionState>().take_pending();
    let count = snapshots.len();
    for snapshot in &snapshots {
        crate::window::open_restored_window(app, snapshot);
    }
    if count > 0 {
        // Let open windows drop the "restore available" toast.
        let _ = app.emit("session-restored", count);
    }
    count
}

/// How many windows the previous session had. Drives the toast.
#[tauri::command]
pub async fn pending_session_count(
    state: tauri::State<'_, SessionState>,
) -> Result<usize, String> {
    Ok(state.pending_count())
}

#[tauri::command]
pub async fn restore_session(app: tauri::AppHandle) -> Result<usize, String> {
    Ok(restore_pending(&app))
}
```

- [ ] **Step 3: Register both commands**

In `src-tauri/src/lib.rs`, add to `invoke_handler` after
`session::update_session_document,`:

```rust
            session::pending_session_count,
            session::restore_session,
```

- [ ] **Step 4: Build**

Run: `cd src-tauri && cargo build 2>&1 | tail -5`
Expected: `Finished`

- [ ] **Step 5: Run all Rust tests**

Run: `cd src-tauri && cargo test 2>&1 | tail -5`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/window.rs src-tauri/src/session.rs src-tauri/src/lib.rs
git commit -m "feat(session): restore windows with saved geometry and payload"
```

---

## Task 9: Menu item and keyboard shortcut

**Files:**
- Modify: `src-tauri/src/menu.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Take the pending count as a parameter**

In `src-tauri/src/menu.rs`, change the signature:

```rust
pub fn build_menu(
    app: &AppHandle,
    pending_session_count: usize,
) -> tauri::Result<(tauri::menu::Menu<Wry>, ThemeMenuItems)> {
```

- [ ] **Step 2: Add the item to the File submenu**

In the same function, replace the `recent_files` item block and the `.build()?`
that follows it with:

```rust
        .item(
            &MenuItemBuilder::with_id("recent_files", "Recent Files...")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id(
                "reopen_session",
                if pending_session_count == 1 {
                    "Reopen 1 Window from Last Session".to_string()
                } else {
                    format!("Reopen {} Windows from Last Session", pending_session_count)
                },
            )
            .accelerator("CmdOrCtrl+Shift+T")
            .enabled(pending_session_count > 0)
            .build(app)?,
        )
        .build()?;
```

- [ ] **Step 3: Pass the count and handle the event**

In `src-tauri/src/lib.rs`, update the `build_menu` call inside `.setup(...)` —
it must come *after* the `pending_count` block added in Task 4:

```rust
            let (menu, theme_items) = menu::build_menu(app.handle(), pending_count)?;
```

Then, in the `app.on_menu_event(...)` closure, add this handler next to the
existing `new` handler:

```rust
                // Restore windows in Rust, like "new" — it creates windows.
                if id == "reopen_session" {
                    session::restore_pending(&app_handle);
                    return;
                }
```

- [ ] **Step 4: Build**

Run: `cd src-tauri && cargo build 2>&1 | tail -3`
Expected: `Finished`

- [ ] **Step 5: Verify end-to-end restore without any UI**

```bash
pkill -f "debug/md-mini" 2>/dev/null
rm -f ~/Library/Application\ Support/md-mini/session.json
npm run dev:app > /tmp/session-dev.log 2>&1 &
```

Wait for the window. Then open two more windows with `Cmd+N`, move them apart,
wait 7 seconds, and quit the app the way Homebrew does:

```bash
osascript -e 'quit app "md-mini-dev"'
sleep 2
cat ~/Library/Application\ Support/md-mini/session.json
```

Expected: three windows in the JSON. Then relaunch:

```bash
npm run dev:app > /tmp/session-dev2.log 2>&1 &
```

In the new window press `Cmd+Shift+T`.
Expected: three windows reappear at their saved positions and sizes. Check that
`File → Reopen 3 Windows from Last Session` was enabled before you pressed it,
and that pressing it a second time does nothing.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/menu.rs src-tauri/src/lib.rs
git commit -m "feat(session): add Reopen Last Session menu item with Cmd+Shift+T"
```

---

## Task 10: Toast store

Note the filename: **`toasts.svelte.ts`**, not `toasts.ts`. Runes in a plain
`.ts` file silently produce a white screen and `npm run check` will not tell you.

**Files:**
- Create: `src/lib/toasts.svelte.ts`
- Create: `src/lib/toasts.svelte.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/toasts.svelte.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createToastStore } from './toasts.svelte';

describe('createToastStore', () => {
  it('StartsEmpty', () => {
    expect(createToastStore().toasts).toEqual([]);
  });

  it('Push_AddsToast', () => {
    const store = createToastStore();
    store.push({ kind: 'session', count: 3 });
    expect(store.toasts).toHaveLength(1);
    expect(store.toasts[0].payload).toEqual({ kind: 'session', count: 3 });
  });

  it('Push_ReturnsUniqueIds', () => {
    const store = createToastStore();
    const a = store.push({ kind: 'session', count: 1 });
    const b = store.push({ kind: 'update', latest: 'v1.0.0', current: '0.9.0' });
    expect(a).not.toBe(b);
  });

  it('Dismiss_RemovesById', () => {
    const store = createToastStore();
    const id = store.push({ kind: 'session', count: 2 });
    store.push({ kind: 'update', latest: 'v1.0.0', current: '0.9.0' });
    store.dismiss(id);
    expect(store.toasts).toHaveLength(1);
    expect(store.toasts[0].payload.kind).toBe('update');
  });

  it('Dismiss_UnknownId_NoOp', () => {
    const store = createToastStore();
    store.push({ kind: 'session', count: 2 });
    store.dismiss(9999);
    expect(store.toasts).toHaveLength(1);
  });

  it('DismissKind_RemovesEveryToastOfThatKind', () => {
    const store = createToastStore();
    store.push({ kind: 'session', count: 2 });
    store.push({ kind: 'update', latest: 'v1.0.0', current: '0.9.0' });
    store.dismissKind('session');
    expect(store.toasts).toHaveLength(1);
    expect(store.toasts[0].payload.kind).toBe('update');
  });

  it('UpdateSortsAboveSession_RegardlessOfPushOrder', () => {
    // The update check fires 15s after launch, so insertion order would put it
    // below the session toast. Order must be explicit.
    const store = createToastStore();
    store.push({ kind: 'session', count: 4 });
    store.push({ kind: 'update', latest: 'v1.0.0', current: '0.9.0' });
    expect(store.toasts.map((t) => t.payload.kind)).toEqual(['update', 'session']);
  });

  it('OnlyOneToastPerKind', () => {
    // The update checker runs hourly and must not stack duplicates.
    const store = createToastStore();
    store.push({ kind: 'update', latest: 'v1.0.0', current: '0.9.0' });
    store.push({ kind: 'update', latest: 'v1.1.0', current: '0.9.0' });
    expect(store.toasts).toHaveLength(1);
    const payload = store.toasts[0].payload;
    expect(payload.kind === 'update' && payload.latest).toBe('v1.1.0');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/toasts.svelte.test.ts`
Expected: FAIL — `Failed to resolve import "./toasts.svelte"`

- [ ] **Step 3: Implement the store**

Create `src/lib/toasts.svelte.ts`:

```typescript
/**
 * Stack of persistent notifications shown at the bottom-right of a window.
 *
 * Nothing auto-dismisses; every toast waits for its close button. Ordering is
 * explicit rather than insertion-based, because the update check only fires 15s
 * after launch and would otherwise land below the session toast.
 */

export type ToastPayload =
  | { kind: 'update'; latest: string; current: string }
  | { kind: 'session'; count: number };

export type ToastKind = ToastPayload['kind'];

export interface ToastEntry {
  id: number;
  payload: ToastPayload;
}

/** Lower sorts higher in the stack. */
const ORDER: Record<ToastKind, number> = {
  update: 0,
  session: 1,
};

export function createToastStore() {
  let entries = $state<ToastEntry[]>([]);
  let nextId = 1;

  function sorted(list: ToastEntry[]): ToastEntry[] {
    return [...list].sort((a, b) => ORDER[a.payload.kind] - ORDER[b.payload.kind]);
  }

  return {
    get toasts(): ToastEntry[] {
      return entries;
    },

    /** Replaces any existing toast of the same kind. Returns the new id. */
    push(payload: ToastPayload): number {
      const id = nextId++;
      entries = sorted([
        ...entries.filter((e) => e.payload.kind !== payload.kind),
        { id, payload },
      ]);
      return id;
    },

    dismiss(id: number): void {
      entries = entries.filter((e) => e.id !== id);
    },

    dismissKind(kind: ToastKind): void {
      entries = entries.filter((e) => e.payload.kind !== kind);
    },
  };
}

export type ToastStore = ReturnType<typeof createToastStore>;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/toasts.svelte.test.ts`
Expected: `8 passed`

- [ ] **Step 5: Commit**

```bash
git add src/lib/toasts.svelte.ts src/lib/toasts.svelte.test.ts
git commit -m "feat(toasts): add toast store with explicit stack ordering"
```

---

## Task 11: Toast components and shared CSS

**Files:**
- Create: `src/lib/ToastStack.svelte`
- Modify: `src/styles/global.css` (~lines 123-160)

- [ ] **Step 1: Read the styles you are replacing**

Run: `sed -n '120,175p' src/styles/global.css`

You should see `.md-update-banner`, `@keyframes md-update-slide-in`,
`.md-update-content`, `.md-update-text` and whatever follows. Note every class
name you find — they are all replaced in Step 3.

**Do not copy `var(--color-text)` or `var(--color-bg)` forward.** Neither is
defined anywhere in the project — the existing banner has been relying on
inherited colour and a transparent command background. Confirm for yourself:

Run: `grep -rn -- "--color-text:" src/ ; grep -rn -- "--color-bg:" src/`
Expected: no output at all.

The real variables (see `src/lib/theme/dark.css`) are `--text-primary`,
`--text-muted`, `--bg-base`, `--bg-surface`, `--color-code-bg` and
`--color-table-border`. The CSS in Step 3 already uses the correct ones.

- [ ] **Step 2: Create the component**

Create `src/lib/ToastStack.svelte`:

```svelte
<script lang="ts">
  import type { ToastStore } from './toasts.svelte';

  let { store }: { store: ToastStore } = $props();

  const BREW_CMD = 'brew update && brew upgrade --cask mdmini';

  let copied = $state(false);

  function copyBrewCommand(): void {
    navigator.clipboard.writeText(BREW_CMD);
    copied = true;
    setTimeout(() => { copied = false; }, 1500);
  }
</script>

{#if store.toasts.length > 0}
  <div class="md-toast-stack">
    {#each store.toasts as toast (toast.id)}
      <div class="md-toast">
        {#if toast.payload.kind === 'update'}
          <span class="md-toast-text">
            <strong>mdmini {toast.payload.latest}</strong> available
            <span class="md-toast-dim">(you have v{toast.payload.current})</span>
          </span>
          <button class="md-toast-cmd" title="Click to copy" onclick={copyBrewCommand}>
            {copied ? 'Copied!' : BREW_CMD}
          </button>
        {:else}
          <span class="md-toast-text">
            <strong>{toast.payload.count}</strong>
            {toast.payload.count === 1 ? 'window' : 'windows'} from your last session
          </span>
          <span class="md-toast-dim">Press <kbd>⇧⌘T</kbd> to reopen</span>
        {/if}
        <button
          class="md-toast-close"
          title="Dismiss"
          onclick={() => store.dismiss(toast.id)}
        >✕</button>
      </div>
    {/each}
  </div>
{/if}
```

- [ ] **Step 3: Replace the banner CSS with the stack CSS**

In `src/styles/global.css`, replace the whole block from `.md-update-banner {`
through the last `.md-update-*` rule with:

```css
/* Toast stack — bottom-right, newest kinds ordered by the store.
   `gap` is what keeps the cards visually separate instead of a joined slab. */
.md-toast-stack {
  position: fixed;
  bottom: 16px;
  right: 16px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}

.md-toast {
  display: flex;
  flex-direction: column;
  gap: 8px;
  position: relative;
  background: var(--color-code-bg);
  border: 1px solid var(--color-table-border);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  padding: 12px 16px;
  padding-right: 34px;
  font-family: var(--font-code);
  font-size: 13px;
  color: var(--text-primary);
  max-width: 400px;
  animation: md-toast-slide-in 0.3s ease-out;
}

@keyframes md-toast-slide-in {
  from { transform: translateY(20px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

.md-toast-text {
  line-height: 1.4;
}

.md-toast-dim {
  opacity: 0.6;
  font-size: 12px;
}

.md-toast kbd {
  font-family: var(--font-code);
  font-size: 11px;
  border: 1px solid var(--color-table-border);
  border-radius: 4px;
  padding: 1px 5px;
}

.md-toast-cmd {
  font-family: var(--font-code);
  font-size: 12px;
  text-align: left;
  background: var(--bg-base);
  border: 1px solid var(--color-table-border);
  border-radius: 4px;
  padding: 6px 8px;
  color: var(--text-primary);
  cursor: pointer;
}

.md-toast-cmd:hover {
  opacity: 0.8;
}

.md-toast-close {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  border-radius: 4px;
  color: var(--text-primary);
  opacity: 0.5;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  padding: 0;
}

.md-toast-close:hover {
  opacity: 1;
  background: var(--color-code-bg);
}
```

- [ ] **Step 4: Confirm no stale references remain**

Run: `grep -rn "md-update" src/ || echo "no md-update references left"`

Expected: matches only inside `src/lib/updater.ts` (cleaned up in Task 12). If
`global.css` still matches, you missed a rule in Step 3.

- [ ] **Step 5: Typecheck**

Run: `npm run check 2>&1 | tail -3`
Expected: `0 ERRORS`

- [ ] **Step 6: Commit**

```bash
git add src/lib/ToastStack.svelte src/styles/global.css
git commit -m "feat(toasts): add ToastStack component and generalize banner CSS"
```

---

## Task 12: Port the update checker onto the store

**Files:**
- Modify: `src/lib/updater.ts`

- [ ] **Step 1: Replace DOM building with a callback**

Rewrite `src/lib/updater.ts` in full:

```typescript
/**
 * Update checker — compares the running version with the latest GitHub release.
 * Checks 15s after launch and then hourly.
 *
 * Rendering is the caller's problem: it hands in a callback and decides what the
 * notification looks like. This keeps the toast store owned by the component
 * tree instead of becoming a module singleton.
 */

const GITHUB_REPO = 'malinborn/mdmini';
const CHECK_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const CHECK_INTERVAL = 60 * 60 * 1000; // 1 hour
const FIRST_CHECK_DELAY = 15_000;

export type UpdateHandler = (latest: string, current: string) => void;

async function getCurrentVersion(): Promise<string> {
  const { getVersion } = await import('@tauri-apps/api/app');
  return getVersion();
}

export function isNewer(latest: string, current: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
  const [la, lb, lc] = parse(latest);
  const [ca, cb, cc] = parse(current);
  if (la !== ca) return la > ca;
  if (lb !== cb) return lb > cb;
  return lc > cc;
}

export async function checkForUpdates(onUpdate: UpdateHandler): Promise<void> {
  try {
    const current = await getCurrentVersion();

    const res = await fetch(CHECK_URL, {
      headers: { Accept: 'application/vnd.github.v3+json' },
    });
    if (!res.ok) return;

    const data = await res.json();
    const latest = data.tag_name as string;

    if (!latest || !isNewer(latest, current)) return;

    onUpdate(latest, current);
  } catch {
    // Network error, repo not found — silently ignore
  }
}

/** Start periodic update checks. Returns a stop function. */
export function startUpdateChecker(onUpdate: UpdateHandler): () => void {
  const initialTimer = setTimeout(() => checkForUpdates(onUpdate), FIRST_CHECK_DELAY);
  const intervalTimer = setInterval(() => checkForUpdates(onUpdate), CHECK_INTERVAL);

  return () => {
    clearTimeout(initialTimer);
    clearInterval(intervalTimer);
  };
}
```

- [ ] **Step 2: Add a regression test for the version comparison**

Create `src/lib/updater.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { isNewer } from './updater';

describe('isNewer', () => {
  it('HigherPatch_True', () => {
    expect(isNewer('v0.4.1', '0.4.0')).toBe(true);
  });

  it('HigherMinor_True', () => {
    expect(isNewer('v0.5.0', '0.4.9')).toBe(true);
  });

  it('HigherMajor_True', () => {
    expect(isNewer('v1.0.0', '0.9.9')).toBe(true);
  });

  it('SameVersion_False', () => {
    expect(isNewer('v0.4.0', '0.4.0')).toBe(false);
  });

  it('OlderVersion_False', () => {
    expect(isNewer('v0.3.9', '0.4.0')).toBe(false);
  });

  it('TagPrefixOptional', () => {
    expect(isNewer('0.4.1', '0.4.0')).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test**

Run: `npx vitest run src/lib/updater.test.ts`
Expected: `6 passed`

- [ ] **Step 4: Commit**

```bash
git add src/lib/updater.ts src/lib/updater.test.ts
git commit -m "refactor(updater): report updates through a callback instead of DOM"
```

---

## Task 13: Wire the toasts into App.svelte

**Files:**
- Modify: `src/App.svelte`
- Modify: `src/lib/tauri/events.ts`

- [ ] **Step 1: Add a listener for the restore event**

Append to `src/lib/tauri/events.ts`:

```typescript
/** Emitted by Rust after windows from the previous session have been reopened. */
export function onSessionRestored(handler: (count: number) => void): Promise<() => void> {
  return listen<number>('session-restored', (event) => {
    handler(event.payload);
  });
}
```

- [ ] **Step 2: Import the store and component**

In `src/App.svelte`, add to the imports:

```typescript
  import ToastStack from './lib/ToastStack.svelte';
  import { createToastStore } from './lib/toasts.svelte';
  import { onMenuEvent, onOpenFile, onFileChangedExternally, onSessionRestored } from './lib/tauri/events';
```

Replace the existing `onMenuEvent, onOpenFile, onFileChangedExternally` import
line rather than adding a second one.

Then create the store next to the others (after `const recentFiles = ...`):

```typescript
  const toasts = createToastStore();
```

- [ ] **Step 3: Offer the restore, and drop the toast once used**

In `onMount`, replace the update-checker block (currently around lines 318-322):

```typescript
    // Check for updates: first after 15s, then every hour
    let stopUpdateChecker: (() => void) | null = null;
    import('./lib/updater').then(({ startUpdateChecker }) => {
      stopUpdateChecker = startUpdateChecker((latest, current) => {
        toasts.push({ kind: 'update', latest, current });
      });
    });

    // Offer the previous session, but only in the window that exists at launch —
    // showing it in every window would be noise.
    import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
      if (getCurrentWindow().label !== 'main') return;
      const count = await invoke<number>('pending_session_count').catch(() => 0);
      if (count > 0) {
        toasts.push({ kind: 'session', count });
      }
    });

    const unlistenSessionRestored = onSessionRestored(() => {
      toasts.dismissKind('session');
    });
```

Then add the new unlisten to the cleanup return block:

```typescript
      unlistenSessionRestored.then((fn) => fn());
```

- [ ] **Step 4: Render the stack**

Find the markup section of `src/App.svelte` where `RecentFilesPanel` is rendered
and add the stack next to it, as a sibling:

```svelte
<ToastStack store={toasts} />
```

- [ ] **Step 5: Typecheck and run the whole suite**

Run: `npm run check 2>&1 | tail -3 && npm run test -- --run 2>&1 | tail -5`
Expected: `0 ERRORS`, and every Vitest file passing.

- [ ] **Step 6: Commit**

```bash
git add src/App.svelte src/lib/tauri/events.ts
git commit -m "feat(session): offer the previous session through a toast"
```

---

## Task 14: Apply the restored caret and scroll position

**Files:**
- Modify: `src/App.svelte`

- [ ] **Step 1: Add the apply helper**

In `src/App.svelte`, add near `handleOpenFilePath`:

```typescript
  // --- Restored caret / scroll ---
  async function applyRestorePosition(cursor: number, topLine: number): Promise<void> {
    const view = editorHandle?.view;
    if (!view) return;
    const { clampCursor, clampTopLine } = await import('./lib/session-position');
    const { EditorView } = await import('@codemirror/view');

    const anchor = clampCursor(cursor, view.state.doc.length);
    const line = view.state.doc.line(clampTopLine(topLine, view.state.doc.lines));

    view.dispatch({
      selection: { anchor },
      effects: EditorView.scrollIntoView(line.from, { y: 'start' }),
    });
  }
```

- [ ] **Step 2: Call it after the restored content is in the editor**

Replace the `get_pending_file` block written in Task 6 with:

```typescript
    invoke<PendingOpen | null>('get_pending_file').then(async (pending) => {
      if (!pending) return;
      if (pending.path) {
        await handleOpenFilePath(pending.path);
      } else if (pending.content !== null) {
        // Restored Untitled window — no file on disk, just the buffer.
        editorHandle?.replaceContent(pending.content);
        fileState.isDirty = true;
      }
      if (pending.cursor > 0 || pending.topLine > 1) {
        await applyRestorePosition(pending.cursor, pending.topLine);
      }
    });
```

- [ ] **Step 3: Typecheck**

Run: `npm run check 2>&1 | tail -3`
Expected: `0 ERRORS`

- [ ] **Step 4: Verify by hand**

```bash
pkill -f "debug/md-mini" 2>/dev/null
rm -f ~/Library/Application\ Support/md-mini/session.json
npm run dev:app -- -- -- "$(pwd)/test-fixtures/mermaid-pan-zoom.md" > /tmp/session-dev.log 2>&1 &
```

Scroll to the bottom of the document, click on a line there, wait 7 seconds, then:

```bash
osascript -e 'quit app "md-mini-dev"'
sleep 2
npm run dev:app > /tmp/session-dev2.log 2>&1 &
```

Press `Cmd+Shift+T` in the new window.
Expected: the file reopens already scrolled to where you were, with the caret on
the line you clicked — not at the top.

- [ ] **Step 5: Commit**

```bash
git add src/App.svelte
git commit -m "feat(session): restore caret and scroll position"
```

---

## Task 15: Verify the whole flow in the running app

No code in this task. It exists because the exit sequence cannot be unit-tested
and is the part most likely to be subtly wrong.

Use the MCP bridge to inspect the app. The protocol is a plain WebSocket on port
`9223` speaking `{"id": "...", "command": "...", "args": {...}}`; useful commands
are `list_windows`, `execute_js` (`{script, windowLabel}`) and
`capture_native_screenshot`. If the port is taken it falls back to `9224` —
check the `MCP Bridge plugin initialized` line in the dev log.

- [ ] **Step 1: Untitled windows survive a quit**

Start clean, then in the launched window type some text without saving. Open a
second window with `Cmd+N` and type different text. Wait 7 seconds.

```bash
osascript -e 'quit app "md-mini-dev"'
sleep 2
cat ~/Library/Application\ Support/md-mini/session.json
ls ~/Library/Application\ Support/md-mini/session/
```

Expected: two entries with `"path": null` and an `"untitled"` filename each; two
matching `untitled-*.md` files whose contents are your two drafts.

Relaunch and press `Cmd+Shift+T`. Expected: both drafts come back as dirty
Untitled windows.

- [ ] **Step 2: Deliberately closing a window forgets it**

Start clean, open three windows, wait 7 seconds. Close one with `Cmd+W`, then
**wait 3 seconds** (longer than the ticker) and quit.

Expected: `session.json` holds two windows, not three.

- [ ] **Step 3: A file deleted while closed is dropped**

Create a scratch file, open it, wait 7 seconds, quit, delete the file, relaunch.

```bash
echo "# scratch" > /tmp/session-scratch.md
# open it, wait, quit, then:
rm /tmp/session-scratch.md
```

Expected: the menu item counts one fewer window, and restoring does not create an
empty window for the missing file.

- [ ] **Step 4: No duplicate window for an already-open file**

Quit with `notes.md` open, then relaunch with that same file as an argument:

```bash
npm run dev:app -- -- -- "$(pwd)/test-fixtures/mermaid-pan-zoom.md" > /tmp/session-dev.log 2>&1 &
```

Press `Cmd+Shift+T`. Expected: the existing window is focused; no second window
for the same path.

- [ ] **Step 5: Toast stacking with a gap**

Both toasts have to be on screen at once, which needs the update check to report
a hit. Force it with a temporary edit to `src/lib/updater.ts`:

```typescript
export function isNewer(latest: string, current: string): boolean {
  return true; // TEMPORARY — revert before committing
}
```

Then start with a session available (quit with two windows open first), and wait
20 seconds so the 15 s first check fires. Inspect the rendered stack:

```bash
node -e '
const ws = new WebSocket("ws://127.0.0.1:9223");
const script = `(() => {
  const stack = document.querySelector(".md-toast-stack");
  if (!stack) return "NO STACK";
  const cards = [...stack.querySelectorAll(".md-toast")];
  const rects = cards.map(c => c.getBoundingClientRect());
  const gaps = rects.slice(1).map((r, i) => Math.round(r.top - rects[i].bottom));
  return JSON.stringify({
    count: cards.length,
    order: cards.map(c => c.textContent.includes("available") ? "update" : "session"),
    gaps,
  });
})()`;
ws.onopen = () => ws.send(JSON.stringify({id:"1",command:"execute_js",args:{windowLabel:"main",script}}));
ws.onmessage = (e) => { console.log(String(e.data)); ws.close(); };
'
```

Expected: `count: 2`, `order: ["update","session"]`, and `gaps: [8]` — the update
toast above, with a real 8px gap rather than two touching cards.

Also take a `capture_native_screenshot` and look at it, to confirm the cards read
as separate and the text is legible in both themes.

**Revert the `isNewer` edit before moving on.**

Run: `git diff src/lib/updater.ts`
Expected: no output.

- [ ] **Step 6: A hard kill still leaves a usable session**

Start clean, open two windows, wait 7 seconds, then `pkill -9 -f "debug/md-mini"`.
Delete the stale socket only after confirming no process survives:

```bash
pkill -9 -f "debug/md-mini"
pgrep -fl "debug/md-mini" | grep -v zsh || echo "none"
rm -f /tmp/com_md_mini_dev_si.sock
cat ~/Library/Application\ Support/md-mini/session.json
```

Expected: the ticker had already written both windows, so the file is intact.

- [ ] **Step 7: Commit nothing, but record what you found**

If any step failed, fix it and note the cause in the commit message. If all
passed, no commit is needed for this task.

---

## Task 16: Documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/plans/2026-07-25-session-restore.md` (tick the boxes)

- [ ] **Step 1: Add the architecture entries**

In `CLAUDE.md`, in the `src-tauri/src/` block of the Architecture section, add
after the `recovery.rs` line:

```
  session.rs            # Session restore (window list, geometry, caret, untitled buffers)
```

And in the `src/` block, after `lib/stores.svelte.ts`:

```
  lib/toasts.svelte.ts  # Toast stack store (update + session notifications)
  lib/ToastStack.svelte # Bottom-right toast stack
```

- [ ] **Step 2: Add the gotchas**

In the `Gotchas` section of `CLAUDE.md`, add:

```markdown
- **Quitting destroys every window before the process exits:** any per-window cleanup on `WindowEvent::Destroyed` will therefore run for all windows during a normal quit. Session restore guards this with a `quitting` flag set in `RunEvent::ExitRequested`, which fires while the windows still exist. Without it, exiting writes an empty session.
- **`ExitRequested` is the only reliable place to snapshot window state:** it runs before destruction, so `outer_position()` / `inner_size()` still answer. Pair those two specifically — they are what `WebviewWindowBuilder::position` / `inner_size` consume when rebuilding.
- **`pkill -f "src-tauri/target/debug/md-mini"` does not match the dev app:** its cmdline holds the relative path `target/debug/md-mini`. Use `pkill -f "debug/md-mini"`.
- **Never delete `/tmp/com_md_mini_dev_si.sock` while the dev app is alive:** the single-instance plugin then lets a second instance start alongside the first, and you end up with two dev apps on bridge ports 9223 and 9224.
- **The update notification is `src/lib/updater.ts` + the toast stack**, not a Tauri updater plugin. It polls the GitHub releases API and compares versions.
```

- [ ] **Step 3: Update the preview guide if you touched it**

No change is required in `src/lib/editor/preview/CLAUDE.md` — this feature does
not touch decorations.

- [ ] **Step 4: Final full verification**

Run:
```bash
npm run check 2>&1 | tail -3
npm run test -- --run 2>&1 | tail -5
cd src-tauri && cargo test 2>&1 | tail -5 && cargo clippy 2>&1 | tail -5
```

Expected: `0 ERRORS`, all Vitest files passing, all Rust tests passing, no new
clippy warnings.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/superpowers/plans/2026-07-25-session-restore.md
git commit -m "docs: record session restore architecture and lifecycle gotchas"
```

---

## Out of scope, deliberately

Do not add these unless asked:

- Automatic restore on launch. The user chose an explicit `⇧⌘T`.
- `tauri-plugin-updater`, signing keys or `latest.json`. The GitHub-API check stays.
- Merging `recovery.rs` into `session.rs`. Different triggers, different lifetimes.
- Restoring which window had focus. Explicitly declined during design.
- Making the Homebrew cask relaunch the app after an upgrade.
