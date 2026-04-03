use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;

use notify::RecommendedWatcher;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// Tracks which file paths are open in which windows.
pub struct OpenFiles(pub Mutex<HashMap<String, String>>);

impl OpenFiles {
    pub fn new() -> Self {
        Self(Mutex::new(HashMap::new()))
    }
}

/// Stores a pending file path per window label, to be pulled by the frontend on mount.
pub struct PendingFiles(pub Mutex<HashMap<String, String>>);

/// Holds active file watchers keyed by window label. Dropping a watcher stops watching.
pub struct FileWatchers(pub Mutex<HashMap<String, RecommendedWatcher>>);

impl FileWatchers {
    pub fn new() -> Self {
        Self(Mutex::new(HashMap::new()))
    }
}

impl PendingFiles {
    pub fn new() -> Self {
        Self(Mutex::new(HashMap::new()))
    }
}

static WINDOW_COUNTER: AtomicU32 = AtomicU32::new(1);

const CASCADE_OFFSET: f64 = 30.0;
const DEFAULT_WIDTH: f64 = 900.0;
const DEFAULT_HEIGHT: f64 = 700.0;

/// Opens a file in a new window, or focuses an existing window if the file is already open.
/// If `path` is None, opens a new empty window.
pub fn open_file_window(app: &AppHandle, path: Option<String>) {
    // If a path is given, check if it's already open
    if let Some(ref file_path) = path {
        let open_files = app.state::<OpenFiles>();
        let map = open_files.0.lock().unwrap();
        if let Some(label) = map.get(file_path) {
            // Focus existing window
            if let Some(window) = app.get_webview_window(label) {
                let _ = window.set_focus();
                return;
            }
            // Window label exists in map but window is gone — fall through to create new
        }
    }

    let count = WINDOW_COUNTER.fetch_add(1, Ordering::SeqCst);
    let label = format!("editor-{}", count);
    let offset = (count as f64) * CASCADE_OFFSET;

    let builder = WebviewWindowBuilder::new(
        app,
        &label,
        WebviewUrl::App("index.html".into()),
    )
    .title("Untitled — md-mini")
    .inner_size(DEFAULT_WIDTH, DEFAULT_HEIGHT)
    .min_inner_size(400.0, 300.0)
    .position(100.0 + offset, 100.0 + offset)
    .background_color(tauri::utils::config::Color(25, 23, 36, 255));

    match builder.build() {
        Ok(window) => {
            // Bring app + window to foreground (macOS requires NSApp activate)
            let _ = window.set_focus();
            #[cfg(target_os = "macos")]
            unsafe {
                use cocoa::appkit::{NSApplication, NSApplicationActivationPolicy};
                let ns_app = cocoa::appkit::NSApp();
                ns_app.activateIgnoringOtherApps_(true);
            }
            // Track the file path in OpenFiles and store it in PendingFiles
            // so the frontend can pull it on mount via get_pending_file command.
            if let Some(ref file_path) = path {
                let open_files = app.state::<OpenFiles>();
                let mut map = open_files.0.lock().unwrap();
                map.insert(file_path.clone(), label.clone());

                let pending = app.state::<PendingFiles>();
                let mut pending_map = pending.0.lock().unwrap();
                pending_map.insert(label.clone(), file_path.clone());

                // Start watching the file for external changes
                if let Ok(watcher) = crate::watcher::watch_file(app, label.clone(), file_path.clone()) {
                    let watchers = app.state::<FileWatchers>();
                    let mut wmap = watchers.0.lock().unwrap();
                    wmap.insert(label.clone(), watcher);
                }
            }
        }
        Err(e) => {
            eprintln!("Failed to create window: {}", e);
        }
    }
}

/// Removes a file path from the open files tracking when a window is closed.
/// Also cleans up any recovery file for that path.
pub fn untrack_window(app: &AppHandle, label: &str) {
    let open_files = app.state::<OpenFiles>();
    let mut map = open_files.0.lock().unwrap();
    // Find the file path for this window before removing
    let file_path: Option<String> = map
        .iter()
        .find(|(_, v)| v.as_str() == label)
        .map(|(k, _)| k.clone());
    map.retain(|_, v| v != label);
    drop(map);

    // Stop file watcher for this window
    let watchers = app.state::<FileWatchers>();
    let mut wmap = watchers.0.lock().unwrap();
    wmap.remove(label); // dropping RecommendedWatcher stops watching
    drop(wmap);

    // Clean up recovery file in background
    if let Some(path) = file_path {
        std::thread::spawn(move || {
            let _ = crate::recovery::delete_recovery_sync(&path);
        });
    }
}

/// IPC command: open a file in a new window (or focus existing).
/// Pass `path: null` to open a new empty window.
#[tauri::command]
pub async fn open_file_window_cmd(app: AppHandle, path: Option<String>) -> Result<(), String> {
    open_file_window(&app, path);
    Ok(())
}
