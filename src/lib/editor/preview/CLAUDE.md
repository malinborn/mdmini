# Preview Decorations — Developer Guide

This directory implements CM6 live-preview decorations for markdown elements.

## Architecture

Each file handles one category of markdown elements. All are called from `plugin.ts` which walks the Lezer syntax tree and dispatches to the appropriate decorator.

| File | Elements | Decoration Types |
|------|----------|-----------------|
| `headings.ts` | `# H1` through `###### H6` | Line + replace (hides `#` marks) |
| `inline.ts` | Bold, italic, strikethrough, code, links | Mark + replace |
| `lists.ts` | Bullets, checkboxes, blockquotes | Replace (widget) + line |
| `blocks.ts` | Code blocks, horizontal rules | Line decorations |
| `tables.ts` | GFM tables | Line + replace (single TableWidget on header line, other lines hidden) |
| `utils.ts` | `cursorInRange()` helper | — |

## Critical Rules

### Decoration Ordering (RangeSetBuilder)

CM6 `RangeSetBuilder` **crashes** if decorations are not in `(from, startSide)` order:

1. `Decoration.line()` — added at `line.from`, has implicit low startSide
2. `Decoration.mark()` — has lower startSide than replace at same position
3. `Decoration.replace()` — has higher startSide

At the same `from` position: **line → mark → replace**.

### No Cross-Line Replace

`Decoration.replace()` spanning across `\n` causes rendering glitches. Use `Decoration.line()` for multi-line visual effects.

### No `block: true` from Plugins

CM6 does not allow `block: true` on decorations from ViewPlugins. Use `Decoration.line({ class: ... })` + CSS pseudo-elements instead.

## Tables (`tables.ts`) — Deep Dive

Tables are the most complex decoration. Key design decisions and hard-won lessons:

### Always Rendered (No `cursorInRange`)

Unlike other elements, tables do **NOT** use `cursorInRange` to toggle between preview and raw mode. Tables are always rendered as widgets. Reasons:
- Clicking a table would cause a jarring visual shift (rendered → raw markdown)
- Cell editing is done via double-click → floating `<textarea>` overlay
- Use `Cmd+E` to switch to raw mode for structural editing

### Delimiter Detection: Position, Not Regex

```typescript
// CORRECT — delimiter is always 2nd line
const isDelimiter = i === startLine.number + 1;

// WRONG — regex matches data rows containing only dashes/colons
const isDelimiter = /^\s*\|[\s|:-]+\|\s*$/.test(line.text);
```

The regex approach breaks when users type dashes in cells — the row gets classified as delimiter and hidden. The position-based approach is correct because GFM delimiter is always the 2nd row.

### Widget `eq()` Must Compare `mode` and `ctx`

The new `TableWidget` (one per table, rendered on the header line via
`Decoration.replace`) holds the wrap/full `mode` plus the entire
`TableContext`. Its `eq()` must compare:
- `mode` (changes from wrap → full and vice versa via the toggle button)
- ctx structural fields (`nodeFrom`, `nodeTo`, `rows.length`, `colCount`)
- `ctx.colWidths` element-wise (so addRow placeholder sizing stays correct)
- Per-row cell `text` and `from` positions

Without these comparisons, CM6 reuses the stale widget after structural
changes (add/delete row/col) or mode toggle, causing wrong DOM positions and
out-of-date rendering.

### Table Operations: Two Strategies

**1. `replaceTable()` — full table replacement via `markdown-table` library**

Used by: `deleteRow`, `addColumn`, `deleteColumn`

- Parses table to 2D grid → modifies grid → serializes with `markdownTable()` → replaces entire table node
- Produces clean, aligned markdown
- Requires correct `ctx.nodeFrom` / `ctx.nodeTo` (see eq() note above)

**2. Direct line insert**

Used by: `addRow`

- Inserts a new line directly after the last row
- Uses `-` as placeholder in cells (visible content so Lezer includes it in Table node)
- **Cannot** use `replaceTable` for add-row because `markdownTable` produces whitespace-only cells for empty rows, and Lezer GFM parser **excludes** rows with only whitespace from the Table node

### Empty Cell Handling

When a cell is empty (e.g., after adding a column), the `from` and `to` positions point to the midpoint of the whitespace between pipes. This is a valid insertion point — editing works by inserting text there.

```typescript
// Empty cell — point to space between pipes for insertion
const midpoint = lineFrom + cellStart + Math.floor(raw.length / 2);
cells.push({ text: '', from: midpoint, to: midpoint });
```

### Cell Editing Overlay

Double-click on a cell shows a `position: fixed` `<textarea>` over the cell:

- Cell text is made `transparent` while editing (prevents text overlap)
- Textarea is positioned using `getBoundingClientRect()` of the cell element
- Auto-grows on every `input` event via `el.style.height = '0'; el.style.height = max(scrollHeight, rect.height) + 'px'`
- Cmd/Ctrl+Enter commits, Tab commits, Escape cancels, blur auto-commits after 50ms
- Plain Enter inserts a newline (textarea default)
- The original cell color is restored on cleanup via the `destroy()` helper

Newlines and pipes roundtrip through encoding helpers in
`table-encoding.ts`:
- `decodeForEdit(cellText)`: `<br>` → `\n`, `\|` → `|`
- `encodeForCommit(textareaValue)`: normalize CRLF, `|` → `\|`, trim trailing
  newlines, `\n` → `<br>`

GFM tables can't contain real newlines or unescaped pipes, so the markdown
source always carries `<br>` tags and `\|` escapes for these characters.

### Per-Table Mode (Wrap/Full)

Tables default to `wrap` mode (`max-width: 100%`, cells word-wrap). The
header row's leading ctrl-cell contains a `⇔` toggle button that dispatches
a `toggleTableMode` StateEffect carrying the table's `nodeFrom`. The
`tableModeField` (in `table-state.ts`) is a `RangeSet<TableModeValue>` that
remaps positions through edits (`value.map(tr.changes)`). The mode is read
by `decorateTable` via `getTableMode(view.state, ctx.nodeFrom)` and applied
as a `data-mode` attribute on the widget root.

`livePreviewPlugin` rebuilds decorations on the `toggleTableMode` effect
(parallel to its `mermaidRendered` handling), so the toggle visually
re-renders the widget with the new mode.

State lives in memory only — closing the file resets all tables to `wrap`.

### Selection Snap-Out from Hidden Lines

Delimiter and data lines have `height: 0` so the caret would disappear if
the user navigated onto them. `table-selection.ts` registers an
`EditorView.updateListener` that detects selection on a non-header table
line and dispatches a redirect to either the header line (moved up) or the
line after the table (moved down). The redirect is deferred via
`queueMicrotask` to avoid recursing inside the updateListener.

### `ignoreEvent()` Returns `false`

This means the widget absorbs all DOM events (CM6 doesn't process them). This prevents CM6 from placing the cursor inside the table on click, which would trigger decoration removal if `cursorInRange` were used.

### Hover Controls (±)

- **Toggle wrap/full (⇔)**: inline button in the header row's leading ctrl-cell
- **Add row (+)**: inline button at the right of the table, plus floating "+" below
- **Add column (+)**: `position: absolute` button at the right edge of the header row
- **Delete row (−)**: inline button in each data row's ctrl-cell (left of the drag handle, if >1 data rows)
- **Delete column (−)**: positioned next to each header cell's drag handle inside `.cm-md-table-col-ctrl`

All buttons use `opacity: 0` → `opacity: 0.5` on parent hover → `opacity: 1` on button hover.
Buttons use `mousedown` (not `click`) to fire before CM6 processes the event.

### Visual Styles Live on Row and Wrap Elements, Not `.cm-line`

Backgrounds, borders, and border-radius live on `.cm-md-table-row-header`,
`.cm-md-table-row-data`, and `.cm-md-table` — not on `.cm-md-table-line`.
This is because `.cm-md-table-line` has `contain: inline-size` + `display:
flex` to prevent wide tables from expanding `.cm-content` (which breaks
text wrapping). If styles were on the line, they'd extend to viewport width.

- Header gradient: `.cm-md-table .cm-md-table-row-header`
- Even row bg: `.cm-md-table .cm-md-table-row-data:nth-child(even of .cm-md-table-row-data)`
- Last-row border removal: `.cm-md-table .cm-md-table-row:last-child .cm-md-table-cell`
- Table border-radius: `.cm-md-table` (with `overflow: hidden` to clip
  corner cells)
- Right-side buttons (add-col, add-row): `position: absolute` against
  `.cm-md-table-wrap`, so they don't affect column layout

## Dependencies

- `markdown-table` — serializes 2D array → GFM markdown table string
- `@lezer/markdown` with `Table` extension — parses GFM tables in the syntax tree
