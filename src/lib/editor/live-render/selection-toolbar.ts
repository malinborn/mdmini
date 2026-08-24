import { computePosition, flip, offset, shift } from '@floating-ui/dom';
import { ViewPlugin } from '@codemirror/view';
import type { EditorView, ViewUpdate } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import {
  toggleInlineFormat,
  toggleLink,
  isInlineFormatActive,
  isLinkActive,
  type InlineFormatKind,
} from './format-commands';
import '../../../styles/live-render.css';

/**
 * Floating toolbar shown over a non-empty selection in live-render mode,
 * where markdown markers are permanently hidden and can no longer be typed
 * by hand. Same bare-DOM + `@floating-ui/dom` approach as `hover-menu.ts` —
 * this is CM6-layer UI, not a Svelte component.
 */

let activePopup: HTMLElement | null = null;
let activeButtons: HTMLButtonElement[] = [];
let activeEditorDom: HTMLElement | null = null;

function hidePopup(): void {
  if (activePopup) {
    activePopup.remove();
    activePopup = null;
    activeButtons = [];
  }
  activeEditorDom = null;
  document.removeEventListener('click', onOutsideClick, true);
  document.removeEventListener('keydown', onKeydown, true);
}

function onOutsideClick(e: MouseEvent): void {
  if (!activePopup) return;
  const target = e.target as Node;
  if (activePopup.contains(target)) return;
  // A click inside the editor is exactly what creates or clears a selection,
  // and the plugin's update() already hides the toolbar the moment the
  // selection collapses. Counting it as an outside click closed the toolbar on
  // the very mouseup that produced the selection: drag-selecting fires
  // selectionSet on mousemove, so the listener is already armed by the time
  // the trailing click arrives, and the toolbar flashed and vanished while the
  // selection was still there.
  if (activeEditorDom?.contains(target)) return;
  hidePopup();
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && activePopup) {
    e.preventDefault();
    e.stopPropagation();
    hidePopup();
  }
}

interface FormatButtonSpec {
  kind: InlineFormatKind;
  label: string;
  ariaLabel: string;
  cssClass: string;
}

const FORMAT_BUTTONS: FormatButtonSpec[] = [
  { kind: 'strong', label: 'B', ariaLabel: 'Bold', cssClass: 'cm-selection-toolbar-btn-bold' },
  { kind: 'emphasis', label: 'I', ariaLabel: 'Italic', cssClass: 'cm-selection-toolbar-btn-italic' },
  {
    kind: 'strikethrough',
    label: 'S',
    ariaLabel: 'Strikethrough',
    cssClass: 'cm-selection-toolbar-btn-strike',
  },
  {
    kind: 'inlineCode',
    label: '</>',
    ariaLabel: 'Code',
    cssClass: 'cm-selection-toolbar-btn-code',
  },
];

function makeButton(label: string, ariaLabel: string, cssClass: string, kind: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `cm-selection-toolbar-btn ${cssClass}`;
  btn.textContent = label;
  btn.setAttribute('aria-label', ariaLabel);
  btn.setAttribute('aria-pressed', 'false');
  btn.dataset.kind = kind;
  return btn;
}

function buildPopup(view: EditorView): HTMLElement {
  const popup = document.createElement('div');
  popup.className = 'cm-selection-toolbar-popup';
  popup.setAttribute('role', 'toolbar');
  popup.setAttribute('aria-label', 'Text formatting');
  activeButtons = [];

  for (const spec of FORMAT_BUTTONS) {
    const btn = makeButton(spec.label, spec.ariaLabel, spec.cssClass, spec.kind);
    btn.addEventListener('mousedown', (e) => {
      // preventDefault keeps focus (and the selection) in the editor —
      // same trick hover-menu.ts uses for its gutter buttons.
      e.preventDefault();
      toggleInlineFormat(view, spec.kind);
      view.focus();
    });
    popup.appendChild(btn);
    activeButtons.push(btn);
  }

  const divider = document.createElement('div');
  divider.className = 'cm-selection-toolbar-divider';
  popup.appendChild(divider);

  // Commenting on a selection belongs here more than anywhere else — this
  // toolbar is already the answer to "I have selected something, now what".
  // `dataset.kind` is deliberately left unset: `updateButtonStates` iterates
  // the buttons and asks whether each format is active, and a comment has no
  // active state to report.
  if (onCommentRef) {
    const commentBtn = document.createElement('button');
    commentBtn.type = 'button';
    commentBtn.className = 'cm-selection-toolbar-btn cm-selection-toolbar-btn-comment';
    commentBtn.textContent = '💬';
    commentBtn.setAttribute('aria-label', 'Comment on selection');
    commentBtn.addEventListener('mousedown', (e) => {
      // Same preventDefault reason as the format buttons: the selection must
      // survive the click, since it is what the comment anchors to.
      e.preventDefault();
      onCommentRef?.();
      hidePopup();
    });
    popup.appendChild(commentBtn);

    const commentDivider = document.createElement('div');
    commentDivider.className = 'cm-selection-toolbar-divider';
    popup.appendChild(commentDivider);
  }

  const linkBtn = makeButton('Link', 'Link', 'cm-selection-toolbar-btn-link', 'link');
  linkBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    toggleLink(view);
    view.focus();
  });
  popup.appendChild(linkBtn);
  activeButtons.push(linkBtn);

  return popup;
}

function updateButtonStates(view: EditorView, from: number, to: number): void {
  for (const btn of activeButtons) {
    const kind = btn.dataset.kind;
    if (!kind) continue;
    const active =
      kind === 'link'
        ? isLinkActive(view.state, from, to)
        : isInlineFormatActive(view.state, kind as InlineFormatKind, from, to);
    btn.setAttribute('aria-pressed', String(active));
  }
}

/**
 * A `VirtualElement` (per `@floating-ui/dom`) spanning the current
 * selection, built from `coordsAtPos` on its two ends. Falls back to a
 * zero-size rect at the editor's top-left if either end has scrolled out
 * of the rendered viewport, so `computePosition` always has something to
 * work with.
 */
function selectionReference(
  view: EditorView,
  from: number,
  to: number
): { getBoundingClientRect(): DOMRect; contextElement: Element } {
  return {
    contextElement: view.dom,
    getBoundingClientRect(): DOMRect {
      const start = view.coordsAtPos(from);
      const end = view.coordsAtPos(to, -1);
      if (!start || !end) {
        const editorRect = view.dom.getBoundingClientRect();
        return new DOMRect(editorRect.left, editorRect.top, 0, 0);
      }
      const left = Math.min(start.left, end.left);
      const right = Math.max(start.right, end.right);
      const top = Math.min(start.top, end.top);
      const bottom = Math.max(start.bottom, end.bottom);
      return new DOMRect(left, top, right - left, bottom - top);
    },
  };
}

function positionPopup(view: EditorView, from: number, to: number): void {
  if (!activePopup) return;
  const popup = activePopup;
  const reference = selectionReference(view, from, to);

  computePosition(reference, popup, {
    placement: 'top',
    middleware: [offset(8), flip(), shift({ padding: 8 })],
  }).then(({ x, y }) => {
    // Popup may have been dismissed while computePosition was pending.
    if (activePopup !== popup) return;
    Object.assign(popup.style, { left: `${x}px`, top: `${y}px` });
  });
}

function showToolbar(view: EditorView, from: number, to: number): void {
  if (!activePopup) {
    activePopup = buildPopup(view);
    activeEditorDom = view.dom;
    document.body.appendChild(activePopup);
    // Registered synchronously: onOutsideClick now ignores clicks inside the
    // editor, so there is no self-inflicted close to defer around.
    document.addEventListener('click', onOutsideClick, true);
    document.addEventListener('keydown', onKeydown, true);
  }
  updateButtonStates(view, from, to);
  positionPopup(view, from, to);
}

class SelectionToolbarPlugin {
  private readonly view: EditorView;
  private readonly onBlur = (): void => hidePopup();

  constructor(view: EditorView) {
    this.view = view;
    view.dom.addEventListener('blur', this.onBlur);
  }

  update(update: ViewUpdate): void {
    if (!update.selectionSet && !update.docChanged && !update.focusChanged) return;

    const { state } = update.view;
    const range = state.selection.main;

    if (range.empty || !update.view.hasFocus) {
      hidePopup();
      return;
    }

    showToolbar(update.view, range.from, range.to);
  }

  destroy(): void {
    this.view.dom.removeEventListener('blur', this.onBlur);
    hidePopup();
  }
}

/**
 * Callback for the comment button, supplied by the app.
 *
 * Module-level rather than carried on the plugin, because the popup is built
 * lazily from `buildPopup` deep inside this module and the DOM here is bare,
 * not a component tree. Set once per editor configuration; there is only ever
 * one popup on screen.
 */
let onCommentRef: (() => void) | null = null;

export function selectionToolbar(options?: { onComment?: () => void }): Extension {
  onCommentRef = options?.onComment ?? null;
  return ViewPlugin.fromClass(SelectionToolbarPlugin);
}
