<script lang="ts">
  import { onMount } from 'svelte';
  import { EditorView } from '@codemirror/view';
  import { EditorState, Transaction } from '@codemirror/state';
  import { createExtensions, languageCompartment, previewCompartment } from './setup';
  import { languages } from '@codemirror/language-data';
  import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
  import { Strikethrough, Table } from '@lezer/markdown';
  import { livePreviewPlugin } from './preview/plugin';
  import { envPreviewPlugin } from './preview/env';

  export interface EditorHandle {
    view: EditorView | undefined;
    replaceContent: (newContent: string) => void;
    setCodeMode: (ext: string | null) => void;
    setEnvMode: (enabled: boolean) => void;
  }

  let { onchange, handle = $bindable() }: {
    onchange?: (doc: string) => void;
    handle?: EditorHandle;
  } = $props();

  let editorContainer: HTMLDivElement;
  let view: EditorView | undefined = $state(undefined);

  $effect(() => {
    handle = {
      get view() {
        return view;
      },
      replaceContent(newContent: string) {
        if (!view) return;
        const docLen = view.state.doc.length;
        view.dispatch({
          changes: { from: 0, to: docLen, insert: newContent },
          selection: newContent.length > 0 ? { anchor: newContent.length } : undefined,
          annotations: Transaction.addToHistory.of(false),
        });
        if (newContent.length > 0) {
          view.contentDOM.blur();
        }
      },
      setCodeMode(ext: string | null) {
        if (!view) return;
        if (!ext) {
          // Back to markdown mode
          view.dispatch({
            effects: [
              languageCompartment.reconfigure(
                markdown({
                  base: markdownLanguage,
                  codeLanguages: languages,
                  extensions: [Strikethrough, Table],
                })
              ),
              previewCompartment.reconfigure(livePreviewPlugin),
            ],
          });
          view.dom.classList.remove('cm-code-file-mode');
          return;
        }
        // Find language by extension
        const lang = languages.find(l =>
          l.extensions.some(e => e === ext)
        );
        if (lang) {
          lang.load().then(langSupport => {
            if (!view) return;
            view.dispatch({
              effects: [
                languageCompartment.reconfigure(langSupport),
                previewCompartment.reconfigure([]),
              ],
            });
            view.dom.classList.add('cm-code-file-mode');
          });
        }
      },
      setEnvMode(enabled: boolean) {
        if (!view) return;
        if (enabled) {
          view.dispatch({
            effects: [
              languageCompartment.reconfigure([]),
              previewCompartment.reconfigure(envPreviewPlugin),
            ],
          });
          view.dom.classList.remove('cm-code-file-mode');
        } else {
          // Revert handled by setCodeMode(null) — no extra work needed
        }
      },
    };
  });

  onMount(() => {
    const state = EditorState.create({
      doc: '',
      extensions: [
        ...createExtensions(),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && onchange) {
            onchange(update.state.doc.toString());
          }
        }),
      ],
    });

    view = new EditorView({
      state,
      parent: editorContainer,
    });

    view.focus();

    return () => {
      view?.destroy();
    };
  });
</script>

<div class="editor-container" bind:this={editorContainer}></div>

<style>
  .editor-container {
    height: 100vh;
    width: 100%;
    overflow: auto;
  }

  .editor-container :global(.cm-editor) {
    height: 100%;
  }

  .editor-container :global(.cm-scroller) {
    padding: 2rem;
    font-size: 16px;
    line-height: 1.6;
  }

  .editor-container :global(.cm-focused) {
    outline: none;
  }
</style>
