import { describe, it, expect, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import {
  aiHighlightField,
  aiHighlightRanges,
  setAiHighlights,
  clearAiHighlights,
  pulseAiLine,
  clearAiHighlightsCommand,
  notifyHighlightPresenceChange,
} from './ai-highlight';

function makeState(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [aiHighlightField] });
}

/** All decoration ranges in the field, including zero-width (line) ones, with their class name. */
function collectDecos(state: EditorState): Array<{ from: number; to: number; class: string }> {
  const set = state.field(aiHighlightField, false);
  const out: Array<{ from: number; to: number; class: string }> = [];
  if (set) {
    set.between(0, state.doc.length, (from, to, value) => {
      out.push({ from, to, class: (value.spec as { class?: string }).class ?? '' });
    });
  }
  return out;
}

describe('aiHighlightField', () => {
  it('installs ranges on setAiHighlights', () => {
    const state = makeState('hello world\n');
    const tr = state.update({ effects: setAiHighlights.of([{ from: 0, to: 5 }]) });
    expect(aiHighlightRanges(tr.state)).toEqual([{ from: 0, to: 5 }]);
  });

  it('installs exactly one full-line decoration for a single-line range', () => {
    const state = makeState('hello world\n');
    const tr = state.update({ effects: setAiHighlights.of([{ from: 0, to: 5 }]) });
    const lineDecos = collectDecos(tr.state).filter((d) => d.class === 'cm-ai-edit-line');
    expect(lineDecos).toEqual([{ from: 0, to: 0, class: 'cm-ai-edit-line' }]);
  });

  it('installs one full-line decoration per line touched by a multi-line range, plus the mark', () => {
    const state = makeState('line1\nline2\nline3\n');
    const from = state.doc.line(1).from + 2; // mid line1
    const to = state.doc.line(3).from + 2; // mid line3
    const tr = state.update({ effects: setAiHighlights.of([{ from, to }]) });

    const decos = collectDecos(tr.state);
    const lineDecos = decos.filter((d) => d.class === 'cm-ai-edit-line');
    expect(lineDecos.map((d) => d.from)).toEqual([
      state.doc.line(1).from,
      state.doc.line(2).from,
      state.doc.line(3).from,
    ]);
    expect(decos.some((d) => d.class === 'cm-ai-edit' && d.from === from && d.to === to)).toBe(true);
    // aiHighlightRanges still reports only the mark, not the line washes.
    expect(aiHighlightRanges(tr.state)).toEqual([{ from, to }]);
  });

  it('clears full-line decorations along with the mark on clearAiHighlights', () => {
    let state = makeState('line1\nline2\n');
    state = state.update({
      effects: setAiHighlights.of([{ from: 0, to: state.doc.line(2).from + 3 }]),
    }).state;
    state = state.update({ effects: clearAiHighlights.of(null) }).state;
    expect(collectDecos(state)).toEqual([]);
  });

  it('shifts ranges when a user edit happens before them', () => {
    let state = makeState('hello world\n');
    state = state.update({ effects: setAiHighlights.of([{ from: 6, to: 11 }]) }).state; // "world"
    const tr = state.update({ changes: { from: 0, to: 0, insert: 'XYZ' } });
    expect(aiHighlightRanges(tr.state)).toEqual([{ from: 9, to: 14 }]);
  });

  it('replaces old ranges entirely on a new setAiHighlights effect', () => {
    let state = makeState('abcdefghij');
    state = state.update({ effects: setAiHighlights.of([{ from: 0, to: 3 }]) }).state;
    state = state.update({ effects: setAiHighlights.of([{ from: 5, to: 8 }]) }).state;
    expect(aiHighlightRanges(state)).toEqual([{ from: 5, to: 8 }]);
  });

  it('empties the field on clearAiHighlights', () => {
    let state = makeState('abcdef');
    state = state.update({ effects: setAiHighlights.of([{ from: 0, to: 3 }]) }).state;
    state = state.update({ effects: clearAiHighlights.of(null) }).state;
    expect(aiHighlightRanges(state)).toEqual([]);
  });

  it('drops a range whose whole span was deleted', () => {
    let state = makeState('hello world');
    state = state.update({ effects: setAiHighlights.of([{ from: 0, to: 5 }]) }).state; // "hello"
    const tr = state.update({ changes: { from: 0, to: 5, insert: '' } });
    expect(aiHighlightRanges(tr.state)).toEqual([]);
  });

  it('ignores zero-width ranges passed to setAiHighlights', () => {
    const state = makeState('abcdef');
    const tr = state.update({ effects: setAiHighlights.of([{ from: 2, to: 2 }]) });
    expect(aiHighlightRanges(tr.state)).toEqual([]);
  });

  it('adds a pulse line decoration at the line start', () => {
    const state = makeState('line1\nline2\nline3\n');
    const pos = state.doc.line(2).from + 2;
    const tr = state.update({ effects: pulseAiLine.of(pos) });
    const decos = collectDecos(tr.state);
    const pulse = decos.find((d) => d.class === 'cm-ai-pulse');
    expect(pulse).toBeDefined();
    expect(pulse!.from).toBe(state.doc.line(2).from);
  });

  it('keeps a pulse alongside existing highlight marks (no implicit clear)', () => {
    let state = makeState('hello world\nfoo bar\n');
    state = state.update({ effects: setAiHighlights.of([{ from: 0, to: 5 }]) }).state;
    const pos = state.doc.line(2).from;
    state = state.update({ effects: pulseAiLine.of(pos) }).state;

    expect(aiHighlightRanges(state)).toEqual([{ from: 0, to: 5 }]);
    expect(collectDecos(state).some((d) => d.class === 'cm-ai-pulse')).toBe(true);
  });
});

function makeView(state: EditorState): { view: EditorView; calls: Array<{ effects?: unknown }> } {
  const calls: Array<{ effects?: unknown }> = [];
  const view = {
    state,
    dispatch: vi.fn((spec: { effects?: unknown }) => {
      calls.push(spec);
    }),
  } as unknown as EditorView;
  return { view, calls };
}

describe('clearAiHighlightsCommand', () => {
  it('returns false and does not dispatch when there are no highlights', () => {
    const { view, calls } = makeView(makeState('abc'));
    expect(clearAiHighlightsCommand(view)).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('dispatches clearAiHighlights and returns true when highlights exist', () => {
    let state = makeState('hello world');
    state = state.update({ effects: setAiHighlights.of([{ from: 0, to: 5 }]) }).state;
    const { view, calls } = makeView(state);

    expect(clearAiHighlightsCommand(view)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].effects).toBeDefined();
  });
});

describe('notifyHighlightPresenceChange', () => {
  it('fires with true on the empty->non-empty transition', () => {
    const empty = makeState('hello world');
    const nonEmpty = empty.update({ effects: setAiHighlights.of([{ from: 0, to: 5 }]) }).state;
    const onChange = vi.fn();

    notifyHighlightPresenceChange(empty, nonEmpty, onChange);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('does not fire again while replacing ranges with the highlight already visible', () => {
    const first = makeState('abcdefghij').update({
      effects: setAiHighlights.of([{ from: 0, to: 3 }]),
    }).state;
    const second = first.update({ effects: setAiHighlights.of([{ from: 5, to: 8 }]) }).state;
    const onChange = vi.fn();

    notifyHighlightPresenceChange(first, second, onChange);

    expect(onChange).not.toHaveBeenCalled();
  });

  it('fires with false on the non-empty->empty transition (clear)', () => {
    const visible = makeState('hello world').update({
      effects: setAiHighlights.of([{ from: 0, to: 5 }]),
    }).state;
    const cleared = visible.update({ effects: clearAiHighlights.of(null) }).state;
    const onChange = vi.fn();

    notifyHighlightPresenceChange(visible, cleared, onChange);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('does not fire for a pulse alongside no marks (pulse-only is not "visible")', () => {
    const empty = makeState('line1\nline2\n');
    const pulsed = empty.update({ effects: pulseAiLine.of(empty.doc.line(1).from) }).state;
    const onChange = vi.fn();

    notifyHighlightPresenceChange(empty, pulsed, onChange);

    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not fire for an unrelated edit while empty', () => {
    const empty = makeState('hello world');
    const stillEmpty = empty.update({ changes: { from: 0, to: 0, insert: 'X' } }).state;
    const onChange = vi.fn();

    notifyHighlightPresenceChange(empty, stillEmpty, onChange);

    expect(onChange).not.toHaveBeenCalled();
  });
});
