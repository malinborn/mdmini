use std::fs;
use std::path::Path;
use tauri::command;

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

#[command]
pub async fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::InvalidData {
            "Cannot open: file is not valid text.".to_string()
        } else {
            format!("Failed to read file: {}", e)
        }
    })
}

#[command]
pub async fn write_file(path: String, content: String) -> Result<(), String> {
    let tmp_path = format!("{}.tmp", path);
    fs::write(&tmp_path, &content).map_err(|e| format!("Failed to write: {}", e))?;
    fs::rename(&tmp_path, &path).map_err(|e| {
        let _ = fs::remove_file(&tmp_path);
        format!("Failed to save: {}", e)
    })
}

#[command]
pub async fn file_exists(path: String) -> bool {
    Path::new(&path).exists()
}

/// Sets the Theme menu checkmarks to match the frontend's persisted
/// preference. Called on startup and on every theme change — the only
/// writer of these checkmarks (macOS toggles the clicked item natively;
/// this call corrects it).
#[command]
pub async fn sync_theme_menu(
    state: tauri::State<'_, crate::menu::ThemeMenuItems>,
    preference: String,
) -> Result<(), String> {
    state.sync(&preference);
    Ok(())
}

/// Sets the Editor Engine submenu checkmarks ("raw" | "live-preview" |
/// "live-render") to match the frontend's persisted engine. Same pattern as
/// `sync_theme_menu`: called on startup and on every engine change, since
/// macOS toggles the clicked item natively and this call corrects it.
#[command]
pub async fn sync_engine_menu(
    state: tauri::State<'_, crate::menu::EngineMenuItems>,
    engine: String,
) -> Result<(), String> {
    state.sync(&engine);
    Ok(())
}

/// Sets the "Include Live Render in Cmd+E" checkbox to match the frontend's
/// persisted `betaInCycle` flag. Independent of `sync_engine_menu` because
/// it isn't one of the three mutually exclusive engine choices.
#[command]
pub async fn sync_beta_in_cycle_menu(
    state: tauri::State<'_, crate::menu::EngineMenuItems>,
    enabled: bool,
) -> Result<(), String> {
    state.sync_beta_in_cycle(enabled);
    Ok(())
}
