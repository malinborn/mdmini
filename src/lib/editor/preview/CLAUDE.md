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
| `tables.ts` | GFM tables | Line + replace (row widgets) |
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
- Cell editing is done via double-click → floating `<input>` overlay
- Use `Cmd+E` to switch to raw mode for structural editing

### Delimiter Detection: Position, Not Regex

```typescript
// CORRECT — delimiter is always 2nd line
const isDelimiter = i === startLine.number + 1;

// WRONG — regex matches data rows containing only dashes/colons
const isDelimiter = /^\s*\|[\s|:-]+\|\s*$/.test(line.text);
```

The regex approach breaks when users type dashes in cells — the row gets classified as delimiter and hidden. The position-based approach is correct because GFM delimiter is always the 2nd row.

### Widget `eq()` Must Compare `ctx`

Each `TableRowWidget` receives a `TableContext` (shared table structure). The `eq()` method **must** compare ctx properties (`nodeFrom`, `nodeTo`, `rows.length`, `colCount`) — otherwise CM6 reuses stale widgets after structural changes (add/delete row/col), and operations use stale document positions.

```typescript
eq(other: TableRowWidget): boolean {
  return (
    // ... cell comparisons ...
    this.ctx.nodeFrom === other.ctx.nodeFrom &&
    this.ctx.nodeTo === other.ctx.nodeTo &&
    this.ctx.rows.length === other.ctx.rows.length &&
    this.ctx.colCount === other.ctx.colCount &&
    // ...
  );
}
```

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

Double-click on a cell shows a `position: fixed` `<input>` over the cell:
- Cell text is made `transparent` while editing (prevents text overlap)
- Input is positioned using `getBoundingClientRect()` of the cell element
- Enter commits, Escape cancels, blur auto-commits
- The original cell color is restored on cleanup

### `ignoreEvent()` Returns `false`

This means the widget absorbs all DOM events (CM6 doesn't process them). This prevents CM6 from placing the cursor inside the table on click, which would trigger decoration removal if `cursorInRange` were used.

### Hover Controls (±)

- **Add row (+)**: inline button on last data row, right side
- **Add column (+)**: inline button on header row, right side
- **Delete row (−)**: inline button on each data row (if >1 data rows), right side
- **Delete column (−)**: positioned above each header cell on hover

All buttons use `opacity: 0` → `opacity: 0.5` on parent hover → `opacity: 1` on button hover.

Buttons use `mousedown` (not `click`) to fire before CM6 processes the event.

### Visual Styles Live on Widget Wrapper, Not `.cm-line`

Table backgrounds, borders, and border-radius are on `.cm-md-table-row-wrap` (not `.cm-md-table-line`). This is because `.cm-md-table-line` has `contain: inline-size` + `display: flex` to prevent wide tables from expanding `.cm-content` (which breaks text wrapping). If styles were on the line, they'd extend to viewport width.

- Header gradient: `.cm-md-table-header .cm-md-table-row-wrap`
- Even row bg: `.cm-md-table-even .cm-md-table-row-wrap`
- Bottom radius: `.cm-md-table-row-wrap-last` (class added in widget JS)
- Right-side buttons (del-row, add-row, add-col): `position: absolute` so they don't affect wrapper width alignment

## Dependencies

- `markdown-table` — serializes 2D array → GFM markdown table string
- `@lezer/markdown` with `Table` extension — parses GFM tables in the syntax tree
