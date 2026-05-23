import { StateField, StateEffect, RangeSet, RangeValue, type EditorState } from '@codemirror/state';

export type TableMode = 'wrap' | 'full';

export class TableModeValue extends RangeValue {
  constructor(public readonly mode: TableMode) {
    super();
  }
  eq(other: RangeValue): boolean {
    return other instanceof TableModeValue && this.mode === other.mode;
  }
}

export const toggleTableMode = StateEffect.define<{ pos: number }>();

export const tableModeField = StateField.define<RangeSet<TableModeValue>>({
  create: () => RangeSet.empty,
  update(value, tr) {
    value = value.map(tr.changes);
    for (const eff of tr.effects) {
      if (!eff.is(toggleTableMode)) continue;
      const pos = eff.value.pos;
      const cur = value.iter(pos);
      const current: TableMode =
        cur.value && cur.from === pos ? cur.value.mode : 'wrap';
      const next: TableMode = current === 'full' ? 'wrap' : 'full';
      value = value.update({
        filter: (from) => from !== pos,
        // Point range (from === to) — TableModeValue is anchored at a single position.
        add: [new TableModeValue(next).range(pos)],
      });
    }
    return value;
  },
});

export function getTableMode(state: EditorState, pos: number): TableMode {
  const set = state.field(tableModeField, false);
  if (!set) return 'wrap';
  const cur = set.iter(pos);
  return cur.value && cur.from === pos ? cur.value.mode : 'wrap';
}
