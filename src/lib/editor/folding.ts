import { foldService, foldEffect, unfoldEffect, foldedRanges, foldable } from '@codemirror/language';
import { syntaxTree } from '@codemirror/language';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

/**
 * Returns the ATX heading level (1–6) if the line contains an ATXHeading node,
 * or 0 if no heading is found on that line.
 */
function getHeadingLevel(state: EditorState, lineStart: number, lineEnd: number): number {
  let level = 0;
  syntaxTree(state).iterate({
    from: lineStart,
    to: lineEnd,
    enter(node) {
      const name = node.name;
      if (name.startsWith('ATXHeading') && name.length === 11) {
        const parsed = parseInt(name[10], 10);
        if (!isNaN(parsed)) level = parsed;
      }
    },
  });
  return level;
}

/**
 * Fold service for markdown headings.
 */
export const markdownFoldService = foldService.of((state, lineStart, lineEnd) => {
  const headingLevel = getHeadingLevel(state, lineStart, lineEnd);
  if (headingLevel === 0) return null;

  const doc = state.doc;
  const startLine = doc.lineAt(lineStart);
  const foldFrom = startLine.to;
  let foldTo = doc.length;

  const tree = syntaxTree(state);

  for (let i = startLine.number + 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    let nextLevel = 0;

    tree.iterate({
      from: line.from,
      to: line.to,
      enter(node) {
        const name = node.name;
        if (name.startsWith('ATXHeading') && name.length === 11) {
          const parsed = parseInt(name[10], 10);
          if (!isNaN(parsed)) nextLevel = parsed;
        }
      },
    });

    if (nextLevel > 0 && nextLevel <= headingLevel) {
      foldTo = line.from - 1;
      break;
    }
  }

  if (foldFrom >= foldTo) return null;

  return { from: foldFrom, to: foldTo };
});

/**
 * Click handler: clicking the ::before area of a heading toggles fold.
 * The ::before pseudo-element occupies ~28px on the left of heading lines.
 */
export const headingFoldClick: Extension = EditorView.domEventHandlers({
  mousedown(event: MouseEvent, view: EditorView) {
    const target = event.target as HTMLElement;
    const line = target.closest('.cm-line');
    if (!line) return false;

    // Check if it's a heading line
    const isHeading = Array.from(line.classList).some(c => /^cm-md-h[1-6]$/.test(c));
    if (!isHeading) return false;

    // Check if click is in the right area (::after toggle, last 32px)
    const lineRect = line.getBoundingClientRect();
    const clickX = lineRect.right - event.clientX;
    if (clickX > 32) return false; // clicked on text — let CM6 handle it

    // Prevent CM6 from placing cursor
    event.preventDefault();
    event.stopPropagation();

    // Find the document line
    const pos = view.posAtCoords({ x: lineRect.left + 30, y: event.clientY });
    if (pos === null) return false;

    const docLine = view.state.doc.lineAt(pos);
    const level = getHeadingLevel(view.state, docLine.from, docLine.to);
    if (level === 0) return false;

    // Check if this heading is currently folded
    const folded = foldedRanges(view.state);
    let isFolded = false;
    folded.between(docLine.to, docLine.to + 1, () => { isFolded = true; });

    if (isFolded) {
      // Unfold
      const effects: ReturnType<typeof unfoldEffect.of>[] = [];
      folded.between(docLine.to, docLine.to + 1, (from, to) => {
        effects.push(unfoldEffect.of({ from, to }));
      });
      if (effects.length > 0) {
        view.dispatch({ effects });
      }
    } else {
      // Fold — use foldable() which queries all registered fold services
      const range = foldable(view.state, docLine.from, docLine.to);
      if (range) {
        view.dispatch({ effects: foldEffect.of(range) });
      }
    }

    return true;
  },
});
