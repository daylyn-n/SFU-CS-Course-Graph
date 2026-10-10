<!-- ProgramPicker in its own modal, e.g. a first-visit prompt for signed-out users. -->
<script lang="ts">
  import ProgramPicker from './ProgramPicker.svelte';
  import type { ProgramOption } from './search';

  interface Props {
    open: boolean;
    programs: ProgramOption[];
    value: string;
    onpick: (id: string) => void;
    /** Called when skipped, including Esc and the close button. */
    onskip?: () => void;
    title?: string;
    description?: string;
  }

  let { open = $bindable(false), programs, value = $bindable(''), onpick, onskip, title, description }: Props = $props();

  let dialog = $state<HTMLDialogElement>();
  let picked = false;

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      picked = false;
      dialog.showModal();
    } else if (!open && dialog.open) dialog.close();
  });

  function onclose() {
    open = false;
    if (!picked) onskip?.();
  }
</script>

<dialog bind:this={dialog} class="dialog" aria-label={title ?? 'Which program are you in?'} {onclose}>
  {#if open}
    <div class="panel">
      <button type="button" class="close" aria-label="Close" onclick={() => dialog?.close()}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
      <ProgramPicker
        {programs}
        bind:value
        {title}
        {description}
        onpick={(id) => {
          picked = true;
          onpick(id);
          dialog?.close();
        }}
        onskip={() => dialog?.close()}
      />
    </div>
  {/if}
</dialog>

<style>
  .dialog {
    width: min(480px, calc(100% - 32px));
    max-height: calc(100% - 32px);
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
    position: relative;
    padding: 24px 24px 18px;
  }
  .panel :global(h2) {
    padding-right: 32px;
  }
  .close {
    position: absolute;
    top: 10px;
    right: 10px;
    width: 34px;
    height: 34px;
    padding: 0;
    display: grid;
    place-items: center;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--muted);
  }
  .close:hover {
    background: color-mix(in srgb, var(--text) 8%, transparent);
    color: var(--text);
  }
  .close:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .close svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.2;
    stroke-linecap: round;
  }
  @media (max-width: 420px) {
    .panel {
      padding: 22px 18px 16px;
    }
  }
</style>
