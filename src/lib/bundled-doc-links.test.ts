import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { Strikethrough, Table } from '@lezer/markdown';
import { slugify } from './editor/heading-slugs';

// The welcome document navigates itself with in-document links, which resolve
// through `slugify` at click time (see setup.ts's link mousedown handler). A
// renamed heading breaks them silently — nothing errors, the click just does
// nothing — so the pairing is asserted here instead.
const DOCS = ['../../src-tauri/welcome.md', '../../src-tauri/getting-started-ai.md'];

describe('bundled AI docs', () => {
  for (const rel of DOCS) {
    it(`${rel}: every in-document link points at a heading it contains`, () => {
      const text = readFileSync(new URL(rel, import.meta.url), 'utf8');

      const headings = new Set(
        [...text.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)].map((m) => slugify(m[1])),
      );
      const targets = [...text.matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1]);

      for (const target of targets) {
        expect(headings, `link #${target}`).toContain(slugify(decodeURIComponent(target)));
      }
    });
  }
});

// The AI menu docs put their "two ways" links inside bold. setup.ts's click
// handler resolves the URL from a `Link` node in the syntax tree, so a nesting
// that swallowed the link would render fine and do nothing when clicked.
describe('a link nested in bold', () => {
  it('still parses with its URL reachable in the syntax tree', () => {
    const state = EditorState.create({
      doc: '1. **[Paste the block](#md-mini-ai-interface) into its file** — simplest.',
      extensions: [markdown({ base: markdownLanguage, extensions: [Strikethrough, Table] })],
    });

    let url: string | null = null;
    syntaxTree(state).iterate({
      enter(node) {
        if (node.name === 'URL') url = state.doc.sliceString(node.from, node.to);
      },
    });

    expect(url).toBe('#md-mini-ai-interface');
  });
});
