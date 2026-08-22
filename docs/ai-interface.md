# AI Interface — `mdmini show` / `mdmini edit`

Lets an AI agent (Claude Code and similar) drive a running md-mini window directly: point at a location ("look here") or push new content into the live buffer, instead of writing the file to disk and hoping the watcher/autosave/reload path catches up. No daemon, no MCP registration — the interface is the existing `mdmini` CLI plus a small command socket served by the already-running app.

## CLI verbs

| Command | Behavior |
|---------|----------|
| `mdmini show <file> [--line N \| --find "text"]` | Open the file (or focus its existing window) and scroll the target into view with a ~1.6s pulse highlight. `--line` is 1-based, clamped to the document. `--find` locates the first substring match (case-sensitive). Neither flag → just open/focus, no scroll. `--line` and `--find` are mutually exclusive. |
| `cat new.md \| mdmini edit <file> [--show]` | Read the **complete** new document content from stdin, diff it against the live buffer, apply only the changed span, and highlight it. `--show` additionally scrolls the change into view. If the file isn't open yet, md-mini opens a window for it first, then applies the edit. |

Examples:

```bash
mdmini show notes.md --line 42
mdmini show notes.md --find "## Deploy"
cat new.md | mdmini edit notes.md --show
```

Both verbs accept `--socket <path>` to target a non-default command socket (dev builds — see below).

Always send the **full** new document on stdin for `edit`, not a diff or patch — md-mini computes the diff itself against what's currently in the buffer.

## JSON response contract

One line of JSON on stdout, always. No JSON on stderr.

```jsonc
// show, success
{"ok": true}

// edit, success — one [start, end] pair per changed span, 1-based inclusive line numbers,
// in the resulting document. Empty array if the content was already identical.
{"ok": true, "changed_lines": [[12, 15]]}
{"ok": true, "changed_lines": []}

// error (either verb)
{"ok": false, "error": "target not found"}
```

`changed_lines` is shaped as an array for forward compatibility, but the current implementation always returns 0 or 1 pairs — md-mini computes a single minimal common-prefix/common-suffix span between old and new content (`computeReplacement`), not a multi-hunk diff.

### Exit codes

| Code | Meaning |
|------|---------|
| `0` | Request reached md-mini and succeeded (`"ok":true`). |
| `1` | Request reached md-mini but it rejected it (`"ok":false"`), or the CLI's own 10s read timed out waiting for a reply after the socket accepted the request (`{"ok":false,"error":"timeout waiting for response"}`). |
| `2` | Usage error (bad flags, missing file arg, unknown verb), or md-mini isn't running / didn't start in time (`{"ok":false,"error":"md-mini is not running"}` or `"md-mini did not start in time"`). |

## Socket protocol

JSON-lines over a Unix domain socket: one request object per line, one response object per line, connection stays open across malformed lines (bad line → error response, socket keeps serving).

Request shapes (`"v":1` is a protocol version, reserved for a future MCP wrapper — currently accepted but not branched on):

```json
{"v": 1, "cmd": "show", "path": "/abs/file.md", "line": 42, "find": null}
{"v": 1, "cmd": "show", "path": "/abs/file.md", "line": null, "find": "## Deploy"}
{"v": 1, "cmd": "edit", "path": "/abs/file.md", "content": "<full new document>", "show": false}
```

`path` must be absolute — the CLI resolves relative paths against the current directory (and canonicalizes them) before sending.

Socket path, derived from the product name (same dev/release isolation rule as the app data directory):

| Build | Socket |
|-------|--------|
| Release (`md-mini`) | `/tmp/md_mini_cmd.sock` |
| Dev (`md-mini-dev`) | `/tmp/md_mini_dev_cmd.sock` |

Created with `0600` permissions on startup (`ai_socket::start`, spawned at the end of Rust `setup`, on its own background thread). A stale socket file left behind by a prior run that didn't exit cleanly (`kill -9`) is unlinked and rebound automatically — no manual cleanup needed, unlike the single-instance socket. Removed on both clean-exit paths (`RunEvent::ExitRequested` and `RunEvent::Exit` — see `remove_socket` in `ai_socket.rs`).

Server-side, a request that reaches a live window but gets no frontend reply within **8s** returns `{"ok":false,"error":"timeout waiting for editor"}` (window closed mid-request, or frozen). The CLI itself gives up after **10s** with `"timeout waiting for response"` if it never gets a line back at all.

### Routing to a window

Requests are dispatched to the window that owns `path`, looked up in the existing `OpenFiles` registry:

- File already open → the payload is emitted as an `ai-command` event to that window; the frontend answers by invoking `ai_respond` with the same request id, which the socket listener correlates back to the waiting connection.
- File not open → md-mini opens a new window for it on the main thread (`window::open_file_window`), polls `OpenFiles` for up to 2s for the new window's label, and queues the command for it. The new window's frontend drains its queue once, on mount, via `ai_pull_pending`. If the window never registers within 2s, the request fails with `"failed to open window for file"`.
- Commands for one file are effectively serialized: only one is in flight per window at a time (the socket thread blocks on the reply channel before returning).

## Launch-if-not-running flow

`scripts/mdmini` handles `show`/`edit` before falling into the normal file-open path:

1. If the command socket already exists (`-S "$CMD_SOCK"`) → skip straight to step 3.
2. Otherwise `open /Applications/md-mini.app` (no pending-files handoff needed — the request itself carries the file) and poll for the socket every 0.1s, up to 5s. Times out with `{"ok":false,"error":"md-mini did not start in time"}`, exit 2.
3. `exec "$BIN" ai "$@"` — hands off to the binary's own CLI client (`run_ai_cli` in `ai_socket.rs`), which does the actual socket round-trip. stdin passes through untouched, so `cat new.md | mdmini edit file.md` still works after the launch wait.

The `ai` subcommand is intercepted in `main.rs` before Tauri initializes anything — `mdmini ai show|edit ...` never starts a second GUI instance.

## Highlight behavior

- **`show`**: scrolls the target into view (`EditorView.scrollIntoView(pos, {y:'center'})`) and adds a `cm-ai-pulse` line decoration that plays a ~1.6s CSS fade (`cm-ai-pulse` keyframes, background from `--ai-edit-bg` to transparent). A timer clears the pulse after 1.6s — but only if no `edit` highlight has been installed in the meantime, so a `show` right before an `edit` doesn't wipe the edit's highlight.
- **`edit`**: the changed span gets a persistent `cm-ai-edit` mark (subtle background, theme-aware via `--ai-edit-bg` in both `light.css` and `dark.css`). It survives further typing nearby — CM6 maps the range through subsequent edits — and is cleared only by:
  - the **next** `edit` command (installs its own range, replacing the old one), or
  - pressing **Esc** in the editor (`aiHighlightKeymap`; a no-op, falling through to other Esc handlers, if there's nothing to clear).
  - Not persisted across app restarts — it's in-memory CM6 state (`aiHighlightField`), not saved with the document.
- Edits go through the same single-span `ChangeSet` + scroll-snapshot mechanism as an external file reload, with `Transaction.addToHistory.of(false)` (doesn't add an undo step). The document-changed listener still fires normally, so the edit still marks the file dirty and schedules the regular autosave — the file on disk catches up like any other in-app edit.

## Using this from an AI agent's CLAUDE.md

Paste this into a project's `CLAUDE.md` if the user has md-mini installed:

```markdown
## md-mini AI interface

If `mdmini` is available, use it to point at things in the user's open editor and to push edits into the live buffer, instead of only writing files to disk:

- `mdmini show <file> --line N` — scroll to line N in the open window and pulse-highlight it.
- `mdmini show <file> --find "some text"` — same, but locate the first match of the text instead of a line number.
- `cat new-content.md | mdmini edit <file> [--show]` — replace the file's live buffer with the **complete** new content read from stdin. md-mini diffs it against what's on screen, applies only the changed span, and highlights it. `--show` also scrolls to the change.

Both verbs print one line of JSON to stdout: `{"ok":true}` (plus `"changed_lines":[[start,end]]` for `edit`) on success, `{"ok":false,"error":"..."}` on failure. Exit code 0 = success, 1 = md-mini rejected the request, 2 = md-mini isn't running or the command was malformed. If the target file isn't already open, `edit`/`show` open a new window for it automatically — the file must already exist on disk. Always send the full document on stdin for `edit`, never a diff.
```

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `{"ok":false,"error":"md-mini is not running"}`, exit 2 | Couldn't connect to the command socket. | Run the command again (the wrapper auto-launches the app); if it recurs, check the app actually started (`ps aux \| grep md-mini`) and that no crash left a stale socket blocking the port — the app rebinds stale sockets automatically on startup, so just relaunch it. |
| `{"ok":false,"error":"md-mini did not start in time"}`, exit 2 | App didn't finish launching within the wrapper's 5s poll. | Launch it manually once (`open /Applications/md-mini.app`) and retry. |
| `{"ok":false,"error":"window does not own this file"}` | The request's `path` doesn't exactly match the path the target window has open (symlink, relative-vs-canonical, or the file is genuinely open in a different window / not open at all and routing raced). | Pass the same absolute, canonicalized path used to open the file; avoid symlinks. |
| `{"ok":false,"error":"target not found"}` (`show`) | `--find` text isn't a substring of the current buffer (exact, case-sensitive match). | Check the text against the file's current content — it may have changed since you last read it. |
| `{"ok":false,"error":"timeout waiting for editor"}` | Socket accepted the request, but the frontend didn't answer within 8s (window frozen or closed mid-request). | Check the app isn't hung; retry. |
| `{"ok":false,"error":"timeout waiting for response"}`, exit 1 | CLI's own 10s wait for any reply line expired. | App likely crashed after accepting the connection; check for a crash and relaunch. |
| `{"ok":false,"error":"failed to open window for file"}` | File wasn't open, and the new window didn't register within 2s. | Verify the file exists and is readable; retry. |
| Command hits the wrong build (dev vs release) | Release and dev builds use different sockets. | Pass `--socket /tmp/md_mini_dev_cmd.sock` explicitly when targeting a dev build. |
