# md-mini Feature Showcase

Welcome to md-mini — a minimalist live-preview markdown editor. This file demonstrates the main features. Try hovering, clicking, and editing!

## Text Formatting

Regular text with **bold**, *italic*, ~~strikethrough~~, and `inline code`. You can also combine ***bold italic*** together.

Links render inline: [md-mini on GitHub](https://github.com) — click to open in browser.

## Headings Fold

Each heading has a fold toggle. Hover the left edge of any heading — a ▾ appears. Click it to collapse the section. Try it on this heading!

### Nested Section

This content collapses when you fold "Headings Fold" above.

## Checklists

- [x] Live-preview decorations
- [x] Table editing with drag & drop
- [x] Collapsible headings
- [x] Syntax-highlighted code blocks
- [x] .env file support with secret masking
- [ ] Export to PDF
- [ ] Plugin system

Click any checkbox to toggle it.

## Tables

Tables render with aligned columns, zebra striping, and full CRUD controls. Hover to see the buttons.

| Feature           | Status | Notes                               |
| ----------------- | ------ | ----------------------------------- |
| Cell editing      | Done   | Double-click any cell               |
| Add row/column    | Done   | Hover for + buttons                 |
| Delete row/column | Done   | Hover for − buttons                 |
| Drag reorder      | Done   | Drag ⠿ handles                      |
| Inline formatting | Done   | `code`, **bold**, *italic* in cells |

## Code Blocks

Syntax highlighting for 100+ languages. Each block gets a language label and Copy button.

```javascript
function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

console.log(fibonacci(10)); // 55
```

```python
from dataclasses import dataclass

@dataclass
class Config:
    host: str = "localhost"
    port: int = 8080
    debug: bool = False

config = Config(debug=True)
print(f"Server at {config.host}:{config.port}")
```

```rust
fn main() {
    let words = vec!["hello", "world"];
    let result: String = words.join(", ");
    println!("{result}");
}
```

## Blockquotes

> md-mini is built with Tauri 2, Svelte 5, and CodeMirror 6.
> It's fast, lightweight, and runs natively on macOS.

## Lists

Bullet lists:
- First item
- Second item with `code`
- Third item with **bold**

Numbered lists:
1. Open a file: `mdmini README.md`
2. Edit with live preview
3. Auto-saves every 300ms

## Horizontal Rules

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+B` | Toggle **bold** |
| `Cmd+I` | Toggle *italic* |
| `Cmd+E` | Toggle raw markdown view |
| `Cmd+F` | Find & Replace |
| `Cmd+S` | Save |
| `Cmd+N` | New window |
| `Cmd+W` | Close window |

## What's Next

Try opening a `.env` file — secrets are automatically masked. Or open a `.py` / `.rs` file for pure code viewing with syntax highlighting.

Type `/` on an empty line for slash commands — insert headings, tables, code blocks, and more.
