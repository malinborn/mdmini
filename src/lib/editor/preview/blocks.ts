import { Decoration, WidgetType } from '@codemirror/view';
import type { EditorView } from '@codemirror/view';
import type { RangeSetBuilder } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { cursorInRange } from './utils';

class HorizontalRuleWidget extends WidgetType {
  toDOM(): HTMLElement {
    const hr = document.createElement('hr');
    hr.className = 'cm-md-hr';
    return hr;
  }

  eq(): boolean {
    return true;
  }
}

export function decorateHorizontalRule(
  view: EditorView,
  node: SyntaxNode,
  builder: RangeSetBuilder<Decoration>
): void {
  if (cursorInRange(view, node.from, node.to, true)) return;

  const line = view.state.doc.lineAt(node.from);
  builder.add(
    line.from,
    line.to,
    Decoration.replace({
      widget: new HorizontalRuleWidget(),
      block: true,
    })
  );
}

export function decorateFencedCode(
  view: EditorView,
  node: SyntaxNode,
  builder: RangeSetBuilder<Decoration>
): void {
  if (cursorInRange(view, node.from, node.to, true)) return;

  const doc = view.state.doc;
  const startLine = doc.lineAt(node.from);
  const endLine = doc.lineAt(node.to);

  // Collect all line numbers in this code block
  const totalLines = endLine.number - startLine.number + 1;

  for (let i = startLine.number; i <= endLine.number; i++) {
    const line = doc.line(i);
    const isFirst = i === startLine.number;
    const isLast = i === endLine.number;

    if (isFirst || isLast) {
      // Hide opening and closing fence lines via CSS
      builder.add(line.from, line.from, Decoration.line({ class: 'cm-md-code-fence-hidden' }));
    } else {
      // Code content lines — apply background + optional radius classes
      const isFirstCode = i === startLine.number + 1;
      const isLastCode = i === endLine.number - 1;

      let cls = 'cm-md-code-line';
      if (isFirstCode && totalLines > 2) cls += ' cm-md-code-block-start';
      if (isLastCode && totalLines > 2) cls += ' cm-md-code-block-end';
      // Single-line code block (only content between fences)
      if (totalLines === 3 && isFirstCode) cls = 'cm-md-code-line cm-md-code-block-start cm-md-code-block-end';

      builder.add(line.from, line.from, Decoration.line({ class: cls }));
    }
  }
}
