import { StateField, StateEffect, RangeSet, RangeValue, type EditorState } from '@codemirror/state';

/**
 * Per-diagram view state, anchored at the position of the fenced block.
 *
 * Anchoring by position rather than by source text means the zoom level
 * survives an edit to the diagram body — `RangeSet.map` moves the anchor along
 * with the document. State lives in memory only and resets when the file is
 * closed, matching how table wrap/full mode behaves.
 *
 * Note that this field is deliberately NOT observed by `livePreviewPlugin`:
 * interactive pan/zoom writes `transform` straight to the DOM and only commits
 * here once the gesture settles, so rebuilding decorations on it would be waste.
 */
export interface MermaidView {
  scale: number;
  tx: number;
  ty: number;
  /** User-chosen frame height in px, or null to keep the automatic height. */
  frameHeight: number | null;
}

export class MermaidViewValue extends RangeValue {
  constructor(public readonly view: MermaidView) {
    super();
  }

  eq(other: RangeValue): boolean {
    return (
      other instanceof MermaidViewValue &&
      this.view.scale === other.view.scale &&
      this.view.tx === other.view.tx &&
      this.view.ty === other.view.ty &&
      this.view.frameHeight === other.view.frameHeight
    );
  }
}

export const setMermaidView = StateEffect.define<{ pos: number; view: MermaidView | null }>();

export const mermaidViewField = StateField.define<RangeSet<MermaidViewValue>>({
  create: () => RangeSet.empty,
  update(value, tr) {
    value = value.map(tr.changes);
    for (const eff of tr.effects) {
      if (!eff.is(setMermaidView)) continue;
      const { pos, view } = eff.value;
      value = value.update({
        filter: (from) => from !== pos,
        // Point range (from === to) — the value is anchored at a single position.
        add: view ? [new MermaidViewValue(view).range(pos)] : [],
      });
    }
    return value;
  },
});

export function getMermaidView(state: EditorState, pos: number): MermaidView | null {
  const set = state.field(mermaidViewField, false);
  if (!set) return null;
  const cur = set.iter(pos);
  return cur.value && cur.from === pos ? cur.value.view : null;
}
