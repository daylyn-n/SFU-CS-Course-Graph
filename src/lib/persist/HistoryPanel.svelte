<!-- Version history: earlier snapshots of the saved data, each restorable
     (after a confirm step). Restoring snapshots the current state first. -->
<script lang="ts">
  import { tick } from 'svelte';
  import { historyMode, listHistory, restore, type HistoryEntry } from './history';
  import { flash } from '../shareActions.svelte';

  let {
    open = $bindable(false),
    owner,
    syncing = false,
  }: {
    open: boolean;
    /** whose history to show (AppDoc.owner) */
    owner: string | null;
    /** signed in and syncing: restoring changes other devices too */
    syncing?: boolean;
  } = $props();

  let dialog: HTMLDialogElement;
  let entries = $state<HistoryEntry[] | null>(null);
  let memoryOnly = $state(false);
  let confirming = $state<string | null>(null);
  let busy = $state(false);
  let returnFocus: HTMLElement | null = null;
  let now = $state(Date.now());

  async function load() {
    entries = null;
    const list = await listHistory(owner);
    entries = list;
    memoryOnly = historyMode() === 'memory';
    now = Date.now();
  }

  $effect(() => {
    if (open && !dialog.open) {
      returnFocus = document.activeElement as HTMLElement | null;
      confirming = null;
      dialog.showModal();
      load();
    } else if (!open && dialog.open) dialog.close();
  });
  // Reload if the owner changes while open (signing in or out).
  $effect(() => {
    owner;
    if (dialog?.open) load();
  });

  function onclose() {
    open = false;
    confirming = null;
    returnFocus?.focus?.();
    returnFocus = null;
  }

  async function ask(id: string) {
    confirming = id;
    await tick();
    dialog.querySelector<HTMLButtonElement>(`[data-confirm="${id}"]`)?.focus();
  }

  async function cancel(id: string) {
    confirming = null;
    await tick();
    dialog.querySelector<HTMLButtonElement>(`[data-restore="${id}"]`)?.focus();
  }

  async function doRestore(e: HistoryEntry) {
    busy = true;
    const ok = await restore(e.id);
    busy = false;
    if (ok) {
      open = false;
      flash(`Restored the version from ${when(e.at)}`);
    } else {
      flash("Couldn't restore that version.", { error: true });
      confirming = null;
    }
  }

  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  function relative(at: number): string {
    const s = Math.round((at - now) / 1000);
    const abs = Math.abs(s);
    if (abs < 45) return 'just now';
    if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour');
    return rtf.format(Math.round(s / 86400), 'day');
  }
  const when = (at: number) =>
    new Date(at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog
  bind:this={dialog}
  class="history"
  aria-labelledby="history-title"
  {onclose}
  onclick={(e) => e.target === dialog && dialog.close()}
>
  <header>
    <h2 id="history-title">Version history</h2>
    <button class="x" aria-label="Close" onclick={() => dialog.close()}>×</button>
  </header>
  <p class="intro">
    Saved automatically as you work and before big changes. Restoring a version saves the current one here first, so
    you can always come back.
  </p>
  {#if memoryOnly}
    <p class="note" role="note">
      This browser isn't letting the app keep history, so these versions only last until you close this tab.
    </p>
  {/if}

  <div class="list">
    {#if entries === null}
      <p class="empty">Loading…</p>
    {:else if !entries.length}
      <p class="empty">No earlier versions yet. They appear here as you make changes.</p>
    {:else}
      <ul>
        {#each entries as e (e.id)}
          <li class:confirming={confirming === e.id}>
            <div class="info">
              <b>{e.label}</b>
              <span class="meta"><time datetime={new Date(e.at).toISOString()} title={when(e.at)}>{relative(e.at)}</time> · {e.summary}</span>
            </div>
            {#if confirming === e.id}
              <div class="confirm" role="group" aria-label="Confirm restore">
                <span class="warn">
                  Replace what you have now with this version?{#if syncing}
                    This will update your other devices too.{/if}
                </span>
                <div class="buttons">
                  <button class="primary" data-confirm={e.id} disabled={busy} onclick={() => doRestore(e)}>Restore</button>
                  <button disabled={busy} onclick={() => cancel(e.id)}>Cancel</button>
                </div>
              </div>
            {:else}
              <button data-restore={e.id} onclick={() => ask(e.id)} aria-label="Restore {e.label}, {relative(e.at)}">Restore</button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</dialog>

<style>
  .history {
    width: min(560px, calc(100% - 32px));
    max-height: min(640px, 84vh);
    margin: 10vh auto auto;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 24px 60px rgb(0 0 0 / 0.3);
  }
  .history[open] {
    display: flex;
    flex-direction: column;
  }
  .history::backdrop {
    background: rgb(20 8 10 / 0.45);
    backdrop-filter: blur(2px);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px 4px;
  }
  h2 {
    margin: 0;
    font-size: 18px;
  }
  .x {
    width: 32px;
    height: 32px;
    padding: 0;
    border-color: transparent;
    background: transparent;
    font-size: 22px;
    line-height: 1;
    color: var(--muted);
  }
  .intro,
  .note {
    margin: 0 16px 8px;
    font-size: 13px;
    color: var(--muted);
  }
  .note {
    padding: 8px 10px;
    border-radius: 8px;
    border-left: 3px solid var(--accent);
    background: var(--bg);
    color: var(--text);
  }
  .list {
    flex: 1;
    overflow-y: auto;
    padding: 0 8px 10px;
    overscroll-behavior: contain;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 12px;
    padding: 10px 8px;
    border-top: 1px solid var(--border);
  }
  li:first-child {
    border-top: none;
  }
  li.confirming {
    border-radius: 10px;
    background: var(--bg);
  }
  .info {
    flex: 1 1 220px;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .meta {
    font-size: 12.5px;
    color: var(--muted);
  }
  .confirm {
    flex: 1 1 100%;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
  }
  .warn {
    flex: 1 1 220px;
    font-size: 13px;
  }
  .buttons {
    display: flex;
    gap: 6px;
  }
  li button {
    font-size: 13px;
  }
  .empty {
    margin: 0;
    padding: 18px 8px;
    color: var(--muted);
    text-align: center;
  }
</style>
