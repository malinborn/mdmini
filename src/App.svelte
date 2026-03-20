<script lang="ts">
  import Editor from './lib/editor/Editor.svelte';
  import { createThemeStore, createModeStore, createZoomStore, createFileState } from './lib/stores';
  import './lib/theme/dark.css';
  import './lib/theme/light.css';
  import './styles/global.css';

  const theme = createThemeStore();
  const mode = createModeStore();
  const zoom = createZoomStore();
  const fileState = createFileState();

  let content = $state('# Hello md-mini\n\nStart writing...\n\n- Item one\n- Item two\n\n```js\nconsole.log("hello");\n```\n');

  function handleChange(doc: string) {
    content = doc;
    fileState.isDirty = true;
  }

  $effect(() => {
    document.documentElement.setAttribute('data-theme', theme.resolved);
  });

  $effect(() => {
    document.title = fileState.title;
  });
</script>

<main style="font-size: {zoom.level}rem;">
  <Editor {content} onchange={handleChange} />
</main>

<style>
  main {
    height: 100vh;
    width: 100vw;
  }
</style>
