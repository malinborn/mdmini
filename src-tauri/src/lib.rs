mod commands;
mod menu;
mod recovery;
mod session;
mod watcher;
mod window;

use tauri::{Emitter, Manager};
use tauri_plugin_cli::CliExt;
use session::SessionState;
use window::{FileWatchers, OpenFiles, PendingFiles, PendingOpen};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // argv[0] is the binary path — skip it
            let file_args: Vec<String> = argv.into_iter().skip(1).collect();

            if file_args.is_empty() {
                // No files — open a new empty window
                window::open_file_window(app, None);
            } else {
                for path in file_args {
                    if !path.starts_with('-') {
                        let abs_path = resolve_path(&path, None);
                        window::open_file_window(app, Some(abs_path));
                    }
                }
            }
        }))
        .plugin(tauri_plugin_cli::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init());

    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(tauri_plugin_mcp_bridge::init());
    }

    let builder = builder
        .manage(OpenFiles::new())
        .manage(PendingFiles::new())
        .manage(FileWatchers::new())
        .manage(SessionState::new())
        .invoke_handler(tauri::generate_handler![
            commands::read_file,
            commands::write_file,
            commands::file_exists,
            commands::get_pending_file,
            window::open_file_window_cmd,
            recovery::save_recovery,
            recovery::delete_recovery,
            recovery::check_recovery,
            session::update_session_document,
            session::pending_session_count,
            session::restore_session,
            watcher::start_watching,
        ])
        .setup(|app| {
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

            let (menu, theme_items) = menu::build_menu(app.handle(), pending_count)?;
            app.set_menu(menu)?;

            let app_handle = app.handle().clone();
            app.on_menu_event(move |_app, event| {
                let id = event.id().0.as_str().to_string();

                // Handle "new" menu action: open a new empty window
                if id == "new" {
                    window::open_file_window(&app_handle, None);
                    return;
                }

                // Restore windows in Rust, like "new" — it creates windows.
                if id == "reopen_session" {
                    session::restore_pending(&app_handle);
                    return;
                }

                // Handle "close" — close the focused window directly from Rust
                if id == "close" {
                    for (_label, win) in _app.webview_windows() {
                        if win.is_focused().unwrap_or(false) {
                            let _ = win.close();
                            break;
                        }
                    }
                    return;
                }

                // Handle theme switching — radio behavior via direct CheckMenuItem refs
                if id.starts_with("theme_") {
                    let _ = theme_items.light.set_checked(id == "theme_light");
                    let _ = theme_items.dark.set_checked(id == "theme_dark");
                    let _ = theme_items.system.set_checked(id == "theme_system");
                }

                // Broadcast all other menu events to all windows
                for (_label, win) in _app.webview_windows() {
                    let _ = win.emit("menu-event", &id);
                }
            });

            // Handle CLI args on initial launch
            handle_cli_args(app.handle());

            // Handle files from CLI wrapper (written to temp file before `open`)
            load_pending_open_files(app.handle());

            // Crash-safety net. The authoritative save happens on the way out
            // (see `save_session_on_exit`); this only catches a hard kill.
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
                    // Must include the pending restore's buffers, not just the
                    // live ones — see `referenced_untitled`.
                    session::prune_untitled_files(&state.referenced_untitled());
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { .. } => {
                    // Allow close — the frontend auto-saves, so no need to prompt
                }
                tauri::WindowEvent::Destroyed => {
                    let app = window.app_handle();
                    let label = window.label();
                    // No-op while quitting, so an exit keeps every window.
                    app.state::<SessionState>().remove(label);
                    window::untrack_window(app, label);
                }
                tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
                    let app = window.app_handle();
                    let label = window.label().to_string();
                    if let Some((x, y, width, height)) = session::window_geometry(window) {
                        app.state::<SessionState>()
                            .set_geometry(&label, x, y, width, height);
                    }
                }
                _ => {}
            }
        });

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app_handle, event| {
        match event {
            tauri::RunEvent::Opened { urls } => {
                for url in &urls {
                    if let Ok(path) = url.to_file_path() {
                        if let Some(path_str) = path.to_str() {
                            let file_path = path_str.to_string();
                            // Check if "main" window is empty (not tracking a file)
                            let main_is_empty = {
                                let open_files = _app_handle.state::<window::OpenFiles>();
                                let map = open_files.0.lock().unwrap();
                                !map.values().any(|v| v == "main")
                            };
                            if main_is_empty {
                                // Reuse "main" — store in PendingFiles + OpenFiles
                                let pending = _app_handle.state::<window::PendingFiles>();
                                let mut pmap = pending.0.lock().unwrap();
                                pmap.insert(
                                    "main".to_string(),
                                    PendingOpen::from_path(file_path.clone()),
                                );
                                drop(pmap);
                                let open_files = _app_handle.state::<window::OpenFiles>();
                                let mut map = open_files.0.lock().unwrap();
                                map.insert(file_path.clone(), "main".to_string());
                                drop(map);
                                // Emit in case frontend is already loaded
                                if let Some(win) = _app_handle.get_webview_window("main") {
                                    let _ = win.emit("open-file", &file_path);
                                    let _ = win.set_focus();
                                }
                                // Start watcher
                                if let Ok(watcher) = crate::watcher::watch_file(_app_handle, "main".to_string(), file_path) {
                                    let watchers = _app_handle.state::<window::FileWatchers>();
                                    let mut wmap = watchers.0.lock().unwrap();
                                    wmap.insert("main".to_string(), watcher);
                                }
                            } else {
                                window::open_file_window(_app_handle, Some(file_path));
                            }
                        }
                    }
                }
            }
            tauri::RunEvent::Reopen { .. } => {
                // App re-activated (Dock click, `open` while running)
                // Open any pending files from CLI wrapper in new windows
                open_pending_files(_app_handle);
            }
            // Both quit paths must be handled, and they are NOT interchangeable:
            //   * `ExitRequested` only fires from `app.exit()` or after the last
            //     window is destroyed.
            //   * Cmd+Q and the AppleEvent `quit` that Homebrew sends go through
            //     `NSApp terminate:` -> `applicationWillTerminate` -> tao's
            //     `LoopDestroyed` -> `RunEvent::Exit`, and never emit
            //     `ExitRequested` at all.
            // Handling only the former would lose the session on exactly the
            // upgrade path this feature exists for.
            tauri::RunEvent::ExitRequested { .. } => {
                save_session_on_exit(_app_handle);
            }
            tauri::RunEvent::Exit => {
                save_session_on_exit(_app_handle);
            }
            _ => {}
        }
    });
}

/// Snapshot and persist the session on the way out, then freeze it.
///
/// Freezing first is what makes the following `Destroyed` storm harmless: a quit
/// destroys every window, and `SessionState::remove` is a no-op once quitting.
/// Whichever quit path fires first wins; the second call returns immediately.
fn save_session_on_exit(app: &tauri::AppHandle) {
    let state = app.state::<SessionState>();
    if state.is_quitting() {
        return;
    }
    let snapshot = state.snapshot(session::now_secs());
    state.mark_quitting();
    // A quit records the session, it never erases it. An empty snapshot here
    // means the windows were already gone before we were called — not that the
    // user had nothing open — so the last good file on disk is the better answer.
    if snapshot.windows.is_empty() {
        return;
    }
    let _ = session::write_session(&snapshot);
}

/// Hand a file to the `main` window and register it as open.
///
/// `OpenFiles` is what every dedup check consults — `open_file_window`'s focus
/// path and `open_restored_window`'s. Registering only in `PendingFiles`, as the
/// CLI paths used to, leaves the file the app launched with invisible to both, so
/// opening it a second time or restoring a session that contains it silently
/// produces a duplicate window.
fn assign_file_to_main(app: &tauri::AppHandle, path: String) {
    let pending = app.state::<PendingFiles>();
    pending
        .0
        .lock()
        .unwrap()
        .insert("main".to_string(), PendingOpen::from_path(path.clone()));

    let open_files = app.state::<OpenFiles>();
    open_files.0.lock().unwrap().insert(path, "main".to_string());
}

/// Resolve a potentially relative path to an absolute path.
fn resolve_path(path: &str, cwd: Option<&str>) -> String {
    let p = std::path::Path::new(path);
    if p.is_absolute() {
        return path.to_string();
    }
    let base = match cwd {
        Some(c) => std::path::PathBuf::from(c),
        None => std::env::current_dir().unwrap_or_default(),
    };
    base.join(p)
        .canonicalize()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| base.join(path).to_string_lossy().to_string())
}

/// Open pending files when app is already running (Reopen event).
/// Each file gets a new window since "main" already exists.
fn open_pending_files(app: &tauri::AppHandle) {
    let path = std::path::Path::new("/tmp/md-mini-pending-files");
    if !path.exists() {
        return;
    }
    let contents = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return,
    };
    let _ = std::fs::remove_file(path);

    for line in contents.lines() {
        let file = line.trim();
        if !file.is_empty() {
            window::open_file_window(app, Some(file.to_string()));
        }
    }
}

/// Load files written by the CLI wrapper script to /tmp/md-mini-pending-files.
/// Uses the same PendingFiles mechanism as CLI args — first file goes into "main" window.
fn load_pending_open_files(app: &tauri::AppHandle) {
    let path = std::path::Path::new("/tmp/md-mini-pending-files");
    if !path.exists() {
        return;
    }
    let contents = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return,
    };
    let _ = std::fs::remove_file(path);

    let pending = app.state::<PendingFiles>();
    let mut map = pending.0.lock().unwrap();
    let already_has_main = map.contains_key("main");

    let mut first = !already_has_main; // only use "main" slot if CLI args didn't take it
    drop(map);

    for line in contents.lines() {
        let file = line.trim();
        if file.is_empty() {
            continue;
        }
        if first {
            first = false;
            assign_file_to_main(app, file.to_string());
        } else {
            window::open_file_window(app, Some(file.to_string()));
        }
    }
}

/// Handle CLI file arguments on initial launch.
/// The first file is loaded into the existing "main" window via PendingFiles;
/// any additional files each get a new window (also via PendingFiles).
fn handle_cli_args(app: &tauri::AppHandle) {
    if let Ok(matches) = app.cli().matches() {
        if let Some(files_arg) = matches.args.get("files") {
            if let serde_json::Value::Array(arr) = &files_arg.value {
                let mut first = true;
                for val in arr {
                    if let serde_json::Value::String(path) = val {
                        if path.is_empty() {
                            continue;
                        }
                        let abs_path = resolve_path(path.as_str(), None);
                        if first {
                            first = false;
                            // The "main" window pulls this on mount.
                            assign_file_to_main(app, abs_path);
                        } else {
                            // Additional files each get a new window.
                            window::open_file_window(app, Some(abs_path));
                        }
                    }
                }
            }
        }
    }
}
