import { keymap } from '@codemirror/view';
import type { ChangeSpec, Extension, Text } from '@codemirror/state';
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

  if (!/^\s*([-*+]|\d+\.)\s/.test(text)) return false;

  if (indent) {
    view.dispatch({
      changes: { from: line.from, insert: '  ' },
      selection: { anchor: from + 2 },
    });
  } else {
    if (!text.startsWith('  ')) return true;
    view.dispatch({
      changes: { from: line.from, to: line.from + 2, insert: '' },
      selection: { anchor: Math.max(line.from, from - 2) },
    });
  }

  renumberOrderedListAround(view);
  return true;
}

export function computeOrderedListRenumberChanges(
  doc: Text,
  anchorLineNumber: number
): ChangeSpec[] {
  const isListLine = (s: string) => /^\s*([-*+]|\d+\.)\s/.test(s);

  let startLn = anchorLineNumber;
  while (startLn > 1) {
    const prev = doc.line(startLn - 1);
    if (prev.text.trim() === '' || !isListLine(prev.text)) break;
    startLn--;
  }
  let endLn = anchorLineNumber;
  while (endLn < doc.lines) {
    const next = doc.line(endLn + 1);
    if (next.text.trim() === '' || !isListLine(next.text)) break;
    endLn++;
  }

  const counters = new Map<number, number>();
  let lastIndent = -1;
  const changes: ChangeSpec[] = [];

  for (let ln = startLn; ln <= endLn; ln++) {
    const l = doc.line(ln);
    const m = l.text.match(/^(\s*)([-*+]|\d+\.)\s/);
    if (!m) continue;
    const indent = m[1].length;

    if (lastIndent >= 0 && indent < lastIndent) {
      for (const k of [...counters.keys()]) {
        if (k > indent) counters.delete(k);
      }
    }
    lastIndent = indent;

    const ordMatch = l.text.match(/^(\s*)(\d+)\./);
    if (!ordMatch) continue;

    const next = counters.get(indent) ?? 1;
    counters.set(indent, next + 1);

    const oldNum = parseInt(ordMatch[2], 10);
    if (oldNum === next) continue;

    const numStart = l.from + ordMatch[1].length;
    const numEnd = numStart + ordMatch[2].length;
    changes.push({ from: numStart, to: numEnd, insert: String(next) });
  }

  return changes;
}

function renumberOrderedListAround(view: EditorView): void {
  const { state } = view;
  const cursorLine = state.doc.lineAt(state.selection.main.from);
  const changes = computeOrderedListRenumberChanges(state.doc, cursorLine.number);
  if (changes.length > 0) view.dispatch({ changes });
}

export function listContinuation(): Extension {
  return keymap.of([
    { key: 'Enter', run: handleEnterInList },
    { key: 'Tab', run: (view) => handleTabInList(view, true) },
    { key: 'Shift-Tab', run: (view) => handleTabInList(view, false) },
  ]);
}
