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
const PLAYBOOK_MD: &str = include_str!("../playbook.md");

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

/// Write `content` to `app_data_dir()/filename` (overwriting any previous
/// version) and open it in a new window.
///
/// Shared by the first-run welcome window and the "AI" menu's on-demand docs.
/// The AI menu docs are meant to always reflect the current snippets, so
/// callers regenerate `content` at click time rather than caching a copy.
pub fn open_bundled_doc(app: &AppHandle, filename: &str, content: &str) -> Result<(), String> {
    let base_dir = paths::app_data_dir()?;
    let path = base_dir.join(filename);
    fs::write(&path, content).map_err(|e| format!("failed to write {}: {}", filename, e))?;
    window::open_file_window(app, Some(path.to_string_lossy().to_string()));
    Ok(())
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

    let filename = format!("welcome-{}.md", version);
    if let Err(e) = open_bundled_doc(app, &filename, WELCOME_MD) {
        eprintln!("onboarding: {}", e);
        return;
    }

    if let Err(e) = write_marker(&base_dir, &version) {
        eprintln!("onboarding: failed to write marker: {}", e);
    }
}

/// Content for the "Connect AI via CLI" menu item — composed from
/// `ai_socket::AGENT_SNIPPET`/`INSTRUCTION_FILE_LOCATIONS` so the menu doc and
/// `mdmini agent`'s own output can never drift apart.
pub(crate) fn connect_cli_doc() -> String {
    format!(
        "# Connect AI via CLI\n\n\
Give an AI agent with shell access — Claude Code and similar — direct access to your open documents: it can jump you to a spot, push edits into the live buffer, and ask you questions with buttons in the document itself.\n\n\
Paste the block below into your agent's instruction file. Common locations:\n\n\
{}\n\n\
---\n\n\
{}\n\n\
`mdmini agent` prints this same block, any time you need it again.\n",
        crate::ai_socket::INSTRUCTION_FILE_LOCATIONS,
        crate::ai_socket::AGENT_SNIPPET,
    )
}

/// Content for the "Connect AI via MCP" menu item.
pub(crate) fn connect_mcp_doc() -> String {
    "# Connect AI via MCP\n\n\
Register md-mini as an MCP server and its show/edit/ask tools become available to any MCP-speaking agent — no instruction-file snippet required, the tools describe themselves.\n\n\
For Claude Code:\n\n\
```bash\n\
claude mcp add --scope user mdmini -- mdmini mcp\n\
```\n\n\
For other MCP clients, add this to your `mcpServers` config:\n\n\
```json\n\
{\n  \"mcpServers\": {\n    \"mdmini\": {\n      \"command\": \"mdmini\",\n      \"args\": [\"mcp\"]\n    }\n  }\n}\n\
```\n\n\
That's the whole connection — the tools are self-describing. For a short note on how your agent should *use* them well, see \"Teach your AI md-mini\" in the AI menu.\n"
        .to_string()
}

/// Content for the "Teach your AI md-mini" menu item — composed from
/// `ai_socket::MCP_AGENT_SNIPPET`/`INSTRUCTION_FILE_LOCATIONS`, same discipline
/// as `connect_cli_doc`.
pub(crate) fn teach_doc() -> String {
    format!(
        "# Teach Your AI md-mini\n\n\
Connecting md-mini over MCP is enough for an agent to call show/edit/ask — but a short usage note in its instructions makes it noticeably better at knowing *when* to reach for them. Paste the block below into your agent's instruction file. Common locations:\n\n\
{}\n\n\
---\n\n\
{}\n\n\
`mdmini agent --mcp` prints this same block. A CLI-connected agent gets the equivalent guidance built into what `mdmini agent` prints.\n",
        crate::ai_socket::INSTRUCTION_FILE_LOCATIONS,
        crate::ai_socket::MCP_AGENT_SNIPPET,
    )
}

/// Content for the "AI Playbook" menu item — static, bundled at compile time.
pub(crate) fn playbook_doc() -> &'static str {
    PLAYBOOK_MD
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

    #[test]
    fn connect_cli_doc_contains_agent_snippet() {
        let doc = connect_cli_doc();
        assert!(doc.starts_with("# Connect AI via CLI"));
        assert!(doc.contains("## md-mini AI interface"));
    }

    #[test]
    fn connect_mcp_doc_contains_registration_commands() {
        let doc = connect_mcp_doc();
        assert!(doc.starts_with("# Connect AI via MCP"));
        assert!(doc.contains("claude mcp add --scope user mdmini -- mdmini mcp"));
    }

    #[test]
    fn teach_doc_contains_mcp_snippet() {
        let doc = teach_doc();
        assert!(doc.starts_with("# Teach Your AI md-mini"));
        assert!(doc.contains("## md-mini via MCP — how to use it well"));
    }

    #[test]
    fn playbook_doc_is_nonempty_and_mentions_spec_driven() {
        let doc = playbook_doc();
        assert!(!doc.is_empty());
        assert!(doc.contains("Spec-driven"));
    }
}
