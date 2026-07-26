//! Where the app keeps its own state on disk.
//!
//! The directory name is derived from the product name so that a dev build never
//! shares state with an installed release one. They differ only by config
//! (`tauri.dev.conf.json` renames the product to `md-mini-dev`), so a hardcoded
//! name would put `recovery/` — which holds the user's unsaved work — and
//! `session.json` in the same place for both, and running `npm run dev:app` would
//! quietly overwrite the real app's files.
//!
//! The release name stays `md-mini`, so existing installs keep their data.

use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;

const FALLBACK_DIR: &str = "md-mini";

static APP_DIR_NAME: OnceLock<String> = OnceLock::new();

/// Directory name for a product name. Unsuitable characters are not expected —
/// this only guards against an empty or path-bearing name reaching `join`.
pub fn dir_name(product_name: &str) -> String {
    let trimmed = product_name.trim();
    if trimmed.is_empty() || trimmed.contains('/') || trimmed.contains('\\') {
        return FALLBACK_DIR.to_string();
    }
    trimmed.to_string()
}

/// Call once, as the first thing in `setup`, before anything reads or writes.
/// Later calls are ignored, so the name cannot change under a running app.
pub fn init(product_name: &str) {
    let _ = APP_DIR_NAME.set(dir_name(product_name));
}

/// `~/Library/Application Support/<product name>/`, created if missing.
pub fn app_data_dir() -> Result<PathBuf, String> {
    let base = dirs::data_dir().ok_or("Cannot determine application data directory")?;
    let name = APP_DIR_NAME.get().map(String::as_str).unwrap_or(FALLBACK_DIR);
    let dir = base.join(name);
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("Failed to create data dir: {}", e))?;
    }
    Ok(dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dev_and_release_names_differ() {
        assert_eq!(dir_name("md-mini"), "md-mini");
        assert_eq!(dir_name("md-mini-dev"), "md-mini-dev");
        assert_ne!(dir_name("md-mini"), dir_name("md-mini-dev"));
    }

    #[test]
    fn release_name_is_unchanged_so_existing_installs_keep_their_data() {
        assert_eq!(dir_name("md-mini"), FALLBACK_DIR);
    }

    #[test]
    fn unusable_names_fall_back() {
        assert_eq!(dir_name(""), FALLBACK_DIR);
        assert_eq!(dir_name("   "), FALLBACK_DIR);
        assert_eq!(dir_name("../escape"), FALLBACK_DIR);
        assert_eq!(dir_name("a/b"), FALLBACK_DIR);
    }
}
