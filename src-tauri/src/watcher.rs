use std::path::Path;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, Manager};

/// Starts watching a file for external modifications.
/// Sends `file-changed-externally` events to the window with the given label.
/// Returns the watcher handle (dropping it stops watching).
pub fn watch_file(
    app: &AppHandle,
    window_label: String,
    file_path: String,
) -> Result<RecommendedWatcher, String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(format!("File does not exist: {}", file_path));
    }

    let (tx, rx) = mpsc::channel::<notify::Result<Event>>();

    let mut watcher =
        RecommendedWatcher::new(tx, notify::Config::default().with_poll_interval(Duration::from_secs(2)))
            .map_err(|e| format!("Failed to create watcher: {}", e))?;

    watcher
        .watch(path, RecursiveMode::NonRecursive)
        .map_err(|e| format!("Failed to watch file: {}", e))?;

    let app_handle = app.clone();
    let watched_path = file_path.clone();

    thread::spawn(move || {
        while let Ok(result) = rx.recv() {
            match result {
                Ok(event) => {
                    if matches!(
                        event.kind,
                        EventKind::Modify(_) | EventKind::Create(_)
                    ) {
                        if let Some(window) = app_handle.get_webview_window(&window_label) {
                            let _ = window.emit("file-changed-externally", &watched_path);
                        } else {
                            // Window is gone, stop watching
                            break;
                        }
                    }
                }
                Err(e) => {
                    eprintln!("Watch error for {}: {}", watched_path, e);
                }
            }
        }
    });

    Ok(watcher)
}
