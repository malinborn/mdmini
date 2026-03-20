import { Decoration, WidgetType } from '@codemirror/view';
import type { EditorView } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { cursorInRange } from './utils';

class CheckboxWidget extends WidgetType {
  constructor(private checked: boolean, private pos: number) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = this.checked;
    input.className = 'cm-md-checkbox';
    input.addEventListener('click', (e) => {
      e.preventDefault();
      const replacement = this.checked ? '[ ]' : '[x]';
      view.dispatch({
        changes: { from: this.pos, to: this.pos + 3, insert: replacement },
      });
    });
    return input;
  }

  eq(other: CheckboxWidget): boolean {
    return this.checked === other.checked && this.pos === other.pos;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

class BulletWidget extends WidgetType {
  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-md-bullet';
    span.textContent = '\u2022';
    return span;
  }

  eq(): boolean {
    return true;
  }
}

export function decorateListItem(
  view: EditorView,
  node: SyntaxNode,
  builder: RangeSetBuilder<Decoration>
): void {
  if (cursorInRange(view, node.from, node.to)) return;

  const listMark = node.getChild('ListMark');
  if (!listMark) return;

  const doc = view.state.doc;
  const afterMark = doc.sliceString(listMark.to, Math.min(listMark.to + 5, doc.length));

  const checkboxMatch = afterMark.match(/^\s\[([x ])\]/);
  if (checkboxMatch) {
    const isChecked = checkboxMatch[1] === 'x';
    const checkboxStart = listMark.to + 1;
    builder.add(
      listMark.from,
      checkboxStart + 3,
      Decoration.replace({
        widget: new CheckboxWidget(isChecked, checkboxStart),
      })
    );
    return;
  }

  const markText = doc.sliceString(listMark.from, listMark.to);
  if (markText === '-' || markText === '*' || markText === '+') {
    builder.add(
      listMark.from,
      listMark.to,
      Decoration.replace({ widget: new BulletWidget() })
    );
  }
}

export function decorateBlockquote(
  view: EditorView,
  node: SyntaxNode,
  builder: RangeSetBuilder<Decoration>
): void {
  if (cursorInRange(view, node.from, node.to, true)) return;

  const doc = view.state.doc;
  const startLine = doc.lineAt(node.from);
  const endLine = doc.lineAt(node.to);

  for (let i = startLine.number; i <= endLine.number; i++) {
    const line = doc.line(i);
    builder.add(line.from, line.from, Decoration.line({ class: 'cm-md-blockquote' }));

    const match = line.text.match(/^(\s*>)\s?/);
    if (match) {
      builder.add(line.from, line.from + match[0].length, Decoration.replace({}));
    }
  }
}
