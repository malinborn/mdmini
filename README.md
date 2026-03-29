# md-mini

A minimalist live-preview markdown editor for macOS. You edit raw markdown and see it rendered inline — no split panes, no mode switching. Built with Tauri 2, Svelte 5, and CodeMirror 6.

![md-mini screenshot placeholder](docs/screenshot.png)

## Features

**Editor**
- Live preview inline with the cursor — formatting marks hide when the cursor moves away
- GFM support: strikethrough `~~text~~`, tables, checkboxes `- [ ]`
- Slash commands (`/`) to insert headings, lists, code blocks, tables, and more
- Hover block menu (`+` in the gutter) for inserting elements without typing
- Auto-save on every keystroke with crash recovery via temp files
- Find & replace with Cmd+F
- Zoom in/out with Cmd+`+`/`-`

**Tables**
- Rendered as interactive widgets — columns aligned, inline bold/italic/code rendered
- Double-click any cell to edit via floating input overlay
- Drag-and-drop row and column reorder
- Hover `+` / `−` buttons to add or delete rows and columns

**App**
- macOS native window with native menu bar
- Light and dark themes (gradient table headers)
- Multi-window support with cascading positions, one file per window
- Single-instance: opening a file when the app is running opens it in a new window
- Recent files panel
- CLI integration: `mdmini file.md` from the terminal

## Prerequisites

- macOS 12 or later
- [Node.js](https://nodejs.org) 20+
- [Rust](https://rustup.rs) (stable toolchain)
- Xcode Command Line Tools: `xcode-select --install`

## Installation

### Download

Download the latest `.dmg` from [Releases](../../releases), open it, and drag `md-mini.app` to `/Applications`.

### CLI integration

After installing the app, install the `mdmini` shell wrapper:

```bash
sudo cp scripts/mdmini /usr/local/bin/mdmini
sudo chmod +x /usr/local/bin/mdmini
```

The wrapper must be copied, not symlinked. A symlink to the binary blocks the terminal — the wrapper handles macOS GUI app launch constraints correctly.

## CLI Usage

```bash
mdmini                    # Open an empty editor
mdmini README.md          # Open a file
mdmini file1.md file2.md  # Open multiple files in separate windows
```

If the app is not running, it launches and opens the file. If it is already running, the file opens in a new window instantly.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd+B | Bold |
| Cmd+I | Italic |
| Cmd+X | Strikethrough |
| Cmd+E | Toggle raw mode (full markdown, no preview) |
| Cmd+F | Find & replace |
| Cmd+N | New window |
| Cmd+O | Open file |
| Cmd+S | Save |
| Cmd+W | Close window |
| Cmd+`+` / Cmd+`-` | Zoom in / out |
| Cmd+`0` | Reset zoom |
| `/` | Slash command menu |

## Configuration

No configuration files. Theme (light/dark) and zoom level are stored in the app and persist across sessions.

## Development

Install dependencies and start the dev server:

```bash
npm install
npm run tauri dev
```

If the dev server fails to start, a previous session may have left port 1420 open:

```bash
lsof -ti:1420 | xargs kill -9
npm run tauri dev
```

### Build

```bash
npm run tauri build
# Output: src-tauri/target/release/bundle/macos/md-mini.app
#         src-tauri/target/release/bundle/dmg/md-mini_*.dmg
```

### Tests

```bash
npm run test                                        # Frontend (Vitest)
cd src-tauri && cargo test                          # Rust unit tests
cargo clippy --manifest-path src-tauri/Cargo.toml  # Rust linter
npm run check                                       # Svelte type checking
```

### Project structure

```
src-tauri/src/        Rust backend (Tauri 2)
  commands.rs         IPC: read_file, write_file, file_exists
  menu.rs             macOS native menu
  window.rs           Window creation and deduplication
  recovery.rs         Crash recovery via temp files
  watcher.rs          File watcher

src/
  App.svelte          Root component, event wiring
  lib/editor/         CodeMirror 6 editor
    setup.ts          All CM6 extensions assembled here
    keybindings.ts    Cmd+B/I/X formatting
    autocomplete.ts   List continuation, bracket pairs, code fence close
    slash-commands.ts Slash command block insertion
    hover-menu.ts     Gutter + menu
    preview/          Live-preview decorations (one file per element type)
  lib/stores.svelte.ts  App state (file, theme, mode, zoom, recent files)
  lib/tauri/          Tauri IPC wrappers
  styles/             Global CSS and editor decoration styles
  assets/fonts/       Bundled Inter, Merriweather, JetBrains Mono (woff2)
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Native shell | [Tauri 2](https://v2.tauri.app) |
| Frontend | [Svelte 5](https://svelte.dev) with runes |
| Editor | [CodeMirror 6](https://codemirror.net) |
| Markdown parser | `@lezer/markdown` with GFM extensions |
| Build | Vite |
