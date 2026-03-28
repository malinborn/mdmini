use std::fs;
use std::path::Path;
use tauri::command;

/// Returns and removes the pending file path for the calling window, if any.
/// Called by the frontend in onMount to pick up files passed via CLI args.
#[command]
pub async fn get_pending_file(
    window: tauri::Window,
    state: tauri::State<'_, crate::window::PendingFiles>,
) -> Result<Option<String>, String> {
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
