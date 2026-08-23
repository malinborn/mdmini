import {
  EditorSelection,
  Prec,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type TransactionSpec,
} from '@codemirror/state';
import { EditorView, ViewPlugin, keymap } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import '../../../styles/live-render-caret.css';

/**
 * Live-render, Phase 5 — inline-format continuation.
 *
 * Under the `'never'` reveal policy (Phase 1) markdown markers stay hidden
 * permanently, and Phase 2's `caretNormalizeFilter` collapses every caret
 * position inside a hidden marker onto the single canonical position
 * *outside* it (`resolveInner`'s outer edge). That is correct for caret
 * placement, but it means the closing `**` of `**bold**` and the character
 * right after it now paint at the same screen pixel — there is no visual
 * difference between "about to type inside the bold" and "about to type
 * after it".
 *
 * This module resolves the ambiguity by policy, the same way Notion and
 * Google Docs do: typing at that boundary **continues** the format by
 * default (`continuationRedirect`). Leaving the format is an explicit act —
 * `Escape`, or a Cmd+B-family toggle with an empty selection at the
 * boundary (see `continuationFormatExitSpec`) — never the arrow keys. An
 * arrow press at this boundary would move the caret two document offsets
 * without moving it one screen pixel (the marker is zero-width), which
 * reads as a dead key; binding exit to arrows was rejected in planning for
 * exactly that reason, so this module does not touch arrow key handling at
 * all.
 *
 * Everything that decides *whether* to redirect is a pure function of
 * `EditorState` (`findContinuationBoundary`, `continuationRedirect`,
 * `continuationEscapeSpec`, `continuationFormatExitSpec`,
 * `isContinuationActive`) so it is testable without a DOM — this project's
 * test env has no jsdom and no test constructs a real `EditorView`. Only
 * the thin wrappers at the bottom (`continuationInputHandler`, the caret
 * `ViewPlugin`, `exitContinuationOnEscape`) touch a view.
 */

export type ContinuableKind = 'strong' | 'emphasis' | 'strikethrough' | 'inlineCode';

/** The subset continuable via the existing Cmd+B / Cmd+I / Cmd+Shift+X bindings — see `continuationFormatExitSpec`. */
export type ExitableFormatKind = 'strong' | 'emphasis' | 'strikethrough';

const NODE_NAME: Record<ContinuableKind, string> = {
  strong: 'StrongEmphasis',
  emphasis: 'Emphasis',
  strikethrough: 'Strikethrough',
  inlineCode: 'InlineCode',
};

// Lezer tags both Emphasis and StrongEmphasis markers as `EmphasisMark` (the
// difference is marker length: `*`/`_` vs `**`/`__`) — same fact relied on
// by preview/inline.ts and live-render/format-commands.ts.
const MARK_NAME: Record<ContinuableKind, string> = {
  strong: 'EmphasisMark',
  emphasis: 'EmphasisMark',
  strikethrough: 'StrikethroughMark',
  inlineCode: 'CodeMark',
};

const KIND_BY_NODE_NAME: ReadonlyMap<string, ContinuableKind> = new Map(
  (Object.entries(NODE_NAME) as [ContinuableKind, string][]).map(([kind, name]) => [name, kind])
);

export interface ContinuationBoundary {
  kind: ContinuableKind;
  node: SyntaxNode;
  /** Position right before the closing marker starts — where continued typing should land. */
  insertAt: number;
}

/**
 * Is `pos` the canonical (outer) position immediately after the closing
 * marker of a `StrongEmphasis` / `Emphasis` / `Strikethrough` / `InlineCode`
 * node? Returns the innermost such node, walking up from
 * `resolveInner(pos, -1)` — the `-1` bias is what makes this resolve to the
 * node *ending* at `pos` rather than one starting there.
 *
 * That bias also decides the adjacent-spans case (`**a**_b_`, boundary at
 * the position between them): it resolves to the `StrongEmphasis` that
 * ends there, not the `Emphasis` that begins there, so typing continues the
 * span that was just closed rather than reaching into the one that hasn't
 * started yet. Reaching into an unopened node has no natural meaning here —
 * "continuation" is inherently about the format you just finished, not one
 * you're about to start — so favoring the left side is the only reading
 * that makes sense, independent of which format happens to be which.
 */
export function findContinuationBoundary(state: EditorState, pos: number): ContinuationBoundary | null {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1);
  while (node) {
    if (node.to === pos) {
      const kind = KIND_BY_NODE_NAME.get(node.name);
      if (kind) {
        const marks = node.getChildren(MARK_NAME[kind]);
        const closeMark = marks[marks.length - 1];
        // Guard against a malformed/single-mark node (shouldn't happen for
        // a well-formed StrongEmphasis/Emphasis/Strikethrough/InlineCode,
        // but a missing closing mark means there's nothing to continue).
        if (closeMark && closeMark.to === node.to && closeMark.from > node.from) {
          return { kind, node, insertAt: closeMark.from };
        }
      }
    }
    node = node.parent;
  }
  return null;
}

/** Effect carrying the boundary position where continuation is explicitly suppressed, or `null` to clear it. */
export const setSuppressedBoundary = StateEffect.define<number | null>();

/**
 * The one boundary position (if any) where the user has explicitly opted
 * out of continuation — via `Escape` or a Cmd+B-family toggle. `null` means
 * "no suppression active", which is the default (continue).
 *
 * Cleared automatically the moment the selection ends up anywhere other
 * than this exact position with an empty selection — "moves away and comes
 * back" is not sticky, matching the plan's requirement that suppression is
 * a one-shot exit, not a mode. Mapped through document changes (bias -1,
 * matching the boundary's own "outer edge" convention) so an edit earlier
 * in the document doesn't desync it from the position it actually refers
 * to.
 */
export const suppressedBoundaryField: StateField<number | null> = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setSuppressedBoundary)) {
        value = effect.value;
      }
    }
    if (value === null) return null;
    const mapped = tr.changes.mapPos(value, -1);
    const sel = tr.state.selection.main;
    if (!sel.empty || sel.head !== mapped) return null;
    return mapped;
  },
});

function isSuppressedAt(state: EditorState, pos: number): boolean {
  return state.field(suppressedBoundaryField, false) === pos;
}

/**
 * Pure decision for one typed insertion: redirect it to just before the
 * closing marker (continuing the format), or return `null` to let the
 * caller fall back to default insertion at `[from, to)`.
 *
 * Only handles the simple, single-position case (`from === to`, a plain
 * typed character) — a DOM change that already spans a range is a
 * selection replacement, not a continuation decision, so it's left alone.
 */
export function continuationRedirect(
  state: EditorState,
  from: number,
  to: number,
  insert: string
): TransactionSpec | null {
  if (from !== to || !insert) return null;
  const boundary = findContinuationBoundary(state, from);
  if (!boundary) return null;
  if (isSuppressedAt(state, from)) return null;

  return {
    changes: { from: boundary.insertAt, to: boundary.insertAt, insert },
    selection: EditorSelection.cursor(boundary.insertAt + insert.length),
    userEvent: 'input.type',
  };
}

/** Pure decision for `Escape`: suppress continuation at the current boundary, or `null` if there is none. */
export function continuationEscapeSpec(state: EditorState): TransactionSpec | null {
  const sel = state.selection.main;
  if (!sel.empty) return null;
  if (!findContinuationBoundary(state, sel.head)) return null;
  return { effects: setSuppressedBoundary.of(sel.head) };
}

/**
 * Pure decision for a Cmd+B-family toggle: if the selection is empty and
 * sits exactly at `kind`'s continuation boundary, suppress continuation
 * (same effect as `Escape`) instead of letting the normal toggle run.
 *
 * Contract for the integration step that wires this into `keybindings.ts`
 * (not this module — see report): call this *before* the existing
 * `toggleWrap` for the matching marker. A non-null return means "handled,
 * dispatch this and stop" — do not also call `toggleWrap` for this
 * keypress. A `null` return means "not at this boundary" — proceed with
 * `toggleWrap` exactly as today.
 *
 * The kind must match the key: Cmd+B only exits a `'strong'` boundary,
 * Cmd+I only `'emphasis'`, Cmd+Shift+X only `'strikethrough'`. Pressing the
 * "wrong" one at a boundary (e.g. Cmd+I while sitting right after a bold's
 * closing marker) is not an exit for that boundary and falls through to
 * `toggleWrap`'s normal behavior. There is no Cmd+B-family key for
 * `inlineCode` in `keybindings.ts` today, so exiting an inline-code
 * continuation is only reachable via `Escape`.
 */
export function continuationFormatExitSpec(
  state: EditorState,
  kind: ExitableFormatKind
): TransactionSpec | null {
  // Called from keybindings.ts, which is shared with live-preview. The field
  // is only installed by the live-render bundle, so its absence means this
  // mode is not active and Cmd+B must fall straight through to toggleWrap —
  // swallowing it here would change live-preview's behaviour.
  if (state.field(suppressedBoundaryField, false) === undefined) return null;
  const sel = state.selection.main;
  if (!sel.empty) return null;
  const boundary = findContinuationBoundary(state, sel.head);
  if (!boundary || boundary.kind !== kind) return null;
  return { effects: setSuppressedBoundary.of(sel.head) };
}

/** View wrapper around `continuationFormatExitSpec` for the future `keybindings.ts` integration — see its contract above. */
export function exitContinuationOnFormatToggle(view: EditorView, kind: ExitableFormatKind): boolean {
  const spec = continuationFormatExitSpec(view.state, kind);
  if (!spec) return false;
  view.dispatch(spec);
  return true;
}

/**
 * Whether the caret is currently in a continuing position: an empty
 * selection sitting at a continuation boundary that is not suppressed.
 * Drives the caret affordance below; exported for testing that logic
 * without touching the DOM-dependent `ViewPlugin`.
 */
export function isContinuationActive(state: EditorState): ContinuableKind | null {
  const sel = state.selection.main;
  if (!sel.empty) return null;
  const boundary = findContinuationBoundary(state, sel.head);
  if (!boundary) return null;
  if (isSuppressedAt(state, sel.head)) return null;
  return boundary.kind;
}

function continuationInputHandler(view: EditorView, from: number, to: number, insert: string): boolean {
  const spec = continuationRedirect(view.state, from, to, insert);
  if (!spec) return false;
  view.dispatch(spec);
  return true;
}

function exitContinuationOnEscape(view: EditorView): boolean {
  const spec = continuationEscapeSpec(view.state);
  if (!spec) return false;
  view.dispatch(spec);
  return true;
}

/** CSS class toggled on `view.dom` while `isContinuationActive` holds — see `live-render-caret.css`. */
const CONTINUATION_ACTIVE_CLASS = 'cm-continuation-active';

/**
 * The only way the user can otherwise tell whether the next character will
 * join the format is to try it and see. This plugin toggles a class on the
 * editor root (same idiom as the horizontal-scroll gutter fix in
 * `setup.ts`) so the caret itself can carry the hint — see
 * `live-render-caret.css` for the subtle styling.
 */
const continuationCaretPlugin = ViewPlugin.fromClass(
  class {
    constructor(private view: EditorView) {
      this.sync();
    }
    update(): void {
      this.sync();
    }
    destroy(): void {
      this.view.dom.classList.remove(CONTINUATION_ACTIVE_CLASS);
    }
    private sync(): void {
      const active = isContinuationActive(this.view.state) !== null;
      this.view.dom.classList.toggle(CONTINUATION_ACTIVE_CLASS, active);
    }
  }
);

/**
 * Bundles the input handler, the suppression field, and the `Escape`
 * binding. The keymap is wrapped in `Prec.high()` because the main keymap
 * is registered in `setup.ts` (`:50-56`) before `previewCompartment`
 * (`:62`), and equal-precedence handlers run in registration order — without
 * `Prec.high()` here, `aiHighlightKeymap`'s own `Escape` binding (registered
 * earlier in `setup.ts`, but at default precedence) would still lose to
 * ours whenever both apply, since default keymaps have no built-in
 * ordering guarantee against a keymap added later in the same extension
 * array. `aiHighlightKeymap`'s command already returns `false` when there
 * is nothing for it to clear, so the common case (no AI highlights active)
 * is unaffected either way — see report for the one case where the two
 * *do* overlap.
 */
export function inlineContinuation(): Extension {
  return [
    suppressedBoundaryField,
    EditorView.inputHandler.of(continuationInputHandler),
    continuationCaretPlugin,
    Prec.high(keymap.of([{ key: 'Escape', run: exitContinuationOnEscape }])),
  ];
}
