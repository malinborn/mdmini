import { StateEffect, StateField, type EditorState } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, keymap } from '@codemirror/view';

/** A highlighted span, in document coordinates. */
export interface AiHighlightRange {
  from: number;
  to: number;
}

/** Replaces all AI-edit highlight ranges with the given ones (dropping zero-width ranges). */
export const setAiHighlights = StateEffect.define<readonly AiHighlightRange[]>();

/** Clears all AI-edit highlights and any active pulse. */
export const clearAiHighlights = StateEffect.define<null>();

/** Adds a short-lived pulse line decoration at the given position's line, alongside any existing highlights. */
export const pulseAiLine = StateEffect.define<number>();

const aiEditMark = Decoration.mark({ class: 'cm-ai-edit' });
const aiEditLine = Decoration.line({ class: 'cm-ai-edit-line' });
const aiPulseLine = Decoration.line({ class: 'cm-ai-pulse' });

/**
 * Holds decorations for AI-driven edits: a subtle background mark on the spans
 * an `mdmini ai edit` just changed, a full-width line wash on every line those
 * spans touch (so the edit reads at a glance, not just at the exact chars),
 * and a self-describing pulse line for `mdmini ai show`. Ranges are mapped
 * through user edits so highlights survive typing nearby, and a mark collapsed
 * to zero width by a deletion is dropped (CM6's default map behavior for
 * non-inclusive marks).
 */
export const aiHighlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(clearAiHighlights)) {
        deco = Decoration.none;
      } else if (effect.is(setAiHighlights)) {
        const ranges = effect.value.filter((r) => r.to > r.from);
        const marks = ranges.map((r) => aiEditMark.range(r.from, r.to));

        const seenLines = new Set<number>();
        const lineStarts: number[] = [];
        for (const r of ranges) {
          let pos = r.from;
          while (pos < r.to) {
            const line = tr.state.doc.lineAt(pos);
            if (!seenLines.has(line.from)) {
              seenLines.add(line.from);
              lineStarts.push(line.from);
            }
            pos = line.to + 1;
          }
        }
        const lineDecos = lineStarts.map((from) => aiEditLine.range(from));

        deco = Decoration.set([...marks, ...lineDecos], true);
      } else if (effect.is(pulseAiLine)) {
        const line = tr.state.doc.lineAt(effect.value);
        deco = deco.update({ add: [aiPulseLine.range(line.from)] });
      }
    }
    return deco;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Current AI-edit highlight ranges (excludes the zero-width line-wash and pulse markers). */
export function aiHighlightRanges(state: EditorState): AiHighlightRange[] {
  const set = state.field(aiHighlightField, false);
  if (!set) return [];
  const ranges: AiHighlightRange[] = [];
  set.between(0, state.doc.length, (from, to) => {
    if (to > from) ranges.push({ from, to });
  });
  return ranges;
}

/** Esc clears AI highlights; returns false (letting other Esc handlers run) when there is nothing to clear. */
export function clearAiHighlightsCommand(view: EditorView): boolean {
  if (aiHighlightRanges(view.state).length === 0) return false;
  view.dispatch({ effects: clearAiHighlights.of(null) });
  return true;
}

export const aiHighlightKeymap = keymap.of([{ key: 'Escape', run: clearAiHighlightsCommand }]);
