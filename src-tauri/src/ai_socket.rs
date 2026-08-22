//! Command socket for driving the running app from the CLI (`mdmini show`/`edit`).
//!
//! A small JSON-lines protocol over a Unix domain socket: one request per line,
//! one response per line, connection stays usable across malformed lines. See
//! `docs/superpowers/specs/2026-08-22-ai-interface-design.md`.

#![allow(dead_code)] // dispatch is a stub until Task 2 wires AiPending/AiQueue and lib.rs calls start()

use std::io::{BufRead, BufReader, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::sync::mpsc;
use std::time::Duration;

use tauri::AppHandle;

/// A parsed command socket request. `v` (protocol version) is accepted but not
/// yet branched on — kept for the future MCP wrapper mentioned in the spec.
#[derive(Debug, serde::Deserialize)]
#[serde(tag = "cmd", rename_all = "lowercase")]
pub enum AiRequest {
    Show {
        v: u32,
        path: String,
        #[serde(default)]
        line: Option<usize>,
        #[serde(default)]
        find: Option<String>,
    },
    Edit {
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

/// Route a parsed request to the window that owns the file (or open one), and
/// arrange for the response to come back on `tx`. Stubbed until Task 2 wires up
/// `AiPending`/`AiQueue` and the frontend event round-trip.
fn dispatch(_app: &AppHandle, _req: AiRequest, tx: mpsc::Sender<AiResponse>) {
    let _ = tx.send(AiResponse::error("ai commands not yet implemented"));
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
}
