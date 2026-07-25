use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::SystemTime;

use serde::{Deserialize, Serialize};

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

    /// Sidecar file names referenced by either the live session or the restore
    /// still on offer.
    ///
    /// Both halves matter. At startup the live session is deliberately empty — so
    /// that the first write of the new run supersedes the file — while `pending`
    /// still holds the previous run's windows. Collecting only the live half makes
    /// the ticker delete exactly the unsaved buffers the user is about to reopen.
    pub fn referenced_untitled(&self) -> HashSet<String> {
        let mut names: HashSet<String> = self
            .entries
            .lock()
            .unwrap()
            .values()
            .filter_map(|w| w.untitled.clone())
            .collect();
        names.extend(
            self.pending
                .lock()
                .unwrap()
                .iter()
                .filter_map(|w| w.untitled.clone()),
        );
        names
    }
}

impl Default for SessionState {
    fn default() -> Self {
        Self::new()
    }
}

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

/// Delete Untitled sidecars nothing refers to any more.
///
/// Take the names from `SessionState::referenced_untitled`, never from the live
/// snapshot alone — see that method for why.
pub fn prune_untitled_files(referenced: &HashSet<String>) {
    let Ok(dir) = session_dir() else { return };
    let Ok(entries) = fs::read_dir(&dir) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if !name.starts_with("untitled-") || !name.ends_with(".md") {
            continue;
        }
        if !referenced.contains(name) {
            let _ = fs::remove_file(entry.path());
        }
    }
}

/// A window's position and size in **logical** pixels.
///
/// The getters answer in physical pixels, but `WebviewWindowBuilder::position`
/// and `inner_size` consume logical ones — without the conversion every restored
/// window comes back at double size and offset on a 2x display.
pub fn window_geometry(window: &tauri::Window) -> Option<(i32, i32, u32, u32)> {
    let pos = window.outer_position().ok()?;
    let size = window.inner_size().ok()?;
    let scale = window.scale_factor().ok()?;
    let pos = pos.to_logical::<f64>(scale);
    let size = size.to_logical::<f64>(scale);
    Some((
        pos.x.round() as i32,
        pos.y.round() as i32,
        size.width.round() as u32,
        size.height.round() as u32,
    ))
}

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

    // Geometry also rides the heartbeat, because `Moved`/`Resized` never fire for
    // a window the user does not touch — leaving it recorded at 0x0 and restored
    // into the top-left corner under the menu bar.
    if let Some((x, y, width, height)) = window_geometry(&window) {
        state.set_geometry(&label, x, y, width, height);
    }

    match (path, content) {
        // Untitled window with text — mirror it to a sidecar file.
        //
        // The `is_empty` guard matters more than it looks: the frontend reports
        // once at mount, before `get_pending_file` has resolved, so a window that
        // is *about* to load a file briefly looks like an empty Untitled one.
        // Without the guard that transient state earns a sidecar and an
        // `untitled` name, which survives `prune_missing` and comes back as a
        // blank window instead of the file. With it, the entry has neither a path
        // nor an untitled name and is pruned on read.
        (None, Some(text)) if !text.is_empty() => {
            let file_name = untitled_file_name(&label);
            write_untitled(&file_name, &text)?;
            state.set_untitled(&label, Some(file_name));
        }
        // Saved file, or an empty Untitled window — no sidecar needed.
        _ => state.set_untitled(&label, None),
    }
    Ok(())
}

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
    fn prune_missing_drops_entry_with_neither_path_nor_untitled() {
        // A window reports itself at mount, before `get_pending_file` resolves,
        // so it briefly has no path and an empty buffer. That entry must not
        // come back as a blank window.
        let session = Session {
            version: SESSION_VERSION,
            saved_at: 0,
            windows: vec![snap(None)],
        };
        let pruned = prune_missing(session, |_| true);
        assert!(pruned.windows.is_empty());
    }

    #[test]
    fn referenced_untitled_covers_the_pending_restore() {
        // Regression: the live session starts empty at launch while `pending`
        // still holds the previous run, so pruning on the live set alone deleted
        // the very buffer the user was about to reopen.
        let state = SessionState::new();
        let mut pending = snap(None);
        pending.untitled = Some("untitled-main.md".to_string());
        state.set_pending(vec![pending]);
        assert!(state.snapshot(0).windows.is_empty(), "live session is empty");

        let referenced = state.referenced_untitled();
        assert!(referenced.contains("untitled-main.md"));
    }

    #[test]
    fn referenced_untitled_covers_live_windows_too() {
        let state = SessionState::new();
        state.set_untitled("editor-2", Some("untitled-editor-2.md".to_string()));
        let referenced = state.referenced_untitled();
        assert!(referenced.contains("untitled-editor-2.md"));
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
}
