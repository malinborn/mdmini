# Session Restore — Design

**Date:** 2026-07-25
**Status:** Approved

## Problem

Upgrading via `brew upgrade --cask mdmini` closes every window and they never come
back. The cask runs `uninstall quit: "com.md-mini.app"`, Homebrew replaces the
bundle, and nothing relaunches the app. Nothing about the previous session
survives, because:

- `OpenFiles` (`window.rs:10`) is a `Mutex<HashMap<path, label>>` held only in
  memory.
- `untrack_window` (`window.rs:120`) runs on every `Destroyed` event and also
  deletes the crash-recovery file for that path, so a clean exit leaves no trace
  at all.

## Goal

Remember which windows were open and offer to bring them back — with their
geometry, their cursor and scroll position, and the contents of unsaved Untitled
windows.

## Non-Goals

- Automatic restore on launch. Restore is explicit: `⇧⌘T` or a File menu item.
- Wiring `tauri-plugin-updater`. The existing GitHub-API version check in
  `src/lib/updater.ts` stays as it is.
- Merging with `recovery.rs`. Crash recovery and session restore have different
  triggers and lifetimes; they stay separate mechanisms.

## Storage

`~/Library/Application Support/md-mini/session.json`, beside the existing
`recovery/` directory:

```json
{ "version": 1, "savedAt": 1784995000,
  "windows": [
    { "path": "/Users/max/notes.md", "untitled": null,
      "x": 100, "y": 100, "width": 900, "height": 700,
      "cursor": 1234, "topLine": 87 },
    { "path": null, "untitled": "untitled-editor-2.md",
      "x": 130, "y": 130, "width": 900, "height": 700,
      "cursor": 42, "topLine": 1 }
  ] }
```

Unsaved buffers are **not** inlined into the JSON — they live in
`~/Library/Application Support/md-mini/session/untitled-<label>.md` and the
snapshot references the filename. A single large draft would otherwise bloat a
file that has to stay small and quick to parse at startup.

Scroll is stored as a **line number**, not pixels: pixel offsets lie after a font
or zoom change. The cursor is a document offset. Both are clamped on restore
(`min(cursor, doc.length)`, `min(topLine, doc.lines)`) because the file may have
changed on disk while the app was closed.

## When the Session Is Written

The live session is held in Rust (`SessionState`) and written to disk from two
places:

- **A ticker thread**, every 500 ms, if the state is dirty and has settled for
  1 s. This is the crash-safety net.
- **Immediately on the way out**, which is the authoritative save and the one the
  upgrade path depends on.

  > **Correction, found during implementation.** This section originally named
  > `RunEvent::ExitRequested` as the single hook. That is wrong for the very path
  > this feature exists for. `tauri-runtime-wry` emits `ExitRequested` only from
  > `Message::RequestExit` (`app.exit()`) and from the `Destroyed` arm once the
  > last window is gone. Cmd+Q and the `quit` AppleEvent that Homebrew sends both
  > go through `NSApp terminate:` → `applicationWillTerminate` → tao
  > `LoopDestroyed` → **`RunEvent::Exit`**. Measured against a real bundle, the
  > AppleEvent quit produced `Exit` only — no `ExitRequested`, and no `Destroyed`
  > either. Both events are therefore handled, via `save_session_on_exit`.

Sources of updates: `WindowEvent::Moved` / `Resized` for geometry, and an IPC
command from the frontend for cursor, scroll line and Untitled content (driven
by the 5 s recovery interval that already exists in `App.svelte:201`).

### The Trap: Quitting Destroys Every Window

`untrack_window` removes a window from tracking on `Destroyed`. During a quit
that fires for *every* window, so a naive implementation writes an empty session
at exactly the moment it matters — the feature would appear to simply not work.

Two independent barriers:

1. A `quitting` flag, set on the way out before any window is destroyed. While it
   is set, `SessionState::remove` is a no-op. (In practice the macOS terminate
   path does not emit `Destroyed` at all, so this barrier is insurance rather
   than load-bearing — but the close-last-window path does emit it.)
2. The write debounce itself. A quit destroys all windows within milliseconds, so
   a pending ticker write never lands and the on-disk state survives regardless.

A deliberate consequence: closing a window and quitting within a second brings
that window back, while closing it and continuing to work does not. Closing a
window is an intentional act; being interrupted by an upgrade is not.

## How Restore Works

At startup `session.json` is read into `pending_restore` in memory, and the live
session starts empty — so the first write of the new run supersedes the file.
This makes the offer self-expiring: it describes the previous run only, and never
nags with the same stale list on every launch.

- `⇧⌘T`, and `File → Reopen Last Session`, disabled when there is nothing to
  restore. The menu is built after the session is loaded so the item's enabled
  state is correct.
- The menu event is handled in Rust (like `new`), since it creates windows. It
  then emits `session-restored` so open windows can drop the toast.
- Restore goes through the existing `open_file_window` path, so its file dedup
  applies for free: a file that is already open (`mdmini notes.md` for a file
  that was also in the session) gets focused rather than duplicated.
- `PendingFiles` currently maps label → path. Its value becomes a struct so it
  can carry content, cursor and scroll line to the frontend on mount.

## The Toast Stack

There **is** already an in-app notification: `src/lib/updater.ts` builds a
`.md-update-banner` element imperatively and appends it to `document.body`, fixed
at `bottom: 16px; right: 16px` (`global.css:123`). That is exactly where the
session toast belongs, so the two would overlap.

Rather than run two positioning mechanisms, the update banner is ported into a
shared stack:

```
                    ┌──────────────────────────┐
                    │ mdmini v0.5.0 available  │
                    │ brew update && …       ✕ │
                    └──────────────────────────┘
                              ↕ gap: 8px
                    ┌──────────────────────────┐
                    │ 5 windows from your      │
                    │ last session · ⇧⌘T     ✕ │
                    └──────────────────────────┘
```

- `ToastStack.svelte` renders from a store; `display: flex; flex-direction:
  column; gap: 8px` gives the separation between cards rather than a joined slab.
- Ordering is explicit, not insertion-based: update sits above session. The
  update check only fires 15 s after launch, so insertion order would otherwise
  put them the wrong way round.
- Each toast persists until its `✕` is clicked. Nothing auto-dismisses.
- `updater.ts` keeps its version-comparison logic and loses its DOM building; it
  gains a callback so `App.svelte` decides what to render. This preserves the
  existing store factory pattern instead of introducing a module singleton.
- The session toast is shown only in the window that exists at launch
  (`label === 'main'`); showing it in every window would be noise.

## Testing

Rust unit tests in `session.rs`: JSON round-trip with camelCase keys, `remove`
being a no-op while quitting, deterministic window ordering (`main` before
`editor-2` before `editor-10`), pruning snapshots whose file has disappeared
while keeping Untitled ones, and normalizing a `topLine` of 0.

Vitest: the toast store (push, dismiss by id, dismiss by kind, update-above-
session ordering, unique ids) and the pure clamp helper for cursor/scroll.

Window restore itself is verified by hand in the running app through the MCP
bridge, including a quit driven by an AppleEvent — the same kind Homebrew sends.

## Note on Pre-Existing Type Errors

`npm run check` currently reports two errors in `App.svelte:242` and `:265`:
`select_all` and `toggle_line_glow` are handled but missing from the `MenuAction`
union in `src/lib/tauri/events.ts`. They are fixed first, so that a clean
typecheck is a usable signal during implementation.
