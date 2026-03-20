use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

/// Tracks which file paths are open in which windows.
pub struct OpenFiles(pub Mutex<HashMap<String, String>>);

impl OpenFiles {
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
    .position(100.0 + offset, 100.0 + offset);

    match builder.build() {
        Ok(window) => {
            // Track the file path
            if let Some(ref file_path) = path {
                let open_files = app.state::<OpenFiles>();
                let mut map = open_files.0.lock().unwrap();
                map.insert(file_path.clone(), label.clone());
            }

            // Emit open-file event to the new window after a short delay
            // so the frontend has time to mount
            if let Some(file_path) = path {
                let window_clone = window.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    let _ = window_clone.emit("open-file", &file_path);
                });
            }
        }
        Err(e) => {
            eprintln!("Failed to create window: {}", e);
        }
    }
}

/// Removes a file path from the open files tracking when a window is closed.
pub fn untrack_window(app: &AppHandle, label: &str) {
    let open_files = app.state::<OpenFiles>();
    let mut map = open_files.0.lock().unwrap();
    map.retain(|_, v| v != label);
}

/// IPC command: open a file in a new window (or focus existing).
/// Pass `path: null` to open a new empty window.
#[tauri::command]
pub async fn open_file_window_cmd(app: AppHandle, path: Option<String>) -> Result<(), String> {
    open_file_window(&app, path);
    Ok(())
}
