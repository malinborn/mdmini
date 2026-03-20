import { keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { searchKeymap } from '@codemirror/search';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { Strikethrough, Table } from '@lezer/markdown';
import { editorTheme } from '../theme/editor-theme';
import { markdownKeybindings } from './keybindings';

export function createExtensions(): Extension[] {
  return [
    editorTheme,
    markdownKeybindings(),
    history(),
    closeBrackets(),
    markdown({
      base: markdownLanguage,
      codeLanguages: languages,
      extensions: [Strikethrough, Table], // GFM: strikethrough + tables
    }),
    keymap.of([
      ...defaultKeymap,
      ...historyKeymap,
      ...closeBracketsKeymap,
      ...searchKeymap,
    ]),
    EditorView.lineWrapping,
    EditorState.allowMultipleSelections.of(false),
  ];
}
