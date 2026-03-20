import type { EditorView } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';

/**
 * Check if the cursor is within a range, used to skip decorations
 * when the user is editing that element.
 *
 * For block-level elements, checks exact range containment.
 * For inline elements, checks if cursor is on the same line.
 */
export function cursorInRange(
  view: EditorView,
  from: number,
  to: number,
  blockLevel: boolean = false
): boolean {
  const { state } = view;
  const cursor = state.selection.main;

  if (blockLevel) {
    return cursor.from >= from && cursor.from <= to;
  }

  const line = state.doc.lineAt(from);
  return cursor.from >= line.from && cursor.from <= line.to;
}

export function nodeRange(node: SyntaxNode): { from: number; to: number } {
  return { from: node.from, to: node.to };
}
