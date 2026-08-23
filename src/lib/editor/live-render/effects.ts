import { StateEffect } from '@codemirror/state';

/**
 * Dispatched by `toggleLink` (see `format-commands.ts`) right after a new
 * `[text]()` link is inserted. `pos` is the position of the link's opening
 * `[`, valid in the document produced by that same transaction.
 *
 * Phase 7 (the element inspector) consumes this to pop open the URL editor
 * for a freshly created link without the user having to click back into it.
 * Nothing in this phase reads it.
 */
export const openInspectorFor = StateEffect.define<{ pos: number }>();
