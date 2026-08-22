//! One-time "what's new" window shown the first time a new app version runs.
//!
//! Gated by a marker file (`onboarding-version`) in the app data directory holding
//! the last version this was shown for. A dev build has its own data directory
//! (see `paths.rs`), so repeated dev testing is naturally isolated from a real
//! install and from itself across `npm run build:dev` bumps.

use std::fs;
use std::path::Path;

use tauri::AppHandle;

use crate::paths;
use crate::window;

const MARKER_FILE: &str = "onboarding-version";
const WELCOME_MD: &str = include_str!("../welcome.md");

/// True when the welcome window should be shown for `current` — the marker is
/// absent (fresh install / fresh data dir) or names a different version.
pub fn should_show(stored: Option<&str>, current: &str) -> bool {
    match stored {
        None => true,
        Some(v) => v != current,
    }
}

fn read_marker(base_dir: &Path) -> Option<String> {
    fs::read_to_string(base_dir.join(MARKER_FILE))
        .ok()
        .map(|s| s.trim().to_string())
}

fn write_marker(base_dir: &Path, version: &str) -> std::io::Result<()> {
    fs::write(base_dir.join(MARKER_FILE), version)
}

/// Show the welcome window if this version hasn't been shown yet. Called at the
/// end of `setup`, after `paths::init`. Never panics or breaks startup — any
/// failure is logged to stderr and swallowed.
pub fn maybe_show(app: &AppHandle) {
    let version = app
        .config()
        .version
        .clone()
        .unwrap_or_else(|| "0.0.0".to_string());

    let base_dir = match paths::app_data_dir() {
        Ok(d) => d,
        Err(e) => {
            eprintln!("onboarding: failed to get app data dir: {}", e);
            return;
        }
    };

    let stored = read_marker(&base_dir);
    if !should_show(stored.as_deref(), &version) {
        return;
    }

    let welcome_path = base_dir.join(format!("welcome-{}.md", version));
    if let Err(e) = fs::write(&welcome_path, WELCOME_MD) {
        eprintln!("onboarding: failed to write welcome doc: {}", e);
        return;
    }

    window::open_file_window(app, Some(welcome_path.to_string_lossy().to_string()));

    if let Err(e) = write_marker(&base_dir, &version) {
        eprintln!("onboarding: failed to write marker: {}", e);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_show_when_no_marker() {
        assert!(should_show(None, "1.0.0"));
    }

    #[test]
    fn should_not_show_when_same_version() {
        assert!(!should_show(Some("1.0.0"), "1.0.0"));
    }

    #[test]
    fn should_show_when_version_differs() {
        assert!(should_show(Some("0.5.1"), "1.0.0"));
    }

    fn temp_base_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "md-mini-onboarding-test-{}-{}",
            tag,
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn marker_round_trip() {
        let dir = temp_base_dir("round-trip");

        assert_eq!(read_marker(&dir), None);

        write_marker(&dir, "1.0.0").expect("write marker");
        assert_eq!(read_marker(&dir).as_deref(), Some("1.0.0"));

        write_marker(&dir, "1.1.0").expect("overwrite marker");
        assert_eq!(read_marker(&dir).as_deref(), Some("1.1.0"));

        let _ = fs::remove_dir_all(&dir);
    }
}
