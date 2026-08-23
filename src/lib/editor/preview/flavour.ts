import { Facet } from '@codemirror/state';
import type { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { cursorInRange } from './utils';

/**
 * Per-element reveal policy. `'on-cursor'` is today's live-preview behaviour
 * (markdown syntax shows while the caret is on the element). `'never'` keeps
 * the rendered form up regardless of caret position — used by live-render.
 */
export type RevealPolicy = 'on-cursor' | 'never';

export type ElementKind =
  | 'heading'
  | 'emphasis'
  | 'strongEmphasis'
  | 'strikethrough'
  | 'inlineCode'
  | 'link'
  | 'listBullet'
  | 'blockquote'
  | 'horizontalRule'
  | 'fencedCode'
  | 'mermaid'
  | 'table';

/**
 * A flavour is a `default` policy plus optional per-element overrides.
 * `LIVE_PREVIEW` is today's behaviour by construction (default 'on-cursor',
 * no overrides) — not by review discipline.
 */
export interface Flavour {
  default: RevealPolicy;
  reveal?: Partial<Record<ElementKind, RevealPolicy>>;
}

export const LIVE_PREVIEW: Flavour = { default: 'on-cursor' };

export const LIVE_RENDER: Flavour = {
  default: 'never',
  reveal: { mermaid: 'on-cursor' },
};

/**
 * Facet holding the active flavour. Combine takes the LAST provided value so
 * a compartment reconfigure (switching flavours) overrides earlier input,
 * and falls back to LIVE_PREVIEW when nothing provides it — `.env`,
 * shell-secrets, and code-file plugins never configure this facet and must
 * keep behaving exactly as they do today.
 */
export const flavourFacet: Facet<Flavour, Flavour> = Facet.define({
  combine: (values) => (values.length ? values[values.length - 1] : LIVE_PREVIEW),
});

export function policyFor(state: EditorState, kind: ElementKind): RevealPolicy {
  const flavour = state.facet(flavourFacet);
  return flavour.reveal?.[kind] ?? flavour.default;
}

/**
 * Whether a decorator should reveal raw markdown for this element right now.
 * `'never'` short-circuits to false; `'on-cursor'` delegates to the existing
 * `cursorInRange` so on-cursor behaviour is unchanged bit-for-bit.
 */
export function shouldReveal(
  view: EditorView,
  kind: ElementKind,
  from: number,
  to: number,
  blockLevel: boolean = false
): boolean {
  const policy = policyFor(view.state, kind);
  if (policy === 'never') return false;
  return cursorInRange(view, from, to, blockLevel);
}
