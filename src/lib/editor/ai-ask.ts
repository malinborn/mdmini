import { StateEffect, StateField, type EditorState } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';

/**
 * One pending `mdmini ask` question. Rendered as a widget in the document —
 * never inserted into the document text, so it must never be autosaved. The
 * socket call behind an ask blocks until `onAnswer` fires (a button click) or
 * the widget is removed by a timeout/dismiss, at which point the caller
 * reports the answer back over `ai_respond`.
 */
export interface AskSpec {
  id: number;
  question: string;
  options: string[];
  /** Fires once: `answer` is the clicked option's text, or `null` for a dismiss. */
  onAnswer: (id: number, answer: string | null) => void;
}

/** Adds an ask widget, anchored at the end of the line containing `pos`. */
export const addAiAsk = StateEffect.define<{ spec: AskSpec; pos: number }>();

/** Removes the ask widget with the given id. A no-op if that id isn't present
 * (e.g. the stale-widget cleanup timer racing an already-answered click). */
export const removeAiAsk = StateEffect.define<number>();

/** Exported for tests: `eq()` structural comparison and `toDOM()` wiring. */
export class AskWidget extends WidgetType {
  constructor(readonly spec: AskSpec) {
    super();
  }

  eq(other: AskWidget): boolean {
    return (
      this.spec.id === other.spec.id &&
      this.spec.question === other.spec.question &&
      this.spec.options.length === other.spec.options.length &&
      this.spec.options.every((option, i) => option === other.spec.options[i])
    );
  }

  toDOM(): HTMLElement {
    const { id, question, options, onAnswer } = this.spec;

    const card = document.createElement('div');
    card.className = 'cm-ai-ask';

    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'cm-ai-ask-dismiss';
    dismiss.setAttribute('aria-label', 'Dismiss');
    dismiss.textContent = '✕';
    // Keep the editor selection from moving to a click in the widget.
    dismiss.addEventListener('mousedown', (event) => event.preventDefault());
    dismiss.addEventListener('click', () => onAnswer(id, null));
    card.appendChild(dismiss);

    const questionEl = document.createElement('div');
    questionEl.className = 'cm-ai-ask-question';
    questionEl.textContent = question;
    card.appendChild(questionEl);

    const optionsRow = document.createElement('div');
    optionsRow.className = 'cm-ai-ask-options';
    for (const option of options) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cm-ai-ask-option';
      button.textContent = option;
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', () => onAnswer(id, option));
      optionsRow.appendChild(button);
    }
    card.appendChild(optionsRow);

    return card;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function isAskWidget(widget: WidgetType): widget is AskWidget {
  return widget instanceof AskWidget;
}

/**
 * Holds one block widget per pending `ask`, each carrying its own `AskSpec`
 * (multiple concurrent asks coexist, keyed by id). Widgets are anchored at a
 * line boundary — the end of the line containing the requested position — so
 * inserting one never splits a table or mermaid block line. Ranges map
 * through edits like `aiHighlightField`, so a widget stays attached to its
 * line as the user types elsewhere.
 */
export const aiAskField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(addAiAsk)) {
        const { spec, pos } = effect.value;
        const clamped = Math.max(0, Math.min(pos, tr.state.doc.length));
        const anchor = tr.state.doc.lineAt(clamped).to;
        const widget = Decoration.widget({ widget: new AskWidget(spec), block: true, side: 1 });
        deco = deco.update({ add: [widget.range(anchor)] });
      } else if (effect.is(removeAiAsk)) {
        const id = effect.value;
        deco = deco.update({
          filter: (_from, _to, value) => !(isAskWidget(value.spec.widget) && value.spec.widget.spec.id === id),
        });
      }
    }
    return deco;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Ids of all currently-active ask widgets, in document order. */
export function activeAskIds(state: EditorState): number[] {
  const set = state.field(aiAskField, false);
  if (!set) return [];
  const ids: number[] = [];
  set.between(0, state.doc.length, (_from, _to, value) => {
    if (isAskWidget(value.spec.widget)) ids.push(value.spec.widget.spec.id);
  });
  return ids;
}
