use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::time::SystemTime;

/// Returns the recovery directory path: ~/Library/Application Support/md-mini/recovery/
fn recovery_dir() -> Result<PathBuf, String> {
    let data_dir = dirs::data_dir().ok_or("Cannot determine application data directory")?;
    let dir = data_dir.join("md-mini").join("recovery");
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("Failed to create recovery dir: {}", e))?;
    }
    Ok(dir)
}

/// Deterministic hash of a file path for use as recovery filename.
fn hash_path(path: &str) -> String {
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    format!("{:016x}.md.recovery", hasher.finish())
}

// Recovery file metadata header format:
//   ---recovery---
//   path: /original/file/path.md
//   timestamp: 1711234567
//   ---end---
//   <content>

#[tauri::command]
pub async fn save_recovery(path: String, content: String) -> Result<(), String> {
    let dir = recovery_dir()?;
    let filename = hash_path(&path);
    let recovery_path = dir.join(&filename);
    let tmp_path = dir.join(format!("{}.tmp", filename));

    let timestamp = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let data = format!(
        "---recovery---\npath: {}\ntimestamp: {}\n---end---\n{}",
        path, timestamp, content
    );

    fs::write(&tmp_path, &data).map_err(|e| format!("Failed to write recovery file: {}", e))?;
    fs::rename(&tmp_path, &recovery_path).map_err(|e| {
        let _ = fs::remove_file(&tmp_path);
        format!("Failed to save recovery file: {}", e)
    })
}

/// Synchronous version for use from Rust (e.g., window cleanup).
pub fn delete_recovery_sync(path: &str) -> Result<(), String> {
    let dir = recovery_dir()?;
    let filename = hash_path(path);
    let recovery_path = dir.join(filename);
    if recovery_path.exists() {
        fs::remove_file(&recovery_path)
            .map_err(|e| format!("Failed to delete recovery file: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_recovery(path: String) -> Result<(), String> {
    let dir = recovery_dir()?;
    let filename = hash_path(&path);
    let recovery_path = dir.join(filename);
    if recovery_path.exists() {
        fs::remove_file(&recovery_path)
            .map_err(|e| format!("Failed to delete recovery file: {}", e))?;
    }
    Ok(())
}

/// A recovered file entry: original path + content.
#[derive(serde::Serialize)]
pub struct RecoveredFile {
    pub path: String,
    pub content: String,
    pub timestamp: u64,
}

#[tauri::command]
pub async fn check_recovery() -> Result<Vec<RecoveredFile>, String> {
    let dir = match recovery_dir() {
        Ok(d) => d,
        Err(_) => return Ok(vec![]),
    };

    let mut recovered = Vec::new();

    let entries = fs::read_dir(&dir).map_err(|e| format!("Failed to read recovery dir: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("recovery") {
            continue;
        }

        if let Ok(data) = fs::read_to_string(&path) {
            if let Some(file) = parse_recovery_file(&data) {
                recovered.push(file);
            }
        }
    }

    Ok(recovered)
}

fn parse_recovery_file(data: &str) -> Option<RecoveredFile> {
    if !data.starts_with("---recovery---\n") {
        return None;
    }

    let end_marker = "---end---\n";
    let end_pos = data.find(end_marker)?;
    let header = &data[15..end_pos]; // skip "---recovery---\n"
    let content = &data[end_pos + end_marker.len()..];

    let mut path = None;
    let mut timestamp = 0u64;

    for line in header.lines() {
        if let Some(p) = line.strip_prefix("path: ") {
            path = Some(p.to_string());
        } else if let Some(t) = line.strip_prefix("timestamp: ") {
            timestamp = t.parse().unwrap_or(0);
        }
    }

    Some(RecoveredFile {
        path: path?,
        content: content.to_string(),
        timestamp,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hash_path_deterministic() {
        let a = hash_path("/Users/test/file.md");
        let b = hash_path("/Users/test/file.md");
        assert_eq!(a, b);
    }

    #[test]
    fn test_hash_path_different_paths() {
        let a = hash_path("/Users/test/file1.md");
        let b = hash_path("/Users/test/file2.md");
        assert_ne!(a, b);
    }

    #[test]
    fn test_parse_recovery_file() {
        let data = "---recovery---\npath: /test/file.md\ntimestamp: 12345\n---end---\nHello world";
        let file = parse_recovery_file(data).unwrap();
        assert_eq!(file.path, "/test/file.md");
        assert_eq!(file.content, "Hello world");
        assert_eq!(file.timestamp, 12345);
    }

    #[test]
    fn test_parse_recovery_file_invalid() {
        assert!(parse_recovery_file("not a recovery file").is_none());
    }

    #[test]
    fn test_parse_recovery_file_no_path() {
        let data = "---recovery---\ntimestamp: 12345\n---end---\ncontent";
        assert!(parse_recovery_file(data).is_none());
    }
}
