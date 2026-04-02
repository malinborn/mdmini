<script lang="ts">
  import { onMount } from 'svelte';
  import Editor from './lib/editor/Editor.svelte';
  import type { EditorHandle } from './lib/editor/Editor.svelte';
  import { createThemeStore, createModeStore, createZoomStore, createFileState, createRecentFilesStore } from './lib/stores.svelte';
  import { readFile, writeFile, fileExists, showOpenDialog, showSaveDialog } from './lib/tauri/commands';
  import { onMenuEvent, onOpenFile, onFileChangedExternally } from './lib/tauri/events';
  import { invoke } from '@tauri-apps/api/core';
  import { ask } from '@tauri-apps/plugin-dialog';
  import RecentFilesPanel from './lib/RecentFilesPanel.svelte';
  import { previewCompartment } from './lib/editor/setup';
  import { livePreviewPlugin } from './lib/editor/preview/plugin';
  import { envPreviewPlugin } from './lib/editor/preview/env';
  import './lib/theme/dark.css';
  import './lib/theme/light.css';
  import './styles/global.css';
  import './styles/editor.css';

  const theme = createThemeStore();
  const mode = createModeStore();
  const zoom = createZoomStore();
  const fileState = createFileState();
  const recentFiles = createRecentFilesStore();

  let showRecentFiles = $state(false);
  let activePreview: 'markdown' | 'env' | 'code' = $state('markdown');

  let editorHandle: EditorHandle | undefined = $state(undefined);

  // --- Timers ---
  let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let recoveryInterval: ReturnType<typeof setInterval> | null = null;

  // Track whether we are currently writing to disk (to avoid reacting to our own save)
  let isSaving = false;

  function handleChange(doc: string) {
    fileState.isDirty = true;
    scheduleAutoSave();
  }

  // --- Auto-save (300ms debounce) ---
  function scheduleAutoSave(): void {
    if (autoSaveTimer !== null) {
      clearTimeout(autoSaveTimer);
    }
    autoSaveTimer = setTimeout(() => {
      autoSaveTimer = null;
      if (fileState.isDirty && fileState.filePath) {
        performSave();
      }
    }, 300);
  }

  async function performSave(): Promise<void> {
    if (!fileState.filePath) return;
    const content = editorHandle?.view?.state.doc.toString() ?? '';
    try {
      isSaving = true;
      await writeFile(fileState.filePath, content);
      fileState.isDirty = false;
      fileState.lastSavedAt = Date.now();
      // Clean up recovery file on successful save
      await invoke('delete_recovery', { path: fileState.filePath }).catch(() => {});
    } catch (err) {
      console.error('Auto-save failed:', err);
    } finally {
      // Keep isSaving true briefly to suppress FSEvent from our own atomic write
      setTimeout(() => { isSaving = false; }, 600);
    }
  }

  async function handleSave(): Promise<void> {
    if (!fileState.filePath) {
      await handleSaveAs();
      return;
    }
    await performSave();
  }

  async function handleSaveAs(): Promise<void> {
    const name = fileState.filePath
      ? fileState.filePath.split('/').pop()
      : 'Untitled.md';
    const path = await showSaveDialog(name);
    if (!path) return;
    fileState.filePath = path;
    await performSave();
    recentFiles.add(path);
  }

  async function handleOpen(): Promise<void> {
    const path = await showOpenDialog();
    if (!path) return;
    try {
      const content = await readFile(path);
      fileState.filePath = path;
      fileState.isDirty = false;
      editorHandle?.replaceContent(content);
      recentFiles.add(path);
    } catch (err) {
      console.error('Open failed:', err);
    }
  }

  function handleNew(): void {
    invoke('open_file_window_cmd', { path: null }).catch((err: unknown) => {
      console.error('Failed to open new window:', err);
    });
  }

  function handleFind(): void {
    const view = editorHandle?.view;
    if (!view) return;
    import('@codemirror/search').then(({ openSearchPanel }) => {
      openSearchPanel(view);
    });
  }

  const MD_EXTENSIONS = new Set(['md', 'markdown', 'txt', '']);

  async function handleOpenFilePath(path: string): Promise<void> {
    try {
      const exists = await fileExists(path);
      if (exists) {
        const content = await readFile(path);
        editorHandle?.replaceContent(content);
      } else {
        editorHandle?.replaceContent('');
      }
      fileState.filePath = path;
      fileState.isDirty = false;
      recentFiles.add(path);

      // Detect file type and switch editor mode
      const basename = path.split('/').pop()?.toLowerCase() ?? '';
      const ext = path.split('.').pop()?.toLowerCase() ?? '';
      const isEnvFile = basename.startsWith('.env') || ext === 'env';

      if (isEnvFile) {
        editorHandle?.setEnvMode(true);
        activePreview = 'env';
      } else if (!MD_EXTENSIONS.has(ext)) {
        editorHandle?.setEnvMode(false);
        editorHandle?.setCodeMode(ext);
        activePreview = 'code';
      } else {
        editorHandle?.setEnvMode(false);
        editorHandle?.setCodeMode(null);
        activePreview = 'markdown';
      }

      // Start watching file for external changes
      if (exists) {
        invoke('start_watching', { path }).catch(() => {});
      }
    } catch (err) {
      console.error('Failed to open file:', err);
    }
  }

  // --- External file change handling ---
  async function handleExternalChange(path: string): Promise<void> {
    if (isSaving) return; // Ignore changes caused by our own save
    if (path !== fileState.filePath) return;

    if (!fileState.isDirty) {
      // Silently reload
      try {
        const content = await readFile(path);
        editorHandle?.replaceContent(content);
        fileState.isDirty = false;
      } catch (err) {
        console.error('Failed to reload externally changed file:', err);
      }
    } else {
      // Ask user
      const reload = await ask(
        'The file has been modified externally. Reload and lose your changes?',
        { title: 'External Change', kind: 'warning' }
      );
      if (reload) {
        try {
          const content = await readFile(path);
          editorHandle?.replaceContent(content);
          fileState.isDirty = false;
        } catch (err) {
          console.error('Failed to reload externally changed file:', err);
        }
      }
    }
  }

  // --- Recovery save (every 5s if dirty) ---
  function startRecoveryInterval(): void {
    recoveryInterval = setInterval(() => {
      if (fileState.isDirty && fileState.filePath) {
        const content = editorHandle?.view?.state.doc.toString() ?? '';
        invoke('save_recovery', { path: fileState.filePath, content }).catch((err: unknown) => {
          console.error('Recovery save failed:', err);
        });
      }
    }, 5000);
  }

  // --- Save on blur ---
  function handleWindowBlur(): void {
    if (fileState.isDirty && fileState.filePath) {
      performSave();
    }
  }

  onMount(() => {
    // Pull any file path stored by the backend for this window (CLI args or new-window open).
    // This avoids the race condition of the push-based emit approach.
    invoke<string | null>('get_pending_file').then((pendingFile) => {
      if (pendingFile) {
        handleOpenFilePath(pendingFile);
      }
    });

    // Menu events
    const unlistenMenu = onMenuEvent((action) => {
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
        case 'select_all': {
          const view = editorHandle?.view;
          if (view) {
            view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
            view.focus();
          }
          break;
        }
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
        case 'recent_files':
          showRecentFiles = true;
          break;
      }
    });

    const unlistenOpenFile = onOpenFile((path) => {
      handleOpenFilePath(path);
    });

    const unlistenExternalChange = onFileChangedExternally((path) => {
      handleExternalChange(path);
    });

    // Drag & drop: open files dropped onto the window
    // If current window is empty (no file, no edits), open first file here; rest in new windows
    const unlistenDragDrop = import('@tauri-apps/api/webview').then(({ getCurrentWebview }) =>
      getCurrentWebview().onDragDropEvent(async (event) => {
        if (event.payload.type !== 'drop') return;
        const paths = event.payload.paths as string[];
        let usedCurrentWindow = false;
        for (const path of paths) {
          if (!usedCurrentWindow && !fileState.filePath && !fileState.isDirty) {
            usedCurrentWindow = true;
            await handleOpenFilePath(path);
          } else {
            await invoke('open_file_window_cmd', { path }).catch((err: unknown) => {
              console.error('Failed to open dropped file:', err);
            });
          }
        }
      })
    );


    // Save on window blur
    window.addEventListener('blur', handleWindowBlur);

    // Start recovery interval
    startRecoveryInterval();

    // Check for updates: first after 15s, then every hour
    let stopUpdateChecker: (() => void) | null = null;
    import('./lib/updater').then(({ startUpdateChecker }) => {
      stopUpdateChecker = startUpdateChecker();
    });

    return () => {
      if (stopUpdateChecker) stopUpdateChecker();
      unlistenMenu.then((fn) => fn());
      unlistenOpenFile.then((fn) => fn());
      unlistenExternalChange.then((fn) => fn());
      unlistenDragDrop.then((fn) => fn());
      window.removeEventListener('blur', handleWindowBlur);
      if (autoSaveTimer !== null) clearTimeout(autoSaveTimer);
      if (recoveryInterval !== null) clearInterval(recoveryInterval);
    };
  });

  $effect(() => {
    document.documentElement.setAttribute('data-theme', theme.resolved);
  });

  $effect(() => {
    const title = fileState.title;
    document.title = title;
    // Sync to native Tauri window title bar
    import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
      getCurrentWindow().setTitle(title);
    });
  });

  // Reconfigure live-preview compartment when mode toggles
  // Reconfigure preview when mode toggles (Cmd+E)
  $effect(() => {
    const m = mode.value;
    const v = editorHandle?.view;
    if (!v) return;
    if (m === 'live-preview') {
      // Restore the correct preview plugin for the current file type
      const plugin = activePreview === 'env' ? envPreviewPlugin
        : activePreview === 'code' ? []
        : livePreviewPlugin;
      v.dispatch({ effects: previewCompartment.reconfigure(plugin) });
    } else {
      v.dispatch({ effects: previewCompartment.reconfigure([]) });
    }
  });
</script>

<main style="font-size: {zoom.level}rem;">
  <Editor bind:handle={editorHandle} onchange={handleChange} />
</main>

{#if showRecentFiles}
  <RecentFilesPanel
    files={recentFiles.list}
    onopen={handleOpenFilePath}
    onclose={() => { showRecentFiles = false; }}
  />
{/if}

<style>
  main {
    height: 100vh;
    width: 100vw;
  }
</style>
