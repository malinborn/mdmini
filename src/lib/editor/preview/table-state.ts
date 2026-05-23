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
      let current: TableMode = 'wrap';
      const cur = value.iter(pos);
      while (cur.value && cur.from <= pos) {
        if (cur.from === pos) current = cur.value.mode;
        cur.next();
      }
      const next: TableMode = current === 'full' ? 'wrap' : 'full';
      value = value.update({
        filter: (from) => from !== pos,
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
  while (cur.value && cur.from <= pos) {
    if (cur.from === pos) return cur.value.mode;
    cur.next();
  }
  return 'wrap';
}
