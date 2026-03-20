import { computePosition, flip, offset } from '@floating-ui/dom';
import { GutterMarker, gutter } from '@codemirror/view';
import type { EditorView, BlockInfo } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

interface BlockCommand {
  label: string;
  detail: string;
  insert: string;
  cursorOffset?: number;
}

const blockCommands: BlockCommand[] = [
  { label: 'Heading 1', detail: 'h1', insert: '# ' },
  { label: 'Heading 2', detail: 'h2', insert: '## ' },
  { label: 'Heading 3', detail: 'h3', insert: '### ' },
  { label: 'Heading 4', detail: 'h4', insert: '#### ' },
  { label: 'Heading 5', detail: 'h5', insert: '##### ' },
  { label: 'Heading 6', detail: 'h6', insert: '###### ' },
  { label: 'Bullet list', detail: 'ul', insert: '- ' },
  { label: 'Numbered list', detail: 'ol', insert: '1. ' },
  { label: 'Checkbox', detail: 'task', insert: '- [ ] ' },
  { label: 'Code block', detail: 'code', insert: '```\n\n```', cursorOffset: -4 },
  {
    label: 'Table',
    detail: 'table',
    insert: '| Column 1 | Column 2 |\n|----------|----------|\n|          |          |\n',
  },
  { label: 'Blockquote', detail: 'quote', insert: '> ' },
  { label: 'Horizontal rule', detail: 'hr', insert: '---\n' },
];

let activePopup: HTMLElement | null = null;
let activeView: EditorView | null = null;

function hidePopup(): void {
  if (activePopup) {
    activePopup.remove();
    activePopup = null;
  }
  document.removeEventListener('click', onOutsideClick, true);
}

function onOutsideClick(e: MouseEvent): void {
  if (activePopup && !activePopup.contains(e.target as Node)) {
    hidePopup();
  }
}

function showPopup(button: HTMLElement, view: EditorView, linePos: number): void {
  hidePopup();

  activeView = view;

  const popup = document.createElement('div');
  popup.className = 'cm-hover-menu-popup';

  for (const cmd of blockCommands) {
    const item = document.createElement('button');
    item.className = 'cm-hover-menu-item';
    item.type = 'button';

    const labelSpan = document.createElement('span');
    labelSpan.className = 'cm-hover-menu-item-label';
    labelSpan.textContent = cmd.label;

    const detailSpan = document.createElement('span');
    detailSpan.className = 'cm-hover-menu-item-detail';
    detailSpan.textContent = cmd.detail;

    item.appendChild(labelSpan);
    item.appendChild(detailSpan);

    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      applyCommand(view, linePos, cmd);
      hidePopup();
    });

    popup.appendChild(item);
  }

  document.body.appendChild(popup);
  activePopup = popup;

  computePosition(button, popup, {
    placement: 'right-start',
    middleware: [offset(4), flip()],
  }).then(({ x, y }) => {
    Object.assign(popup.style, {
      left: `${x}px`,
      top: `${y}px`,
    });
  });

  // Defer to avoid immediately triggering the outside-click handler
  setTimeout(() => {
    document.addEventListener('click', onOutsideClick, true);
  }, 0);
}

function applyCommand(view: EditorView, linePos: number, cmd: BlockCommand): void {
  const line = view.state.doc.lineAt(linePos);
  const lineText = line.text;

  // If line is empty, replace it; otherwise prepend the insert text
  let insertText: string;
  let from: number;
  let to: number;

  if (lineText.trim() === '') {
    insertText = cmd.insert;
    from = line.from;
    to = line.to;
  } else {
    insertText = cmd.insert;
    from = line.from;
    to = line.from;
  }

  const anchor = cmd.cursorOffset
    ? from + insertText.length + cmd.cursorOffset
    : from + insertText.length;

  view.dispatch({
    changes: { from, to, insert: insertText },
    selection: { anchor },
  });

  view.focus();
}

class BlockMenuMarker extends GutterMarker {
  private readonly linePos: number;

  constructor(linePos: number) {
    super();
    this.linePos = linePos;
  }

  override toDOM(view: EditorView): Node {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cm-hover-menu-btn';
    btn.textContent = '+';
    btn.setAttribute('aria-label', 'Insert block');

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      showPopup(btn, view, this.linePos);
    });

    return btn;
  }

  override eq(other: GutterMarker): boolean {
    return other instanceof BlockMenuMarker && other.linePos === this.linePos;
  }

  override destroy(_dom: Node): void {
    hidePopup();
  }
}

export function hoverBlockMenu(): Extension {
  return gutter({
    class: 'cm-hover-gutter',
    lineMarker(view: EditorView, line: BlockInfo): GutterMarker | null {
      return new BlockMenuMarker(line.from);
    },
    lineMarkerChange(): boolean {
      return false;
    },
    renderEmptyElements: true,
  });
}
