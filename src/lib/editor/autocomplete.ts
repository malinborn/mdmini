import { keymap } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

function handleEnterInList(view: EditorView): boolean {
  const { state } = view;
  const { from } = state.selection.main;
  const line = state.doc.lineAt(from);
  const text = line.text;

  // Check for list patterns
  const bulletMatch = text.match(/^(\s*)([-*+])\s(.*)$/);
  const numberedMatch = text.match(/^(\s*)(\d+)\.\s(.*)$/);
  const checkboxMatch = text.match(/^(\s*)([-*+])\s\[[ x]\]\s(.*)$/);

  if (checkboxMatch) {
    const [, indent, marker, content] = checkboxMatch;
    if (content.trim() === '') {
      view.dispatch({ changes: { from: line.from, to: line.to, insert: '' } });
      return true;
    }
    const continuation = `\n${indent}${marker} [ ] `;
    view.dispatch({
      changes: { from, insert: continuation },
      selection: { anchor: from + continuation.length },
    });
    return true;
  }

  if (bulletMatch) {
    const [, indent, marker, content] = bulletMatch;
    if (content.trim() === '') {
      view.dispatch({ changes: { from: line.from, to: line.to, insert: '' } });
      return true;
    }
    const continuation = `\n${indent}${marker} `;
    view.dispatch({
      changes: { from, insert: continuation },
      selection: { anchor: from + continuation.length },
    });
    return true;
  }

  if (numberedMatch) {
    const [, indent, num, content] = numberedMatch;
    if (content.trim() === '') {
      view.dispatch({ changes: { from: line.from, to: line.to, insert: '' } });
      return true;
    }
    const next = parseInt(num, 10) + 1;
    const continuation = `\n${indent}${next}. `;
    view.dispatch({
      changes: { from, insert: continuation },
      selection: { anchor: from + continuation.length },
    });
    return true;
  }

  // Code fence auto-close
  const fenceMatch = text.match(/^(\s*)(`{3,})(\w*)\s*$/);
  if (fenceMatch && from === line.to) {
    const [, indent, ticks] = fenceMatch;
    const insert = `\n${indent}\n${indent}${ticks}`;
    view.dispatch({
      changes: { from, insert },
      selection: { anchor: from + 1 + indent.length },
    });
    return true;
  }

  return false;
}

function handleTabInList(view: EditorView, indent: boolean): boolean {
  const { state } = view;
  const { from } = state.selection.main;
  const line = state.doc.lineAt(from);
  const text = line.text;

  if (!/^\s*[-*+\d]/.test(text)) return false;

  if (indent) {
    view.dispatch({
      changes: { from: line.from, insert: '  ' },
      selection: { anchor: from + 2 },
    });
  } else {
    if (text.startsWith('  ')) {
      view.dispatch({
        changes: { from: line.from, to: line.from + 2, insert: '' },
        selection: { anchor: Math.max(line.from, from - 2) },
      });
    }
  }
  return true;
}

export function listContinuation(): Extension {
  return keymap.of([
    { key: 'Enter', run: handleEnterInList },
    { key: 'Tab', run: (view) => handleTabInList(view, true) },
    { key: 'Shift-Tab', run: (view) => handleTabInList(view, false) },
  ]);
}
