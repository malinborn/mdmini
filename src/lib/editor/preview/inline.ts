import { Decoration } from '@codemirror/view';
import type { EditorView } from '@codemirror/view';
import type { RangeSetBuilder } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { cursorInRange } from './utils';

/**
 * CRITICAL: Decoration ordering rules for RangeSetBuilder.
 *
 * 1. Decorations must be added in ascending (from, startSide) order.
 * 2. Decoration.mark() has LOWER startSide than Decoration.replace().
 * 3. At the same `from` position: mark() MUST go BEFORE replace().
 *
 * Pattern: always add mark() for the full range first, then replace() for markers.
 */

export function decorateEmphasis(
  view: EditorView,
  node: SyntaxNode,
  builder: RangeSetBuilder<Decoration>
): void {
  if (cursorInRange(view, node.from, node.to)) return;
  // Mark first (lower startSide), then replace markers
  builder.add(node.from, node.to, Decoration.mark({ class: 'cm-md-italic' }));
  const marks = node.getChildren('EmphasisMark');
  for (const mark of marks) {
    builder.add(mark.from, mark.to, Decoration.replace({}));
  }
}

export function decorateStrongEmphasis(
  view: EditorView,
  node: SyntaxNode,
  builder: RangeSetBuilder<Decoration>
): void {
  if (cursorInRange(view, node.from, node.to)) return;
  builder.add(node.from, node.to, Decoration.mark({ class: 'cm-md-bold' }));
  const marks = node.getChildren('EmphasisMark');
  for (const mark of marks) {
    builder.add(mark.from, mark.to, Decoration.replace({}));
  }
}

export function decorateStrikethrough(
  view: EditorView,
  node: SyntaxNode,
  builder: RangeSetBuilder<Decoration>
): void {
  if (cursorInRange(view, node.from, node.to)) return;
  builder.add(node.from, node.to, Decoration.mark({ class: 'cm-md-strikethrough' }));
  const marks = node.getChildren('StrikethroughMark');
  for (const mark of marks) {
    builder.add(mark.from, mark.to, Decoration.replace({}));
  }
}

export function decorateInlineCode(
  view: EditorView,
  node: SyntaxNode,
  builder: RangeSetBuilder<Decoration>
): void {
  if (cursorInRange(view, node.from, node.to)) return;
  builder.add(node.from, node.to, Decoration.mark({ class: 'cm-md-inline-code' }));
  const marks = node.getChildren('CodeMark');
  for (const mark of marks) {
    builder.add(mark.from, mark.to, Decoration.replace({}));
  }
}

export function decorateLink(
  view: EditorView,
  node: SyntaxNode,
  builder: RangeSetBuilder<Decoration>
): void {
  if (cursorInRange(view, node.from, node.to)) return;
  // Mark the full link range first
  builder.add(node.from, node.to, Decoration.mark({ class: 'cm-md-link' }));
  // Hide [ and ] link markers
  const linkMarks = node.getChildren('LinkMark');
  for (const mark of linkMarks) {
    builder.add(mark.from, mark.to, Decoration.replace({}));
  }
  // Hide (url) portion
  const url = node.getChild('URL');
  if (url) {
    // Include the parentheses around the URL: (url)
    const urlStart = url.from - 1;
    const urlEnd = url.to + 1;
    if (urlStart >= node.from && urlEnd <= node.to) {
      builder.add(urlStart, urlEnd, Decoration.replace({}));
    }
  }
}
