<!-- Non-blocking prompt to import a shared/backed-up taken set, plus the toast for share actions. -->
<script lang="ts">
  import type { SvelteSet } from 'svelte/reactivity';
  import { decodeShareHash } from './share';
  import { applyImport, offerImport, shareUi } from './shareActions.svelte';

  let { done, onpick }: { done: SvelteSet<string>; onpick: (code: string) => void } = $props();

  // Runs before App's effect rewrites the hash, so the shared taken set is still there.
  function checkHash() {
    const { taken, target } = decodeShareHash(location.hash);
    if (taken) offerImport(done, taken, target, 'link');
  }
  checkHash();

  function onhashchange() {
    checkHash();
    // Drop the taken part so a refresh doesn't ask again.
    const [bare] = location.hash.split('?');
    if (bare !== location.hash) history.replaceState(null, '', bare);
  }

  function apply(merge: boolean) {
    const target = shareUi.pending?.source === 'file' ? shareUi.pending.target : null;
    applyImport(done, merge);
    if (target) onpick(target);
  }

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const p = $derived(shareUi.pending);
  const detail = $derived.by(() => {
    if (!p) return '';
    if (done.size === 0) return 'Import them to see what you can take next.';
    const parts = [];
    if (p.added.length) parts.push(`${plural(p.added.length, 'course')} you haven't marked`);
    if (p.removed.length) parts.push(`${p.removed.length} of yours not in it`);
    return parts.join(' · ') + '.';
  });
</script>

<svelte:window {onhashchange} />

<div class="stack">
  {#if p}
    <div class="banner" role="region" aria-label="Import taken courses">
      <div class="text">
        <b>{p.source === 'link' ? 'This link' : 'This backup'} has {plural(p.taken.length, 'taken course')}.</b>
        <span class="detail">{detail}</span>
      </div>
      <div class="buttons">
        {#if done.size === 0}
          <button class="primary" onclick={() => apply(false)}>Import</button>
        {:else}
          {#if p.added.length}
            <button class="primary" onclick={() => apply(true)} title="Keep yours and add theirs">Merge</button>
          {/if}
          <button class:primary={!p.added.length} onclick={() => apply(false)} title="Use exactly this set">Replace</button>
        {/if}
        <button class="ghost" onclick={() => (shareUi.pending = null)}>Ignore</button>
      </div>
    </div>
  {/if}

  <div class="toast-region" role="status" aria-live="polite">
    {#if shareUi.toast}
      <div class="toast" class:error={shareUi.toast.error}>
        <span>{shareUi.toast.message}</span>
        {#if shareUi.toast.action}
          <button onclick={shareUi.toast.action.run}>{shareUi.toast.action.label}</button>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .stack {
    position: fixed;
    left: 50%;
    bottom: 16px;
    transform: translateX(-50%);
    width: min(560px, calc(100% - 32px));
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 50;
    pointer-events: none;
  }
  .stack > * {
    pointer-events: auto;
  }

  .banner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 14px;
    padding: 12px 14px;
    border-radius: 12px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-left: 4px solid var(--accent);
    box-shadow: 0 8px 28px rgb(0 0 0 / 0.18);
    animation: rise 0.2s ease-out;
  }
  .text {
    flex: 1 1 240px;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .detail {
    font-size: 13px;
    color: var(--muted);
  }
  .buttons {
    display: flex;
    gap: 6px;
  }
  .ghost {
    border-color: transparent;
    background: transparent;
    color: var(--muted);
  }

  .toast-region:empty {
    display: none;
  }
  .toast {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    width: fit-content;
    max-width: 100%;
    margin: 0 auto;
    padding: 8px 14px;
    border-radius: 999px;
    background: var(--text);
    color: var(--bg);
    font-size: 13px;
    box-shadow: 0 6px 20px rgb(0 0 0 / 0.2);
    animation: rise 0.2s ease-out;
  }
  .toast.error {
    background: var(--accent);
    color: #fff;
  }
  .toast button {
    padding: 2px 10px;
    border: 1px solid currentColor;
    border-radius: 999px;
    background: transparent;
    color: inherit;
    font-weight: 600;
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .banner,
    .toast {
      animation: none;
    }
  }
</style>
