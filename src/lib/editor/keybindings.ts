import { keymap } from '@codemirror/view';
import { EditorSelection, type Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import {
  exitContinuationOnFormatToggle,
  type ExitableFormatKind,
} from './live-render/inline-continuation';

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

/**
 * In live-render, sitting at the boundary of a hidden span means the next
 * keystroke continues that format. These keys are how the user says "stop" —
 * the arrow keys deliberately are not, since at that boundary they move the
 * caret without moving it on screen.
 *
 * `exitContinuationOnFormatToggle` returns false whenever live-render is not
 * the active flavour, so live-preview reaches `toggleWrap` unchanged.
 */
function toggleOrExit(view: EditorView, marker: string, kind: ExitableFormatKind): boolean {
  if (exitContinuationOnFormatToggle(view, kind)) return true;
  return toggleWrap(view, marker);
}

export function markdownKeybindings(): Extension {
  return keymap.of([
    { key: 'Mod-b', run: (view) => toggleOrExit(view, '**', 'strong') },
    { key: 'Mod-i', run: (view) => toggleOrExit(view, '*', 'emphasis') },
    { key: 'Mod-Shift-x', run: (view) => toggleOrExit(view, '~~', 'strikethrough') },
  ]);
}
