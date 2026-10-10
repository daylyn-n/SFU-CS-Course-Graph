<!-- Asked after signing in on a device whose (never-owned) progress differs from the account's. -->
<script lang="ts">
  import { tick } from 'svelte';

  interface Props {
    open: boolean;
    /** true: merge this device's progress into the account; false: use the account's only */
    onanswer: (copy: boolean) => void;
  }

  let { open = $bindable(false), onanswer }: Props = $props();

  const uid = $props.id();
  let dialog = $state<HTMLDialogElement>();
  let primary = $state<HTMLButtonElement>();
  let answered = false;

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      answered = false;
      dialog.showModal();
      tick().then(() => primary?.focus());
    } else if (!open && dialog.open) {
      dialog.close();
    }
  });

  function answer(copy: boolean) {
    if (answered) return;
    answered = true;
    open = false;
    onanswer(copy);
  }
</script>

<!-- Esc or closing counts as "no": the safe choice, since nothing is lost either way. -->
<dialog
  bind:this={dialog}
  class="dialog"
  aria-labelledby="{uid}-title"
  aria-describedby="{uid}-desc"
  onclose={() => answer(false)}
>
  <div class="panel">
    <div class="icon" aria-hidden="true">
      <svg viewBox="0 0 24 24"><rect x="3" y="4" width="11" height="8" rx="1.5" /><rect x="10" y="12" width="11" height="8" rx="1.5" /><path d="M8 15H5.5A1.5 1.5 0 0 1 4 13.5V12M16 9h2.5A1.5 1.5 0 0 1 20 10.5V12" /></svg>
    </div>
    <h2 id="{uid}-title">Copy this device’s progress into your account?</h2>
    <div id="{uid}-desc" class="body">
      <p>
        Your account already has saved progress. Copying merges this device’s courses, schedules and plan into it; where
        both changed the same thing, the more recent change is kept.
      </p>
      <p class="safe">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z" /><path d="M8.5 12l2.5 2.5 4.5-5" /></svg>
        <span>Either way, a snapshot of this device’s progress is kept in Version history.</span>
      </p>
    </div>
    <div class="buttons">
      <button class="plain" onclick={() => answer(false)}>Use my account’s only</button>
      <button class="primary" bind:this={primary} onclick={() => answer(true)}>Copy and merge</button>
    </div>
  </div>
</dialog>

<style>
  .dialog {
    width: min(440px, calc(100% - 32px));
    padding: 0;
    border: none;
    border-radius: 16px;
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 24px 60px rgb(0 0 0 / 0.3);
  }
  .dialog[open] {
    animation: pop 0.18s ease-out;
  }
  .dialog::backdrop {
    background: rgb(20 8 10 / 0.5);
    backdrop-filter: blur(2px);
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: translateY(8px) scale(0.98);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .dialog[open] {
      animation: none;
    }
  }
  .panel {
    padding: 24px;
  }
  .icon {
    width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    margin-bottom: 14px;
    border-radius: 12px;
    background: linear-gradient(135deg, var(--sfu-red-dark), var(--sfu-red) 60%, #c42a40);
  }
  .icon svg {
    width: 24px;
    height: 24px;
    fill: none;
    stroke: #fff;
    stroke-width: 1.8;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  h2 {
    margin: 0 0 8px;
    font-size: 19px;
    font-weight: 800;
    letter-spacing: -0.01em;
    line-height: 1.25;
  }
  .body p {
    margin: 0 0 10px;
    color: var(--muted);
  }
  .safe {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    padding: 9px 11px;
    border-radius: 10px;
    background: var(--done-bg);
    color: var(--text) !important;
    font-size: 13px;
  }
  .safe svg {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
    fill: none;
    stroke: var(--done);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 18px;
  }
  .buttons button {
    border-radius: 999px;
    padding: 9px 16px;
    font-weight: 700;
  }
  .primary {
    border: none;
    background: var(--sfu-red);
    color: #fff;
  }
  .primary:hover {
    background: var(--sfu-red-dark);
  }
  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  @media (max-width: 420px) {
    .buttons button {
      flex: 1 1 100%;
    }
    .buttons .primary {
      order: -1;
    }
  }
</style>
