<!-- The account control for the red hero header: "Sign in", or an avatar with a sync dot and a menu. -->
<script lang="ts">
  import { tick } from 'svelte';
  import { authState } from './auth.svelte';
  import { initialOf, statusText, type SyncStatus } from './helpers';

  interface Props {
    status?: SyncStatus;
    lastSyncedAt?: number | null;
    onsignin?: () => void;
    onhistory?: () => void;
    onbackup?: () => void;
    onsignout?: () => void;
    ondeletedata?: () => void;
    onretry?: () => void;
    onreload?: () => void;
  }

  let {
    status = 'idle',
    lastSyncedAt = null,
    onsignin,
    onhistory,
    onbackup,
    onsignout,
    ondeletedata,
    onretry,
    onreload,
  }: Props = $props();

  const uid = $props.id();

  let open = $state(false);
  let confirming = $state(false);
  let root = $state<HTMLElement>();
  let button = $state<HTMLButtonElement>();
  let menu = $state<HTMLElement>();
  let now = $state(Date.now());
  /** px to shift the menu right so it stays on screen when the avatar wraps left (phones) */
  let shift = $state(0);

  const user = $derived(authState.user);
  const line = $derived(statusText(status, lastSyncedAt, now));
  const dotLabel: Record<SyncStatus, string> = {
    idle: '',
    syncing: 'syncing',
    synced: 'synced',
    offline: 'offline',
    error: 'sync failed',
    outdated: 'update available',
  };
  const label = $derived(
    user ? `Account: ${user.email}${dotLabel[status] ? `, ${dotLabel[status]}` : ''}` : 'Sign in',
  );

  // Keep "Synced · 2 min ago" current while the menu is open.
  $effect(() => {
    if (!open) return;
    now = Date.now();
    const t = setInterval(() => (now = Date.now()), 15_000);
    return () => clearInterval(t);
  });

  const items = () => [...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];

  async function show(focus: 'first' | 'last' | 'none' = 'first') {
    open = true;
    confirming = false;
    shift = 0;
    await tick();
    const r = menu?.getBoundingClientRect();
    if (r && r.left < 8) shift = Math.min(8 - r.left, Math.max(0, innerWidth - 8 - r.right));
    const list = items();
    if (focus === 'first') list[0]?.focus();
    else if (focus === 'last') list.at(-1)?.focus();
    else menu?.focus();
  }

  function hide(returnFocus = true) {
    if (!open) return;
    open = false;
    confirming = false;
    if (returnFocus) button?.focus();
  }

  function onbuttonkeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (open) hide();
      else show('first');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      show('last');
    }
  }

  function onmenukeydown(e: KeyboardEvent) {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    const go = (j: number) => list[(j + list.length) % list.length]?.focus();
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        go(i + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        go(i < 0 ? -1 : i - 1);
        break;
      case 'Home':
        e.preventDefault();
        go(0);
        break;
      case 'End':
        e.preventDefault();
        go(-1);
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        if (confirming) {
          confirming = false;
          tick().then(() => items().find((el) => el.dataset.item === 'delete')?.focus());
        } else hide();
        break;
      case 'Tab':
        hide(false);
        break;
    }
  }

  function onwindowpointerdown(e: PointerEvent) {
    if (open && root && !root.contains(e.target as Node)) hide(false);
  }

  function run(fn: (() => void) | undefined) {
    hide();
    fn?.();
  }

  async function askDelete() {
    confirming = true;
    await tick();
    items()[0]?.focus();
  }
</script>

<svelte:window onpointerdown={onwindowpointerdown} />

{#if user}
  <div class="account" bind:this={root}>
    <button
      bind:this={button}
      class="avatar"
      id="{uid}-button"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls="{uid}-menu"
      aria-label={label}
      title={label}
      onclick={() => (open ? hide() : show('none'))}
      onkeydown={onbuttonkeydown}
    >
      <span class="letter" aria-hidden="true">{initialOf(user.email)}</span>
      {#if status !== 'idle'}<span class="dot s-{status}" aria-hidden="true"></span>{/if}
    </button>

    {#if open}
      <div
        bind:this={menu}
        class="menu"
        style:right="{-shift}px"
        id="{uid}-menu"
        role="menu"
        tabindex="-1"
        aria-labelledby="{uid}-button"
        onkeydown={onmenukeydown}
      >
        {#if confirming}
          <div class="confirm" role="none">
            <p class="confirm-title">Delete your saved data from the cloud?</p>
            <p class="confirm-text">
              Your courses, schedules and cloud history are removed from your account. This device keeps its copy, and you
              stay signed in.
            </p>
            <div class="confirm-buttons" role="none">
              <button role="menuitem" class="danger" onclick={() => run(ondeletedata)}>Delete from cloud</button>
              <button
                role="menuitem"
                class="plain"
                onclick={async () => {
                  confirming = false;
                  await tick();
                  items().find((el) => el.dataset.item === 'delete')?.focus();
                }}>Cancel</button
              >
            </div>
          </div>
        {:else}
          <div class="who" role="none">
            <span class="big-letter" aria-hidden="true">{initialOf(user.email)}</span>
            <div class="who-text">
              <span class="caption">Signed in as</span>
              <span class="email">{user.email}</span>
            </div>
          </div>

          <div class="sync-line s-{status}" role="none">
            <span class="sdot s-{status}" aria-hidden="true"></span>
            <span class="status-text" role="status">{line}</span>
            {#if status === 'error' && onretry}
              <button role="menuitem" class="inline" onclick={() => run(onretry)}>Retry</button>
            {:else if status === 'outdated' && onreload}
              <button role="menuitem" class="inline" onclick={() => run(onreload)}>Reload</button>
            {/if}
          </div>

          <div class="sep" role="separator"></div>
          <button role="menuitem" class="item" onclick={() => run(onhistory)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></svg>
            Version history
          </button>
          <button role="menuitem" class="item" onclick={() => run(onbackup)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>
            Download backup
          </button>
          <button role="menuitem" class="item" onclick={() => run(onsignout)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11" /></svg>
            Sign out
          </button>
          <div class="sep" role="separator"></div>
          <button role="menuitem" class="item danger-text" data-item="delete" onclick={askDelete}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg>
            Delete my saved data from the cloud
          </button>
        {/if}
      </div>
    {/if}
  </div>
{:else if authState.ready}
  <button class="signin" onclick={() => onsignin?.()}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" /></svg>
    Sign in
  </button>
{:else}
  <span class="placeholder" aria-hidden="true"></span>
{/if}

<style>
  .account {
    position: relative;
  }

  /* On the red header: white controls, like Header.svelte's pills. */
  .signin {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 1px solid rgb(255 255 255 / 0.55);
    border-radius: 999px;
    padding: 5px 14px 5px 10px;
    background: rgb(255 255 255 / 0.12);
    color: #fff;
    font-weight: 700;
    font-size: 13px;
    white-space: nowrap;
    transition: background 0.15s, transform 0.15s;
  }
  .signin:hover {
    border-color: #fff;
    background: rgb(255 255 255 / 0.24);
    transform: translateY(-1px);
  }
  .signin svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.2;
    stroke-linecap: round;
  }

  .avatar,
  .placeholder {
    position: relative;
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    padding: 0;
    border-radius: 50%;
  }
  .avatar {
    border: 2px solid rgb(255 255 255 / 0.7);
    background: #fff;
    color: var(--sfu-red);
    box-shadow: 0 2px 8px rgb(60 0 10 / 0.3);
    transition: transform 0.15s, box-shadow 0.15s, border-color 0.15s;
  }
  .avatar:hover,
  .avatar[aria-expanded='true'] {
    border-color: #fff;
    transform: translateY(-1px);
    box-shadow: 0 0 0 3px rgb(255 255 255 / 0.3), 0 4px 12px rgb(60 0 10 / 0.35);
  }
  .placeholder {
    background: rgb(255 255 255 / 0.18);
  }
  .letter {
    font-weight: 800;
    font-size: 15px;
    line-height: 1;
  }
  .signin:focus-visible,
  .avatar:focus-visible {
    outline: 2px solid #fff;
    outline-offset: 3px;
  }

  /* The sync dot sits on the avatar's corner, ringed in white so it reads
     against both the white avatar and the red header. */
  .dot {
    position: absolute;
    right: -4px;
    bottom: -4px;
    width: 13px;
    height: 13px;
    border-radius: 50%;
    border: 2.5px solid #fff;
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.35);
  }
  .dot.s-synced,
  .sdot.s-synced {
    background: #1fa755;
  }
  .dot.s-syncing,
  .sdot.s-syncing {
    background: #f0a20b;
    animation: pulse 1.1s ease-in-out infinite;
  }
  .dot.s-offline,
  .sdot.s-offline {
    background: #8a8487;
  }
  .dot.s-error,
  .sdot.s-error {
    background: #d4142e;
  }
  .dot.s-outdated,
  .sdot.s-outdated {
    background: #2563c9;
  }
  .sdot.s-idle {
    background: var(--border);
  }
  @keyframes pulse {
    50% {
      opacity: 0.45;
      transform: scale(0.85);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .dot.s-syncing,
    .sdot.s-syncing {
      animation: none;
    }
  }

  /* The menu is on the page background, not the header. */
  .menu {
    position: absolute;
    top: calc(100% + 10px);
    right: 0;
    width: 300px;
    max-width: calc(100vw - 24px);
    padding: 6px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 16px 40px rgb(0 0 0 / 0.25);
    z-index: 30;
    animation: drop 0.14s ease-out;
    transform-origin: top right;
  }
  .menu:focus {
    outline: none;
  }
  @keyframes drop {
    from {
      opacity: 0;
      transform: translateY(-4px) scale(0.98);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .menu {
      animation: none;
    }
  }

  .who {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px 10px;
  }
  .big-letter {
    width: 36px;
    height: 36px;
    flex-shrink: 0;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: var(--sfu-red);
    color: #fff;
    font-weight: 800;
    font-size: 16px;
  }
  .who-text {
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .caption {
    font-size: 11.5px;
    color: var(--muted);
  }
  .email {
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sync-line {
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 4px 4px;
    padding: 7px 10px;
    border-radius: 9px;
    background: var(--bg);
    font-size: 12.5px;
    color: var(--muted);
  }
  .sync-line.s-error {
    background: color-mix(in srgb, #d4142e 12%, var(--surface));
    color: var(--text);
  }
  .sync-line.s-outdated {
    background: var(--ready-bg);
    color: var(--text);
  }
  .sdot {
    width: 8px;
    height: 8px;
    flex-shrink: 0;
    border-radius: 50%;
  }
  .status-text {
    flex: 1;
    min-width: 0;
  }
  .inline {
    padding: 2px 10px;
    border: 1px solid currentColor;
    border-radius: 999px;
    background: transparent;
    font-size: 12px;
    font-weight: 700;
  }
  .sync-line.s-error .inline {
    color: var(--accent-text);
  }
  .sync-line.s-outdated .inline {
    color: var(--ready);
  }

  .sep {
    height: 1px;
    margin: 4px 6px;
    background: var(--border);
  }

  .item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 10px;
    border: none;
    border-radius: 8px;
    background: transparent;
    text-align: left;
    font-size: 13.5px;
  }
  .item svg {
    width: 17px;
    height: 17px;
    flex-shrink: 0;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    opacity: 0.75;
  }
  .item:hover,
  .item:focus-visible,
  .inline:focus-visible,
  .confirm button:focus-visible {
    background: color-mix(in srgb, var(--text) 8%, transparent);
    outline: none;
  }
  .inline:focus-visible,
  .confirm button:focus-visible {
    box-shadow: 0 0 0 2px var(--accent);
  }
  .danger-text {
    color: var(--accent-text);
  }

  .confirm {
    padding: 10px 10px 8px;
  }
  .confirm-title {
    margin: 0 0 4px;
    font-weight: 700;
  }
  .confirm-text {
    margin: 0 0 12px;
    font-size: 12.5px;
    color: var(--muted);
  }
  .confirm-buttons {
    display: flex;
    gap: 8px;
  }
  .confirm-buttons button {
    flex: 1;
    border-radius: 999px;
    font-weight: 700;
    font-size: 13px;
  }
  .danger {
    border: none;
    background: var(--sfu-red);
    color: #fff;
  }
  .confirm .danger:hover,
  .confirm .danger:focus-visible {
    background: var(--sfu-red-dark);
  }
</style>
