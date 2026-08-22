import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { computeReplacement } from './content-diff';

/** Applies a Replacement through an actual CM6 transaction, so an invalid span throws like production. */
function applyViaCM6(oldText: string, repl: ReturnType<typeof computeReplacement>): string {
  if (!repl) return oldText;
  const state = EditorState.create({ doc: oldText });
  return state.update({ changes: repl }).state.doc.toString();
}

describe('computeReplacement', () => {
  it('IdenticalStrings_ReturnsNull', () => {
    expect(computeReplacement('hello world', 'hello world')).toBeNull();
  });

  it('AppendAtEnd_ReplacesOnlyTail', () => {
    const repl = computeReplacement('hello', 'hello world');
    expect(repl).toEqual({ from: 5, to: 5, insert: ' world' });
  });

  it('PrependAtStart_ReplacesOnlyHead', () => {
    const repl = computeReplacement('world', 'hello world');
    expect(repl).toEqual({ from: 0, to: 0, insert: 'hello ' });
  });

  it('InsertionInMiddle_ReplacesOnlyGap', () => {
    const repl = computeReplacement('ac', 'abc');
    expect(repl).toEqual({ from: 1, to: 1, insert: 'b' });
  });

  it('DeletionInMiddle_ReplacesOnlyGap', () => {
    const repl = computeReplacement('abc', 'ac');
    expect(repl).toEqual({ from: 1, to: 2, insert: '' });
  });

  it('FullyDissimilarStrings_ReplacesWholeDoc', () => {
    const repl = computeReplacement('foo', 'bar');
    expect(repl).toEqual({ from: 0, to: 3, insert: 'bar' });
  });

  it('EmptyToText_InsertsAtStart', () => {
    const repl = computeReplacement('', 'new content');
    expect(repl).toEqual({ from: 0, to: 0, insert: 'new content' });
  });

  it('TextToEmpty_DeletesWholeDoc', () => {
    const repl = computeReplacement('old content', '');
    expect(repl).toEqual({ from: 0, to: 11, insert: '' });
  });

  it('TrailingNewlineRemoved_ReplacesOnlyNewline', () => {
    const repl = computeReplacement('abc\n', 'abc');
    expect(repl).toEqual({ from: 3, to: 4, insert: '' });
  });

  it('OverlappingPrefixSuffix_ClampsToValidSpan', () => {
    // Naive prefix/suffix scans would count the shared 'a' twice (prefix=2, suffix=2
    // on length-2/3 strings) and produce an out-of-range span. Must clamp.
    const repl = computeReplacement('aa', 'aaa');
    expect(repl).not.toBeNull();
    expect(repl!.from).toBeLessThanOrEqual(repl!.to);
    expect(applyViaCM6('aa', repl)).toBe('aaa');
  });

  it('SurrogatePairEdit_RoundTripsExactly', () => {
    // 😀 (U+1F600) and 😃 (U+1F603) share the same high surrogate, so the
    // char-code prefix/suffix scan lands its boundary between the high and
    // low surrogate halves. The resulting span must still recombine correctly
    // when applied — anything else corrupts the character.
    const oldText = 'a😀b';
    const newText = 'a😃b';
    const repl = computeReplacement(oldText, newText);
    expect(applyViaCM6(oldText, repl)).toBe(newText);
  });

  it.each<[string, string, string]>([
    ['both empty', '', ''],
    ['single char unchanged', 'a', 'a'],
    ['single char append', 'a', 'aa'],
    ['single char delete', 'aa', 'a'],
    ['identical multi-char', 'aaa', 'aaa'],
    ['shrink repeated char', 'aaaa', 'aa'],
    ['middle substitution', 'abcdef', 'abXYdef'],
    ['markdown body edit', '# Title\n\nBody text.\n', '# Title\n\nBody text, edited.\n'],
    ['single word changed mid-document', 'line1\nline2\nline3', 'line1\nlineTWO\nline3'],
    ['delete everything', 'xyz', ''],
    ['insert into empty doc', '', 'xyz'],
  ])('RoundTrip_%s', (_label, oldText, newText) => {
    const repl = computeReplacement(oldText, newText);
    expect(applyViaCM6(oldText, repl)).toBe(newText);
  });
});

describe('computeReplacement + CM6 transaction', () => {
  it('AppendedText_SelectionHeadUnchanged', () => {
    const oldText = 'line1\nline2\nline3';
    const state = EditorState.create({
      doc: oldText,
      selection: { anchor: 8 }, // inside "line2"
    });

    const newText = oldText + '\nline4';
    const repl = computeReplacement(oldText, newText);
    expect(repl).not.toBeNull();

    const tr = state.update({ changes: repl! });
    expect(tr.state.doc.toString()).toBe(newText);
    // The edit is entirely after the selection, so CM6's automatic mapping
    // must leave the head exactly where it was.
    expect(tr.state.selection.main.head).toBe(8);
  });

  it('PrependedText_SelectionHeadShiftsByInsertionLength', () => {
    const oldText = 'line1\nline2\nline3';
    const state = EditorState.create({
      doc: oldText,
      selection: { anchor: 8 }, // inside "line2"
    });

    const newText = 'HEADER\n' + oldText;
    const repl = computeReplacement(oldText, newText);
    expect(repl).toEqual({ from: 0, to: 0, insert: 'HEADER\n' });

    const tr = state.update({ changes: repl! });
    expect(tr.state.doc.toString()).toBe(newText);
    // The insertion is entirely before the selection, so the head must shift
    // by exactly the inserted length (7 chars: "HEADER\n").
    expect(tr.state.selection.main.head).toBe(15);
  });

  it('CaretInsideReplacedSpan_CollapsesToChangeStart', () => {
    const oldText = 'aaa BBBB ccc';
    const state = EditorState.create({
      doc: oldText,
      selection: { anchor: 6 }, // inside the "BBBB" span that gets replaced
    });

    const newText = 'aaa XYZ ccc';
    const repl = computeReplacement(oldText, newText);
    expect(repl).toEqual({ from: 4, to: 8, insert: 'XYZ' });

    const tr = state.update({ changes: repl! });
    expect(tr.state.doc.toString()).toBe(newText);
    // A caret that lands inside a replaced span has no stable position to map
    // to — CM6's default mapping collapses it to the start of the change.
    expect(tr.state.selection.main.head).toBe(4);
  });
});
