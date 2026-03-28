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

    const row = document.createElement('span');
    row.className = 'cm-md-table-row';

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
      cellEl.textContent = cell.text;

      // Double-click to edit
      const cellInfo = cell;
      cellEl.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showCellEditor(view, cellEl, cellInfo);
      });

      // Column delete on header cells
      if (this.isHeader && this.ctx.colCount > 1) {
        const ctrl = document.createElement('span');
        ctrl.className = 'cm-md-table-col-ctrl';
        const del = mkBtn('−', 'cm-md-table-btn-del', () => deleteColumn(view, this.ctx, i));
        ctrl.appendChild(del);
        cellEl.appendChild(ctrl);
        cellEl.classList.add('cm-md-table-cell-has-ctrl');
      }

      row.appendChild(cellEl);
    });

    // "+" add column (right of header row)
    if (this.isHeader) {
      const addCol = mkBtn('+', 'cm-md-table-btn-add cm-md-table-btn-add-col', () => addColumn(view, this.ctx));
      row.appendChild(addCol);
    }

    wrapper.appendChild(row);

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

    // "+" add row (below last data row)
    if (this.isLastDataRow) {
      const add = mkBtn('+', 'cm-md-table-btn-add cm-md-table-btn-add-row', () => addRow(view, this.ctx));
      wrapper.appendChild(add);
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
