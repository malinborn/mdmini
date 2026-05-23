# Table Auto-Wrap with Per-Table Toggle

> Supersedes `2026-04-06-table-responsive-layout-design.md`. The previous spec
> proposed switching to a single-widget table without a user-facing wrap toggle.
> This spec adds the toggle, hardens the column-alignment story, and folds in
> review feedback from architect and frontend specialists.

## Problem

Markdown tables in md-mini overflow the right edge of the editor when their
content is wider than the viewport. Each row is rendered as a separate
`TableRowWidget` in its own `.cm-line`, and column alignment is achieved by
applying identical `min-width` (computed from the longest cell per column) to
every row. There is no text wrap and no horizontal scroll inside the editor —
wide tables simply spill out.

## Goals

1. Tables auto-fit the editor's viewport width by default. Long cell text wraps
   instead of pushing the table past the viewport.
2. A per-table toggle button releases auto-wrap, returning the table to its
   current natural-width behavior (overflows into the document flow).
3. Column alignment must remain absolutely stable. No JS-driven width
   computation between independent row widgets — that approach was attempted on
   this branch previously, caused visible column drift on re-render, and was
   reverted.
4. Existing table interactions (cell editing, drag&drop rows/columns, +/-
   add/delete buttons, Cmd+E raw-mode toggle, inline markdown rendering in
   cells) must continue to work.

## Non-goals

- Persistent per-table wrap state. State is in-memory, scoped to the editor
  session for a given file. Closing or reopening the file resets all tables to
  the default (wrap on).
- Per-column width customization or user-resizable columns.
- Global wrap/full setting in app preferences. Toggle is always per-table.
- Modal/overlay table viewer when in "full" mode. Released tables overflow in
  place, exactly as today.

## Solution Overview

Replace the per-row widget approach with a **single `TableWidget` per table**,
rendered via `Decoration.replace` on the table's header line. Delimiter and
data lines get `Decoration.line({class: 'cm-md-table-hidden'})` and are
visually collapsed to zero height — their underlying markdown is untouched.

The widget uses native CSS table layout (`display: table` + `table-layout:
auto`) so the browser computes column widths once across all rows. Column
alignment is structurally guaranteed; no JS measurement is involved.

A per-table `data-mode` attribute on the widget root toggles between two CSS
modes:
- `data-mode="wrap"` (default) — `.cm-md-table { max-width: 100%; }`. Cells
  wrap text. Table never exceeds editor viewport.
- `data-mode="full"` — `.cm-md-table { max-width: 9999px; width: max-content; }`.
  Table renders at natural content width and overflows the document flow
  exactly like today.

Per-table mode is stored in a CodeMirror 6 `StateField` backed by a `RangeSet`,
anchored at each table's start position and remapped through document edits.

## DOM Structure

```
<span class="cm-md-table-wrap" data-mode="wrap">
  <span class="cm-md-table">
    <span class="cm-md-table-row cm-md-table-row-header">
      <span class="cm-md-table-cell cm-md-table-row-ctrl">
        <!-- toggle wrap/full button -->
      </span>
      <span class="cm-md-table-cell cm-md-table-cell-header">
        Col 1 content
        <span class="cm-md-table-col-ctrl">⠿ −</span>
      </span>
      <!-- more header cells -->
      <span class="cm-md-table-btn cm-md-table-btn-add-col">+</span>
    </span>
    <span class="cm-md-table-row cm-md-table-row-data">
      <span class="cm-md-table-cell cm-md-table-row-ctrl">
        <!-- delete-row + drag-row buttons -->
      </span>
      <span class="cm-md-table-cell">cell content</span>
      <!-- more data cells -->
    </span>
    <!-- more data rows -->
  </span>
</span>
```

**Critical:** the leading `cm-md-table-row-ctrl` cell is present in BOTH header
and data rows. It has an explicit width (`var(--table-row-gutter)`) so the
browser's `table-layout: auto` treats it as a real column. Without this, an
empty header ctrl-cell collapses to zero width, the data-row ctrl-cell stays at
gutter width, and the first data column shifts left of the first header column.
This is the most likely place to reintroduce column drift, and we explicitly
guard against it.

All elements are `<span>`. CM6 widget DOM must be inline; tables built from
`<table>`/`<tr>`/`<td>` cannot be placed inside `.cm-content` without breaking
CM6 rendering. Using `<span>` + `display: table*` gives the same layout
algorithm.

## CSS

### Hidden lines

```css
.cm-md-table-hidden {
  height: 0 !important;
  overflow: hidden !important;
  padding: 0 !important;
  margin: 0 !important;
  font-size: 0 !important;
  line-height: 0 !important;
}
```

`margin: 0` is required — some CM6 themes apply line margins that would
otherwise leak through.

### Widget host line

```css
.cm-line.cm-md-table-line {
  font-family: var(--font-code);
  font-size: 0.9em;
  contain: inline-size;
  display: flex;
}
```

`contain: inline-size` prevents wide tables from expanding `.cm-content` (which
would break prose line-wrap). `display: flex` plus the widget root's
`flex: 1 1 auto; min-width: 0` is the standard pattern for `max-width: 100%` to
resolve against the flex container's width — already used for code blocks in
this project.

### Widget wrapper

```css
.cm-md-table-wrap {
  flex: 1 1 auto;
  min-width: 0;
  position: relative;
}

.cm-md-table-wrap[data-mode="wrap"] .cm-md-table {
  max-width: 100%;
}

.cm-md-table-wrap[data-mode="full"] .cm-md-table {
  max-width: 9999px;
  width: max-content;
}
```

No `display: inline-block` on the wrapper — that would short-circuit
`max-width: 100%` on the child by sizing the wrapper to content first. Flex
item with `flex: 1 1 auto; min-width: 0` is the correct shape.

Mode switch is instant (no CSS transition). `max-width: 100%` →
`max-width: 9999px` is technically transitionable but looks unnatural; an
instant snap is correct for an explicit user action.

### Table and cells

```css
.cm-md-table {
  display: table;
  table-layout: auto;
  border-collapse: separate;
  border-spacing: 0;
  font-family: var(--font-code);
  font-size: 0.9em;
  line-height: 1.6;
}

.cm-md-table-row {
  display: table-row;
}

.cm-md-table-cell {
  display: table-cell;
  padding: 0.2em 0.8ch;
  overflow-wrap: anywhere;
  vertical-align: top;
  border-bottom: 1px solid var(--color-table-border);
}

.cm-md-table-row-ctrl {
  width: var(--table-row-gutter, 48px);
  vertical-align: middle;
  position: relative;
}

.cm-md-table-row-header .cm-md-table-cell {
  font-weight: 600;
  color: var(--color-heading);
  border-bottom: 2px solid var(--color-table-border);
}
```

`overflow-wrap: anywhere` (not `word-wrap: break-word`) — modern, stricter, and
necessary to break long unbroken tokens like URLs that would otherwise force
the table past `max-width: 100%`.

### Row backgrounds (preserve current look)

```css
.cm-md-table-row-header {
  background: linear-gradient(135deg, #302848 0%, #24203a 40%, #1f1d2e 70%, #282248 100%);
}
:root[data-theme='light'] .cm-md-table-row-header {
  background: linear-gradient(135deg, #e8e0f6 0%, #ede8f4 40%, #f5f3f8 70%, #e4ecf8 100%);
}
.cm-md-table-row-data { background: var(--color-code-bg); }
.cm-md-table-row-data:nth-child(even of .cm-md-table-row-data) {
  background: var(--color-table-even-bg);
}
.cm-md-table-row:first-of-type .cm-md-table-cell:first-child { border-top-left-radius: 4px; }
.cm-md-table-row:first-of-type .cm-md-table-cell:last-child { border-top-right-radius: 4px; }
.cm-md-table-row:last-of-type .cm-md-table-cell:first-child { border-bottom-left-radius: 4px; }
.cm-md-table-row:last-of-type .cm-md-table-cell:last-child { border-bottom-right-radius: 4px; }
```

Backgrounds live on rows, not on `.cm-line` (the host line is bigger than the
table content due to `display: flex; contain: inline-size` — see existing
gotcha in `CLAUDE.md`).

### Add-column button (right of header)

Stays `position: absolute` (as today), positioned with `right: -28px` against
the header row. Not a DOM sibling of `.cm-md-table`. Sibling would render below
the table since the table is block-level.

## State Management

```typescript
import { StateField, StateEffect, RangeSet, RangeValue } from '@codemirror/state';

class TableModeValue extends RangeValue {
  constructor(public mode: 'wrap' | 'full') { super(); }
  eq(other: TableModeValue) { return this.mode === other.mode; }
}

const toggleTableMode = StateEffect.define<{ pos: number }>();

const tableModeField = StateField.define<RangeSet<TableModeValue>>({
  create: () => RangeSet.empty,
  update(value, tr) {
    value = value.map(tr.changes);
    for (const eff of tr.effects) {
      if (eff.is(toggleTableMode)) {
        const pos = eff.value.pos;
        let current: 'wrap' | 'full' = 'wrap';
        const it = value.iter(pos);
        while (it.value && it.from === pos) {
          if (it.from === pos) current = it.value.mode;
          it.next();
        }
        const next: 'wrap' | 'full' = current === 'full' ? 'wrap' : 'full';
        value = value.update({
          filter: (from) => from !== pos,
          add: [new TableModeValue(next).range(pos)],
        });
      }
    }
    return value;
  },
});
```

`decorateTable()` reads the field via `state.field(tableModeField).iter(nodeFrom)`
and walks the cursor while `it.from === nodeFrom` to find the value at the
table's position. Default is `'wrap'` when no entry exists. The toggle
button's `mousedown` handler dispatches
`toggleTableMode.of({ pos: ctx.nodeFrom })`.

The `RangeSet.map(tr.changes)` call shifts positions through document edits,
so the per-table mode survives typing into other parts of the document.
`RangeSet.iter` is O(log n + k) — lookup cost is negligible at typical table
counts (≤20).

## Selection Snap-Out from Hidden Lines

Hidden table lines (`height: 0`) remain in the document model, so arrow-key
navigation and clicks can still land on them — the caret would visually
disappear. Mitigate with an `EditorView.updateListener` that watches for
selection landing on a line classified as a hidden table line and redirects
the cursor either before the table (if moving up) or after it (if moving down).

Detection: re-parse line-by-line using the same logic as `decorateTable` to
determine if the current line is a table delimiter or data row (not the header).
This is cheap relative to selection-change frequency.

```typescript
EditorView.updateListener.of((update) => {
  if (!update.selectionSet) return;
  const head = update.state.selection.main.head;
  const prevHead = update.startState.selection.main.head;
  const movedDown = head > prevHead;
  // If the line at head is a non-header table line, redirect:
  //   movedDown → first line after table (or end of doc)
  //   movedUp   → header line of this table (or first line before)
  // Suppress recursion via a flag on the dispatched transaction.
});
```

## Cell Editor (Multi-line)

Double-clicking a cell shows a `<textarea>` overlay positioned via
`getBoundingClientRect()` of the cell, `position: fixed`. Replaces the current
`<input type="text">` overlay.

**Auto-grow:**
```typescript
const grow = () => {
  el.style.height = '0';
  el.style.height = el.scrollHeight + 'px';
};
el.addEventListener('input', grow);
grow(); // initial
```

**Encode/decode at the commit boundary:**

The textarea content roundtrips with the markdown source through two transforms.

```typescript
function decodeForEdit(cellText: string): string {
  return cellText
    .replace(/<br\s*\/?>/gi, '\n')   // <br> → newline
    .replace(/\\\|/g, '|');          // unescape pipes
}

function encodeForCommit(textareaValue: string): string {
  return textareaValue
    .replace(/\|/g, '\\|')         // escape pipes
    .replace(/\n+$/, '')           // trim trailing newlines
    .split('\n')
    .join('<br>');
}
```

GFM tables don't allow real newlines in cells, so newlines roundtrip through
`<br>` tags in the markdown source. Pipe characters must be escaped as `\|`
to avoid terminating the cell.

**Keybindings:**
- Enter: newline (textarea default)
- Cmd+Enter (Ctrl+Enter on non-mac): commit
- Esc: cancel
- Blur: auto-commit (existing behavior)

The cell text stays `color: transparent` while editing (existing behavior). The
textarea grows beyond the cell visually as the user types more lines — the
table layout does not reflow until commit. Acceptable: the textarea is a
floating overlay, not in the document flow.

## Drag & Drop

DOM helpers change from querying sibling `.cm-line`s to querying inside the
table widget:

```typescript
function getRowWraps(el: HTMLElement | null): HTMLElement[] {
  const table = el?.closest('.cm-md-table');
  if (!table) return [];
  return Array.from(table.querySelectorAll('.cm-md-table-row-data')) as HTMLElement[];
}

function getHeaderCells(el: HTMLElement | null): HTMLElement[] {
  const table = el?.closest('.cm-md-table');
  if (!table) return [];
  const header = table.querySelector('.cm-md-table-row-header');
  if (!header) return [];
  // First cell is the ctrl-cell, skip it
  return Array.from(
    header.querySelectorAll('.cm-md-table-cell:not(.cm-md-table-row-ctrl)')
  ) as HTMLElement[];
}
```

Drop indicator stays a floating element appended to `document.body` (current
implementation). No change.

## Performance Guard

```typescript
function decorateTable(...) {
  ...
  if (rows.length > 500) return; // bail out; CM6 renders raw markdown
  ...
}
```

Cheap safety against pathological documents.

## Toggle Button Placement

Lives in the header row's leading ctrl-cell. Icon: `⇔` (or similar; finalized
at implementation time). Hover behavior consistent with existing controls:

```css
.cm-md-table-btn-toggle {
  opacity: 0;
  transition: opacity 0.15s;
  cursor: pointer;
}
.cm-md-table-row:hover .cm-md-table-btn-toggle { opacity: 0.5; }
.cm-md-table-btn-toggle:hover { opacity: 1; }
```

`mousedown` (not `click`) so it fires before CM6 processes the event. Handler:

```typescript
view.dispatch({ effects: toggleTableMode.of({ pos: ctx.nodeFrom }) });
```

## Edge Cases

| Case | Behavior |
|------|----------|
| Single-row table (header only, no data) | Renders normally. Toggle present but visually no-op since one row can't drift. |
| Single-column table | Renders normally. `max-width: 100%` constrains, cell wraps. |
| Empty cells | Render as empty `display: table-cell`, take their column's min-width. |
| Very narrow viewport (~150px) | `overflow-wrap: anywhere` forces character-level breaks, table fits. |
| Window resize | CSS handles automatically. No JS involved. |
| Cursor in table area | Tables always rendered as widgets (unchanged). `ignoreEvent: false` absorbs events. |
| Click on hidden line | `EditorView.updateListener` snaps caret out. |
| Find-in-file matches hidden line | Documented limitation: highlight scrolls to invisible position. Acceptable for v1. Future: temporarily expand on `searchPanelOpen`. |
| User types literal `<br>` in cell | Treated as newline on next edit. Documented. |
| User types `|` in cell | Auto-escaped to `\|` on commit. Auto-unescaped on next edit. |
| 500+ row table | Decoration bails out; CM6 renders raw markdown. User sees raw table but no crash. |
| Cmd+E raw mode toggle | Unchanged — `cursorInRange` not used for tables; raw mode is the existing global toggle mechanism. |

## What Does NOT Change

- Table parsing (`parseCellsWithPositions`, `tableToGrid`)
- Table operations (`addRow`, `deleteRow`, `addColumn`, `deleteColumn`, `replaceTable`)
- Markdown source format (still standard GFM, with `<br>` and `\|` escapes inside cells)
- Inline markdown rendering in cells (bold, italic, code, strikethrough via `renderCellContent`)
- Cmd+E raw mode toggle
- Drop indicator floating in `document.body`
- Lezer GFM parsing setup

## Files Affected

| File | Action |
|------|--------|
| `src/lib/editor/preview/tables.ts` | Replace `TableRowWidget` with `TableWidget`; rewrite `decorateTable()`; update `getRowWraps` / `getHeaderCells`; new `TableModeValue` + `tableModeField` + `toggleTableMode` exports; replace `<input>` cell editor with `<textarea>` + encode/decode helpers |
| `src/styles/editor.css` | Replace per-row flex/inline-flex CSS with `display: table` rules; add `.cm-md-table-hidden`, `.cm-md-table-wrap`, `.cm-md-table-btn-toggle`; remove obsolete `.cm-md-table-row-wrap*` classes |
| `src/lib/editor/setup.ts` | Register `tableModeField` and the `EditorView.updateListener` for selection snap-out |
| `src/lib/editor/preview/plugin.ts` | No change expected (still dispatches to `decorateTable`) |
| `src/lib/editor/preview/CLAUDE.md` | Update post-implementation with new structure and gotchas |
| `src/lib/editor/preview/tables.test.ts` | Existing parsing/grid tests should pass unchanged; add tests for `encodeForCommit` / `decodeForEdit` |

## Validation Plan

After implementation, manually verify in `npm run tauri dev`:

1. Small table (3×2) renders identically to current main. No regressions on
   look or hover controls.
2. Wide table (5+ columns with long text) wraps cells, fits viewport.
3. Click toggle button on wide table → table goes to full mode, overflows.
   Click again → returns to wrap mode.
4. Resize window — wrap-mode table reflows; full-mode table stays at natural
   width.
5. Column alignment: header ctrl-cell and data ctrl-cells stay aligned; first
   header column aligns with first data column. Test by hovering each column
   and confirming no horizontal drift.
6. Double-click cell with long text → textarea opens at cell position, grows
   as user types. Cmd+Enter commits; the saved markdown contains `<br>` for
   newlines.
7. Type `|` in cell, commit. Re-open the cell — pipe is intact, not escaped.
   Inspect markdown source — pipe is `\|`.
8. Add/delete row/column — column alignment holds across operations.
9. Drag row to reorder — works as today.
10. Press Down past header into table — cursor snaps to below the table or
    onto header (not stuck on hidden line).
11. Document with two adjacent tables — toggling one does not affect the other.
12. Close file, reopen — both tables back to wrap mode (default).
