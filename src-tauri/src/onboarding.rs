//! One-time "what's new" window shown the first time a new app version runs.
//!
//! Gated by a marker file (`onboarding-version`) in the app data directory holding
//! the last version this was shown for. A dev build has its own data directory
//! (see `paths.rs`), so repeated dev testing is naturally isolated from a real
//! install and from itself across `npm run build:dev` bumps.

use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::AppHandle;

use crate::paths;
use crate::window;

const MARKER_FILE: &str = "onboarding-version";
const WELCOME_MD: &str = include_str!("../welcome.md");
const PLAYBOOK_MD: &str = include_str!("../playbook.md");
const GETTING_STARTED_MD: &str = include_str!("../getting-started-ai.md");

/// Written once, the first time an AI command reaches this install over the
/// command socket. Its presence is what silences the startup nudge forever.
const CONNECTED_FILE: &str = "ai-connected";

/// Persisted counters for the startup nudge.
const NUDGE_FILE: &str = "ai-nudge.json";

/// How many times the startup nudge may appear before it gives up on its own.
const MAX_NUDGE_SHOWS: u32 = 3;

/// Minimum gap between two nudges, so a user who restarts the app five times in
/// an afternoon sees it once.
const NUDGE_INTERVAL_SECS: u64 = 24 * 60 * 60;

/// Whether the welcome window opened during *this* launch. The nudge stands down
/// when it did — the welcome window already says everything the nudge would.
static WELCOME_SHOWN_THIS_LAUNCH: AtomicBool = AtomicBool::new(false);

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
    WELCOME_SHOWN_THIS_LAUNCH.store(true, Ordering::SeqCst);

    if let Err(e) = write_marker(&base_dir, &version) {
        eprintln!("onboarding: failed to write marker: {}", e);
    }
}

// ---------------------------------------------------------------------------
// AI discoverability: the startup nudge and the "first AI command" marker.
//
// Three surfaces name one place — the AI menu's "Getting Started" — so someone
// who sets this up once and forgets has a way back. See
// docs/superpowers/specs/2026-08-23-ai-discoverability-design.md.
// ---------------------------------------------------------------------------

/// Persisted state of the startup nudge. A missing or unparseable file reads as
/// the default (never shown, never dismissed) — this drives a toast, so a
/// corrupt file must not be able to break startup.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(default)]
pub struct NudgeState {
    pub shown: u32,
    pub last_shown: u64,
    pub dismissed: bool,
}

/// Whether the startup nudge should appear. Pure — every input is passed in, so
/// each branch is directly testable.
///
/// `connected` is the presence of the `ai-connected` marker: once an agent has
/// actually driven this install, the nudge has nothing left to say.
pub fn should_nudge(state: &NudgeState, connected: bool, welcome_shown: bool, now: u64) -> bool {
    if connected || welcome_shown || state.dismissed {
        return false;
    }
    if state.shown >= MAX_NUDGE_SHOWS {
        return false;
    }
    // A never-shown nudge has last_shown == 0, so the subtraction below lets it
    // through on any real clock without a special case.
    now.saturating_sub(state.last_shown) >= NUDGE_INTERVAL_SECS
}

fn read_nudge(base_dir: &Path) -> NudgeState {
    fs::read_to_string(base_dir.join(NUDGE_FILE))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_nudge(base_dir: &Path, state: &NudgeState) -> Result<(), String> {
    let json = serde_json::to_string(state).map_err(|e| e.to_string())?;
    fs::write(base_dir.join(NUDGE_FILE), json).map_err(|e| e.to_string())
}

fn is_connected(base_dir: &Path) -> bool {
    base_dir.join(CONNECTED_FILE).exists()
}

/// Record that an AI command reached this install, and report whether *this*
/// call is the one that made the transition.
///
/// Check-and-set: exactly one call over the lifetime of an install returns
/// `true`, and that call's command is the one that carries `first_use` to the
/// frontend. A failure to write is reported as "not the first" so a read-only
/// data directory produces no toast at all rather than one on every command.
pub fn mark_connected(version: &str) -> bool {
    let Ok(base_dir) = paths::app_data_dir() else {
        return false;
    };
    if is_connected(&base_dir) {
        return false;
    }
    match fs::write(base_dir.join(CONNECTED_FILE), version) {
        Ok(()) => true,
        Err(e) => {
            eprintln!("onboarding: failed to write {}: {}", CONNECTED_FILE, e);
            false
        }
    }
}

/// Whether to raise the startup nudge, counting this launch's show if so.
/// Called once, by the `main` window, on mount.
#[tauri::command]
pub fn ai_nudge_pending() -> bool {
    let Ok(base_dir) = paths::app_data_dir() else {
        return false;
    };
    let mut state = read_nudge(&base_dir);
    let now = crate::session::now_secs();
    if !should_nudge(
        &state,
        is_connected(&base_dir),
        WELCOME_SHOWN_THIS_LAUNCH.load(Ordering::SeqCst),
        now,
    ) {
        return false;
    }
    state.shown += 1;
    state.last_shown = now;
    if let Err(e) = write_nudge(&base_dir, &state) {
        // Showing it without recording the show would repeat it every launch.
        eprintln!("onboarding: failed to write {}: {}", NUDGE_FILE, e);
        return false;
    }
    true
}

/// Retire the startup nudge permanently — the user either followed it or closed it.
#[tauri::command]
pub fn ai_nudge_dismiss() {
    let Ok(base_dir) = paths::app_data_dir() else {
        return;
    };
    let mut state = read_nudge(&base_dir);
    if state.dismissed {
        return;
    }
    state.dismissed = true;
    if let Err(e) = write_nudge(&base_dir, &state) {
        eprintln!("onboarding: failed to write {}: {}", NUDGE_FILE, e);
    }
}

/// Open the "Getting Started" doc. Shared by the AI menu item and the startup
/// nudge's call to action, so both land on exactly the same document.
#[tauri::command]
pub fn ai_open_getting_started(app: AppHandle) {
    if let Err(e) = open_bundled_doc(&app, "ai-getting-started.md", GETTING_STARTED_MD) {
        eprintln!("onboarding: {}", e);
    }
}

/// Content for the "Getting Started" menu item — static, bundled at compile time.
pub(crate) fn getting_started_doc() -> &'static str {
    GETTING_STARTED_MD
}

/// Content for the "Connect AI via CLI" menu item — composed from
/// `ai_socket::AGENT_SNIPPET`/`INSTRUCTION_FILE_LOCATIONS`/`SKILL_TIP` so the
/// menu doc and `mdmini agent`'s own output can never drift apart.
pub(crate) fn connect_cli_doc() -> String {
    format!(
        "# Connect AI via CLI\n\n\
Give an AI agent with shell access — Claude Code and similar — direct access to your open documents: it can jump you to a spot, push edits into the live buffer, and ask you questions with buttons in the document itself.\n\n\
It won't work that out on its own — it needs the instructions below. Two ways to give them to it, both fine:\n\n\
1. **Paste the block into its instruction file.** Simplest, and always in effect.\n\
2. **Make a skill of it and point at the skill from that file.** Hand the block to your agent and ask; see the note after it.\n\n\
Instruction file locations:\n\n\
{}\n\n\
---\n\n\
{}\n\n\
---\n\n\
{}\n\n\
`mdmini agent` prints this same block, any time you need it again.\n",
        crate::ai_socket::INSTRUCTION_FILE_LOCATIONS,
        crate::ai_socket::AGENT_SNIPPET,
        crate::ai_socket::SKILL_TIP,
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
/// `ai_socket::MCP_AGENT_SNIPPET`/`INSTRUCTION_FILE_LOCATIONS`/`SKILL_TIP`,
/// same discipline as `connect_cli_doc`.
pub(crate) fn teach_doc() -> String {
    format!(
        "# Teach Your AI md-mini\n\n\
Connecting md-mini over MCP is enough for an agent to *call* show/edit/ask — but knowing *when* to reach for them comes from the note below, and without it the tools mostly go unused.\n\n\
Two ways to give it that note, both fine:\n\n\
1. **Paste the block into its instruction file.** Simplest, and always in effect.\n\
2. **Make a skill of it and point at the skill from that file.** Hand the block to your agent and ask; see the note after it.\n\n\
Instruction file locations:\n\n\
{}\n\n\
---\n\n\
{}\n\n\
---\n\n\
{}\n\n\
`mdmini agent --mcp` prints this same block. A CLI-connected agent gets the equivalent guidance built into what `mdmini agent` prints.\n",
        crate::ai_socket::INSTRUCTION_FILE_LOCATIONS,
        crate::ai_socket::MCP_AGENT_SNIPPET,
        crate::ai_socket::SKILL_TIP,
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
    fn cli_and_teach_docs_offer_the_skill_alternative() {
        for doc in [connect_cli_doc(), teach_doc()] {
            assert!(doc.contains("Two ways to give"), "both paths should be stated up front");
            assert!(doc.contains("Making this a skill"));
            assert!(doc.contains("~/.claude/skills/mdmini/SKILL.md"));
        }
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

    // --- Getting Started doc ------------------------------------------------

    #[test]
    fn getting_started_doc_maps_the_ai_menu() {
        let doc = getting_started_doc();
        assert!(doc.starts_with("# Getting Started with AI in md-mini"));
        // The menu map is the point of the document; losing it would leave a
        // setup guide that never says where any of this lives.
        assert!(doc.contains("## Where this lives"));
        for item in [
            "Getting Started",
            "Connect AI via CLI",
            "Connect AI via MCP",
            "Teach your AI md-mini",
            "AI Playbook",
        ] {
            assert!(doc.contains(item), "menu map is missing {:?}", item);
        }
        assert!(doc.contains("claude mcp add --scope user mdmini -- mdmini mcp"));
    }

    #[test]
    fn welcome_doc_also_points_at_the_ai_menu() {
        // First-run users only ever see the welcome window, and they are the
        // ones who set this up once and forget where it was. The welcome doc
        // stays deliberately short, so it names the menu and the items to click
        // rather than reproducing the whole menu map.
        assert!(WELCOME_MD.contains("**AI** menu"));
        assert!(WELCOME_MD.contains("Getting Started"));
        assert!(WELCOME_MD.contains("Connect AI via CLI"));
        assert!(WELCOME_MD.contains("Connect AI via MCP"));
    }

    #[test]
    fn welcome_doc_leads_with_the_two_ways_to_instruct_an_agent() {
        // The one thing a first-run user must take away: md-mini does nothing
        // for an agent that was never given the instructions.
        assert!(WELCOME_MD.contains("No agent figures md-mini out on its own"));
        assert!(WELCOME_MD.contains("Paste the block into its instruction file"));
        assert!(WELCOME_MD.contains("Make a skill of it"));
    }

    // --- Startup nudge ------------------------------------------------------

    const DAY: u64 = 24 * 60 * 60;

    /// A fresh install, one day into using the app: everything permits a nudge.
    fn fresh() -> NudgeState {
        NudgeState::default()
    }

    #[test]
    fn nudges_a_fresh_install() {
        assert!(should_nudge(&fresh(), false, false, DAY));
    }

    #[test]
    fn never_nudges_once_an_agent_has_connected() {
        assert!(!should_nudge(&fresh(), true, false, DAY));
    }

    #[test]
    fn never_nudges_on_the_launch_that_showed_the_welcome_window() {
        assert!(!should_nudge(&fresh(), false, true, DAY));
    }

    #[test]
    fn never_nudges_after_dismissal() {
        let state = NudgeState { shown: 1, last_shown: 0, dismissed: true };
        assert!(!should_nudge(&state, false, false, 10 * DAY));
    }

    #[test]
    fn stops_nudging_after_the_show_limit() {
        let at_limit = NudgeState {
            shown: MAX_NUDGE_SHOWS,
            last_shown: DAY,
            dismissed: false,
        };
        assert!(!should_nudge(&at_limit, false, false, 100 * DAY));

        let below_limit = NudgeState {
            shown: MAX_NUDGE_SHOWS - 1,
            last_shown: DAY,
            dismissed: false,
        };
        assert!(should_nudge(&below_limit, false, false, 100 * DAY));
    }

    #[test]
    fn holds_off_within_a_day_of_the_last_nudge() {
        let state = NudgeState { shown: 1, last_shown: 10 * DAY, dismissed: false };
        // Restarting the app an hour later must not nudge again.
        assert!(!should_nudge(&state, false, false, 10 * DAY + 3600));
        // Exactly a day later is the boundary, and it is inclusive.
        assert!(should_nudge(&state, false, false, 11 * DAY));
    }

    #[test]
    fn a_clock_that_went_backwards_does_not_nudge() {
        // Saturating subtraction: an earlier `now` than `last_shown` yields 0,
        // which is below the interval, so we simply stay quiet.
        let state = NudgeState { shown: 1, last_shown: 100 * DAY, dismissed: false };
        assert!(!should_nudge(&state, false, false, DAY));
    }

    #[test]
    fn nudge_state_round_trips_and_tolerates_junk() {
        let dir = temp_base_dir("nudge");

        // Missing file reads as the default rather than failing.
        assert_eq!(read_nudge(&dir), NudgeState::default());

        let state = NudgeState { shown: 2, last_shown: 12345, dismissed: true };
        write_nudge(&dir, &state).expect("write nudge state");
        assert_eq!(read_nudge(&dir), state);

        // A corrupt file must not be able to break startup either.
        fs::write(dir.join(NUDGE_FILE), "{not json").expect("write junk");
        assert_eq!(read_nudge(&dir), NudgeState::default());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn connected_marker_is_a_one_shot() {
        let dir = temp_base_dir("connected");
        assert!(!is_connected(&dir));

        // `mark_connected` itself resolves the real app data dir, so exercise
        // its check-and-set shape against a temp dir here and leave the path
        // resolution to the caller.
        assert!(!is_connected(&dir));
        fs::write(dir.join(CONNECTED_FILE), "1.0.0").expect("write marker");
        assert!(is_connected(&dir));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_connected_install_never_nudges_regardless_of_counters() {
        // Whatever the counters say, having connected ends the conversation.
        for shown in 0..=MAX_NUDGE_SHOWS {
            let state = NudgeState { shown, last_shown: 0, dismissed: false };
            assert!(!should_nudge(&state, true, false, 1000 * DAY));
        }
    }
}
