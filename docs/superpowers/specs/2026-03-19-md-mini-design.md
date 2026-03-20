# md-mini — Design Specification

## Overview

Minimalist live-preview markdown editor for macOS. One file = one window. No tabs, no sidebars, no status bars. Clean, focused writing experience.

## Stack

| Layer | Technology |
|-------|-----------|
| Native shell | Tauri 2 (Rust) |
| Frontend framework | Svelte + TypeScript |
| Editor engine | CodeMirror 6 |
| Markdown parser | `@lezer/markdown` (CM6 built-in, incremental) |
| Build | Vite |

## Architecture

```
┌──────────────────────────────────────────────┐
│                 macOS                         │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │           Tauri 2 (Rust)               │  │
│  │                                        │  │
│  │  File I/O ── Window Manager ── CLI     │  │
│  │  (atomic)    (create/close/   (args,   │  │
│  │              cascade)         single-  │  │
│  │                               instance)│  │
│  │  Settings ── Recovery                  │  │
│  │  (store)     (temp files)              │  │
│  └──────────────┬─────────────────────────┘  │
│                 │ IPC (invoke/events)         │
│  ┌──────────────┴─────────────────────────┐  │
│  │        WebView (per window)            │  │
│  │                                        │  │
│  │  Svelte Shell (minimal wrapper)        │  │
│  │  ┌──────────────────────────────────┐  │  │
│  │  │         CodeMirror 6             │  │  │
│  │  │                                  │  │  │
│  │  │  @lezer/markdown (parser)        │  │  │
│  │  │  ViewPlugin (live-preview deco)  │  │  │
│  │  │  Extensions:                     │  │  │
│  │  │   - slash commands (autocomplete)│  │  │
│  │  │   - hover block menu (gutter)    │  │  │
│  │  │   - keybindings                  │  │  │
│  │  │   - list continuation            │  │  │
│  │  │   - bracket/quote pairing        │  │  │
│  │  └──────────────────────────────────┘  │  │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
```

### Data Flow

```
File on disk
    │ Tauri reads (fs::read_to_string)
    ▼
WebView receives via IPC event
    │
    ▼
CodeMirror EditorState (source of truth for document)
    │ User edits
    ▼
onChange → debounce 300ms → Svelte store (dirty flag)
    │
    ▼
Tauri IPC: write_file(path, content)
    │ Rust: write to .tmp, then fs::rename (atomic)
    ▼
File on disk (updated)
```

## Markdown Features (v1)

### Live-Preview Mode (default)

Rendered markdown is shown. When cursor enters a block, the entire block reveals raw markdown syntax. When cursor leaves, it renders again.

**Block-level reveal rule:** cursor entering any line of a multi-line block (code block, table, blockquote) reveals the entire block, not just that line. Single-line elements (headings, paragraphs) reveal at line level.

**Implementation:** `ViewPlugin` iterates `@lezer/markdown` syntax tree for visible range. For each node, creates `Decoration.replace()` or `Decoration.mark()`. Before decorating, checks if cursor is within the block's range — if yes, skips decorations to reveal raw source.

**Code blocks interaction:** code blocks use `Decoration.replace()` with a `WidgetType` that renders syntax-highlighted `<pre>`. Since CM6 widgets are atomic (arrow keys skip over them), clicking the widget or pressing Enter/arrow into it triggers the block reveal — the widget is removed and raw fenced code block is shown for editing. Cursor leaving the block re-renders the widget.

**Supported elements in live-preview:**

| Element | Decoration type |
|---------|----------------|
| Headings (h1-h6) | `Decoration.mark()` with size class + `Decoration.replace()` to hide `#` markers |
| Bold | `Decoration.mark()` with bold class + hide `**` markers |
| Italic | `Decoration.mark()` with italic class + hide `*` markers |
| Strikethrough | `Decoration.mark()` with strikethrough class + hide `~~` markers |
| Bullet lists | `Decoration.replace()` marker with styled bullet dot |
| Numbered lists | `Decoration.mark()` with styling |
| Nested lists | Indentation preserved via CSS |
| Checkboxes | `Decoration.widget()` with `<input type="checkbox">`, click toggles `[ ]`/`[x]` in source |
| Code blocks | `Decoration.widget()` rendering syntax-highlighted `<pre>` block. Languages via `@codemirror/language-data` |
| Inline code | `Decoration.mark()` with monospace background + hide backticks |
| Links | Hide URL part, show text styled as link |
| Blockquotes | `Decoration.mark()` with left border style + hide `>` marker |
| Horizontal rules | `Decoration.widget()` rendering `<hr>` |
| Tables | `Decoration.widget()` rendering HTML `<table>` (read-only in live-preview) |

### Raw Mode

Toggle via View menu + `Cmd+E`. Plain CodeMirror with markdown syntax highlighting. No decorations. Tables are editable as raw markdown text.

### Tables — v1 Behavior

- **Live-preview mode:** table rendered as read-only HTML `<table>`. Click on table → cursor enters → raw markdown revealed for editing.
- **Raw mode:** standard markdown table editing.
- **v2:** interactive table editing with add row/column buttons on table edges.

## UI / Interaction

### Window Chrome

- **Title bar:** native macOS. Shows `filename.md` or `Untitled`. Dot indicator when unsaved. macOS proxy icon (draggable file icon).
- **No toolbar, no sidebar, no status bar.** Just the editor.
- **App menu (top-left):**
  - File: New, Open, Save, Save As, Recent Files
  - Edit: Undo, Redo, Cut, Copy, Paste, Find & Replace
  - View: Toggle Raw Markdown (`Cmd+E`), Zoom In/Out
  - Theme: Light, Dark, System (radio selection)

### Slash Commands

Type `/` at the start of a block (column 0, or after list indentation like `  - /`) → autocomplete dropdown appears with block types:

- `/heading1` through `/heading6`
- `/bullet` — bullet list
- `/numbered` — numbered list
- `/checkbox` — checkbox list item
- `/code` — fenced code block
- `/table` — insert table template
- `/quote` — blockquote
- `/hr` — horizontal rule

Built on `@codemirror/autocomplete`.

### Hover Block Menu

On mouse hover, a `+` button appears in the left gutter. Click → same dropdown as slash commands. Built on CM6 `gutter()` extension + `@floating-ui/dom` for popup positioning.

Appears only on hover, no drag handles. Minimal.

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+B` | Toggle bold |
| `Cmd+I` | Toggle italic |
| `Cmd+Shift+X` | Toggle strikethrough |
| `Cmd+E` | Toggle raw/live-preview mode |
| `Cmd+S` | Save (immediate, bypasses debounce) |
| `Cmd+Shift+S` | Save As |
| `Cmd+N` | New window (empty document) |
| `Cmd+O` | Open file |
| `Cmd+W` | Close window |
| `Cmd+F` | Find & Replace |
| `Cmd+Z` / `Cmd+Shift+Z` | Undo / Redo |
| `Cmd+Plus` / `Cmd+Minus` | Zoom in / out |
| `Tab` / `Shift+Tab` | Indent / outdent in lists |

### Auto-Complete Behaviors

- **List continuation:** Enter at end of list item → new list item. Enter on empty list item → exit list.
- **Checkbox continuation:** Enter after `- [ ] item` → new `- [ ] `
- **Numbered list continuation:** auto-increment number
- **Bracket pairing:** `(`, `[`, `{` auto-close
- **Quote pairing:** `"`, `` ` `` auto-close
- **Code fence:** typing ` ``` ` + Enter → creates closing ` ``` ` and puts cursor in between

## Themes

### Dark Theme — Rose Pine

```
Base:       #191724
Surface:    #1f1d2e
Text:       #e0def4
Subtle:     #908caa
Muted:      #6e6a86
Highlight:  #403d52
Heading:    #c4a7e7 (iris)
Bold:       #ebbcba (rose)
Italic:     #f6c177 (gold)
Link:       #9ccfd8 (foam)
Code bg:    #1f1d2e
Code text:  #e0def4
Selection:  #403d52
```

Font: Inter (UI/text), JetBrains Mono (code)

### Light Theme — iA Writer Style

```
Base:       #fafaf9
Surface:    #f5f5f4
Text:       #1c1917
Subtle:     #78716c
Muted:      #a8a29e
Highlight:  #e7e5e4
Heading:    #292524
Bold:       #1c1917
Italic:     #44403c
Link:       #2563eb
Code bg:    #f5f5f4
Code text:  #1c1917
Selection:  #dbeafe
```

Font: Merriweather (text), JetBrains Mono (code)

### System Detection

CSS `prefers-color-scheme` media query + `matchMedia` listener. User preference stored in `localStorage`. Options: Light / Dark / System.

When switching themes, font family also changes (Inter ↔ Merriweather). This is intentional — the two themes have distinct personalities (modern dark vs literary light). System auto-switching will also switch fonts.

## Multi-Window & CLI

### Single-Instance Pattern

Uses `tauri-plugin-single-instance`:

1. First launch → app starts normally
2. Subsequent `md-mini file.md` → detects running instance → sends file path via IPC → exits
3. Running instance receives path → opens new window

### Window Management

- Each window: 900x700 default size
- Multiple windows cascade with ~25px offset
- Each window has isolated WebView + CodeMirror instance
- No shared state between windows (each manages its own file)
- Opening an already-open file → focus existing window instead of duplicating

### CLI Behavior

```
md-mini                    → new empty document (Untitled)
md-mini file.md            → open file in new window
md-mini *.md               → shell expands glob, each file opens in separate window
md-mini /path/to/file.md   → absolute path support
```

Implemented via `tauri-plugin-cli` with positional args (`multiple: true`).

macOS file associations (double-click .md in Finder) handled via `tauri::RunEvent::Opened`.

## File Handling

### Save Strategy

- **Auto-save:** debounced, 300ms after last keystroke. Also triggers on window blur. **Auto-save is skipped for untitled (unsaved) documents** — they only save via explicit `Cmd+S`.
- **Manual save:** `Cmd+S` — immediate, bypasses debounce. On untitled → Save As dialog.
- **Atomic writes:** Rust writes to `{filename}.tmp`, then `fs::rename`. Prevents corruption on crash.
- **Title bar:** dot indicator when unsaved changes exist.

### Error Handling

- **File deleted externally while open:** on next save attempt, show Save As dialog. Don't silently fail.
- **Disk full / write permissions error:** show native macOS alert with error message. Keep document in memory, don't lose content.
- **Invalid UTF-8 file:** show alert "Cannot open: file is not valid text." Refuse to open.
- **Recovery dir not writable:** silently disable crash recovery. Not critical enough to block editing.

### External File Changes

Use `notify` crate (Rust) to watch the open file. On external modification:
- If document has no unsaved changes → silently reload.
- If document has unsaved changes → show alert: "File was modified externally. Reload and lose changes, or keep your version?"

### Crash Recovery

- Every 5s (if dirty), write recovery copy to `~/Library/Application Support/md-mini/recovery/{hash}.md`
- Recovery file includes header comment: original path + timestamp
- On clean save or window close → delete recovery file
- On app launch → check for orphaned recovery files → prompt to recover

### Drag & Drop

Drop `.md` file onto window → open in new window. Drop onto dock icon → same behavior.

## Font Bundling

All four fonts bundled as woff2 in Tauri assets (~2-3MB total):

- Inter (Regular, Bold, Italic, Bold Italic)
- Merriweather (Regular, Bold, Italic, Bold Italic)
- JetBrains Mono (Regular, Bold)

Include Cyrillic subsets.

## Key Libraries

| Purpose | Package |
|---------|---------|
| Editor core | `@codemirror/view`, `@codemirror/state` |
| Markdown | `@codemirror/lang-markdown`, `@lezer/markdown` |
| Autocomplete (slash) | `@codemirror/autocomplete` |
| Search | `@codemirror/search` |
| Language highlighting | `@codemirror/language-data` (lazy-loaded per language) |
| Popup positioning | `@floating-ui/dom` |
| Multi-window | `tauri-plugin-single-instance` |
| CLI args | `tauri-plugin-cli` |
| Settings | `localStorage` (theme, zoom, recent files) |
| File watching | `notify` crate (Rust-side) |

## Open-Source References

- **Zettlr** — CM6 live-preview architecture, decoration plugins per element type
- **ink-mde** — lightweight CM6 markdown editor, clean implementation
- **Milkdown** — slash command and block menu UX patterns

## Settings (localStorage)

All settings stored in `localStorage`, shared across windows (same WebView origin in Tauri).

| Setting | Values | Default |
|---------|--------|---------|
| `theme` | `"light"` / `"dark"` / `"system"` | `"system"` |
| `mode` | `"live-preview"` / `"raw"` | `"live-preview"` |
| `zoomLevel` | `0.8` to `2.0`, step `0.1` | `1.0` |
| `recentFiles` | JSON array of `{path, timestamp}`, max 10 entries | `[]` |

**Recent files:** maintained on file open/save. Stale entries (file no longer exists) are filtered out when menu is rendered. Stored as absolute paths.

**Zoom:** applied as CSS `font-size` scaling on the editor container. Global (not per-window). Persists across sessions.

**Find & Replace:** uses `@codemirror/search` default panel (appears at top of editor). No custom UI — CM6's built-in search is clean enough for v1.

## Out of Scope (v1)

- Image rendering in live-preview
- Export to PDF/HTML
- Spell check
- File tree / sidebar / tabs
- Word/character count
- Interactive table editing (add row/column buttons)
- Vim/Emacs keybindings
- Plugin system
- Sync / collaboration
