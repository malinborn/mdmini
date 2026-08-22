import { describe, it, expect, vi, afterEach } from 'vitest';
import { EditorState } from '@codemirror/state';
import { addAiAsk, removeAiAsk, aiAskField, activeAskIds, AskWidget, type AskSpec } from './ai-ask';

function makeState(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [aiAskField] });
}

function makeSpec(overrides: Partial<AskSpec> = {}): AskSpec {
  return {
    id: 1,
    question: 'Continue?',
    options: ['Yes', 'No'],
    onAnswer: vi.fn(),
    ...overrides,
  };
}

/** All ask widgets currently in the field, as {pos, widget}. */
function collectWidgets(state: EditorState): Array<{ pos: number; widget: AskWidget }> {
  const set = state.field(aiAskField, false);
  const out: Array<{ pos: number; widget: AskWidget }> = [];
  if (set) {
    set.between(0, state.doc.length, (from, _to, value) => {
      const widget = (value.spec as { widget: unknown }).widget;
      if (widget instanceof AskWidget) out.push({ pos: from, widget });
    });
  }
  return out;
}

describe('aiAskField', () => {
  it('installs a widget decoration anchored at the end of the target line', () => {
    const state = makeState('line1\nline2\n');
    const pos = state.doc.line(1).from + 2; // mid line1
    const tr = state.update({ effects: addAiAsk.of({ spec: makeSpec(), pos }) });

    const widgets = collectWidgets(tr.state);
    expect(widgets).toHaveLength(1);
    expect(widgets[0].pos).toBe(state.doc.line(1).to);
    expect(activeAskIds(tr.state)).toEqual([1]);
  });

  it('anchors at doc end when pos is doc.length', () => {
    const state = makeState('line1\nline2');
    const tr = state.update({
      effects: addAiAsk.of({ spec: makeSpec(), pos: state.doc.length }),
    });
    expect(collectWidgets(tr.state)[0].pos).toBe(state.doc.length);
  });

  it('keeps two concurrent asks, each with its own widget', () => {
    let state = makeState('line1\nline2\nline3\n');
    state = state.update({
      effects: addAiAsk.of({ spec: makeSpec({ id: 1 }), pos: state.doc.line(1).from }),
    }).state;
    state = state.update({
      effects: addAiAsk.of({ spec: makeSpec({ id: 2, question: 'Second?' }), pos: state.doc.line(3).from }),
    }).state;

    expect(activeAskIds(state).sort()).toEqual([1, 2]);
  });

  it('removes only the widget matching the given id', () => {
    let state = makeState('line1\nline2\n');
    state = state.update({
      effects: addAiAsk.of({ spec: makeSpec({ id: 1 }), pos: state.doc.line(1).from }),
    }).state;
    state = state.update({
      effects: addAiAsk.of({ spec: makeSpec({ id: 2 }), pos: state.doc.line(2).from }),
    }).state;

    state = state.update({ effects: removeAiAsk.of(1) }).state;

    expect(activeAskIds(state)).toEqual([2]);
  });

  it('removing an absent id is a no-op', () => {
    let state = makeState('hello\n');
    state = state.update({
      effects: addAiAsk.of({ spec: makeSpec({ id: 1 }), pos: 0 }),
    }).state;

    state = state.update({ effects: removeAiAsk.of(999) }).state;

    expect(activeAskIds(state)).toEqual([1]);
  });

  it('maps the widget position through an edit above it', () => {
    let state = makeState('line1\nline2\nline3\n');
    const targetLineStart = state.doc.line(3).from;
    state = state.update({
      effects: addAiAsk.of({ spec: makeSpec(), pos: targetLineStart }),
    }).state;
    const before = collectWidgets(state)[0].pos;

    // Insert a new line before line 1 — shifts everything below down.
    const tr = state.update({ changes: { from: 0, to: 0, insert: 'XXXX\n' } });

    const after = collectWidgets(tr.state)[0].pos;
    expect(after).toBe(before + 'XXXX\n'.length);
    expect(activeAskIds(tr.state)).toEqual([1]);
  });
});

describe('AskWidget.eq', () => {
  it('is true for widgets with the same id, question, and options', () => {
    const a = new AskWidget(makeSpec());
    const b = new AskWidget(makeSpec()); // different onAnswer identity, same data
    expect(a.eq(b)).toBe(true);
  });

  it('is false when the id differs', () => {
    const a = new AskWidget(makeSpec({ id: 1 }));
    const b = new AskWidget(makeSpec({ id: 2 }));
    expect(a.eq(b)).toBe(false);
  });

  it('is false when the question differs', () => {
    const a = new AskWidget(makeSpec({ question: 'A?' }));
    const b = new AskWidget(makeSpec({ question: 'B?' }));
    expect(a.eq(b)).toBe(false);
  });

  it('is false when the options differ', () => {
    const a = new AskWidget(makeSpec({ options: ['Yes', 'No'] }));
    const b = new AskWidget(makeSpec({ options: ['Yes', 'Maybe'] }));
    expect(a.eq(b)).toBe(false);
  });

  it('is false when the option count differs', () => {
    const a = new AskWidget(makeSpec({ options: ['Yes', 'No'] }));
    const b = new AskWidget(makeSpec({ options: ['Yes'] }));
    expect(a.eq(b)).toBe(false);
  });
});

describe('AskWidget.ignoreEvent', () => {
  it('always returns true, so CM6 does not turn clicks into selection changes', () => {
    const widget = new AskWidget(makeSpec());
    expect(widget.ignoreEvent()).toBe(true);
  });
});

// --- toDOM click wiring ------------------------------------------------
//
// This project's test env has no DOM (no jsdom/happy-dom dependency — see
// tables.test.ts, which likewise never calls TableWidget.toDOM()). Rather
// than skip the click wiring entirely, stub a minimal `document` with just
// enough surface (createElement/appendChild/addEventListener/setAttribute)
// for `toDOM()` to run, and fire the recorded listeners directly.

interface FakeElement {
  tagName: string;
  className: string;
  type: string;
  textContent: string;
  children: FakeElement[];
  attributes: Record<string, string>;
  listeners: Record<string, Array<(event: { preventDefault(): void }) => void>>;
  appendChild(child: FakeElement): void;
  addEventListener(type: string, handler: (event: { preventDefault(): void }) => void): void;
  setAttribute(name: string, value: string): void;
}

function createFakeElement(tagName: string): FakeElement {
  const el: FakeElement = {
    tagName,
    className: '',
    type: '',
    textContent: '',
    children: [],
    attributes: {},
    listeners: {},
    appendChild(child) {
      el.children.push(child);
    },
    addEventListener(type, handler) {
      (el.listeners[type] ??= []).push(handler);
    },
    setAttribute(name, value) {
      el.attributes[name] = value;
    },
  };
  return el;
}

function fire(el: FakeElement, type: string): void {
  for (const handler of el.listeners[type] ?? []) {
    handler({ preventDefault: () => {} });
  }
}

function findByClass(root: FakeElement, className: string): FakeElement[] {
  const out: FakeElement[] = [];
  if (root.className === className) out.push(root);
  for (const child of root.children) out.push(...findByClass(child, className));
  return out;
}

describe('AskWidget.toDOM click wiring', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('clicking an option button calls onAnswer with (id, option text)', () => {
    vi.stubGlobal('document', { createElement: createFakeElement });
    const onAnswer = vi.fn();
    const widget = new AskWidget(makeSpec({ id: 42, options: ['Yes', 'No'], onAnswer }));

    const dom = widget.toDOM() as unknown as FakeElement;
    const [yesButton] = findByClass(dom, 'cm-ai-ask-option');
    fire(yesButton, 'click');

    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith(42, 'Yes');
  });

  it('clicking the dismiss button calls onAnswer with (id, null)', () => {
    vi.stubGlobal('document', { createElement: createFakeElement });
    const onAnswer = vi.fn();
    const widget = new AskWidget(makeSpec({ id: 7, onAnswer }));

    const dom = widget.toDOM() as unknown as FakeElement;
    const [dismissButton] = findByClass(dom, 'cm-ai-ask-dismiss');
    fire(dismissButton, 'click');

    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith(7, null);
  });

  it('renders one option button per option, plus the question text', () => {
    vi.stubGlobal('document', { createElement: createFakeElement });
    const widget = new AskWidget(makeSpec({ question: 'Pick one', options: ['A', 'B', 'C'] }));

    const dom = widget.toDOM() as unknown as FakeElement;
    expect(findByClass(dom, 'cm-ai-ask-option')).toHaveLength(3);
    expect(findByClass(dom, 'cm-ai-ask-question')[0].textContent).toBe('Pick one');
  });
});
