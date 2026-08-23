import type { Extension } from '@codemirror/state';
import { liveRenderAtomic } from './atomic';
import { blockFormatKeymap } from './block-format';
import { inlineContinuation } from './inline-continuation';
import { selectionToolbar } from './selection-toolbar';
import { elementInspector } from './inspector';

/**
 * Everything the live-render flavour adds on top of the shared decoration
 * layer. This bundle is only ever installed while that flavour is active —
 * in live-preview none of it is present in the editor state at all, which is
 * how the existing mode is guaranteed to behave exactly as before.
 *
 * Order matters in one place: `liveRenderAtomic` must come first, because the
 * keymaps and the input handler below all assume the caret has already been
 * normalised out of hidden marker ranges.
 *
 * `blockFormatKeymap` and the keymap inside `inlineContinuation()` are already
 * wrapped in `Prec.high()` at their source. That is not decoration: the main
 * keymap is registered in `setup.ts` *before* `previewCompartment`, and CM6
 * tries equal-precedence handlers in registration order, so without it
 * Backspace and Escape would never reach these handlers.
 */
export function liveRenderExtensions(): Extension[] {
  return [
    ...liveRenderAtomic,
    blockFormatKeymap,
    inlineContinuation(),
    selectionToolbar(),
    elementInspector(),
  ];
}

export { exitContinuationOnFormatToggle } from './inline-continuation';
export type { ExitableFormatKind } from './inline-continuation';
