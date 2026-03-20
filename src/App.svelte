<script lang="ts">
  import Editor from './lib/editor/Editor.svelte';
  import type { EditorHandle } from './lib/editor/Editor.svelte';
  import { createThemeStore, createModeStore, createZoomStore, createFileState } from './lib/stores';
  import { readFile, writeFile, showOpenDialog, showSaveDialog } from './lib/tauri/commands';
  import './lib/theme/dark.css';
  import './lib/theme/light.css';
  import './styles/global.css';

  const theme = createThemeStore();
  const mode = createModeStore();
  const zoom = createZoomStore();
  const fileState = createFileState();

  let editorHandle: EditorHandle | undefined = $state(undefined);

  function handleChange(doc: string) {
    fileState.isDirty = true;
  }

  async function handleSave(): Promise<void> {
    if (!fileState.filePath) {
      await handleSaveAs();
      return;
    }
    const content = editorHandle?.view?.state.doc.toString() ?? '';
    try {
      await writeFile(fileState.filePath, content);
      fileState.isDirty = false;
      fileState.lastSavedAt = Date.now();
    } catch (err) {
      console.error('Save failed:', err);
    }
  }

  async function handleSaveAs(): Promise<void> {
    const name = fileState.filePath
      ? fileState.filePath.split('/').pop()
      : 'Untitled.md';
    const path = await showSaveDialog(name);
    if (!path) return;
    fileState.filePath = path;
    await handleSave();
  }

  async function handleOpen(): Promise<void> {
    const path = await showOpenDialog();
    if (!path) return;
    try {
      const content = await readFile(path);
      fileState.filePath = path;
      fileState.isDirty = false;
      editorHandle?.replaceContent(content);
    } catch (err) {
      console.error('Open failed:', err);
    }
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (!e.metaKey) return;
    if (e.key === 's') {
      e.preventDefault();
      if (e.shiftKey) {
        handleSaveAs();
      } else {
        handleSave();
      }
    } else if (e.key === 'o') {
      e.preventDefault();
      handleOpen();
    }
  }

  $effect(() => {
    document.documentElement.setAttribute('data-theme', theme.resolved);
  });

  $effect(() => {
    document.title = fileState.title;
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<main style="font-size: {zoom.level}rem;">
  <Editor bind:handle={editorHandle} onchange={handleChange} />
</main>

<style>
  main {
    height: 100vh;
    width: 100vw;
  }
</style>
