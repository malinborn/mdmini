import { Decoration, WidgetType } from '@codemirror/view';
import type { EditorView } from '@codemirror/view';
import type { RangeSetBuilder } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { markdownTable } from 'markdown-table';

export interface CellInfo {
  text: string;
  from: number;
  to: number;
}

export interface RowData {
  from: number;
  to: number;
  text: string;
  cells: CellInfo[];
  isDelimiter: boolean;
  isHeader: boolean;
  rowIndex: number;
}

export interface TableContext {
  rows: RowData[];
  colWidths: number[];
  colCount: number;
  /** Absolute position of the entire table node in the document. */
  nodeFrom: number;
  nodeTo: number;
}

export function parseCellsWithPositions(text: string, lineFrom: number): CellInfo[] {
  const cells: CellInfo[] = [];
  let i = 0;
  while (i < text.length && text[i] !== '|') i++;
  if (i < text.length) i++;
  let cellStart = i;
  while (i < text.length) {
    if (text[i] === '|' && (i === 0 || text[i - 1] !== '\\')) {
      const raw = text.slice(cellStart, i);
      const trimmed = raw.trim();
      if (trimmed.length > 0) {
        const leadSpaces = raw.length - raw.trimStart().length;
        const from = lineFrom + cellStart + leadSpaces;
        const to = from + trimmed.length;
        cells.push({ text: trimmed, from, to });
      } else {
        // Empty cell — point to the space between pipes for insertion
        const midpoint = lineFrom + cellStart + Math.floor(raw.length / 2);
        cells.push({ text: '', from: midpoint, to: midpoint });
      }
      cellStart = i + 1;
    }
    i++;
  }
  return cells;
}

/** Convert table context to a 2D string array (header + data rows, no delimiter). */
export function tableToGrid(ctx: TableContext): string[][] {
  return ctx.rows
    .filter(r => !r.isDelimiter)
    .map(r => r.cells.map(c => c.text));
}

/** Replace the entire table node with a new markdown table from a 2D grid. */
function replaceTable(view: EditorView, ctx: TableContext, grid: string[][]): void {
  const newMd = markdownTable(grid, { align: null, padding: true });
  view.dispatch({
    changes: { from: ctx.nodeFrom, to: ctx.nodeTo, insert: newMd },
  });
}

function addRow(view: EditorView, ctx: TableContext): void {
  // Insert directly after the last row — use visible placeholders so Lezer
  // includes the row in the Table node (whitespace-only cells get excluded).
  const lastRow = ctx.rows[ctx.rows.length - 1];
  const cells = ctx.colWidths.map(w => ' ' + '-'.padEnd(Math.max(w, 1)) + ' ');
  const newRow = '|' + cells.join('|') + '|';
  view.dispatch({
    changes: { from: lastRow.to, to: lastRow.to, insert: '\n' + newRow },
  });
}

function deleteRow(view: EditorView, ctx: TableContext, dataRowIndex: number): void {
  const grid = tableToGrid(ctx);
  // dataRowIndex 0 = header, 1+ = data rows
  if (grid.length <= 2) return; // keep at least header + 1 row
  grid.splice(dataRowIndex + 1, 1); // +1 because grid[0] is header
  replaceTable(view, ctx, grid);
}

function addColumn(view: EditorView, ctx: TableContext): void {
  const grid = tableToGrid(ctx);
  grid[0].push('New');
  for (let i = 1; i < grid.length; i++) {
    grid[i].push('-');
  }
  replaceTable(view, ctx, grid);
}

function deleteColumn(view: EditorView, ctx: TableContext, colIndex: number): void {
  if (ctx.colCount <= 1) return;
  const grid = tableToGrid(ctx);
  for (const row of grid) {
    row.splice(colIndex, 1);
  }
  replaceTable(view, ctx, grid);
}

// --- Drag and drop helpers ---

interface DragState {
  active: boolean;
  type: 'row' | 'col';
  sourceIndex: number;
  targetIndex: number;
  indicator: HTMLElement | null;
}

const drag: DragState = {
  active: false,
  type: 'row',
  sourceIndex: -1,
  targetIndex: -1,
  indicator: null,
};

function createDropIndicator(vertical: boolean): HTMLElement {
  const el = document.createElement('div');
  el.className = 'cm-md-table-drop-indicator';
  if (vertical) el.classList.add('cm-md-table-drop-indicator-col');
  document.body.appendChild(el);
  return el;
}

function removeDropIndicator(): void {
  drag.indicator?.remove();
  drag.indicator = null;
}

function getRowWraps(tableWrapper: HTMLElement | null): HTMLElement[] {
  if (!tableWrapper) return [];
  const cmLine = tableWrapper.closest('.cm-line') as HTMLElement | null;
  if (!cmLine) return [];

  // Walk BACKWARD to find the first table line (header)
  let firstLine: HTMLElement = cmLine;
  let prev = cmLine.previousElementSibling as HTMLElement | null;
  while (prev && prev.classList.contains('cm-md-table-line')) {
    firstLine = prev;
    prev = prev.previousElementSibling as HTMLElement | null;
  }

  // Walk FORWARD from the first line, collecting all data row wraps
  const wraps: HTMLElement[] = [];
  let el: HTMLElement | null = firstLine;
  while (el) {
    if (el.classList.contains('cm-line') && el.classList.contains('cm-md-table-line') &&
        !el.classList.contains('cm-md-table-header') &&
        !el.classList.contains('cm-md-table-delimiter')) {
      const wrap = el.querySelector('.cm-md-table-row-wrap') as HTMLElement | null;
      if (wrap) wraps.push(wrap);
    } else if (!el.classList.contains('cm-md-table-line')) {
      break; // left the table
    }
    el = el.nextElementSibling as HTMLElement | null;
  }
  return wraps;
}

function getHeaderCells(anyTableEl: HTMLElement | null): HTMLElement[] {
  if (!anyTableEl) return [];
  const cmLine = anyTableEl.closest('.cm-line') as HTMLElement | null;
  if (!cmLine) return [];

  // Check current line first, then walk backward
  let el: HTMLElement | null = cmLine;
  while (el) {
    if (el.classList.contains('cm-md-table-header')) {
      return Array.from(el.querySelectorAll('.cm-md-table-cell')) as HTMLElement[];
    }
    el = el.previousElementSibling as HTMLElement | null;
  }
  return [];
}

function startRowDrag(
  e: MouseEvent,
  view: EditorView,
  ctx: TableContext,
  dataRowIndex: number,
  wrapEl: HTMLElement
): void {
  e.preventDefault();
  e.stopPropagation();

  drag.active = true;
  drag.type = 'row';
  drag.sourceIndex = dataRowIndex;
  drag.targetIndex = dataRowIndex;

  wrapEl.classList.add('cm-md-table-dragging');

  const onMove = (ev: MouseEvent): void => {
    if (!drag.active) return;

    const wraps = getRowWraps(wrapEl);
    if (wraps.length === 0) return;

    let insertBefore = wraps.length; // default: after last
    let bestY = Infinity;

    for (let i = 0; i < wraps.length; i++) {
      const rect = wraps[i].getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const distToTop = Math.abs(ev.clientY - rect.top);
      if (ev.clientY < midY && distToTop < bestY) {
        insertBefore = i;
        bestY = distToTop;
      }
    }

    // targetIndex is the data row index we want to insert before
    drag.targetIndex = insertBefore;

    // Position indicator
    if (!drag.indicator) {
      drag.indicator = createDropIndicator(false);
    }

    const containerRect = wraps[0].closest('.cm-content')?.getBoundingClientRect();
    if (containerRect) {
      if (insertBefore < wraps.length) {
        const targetRect = wraps[insertBefore].getBoundingClientRect();
        drag.indicator.style.top = `${targetRect.top}px`;
        drag.indicator.style.left = `${containerRect.left}px`;
        drag.indicator.style.width = `${containerRect.width}px`;
      } else {
        const lastRect = wraps[wraps.length - 1].getBoundingClientRect();
        drag.indicator.style.top = `${lastRect.bottom}px`;
        drag.indicator.style.left = `${containerRect.left}px`;
        drag.indicator.style.width = `${containerRect.width}px`;
      }
    }
  };

  const onUp = (): void => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.removeEventListener('keydown', onEscape);

    wrapEl.classList.remove('cm-md-table-dragging');
    removeDropIndicator();

    if (!drag.active) return;
    drag.active = false;

    const src = drag.sourceIndex; // 0-based data row index
    const tgt = drag.targetIndex; // insert-before index among data rows

    // No-op if same position or adjacent (moving to its own slot)
    if (tgt === src || tgt === src + 1) return;

    const grid = tableToGrid(ctx);
    // grid[0] = header, grid[1..] = data rows
    const dataRows = grid.slice(1);
    if (src < 0 || src >= dataRows.length) return;

    const [moved] = dataRows.splice(src, 1);
    const insertAt = tgt > src ? tgt - 1 : tgt;
    dataRows.splice(insertAt, 0, moved);

    replaceTable(view, ctx, [grid[0], ...dataRows]);
  };

  const onEscape = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') {
      drag.active = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('keydown', onEscape);
      wrapEl.classList.remove('cm-md-table-dragging');
      removeDropIndicator();
    }
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  document.addEventListener('keydown', onEscape);
}

function startColDrag(
  e: MouseEvent,
  view: EditorView,
  ctx: TableContext,
  colIndex: number,
  headerCellEl: HTMLElement
): void {
  e.preventDefault();
  e.stopPropagation();

  drag.active = true;
  drag.type = 'col';
  drag.sourceIndex = colIndex;
  drag.targetIndex = colIndex;

  headerCellEl.classList.add('cm-md-table-dragging');

  const onMove = (ev: MouseEvent): void => {
    if (!drag.active) return;

    const cells = getHeaderCells(headerCellEl.closest('.cm-md-table-row-wrap') as HTMLElement | null);
    if (cells.length === 0) return;

    let insertBefore = cells.length;
    let bestX = Infinity;

    for (let i = 0; i < cells.length; i++) {
      const rect = cells[i].getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      const distToLeft = Math.abs(ev.clientX - rect.left);
      if (ev.clientX < midX && distToLeft < bestX) {
        insertBefore = i;
        bestX = distToLeft;
      }
    }

    drag.targetIndex = insertBefore;

    if (!drag.indicator) {
      drag.indicator = createDropIndicator(true);
    }

    if (insertBefore < cells.length) {
      const targetRect = cells[insertBefore].getBoundingClientRect();
      const headerRect = cells[0].closest('.cm-line')?.getBoundingClientRect();
      drag.indicator.style.left = `${targetRect.left}px`;
      drag.indicator.style.top = headerRect ? `${headerRect.top}px` : `${targetRect.top}px`;
      drag.indicator.style.height = headerRect ? `${headerRect.height}px` : `${targetRect.height}px`;
    } else {
      const lastRect = cells[cells.length - 1].getBoundingClientRect();
      const headerRect = cells[0].closest('.cm-line')?.getBoundingClientRect();
      drag.indicator.style.left = `${lastRect.right}px`;
      drag.indicator.style.top = headerRect ? `${headerRect.top}px` : `${lastRect.top}px`;
      drag.indicator.style.height = headerRect ? `${headerRect.height}px` : `${lastRect.height}px`;
    }
  };

  const onUp = (): void => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.removeEventListener('keydown', onEscape);

    headerCellEl.classList.remove('cm-md-table-dragging');
    removeDropIndicator();

    if (!drag.active) return;
    drag.active = false;

    const src = drag.sourceIndex;
    const tgt = drag.targetIndex;

    if (tgt === src || tgt === src + 1) return;

    const grid = tableToGrid(ctx);
    const newGrid = grid.map(row => {
      const cols = [...row];
      const [moved] = cols.splice(src, 1);
      const insertAt = tgt > src ? tgt - 1 : tgt;
      cols.splice(insertAt, 0, moved);
      return cols;
    });

    replaceTable(view, ctx, newGrid);
  };

  const onEscape = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') {
      drag.active = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('keydown', onEscape);
      headerCellEl.classList.remove('cm-md-table-dragging');
      removeDropIndicator();
    }
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  document.addEventListener('keydown', onEscape);
}

// --- Widgets ---

class TableRowWidget extends WidgetType {
  constructor(
    private cells: CellInfo[],
    private widths: number[],
    private isHeader: boolean,
    private dataRowIndex: number,
    private ctx: TableContext,
    private isLastDataRow: boolean
  ) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement('span');
    wrapper.className = 'cm-md-table-row-wrap';

    // Row controls (data rows) or header spacer
    if (!this.isHeader) {
      const dataCount = this.ctx.rows.filter(r => !r.isDelimiter && !r.isHeader).length;

      // Small circle delete button (leftmost, harder to accidentally click)
      if (dataCount > 1) {
        const delLeft = mkBtn('−', 'cm-md-table-btn-del cm-md-table-btn-del-row-left', () =>
          deleteRow(view, this.ctx, this.dataRowIndex)
        );
        wrapper.appendChild(delLeft);
      }

      // Drag handle (after delete)
      const dragHandle = mkBtn('⠿', 'cm-md-table-btn-drag cm-md-table-btn-drag-row', () => {});
      dragHandle.addEventListener('mousedown', (e) => {
        startRowDrag(e, view, this.ctx, this.dataRowIndex, wrapper);
      });
      wrapper.appendChild(dragHandle);
    } else {
      // Header gets left padding via CSS --table-row-gutter to match data row controls
      wrapper.classList.add('cm-md-table-row-wrap-header');
    }

    const row = document.createElement('span');
    row.className = 'cm-md-table-row';
    // Consistent min-width across all rows: cells + cell padding + separators
    const totalCellCh = this.widths.reduce((sum, w) => sum + w + 2 + 1, 0);
    const sepCount = this.widths.length - 1;
    row.style.minWidth = `calc(${totalCellCh}ch + ${sepCount}px)`;

    this.cells.forEach((cell, i) => {
      if (i > 0) {
        const sep = document.createElement('span');
        sep.className = 'cm-md-table-sep';
        row.appendChild(sep);
      }

      const cellEl = document.createElement('span');
      cellEl.className = 'cm-md-table-cell';
      if (this.isHeader) cellEl.classList.add('cm-md-table-cell-header');
      cellEl.style.minWidth = `${(this.widths[i] ?? cell.text.length) + 2}ch`;
      renderCellContent(cellEl, cell.text);

      // Double-click to edit
      const cellInfo = cell;
      cellEl.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showCellEditor(view, cellEl, cellInfo);
      });

      // Column controls on header cells
      if (this.isHeader) {
        const ctrl = document.createElement('span');
        ctrl.className = 'cm-md-table-col-ctrl';

        // Column drag handle — before delete
        const colDrag = mkBtn('⠿', 'cm-md-table-btn-drag cm-md-table-btn-drag-col', () => {});
        const colIdx = i;
        colDrag.addEventListener('mousedown', (e) => {
          startColDrag(e, view, this.ctx, colIdx, cellEl);
        });
        ctrl.appendChild(colDrag);

        if (this.ctx.colCount > 1) {
          const del = mkBtn('−', 'cm-md-table-btn-del', () => deleteColumn(view, this.ctx, i));
          ctrl.appendChild(del);
        }

        cellEl.appendChild(ctrl);
        cellEl.classList.add('cm-md-table-cell-has-ctrl');
      }

      row.appendChild(cellEl);
    });

    wrapper.appendChild(row);

    // "+" add column (right of header row, in wrapper so row width is consistent)
    if (this.isHeader) {
      const addCol = mkBtn('+', 'cm-md-table-btn-add cm-md-table-btn-add-col', () => addColumn(view, this.ctx));
      wrapper.appendChild(addCol);
    }

    // "−" delete row (on data rows, if more than 1 data row)
    if (!this.isHeader) {
      const dataCount = this.ctx.rows.filter(r => !r.isDelimiter && !r.isHeader).length;
      if (dataCount > 1) {
        const del = mkBtn('−', 'cm-md-table-btn-del cm-md-table-btn-del-row', () =>
          deleteRow(view, this.ctx, this.dataRowIndex)
        );
        wrapper.appendChild(del);
      }
    }

    // Mark last data row for bottom border-radius
    if (this.isLastDataRow) {
      wrapper.classList.add('cm-md-table-row-wrap-last');
    }

    // "+" add row (inline, right of delete button on last data row)
    if (this.isLastDataRow) {
      const add = mkBtn('+', 'cm-md-table-btn-add cm-md-table-btn-add-row', () => addRow(view, this.ctx));
      wrapper.appendChild(add);

      // Floating "+" button centered below the table
      const bottomContainer = document.createElement('span');
      bottomContainer.className = 'cm-md-table-add-row-bottom';
      const addBottom = mkBtn('+', 'cm-md-table-btn-add', () => addRow(view, this.ctx));
      bottomContainer.appendChild(addBottom);
      wrapper.appendChild(bottomContainer);
      wrapper.style.overflow = 'visible';
    }

    return wrapper;
  }

  eq(other: TableRowWidget): boolean {
    return (
      this.isHeader === other.isHeader &&
      this.dataRowIndex === other.dataRowIndex &&
      this.isLastDataRow === other.isLastDataRow &&
      // Compare ctx to detect structural table changes (added/removed rows/cols)
      this.ctx.nodeFrom === other.ctx.nodeFrom &&
      this.ctx.nodeTo === other.ctx.nodeTo &&
      this.ctx.rows.length === other.ctx.rows.length &&
      this.ctx.colCount === other.ctx.colCount &&
      this.cells.length === other.cells.length &&
      this.cells.every((c, i) => c.text === other.cells[i].text && c.from === other.cells[i].from) &&
      this.widths.every((w, i) => w === other.widths[i])
    );
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** Render inline markdown (code, bold, italic, strikethrough) into a cell element. */
function renderCellContent(cellEl: HTMLElement, text: string): void {
  if (!text) return;

  // Regex for inline markdown tokens — order matters (longer patterns first)
  const inlineRegex = /(`+)(.*?)\1|(\*\*\*|___)(.*?)\3|(\*\*|__)(.*?)\5|(\*|_)(.*?)\7|(~~)(.*?)\9/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = inlineRegex.exec(text)) !== null) {
    // Append plain text before this match
    if (match.index > lastIndex) {
      cellEl.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }

    if (match[1]) {
      // Code: `code` or ``code``
      const code = document.createElement('code');
      code.className = 'cm-md-table-inline-code';
      code.textContent = match[2];
      cellEl.appendChild(code);
    } else if (match[3]) {
      // Bold+italic: ***text*** or ___text___
      const el = document.createElement('strong');
      const em = document.createElement('em');
      em.textContent = match[4];
      el.appendChild(em);
      cellEl.appendChild(el);
    } else if (match[5]) {
      // Bold: **text** or __text__
      const el = document.createElement('strong');
      el.textContent = match[6];
      cellEl.appendChild(el);
    } else if (match[7]) {
      // Italic: *text* or _text_
      const el = document.createElement('em');
      el.textContent = match[8];
      cellEl.appendChild(el);
    } else if (match[9]) {
      // Strikethrough: ~~text~~
      const el = document.createElement('s');
      el.textContent = match[10];
      cellEl.appendChild(el);
    }

    lastIndex = match.index + match[0].length;
  }

  // Append remaining plain text
  if (lastIndex < text.length) {
    cellEl.appendChild(document.createTextNode(text.slice(lastIndex)));
  }

  // If nothing was parsed (no inline markdown), just set text
  if (lastIndex === 0) {
    cellEl.textContent = text;
  }
}

function mkBtn(text: string, className: string, onClick: () => void): HTMLElement {
  const btn = document.createElement('button');
  btn.className = `cm-md-table-btn ${className}`;
  btn.textContent = text;
  btn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });
  return btn;
}

function showCellEditor(view: EditorView, cellEl: HTMLElement, cell: CellInfo): void {
  document.querySelector('.cm-md-table-editor')?.remove();

  const rect = cellEl.getBoundingClientRect();
  const originalColor = cellEl.style.color;
  cellEl.style.color = 'transparent';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'cm-md-table-editor';
  input.value = cell.text;
  input.style.position = 'fixed';
  input.style.left = `${rect.left}px`;
  input.style.top = `${rect.top}px`;
  input.style.width = `${Math.max(rect.width, 100)}px`;
  input.style.height = `${rect.height}px`;

  let committed = false;
  const cleanup = () => { cellEl.style.color = originalColor; };
  const commit = () => {
    if (committed) return;
    committed = true;
    const newText = input.value;
    input.remove();
    cleanup();
    if (newText !== cell.text) {
      view.dispatch({ changes: { from: cell.from, to: cell.to, insert: newText } });
    }
    view.focus();
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); committed = true; input.remove(); cleanup(); view.focus(); }
    else if (e.key === 'Tab') { e.preventDefault(); commit(); }
  });
  input.addEventListener('blur', () => setTimeout(commit, 50));

  document.body.appendChild(input);
  input.focus();
  input.select();
}

// --- Main decoration function ---

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
    // Delimiter is always the 2nd line (right after header) — don't use regex
    // so users can freely type dashes in data cells
    const isDelimiter = i === startLine.number + 1;
    const cells = parseCellsWithPositions(line.text, line.from);

    rows.push({
      from: line.from, to: line.to, text: line.text,
      cells, isDelimiter, isHeader,
      rowIndex: isDelimiter ? -1 : dataRowIndex++,
    });

    if (!isDelimiter) {
      cells.forEach((cell, col) => {
        colWidths[col] = Math.max(colWidths[col] ?? 0, cell.text.length);
      });
    }
  }

  const ctx: TableContext = {
    rows, colWidths,
    colCount: colWidths.length,
    nodeFrom: node.from,
    nodeTo: node.to,
  };

  const lastDataIdx = rows.reduce((acc, r, i) => (!r.isDelimiter && !r.isHeader ? i : acc), -1);
  let dataIdx = 0;

  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];

    if (row.isDelimiter) {
      builder.add(row.from, row.from, Decoration.line({ class: 'cm-md-table-line cm-md-table-delimiter' }));
      continue;
    }

    const classes = ['cm-md-table-line'];
    if (row.isHeader) classes.push('cm-md-table-header');
    else if (dataIdx % 2 === 1) classes.push('cm-md-table-even');

    builder.add(row.from, row.from, Decoration.line({ class: classes.join(' ') }));

    const currentDataIdx = row.isHeader ? -1 : dataIdx;
    if (!row.isHeader) dataIdx++;

    builder.add(row.from, row.to, Decoration.replace({
      widget: new TableRowWidget(
        row.cells, colWidths, row.isHeader,
        currentDataIdx, ctx, ri === lastDataIdx
      ),
    }));
  }
}
