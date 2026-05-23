import { EditorView, type ViewUpdate } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import type { EditorState, Line } from '@codemirror/state';

function findContainingTable(
  state: EditorState,
  line: Line
): { from: number; to: number } | null {
  let result: { from: number; to: number } | null = null;
  syntaxTree(state).iterate({
    from: line.from,
    to: line.to,
    enter(node) {
      if (
        node.name === 'Table' &&
        node.from <= line.from &&
        node.to >= line.to
      ) {
        result = { from: node.from, to: node.to };
        return false;
      }
      return undefined;
    },
  });
  return result;
}

/**
 * If the main selection lands inside a non-header table line (delimiter or
 * data row), snap it to either the header (moving up) or the line after the
 * table (moving down). Hidden lines are visually zero-height and would lose
 * the caret without this redirect.
 */
export const tableSelectionSnapOut = EditorView.updateListener.of(
  (update: ViewUpdate) => {
    if (!update.selectionSet) return;
    // Guard against re-entry: our own dispatch carries this userEvent tag
    if (
      update.transactions.some((tr) => tr.isUserEvent('select.snapout'))
    ) {
      return;
    }

    const state = update.state;
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);

    const tableNode = findContainingTable(state, line);
    if (!tableNode) return;

    const headerLine = state.doc.lineAt(tableNode.from);
    if (line.from === headerLine.from) return;

    const prevHead = update.startState.selection.main.head;
    const movedDown = head > prevHead;

    let targetPos: number;
    if (movedDown) {
      const lastLineNo = state.doc.lineAt(tableNode.to).number;
      if (lastLineNo < state.doc.lines) {
        targetPos = state.doc.line(lastLineNo + 1).from;
      } else {
        // End of document — nowhere to go past the table; stay put rather
        // than bounce back to the header
        return;
      }
    } else {
      targetPos = headerLine.from;
    }

    if (targetPos === head) return;

    queueMicrotask(() => {
      update.view.dispatch({
        selection: { anchor: targetPos },
        userEvent: 'select.snapout',
      });
    });
  }
);
