<!-- Side-panel buttons for sharing a plan and backing up progress. -->
<script lang="ts">
  import type { Taken } from './types';
  import { OPEN_EVENT } from './CommandPalette.svelte';
  import { copyShareLink, exportPng, exportProgress, importProgress } from './shareActions.svelte';

  let {
    target,
    done,
    onshowchart,
    onhistory,
    onpick,
  }: {
    target: string;
    done: Taken;
    onshowchart: () => void;
    /** open the version history panel; the entry is hidden without it */
    onhistory?: () => void;
    /** map a course (the one saved in an imported backup) */
    onpick?: (code: string) => void;
  } = $props();

  const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
</script>

<h3>Share & backup</h3>
<div class="share">
  <button class="primary" onclick={() => copyShareLink(target, done)}>
    <svg viewBox="0 0 24 24" aria-hidden="true"
      ><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></svg
    >
    Copy share link
  </button>
  <button onclick={() => exportPng(target, onshowchart)}>Save chart as PNG</button>
  <button onclick={() => exportProgress(target)} title="Taken courses, schedules and settings, as a JSON file">Download backup</button>
  <button onclick={() => importProgress(done, onpick)}>Import…</button>
  {#if onhistory}
    <button onclick={onhistory}>Version history…</button>
  {/if}
</div>
<p class="hint">
  The link includes your taken courses. Press
  <button class="kbd" onclick={() => dispatchEvent(new Event(OPEN_EVENT))}>{mod}K</button> for all commands.
</p>

<style>
  .share {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .share button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
  }
  svg {
    width: 15px;
    height: 15px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.2;
    stroke-linecap: round;
  }
  .hint {
    margin: 8px 0 0;
    font-size: 12px;
    color: var(--muted);
  }
  .kbd {
    font: 600 11px ui-monospace, monospace;
    border: 1px solid var(--border);
    border-bottom-width: 2px;
    border-radius: 5px;
    padding: 0 5px;
    background: var(--surface);
    color: var(--text);
  }
</style>
