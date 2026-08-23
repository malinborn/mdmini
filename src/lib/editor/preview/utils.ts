import type { Decoration, EditorView } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';

/**
 * What a decorator needs from the thing it emits into. `RangeSetBuilder`
 * satisfies this structurally, so a real builder can still be passed straight
 * through; the point is that `plugin.ts` can also pass a sink that collects and
 * sorts. It has to, now that the decoration pass descends into nested inline
 * nodes: an outer span emits its closing marker *after* the inner span's
 * decorations, which is descending order, and `RangeSetBuilder` requires
 * ascending `(from, startSide)` and throws otherwise.
 */
export interface DecoSink {
  add(from: number, to: number, value: Decoration): void;
}

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
