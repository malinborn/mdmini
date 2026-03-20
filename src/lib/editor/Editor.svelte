<script lang="ts">
  import { onMount } from 'svelte';
  import { EditorView } from '@codemirror/view';
  import { EditorState } from '@codemirror/state';
  import { createExtensions } from './setup';

  let { content = '', onchange }: {
    content?: string;
    onchange?: (doc: string) => void;
  } = $props();

  let editorContainer: HTMLDivElement;
  let view: EditorView | undefined = $state(undefined);

  onMount(() => {
    const state = EditorState.create({
      doc: content,
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
