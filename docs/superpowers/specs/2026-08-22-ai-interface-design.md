# md-mini AI Interface — Design Specification

## Overview

A CLI-based interface that lets AI agents (Claude Code and similar) drive the running md-mini directly instead of writing to files on disk. MVP covers two verbs: **show** (open/focus a document, scroll to a location, pulse-highlight it — "look here") and **edit** (apply new content to the live buffer with the changed spans highlighted as the latest AI edit).

Nothing extra to run: the interface is the existing `mdmini` CLI plus a small command socket served by the already-running app. No daemons, no ports, no MCP registration required.

## Goals

- An AI agent can point the user at a specific place in a document.
- An AI agent can edit an open document through md-mini; the user immediately sees *what* changed via highlights.
- Editing through md-mini (instead of the file on disk) removes the watcher/autosave reload path and its race conditions entirely for AI-driven edits.
- Zero setup for the agent: a paragraph in CLAUDE.md describing the CLI verbs is enough.

## Non-Goals (backlog, not MVP)

- `mdmini ask` — interactive choice buttons rendered in md-mini, answer returned to the agent.
- `mdmini mcp` — a stdio MCP server wrapping the same socket protocol (one socket command = one future MCP tool; the protocol is designed so this wrapper needs no changes underneath).
- Review/accept workflow (per-hunk confirmation) — the highlight is informational only in MVP.

## CLI Surface

| Command | Behavior |
|---------|----------|
| `mdmini show <file> [--line N \| --find "text"]` | Open the file (or focus its existing window via the `OpenFiles` dedup registry), scroll the target into view, pulse a temporary highlight on the target line. `--find` locates the first occurrence of the text; `--line` takes a 1-based line number. Without either, just open/focus. |
| `mdmini edit <file> [--show]` | Read the complete new document content from **stdin**. The app computes a minimal diff against the live buffer (`computeReplacement`), applies only the changed spans, and highlights them as the current AI edit. `--show` additionally scrolls the first changed span into view. If the file is not open, it is opened first (through the normal open path), then the edit is applied. |

Output contract (for machine parsing):

- stdout: single-line JSON. `show` → `{"ok": true}`. `edit` → `{"ok": true, "changed_lines": [[12, 15], [40, 40]]}` (1-based inclusive line ranges after the edit; empty array when content was identical).
- Errors: `{"ok": false, "error": "<message>"}` on stdout, non-zero exit code.
- Timeout: the CLI waits up to 10s for a response, then fails.

## Transport

The existing single-instance socket is one-way (launch args only, no reply channel), so it stays as-is for app launch. Commands go over a new **command socket**:

- Unix domain socket, JSON-lines protocol: one request object per line, one response object per line.
- Path derives from the product name via `paths` (same dev/release isolation rule as app data): release `/tmp/md_mini_cmd.sock`, dev build `/tmp/md_mini_dev_cmd.sock`. Created with `0600` permissions, removed on clean exit; a stale socket is unlinked and re-bound on startup.
- Served by a small Rust listener inside the running app (spawned in `setup`, alongside the single-instance plugin). Requests are dispatched to the window that owns the file (via `OpenFiles`) as Tauri events; the frontend answers with an `invoke` carrying a request id, which the listener correlates back to the waiting connection.

Launch-if-not-running (CLI side, mirrors the existing launcher logic in `scripts/mdmini`):

1. If the command socket exists and accepts the connection — send the command.
2. Otherwise launch the app via `open` (existing path), poll for the socket (up to ~5s), then send.

Request/response shapes (versioned for the future MCP wrapper):

```json
{"v": 1, "cmd": "show", "path": "/abs/file.md", "line": 42, "find": null}
{"v": 1, "cmd": "edit", "path": "/abs/file.md", "content": "<full new document>", "show": false}
```

## Frontend

Two new Tauri events handled in `App.svelte`:

- `ai-show` → resolve the target position (line or text search), dispatch `EditorView.scrollIntoView(pos, {y: "center"})` plus a short-lived pulse decoration (CSS animation, self-clearing).
- `ai-edit` → reuse the external-reload machinery: `computeReplacement` against the live doc, single-span dispatch with the scroll snapshot mapped through the ChangeSet (as in `updateContent`). The changed span feeds a new **AI-highlight StateField**:
  - Decoration: subtle background on the changed ranges (theme variable, light/dark aware).
  - Ranges are mapped through subsequent user edits (`value.map(tr.changes)`), so the highlight survives typing nearby.
  - Lifetime: cleared by the next `ai-edit` command (which installs its own ranges) or by Esc. Not persisted across restarts.

Edits apply to the **live buffer**; autosave persists them to disk as usual. The `isSaving` suppression already prevents the app's own write from bouncing back through the watcher. Because the AI edit never touches the file directly, the dirty-file conflict dialog never triggers for this path.

Concurrency: commands for one file are serialized by the socket listener (one in-flight command per window); a second command queues behind the first.

## Error Handling

- Unknown/unreadable path on `show` → open fails, error JSON returned.
- `edit` for a file md-mini cannot open (permissions, binary) → error JSON, buffer untouched.
- Window closed between dispatch and response → listener times out that request (5s) and returns an error.
- Malformed request line → error response, connection stays usable.

## Testing

- `computeReplacement` span → line-range conversion, highlight range mapping through edits: Vitest (CM6 `EditorState` in-memory, per repo pattern).
- Socket listener: `cargo test` — protocol parsing, request/response correlation, stale-socket rebinding.
- CLI verbs: shell-level test against a dev build (`npm run dev:app`), manual visual verification of pulse and highlight.

## Security Notes

Local tool context (PoC bar per CLAUDE.md): the socket is user-local with `0600` permissions; no network exposure. The `edit` command can only modify documents the user's own processes could already write. No authentication in MVP; revisit if the protocol ever leaves the machine.
