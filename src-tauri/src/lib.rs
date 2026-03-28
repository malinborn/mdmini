mod commands;
mod menu;
mod recovery;
#[allow(dead_code)]
mod watcher;
mod window;

use tauri::{Emitter, Manager};
use tauri_plugin_cli::CliExt;
use window::{OpenFiles, PendingFiles};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // argv[0] is the binary path — skip it
            let file_args: Vec<String> = argv.into_iter().skip(1).collect();

            if file_args.is_empty() {
                // No files — focus any existing window
                if let Some((_label, win)) = app.webview_windows().into_iter().next() {
                    let _ = win.set_focus();
                }
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
        .plugin(tauri_plugin_dialog::init());

    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(tauri_plugin_mcp_bridge::init());
    }

    let builder = builder
        .manage(OpenFiles::new())
        .manage(PendingFiles::new())
        .invoke_handler(tauri::generate_handler![
            commands::read_file,
            commands::write_file,
            commands::file_exists,
            commands::get_pending_file,
            window::open_file_window_cmd,
            recovery::save_recovery,
            recovery::delete_recovery,
            recovery::check_recovery,
        ])
        .setup(|app| {
            let menu = menu::build_menu(app.handle())?;
            app.set_menu(menu)?;

            let app_handle = app.handle().clone();
            app.on_menu_event(move |_app, event| {
                let id = event.id().0.as_str().to_string();

                // Handle "new" menu action: open a new empty window
                if id == "new" {
                    window::open_file_window(&app_handle, None);
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

                // Handle theme switching — update check marks (radio behavior)
                if id.starts_with("theme_") {
                    let theme_ids = ["theme_light", "theme_dark", "theme_system"];
                    for tid in &theme_ids {
                        if let Some(item) = _app.menu().and_then(|m| m.get(*tid)) {
                            if let Some(check) = item.as_check_menuitem() {
                                let _ = check.set_checked(*tid == id.as_str());
                            }
                        }
                    }
                }

                // Broadcast all other menu events to all windows
                for (_label, win) in _app.webview_windows() {
                    let _ = win.emit("menu-event", &id);
                }
            });

            // Handle CLI args on initial launch
            handle_cli_args(app.handle());

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
                    window::untrack_window(app, label);
                }
                _ => {}
            }
        });

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app_handle, event| {
        #[allow(clippy::single_match)]
        match event {
            tauri::RunEvent::Opened { urls } => {
                for url in urls {
                    if let Ok(path) = url.to_file_path() {
                        if let Some(path_str) = path.to_str() {
                            window::open_file_window(_app_handle, Some(path_str.to_string()));
                        }
                    }
                }
            }
            _ => {}
        }
    });
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
                            // Store in PendingFiles for the "main" window to pull on mount.
                            let pending = app.state::<PendingFiles>();
                            let mut map = pending.0.lock().unwrap();
                            map.insert("main".to_string(), abs_path);
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
