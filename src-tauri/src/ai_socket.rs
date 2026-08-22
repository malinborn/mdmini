//! Command socket for driving the running app from the CLI (`mdmini show`/`edit`).
//!
//! A small JSON-lines protocol over a Unix domain socket: one request per line,
//! one response per line, connection stays usable across malformed lines. See
//! `docs/superpowers/specs/2026-08-22-ai-interface-design.md`.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager};

use crate::window;

/// A parsed command socket request. `v` (protocol version) is accepted but not
/// yet branched on — kept for the future MCP wrapper mentioned in the spec.
#[derive(Debug, serde::Deserialize, serde::Serialize)]
#[serde(tag = "cmd", rename_all = "lowercase")]
pub enum AiRequest {
    Show {
        #[allow(dead_code)] // protocol version, reserved for the future MCP wrapper
        v: u32,
        path: String,
        #[serde(default)]
        line: Option<usize>,
        #[serde(default)]
        find: Option<String>,
    },
    Edit {
        #[allow(dead_code)] // protocol version, reserved for the future MCP wrapper
        v: u32,
        path: String,
        content: String,
        #[serde(default)]
        show: bool,
    },
}

/// Response written back on the same connection, one JSON object per line.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AiResponse {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub changed_lines: Option<Vec<[usize; 2]>>,
}

impl AiResponse {
    // Counterpart to `error()` below — not called from non-test Rust yet: the
    // "ok" response for `edit`/`show` is built by the frontend and only
    // deserialized here via `ai_respond`. Kept public for symmetry and for the
    // CLI client (Task 5) to construct local responses with.
    #[allow(dead_code)]
    pub fn ok() -> Self {
        Self {
            ok: true,
            error: None,
            changed_lines: None,
        }
    }

    pub fn error(msg: impl Into<String>) -> Self {
        Self {
            ok: false,
            error: Some(msg.into()),
            changed_lines: None,
        }
    }
}

/// Command socket path for a product name: release `/tmp/md_mini_cmd.sock`, dev
/// build `/tmp/md_mini_dev_cmd.sock`. Mirrors the dev/release isolation rule in
/// `paths::dir_name`, applied to a flat filename since the socket lives in
/// `/tmp`, not the app data directory.
pub fn socket_path(product_name: &str) -> PathBuf {
    let sanitized: String = product_name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    PathBuf::from(format!("/tmp/{}_cmd.sock", sanitized))
}

/// Parse one line of the JSON-lines protocol into a request.
pub fn parse_request(line: &str) -> Result<AiRequest, String> {
    serde_json::from_str(line).map_err(|e| e.to_string())
}

/// Remove the command socket file on the way out. Called from both quit paths
/// in `lib.rs` — same dual-path rule as `save_session_on_exit`, since Cmd+Q and
/// `app.exit()` fire different `RunEvent`s and neither is a superset of the other.
pub fn remove_socket(app: &AppHandle) {
    let product_name = app
        .config()
        .product_name
        .clone()
        .unwrap_or_else(|| "md-mini".to_string());
    let _ = std::fs::remove_file(socket_path(&product_name));
}

/// Start the command socket listener on a background thread.
///
/// Binds at the product-derived path, removing a stale socket left behind by a
/// prior run that didn't exit cleanly (mirrors the single-instance socket
/// gotcha — a `kill -9` leaves the file on disk), and restricts permissions to
/// the owner.
pub fn start(app: &AppHandle) {
    let product_name = app
        .config()
        .product_name
        .clone()
        .unwrap_or_else(|| "md-mini".to_string());
    let path = socket_path(&product_name);

    let _ = std::fs::remove_file(&path);

    let listener = match UnixListener::bind(&path) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("Failed to bind command socket at {:?}: {}", path, e);
            return;
        }
    };

    if let Err(e) = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)) {
        eprintln!("Failed to set command socket permissions: {}", e);
    }

    let app_handle = app.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            match stream {
                Ok(stream) => {
                    let handle = app_handle.clone();
                    std::thread::spawn(move || handle_connection(&handle, stream));
                }
                Err(e) => eprintln!("Command socket accept error: {}", e),
            }
        }
    });
}

/// Serve one connection: read requests line by line, dispatch each, write back
/// one response line. A malformed line gets an error response and the
/// connection stays open for the next one.
fn handle_connection(app: &AppHandle, stream: UnixStream) {
    let mut writer = match stream.try_clone() {
        Ok(w) => w,
        Err(e) => {
            eprintln!("Failed to clone command socket stream: {}", e);
            return;
        }
    };
    let reader = BufReader::new(stream);

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break, // connection gone
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let response = match parse_request(trimmed) {
            Ok(req) => {
                let (tx, rx) = mpsc::channel::<AiResponse>();
                dispatch(app, req, tx);
                rx.recv_timeout(Duration::from_secs(8))
                    .unwrap_or_else(|_| AiResponse::error("timeout waiting for editor"))
            }
            Err(e) => AiResponse::error(e),
        };

        let Ok(mut json) = serde_json::to_string(&response) else {
            continue;
        };
        json.push('\n');
        if writer.write_all(json.as_bytes()).is_err() {
            break; // connection gone
        }
    }
}

/// Requests waiting on a response from the frontend, keyed by an id the
/// frontend echoes back via the `ai_respond` command.
pub struct AiPending {
    map: Mutex<HashMap<u64, mpsc::Sender<AiResponse>>>,
    next: AtomicU64,
}

impl Default for AiPending {
    fn default() -> Self {
        Self::new()
    }
}

impl AiPending {
    pub fn new() -> Self {
        Self {
            map: Mutex::new(HashMap::new()),
            next: AtomicU64::new(1),
        }
    }

    /// Register a waiting request, returning the id the frontend must echo back.
    fn register(&self, tx: mpsc::Sender<AiResponse>) -> u64 {
        let id = self.next.fetch_add(1, Ordering::SeqCst);
        self.map.lock().unwrap().insert(id, tx);
        id
    }

    /// Deliver a response to the connection waiting on `id`. An unknown id is a
    /// no-op — the request may have already timed out and been dropped.
    pub fn respond(&self, id: u64, response: AiResponse) {
        if let Some(tx) = self.map.lock().unwrap().remove(&id) {
            let _ = tx.send(response);
        }
    }
}

/// Commands for windows created by an AI request, pulled by the frontend on mount.
pub struct AiQueue(pub Mutex<HashMap<String, Vec<AiCommandPayload>>>);

impl Default for AiQueue {
    fn default() -> Self {
        Self::new()
    }
}

impl AiQueue {
    pub fn new() -> Self {
        Self(Mutex::new(HashMap::new()))
    }

    fn push(&self, label: &str, payload: AiCommandPayload) {
        self.0
            .lock()
            .unwrap()
            .entry(label.to_string())
            .or_default()
            .push(payload);
    }

    /// Drain and return the commands queued for a window, called once on mount.
    pub fn pull(&self, label: &str) -> Vec<AiCommandPayload> {
        self.0.lock().unwrap().remove(label).unwrap_or_default()
    }
}

/// The event payload sent to the owning window as `ai-command`, and the shape
/// queued in `AiQueue` for a window still being created.
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCommandPayload {
    pub id: u64,
    pub cmd: String, // "show" | "edit"
    pub path: String,
    pub line: Option<usize>,
    pub find: Option<String>,
    pub content: Option<String>,
    pub show: bool,
}

/// How long to wait for `open_file_window` (run on the main thread) to register
/// the new window's label in `OpenFiles` before giving up on a freshly opened file.
const OPEN_WINDOW_TIMEOUT: Duration = Duration::from_secs(2);

/// Route a parsed request to the window that owns the file, opening one first if
/// it isn't open yet, and arrange for the response to come back on `tx`.
fn dispatch(app: &AppHandle, req: AiRequest, tx: mpsc::Sender<AiResponse>) {
    let path = match &req {
        AiRequest::Show { path, .. } => path.clone(),
        AiRequest::Edit { path, .. } => path.clone(),
    };
    let payload = AiCommandPayload {
        id: app.state::<AiPending>().register(tx),
        cmd: match &req {
            AiRequest::Show { .. } => "show".to_string(),
            AiRequest::Edit { .. } => "edit".to_string(),
        },
        path: path.clone(),
        line: match &req {
            AiRequest::Show { line, .. } => *line,
            AiRequest::Edit { .. } => None,
        },
        find: match &req {
            AiRequest::Show { find, .. } => find.clone(),
            AiRequest::Edit { .. } => None,
        },
        content: match &req {
            AiRequest::Show { .. } => None,
            AiRequest::Edit { content, .. } => Some(content.clone()),
        },
        show: match &req {
            AiRequest::Show { .. } => false,
            AiRequest::Edit { show, .. } => *show,
        },
    };
    let id = payload.id;

    let existing_label = {
        let open_files = app.state::<window::OpenFiles>();
        let map = open_files.0.lock().unwrap();
        map.get(&path).cloned()
    };

    if let Some(label) = existing_label {
        if let Some(win) = app.get_webview_window(&label) {
            if win.emit("ai-command", &payload).is_ok() {
                return;
            }
        }
        // Label was in OpenFiles but the window is already gone (closed between
        // the lookup above and here) — fall through and open a fresh one.
    }

    // Not open yet. Window creation must happen on the main thread — this
    // listener runs on a background thread per connection.
    let handle = app.clone();
    let path_for_open = path.clone();
    if app
        .run_on_main_thread(move || window::open_file_window(&handle, Some(path_for_open)))
        .is_err()
    {
        app.state::<AiPending>()
            .respond(id, AiResponse::error("failed to open window for file"));
        return;
    }

    // `open_file_window` registers the new label in `OpenFiles` synchronously,
    // but on the main thread — poll briefly from here rather than racing it.
    let deadline = Instant::now() + OPEN_WINDOW_TIMEOUT;
    loop {
        let label = {
            let open_files = app.state::<window::OpenFiles>();
            let map = open_files.0.lock().unwrap();
            map.get(&path).cloned()
        };
        if let Some(label) = label {
            app.state::<AiQueue>().push(&label, payload);
            return;
        }
        if Instant::now() >= deadline {
            app.state::<AiPending>()
                .respond(id, AiResponse::error("failed to open window for file"));
            return;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

/// IPC command: deliver the frontend's answer to an AI command back to the CLI
/// connection waiting on it.
#[tauri::command]
pub async fn ai_respond(app: AppHandle, id: u64, response: AiResponse) -> Result<(), String> {
    app.state::<AiPending>().respond(id, response);
    Ok(())
}

/// IPC command: drain the AI commands queued for the calling window — commands
/// that arrived for a file before its window existed. Called once on mount,
/// like `get_pending_file`.
#[tauri::command]
pub async fn ai_pull_pending(
    window: tauri::Window,
    state: tauri::State<'_, AiQueue>,
) -> Result<Vec<AiCommandPayload>, String> {
    Ok(state.pull(window.label()))
}

// ---------------------------------------------------------------------------
// CLI client (`mdmini ai show|edit ...`) — std only, never touches Tauri.
// ---------------------------------------------------------------------------

/// Default command socket path, overridable with `--socket` for dev builds
/// and tests (the dev app binds `/tmp/md_mini_dev_cmd.sock` instead — see
/// `socket_path`).
const DEFAULT_SOCKET_PATH: &str = "/tmp/md_mini_cmd.sock";

/// Parsed `ai <verb> <file> [flags]` arguments, verb-specific flags in `verb`.
#[derive(Debug, PartialEq)]
struct CliArgs {
    path: String,
    verb: CliVerb,
    socket: Option<String>,
}

#[derive(Debug, PartialEq)]
enum CliVerb {
    Show {
        line: Option<usize>,
        find: Option<String>,
    },
    Edit {
        show: bool,
    },
}

const USAGE: &str = "usage: mdmini ai show <file> [--line N | --find TEXT] [--socket PATH]\n       mdmini ai edit <file> [--show] [--socket PATH]";

/// Parse the CLI args that follow the `ai` verb dispatch in `main.rs`, i.e.
/// `["show", "<file>", "--line", "42"]` or `["edit", "<file>", "--show"]`.
fn parse_cli_args(args: &[String]) -> Result<CliArgs, String> {
    let mut iter = args.iter();
    let verb = iter.next().ok_or_else(|| USAGE.to_string())?;
    let path = iter.next().ok_or_else(|| USAGE.to_string())?.clone();
    let mut socket: Option<String> = None;

    match verb.as_str() {
        "show" => {
            let mut line: Option<usize> = None;
            let mut find: Option<String> = None;
            while let Some(arg) = iter.next() {
                match arg.as_str() {
                    "--line" => {
                        let v = iter.next().ok_or("--line requires a value")?;
                        line = Some(
                            v.parse::<usize>()
                                .map_err(|_| format!("invalid --line value: {}", v))?,
                        );
                    }
                    "--find" => {
                        let v = iter.next().ok_or("--find requires a value")?;
                        find = Some(v.clone());
                    }
                    "--socket" => {
                        let v = iter.next().ok_or("--socket requires a value")?;
                        socket = Some(v.clone());
                    }
                    other => return Err(format!("unknown flag: {}", other)),
                }
            }
            if line.is_some() && find.is_some() {
                return Err("--line and --find are mutually exclusive".to_string());
            }
            Ok(CliArgs {
                path,
                verb: CliVerb::Show { line, find },
                socket,
            })
        }
        "edit" => {
            let mut show = false;
            while let Some(arg) = iter.next() {
                match arg.as_str() {
                    "--show" => show = true,
                    "--socket" => {
                        let v = iter.next().ok_or("--socket requires a value")?;
                        socket = Some(v.clone());
                    }
                    other => return Err(format!("unknown flag: {}", other)),
                }
            }
            Ok(CliArgs {
                path,
                verb: CliVerb::Edit { show },
                socket,
            })
        }
        other => Err(format!("unknown command: {}", other)),
    }
}

/// Print `response` to stdout and return the process exit code: `0` if it
/// deserializes to an `ok: true` `AiResponse`, `1` otherwise.
fn print_response_and_exit_code(response_json: &str) -> i32 {
    println!("{}", response_json);
    match serde_json::from_str::<AiResponse>(response_json) {
        Ok(resp) if resp.ok => 0,
        _ => 1,
    }
}

/// Entry point for `mdmini ai <verb> ...`, called from `main.rs` before Tauri
/// is touched. `args` is the full `std::env::args()` vector (`args[0]` is the
/// binary path, `args[1]` is `"ai"`); everything from `args[2]` on is the verb
/// and its flags. Returns the process exit code.
pub fn run_ai_cli(args: Vec<String>) -> i32 {
    let parsed = match parse_cli_args(&args[2.min(args.len())..]) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("{}", e);
            return 2;
        }
    };

    let abs_path = crate::resolve_path(&parsed.path, None);

    let content = if matches!(parsed.verb, CliVerb::Edit { .. }) {
        let mut buf = String::new();
        if std::io::stdin().read_to_string(&mut buf).is_err() {
            eprintln!("failed to read stdin");
            return 2;
        }
        Some(buf)
    } else {
        None
    };

    let request = match parsed.verb {
        CliVerb::Show { line, find } => AiRequest::Show {
            v: 1,
            path: abs_path,
            line,
            find,
        },
        CliVerb::Edit { show } => AiRequest::Edit {
            v: 1,
            path: abs_path,
            content: content.unwrap_or_default(),
            show,
        },
    };

    let socket_path = parsed
        .socket
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(DEFAULT_SOCKET_PATH));

    let mut stream = match UnixStream::connect(&socket_path) {
        Ok(s) => s,
        Err(_) => {
            println!(
                "{}",
                serde_json::to_string(&AiResponse::error("md-mini is not running")).unwrap()
            );
            return 2;
        }
    };

    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));

    let mut request_line = match serde_json::to_string(&request) {
        Ok(s) => s,
        Err(e) => {
            println!(
                "{}",
                serde_json::to_string(&AiResponse::error(format!(
                    "failed to encode request: {}",
                    e
                )))
                .unwrap()
            );
            return 1;
        }
    };
    request_line.push('\n');

    if stream.write_all(request_line.as_bytes()).is_err() {
        println!(
            "{}",
            serde_json::to_string(&AiResponse::error("md-mini is not running")).unwrap()
        );
        return 2;
    }

    let mut reader = BufReader::new(stream);
    let mut response_line = String::new();
    match reader.read_line(&mut response_line) {
        Ok(0) | Err(_) => {
            println!(
                "{}",
                serde_json::to_string(&AiResponse::error("timeout waiting for response"))
                    .unwrap()
            );
            1
        }
        Ok(_) => print_response_and_exit_code(response_line.trim()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn socket_path_release_and_dev_differ() {
        assert_eq!(
            socket_path("md-mini"),
            PathBuf::from("/tmp/md_mini_cmd.sock")
        );
        assert_eq!(
            socket_path("md-mini-dev"),
            PathBuf::from("/tmp/md_mini_dev_cmd.sock")
        );
    }

    #[test]
    fn parses_show_with_line() {
        let req = parse_request(r#"{"v":1,"cmd":"show","path":"/a.md","line":42}"#).unwrap();
        match req {
            AiRequest::Show {
                line, find, path, ..
            } => {
                assert_eq!(line, Some(42));
                assert_eq!(find, None);
                assert_eq!(path, "/a.md");
            }
            _ => panic!("expected Show"),
        }
    }

    #[test]
    fn parses_edit_with_default_show() {
        let req = parse_request(r#"{"v":1,"cmd":"edit","path":"/a.md","content":"x"}"#).unwrap();
        match req {
            AiRequest::Edit { show, content, .. } => {
                assert!(!show);
                assert_eq!(content, "x");
            }
            _ => panic!("expected Edit"),
        }
    }

    #[test]
    fn malformed_line_yields_error_response() {
        assert!(parse_request("not json").is_err());

        let resp = AiResponse::error("boom");
        let json = serde_json::to_string(&resp).unwrap();
        assert_eq!(json, r#"{"ok":false,"error":"boom"}"#);
        assert!(!json.contains("changed_lines"));
    }

    fn test_payload(cmd: &str) -> AiCommandPayload {
        AiCommandPayload {
            id: 1,
            cmd: cmd.to_string(),
            path: "/a.md".to_string(),
            line: None,
            find: None,
            content: None,
            show: false,
        }
    }

    #[test]
    fn pending_queue_drains_once() {
        let queue = AiQueue::new();
        queue.push("editor-3", test_payload("show"));
        queue.push("editor-3", test_payload("edit"));

        let drained = queue.pull("editor-3");
        assert_eq!(drained.len(), 2);
        assert_eq!(drained[0].cmd, "show");
        assert_eq!(drained[1].cmd, "edit");

        assert!(queue.pull("editor-3").is_empty());
    }

    #[test]
    fn respond_routes_to_waiting_request() {
        let pending = AiPending::new();
        let (tx, rx) = mpsc::channel();
        let id = pending.register(tx);

        pending.respond(id, AiResponse::ok());
        let received = rx.recv_timeout(Duration::from_secs(1)).unwrap();
        assert!(received.ok);

        // Unknown id is a no-op — must not panic or block.
        pending.respond(9999, AiResponse::error("ignored"));
    }

    fn args(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn ai_cli_args_show_with_line() {
        let parsed = parse_cli_args(&args(&["show", "/a.md", "--line", "42"])).unwrap();
        assert_eq!(parsed.path, "/a.md");
        assert_eq!(parsed.socket, None);
        match parsed.verb {
            CliVerb::Show { line, find } => {
                assert_eq!(line, Some(42));
                assert_eq!(find, None);
            }
            _ => panic!("expected Show"),
        }
    }

    #[test]
    fn ai_cli_args_show_with_find_and_socket() {
        let parsed = parse_cli_args(&args(&[
            "show",
            "/a.md",
            "--find",
            "hello world",
            "--socket",
            "/tmp/custom.sock",
        ]))
        .unwrap();
        assert_eq!(parsed.socket, Some("/tmp/custom.sock".to_string()));
        match parsed.verb {
            CliVerb::Show { line, find } => {
                assert_eq!(line, None);
                assert_eq!(find, Some("hello world".to_string()));
            }
            _ => panic!("expected Show"),
        }
    }

    #[test]
    fn ai_cli_args_show_line_and_find_conflict() {
        let err = parse_cli_args(&args(&["show", "/a.md", "--line", "1", "--find", "x"]))
            .unwrap_err();
        assert!(err.contains("mutually exclusive"));
    }

    #[test]
    fn ai_cli_args_edit_reads_flags() {
        let parsed = parse_cli_args(&args(&["edit", "/a.md", "--show", "--socket", "/tmp/s.sock"]))
            .unwrap();
        assert_eq!(parsed.path, "/a.md");
        assert_eq!(parsed.socket, Some("/tmp/s.sock".to_string()));
        match parsed.verb {
            CliVerb::Edit { show } => assert!(show),
            _ => panic!("expected Edit"),
        }
    }

    #[test]
    fn ai_cli_args_edit_defaults_show_false() {
        let parsed = parse_cli_args(&args(&["edit", "/a.md"])).unwrap();
        match parsed.verb {
            CliVerb::Edit { show } => assert!(!show),
            _ => panic!("expected Edit"),
        }
    }

    #[test]
    fn ai_cli_args_unknown_verb_errors() {
        let err = parse_cli_args(&args(&["delete", "/a.md"])).unwrap_err();
        assert!(err.contains("unknown command"));
    }

    #[test]
    fn ai_cli_args_missing_file_errors() {
        assert!(parse_cli_args(&args(&["show"])).is_err());
        assert!(parse_cli_args(&args(&[])).is_err());
    }

    #[test]
    fn ai_cli_args_unknown_flag_errors() {
        let err = parse_cli_args(&args(&["show", "/a.md", "--bogus"])).unwrap_err();
        assert!(err.contains("unknown flag"));
    }

    #[test]
    fn print_response_and_exit_code_matches_ok_field() {
        assert_eq!(print_response_and_exit_code(r#"{"ok":true}"#), 0);
        assert_eq!(
            print_response_and_exit_code(r#"{"ok":false,"error":"boom"}"#),
            1
        );
        // Malformed JSON also falls through to the non-zero exit path.
        assert_eq!(print_response_and_exit_code("not json"), 1);
    }
}
