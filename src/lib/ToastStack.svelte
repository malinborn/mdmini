<script lang="ts">
  import type { ToastEntry, ToastStore } from './toasts.svelte';

  let {
    store,
    /**
     * Called after a toast is dismissed locally, so the caller can propagate it.
     * The update notice uses this to dismiss itself in every window at once.
     */
    onDismiss,
  }: { store: ToastStore; onDismiss?: (entry: ToastEntry) => void } = $props();

  function dismiss(entry: ToastEntry): void {
    store.dismiss(entry.id);
    onDismiss?.(entry);
  }

  const BREW_CMD = 'brew update && brew upgrade --cask mdmini';

  let copied = $state(false);

  function copyBrewCommand(): void {
    navigator.clipboard.writeText(BREW_CMD);
    copied = true;
    setTimeout(() => { copied = false; }, 1500);
  }
</script>

{#if store.toasts.length > 0}
  <div class="md-toast-stack">
    {#each store.toasts as toast (toast.id)}
      <div class="md-toast">
        {#if toast.payload.kind === 'update'}
          <span class="md-toast-text">
            <strong>mdmini {toast.payload.latest}</strong> available
            <span class="md-toast-dim">(you have v{toast.payload.current})</span>
          </span>
          <button class="md-toast-cmd" title="Click to copy" onclick={copyBrewCommand}>
            {copied ? 'Copied!' : BREW_CMD}
          </button>
        {:else}
          <span class="md-toast-text">
            <strong>{toast.payload.count}</strong>
            {toast.payload.count === 1 ? 'window' : 'windows'} from your last session
          </span>
          <span class="md-toast-dim">Press <kbd>⇧⌘T</kbd> to reopen</span>
        {/if}
        <button
          class="md-toast-close"
          title="Dismiss"
          onclick={() => dismiss(toast)}
        >✕</button>
      </div>
    {/each}
  </div>
{/if}
