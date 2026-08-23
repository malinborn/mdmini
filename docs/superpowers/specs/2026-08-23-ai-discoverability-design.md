# AI Interface Discoverability — Design

**Date:** 2026-08-23
**Status:** Approved, ready for implementation

## Problem

md-mini 1.0 shipped the AI interface (`show` / `edit` / `ask`, CLI + MCP). Users report they
don't know the feature exists. The existing surfaces are both passive and one-shot:

- `welcome.md` opens once per version (`onboarding.rs`, marker `onboarding-version`) and is
  then gone — closed, forgotten, unrecoverable except by deleting the marker.
- The **AI** menu holds all four docs, but you have to already suspect it's there to look.

The confirmed failure mode is pure visibility: people don't know the feature exists at all.
A secondary failure follows from it and matters more in the long run — someone who *does*
set it up once, forgets, and needs it again a month later has no path back, because every
surface we have is one-shot.

## Design principle

Every surface must **name the place the feature permanently lives** — "the **AI** menu →
**Getting Started**" — even when the user never clicks. Retention comes from repeating one
name in three places, not from the length of any single document.

## Surfaces

### 1. Startup toast (`kind: 'ai-nudge'`)

Rendered by the existing `ToastStack`, only in the `main` window at launch — same rule the
session toast already follows, because showing it in every window is noise.

```
╭──────────────────────────────────────────────╮
│ Your AI can drive md-mini  ·  see the AI menu│
│ [ Getting Started ]                        ✕ │
╰──────────────────────────────────────────────╯
```

The menu name is in the body text, not only on the button, so a dismissed toast still
delivers the one fact that matters. Does not auto-dismiss — consistent with every other
toast in the app.

### 2. "Getting Started" document + menu anchor

A new bundled doc, opened by the toast's CTA **and** installed as the first item of the
**AI** menu. The same name appears in the toast, the document's `<h1>`, and the menu item;
that repetition is the retention mechanism.

Its lead block is a map of the menu, not a setup instruction:

```
AI
├── Getting Started        ← this document
├── Connect AI via CLI     ← snippet to paste into CLAUDE.md / AGENTS.md
├── Connect AI via MCP     ← one command for Claude Code
├── Teach your AI md-mini  ← how your agent should use it well
└── AI Playbook            ← what to actually do with it
```

The AI menu becomes:

| Item | Note |
|------|------|
| Getting Started | **new**, first |
| *(separator)* | **new** |
| Connect AI via CLI | unchanged |
| Connect AI via MCP | unchanged |
| Teach your AI md-mini | unchanged |
| *(separator)* | unchanged |
| AI Playbook | unchanged |

The rest of the document: connect in a minute (MCP one-liner / `mdmini agent`), a one-sentence
way to verify it works, the show/edit/ask table, and the Esc / Cmd+Z notes.

The same menu-map block is added to `welcome.md`. First-run users see the welcome window, and
they are exactly the population that later forgets where this lives.

### 3. First-AI-action toast (`kind: 'ai-first-use'`)

Shown in the window that receives the very first AI command this install ever handles — the
moment of peak attention, and the only surface that reaches users whose agent config arrived
pre-made from a colleague.

```
╭──────────────────────────────────────────────╮
│ That was your AI · md-mini is connected      │
│ More in the AI menu → Getting Started      ✕ │
╰──────────────────────────────────────────────╯
```

## State

Two files in `paths::app_data_dir()`, alongside `onboarding-version` (so a dev build is
naturally isolated from a release install — see `paths.rs`):

| File | Contents |
|------|----------|
| `ai-connected` | App version at the moment of the first successful command-socket request. Written exactly once. |
| `ai-nudge.json` | `{"shown": N, "last_shown": <epoch secs>, "dismissed": bool}` |

### Startup toast rules

Show when **all** hold:

- `ai-connected` does not exist (never connected)
- `dismissed` is false
- `shown < 3`
- `now - last_shown >= 24h`
- the welcome window was **not** opened on this launch (otherwise we duplicate ourselves)

Returning true increments `shown` and stamps `last_shown`. Clicking the CTA or the ✕ sets
`dismissed: true` — permanent. Nothing revives it.

### First-use detection

Writing `ai-connected` and raising the first-use toast are **one event**. The command-socket
dispatcher does a check-and-set on the marker; when the transition actually happens, it sets
`first_use: true` on the emitted `ai-command` payload. The frontend raises the toast on seeing
the flag. Because the flag rides the payload, it works identically for a command emitted to a
live window and for one drained from the queue by a freshly opened window via `ai_pull_pending`.

Check-and-set must be idempotent: exactly one command in the lifetime of an install may carry
`first_use: true`.

## Files

| File | Change |
|------|--------|
| `src-tauri/getting-started-ai.md` | new bundled doc |
| `src-tauri/welcome.md` | add the menu-map block |
| `src-tauri/src/onboarding.rs` | `getting_started_doc()`; `NudgeState`; pure `should_nudge(...)`; read/write both markers |
| `src-tauri/src/menu.rs` | `ai_getting_started` item + separator, first in the AI submenu |
| `src-tauri/src/lib.rs` | menu handler; register `ai_nudge_pending` / `ai_nudge_dismiss` commands |
| `src-tauri/src/ai_socket.rs` | check-and-set `ai-connected`, `first_use` flag on the payload |
| `src/lib/toasts.svelte.ts` | kinds `ai-nudge` / `ai-first-use`; `ORDER`: update 0, session 1, ai 2 |
| `src/lib/ToastStack.svelte` | render both new toasts |
| `src/App.svelte` | wire startup nudge (main window only) and first-use flag |

## Testing

Rust:

- `should_nudge` across every branch: already connected, `dismissed`, `shown >= 3`,
  inside the 24h window, welcome shown this launch, and the happy path
- `ai-nudge.json` round-trip, including a missing/corrupt file reading as defaults
- check-and-set idempotence: `first_use` true exactly once, false on every later call

Frontend:

- toast-store ordering with the new kinds
- `ToastStack` renders each new toast's text and CTA

## Non-goals

- No persistent corner badge, no empty-state block — the app is minimalist and the chosen
  volume is "a toast at startup".
- No running `claude mcp add` on the user's behalf.
- No telemetry.
- No revival of a dismissed nudge on version bump. Possible later; deliberately out of scope.
