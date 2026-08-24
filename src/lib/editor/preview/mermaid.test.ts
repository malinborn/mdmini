// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { resolveTheme, mermaidCacheKey } from './mermaid';

describe('resolveTheme', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
  });

  it('DocumentElementIsNearestThemedAncestor_ResolvesDocumentTheme', () => {
    // The app's only themed element is <html data-theme="...">, so
    // documentElement is always the nearest ancestor there.
    document.documentElement.setAttribute('data-theme', 'aurora-dark');
    const view = new EditorView({ state: EditorState.create() });
    expect(resolveTheme(view)).toBe('dark');
    view.destroy();
  });

  it('NearestAncestorCarriesItsOwnTheme_OverridesTheDocumentTheme', () => {
    // The landing's demo cards each carry their own [data-theme] independent
    // of the page's — a light-themed card on a dark page must resolve light,
    // not fall through to documentElement.
    document.documentElement.setAttribute('data-theme', 'aurora-dark');
    const card = document.createElement('div');
    card.setAttribute('data-theme', 'light');
    const view = new EditorView({ state: EditorState.create(), parent: card });
    expect(resolveTheme(view)).toBe('default');
    view.destroy();
  });

  it('NearestAncestorIsDark_ResolvesDarkEvenOnALightPage', () => {
    document.documentElement.setAttribute('data-theme', 'aurora-light');
    const card = document.createElement('div');
    card.setAttribute('data-theme', 'dark');
    const view = new EditorView({ state: EditorState.create(), parent: card });
    expect(resolveTheme(view)).toBe('dark');
    view.destroy();
  });

  it('NoThemedAncestorAnywhere_FallsBackToDefault', () => {
    const view = new EditorView({ state: EditorState.create() });
    expect(resolveTheme(view)).toBe('default');
    view.destroy();
  });
});

describe('mermaidCacheKey', () => {
  it('SameSourceDifferentThemes_ProducesDistinctKeys', () => {
    // Without the theme in the key, a diagram rendered on a light card would
    // be served from cache to an identical-source diagram on a dark card.
    const lightCard = document.createElement('div');
    lightCard.setAttribute('data-theme', 'light');
    const lightView = new EditorView({ state: EditorState.create(), parent: lightCard });

    const darkCard = document.createElement('div');
    darkCard.setAttribute('data-theme', 'dark');
    const darkView = new EditorView({ state: EditorState.create(), parent: darkCard });

    const source = 'graph TD; A-->B';
    expect(mermaidCacheKey(lightView, source)).not.toBe(mermaidCacheKey(darkView, source));

    lightView.destroy();
    darkView.destroy();
  });

  it('SameSourceSameTheme_ProducesTheSameKey', () => {
    const cardA = document.createElement('div');
    cardA.setAttribute('data-theme', 'aurora-dark');
    const viewA = new EditorView({ state: EditorState.create(), parent: cardA });

    const cardB = document.createElement('div');
    cardB.setAttribute('data-theme', 'dark');
    const viewB = new EditorView({ state: EditorState.create(), parent: cardB });

    // aurora-dark and dark both resolve to mermaid's 'dark' theme — the key
    // is coarse-grained on the resolved mermaid theme, not the app theme name.
    const source = 'graph TD; A-->B';
    expect(mermaidCacheKey(viewA, source)).toBe(mermaidCacheKey(viewB, source));

    viewA.destroy();
    viewB.destroy();
  });
});
