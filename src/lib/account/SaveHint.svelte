<!-- One-time hint after a signed-out user's first real edit: their progress is saved here; sign in to sync. -->
<script lang="ts">
  import { onChange } from '../persist/store.svelte';
  import { authState } from './auth.svelte';

  let { onsignin }: { onsignin?: () => void } = $props();

  const KEY = 'sfu-prereqs:hint-sync-seen';

  function seen(): boolean {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch {
      return true; // can't remember dismissing it, so don't nag every visit
    }
  }
  function markSeen() {
    try {
      localStorage.setItem(KEY, '1');
    } catch {}
  }

  let show = $state(false);

  $effect(() => {
    if (seen()) return;
    const off = onChange((e) => {
      if (e.source !== 'local' || authState.user || !authState.ready) return;
      off();
      // Let the edit's own feedback (toasts, animations) land first.
      setTimeout(() => {
        if (authState.user || seen()) return;
        markSeen();
        show = true;
      }, 1200);
    });
    return off;
  });

  // Hide on sign-in, or by itself after a while.
  $effect(() => {
    if (authState.user) show = false;
  });
  $effect(() => {
    if (!show) return;
    const t = setTimeout(() => (show = false), 20_000);
    return () => clearTimeout(t);
  });
</script>

{#if show}
  <div class="save-hint" role="status">
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18a5 5 0 0 1-.5-10A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9H7z" /><path d="M9.5 13l2 2 3.5-4" /></svg>
    <p>Your progress is saved on this device. <b>Sign in</b> to keep it across devices.</p>
    <div class="buttons">
      <button
        class="go"
        onclick={() => {
          show = false;
          onsignin?.();
        }}>Sign in</button
      >
      <button class="x" aria-label="Dismiss" onclick={() => (show = false)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </div>
  </div>
{/if}

<style>
  .save-hint {
    position: fixed;
    left: 16px;
    bottom: 16px;
    z-index: 45;
    display: flex;
    align-items: center;
    gap: 10px;
    width: min(380px, calc(100% - 32px));
    padding: 10px 10px 10px 14px;
    border: 1px solid var(--border);
    border-left: 4px solid var(--accent);
    border-radius: 12px;
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 8px 28px rgb(0 0 0 / 0.18);
    animation: rise 0.25s ease-out;
  }
  .icon {
    width: 22px;
    height: 22px;
    flex-shrink: 0;
    fill: none;
    stroke: var(--accent-text);
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  p {
    flex: 1;
    margin: 0;
    font-size: 13px;
  }
  .buttons {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .go {
    border: none;
    border-radius: 999px;
    padding: 5px 12px;
    background: var(--sfu-red);
    color: #fff;
    font-weight: 700;
    font-size: 12.5px;
    white-space: nowrap;
  }
  .go:hover {
    background: var(--sfu-red-dark);
  }
  .x {
    width: 30px;
    height: 30px;
    padding: 0;
    display: grid;
    place-items: center;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--muted);
  }
  .x:hover {
    background: color-mix(in srgb, var(--text) 8%, transparent);
    color: var(--text);
  }
  .x svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.2;
    stroke-linecap: round;
  }
  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .save-hint {
      animation: none;
    }
  }
  /* Phones: sit above the toast row at the bottom centre. */
  @media (max-width: 700px) {
    .save-hint {
      bottom: 64px;
    }
  }
</style>
