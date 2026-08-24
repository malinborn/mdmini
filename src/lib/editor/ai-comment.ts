import { StateEffect, StateField } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { quotePreview, type CommentThread } from '../comment-format';

/**
 * What a comment widget can ask the app to do. Carried on the `addAiComment`
 * effect itself (see below), never through module-level mutable state — the
 * callbacks are stable across a session while the widget is rebuilt on every
 * thread change, exactly the shape `ai-ask.ts`'s `AskSpec.onAnswer` already
 * solves. `eq()` on the widget deliberately excludes this field.
 */
export interface CommentActions {
  reply: (id: string, text: string) => void;
  resolve: (id: string) => void;
  handoff: (id: string) => void;
  insertIntoText: (id: string, text: string) => void;
}

export interface CommentSpec {
  thread: CommentThread;
  /** Quote not found in the document — thread is shown at its stored line. */
  orphaned: boolean;
  actions: CommentActions;
}

/** Adds a comment-thread widget, anchored at the end of the line containing `pos`. */
export const addAiComment = StateEffect.define<{
  thread: CommentThread;
  pos: number;
  /** End of the quoted fragment, for the in-document highlight. Equal to
   * `pos` when the anchor could not be found, i.e. nothing to mark. */
  to: number;
  orphaned: boolean;
  actions: CommentActions;
}>();

/**
 * Marks the fragment a thread is about. Without it the card states its quote
 * but the reader has to find those words themselves — the whole point of
 * anchoring is lost. Deliberately a `mark`, not a `replace`: the document text
 * must stay exactly as authored.
 *
 * Carries the thread id in its spec, because removal filters on identity and a
 * mark has no widget to recognise — without the id, closing a thread would
 * leave its highlight behind on the text forever.
 */
function anchorMark(threadId: string): Decoration {
  return Decoration.mark({
    class: 'cm-ai-comment-anchor',
    // Also on the DOM, so the attention plugin can find the spans belonging to
    // one thread without walking the decoration set.
    attributes: { 'data-comment-anchor': threadId },
    threadId,
  });
}

/** True for an anchor highlight belonging to `threadId`. */
function isAnchorOf(spec: unknown, threadId: string): boolean {
  return (spec as { threadId?: string })?.threadId === threadId;
}

/** Removes the comment widget with the given thread id. A no-op if that id
 * isn't present (e.g. a reload racing an already-resolved thread). */
export const removeAiComment = StateEffect.define<string>();

/** Removes every comment widget — used when the sidecar file is reloaded wholesale. */
export const clearAiComments = StateEffect.define<null>();

const STATUS_LABEL: Record<CommentThread['status'], string> = {
  open: 'ждёт агента',
  answered: 'есть ответ',
  resolved: 'решено',
};

export class CommentWidget extends WidgetType {
  constructor(readonly spec: CommentSpec) {
    super();
  }

  eq(other: CommentWidget): boolean {
    const a = this.spec.thread;
    const b = other.spec.thread;
    return (
      a.id === b.id &&
      a.status === b.status &&
      a.quote === b.quote &&
      this.spec.orphaned === other.spec.orphaned &&
      a.replies.length === b.replies.length &&
      a.replies.every(
        (reply, i) =>
          reply.author === b.replies[i].author &&
          reply.at === b.replies[i].at &&
          reply.text === b.replies[i].text
      )
    );
  }

  toDOM(): HTMLElement {
    const { thread, orphaned, actions } = this.spec;

    // CM6 measures a block widget's height from its root element's DOM box,
    // which does not include CSS margin (see ai-ask.ts's AskWidget for the
    // full explanation). Vertical spacing therefore lives on this outer
    // wrapper's padding; `.cm-ai-comment` itself carries no margin.
    const wrap = document.createElement('div');
    wrap.className = 'cm-ai-comment-wrap';

    const card = document.createElement('div');
    card.className = orphaned ? 'cm-ai-comment cm-ai-comment-orphaned' : 'cm-ai-comment';
    // Lets the attention plugin find this card by thread without holding a
    // reference to the DOM it built.
    card.setAttribute('data-comment-thread', thread.id);

    const head = document.createElement('div');
    head.className = 'cm-ai-comment-head';
    head.textContent = orphaned
      ? `${thread.id} · якорь потерян`
      : `${thread.id} · ${STATUS_LABEL[thread.status]}`;

    // The quoted fragment, right-aligned in the header. With several cards
    // stacked under one paragraph, the id and status alone do not say which
    // one is about what — and the highlight in the text only helps once you
    // have already found the right card.
    if (thread.quote) {
      const excerpt = document.createElement('span');
      excerpt.className = 'cm-ai-comment-excerpt';
      excerpt.textContent = quotePreview(thread.quote);
      excerpt.title = thread.quote;
      head.appendChild(excerpt);
    }
    card.appendChild(head);

    for (const reply of thread.replies) {
      const item = document.createElement('div');
      item.className = 'cm-ai-comment-reply';

      const who = document.createElement('div');
      who.className = 'cm-ai-comment-author';
      who.textContent = `${reply.author} · ${reply.at}`;
      item.appendChild(who);

      const body = document.createElement('div');
      body.className = 'cm-ai-comment-text';
      body.textContent = reply.text;
      item.appendChild(body);

      card.appendChild(item);
    }

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'cm-ai-comment-input';
    input.placeholder = 'Ответить…';
    // ignoreEvent() (below) only tells CM6's own handling to leave widget
    // events alone — it does not stop the DOM event from bubbling past
    // contentDOM to document-level listeners (e.g. the Escape-clears-
    // highlights keymap, or table.ts's own Escape handlers). A real,
    // focusable, editable input needs an explicit stopPropagation on every
    // key event. mousedown must stop propagation too, but NOT
    // preventDefault — preventDefault there would block the browser from
    // focusing/placing the caret in the input at all.
    input.addEventListener('mousedown', (event) => event.stopPropagation());
    input.addEventListener('keypress', (event) => event.stopPropagation());
    input.addEventListener('keyup', (event) => event.stopPropagation());
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key !== 'Enter') return;
      const text = input.value.trim();
      if (text) actions.reply(thread.id, text);
    });
    card.appendChild(input);

    const row = document.createElement('div');
    row.className = 'cm-ai-comment-actions';

    const button = (label: string, onClick: () => void, confirmLabel?: string) => {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = 'cm-ai-comment-button';
      element.textContent = label;
      // Keep the editor selection from moving to a click in the widget.
      element.addEventListener('mousedown', (event) => event.preventDefault());
      element.addEventListener('click', () => {
        onClick();
        // Copying to the clipboard is invisible — without a reply the button
        // looks like it did nothing at all. Say what happened, and say what to
        // do next, since the clipboard is only half the action.
        if (!confirmLabel) return;
        element.textContent = confirmLabel;
        // `className` rather than `classList`, matching `ai-ask.ts` — and the
        // DOM-less test harness in this repo models className only.
        element.className = 'cm-ai-comment-button cm-ai-comment-button-done';
        // Bare `setTimeout`, not `window.setTimeout`: the DOM-less test
        // harness stubs `document` but there is no `window` in that
        // environment at all. If the widget is rebuilt before this fires it
        // just relabels a detached element, which is harmless.
        setTimeout(() => {
          element.textContent = label;
          element.className = 'cm-ai-comment-button';
        }, 5000);
      });
      row.appendChild(element);
    };

    button(
      'отправить в агента',
      () => actions.handoff(thread.id),
      'отправьте промпт в сессию'
    );
    const last = thread.replies[thread.replies.length - 1];
    if (thread.status === 'answered' && last) {
      button('вставить в текст', () => actions.insertIntoText(thread.id, last.text));
    }
    if (thread.status !== 'resolved') {
      button('решено', () => actions.resolve(thread.id));
    }
    card.appendChild(row);

    wrap.appendChild(card);
    return wrap;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function isCommentWidget(widget: WidgetType): widget is CommentWidget {
  return widget instanceof CommentWidget;
}

/**
 * Holds one block widget per comment thread, keyed by thread id. Widgets are
 * anchored at a line boundary — the end of the line containing the requested
 * position — so inserting one never splits a table or mermaid block line.
 * Ranges map through edits, so a widget stays attached to its line as the
 * user types elsewhere.
 */
export const aiCommentField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(addAiComment)) {
        const { thread, pos, to, orphaned, actions } = effect.value;
        const clamped = Math.max(0, Math.min(pos, tr.state.doc.length));
        const anchor = tr.state.doc.lineAt(clamped).to;
        const widget = Decoration.widget({
          widget: new CommentWidget({ thread, orphaned, actions }),
          block: true,
          side: 1,
        });
        // Ranges handed to `update` must be sorted by `from`, and the mark
        // always starts at or before the widget's line-end anchor, so it goes
        // first. An empty range is skipped rather than added: CM6 rejects a
        // zero-length mark, and a detached thread has nothing to highlight.
        const markEnd = Math.max(clamped, Math.min(to, tr.state.doc.length));
        const add =
          markEnd > clamped
            ? [anchorMark(thread.id).range(clamped, markEnd), widget.range(anchor)]
            : [widget.range(anchor)];
        deco = deco.update({ add });
      } else if (effect.is(removeAiComment)) {
        const id = effect.value;
        deco = deco.update({
          filter: (_from, _to, value) => {
            if (isCommentWidget(value.spec.widget) && value.spec.widget.spec.thread.id === id) {
              return false;
            }
            // Drop the thread's anchor highlight too, or the text stays marked
            // after its card is gone.
            return !isAnchorOf(value.spec, id);
          },
        });
      } else if (effect.is(clearAiComments)) {
        deco = Decoration.none;
      }
    }
    return deco;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const CARD_ATTENTION = 'cm-ai-comment-attention';
const ANCHOR_ATTENTION = 'cm-ai-comment-anchor-attention';

/** Thread ids whose anchored fragment contains one of the caret positions. */
function threadsUnderCaret(view: EditorView): Set<string> {
  const out = new Set<string>();
  const set = view.state.field(aiCommentField, false);
  if (!set) return out;
  const heads = view.state.selection.ranges.map((r) => r.head);
  set.between(0, view.state.doc.length, (from, to, value) => {
    const id = (value.spec as { threadId?: string }).threadId;
    // Widgets carry no threadId and are zero-length anyway; only the anchor
    // marks answer here.
    if (!id || to <= from) return;
    if (heads.some((head) => head >= from && head <= to)) out.add(id);
  });
  return out;
}

/**
 * Links a comment card and the text it is about, in both directions.
 *
 * Put the caret in a commented fragment and its cards shimmer; work inside a
 * card and its fragment shimmers back. Several cards stacked under one
 * paragraph are otherwise indistinguishable — the header excerpt says what
 * each is about, and this says which one you are touching.
 *
 * Implemented by toggling classes on existing DOM, never by rebuilding the
 * widget. A rebuild per caret move would be wasteful, and worse, it would
 * discard whatever the user had typed into the reply input.
 */
class CommentAttentionPlugin {
  private highlighted = new Set<string>();
  private cardFocused: string | null = null;

  private readonly onFocusIn = (event: FocusEvent): void => this.claim(event.target);
  private readonly onPointerDown = (event: MouseEvent): void => this.claim(event.target);

  constructor(private readonly view: EditorView) {
    view.dom.addEventListener('focusin', this.onFocusIn);
    // Capture phase: the widget's own handlers call preventDefault/
    // stopPropagation, so a bubbling listener would never see the click.
    view.dom.addEventListener('mousedown', this.onPointerDown, true);
    this.syncCards();
  }

  /** Mark the fragment of whichever card the interaction landed in. */
  private claim(target: EventTarget | null): void {
    const el = target as Element | null;
    const card = el && 'closest' in el ? el.closest('[data-comment-thread]') : null;
    const id = card?.getAttribute('data-comment-thread') ?? null;
    if (id === this.cardFocused) return;
    this.cardFocused = id;
    this.syncAnchors();
  }

  update(update: ViewUpdate): void {
    // A decoration rebuild replaces the DOM, so the classes must be reapplied
    // even when the selection itself did not move.
    if (!update.selectionSet && !update.docChanged && !update.viewportChanged) return;
    this.syncCards();
    this.syncAnchors();
  }

  /** Caret → cards. */
  private syncCards(): void {
    const active = threadsUnderCaret(this.view);
    for (const id of this.highlighted) {
      if (!active.has(id)) this.setCardAttention(id, false);
    }
    for (const id of active) this.setCardAttention(id, true);
    this.highlighted = active;
  }

  /** Card → fragment. */
  private syncAnchors(): void {
    for (const el of this.view.dom.querySelectorAll('[data-comment-anchor]')) {
      el.classList.toggle(
        ANCHOR_ATTENTION,
        el.getAttribute('data-comment-anchor') === this.cardFocused
      );
    }
  }

  private setCardAttention(id: string, on: boolean): void {
    const card = this.view.dom.querySelector(`[data-comment-thread="${CSS.escape(id)}"]`);
    card?.classList.toggle(CARD_ATTENTION, on);
  }

  destroy(): void {
    this.view.dom.removeEventListener('focusin', this.onFocusIn);
    this.view.dom.removeEventListener('mousedown', this.onPointerDown, true);
  }
}

/** Bidirectional attention link between a card and its fragment. */
export const aiCommentAttention = ViewPlugin.fromClass(CommentAttentionPlugin);
