import { Decoration } from '@codemirror/view';
import type { EditorView } from '@codemirror/view';
import type { RangeSetBuilder } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { cursorInRange } from './utils';

export function decorateTable(
  view: EditorView,
  node: SyntaxNode,
  builder: RangeSetBuilder<Decoration>
): void {
  if (cursorInRange(view, node.from, node.to, true)) return;

  const doc = view.state.doc;
  const startLine = doc.lineAt(node.from);
  const endLine = doc.lineAt(node.to);

  for (let i = startLine.number; i <= endLine.number; i++) {
    const line = doc.line(i);
    const isDelimiter = /^\s*\|[\s|:-]+\|\s*$/.test(line.text);

    if (isDelimiter) {
      // Hide delimiter row (|---|---|) via line class
      builder.add(line.from, line.from, Decoration.line({ class: 'cm-md-table-line cm-md-table-delimiter' }));
    } else if (i === startLine.number) {
      builder.add(line.from, line.from, Decoration.line({ class: 'cm-md-table-line cm-md-table-header' }));
    } else {
      builder.add(line.from, line.from, Decoration.line({ class: 'cm-md-table-line' }));
    }

    // Hide leading and trailing pipes via replace
    const pipeMatch = line.text.match(/^(\s*\|)(.*?)(\|\s*)$/);
    if (pipeMatch) {
      const leadEnd = line.from + pipeMatch[1].length;
      builder.add(line.from, leadEnd, Decoration.replace({}));

      const trailStart = line.from + pipeMatch[1].length + pipeMatch[2].length;
      if (trailStart < line.to) {
        builder.add(trailStart, line.to, Decoration.replace({}));
      }
    }
  }
}
