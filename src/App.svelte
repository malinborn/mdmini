<script lang="ts">
  import Editor from './lib/editor/Editor.svelte';

  let content = $state('# Hello md-mini\n\nStart writing...\n\n- Item one\n- Item two\n\n```js\nconsole.log("hello");\n```\n');

  function handleChange(doc: string) {
    content = doc;
  }
</script>

<main>
  <Editor content={content} onchange={handleChange} />
</main>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    overflow: hidden;
  }

  main {
    height: 100vh;
    width: 100vw;
  }
</style>
