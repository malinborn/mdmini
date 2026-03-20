import { Decoration, WidgetType } from '@codemirror/view';
import type { EditorView } from '@codemirror/view';
import type { RangeSetBuilder } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { cursorInRange } from './utils';

interface ParsedTable {
  headers: string[];
  rows: string[][];
}

function parseMarkdownTable(text: string): ParsedTable {
  const lines = text.split('\n').filter((l) => l.trim().length > 0);

  const parseRow = (line: string): string[] => {
    return line
      .split('|')
      .slice(1, -1) // Remove empty first/last elements from leading/trailing |
      .map((cell) => cell.trim());
  };

  const isDelimiterRow = (line: string): boolean =>
    /^\s*\|?[\s|:-]+\|?\s*$/.test(line);

  const headers = lines.length > 0 ? parseRow(lines[0]) : [];
  const rows: string[][] = [];

  for (let i = 1; i < lines.length; i++) {
    if (isDelimiterRow(lines[i])) continue;
    rows.push(parseRow(lines[i]));
  }

  return { headers, rows };
}

class TableWidget extends WidgetType {
  constructor(private tableText: string) {
    super();
  }

  toDOM(): HTMLElement {
    const { headers, rows } = parseMarkdownTable(this.tableText);

    const wrapper = document.createElement('div');
    wrapper.className = 'cm-md-table-wrapper';

    const table = document.createElement('table');
    table.className = 'cm-md-table';

    // Header
    if (headers.length > 0) {
      const thead = document.createElement('thead');
      const tr = document.createElement('tr');
      for (const header of headers) {
        const th = document.createElement('th');
        th.textContent = header;
        tr.appendChild(th);
      }
      thead.appendChild(tr);
      table.appendChild(thead);
    }

    // Body
    if (rows.length > 0) {
      const tbody = document.createElement('tbody');
      for (const row of rows) {
        const tr = document.createElement('tr');
        for (let i = 0; i < Math.max(row.length, headers.length); i++) {
          const td = document.createElement('td');
          td.textContent = row[i] ?? '';
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
    }

    wrapper.appendChild(table);
    return wrapper;
  }

  eq(other: TableWidget): boolean {
    return this.tableText === other.tableText;
  }
}

export function decorateTable(
  view: EditorView,
  node: SyntaxNode,
  builder: RangeSetBuilder<Decoration>
): void {
  if (cursorInRange(view, node.from, node.to, true)) return;

  const tableText = view.state.doc.sliceString(node.from, node.to);

  builder.add(
    node.from,
    node.to,
    Decoration.replace({
      widget: new TableWidget(tableText),
      block: true,
    })
  );
}
