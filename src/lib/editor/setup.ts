import { keymap, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { autocompletion, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { Strikethrough, Table } from '@lezer/markdown';
import { editorTheme } from '../theme/editor-theme';
import { markdownKeybindings } from './keybindings';
import { listContinuation } from './autocomplete';
import { slashCommands } from './slash-commands';
import { livePreviewPlugin } from './preview/plugin';
import { hoverBlockMenu } from './hover-menu';

export const previewCompartment = new Compartment();

export function createExtensions(): Extension[] {
  return [
    editorTheme,
    drawSelection(),
    listContinuation(),
    slashCommands(),
    autocompletion(),
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
    previewCompartment.of(livePreviewPlugin),
    hoverBlockMenu(),
    EditorView.lineWrapping,
    EditorState.allowMultipleSelections.of(false),
  ];
}
