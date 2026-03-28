import { EditorView } from '@codemirror/view';

export const editorTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--bg-base)',
    color: 'var(--text-primary)',
    fontFamily: 'var(--font-text)',
  },
  '.cm-content': {
    caretColor: 'var(--color-cursor)',
    fontFamily: 'var(--font-text)',
    padding: '0',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--color-cursor)',
    borderLeftWidth: '2px',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--color-selection) !important',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--color-line-highlight)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--bg-base)',
    color: 'var(--text-muted)',
    border: 'none',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--color-line-highlight)',
  },
  '.cm-panels': {
    backgroundColor: 'var(--bg-surface)',
    color: 'var(--text-primary)',
  },
  '.cm-panels.cm-panels-top': {
    borderBottom: '1px solid var(--color-border)',
  },
  '.cm-searchMatch': {
    backgroundColor: 'var(--color-selection) !important',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--bg-surface)',
    color: 'var(--text-primary)',
    border: '1px solid var(--color-border)',
  },
  '.cm-tooltip-autocomplete': {
    '& > ul > li[aria-selected]': {
      backgroundColor: 'var(--highlight)',
    },
  },
});
