import { Decoration } from '@codemirror/view';
import type { EditorView } from '@codemirror/view';
import type { RangeSetBuilder } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { cursorInRange } from './utils';

const headingClasses: Record<string, string> = {
  ATXHeading1: 'cm-md-h1',
  ATXHeading2: 'cm-md-h2',
  ATXHeading3: 'cm-md-h3',
  ATXHeading4: 'cm-md-h4',
  ATXHeading5: 'cm-md-h5',
  ATXHeading6: 'cm-md-h6',
};

export function decorateHeading(
  view: EditorView,
  node: SyntaxNode,
  builder: RangeSetBuilder<Decoration>
): void {
  const cls = headingClasses[node.name];
  if (!cls) return;
  if (cursorInRange(view, node.from, node.to)) return;

  const line = view.state.doc.lineAt(node.from);
  // Line decoration FIRST (lower startSide)
  builder.add(line.from, line.from, Decoration.line({ class: cls }));

  // Then hide "## " prefix via replace
  const mark = node.getChild('HeaderMark');
  if (mark) {
    const hideEnd = Math.min(mark.to + 1, node.to);
    builder.add(mark.from, hideEnd, Decoration.replace({}));
  }
}
