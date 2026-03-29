import { keymap, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { autocompletion, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { codeFolding, foldKeymap, syntaxHighlighting } from '@codemirror/language';
import { classHighlighter } from '@lezer/highlight';
import { Strikethrough, Table } from '@lezer/markdown';
import { editorTheme } from '../theme/editor-theme';
import { markdownKeybindings } from './keybindings';
import { listContinuation } from './autocomplete';
import { slashCommands } from './slash-commands';
import { livePreviewPlugin } from './preview/plugin';
import { hoverBlockMenu } from './hover-menu';
import { markdownFoldService, headingFoldClick } from './folding';

export const previewCompartment = new Compartment();
export const languageCompartment = new Compartment();

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
    languageCompartment.of(
      markdown({
        base: markdownLanguage,
        codeLanguages: languages,
        extensions: [Strikethrough, Table],
      })
    ),
    keymap.of([
      ...foldKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...closeBracketsKeymap,
      ...searchKeymap,
    ]),
    markdownFoldService,
    codeFolding(),
    headingFoldClick,
    syntaxHighlighting(classHighlighter),
    previewCompartment.of(livePreviewPlugin),
    hoverBlockMenu(),
    EditorView.lineWrapping,
    EditorState.allowMultipleSelections.of(false),
  ];
}
