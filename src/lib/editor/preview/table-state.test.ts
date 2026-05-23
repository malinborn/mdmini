import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { tableModeField, toggleTableMode, getTableMode } from './table-state';

function mkState(doc = '') {
  return EditorState.create({ doc, extensions: [tableModeField] });
}

describe('tableModeField', () => {
  it('NoEntries_DefaultsToWrap', () => {
    const state = mkState();
    expect(getTableMode(state, 0)).toBe('wrap');
    expect(getTableMode(state, 42)).toBe('wrap');
  });

  it('ToggleOnce_FlipsToFull', () => {
    const state = mkState();
    const tr = state.update({ effects: toggleTableMode.of({ pos: 10 }) });
    expect(getTableMode(tr.state, 10)).toBe('full');
  });

  it('ToggleTwice_ReturnsToWrap', () => {
    const state = mkState();
    let s = state.update({ effects: toggleTableMode.of({ pos: 10 }) }).state;
    s = s.update({ effects: toggleTableMode.of({ pos: 10 }) }).state;
    expect(getTableMode(s, 10)).toBe('wrap');
  });

  it('TwoTables_IndependentState', () => {
    const state = mkState();
    let s = state.update({ effects: toggleTableMode.of({ pos: 10 }) }).state;
    s = s.update({ effects: toggleTableMode.of({ pos: 50 }) }).state;
    s = s.update({ effects: toggleTableMode.of({ pos: 10 }) }).state;
    expect(getTableMode(s, 10)).toBe('wrap');
    expect(getTableMode(s, 50)).toBe('full');
  });

  it('DocEditBeforeTable_PositionShifts', () => {
    const state = mkState('AAAA TABLE');
    let s = state.update({ effects: toggleTableMode.of({ pos: 5 }) }).state;
    // Insert 3 chars at position 0; table position should shift to 8
    s = s.update({ changes: { from: 0, insert: 'XYZ' } }).state;
    expect(getTableMode(s, 8)).toBe('full');
    expect(getTableMode(s, 5)).toBe('wrap'); // old position now empty
  });

  it('DocEditAfterTable_PositionUnchanged', () => {
    const state = mkState('TABLE AAAA');
    let s = state.update({ effects: toggleTableMode.of({ pos: 0 }) }).state;
    s = s.update({ changes: { from: 6, insert: 'XYZ' } }).state;
    expect(getTableMode(s, 0)).toBe('full');
  });
});
