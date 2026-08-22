import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { resolveShowTarget, changedLineRanges } from './ai-commands';
import { computeReplacement } from './editor/content-diff';

function makeState(doc: string): EditorState {
  return EditorState.create({ doc });
}

describe('resolveShowTarget', () => {
  it('resolves a 1-based line to the start of that line', () => {
    const state = makeState('line1\nline2\nline3\n');
    expect(resolveShowTarget(state, { line: 2, find: null })).toBe(state.doc.line(2).from);
  });

  it('clamps a line number below 1 up to the first line', () => {
    const state = makeState('line1\nline2\n');
    expect(resolveShowTarget(state, { line: 0, find: null })).toBe(state.doc.line(1).from);
    expect(resolveShowTarget(state, { line: -5, find: null })).toBe(state.doc.line(1).from);
  });

  it('clamps a line number past the end down to the last line', () => {
    const state = makeState('line1\nline2\nline3\n');
    expect(resolveShowTarget(state, { line: 999, find: null })).toBe(state.doc.line(4).from);
  });

  it('finds the first occurrence of text', () => {
    const state = makeState('hello world, hello moon\n');
    expect(resolveShowTarget(state, { line: null, find: 'hello' })).toBe(0);
    expect(resolveShowTarget(state, { line: null, find: 'moon' })).toBe(19);
  });

  it('returns null when the search text is not found', () => {
    const state = makeState('hello world\n');
    expect(resolveShowTarget(state, { line: null, find: 'nowhere' })).toBeNull();
  });

  it('returns 0 when neither line nor find is given', () => {
    const state = makeState('hello world\n');
    expect(resolveShowTarget(state, { line: null, find: null })).toBe(0);
  });

  it('prefers line over find when both are given', () => {
    const state = makeState('line1\nline2\nline3\n');
    expect(resolveShowTarget(state, { line: 3, find: 'line1' })).toBe(state.doc.line(3).from);
  });
});

describe('changedLineRanges', () => {
  it('reports the single inserted line', () => {
    const oldText = 'aaa\nbbb\nccc\n';
    const newText = 'aaa\nXXX\nccc\n';
    const repl = computeReplacement(oldText, newText)!;
    const state = makeState(newText);
    expect(changedLineRanges(state, repl)).toEqual([2, 2]);
  });

  it('reports a multi-line inclusive range for a multi-line insert', () => {
    const oldText = 'aaa\nccc\n';
    const newText = 'aaa\nbbb\nBBB\nccc\n';
    const repl = computeReplacement(oldText, newText)!;
    const state = makeState(newText);
    expect(changedLineRanges(state, repl)).toEqual([2, 3]);
  });

  it('reports the line at the deletion point for a pure deletion', () => {
    const oldText = 'aaa\nbbb\nccc\n';
    const newText = 'aaa\nccc\n';
    const repl = computeReplacement(oldText, newText)!;
    const state = makeState(newText);
    expect(changedLineRanges(state, repl)).toEqual([2, 2]);
  });

  it('handles an insert at the very start of the document', () => {
    const oldText = 'ccc\n';
    const newText = 'aaa\nbbb\nccc\n';
    const repl = computeReplacement(oldText, newText)!;
    const state = makeState(newText);
    expect(changedLineRanges(state, repl)).toEqual([1, 2]);
  });

  it('handles an append at the very end of the document', () => {
    const oldText = 'aaa\n';
    const newText = 'aaa\nbbb\n';
    const repl = computeReplacement(oldText, newText)!;
    const state = makeState(newText);
    expect(changedLineRanges(state, repl)).toEqual([2, 2]);
  });
});
