import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
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
