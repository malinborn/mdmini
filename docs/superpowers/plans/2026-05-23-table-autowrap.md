# Table Auto-Wrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-row `TableRowWidget`s with a single `TableWidget` per table that auto-wraps cell content to fit the editor viewport, with a per-table toggle button to release back to natural-width overflow.

**Architecture:** Header `.cm-line` hosts a `Decoration.replace` widget that renders the entire table using native CSS `display: table` + `table-layout: auto`. Delimiter and data lines are hidden via `Decoration.line({class: 'cm-md-table-hidden'})`. Per-table wrap/full mode is stored in a CodeMirror 6 `StateField<RangeSet<TableModeValue>>` that remaps positions through document edits. Multi-line cells get a `<textarea>` editor; newlines roundtrip via `<br>` in markdown; pipes are escaped as `\|`.

**Tech Stack:** CodeMirror 6 (StateField, RangeSet, ViewPlugin, WidgetType, Decoration, EditorView.updateListener), TypeScript, CSS (`display: table`), Vitest.

**Reference spec:** `docs/superpowers/specs/2026-05-23-table-autowrap-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/lib/editor/preview/table-encoding.ts` | Create | Pure functions: `encodeForCommit(value)`, `decodeForEdit(text)` for `<br>`/pipe roundtrip |
| `src/lib/editor/preview/table-encoding.test.ts` | Create | Unit tests for encode/decode |
| `src/lib/editor/preview/table-state.ts` | Create | `TableModeValue`, `toggleTableMode` effect, `tableModeField`, `getTableMode(state, pos)` helper |
| `src/lib/editor/preview/table-state.test.ts` | Create | Unit tests for state transitions |
| `src/lib/editor/preview/tables.ts` | Rewrite widget section + helpers | Replace `TableRowWidget` with `TableWidget`; rewrite `decorateTable`; update drag helpers; multi-line cell editor |
| `src/lib/editor/preview/tables.test.ts` | Extend | Existing parsing tests stay; add cases if needed |
| `src/lib/editor/setup.ts` | Modify | Register `tableModeField` and `tableSelectionSnapOut` listener |
| `src/styles/editor.css` | Rewrite table section | New `display: table` rules, `.cm-md-table-hidden`, toggle button styles; prune obsolete `.cm-md-table-row-wrap*` |
| `src/lib/editor/preview/CLAUDE.md` | Update | Reflect new single-widget structure |

---

## Task 1: Encode/decode helpers for cell text

**Files:**
- Create: `src/lib/editor/preview/table-encoding.ts`
- Create: `src/lib/editor/preview/table-encoding.test.ts`

GFM table cells can't contain real newlines or unescaped pipes. The textarea editor lets the user type both freely; we convert at the commit/load boundary.

- [ ] **Step 1: Write failing tests**

Create `src/lib/editor/preview/table-encoding.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { encodeForCommit, decodeForEdit } from './table-encoding';

describe('encodeForCommit', () => {
  it('NoSpecialChars_ReturnsUnchanged', () => {
    expect(encodeForCommit('hello world')).toBe('hello world');
  });

  it('SingleNewline_ConvertsToBrTag', () => {
    expect(encodeForCommit('line1\nline2')).toBe('line1<br>line2');
  });

  it('MultipleNewlines_EachConvertsToBr', () => {
    expect(encodeForCommit('a\nb\nc')).toBe('a<br>b<br>c');
  });

  it('TrailingNewlines_AreTrimmed', () => {
    expect(encodeForCommit('a\nb\n\n')).toBe('a<br>b');
  });

  it('Pipe_EscapedWithBackslash', () => {
    expect(encodeForCommit('a|b')).toBe('a\\|b');
  });

  it('PipeAndNewline_BothEscaped', () => {
    expect(encodeForCommit('a|b\nc|d')).toBe('a\\|b<br>c\\|d');
  });

  it('EmptyString_ReturnsEmpty', () => {
    expect(encodeForCommit('')).toBe('');
  });

  it('OnlyNewlines_ReturnsEmpty', () => {
    expect(encodeForCommit('\n\n')).toBe('');
  });
});

describe('decodeForEdit', () => {
  it('NoSpecialChars_ReturnsUnchanged', () => {
    expect(decodeForEdit('hello world')).toBe('hello world');
  });

  it('BrTag_ConvertsToNewline', () => {
    expect(decodeForEdit('line1<br>line2')).toBe('line1\nline2');
  });

  it('SelfClosingBr_ConvertsToNewline', () => {
    expect(decodeForEdit('a<br/>b')).toBe('a\nb');
  });

  it('BrWithSpaces_ConvertsToNewline', () => {
    expect(decodeForEdit('a<br />b')).toBe('a\nb');
  });

  it('BrUppercase_ConvertsToNewline', () => {
    expect(decodeForEdit('a<BR>b')).toBe('a\nb');
  });

  it('EscapedPipe_Unescaped', () => {
    expect(decodeForEdit('a\\|b')).toBe('a|b');
  });

  it('RoundTrip_PreservesContent', () => {
    const input = 'hello|world\nsecond line';
    expect(decodeForEdit(encodeForCommit(input))).toBe(input);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- table-encoding --run`
Expected: All tests FAIL with `Cannot find module './table-encoding'`.

- [ ] **Step 3: Write implementation**

Create `src/lib/editor/preview/table-encoding.ts`:

```typescript
export function encodeForCommit(textareaValue: string): string {
  return textareaValue
    .replace(/\|/g, '\\|')
    .replace(/\n+$/, '')
    .split('\n')
    .join('<br>');
}

export function decodeForEdit(cellText: string): string {
  return cellText
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\\\|/g, '|');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- table-encoding --run`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/editor/preview/table-encoding.ts src/lib/editor/preview/table-encoding.test.ts
git commit -m "feat(tables): add encode/decode helpers for multi-line cells"
```

---

## Task 2: Per-table mode StateField

**Files:**
- Create: `src/lib/editor/preview/table-state.ts`
- Create: `src/lib/editor/preview/table-state.test.ts`

Stores per-table wrap/full mode in a `RangeSet` so positions follow the document through edits.

- [ ] **Step 1: Write failing tests**

Create `src/lib/editor/preview/table-state.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { tableModeField, toggleTableMode, getTableMode } from './table-state';

function mkState(doc = '') {
  return EditorState.create({ doc, extensions: [tableModeField] });
}

describe('tableModeField', () => {
  it('NoEntries_DefaultsToWrap', () => {
    const state = mkState();
    expect(getTableMode(state, 0)).toBe('wrap');
    expect(getTableMode(state, 42)).toBe('wrap');
  });

  it('ToggleOnce_FlipsToFull', () => {
    const state = mkState();
    const tr = state.update({ effects: toggleTableMode.of({ pos: 10 }) });
    expect(getTableMode(tr.state, 10)).toBe('full');
  });

  it('ToggleTwice_ReturnsToWrap', () => {
    const state = mkState();
    let s = state.update({ effects: toggleTableMode.of({ pos: 10 }) }).state;
    s = s.update({ effects: toggleTableMode.of({ pos: 10 }) }).state;
    expect(getTableMode(s, 10)).toBe('wrap');
  });

  it('TwoTables_IndependentState', () => {
    const state = mkState();
    let s = state.update({ effects: toggleTableMode.of({ pos: 10 }) }).state;
    s = s.update({ effects: toggleTableMode.of({ pos: 50 }) }).state;
    s = s.update({ effects: toggleTableMode.of({ pos: 10 }) }).state;
    expect(getTableMode(s, 10)).toBe('wrap');
    expect(getTableMode(s, 50)).toBe('full');
  });

  it('DocEditBeforeTable_PositionShifts', () => {
    const state = mkState('AAAA TABLE');
    let s = state.update({ effects: toggleTableMode.of({ pos: 5 }) }).state;
    // Insert 3 chars at position 0; table position should shift to 8
    s = s.update({ changes: { from: 0, insert: 'XYZ' } }).state;
    expect(getTableMode(s, 8)).toBe('full');
    expect(getTableMode(s, 5)).toBe('wrap'); // old position now empty
  });

  it('DocEditAfterTable_PositionUnchanged', () => {
    const state = mkState('TABLE AAAA');
    let s = state.update({ effects: toggleTableMode.of({ pos: 0 }) }).state;
    s = s.update({ changes: { from: 6, insert: 'XYZ' } }).state;
    expect(getTableMode(s, 0)).toBe('full');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- table-state --run`
Expected: FAIL with `Cannot find module './table-state'`.

- [ ] **Step 3: Write implementation**

Create `src/lib/editor/preview/table-state.ts`:

```typescript
import { StateField, StateEffect, RangeSet, RangeValue, type EditorState } from '@codemirror/state';

export type TableMode = 'wrap' | 'full';

export class TableModeValue extends RangeValue {
  constructor(public readonly mode: TableMode) {
    super();
  }
  eq(other: RangeValue): boolean {
    return other instanceof TableModeValue && this.mode === other.mode;
  }
}

export const toggleTableMode = StateEffect.define<{ pos: number }>();

export const tableModeField = StateField.define<RangeSet<TableModeValue>>({
  create: () => RangeSet.empty,
  update(value, tr) {
    value = value.map(tr.changes);
    for (const eff of tr.effects) {
      if (!eff.is(toggleTableMode)) continue;
      const pos = eff.value.pos;
      let current: TableMode = 'wrap';
      const cur = value.iter(pos);
      while (cur.value && cur.from <= pos) {
        if (cur.from === pos) current = cur.value.mode;
        cur.next();
      }
      const next: TableMode = current === 'full' ? 'wrap' : 'full';
      value = value.update({
        filter: (from) => from !== pos,
        add: [new TableModeValue(next).range(pos)],
      });
    }
    return value;
  },
});

export function getTableMode(state: EditorState, pos: number): TableMode {
  const set = state.field(tableModeField, false);
  if (!set) return 'wrap';
  const cur = set.iter(pos);
  while (cur.value && cur.from <= pos) {
    if (cur.from === pos) return cur.value.mode;
    cur.next();
  }
  return 'wrap';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- table-state --run`
Expected: All 6 tests PASS.

- [ ] **Step 5: Register field in editor setup**

Modify `src/lib/editor/setup.ts`. Add import after existing preview imports (around line 17):

```typescript
import { tableModeField } from './preview/table-state';
```

In `createExtensions()` array, add `tableModeField` near the top (after `editorTheme`, before `lineGlowCompartment`):

```typescript
  return [
    editorTheme,
    tableModeField,
    lineGlowCompartment.of([]),
    ...
```

- [ ] **Step 6: Run all tests + typecheck**

Run: `npm run test -- --run && npm run check`
Expected: all existing tests PASS, no new type errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/editor/preview/table-state.ts src/lib/editor/preview/table-state.test.ts src/lib/editor/setup.ts
git commit -m "feat(tables): add per-table wrap/full mode state via RangeSet"
```

---

## Task 3: New CSS rules for single-widget table layout

**Files:**
- Modify: `src/styles/editor.css` (lines ~191-300 are the table section)

We add new classes alongside the old `.cm-md-table-row-wrap*` ones — they coexist during this task because the widget is still per-row. We prune obsolete CSS in Task 9 after the widget is fully migrated.

- [ ] **Step 1: Update widget host line**

In `src/styles/editor.css`, find `.cm-line.cm-md-table-line` (line ~193) and replace with:

```css
.cm-line.cm-md-table-line {
  --table-row-gutter: 48px;
  font-family: var(--font-code);
  font-size: 0.9em;
  contain: inline-size;
  display: flex;
}
```

(Removed `font-family`/`font-size` duplication that already lived elsewhere — keep only this one definition.)

- [ ] **Step 2: Add hidden-line class**

Add right after the `.cm-md-table-delimiter` block (around line ~207):

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

- [ ] **Step 3: Add widget wrapper styles**

Add after the new `.cm-md-table-hidden` block:

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

- [ ] **Step 4: Add table/row/cell display rules**

Add after the wrapper block:

```css
.cm-md-table {
  display: table;
  table-layout: auto;
  border-collapse: separate;
  border-spacing: 0;
  font-family: var(--font-code);
  font-size: 0.9em;
  line-height: 1.6;
  border-radius: 4px;
  overflow: hidden;
}

.cm-md-table .cm-md-table-row {
  display: table-row;
}

.cm-md-table .cm-md-table-cell {
  display: table-cell;
  padding: 0.2em 0.8ch;
  cursor: default;
  position: relative;
  overflow-wrap: anywhere;
  vertical-align: top;
  border-bottom: 1px solid var(--color-table-border);
}

.cm-md-table .cm-md-table-row-ctrl {
  width: var(--table-row-gutter);
  vertical-align: middle;
}
```

Note: nested selectors (`.cm-md-table .cm-md-table-row`) win against the old `.cm-md-table-row` declared as `display: inline-flex`, so we don't have to remove the old rules yet.

- [ ] **Step 5: Add row-background styles**

Add right after:

```css
.cm-md-table .cm-md-table-row-header {
  background: linear-gradient(135deg, #302848 0%, #24203a 40%, #1f1d2e 70%, #282248 100%);
}

:root[data-theme='light'] .cm-md-table .cm-md-table-row-header {
  background: linear-gradient(135deg, #e8e0f6 0%, #ede8f4 40%, #f5f3f8 70%, #e4ecf8 100%);
}

.cm-md-table .cm-md-table-row-header .cm-md-table-cell {
  font-weight: 600;
  color: var(--color-heading);
  border-bottom: 2px solid var(--color-table-border);
}

:root[data-theme='light'] .cm-md-table .cm-md-table-row-header .cm-md-table-cell {
  color: #44403c;
}

.cm-md-table .cm-md-table-row-data {
  background: var(--color-code-bg);
}

.cm-md-table .cm-md-table-row-data:nth-child(even of .cm-md-table-row-data) {
  background: var(--color-table-even-bg);
}

.cm-md-table .cm-md-table-row:last-child .cm-md-table-cell {
  border-bottom: none;
}
```

- [ ] **Step 6: Add toggle button styles**

Add after the row-background block:

```css
.cm-md-table-btn-toggle {
  opacity: 0;
  transition: opacity 0.15s;
  cursor: pointer;
  background: none;
  border: none;
  color: var(--color-text);
  font-size: 1em;
  padding: 0 4px;
}

.cm-md-table-row:hover .cm-md-table-btn-toggle {
  opacity: 0.5;
}

.cm-md-table-btn-toggle:hover {
  opacity: 1;
}
```

- [ ] **Step 7: Override positioning for `+ add column` and `+ add row` buttons**

In the old structure, `.cm-md-table-btn-add-col` was positioned at `top: 50%` relative to the per-row wrap. In the new structure it's relative to `.cm-md-table-wrap` (the whole table). At `top: 50%` it would land in the vertical middle of the table. Anchor it to the top of the table (where the header is) instead.

Find `.cm-md-table-btn-add-col` (line ~487) and replace its block with:

```css
.cm-md-table-btn-add-col {
  position: absolute;
  right: -28px;
  top: 0.4em;
}
```

Find `.cm-md-table-btn-add-row` (line ~412 — the override that sets `right: -68px`) and replace its block with:

```css
.cm-md-table-btn-add-row {
  position: absolute;
  right: -68px;
  bottom: 0.3em;
  width: 30px;
  border-radius: 11px;
  z-index: 1;
}
```

The new positioning places "+ add row" at the bottom-right corner of the table, vertically aligned with the last row.

- [ ] **Step 8: Show the "+" buttons on table hover**

In Task 9 we'll prune the `:hover` selectors that reference `.cm-md-table-row-wrap`. For now, add a working hover selector at the bottom of the table styles in the file:

```css
.cm-md-table-wrap:hover .cm-md-table-btn-add-col,
.cm-md-table-wrap:hover .cm-md-table-btn-add-row,
.cm-md-table-wrap:hover .cm-md-table-add-row-bottom .cm-md-table-btn {
  opacity: 0.5;
}

.cm-md-table-wrap .cm-md-table-btn-add-col:hover,
.cm-md-table-wrap .cm-md-table-btn-add-row:hover,
.cm-md-table-wrap .cm-md-table-add-row-bottom .cm-md-table-btn:hover {
  opacity: 1;
}
```

These coexist with the old `.cm-md-table-row-wrap:hover` selectors that still exist (they target a class that no longer renders, so they're harmless). Task 9 removes the old ones.

- [ ] **Step 9: Add multi-line textarea editor styles**

Find `.cm-md-table-editor` (line ~551). Replace its block with:

```css
.cm-md-table-editor {
  font-family: var(--font-code);
  font-size: 0.9em;
  line-height: 1.6;
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-accent);
  border-radius: 3px;
  padding: 0.2em 0.8ch;
  margin: 0;
  outline: none;
  z-index: 1000;
  resize: none;
  overflow: hidden;
  box-sizing: border-box;
  white-space: pre-wrap;
}
```

(Was `<input>` styling; now also works for `<textarea>` with `resize: none` and `white-space: pre-wrap`.)

- [ ] **Step 10: Commit**

```bash
git add src/styles/editor.css
git commit -m "feat(tables): CSS for single-widget table with wrap/full modes"
```

---

## Task 4: Helper functions for cell, header row, data row construction

**Files:**
- Modify: `src/lib/editor/preview/tables.ts`

We extract DOM-building into pure helpers so the new `TableWidget` can reuse logic from the existing `TableRowWidget`'s `toDOM()`. Old widget stays for now; we replace it in Task 5.

- [ ] **Step 1: Add `buildCell()` helper**

In `src/lib/editor/preview/tables.ts`, add this function right after `showCellEditor` (after line ~663, before `decorateTable`):

```typescript
function buildCell(
  cell: CellInfo,
  colIndex: number,
  isHeader: boolean,
  ctx: TableContext,
  view: EditorView
): HTMLElement {
  const cellEl = document.createElement('span');
  cellEl.className = 'cm-md-table-cell';
  if (isHeader) cellEl.classList.add('cm-md-table-cell-header');
  renderCellContent(cellEl, cell.text);

  cellEl.addEventListener('dblclick', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showCellEditor(view, cellEl, cell);
  });

  if (isHeader) {
    const ctrl = document.createElement('span');
    ctrl.className = 'cm-md-table-col-ctrl';

    const colDrag = mkBtn('⠿', 'cm-md-table-btn-drag cm-md-table-btn-drag-col', () => {});
    colDrag.addEventListener('mousedown', (e) => {
      startColDrag(e, view, ctx, colIndex, cellEl);
    });
    ctrl.appendChild(colDrag);

    if (ctx.colCount > 1) {
      const del = mkBtn('−', 'cm-md-table-btn-del', () => deleteColumn(view, ctx, colIndex));
      ctrl.appendChild(del);
    }

    cellEl.appendChild(ctrl);
    cellEl.classList.add('cm-md-table-cell-has-ctrl');
  }

  return cellEl;
}
```

- [ ] **Step 2: Add `buildHeaderCtrlCell()` helper**

Add right after `buildCell`:

```typescript
function buildHeaderCtrlCell(view: EditorView, ctx: TableContext): HTMLElement {
  const cellEl = document.createElement('span');
  cellEl.className = 'cm-md-table-cell cm-md-table-row-ctrl';

  const toggleBtn = mkBtn('⇔', 'cm-md-table-btn-toggle', () => {
    view.dispatch({ effects: toggleTableMode.of({ pos: ctx.nodeFrom }) });
  });
  toggleBtn.title = 'Toggle wrap / full width';
  cellEl.appendChild(toggleBtn);

  return cellEl;
}
```

- [ ] **Step 3: Add `buildDataCtrlCell()` helper**

Add right after `buildHeaderCtrlCell`:

```typescript
function buildDataCtrlCell(
  view: EditorView,
  ctx: TableContext,
  dataRowIndex: number,
  rowEl: HTMLElement
): HTMLElement {
  const cellEl = document.createElement('span');
  cellEl.className = 'cm-md-table-cell cm-md-table-row-ctrl';

  const dataCount = ctx.rows.filter((r) => !r.isDelimiter && !r.isHeader).length;
  if (dataCount > 1) {
    const del = mkBtn('−', 'cm-md-table-btn-del cm-md-table-btn-del-row-left', () =>
      deleteRow(view, ctx, dataRowIndex)
    );
    cellEl.appendChild(del);
  }

  const dragHandle = mkBtn('⠿', 'cm-md-table-btn-drag cm-md-table-btn-drag-row', () => {});
  dragHandle.addEventListener('mousedown', (e) => {
    startRowDrag(e, view, ctx, dataRowIndex, rowEl);
  });
  cellEl.appendChild(dragHandle);

  return cellEl;
}
```

- [ ] **Step 4: Add `buildHeaderRow()` helper**

Add right after `buildDataCtrlCell`:

```typescript
function buildHeaderRow(
  row: RowData,
  ctx: TableContext,
  view: EditorView
): HTMLElement {
  const tr = document.createElement('span');
  tr.className = 'cm-md-table-row cm-md-table-row-header';

  tr.appendChild(buildHeaderCtrlCell(view, ctx));

  row.cells.forEach((cell, i) => {
    tr.appendChild(buildCell(cell, i, true, ctx, view));
  });

  return tr;
}
```

- [ ] **Step 5: Add `buildDataRow()` helper**

Add right after `buildHeaderRow`:

```typescript
function buildDataRow(
  row: RowData,
  dataRowIndex: number,
  ctx: TableContext,
  view: EditorView
): HTMLElement {
  const tr = document.createElement('span');
  tr.className = 'cm-md-table-row cm-md-table-row-data';

  const ctrlCell = buildDataCtrlCell(view, ctx, dataRowIndex, tr);
  tr.appendChild(ctrlCell);

  row.cells.forEach((cell, i) => {
    tr.appendChild(buildCell(cell, i, false, ctx, view));
  });

  return tr;
}
```

- [ ] **Step 6: Add toggleTableMode import**

At the top of `src/lib/editor/preview/tables.ts`, after the existing imports:

```typescript
import { toggleTableMode, getTableMode } from './table-state';
```

- [ ] **Step 7: Verify typecheck passes**

Run: `npm run check`
Expected: no errors. (Helpers are defined but not yet used — that's fine.)

- [ ] **Step 8: Commit**

```bash
git add src/lib/editor/preview/tables.ts
git commit -m "feat(tables): add DOM builders for single-widget table"
```

---

## Task 5: `TableWidget` class and `decorateTable` rewrite

**Files:**
- Modify: `src/lib/editor/preview/tables.ts`

Replace the per-row `TableRowWidget` with one `TableWidget` per table. Header line gets `Decoration.replace` with the full table DOM; delimiter and data lines become hidden.

- [ ] **Step 1: Add `TableWidget` class**

In `src/lib/editor/preview/tables.ts`, find `class TableRowWidget extends WidgetType` (line ~396). Add this new class right BEFORE the `TableRowWidget` declaration:

```typescript
class TableWidget extends WidgetType {
  constructor(
    private ctx: TableContext,
    private mode: 'wrap' | 'full'
  ) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'cm-md-table-wrap';
    wrap.setAttribute('data-mode', this.mode);

    const table = document.createElement('span');
    table.className = 'cm-md-table';

    const headerRow = this.ctx.rows.find((r) => r.isHeader);
    if (headerRow) {
      table.appendChild(buildHeaderRow(headerRow, this.ctx, view));
    }

    const dataRows = this.ctx.rows.filter((r) => !r.isDelimiter && !r.isHeader);
    dataRows.forEach((row, i) => {
      table.appendChild(buildDataRow(row, i, this.ctx, view));
    });

    wrap.appendChild(table);

    // "+ add column" — absolutely positioned at right of the header row
    const addCol = mkBtn('+', 'cm-md-table-btn-add cm-md-table-btn-add-col', () =>
      addColumn(view, this.ctx)
    );
    wrap.appendChild(addCol);

    // "+ add row" — inline button at end of last data row plus floating "+" below
    const addRowInline = mkBtn('+', 'cm-md-table-btn-add cm-md-table-btn-add-row', () =>
      addRow(view, this.ctx)
    );
    wrap.appendChild(addRowInline);

    const bottomContainer = document.createElement('span');
    bottomContainer.className = 'cm-md-table-add-row-bottom';
    const addRowBottom = mkBtn('+', 'cm-md-table-btn-add', () => addRow(view, this.ctx));
    bottomContainer.appendChild(addRowBottom);
    wrap.appendChild(bottomContainer);

    return wrap;
  }

  eq(other: TableWidget): boolean {
    if (this.mode !== other.mode) return false;
    if (this.ctx.nodeFrom !== other.ctx.nodeFrom) return false;
    if (this.ctx.nodeTo !== other.ctx.nodeTo) return false;
    if (this.ctx.rows.length !== other.ctx.rows.length) return false;
    if (this.ctx.colCount !== other.ctx.colCount) return false;
    return this.ctx.rows.every((r, i) => {
      const o = other.ctx.rows[i];
      return (
        r.cells.length === o.cells.length &&
        r.cells.every(
          (c, j) => c.text === o.cells[j].text && c.from === o.cells[j].from
        )
      );
    });
  }

  ignoreEvent(): boolean {
    return false;
  }
}
```

- [ ] **Step 2: Rewrite `decorateTable()` decoration loop**

Find `decorateTable` (line ~667). Replace the entire function body. Existing function declaration stays the same; replace just what's between the braces:

```typescript
export function decorateTable(
  view: EditorView,
  node: SyntaxNode,
  builder: RangeSetBuilder<Decoration>
): void {
  const doc = view.state.doc;
  const startLine = doc.lineAt(node.from);
  const endLine = doc.lineAt(node.to);

  const rows: RowData[] = [];
  const colWidths: number[] = [];
  let dataRowIndex = 0;

  for (let i = startLine.number; i <= endLine.number; i++) {
    const line = doc.line(i);
    const isHeader = i === startLine.number;
    const isDelimiter = i === startLine.number + 1;
    const cells = parseCellsWithPositions(line.text, line.from);

    rows.push({
      from: line.from,
      to: line.to,
      text: line.text,
      cells,
      isDelimiter,
      isHeader,
      rowIndex: isDelimiter ? -1 : dataRowIndex++,
    });

    if (!isDelimiter) {
      cells.forEach((cell, col) => {
        colWidths[col] = Math.max(colWidths[col] ?? 0, cell.text.length);
      });
    }
  }

  // Performance guard
  if (rows.length > 500) return;

  const ctx: TableContext = {
    rows,
    colWidths,
    colCount: colWidths.length,
    nodeFrom: node.from,
    nodeTo: node.to,
  };

  const headerRow = rows.find((r) => r.isHeader);
  if (!headerRow) return;

  const mode = getTableMode(view.state, ctx.nodeFrom);

  // Header line: host of the full-table widget
  builder.add(
    headerRow.from,
    headerRow.from,
    Decoration.line({ class: 'cm-md-table-line cm-md-table-header' })
  );
  builder.add(
    headerRow.from,
    headerRow.to,
    Decoration.replace({ widget: new TableWidget(ctx, mode) })
  );

  // Hide all non-header lines (delimiter + data rows)
  for (const row of rows) {
    if (row.isHeader) continue;
    builder.add(
      row.from,
      row.from,
      Decoration.line({ class: 'cm-md-table-line cm-md-table-hidden' })
    );
  }
}
```

- [ ] **Step 3: Delete `TableRowWidget` class**

Delete the entire `TableRowWidget` class (between `class TableRowWidget extends WidgetType {` and the closing `}` at end of `ignoreEvent()`). All references are now replaced by `TableWidget`.

- [ ] **Step 4: Trigger decoration rebuild when toggle is dispatched**

`livePreviewPlugin` needs to rebuild decorations when the wrap/full mode flips. The existing plugin already detects `mermaidRendered` effects — add a sibling check for `toggleTableMode`.

Open `src/lib/editor/preview/plugin.ts`. Add at top with other imports:

```typescript
import { toggleTableMode } from './table-state';
```

Find the `update(update: ViewUpdate)` method (around line 96). It already has:

```typescript
const mermaidUpdate = update.transactions.some((tr) =>
  tr.effects.some((e) => e.is(mermaidRendered))
);
if (update.docChanged || update.viewportChanged || update.selectionSet || treeChanged || mermaidUpdate) {
```

Add a parallel `tableModeUpdate` check and include it in the condition:

```typescript
const mermaidUpdate = update.transactions.some((tr) =>
  tr.effects.some((e) => e.is(mermaidRendered))
);
const tableModeUpdate = update.transactions.some((tr) =>
  tr.effects.some((e) => e.is(toggleTableMode))
);
if (update.docChanged || update.viewportChanged || update.selectionSet || treeChanged || mermaidUpdate || tableModeUpdate) {
```

- [ ] **Step 5: Run tests**

Run: `npm run test -- --run`
Expected: All existing parsing tests PASS. State and encoding tests PASS.

- [ ] **Step 6: Run typecheck**

Run: `npm run check`
Expected: no errors.

- [ ] **Step 7: Visual smoke test**

```bash
lsof -ti:1420 | xargs kill -9 2>/dev/null; npm run dev
```

Open a markdown file with a table. Verify:
- Table renders as one block (not separate rows visually)
- Small table looks similar to before
- Wide table with long cells now wraps text and fits viewport (no horizontal overflow into editor)

Document any visual regressions noted (don't fix yet — Task 6 covers drag/edit, Task 8 covers toggle).

- [ ] **Step 8: Commit**

```bash
git add src/lib/editor/preview/tables.ts src/lib/editor/preview/plugin.ts
git commit -m "feat(tables): replace per-row widgets with single TableWidget"
```

---

## Task 6: Update drag&drop helpers for single-widget DOM

**Files:**
- Modify: `src/lib/editor/preview/tables.ts`

`getRowWraps` and `getHeaderCells` currently walk sibling `.cm-line` elements. Now everything is inside one `.cm-md-table` element. Rewrite to query within it.

- [ ] **Step 1: Replace `getRowWraps`**

In `src/lib/editor/preview/tables.ts`, find `function getRowWraps` (line ~142). Replace the entire function with:

```typescript
function getRowWraps(tableEl: HTMLElement | null): HTMLElement[] {
  if (!tableEl) return [];
  const table = tableEl.closest('.cm-md-table') as HTMLElement | null;
  if (!table) return [];
  return Array.from(
    table.querySelectorAll('.cm-md-table-row-data')
  ) as HTMLElement[];
}
```

- [ ] **Step 2: Replace `getHeaderCells`**

Find `function getHeaderCells` (line ~172). Replace with:

```typescript
function getHeaderCells(anyTableEl: HTMLElement | null): HTMLElement[] {
  if (!anyTableEl) return [];
  const table = anyTableEl.closest('.cm-md-table') as HTMLElement | null;
  if (!table) return [];
  const header = table.querySelector('.cm-md-table-row-header');
  if (!header) return [];
  // Skip the leading ctrl-cell (first child)
  return Array.from(
    header.querySelectorAll('.cm-md-table-cell:not(.cm-md-table-row-ctrl)')
  ) as HTMLElement[];
}
```

- [ ] **Step 3: Inspect `startRowDrag` and `startColDrag` for stale assumptions**

Read `startRowDrag` (line ~188) and `startColDrag` (search for `function startColDrag`). Look for references to `cm-md-table-row-wrap` — that class is going away. If found, replace with `cm-md-table-row` or `cm-md-table-cell` as appropriate.

If you see `wrap.classList.add('cm-md-table-dragging')` (or similar on a wrap element), it should now operate on the `.cm-md-table-row` element passed in. Update accordingly.

If you see indicator positioning via `.cm-content` or `.cm-line` lookup, change to `.cm-md-table` for both drag types — that's the new container.

Specifically:
- In `startRowDrag`, the `wrapEl` parameter is now the `.cm-md-table-row` element passed by `buildDataCtrlCell`. Rename to `rowEl` if useful, but ensure `wraps[i].getBoundingClientRect()` calls in onMove keep working — `wraps` is `getRowWraps(...)` which now returns `.cm-md-table-row-data` elements. Rects still work for hit-testing.
- For indicator container in onMove: replace any `wrapEl.closest('.cm-content')` with `wrapEl.closest('.cm-md-table')` if needed. The indicator stays absolutely positioned against `document.body`, so `getBoundingClientRect` already gives viewport coords.

- [ ] **Step 4: Visual test drag&drop**

Run: `npm run dev` (browser at http://localhost:1420; or `npm run dev:app` for Tauri shell with renamed identifier)

- Drag a row to reorder — works
- Drag a column to reorder — works
- Drag indicators (horizontal line for rows, vertical for cols) appear at correct positions

If broken, debug in browser dev tools (`mcp__tauri__webview_dom_snapshot` or manual inspect).

- [ ] **Step 5: Commit**

```bash
git add src/lib/editor/preview/tables.ts
git commit -m "fix(tables): update drag&drop helpers for single-widget DOM"
```

---

## Task 7: Multi-line cell editor (textarea)

**Files:**
- Modify: `src/lib/editor/preview/tables.ts`

Replace `<input>` with `<textarea>` plus auto-grow, and integrate the encode/decode helpers so newlines and pipes roundtrip correctly.

- [ ] **Step 1: Add encoding imports**

At the top of `tables.ts`, add:

```typescript
import { encodeForCommit, decodeForEdit } from './table-encoding';
```

- [ ] **Step 2: Rewrite `showCellEditor`**

Find `function showCellEditor` (line ~622). Replace the entire function with:

```typescript
function showCellEditor(view: EditorView, cellEl: HTMLElement, cell: CellInfo): void {
  document.querySelector('.cm-md-table-editor')?.remove();

  const rect = cellEl.getBoundingClientRect();
  const originalColor = cellEl.style.color;
  cellEl.style.color = 'transparent';

  const ta = document.createElement('textarea');
  ta.className = 'cm-md-table-editor';
  ta.value = decodeForEdit(cell.text);
  ta.rows = 1;
  ta.style.position = 'fixed';
  ta.style.left = `${rect.left}px`;
  ta.style.top = `${rect.top}px`;
  ta.style.width = `${Math.max(rect.width, 100)}px`;

  const grow = (): void => {
    ta.style.height = '0';
    ta.style.height = `${Math.max(ta.scrollHeight, rect.height)}px`;
  };
  ta.addEventListener('input', grow);

  let committed = false;
  const cleanup = (): void => {
    cellEl.style.color = originalColor;
  };
  const commit = (): void => {
    if (committed) return;
    committed = true;
    const newText = encodeForCommit(ta.value);
    ta.remove();
    cleanup();
    if (newText !== cell.text) {
      view.dispatch({
        changes: { from: cell.from, to: cell.to, insert: newText },
      });
    }
    view.focus();
  };

  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      committed = true;
      ta.remove();
      cleanup();
      view.focus();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      commit();
    }
    // Plain Enter -> textarea default newline behavior
  });
  ta.addEventListener('blur', () => setTimeout(commit, 50));

  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  grow(); // initial size
}
```

- [ ] **Step 3: Run typecheck**

Run: `npm run check`
Expected: no errors.

- [ ] **Step 4: Visual test cell editor**

Run: `npm run dev` (browser at http://localhost:1420; or `npm run dev:app` for Tauri shell with renamed identifier)

- Double-click a short cell → textarea opens, 1 line high
- Type some text, press Enter → newline added, textarea grows; press Cmd+Enter → commits, markdown source contains `<br>`
- Re-open the same cell → textarea shows newline (not `<br>`)
- Type `|` in cell, commit → markdown source contains `\|`; re-open shows `|` (not `\|`)
- Esc cancels with no change

- [ ] **Step 5: Commit**

```bash
git add src/lib/editor/preview/tables.ts
git commit -m "feat(tables): multi-line cell editor with <br>/pipe roundtrip"
```

---

## Task 8: Selection snap-out from hidden table lines

**Files:**
- Create: `src/lib/editor/preview/table-selection.ts`
- Modify: `src/lib/editor/setup.ts`

When the user navigates with arrow keys past a table, the cursor can land on a hidden delimiter or data line (which has `height: 0`). The caret disappears. We listen for selection changes and redirect.

- [ ] **Step 1: Create the listener**

Create `src/lib/editor/preview/table-selection.ts`:

```typescript
import { EditorView, type ViewUpdate } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';

/**
 * If the main selection lands inside a non-header table line (delimiter or
 * data row), snap it to either the header (moving up) or the line after the
 * table (moving down). Hidden lines are visually zero-height and would lose
 * the caret without this redirect.
 */
export const tableSelectionSnapOut = EditorView.updateListener.of(
  (update: ViewUpdate) => {
    if (!update.selectionSet) return;

    const state = update.state;
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);

    // Find a Table syntax node that contains this line
    const tree = syntaxTree(state);
    let tableNode: { from: number; to: number } | null = null;
    tree.iterate({
      from: line.from,
      to: line.to,
      enter(node) {
        if (node.name === 'Table' && node.from <= line.from && node.to >= line.to) {
          tableNode = { from: node.from, to: node.to };
          return false;
        }
        return undefined;
      },
    });
    if (!tableNode) return;

    const headerLine = state.doc.lineAt(tableNode.from);
    // We only redirect when selection is on a NON-header table line
    if (line.from === headerLine.from) return;

    const prevHead = update.startState.selection.main.head;
    const movedDown = head > prevHead;

    let targetPos: number;
    if (movedDown) {
      const lastLineNo = state.doc.lineAt(tableNode.to).number;
      if (lastLineNo < state.doc.lines) {
        targetPos = state.doc.line(lastLineNo + 1).from;
      } else {
        targetPos = headerLine.from; // no line after — fall back to header
      }
    } else {
      targetPos = headerLine.from;
    }

    // Avoid infinite loops: only dispatch if target differs from current
    if (targetPos === head) return;

    queueMicrotask(() => {
      update.view.dispatch({
        selection: { anchor: targetPos },
        userEvent: 'select.snapout',
      });
    });
  }
);
```

- [ ] **Step 2: Register the listener in setup**

Modify `src/lib/editor/setup.ts`. Add the import:

```typescript
import { tableSelectionSnapOut } from './preview/table-selection';
```

In `createExtensions()` return array, add `tableSelectionSnapOut` after `previewCompartment.of(livePreviewPlugin)`:

```typescript
    previewCompartment.of(livePreviewPlugin),
    tableSelectionSnapOut,
    hoverBlockMenu(),
```

- [ ] **Step 3: Run typecheck**

Run: `npm run check`
Expected: no errors.

- [ ] **Step 4: Visual test selection redirect**

Run: `npm run dev` (browser at http://localhost:1420; or `npm run dev:app` for Tauri shell with renamed identifier)

- Open a file with a table, place cursor on the line above the table, press Down — cursor lands on header line (or skips to first line after table if Down again past header). Caret stays visible at all times.
- Place cursor on the line after the table, press Up — cursor lands on header line.
- Click on the empty area where a delimiter would be — cursor snaps out.
- Type plain text near the table — works normally, no recursion.

- [ ] **Step 5: Commit**

```bash
git add src/lib/editor/preview/table-selection.ts src/lib/editor/setup.ts
git commit -m "feat(tables): snap selection out of hidden table lines"
```

---

## Task 9: Prune obsolete CSS

**Files:**
- Modify: `src/styles/editor.css`

The old `.cm-md-table-row-wrap*` classes and friends are no longer rendered. Remove them.

- [ ] **Step 1: Remove obsolete blocks**

Delete the following CSS blocks (use Edit; line numbers are approximate, find by class name):

- `.cm-md-table-row-wrap` (line ~210)
- `.cm-md-table-header .cm-md-table-row-wrap` (line ~221)
- `:root[data-theme='light'] .cm-md-table-header .cm-md-table-row-wrap` (line ~228)
- `.cm-md-table-even .cm-md-table-row-wrap` (line ~232)
- `.cm-md-table-row-wrap-last` (line ~236)
- `.cm-md-table-row-wrap-header` (line ~240)
- The old `.cm-md-table-row` block with `display: inline-flex` (line ~244) — already overridden by nested `.cm-md-table .cm-md-table-row`, but remove the old standalone rule to avoid confusion
- The old `.cm-md-table-cell` block with `display: inline-block` (line ~249) — same reason
- `.cm-md-table-sep` (line ~294) — no longer used (cells have borders)
- Hover selectors referencing `.cm-md-table-row-wrap`:
  - `.cm-md-table-row-wrap:hover .cm-md-table-btn-del,` etc. — replace `row-wrap` with `row` in these selectors. Concretely, every selector that contains `.cm-md-table-row-wrap` becomes `.cm-md-table-row` instead. Use Edit's `replace_all` carefully or do it block by block.
- `.cm-md-table-add-row-bottom` and the floating "+" container at line ~427 — the new design has the "+" inline at the right of the table; the floating bottom button can stay if we want, OR be removed. For minimal disruption, **keep** it but update its parent selector if it references `row-wrap`.

For each block: open the file, find the selector, delete the entire rule (selector + braces + contents).

- [ ] **Step 2: Replace `cm-md-table-row-wrap` references in hover selectors**

For selectors that look like:

```css
.cm-md-table-row-wrap:hover .cm-md-table-btn-del,
```

Change to:

```css
.cm-md-table-row:hover .cm-md-table-btn-del,
```

Apply this rename across all `.cm-md-table-row-wrap` occurrences that remain.

- [ ] **Step 3: Verify CSS still loads and tables look right**

Run: `npm run dev` (browser at http://localhost:1420; or `npm run dev:app` for Tauri shell with renamed identifier)

- Hover over a row — del/drag buttons fade in
- Hover over a header cell — col-ctrl appears
- Hover over the table — "+" buttons appear
- All previous visual states (header gradient, even-row bg, last-row radius) intact

- [ ] **Step 4: Commit**

```bash
git add src/styles/editor.css
git commit -m "chore(tables): remove obsolete per-row-wrap CSS"
```

---

## Task 10: Update preview/CLAUDE.md with new architecture

**Files:**
- Modify: `src/lib/editor/preview/CLAUDE.md`

Reflect the new single-widget structure so future readers don't have stale info.

- [ ] **Step 1: Update the Tables row in the file-summary table**

In `src/lib/editor/preview/CLAUDE.md`, find the line:

```
| `tables.ts` | GFM tables | Line + replace (row widgets) |
```

Replace with:

```
| `tables.ts` | GFM tables | Line + replace (single TableWidget on header line, other lines hidden) |
```

- [ ] **Step 2: Replace the "Widget `eq()` Must Compare `ctx`" section**

The existing section references `TableRowWidget`. Update the heading to `TableWidget` and the code snippet to compare `mode` plus the existing ctx fields. Use Edit to replace the block.

- [ ] **Step 3: Replace the "Cell Editing Overlay" section**

Update to mention `<textarea>` with auto-grow, Cmd+Enter to commit, and `<br>` / `\|` roundtrip via `table-encoding.ts`.

- [ ] **Step 4: Replace the "Visual Styles Live on Widget Wrapper, Not `.cm-line`" section**

Update class references: backgrounds now live on `.cm-md-table-row-*` selectors inside `.cm-md-table`, not on `.cm-md-table-row-wrap`.

- [ ] **Step 5: Add a new "Per-Table Mode (Wrap/Full)" section**

After the "Cell Editing Overlay" section, add:

```markdown
### Per-Table Mode (Wrap/Full)

Tables default to `wrap` mode (`max-width: 100%`, cells word-wrap). The header
row's leading ctrl-cell contains a toggle button that dispatches a
`toggleTableMode` StateEffect carrying the table's `nodeFrom`. The
`tableModeField` is a `RangeSet<TableModeValue>` that remaps positions through
edits (`value.map(tr.changes)`). The mode is read by `decorateTable` and
applied as a `data-mode` attribute on the widget root.

State lives in memory only — closing the file resets all tables to `wrap`.
```

- [ ] **Step 6: Add a "Selection Snap-Out" section**

After the "Per-Table Mode" section:

```markdown
### Selection Snap-Out from Hidden Lines

Delimiter and data lines have `height: 0` so the caret would disappear if the
user navigated onto them. `table-selection.ts` registers an
`EditorView.updateListener` that detects selection on a non-header table line
and dispatches a redirect to either the header line (moved up) or the line
after the table (moved down).
```

- [ ] **Step 7: Update the "Hover Controls" section**

Find the "Hover Controls (±)" section in `CLAUDE.md`. Replace its bullet list with:

```markdown
- **Toggle wrap/full (⇔)**: inline button in the header row's leading ctrl-cell
- **Add row (+)**: inline button at the end of the last data row, plus floating "+" below the table
- **Add column (+)**: `position: absolute` button at the right edge of the header row
- **Delete row (−)**: inline button in each data row's ctrl-cell (left of the drag handle, if >1 data rows)
- **Delete column (−)**: positioned next to each header cell's drag handle inside `.cm-md-table-col-ctrl`

All buttons use `opacity: 0` → `opacity: 0.5` on parent hover → `opacity: 1` on button hover.
Buttons use `mousedown` (not `click`) to fire before CM6 processes the event.
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/editor/preview/CLAUDE.md
git commit -m "docs(tables): update CLAUDE.md for single-widget architecture"
```

---

## Task 11: Final QA pass and validation

**Files:** none (manual verification)

Run through every validation scenario from the spec. If anything fails, fix it; otherwise commit any small follow-ups.

- [ ] **Step 1: Start dev server**

```bash
lsof -ti:1420 | xargs kill -9 2>/dev/null; npm run dev
```

- [ ] **Step 2: Run through validation plan**

For each item in spec section "Validation Plan":

1. Small table (3×2) renders identically to current main. Hover controls all present and styled.
2. Wide table (5+ columns, long text) wraps cells, fits viewport without horizontal overflow.
3. Click toggle button on wide table → table goes to full mode and overflows. Click again → returns to wrap mode.
4. Resize window — wrap-mode reflows; full-mode stays at natural width.
5. Column alignment: header ctrl-cell and data ctrl-cells stay aligned. Verify by visual inspection: drag handle in header column aligns vertically with drag handle in each data row.
6. Double-click cell with long text → textarea opens, auto-grows. Cmd+Enter commits with `<br>` in source.
7. Type `|` in cell, commit. Re-open cell — pipe intact. Source shows `\|`.
8. Add/delete row/column — column alignment holds across operations.
9. Drag row to reorder — works as today.
10. Press Down past header into table — cursor snaps to below the table or onto header.
11. Two adjacent tables — toggling one does not affect the other.
12. Close file, reopen — both tables back to wrap (default).

- [ ] **Step 3: Run all tests + typecheck + lint**

```bash
npm run test -- --run && npm run check
```

Expected: all PASS, no errors.

- [ ] **Step 4: Cargo clippy (Rust side)**

```bash
cargo clippy --manifest-path src-tauri/Cargo.toml
```

Expected: no new warnings.

- [ ] **Step 5: Commit fixes (if any)**

If you made any small adjustments during QA, commit them:

```bash
git add -A
git commit -m "fix(tables): QA follow-ups"
```

Otherwise skip.

- [ ] **Step 6: Verify branch state**

```bash
git log --oneline main..HEAD
```

Expected: 10-11 commits, each focused on one task.

---

## Self-Review Checklist (for the implementer)

Before considering this plan done, verify:

- [ ] All spec sections are covered by at least one task
- [ ] No `TODO` / `TBD` / "implement later" text remains
- [ ] Type names match across tasks (`TableMode`, `TableModeValue`, `tableModeField`, `toggleTableMode`, `getTableMode`)
- [ ] CSS class names are consistent: `cm-md-table-wrap`, `cm-md-table`, `cm-md-table-row`, `cm-md-table-row-header`, `cm-md-table-row-data`, `cm-md-table-row-ctrl`, `cm-md-table-cell`, `cm-md-table-hidden`, `cm-md-table-btn-toggle`
- [ ] No reference to the removed `TableRowWidget` class
- [ ] `getTableMode` and `toggleTableMode` are exported from `table-state.ts`
- [ ] `encodeForCommit` / `decodeForEdit` are exported from `table-encoding.ts`
