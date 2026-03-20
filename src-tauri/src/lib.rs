mod commands;
mod menu;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_cli::init())
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {}))
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::read_file,
            commands::write_file,
            commands::file_exists,
        ])
        .setup(|app| {
            use tauri::{Emitter, Manager};

            let menu = menu::build_menu(app.handle())?;
            app.set_menu(menu)?;

            app.on_menu_event(move |app, event| {
                let id = event.id().0.as_str().to_string();
                for (_label, window) in app.webview_windows() {
                    let _ = window.emit("menu-event", &id);
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
