import { describe, it, expect } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { Strikethrough, Table } from '@lezer/markdown';
import {
  findContinuationBoundary,
  continuationRedirect,
  continuationEscapeSpec,
  continuationFormatExitSpec,
  isContinuationActive,
  suppressedBoundaryField,
  setSuppressedBoundary,
  type ContinuableKind,
} from './inline-continuation';

function makeState(doc: string, cursor: number): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: [
      markdown({
        base: markdownLanguage,
        codeLanguages: languages,
        extensions: [Strikethrough, Table],
      }),
      suppressedBoundaryField,
    ],
  });
}

describe('findContinuationBoundary', () => {
  const cases: { label: string; doc: string; pos: number; kind: ContinuableKind }[] = [
    { label: 'bold', doc: '**bold**', pos: 8, kind: 'strong' },
    { label: 'italic', doc: '*ital*', pos: 6, kind: 'emphasis' },
    { label: 'strikethrough', doc: '~~gone~~', pos: 8, kind: 'strikethrough' },
    { label: 'inline code', doc: '`code`', pos: 6, kind: 'inlineCode' },
  ];

  for (const { label, doc, pos, kind } of cases) {
    it(`detects the closing boundary of ${label}`, () => {
      const state = makeState(doc, pos);
      const boundary = findContinuationBoundary(state, pos);
      expect(boundary?.kind).toBe(kind);
    });
  }

  it('returns null when the cursor is not at a closing boundary', () => {
    const state = makeState('plain text here', 5);
    expect(findContinuationBoundary(state, 5)).toBeNull();
  });

  it('returns null right after the opening marker, not just anywhere inside', () => {
    // "**bold**": position 2 is right after the opening "**", not a closing boundary.
    const state = makeState('**bold**', 2);
    expect(findContinuationBoundary(state, 2)).toBeNull();
  });

  it('adjacent spans: **a**_b_ resolves to the preceding (just-closed) span, not the one about to open', () => {
    const doc = '**a**_b_';
    // "**a**" is [0,5), "_b_" is [5,8) — position 5 is StrongEmphasis.to and Emphasis.from at once.
    const state = makeState(doc, 5);
    const boundary = findContinuationBoundary(state, 5);
    expect(boundary?.kind).toBe('strong');
  });

  it('an inline node flush against the end of the document is still detected', () => {
    // No trailing character after the closing marker at all — the case that
    // ruled out an arrow-key-based exit (no pixel to move the caret to).
    const state = makeState('**bold**', 8);
    const boundary = findContinuationBoundary(state, 8);
    expect(boundary).not.toBeNull();
    expect(boundary?.node.to).toBe(state.doc.length);
  });
});

describe('continuationRedirect', () => {
  it('continues bold: typed text lands inside, before the closing **', () => {
    const state = makeState('**bold**', 8);
    const spec = continuationRedirect(state, 8, 8, '!');
    expect(spec).not.toBeNull();
    const result = state.update(spec!).state;
    expect(result.doc.toString()).toBe('**bold!**');
  });

  it('continues italic', () => {
    const state = makeState('*ital*', 6);
    const spec = continuationRedirect(state, 6, 6, '!');
    const result = state.update(spec!).state;
    expect(result.doc.toString()).toBe('*ital!*');
  });

  it('continues strikethrough', () => {
    const state = makeState('~~gone~~', 8);
    const spec = continuationRedirect(state, 8, 8, '!');
    const result = state.update(spec!).state;
    expect(result.doc.toString()).toBe('~~gone!~~');
  });

  it('continues inline code', () => {
    const state = makeState('`code`', 6);
    const spec = continuationRedirect(state, 6, 6, '!');
    const result = state.update(spec!).state;
    expect(result.doc.toString()).toBe('`code!`');
  });

  it('leaves typing elsewhere untouched', () => {
    const state = makeState('plain text here', 5);
    expect(continuationRedirect(state, 5, 5, 'x')).toBeNull();
  });

  it('leaves a range replacement (from !== to) untouched', () => {
    const state = makeState('**bold** and more', 8);
    expect(continuationRedirect(state, 6, 8, 'xx')).toBeNull();
  });
});

describe('Escape exits continuation', () => {
  it('sets suppression at the boundary, and a subsequent type lands outside', () => {
    const state = makeState('**bold**', 8);
    const escSpec = continuationEscapeSpec(state);
    expect(escSpec).not.toBeNull();

    const afterEscape = state.update(escSpec!).state;
    expect(afterEscape.field(suppressedBoundaryField)).toBe(8);

    // With suppression active, continuationRedirect must decline — the
    // input handler then falls through to default insertion at `from`,
    // i.e. outside the format.
    expect(continuationRedirect(afterEscape, 8, 8, 'x')).toBeNull();
    const typed = afterEscape.update({ changes: { from: 8, to: 8, insert: 'x' } }).state;
    expect(typed.doc.toString()).toBe('**bold**x');
  });

  it('does nothing away from a boundary, leaving other Escape handlers free to run', () => {
    const state = makeState('plain text', 5);
    expect(continuationEscapeSpec(state)).toBeNull();
  });

  it('does nothing when the selection is not empty', () => {
    const state = makeState('**bold** more', 8).update({
      selection: EditorSelection.range(6, 8),
    }).state;
    expect(continuationEscapeSpec(state)).toBeNull();
  });
});

describe('suppression lifecycle', () => {
  it('clears when the caret moves away, and continuation resumes when it comes back', () => {
    const state = makeState('**bold**', 8);
    const afterEscape = state.update(continuationEscapeSpec(state)!).state;
    expect(afterEscape.field(suppressedBoundaryField)).toBe(8);

    const movedAway = afterEscape.update({ selection: EditorSelection.cursor(2) }).state;
    expect(movedAway.field(suppressedBoundaryField)).toBeNull();

    const movedBack = movedAway.update({ selection: EditorSelection.cursor(8) }).state;
    expect(movedBack.field(suppressedBoundaryField)).toBeNull();
    // Continuation resumed — not sticky across a round trip.
    expect(continuationRedirect(movedBack, 8, 8, '!')).not.toBeNull();
  });

  it('maps the suppressed position through an edit earlier in the document', () => {
    const doc = 'abc **bold**';
    // "**bold**" is [4,12); position 12 is the closing boundary (== doc.length).
    const state = makeState(doc, 12);
    const afterEscape = state.update(continuationEscapeSpec(state)!).state;
    expect(afterEscape.field(suppressedBoundaryField)).toBe(12);

    // Insert two characters at the very start, before the suppressed
    // boundary. No selection is specified, so CM6's default selection
    // mapping moves the (still-empty, still-at-the-boundary) cursor to 14 —
    // the suppression must track it there too, not stay pinned at 12.
    const edited = afterEscape.update({ changes: { from: 0, to: 0, insert: 'XY' } }).state;
    expect(edited.selection.main.head).toBe(14);
    expect(edited.field(suppressedBoundaryField)).toBe(14);
  });

  it('an explicit null effect clears suppression directly', () => {
    const state = makeState('**bold**', 8);
    const afterEscape = state.update(continuationEscapeSpec(state)!).state;
    const cleared = afterEscape.update({ effects: setSuppressedBoundary.of(null) }).state;
    expect(cleared.field(suppressedBoundaryField)).toBeNull();
  });
});

describe('continuationFormatExitSpec (Cmd+B-family exit contract)', () => {
  it('exits when the kind matches the boundary', () => {
    const state = makeState('**bold**', 8);
    const spec = continuationFormatExitSpec(state, 'strong');
    expect(spec).not.toBeNull();
    const result = state.update(spec!).state;
    expect(result.field(suppressedBoundaryField)).toBe(8);
  });

  it('does not exit when the kind does not match the boundary', () => {
    const state = makeState('**bold**', 8);
    expect(continuationFormatExitSpec(state, 'emphasis')).toBeNull();
    expect(continuationFormatExitSpec(state, 'strikethrough')).toBeNull();
  });

  it('does nothing away from any boundary', () => {
    const state = makeState('plain text', 5);
    expect(continuationFormatExitSpec(state, 'strong')).toBeNull();
  });
});

describe('isContinuationActive (caret affordance)', () => {
  it('is active at a fresh boundary', () => {
    const state = makeState('**bold**', 8);
    expect(isContinuationActive(state)).toBe('strong');
  });

  it('is null once suppressed', () => {
    const state = makeState('**bold**', 8);
    const afterEscape = state.update(continuationEscapeSpec(state)!).state;
    expect(isContinuationActive(afterEscape)).toBeNull();
  });

  it('is null when not at a boundary', () => {
    const state = makeState('plain text', 5);
    expect(isContinuationActive(state)).toBeNull();
  });

  it('is null with a non-empty selection', () => {
    const state = makeState('**bold** more', 8).update({
      selection: EditorSelection.range(6, 8),
    }).state;
    expect(isContinuationActive(state)).toBeNull();
  });
});
