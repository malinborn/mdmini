import { describe, it, expect } from 'vitest';
import { EditorState, type Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { cursorInRange } from './utils';
import {
  flavourFacet,
  policyFor,
  shouldReveal,
  LIVE_PREVIEW,
  LIVE_RENDER,
  type Flavour,
} from './flavour';

// Structural mock — mirrors the pattern used in tables.test.ts /
// heading-slugs.test.ts. shouldReveal / cursorInRange only read `state`,
// so a real EditorView (which needs the DOM) isn't required.
function makeView(doc: string, anchor: number, extensions: Extension[] = []): EditorView {
  const state = EditorState.create({
    doc,
    selection: { anchor },
    extensions,
  });
  return { state } as unknown as EditorView;
}

describe('policyFor', () => {
  it('falls back to LIVE_PREVIEW default when facet is absent', () => {
    const view = makeView('hello', 0);
    expect(policyFor(view.state, 'heading')).toBe('on-cursor');
  });

  it('uses the per-element override when present', () => {
    const view = makeView('hello', 0, [flavourFacet.of(LIVE_RENDER)]);
    expect(policyFor(view.state, 'mermaid')).toBe('on-cursor');
    expect(policyFor(view.state, 'heading')).toBe('never');
  });

  it('combine takes the LAST provided value, so a reconfigure overrides', () => {
    const view = makeView('hello', 0, [
      flavourFacet.of(LIVE_PREVIEW),
      flavourFacet.of(LIVE_RENDER),
    ]);
    expect(policyFor(view.state, 'heading')).toBe('never');
  });
});

describe('shouldReveal', () => {
  const doc = 'para one\n**bold**\npara three\n';
  // "**bold**" spans [9, 17) on line 2 (line.from = 9, line.to = 17)
  const from = 9;
  const to = 17;

  it("under 'on-cursor', matches cursorInRange exactly — caret inside", () => {
    const view = makeView(doc, from + 2, [flavourFacet.of(LIVE_PREVIEW)]);
    expect(shouldReveal(view, 'strongEmphasis', from, to)).toBe(
      cursorInRange(view, from, to)
    );
    expect(shouldReveal(view, 'strongEmphasis', from, to)).toBe(true);
  });

  it("under 'on-cursor', matches cursorInRange exactly — caret outside", () => {
    const view = makeView(doc, 0, [flavourFacet.of(LIVE_PREVIEW)]);
    expect(shouldReveal(view, 'strongEmphasis', from, to)).toBe(
      cursorInRange(view, from, to)
    );
    expect(shouldReveal(view, 'strongEmphasis', from, to)).toBe(false);
  });

  it("under 'on-cursor' with blockLevel, matches cursorInRange exactly", () => {
    const view = makeView(doc, from + 2, [flavourFacet.of(LIVE_PREVIEW)]);
    expect(shouldReveal(view, 'fencedCode', from, to, true)).toBe(
      cursorInRange(view, from, to, true)
    );
    expect(shouldReveal(view, 'fencedCode', from, to, true)).toBe(true);
  });

  it("under 'never', returns false regardless of caret position — caret inside", () => {
    const view = makeView(doc, from + 2, [flavourFacet.of(LIVE_RENDER)]);
    expect(shouldReveal(view, 'strongEmphasis', from, to)).toBe(false);
  });

  it("under 'never', returns false regardless of caret position — caret outside", () => {
    const view = makeView(doc, 0, [flavourFacet.of(LIVE_RENDER)]);
    expect(shouldReveal(view, 'strongEmphasis', from, to)).toBe(false);
  });

  it('per-element override beats default: LIVE_RENDER reveals mermaid on-cursor', () => {
    const view = makeView(doc, from + 2, [flavourFacet.of(LIVE_RENDER)]);
    // default is 'never' for everything except the mermaid override
    expect(shouldReveal(view, 'strongEmphasis', from, to)).toBe(false);
    expect(shouldReveal(view, 'mermaid', from, to, true)).toBe(true);
  });

  it('facet absent → LIVE_PREVIEW semantics (on-cursor default, caret inside reveals)', () => {
    const view = makeView(doc, from + 2, []);
    expect(shouldReveal(view, 'strongEmphasis', from, to)).toBe(true);
  });

  it('facet absent → LIVE_PREVIEW semantics (on-cursor default, caret outside hides)', () => {
    const view = makeView(doc, 0, []);
    expect(shouldReveal(view, 'strongEmphasis', from, to)).toBe(false);
  });
});

describe('exported flavours', () => {
  it('LIVE_PREVIEW is default on-cursor with no overrides', () => {
    const f: Flavour = LIVE_PREVIEW;
    expect(f.default).toBe('on-cursor');
    expect(f.reveal).toBeUndefined();
  });

  it('LIVE_RENDER defaults to never, with mermaid revealed on-cursor', () => {
    const f: Flavour = LIVE_RENDER;
    expect(f.default).toBe('never');
    expect(f.reveal?.mermaid).toBe('on-cursor');
  });
});
