import type { EditorState } from '@codemirror/state';
import type { Replacement } from './editor/content-diff';
import type { AiCommandPayload } from './tauri/events';

/**
 * Resolve the document position an `ai show` command should scroll to.
 *
 * `line` (1-based, per the socket protocol) wins over `find` when both are
 * present — the CLI only ever sends one, but the precedence keeps this total.
 * Neither given means "just focus the window", so it resolves to the top of
 * the document.
 */
export function resolveShowTarget(
  state: EditorState,
  target: Pick<AiCommandPayload, 'line' | 'find'>
): number | null {
  if (target.line !== null) {
    const clamped = Math.min(Math.max(target.line, 1), state.doc.lines);
    return state.doc.line(clamped).from;
  }
  if (target.find !== null) {
    const idx = state.doc.toString().indexOf(target.find);
    return idx === -1 ? null : idx;
  }
  return 0;
}

/**
 * 1-based inclusive line range the `edit` response reports as `changed_lines`,
 * covering the inserted span `[repl.from, repl.from + repl.insert.length)` in
 * the document that results from applying `repl` — `state` must already be
 * that post-change state, mirroring how the AI-highlight field reads effect
 * positions. A pure deletion (`insert` empty) has no span to cover, so it
 * reports the single line the deletion point now sits on.
 */
export function changedLineRanges(state: EditorState, repl: Replacement): [number, number] {
  const start = state.doc.lineAt(repl.from).number;
  if (repl.insert.length === 0) {
    return [start, start];
  }
  // endPos is just past the inserted text; back up one character so a trailing
  // newline in the insert doesn't roll the range onto the following,
  // untouched line.
  const endPos = repl.from + repl.insert.length;
  const end = state.doc.lineAt(endPos - 1).number;
  return [start, end];
}
