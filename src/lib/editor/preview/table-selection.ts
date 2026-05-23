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
        targetPos = headerLine.from;
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
