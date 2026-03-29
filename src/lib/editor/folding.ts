import { foldService } from '@codemirror/language';
import { syntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';

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
      // ATXHeading1 … ATXHeading6 — all exactly 11 chars
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
 *
 * When the cursor line contains a heading, the foldable range starts at the
 * end of that line and extends to just before the next heading of the same or
 * higher level (lower number = higher level), or to the end of the document.
 *
 * Examples:
 *   ## Section       ← fold start
 *   content…
 *   ### Sub          ← still inside H2 fold
 *   more content…
 *   ## Next Section  ← fold ends before this line (same level)
 */
export const markdownFoldService = foldService.of((state, lineStart, lineEnd) => {
  const headingLevel = getHeadingLevel(state, lineStart, lineEnd);
  if (headingLevel === 0) return null;

  const doc = state.doc;
  const startLine = doc.lineAt(lineStart);
  const foldFrom = startLine.to; // end of the heading line
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

    // Stop at a heading of the same or higher level (lower number)
    if (nextLevel > 0 && nextLevel <= headingLevel) {
      // Exclude the trailing newline before the next heading line
      foldTo = line.from - 1;
      break;
    }
  }

  if (foldFrom >= foldTo) return null;

  return { from: foldFrom, to: foldTo };
});
