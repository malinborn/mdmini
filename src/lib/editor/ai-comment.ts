import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import type { CommentThread } from '../comment-format';

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
  orphaned: boolean;
  actions: CommentActions;
}>();

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

    const head = document.createElement('div');
    head.className = 'cm-ai-comment-head';
    head.textContent = orphaned
      ? `${thread.id} · якорь потерян`
      : `${thread.id} · ${STATUS_LABEL[thread.status]}`;
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

    const button = (label: string, onClick: () => void) => {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = 'cm-ai-comment-button';
      element.textContent = label;
      // Keep the editor selection from moving to a click in the widget.
      element.addEventListener('mousedown', (event) => event.preventDefault());
      element.addEventListener('click', onClick);
      row.appendChild(element);
    };

    button('отправить в агента', () => actions.handoff(thread.id));
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
        const { thread, pos, orphaned, actions } = effect.value;
        const clamped = Math.max(0, Math.min(pos, tr.state.doc.length));
        const anchor = tr.state.doc.lineAt(clamped).to;
        const widget = Decoration.widget({
          widget: new CommentWidget({ thread, orphaned, actions }),
          block: true,
          side: 1,
        });
        deco = deco.update({ add: [widget.range(anchor)] });
      } else if (effect.is(removeAiComment)) {
        const id = effect.value;
        deco = deco.update({
          filter: (_from, _to, value) =>
            !(isCommentWidget(value.spec.widget) && value.spec.widget.spec.thread.id === id),
        });
      } else if (effect.is(clearAiComments)) {
        deco = Decoration.none;
      }
    }
    return deco;
  },
  provide: (field) => EditorView.decorations.from(field),
});
