import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { mermaidViewField, setMermaidView, getMermaidView, type MermaidView } from './mermaid-state';

function mkState(doc = '') {
  return EditorState.create({ doc, extensions: [mermaidViewField] });
}

const view: MermaidView = { scale: 2, tx: -100, ty: -50, frameHeight: null };

describe('mermaidViewField', () => {
  it('NoEntries_ReturnsNull', () => {
    const state = mkState();
    expect(getMermaidView(state, 0)).toBeNull();
    expect(getMermaidView(state, 42)).toBeNull();
  });

  it('Set_StoresViewAtPosition', () => {
    const s = mkState().update({ effects: setMermaidView.of({ pos: 10, view }) }).state;
    expect(getMermaidView(s, 10)).toEqual(view);
  });

  it('SetTwice_LastWins', () => {
    let s = mkState().update({ effects: setMermaidView.of({ pos: 10, view }) }).state;
    const next = { ...view, scale: 4 };
    s = s.update({ effects: setMermaidView.of({ pos: 10, view: next }) }).state;
    expect(getMermaidView(s, 10)?.scale).toBe(4);
  });

  it('SetNull_ClearsEntry', () => {
    let s = mkState().update({ effects: setMermaidView.of({ pos: 10, view }) }).state;
    s = s.update({ effects: setMermaidView.of({ pos: 10, view: null }) }).state;
    expect(getMermaidView(s, 10)).toBeNull();
  });

  it('TwoDiagrams_IndependentState', () => {
    let s = mkState().update({ effects: setMermaidView.of({ pos: 10, view }) }).state;
    s = s.update({ effects: setMermaidView.of({ pos: 50, view: { ...view, scale: 3 } }) }).state;
    expect(getMermaidView(s, 10)?.scale).toBe(2);
    expect(getMermaidView(s, 50)?.scale).toBe(3);
  });

  it('EditBeforeDiagram_AnchorShifts', () => {
    let s = mkState('AAAA MERMAID').update({ effects: setMermaidView.of({ pos: 5, view }) }).state;
    s = s.update({ changes: { from: 0, insert: 'XYZ' } }).state;
    expect(getMermaidView(s, 8)).toEqual(view);
    expect(getMermaidView(s, 5)).toBeNull();
  });

  it('EditAfterDiagram_AnchorUnchanged', () => {
    let s = mkState('MERMAID AAAA').update({ effects: setMermaidView.of({ pos: 0, view }) }).state;
    s = s.update({ changes: { from: 8, insert: 'XYZ' } }).state;
    expect(getMermaidView(s, 0)).toEqual(view);
  });

  it('FrameHeightRoundtrips', () => {
    const withHeight: MermaidView = { ...view, frameHeight: 320 };
    const s = mkState().update({ effects: setMermaidView.of({ pos: 0, view: withHeight }) }).state;
    expect(getMermaidView(s, 0)?.frameHeight).toBe(320);
  });
});
