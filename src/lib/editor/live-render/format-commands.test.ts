import { describe, it, expect, vi } from 'vitest';
import { EditorState, StateEffect } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { Strikethrough, Table } from '@lezer/markdown';
import {
  toggleInlineFormat,
  toggleLink,
  isInlineFormatActive,
  isLinkActive,
} from './format-commands';
import { openInspectorFor } from './effects';

// Structural mock — same pattern as tables.test.ts's makeMockView. These
// commands only read `view.state` and call `view.dispatch`, so a real
// EditorView (which needs a DOM) isn't required.
function makeMockView(
  doc: string,
  selFrom: number,
  selTo: number = selFrom
): { view: EditorView; dispatch: ReturnType<typeof vi.fn> } {
  const dispatch = vi.fn();
  const state = EditorState.create({
    doc,
    selection: { anchor: selFrom, head: selTo },
    extensions: [
      markdown({
        base: markdownLanguage,
        codeLanguages: languages,
        extensions: [Strikethrough, Table],
      }),
    ],
  });
  const view = { state, dispatch } as unknown as EditorView;
  return { view, dispatch };
}

// Applies the TransactionSpec passed to the mocked `dispatch` and returns
// the resulting state, so assertions can check the real doc + selection.
function applyDispatch(view: EditorView, dispatch: ReturnType<typeof vi.fn>): EditorState {
  expect(dispatch).toHaveBeenCalledTimes(1);
  const spec = dispatch.mock.calls[0][0];
  return view.state.update(spec).state;
}

describe('toggleInlineFormat — wrapping unformatted text', () => {
  it('Strong_PlainSelection_WrapsWithDoubleAsterisk', () => {
    const { view, dispatch } = makeMockView('hello world', 0, 5);
    toggleInlineFormat(view, 'strong');
    const result = applyDispatch(view, dispatch);
    expect(result.doc.toString()).toBe('**hello** world');
    // Same visible text ("hello") stays selected.
    expect(result.selection.main.from).toBe(2);
    expect(result.selection.main.to).toBe(7);
    expect(result.sliceDoc(result.selection.main.from, result.selection.main.to)).toBe('hello');
  });

  it('Emphasis_PlainSelection_WrapsWithUnderscore', () => {
    const { view, dispatch } = makeMockView('hello world', 0, 5);
    toggleInlineFormat(view, 'emphasis');
    const result = applyDispatch(view, dispatch);
    expect(result.doc.toString()).toBe('_hello_ world');
  });

  it('Strikethrough_PlainSelection_WrapsWithDoubleTilde', () => {
    const { view, dispatch } = makeMockView('hello world', 0, 5);
    toggleInlineFormat(view, 'strikethrough');
    const result = applyDispatch(view, dispatch);
    expect(result.doc.toString()).toBe('~~hello~~ world');
  });

  it('InlineCode_PlainSelection_WrapsWithBacktick', () => {
    const { view, dispatch } = makeMockView('hello world', 0, 5);
    toggleInlineFormat(view, 'inlineCode');
    const result = applyDispatch(view, dispatch);
    expect(result.doc.toString()).toBe('`hello` world');
  });
});

describe('toggleInlineFormat — unwrapping', () => {
  it('Strong_SelectionInsideStrongNode_RemovesMarksNotSlice', () => {
    // "**hello**" is StrongEmphasis[0,9) with EmphasisMark at [0,2) and [7,9).
    const { view, dispatch } = makeMockView('**hello** world', 2, 7);
    expect(isInlineFormatActive(view.state, 'strong', 2, 7)).toBe(true);

    toggleInlineFormat(view, 'strong');
    const result = applyDispatch(view, dispatch);

    expect(result.doc.toString()).toBe('hello world');
    expect(result.selection.main.from).toBe(0);
    expect(result.selection.main.to).toBe(5);
  });

  it('Emphasis_SelectionInsideEmphasisNode_RemovesMarks', () => {
    const { view, dispatch } = makeMockView('_hello_ world', 1, 6);
    toggleInlineFormat(view, 'emphasis');
    const result = applyDispatch(view, dispatch);
    expect(result.doc.toString()).toBe('hello world');
  });

  it('Strikethrough_SelectionInsideStrikethroughNode_RemovesMarks', () => {
    const { view, dispatch } = makeMockView('~~hello~~ world', 2, 7);
    toggleInlineFormat(view, 'strikethrough');
    const result = applyDispatch(view, dispatch);
    expect(result.doc.toString()).toBe('hello world');
  });

  it('InlineCode_SelectionInsideInlineCodeNode_RemovesMarks', () => {
    const { view, dispatch } = makeMockView('`hello` world', 1, 6);
    toggleInlineFormat(view, 'inlineCode');
    const result = applyDispatch(view, dispatch);
    expect(result.doc.toString()).toBe('hello world');
  });

  it('Strong_SelectionExactlyOnMarkers_StillUnwraps', () => {
    // Selection includes the markers themselves (from === node.from).
    const { view, dispatch } = makeMockView('**hello** world', 0, 9);
    toggleInlineFormat(view, 'strong');
    const result = applyDispatch(view, dispatch);
    expect(result.doc.toString()).toBe('hello world');
  });
});

describe('toggleInlineFormat — whitespace trimming', () => {
  it('Strong_SelectionWithTrailingSpace_TrimsSpaceOutsideMarkers', () => {
    // Selecting "hello " (trailing space) must not produce "**hello **",
    // which CommonMark refuses to parse as emphasis.
    const { view, dispatch } = makeMockView('hello world', 0, 6);
    toggleInlineFormat(view, 'strong');
    const result = applyDispatch(view, dispatch);
    expect(result.doc.toString()).toBe('**hello** world');
  });

  it('Strong_SelectionWithLeadingAndTrailingSpace_TrimsBothSides', () => {
    const { view, dispatch } = makeMockView('a hello b', 1, 8);
    toggleInlineFormat(view, 'strong');
    const result = applyDispatch(view, dispatch);
    expect(result.doc.toString()).toBe('a **hello** b');
    expect(result.sliceDoc(result.selection.main.from, result.selection.main.to)).toBe('hello');
  });

  it('Strong_WhitespaceOnlySelection_WrapsAsIsAndSelectsMarkers', () => {
    const { view, dispatch } = makeMockView('a   b', 1, 4);
    toggleInlineFormat(view, 'strong');
    const result = applyDispatch(view, dispatch);
    expect(result.doc.toString()).toBe('a**   **b');
  });
});

describe('toggleInlineFormat — nested formatting', () => {
  const doc = '**a _b_ c**';
  // StrongEmphasis[0,11): "**" [0,2), then "a _b_ c" [2,9), then "**" [9,11).
  // Inside: Emphasis[3,6): "_" [3,4) "b" [4,5) "_" [5,6).

  it('Emphasis_SelectionOnNestedB_RemovesOnlyInnerEmphasis', () => {
    const { view, dispatch } = makeMockView(doc, 4, 5);
    toggleInlineFormat(view, 'emphasis');
    const result = applyDispatch(view, dispatch);
    expect(result.doc.toString()).toBe('**a b c**');
  });

  it('Strong_SelectionOnNestedB_RemovesOuterStrongDespiteNesting', () => {
    // The selection ("b") sits inside the inner Emphasis node, but is also
    // fully contained by the outer StrongEmphasis — toggling "strong"
    // walks past Emphasis to find and remove the outer node.
    const { view, dispatch } = makeMockView(doc, 4, 5);
    toggleInlineFormat(view, 'strong');
    const result = applyDispatch(view, dispatch);
    expect(result.doc.toString()).toBe('a _b_ c');
  });

  it('Strong_SelectionSpanningWholeInnerText_DetectsActiveAndRemoves', () => {
    // [2,9) is "a _b_ c" — inside StrongEmphasis[0,11), not inside the
    // narrower Emphasis[3,6), so this is active for 'strong' but not for
    // 'emphasis'.
    const { view, dispatch } = makeMockView(doc, 2, 9);
    expect(isInlineFormatActive(view.state, 'strong', 2, 9)).toBe(true);
    expect(isInlineFormatActive(view.state, 'emphasis', 2, 9)).toBe(false);

    toggleInlineFormat(view, 'strong');
    const result = applyDispatch(view, dispatch);
    expect(result.doc.toString()).toBe('a _b_ c');
  });
});

describe('toggleInlineFormat — selection partially overlapping a node', () => {
  it('Strong_SelectionStartsInsideExistingBoldEndsOutside_WrapsRawTextVerbatim', () => {
    // Documented decision (see findEnclosingNode's comment in
    // format-commands.ts): when the selection is not *entirely* contained
    // in a single node of the target kind, we don't try to detect or
    // repair the partial overlap — we treat it as "add" and wrap exactly
    // what's selected, existing markers and all.
    //
    // "**bold** rest" — StrongEmphasis is [0,8) ("**bold**"). Selecting
    // [4,11) starts inside the bold text ("l" of "bold") and ends past the
    // closing "**", into " re" of " rest" — a partial overlap.
    const source = '**bold** rest';
    const { view, dispatch } = makeMockView(source, 4, 11);
    expect(isInlineFormatActive(view.state, 'strong', 4, 11)).toBe(false);

    toggleInlineFormat(view, 'strong');
    const result = applyDispatch(view, dispatch);

    // raw selected text "ld** re" gets wrapped verbatim in a fresh "**...**".
    expect(result.doc.toString()).toBe('**bo**ld** re**st');
    expect(result.sliceDoc(result.selection.main.from, result.selection.main.to)).toBe('ld** re');
  });
});

describe('toggleLink', () => {
  it('PlainSelection_WrapsAsMarkdownLinkWithEmptyUrl', () => {
    const { view, dispatch } = makeMockView('click here', 0, 10);
    toggleLink(view);
    const result = applyDispatch(view, dispatch);
    expect(result.doc.toString()).toBe('[click here]()');
  });

  it('PlainSelection_PlacesCaretInsideEmptyParens', () => {
    const { view, dispatch } = makeMockView('click here', 0, 10);
    toggleLink(view);
    const result = applyDispatch(view, dispatch);
    // "[click here](" is 13 chars — caret must sit right before the ")".
    expect(result.selection.main.from).toBe(13);
    expect(result.selection.main.to).toBe(13);
    expect(result.sliceDoc(12, 14)).toBe('()');
  });

  it('EmptySelection_WrapsEmptyTextStillProducingValidShape', () => {
    const { view, dispatch } = makeMockView('hello', 5, 5);
    toggleLink(view);
    const result = applyDispatch(view, dispatch);
    expect(result.doc.toString()).toBe('hello[]()');
    expect(result.selection.main.from).toBe(8);
    expect(result.sliceDoc(7, 9)).toBe('()');
  });

  it('AnySelection_DispatchesOpenInspectorForEffectAtLinkStart', () => {
    const { view, dispatch } = makeMockView('click here', 0, 10);
    toggleLink(view);
    expect(dispatch).toHaveBeenCalledTimes(1);
    const spec = dispatch.mock.calls[0][0];
    const effects: StateEffect<{ pos: number }>[] = Array.isArray(spec.effects)
      ? spec.effects
      : [spec.effects];
    const inspectorEffect = effects.find((e) => e.is(openInspectorFor));
    expect(inspectorEffect).toBeDefined();
    expect(inspectorEffect?.value).toEqual({ pos: 0 });
  });
});

describe('isLinkActive', () => {
  it('SelectionInsideLinkLabel_ReturnsTrue', () => {
    const { view } = makeMockView('[text](https://example.test)', 1, 5);
    expect(isLinkActive(view.state, 1, 5)).toBe(true);
  });

  it('SelectionOutsideAnyLink_ReturnsFalse', () => {
    const { view } = makeMockView('plain text', 0, 5);
    expect(isLinkActive(view.state, 0, 5)).toBe(false);
  });
});
