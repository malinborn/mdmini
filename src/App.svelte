<script lang="ts">
  import { onMount } from 'svelte';
  import Editor from './lib/editor/Editor.svelte';
  import type { EditorHandle } from './lib/editor/Editor.svelte';
  import { createThemeStore, createModeStore, createZoomStore, createFileState } from './lib/stores';
  import { readFile, writeFile, showOpenDialog, showSaveDialog } from './lib/tauri/commands';
  import { onMenuEvent } from './lib/tauri/events';
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

  function handleNew(): void {
    fileState.filePath = null;
    fileState.isDirty = false;
    editorHandle?.replaceContent('');
  }

  async function handleClose(): Promise<void> {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().close();
  }

  function handleFind(): void {
    const view = editorHandle?.view;
    if (!view) return;
    import('@codemirror/search').then(({ openSearchPanel }) => {
      openSearchPanel(view);
    });
  }

  onMount(() => {
    const unlisten = onMenuEvent((action) => {
      switch (action) {
        case 'new':
          handleNew();
          break;
        case 'open':
          handleOpen();
          break;
        case 'save':
          handleSave();
          break;
        case 'save_as':
          handleSaveAs();
          break;
        case 'close':
          handleClose();
          break;
        case 'find':
          handleFind();
          break;
        case 'toggle_mode':
          mode.toggle();
          break;
        case 'zoom_in':
          zoom.zoomIn();
          break;
        case 'zoom_out':
          zoom.zoomOut();
          break;
        case 'zoom_reset':
          zoom.reset();
          break;
        case 'theme_light':
          theme.preference = 'light';
          break;
        case 'theme_dark':
          theme.preference = 'dark';
          break;
        case 'theme_system':
          theme.preference = 'system';
          break;
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  });

  $effect(() => {
    document.documentElement.setAttribute('data-theme', theme.resolved);
  });

  $effect(() => {
    document.title = fileState.title;
  });
</script>

<main style="font-size: {zoom.level}rem;">
  <Editor bind:handle={editorHandle} onchange={handleChange} />
</main>

<style>
  main {
    height: 100vh;
    width: 100vw;
  }
</style>
