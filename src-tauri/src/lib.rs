mod commands;
mod menu;
mod recovery;
#[allow(dead_code)]
mod watcher;
mod window;

use tauri::{Emitter, Manager};
use tauri_plugin_cli::CliExt;
use window::OpenFiles;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
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
        .plugin(tauri_plugin_dialog::init())
        .manage(OpenFiles::new())
        .invoke_handler(tauri::generate_handler![
            commands::read_file,
            commands::write_file,
            commands::file_exists,
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
            if let tauri::WindowEvent::Destroyed = event {
                let app = window.app_handle();
                let label = window.label();
                window::untrack_window(app, label);
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
fn handle_cli_args(app: &tauri::AppHandle) {
    if let Ok(matches) = app.cli().matches() {
        if let Some(files_arg) = matches.args.get("files") {
            if let serde_json::Value::Array(arr) = &files_arg.value {
                for val in arr {
                    if let serde_json::Value::String(path) = val {
                        if !path.is_empty() {
                            let abs_path = resolve_path(path.as_str(), None);
                            // Emit to the main window (created by tauri.conf.json)
                            if let Some(main_window) = app.get_webview_window("main") {
                                let file_path = abs_path.clone();
                                std::thread::spawn(move || {
                                    std::thread::sleep(std::time::Duration::from_millis(500));
                                    let _ = main_window.emit("open-file", &file_path);
                                });
                            }
                            // Only handle first file in main window; additional files get new windows
                            // But since this is the initial launch, main window handles the first arg
                            // and the rest get new windows
                            let remaining: Vec<String> = arr
                                .iter()
                                .skip(1)
                                .filter_map(|v| {
                                    if let serde_json::Value::String(s) = v {
                                        Some(resolve_path(s, None))
                                    } else {
                                        None
                                    }
                                })
                                .collect();
                            for extra_path in remaining {
                                window::open_file_window(app, Some(extra_path));
                            }
                            return;
                        }
                    }
                }
            }
        }
    }
}
