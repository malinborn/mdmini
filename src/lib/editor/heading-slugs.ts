import { StateField, type EditorState, type StateEffect } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { foldedRanges, unfoldEffect } from '@codemirror/language';

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function buildIndex(state: EditorState): Map<string, number> {
  const map = new Map<string, number>();
  const counts = new Map<string, number>();
  const tree = syntaxTree(state);
  const doc = state.doc;

  tree.iterate({
    enter(node) {
      const name = node.name;
      if (!name.startsWith('ATXHeading') || name.length !== 11) return;

      const headerMark = node.node.getChild('HeaderMark');
      const textFrom = headerMark ? Math.min(headerMark.to + 1, node.to) : node.from;
      const raw = doc.sliceString(textFrom, node.to);
      const base = slugify(raw);
      if (!base) return;

      const n = counts.get(base) ?? 0;
      counts.set(base, n + 1);
      const slug = n === 0 ? base : `${base}-${n + 1}`;
      if (!map.has(slug)) {
        map.set(slug, doc.lineAt(node.from).from);
      }
    },
  });

  return map;
}

export const headingSlugsField = StateField.define<Map<string, number>>({
  create: (state) => buildIndex(state),
  update(value, tr) {
    if (!tr.docChanged) return value;
    return buildIndex(tr.state);
  },
});

export function getHeadingPos(state: EditorState, slug: string): number | null {
  const map = state.field(headingSlugsField, false);
  if (!map) return null;
  return map.get(slug) ?? null;
}

export function navigateToHeading(view: EditorView, rawSlug: string): boolean {
  let slug: string;
  try {
    slug = decodeURIComponent(rawSlug);
  } catch {
    slug = rawSlug;
  }
  slug = slug.toLowerCase();

  const pos = getHeadingPos(view.state, slug);
  if (pos === null) return false;

  const effects: StateEffect<unknown>[] = [];
  const folded = foldedRanges(view.state);
  folded.between(pos, pos + 1, (from, to) => {
    effects.push(unfoldEffect.of({ from, to }));
  });
  effects.push(EditorView.scrollIntoView(pos, { y: 'start' }));
  view.dispatch({ effects });
  return true;
}
