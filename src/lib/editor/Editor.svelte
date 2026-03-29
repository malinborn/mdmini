<script lang="ts">
  import { onMount } from 'svelte';
  import { EditorView } from '@codemirror/view';
  import { EditorState } from '@codemirror/state';
  import { createExtensions } from './setup';

  export interface EditorHandle {
    view: EditorView | undefined;
    replaceContent: (newContent: string) => void;
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
          // Place cursor at end so first heading renders in preview mode
          selection: newContent.length > 0 ? { anchor: newContent.length } : undefined,
        });
        // Blur editor so decorations render without cursorInRange interference
        if (newContent.length > 0) {
          view.contentDOM.blur();
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
