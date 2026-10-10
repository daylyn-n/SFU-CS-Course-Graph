<!-- Shown when saving on this device fails (storage full or blocked), with a
     way to keep the data anyway. -->
<script lang="ts">
  import { persistStatus } from './store.svelte';
  import { exportProgress } from '../shareActions.svelte';

  let { target }: { target: string } = $props();
</script>

{#if persistStatus.error}
  <div class="save-error" role="alert">
    <span><b>Couldn't save on this device.</b> {persistStatus.error}</span>
    <button onclick={() => exportProgress(target)}>Download backup</button>
  </div>
{/if}

<style>
  .save-error {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 14px;
    padding: 8px 14px;
    border-bottom: 1px solid var(--border);
    border-left: 4px solid var(--accent);
    background: var(--surface);
    font-size: 13px;
  }
  span {
    flex: 1 1 260px;
    min-width: 0;
  }
  button {
    font-size: 13px;
  }
</style>
