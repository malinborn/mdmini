import { keymap } from '@codemirror/view';
import { EditorSelection, type Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

function toggleWrap(view: EditorView, marker: string): boolean {
  const { state } = view;
  const changes = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to);
    const len = marker.length;

    // Check if already wrapped
    if (text.startsWith(marker) && text.endsWith(marker) && text.length >= len * 2) {
      return {
        changes: [{ from: range.from, to: range.to, insert: text.slice(len, -len) }],
        range: EditorSelection.range(range.from, range.to - len * 2),
      };
    }

    // Check surrounding context
    const before = state.sliceDoc(Math.max(0, range.from - len), range.from);
    const after = state.sliceDoc(range.to, Math.min(state.doc.length, range.to + len));

    if (before === marker && after === marker) {
      return {
        changes: [
          { from: range.from - len, to: range.from, insert: '' },
          { from: range.to, to: range.to + len, insert: '' },
        ],
        range: EditorSelection.range(range.from - len, range.to - len),
      };
    }

    // Add markers
    return {
      changes: [{ from: range.from, to: range.to, insert: `${marker}${text}${marker}` }],
      range: EditorSelection.range(range.from + len, range.to + len),
    };
  });

  view.dispatch(changes);
  return true;
}

export function markdownKeybindings(): Extension {
  return keymap.of([
    { key: 'Mod-b', run: (view) => toggleWrap(view, '**') },
    { key: 'Mod-i', run: (view) => toggleWrap(view, '*') },
    { key: 'Mod-Shift-x', run: (view) => toggleWrap(view, '~~') },
  ]);
}
