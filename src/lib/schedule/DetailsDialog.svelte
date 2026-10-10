<!-- Course details in a modal: a slide-over from the right on wide screens,
     a bottom sheet on phones. Native <dialog>, so focus moves in, the page
     behind is inert, and Esc closes it. A backdrop click closes it too, and
     focus goes back to where it was (or to `returnTo`). -->
<script>
  import CourseDetails from '../CourseDetails.svelte';

  // code: the course to show, or null when closed.
  let { code, courses, done, terms, offerings, onopen, onclose, returnTo = null } = $props();

  let dialog;
  let opener = null;
  let downOnBackdrop = false;
  const headingId = 'course-details-heading';

  $effect(() => {
    if (code && !dialog.open) {
      opener = document.activeElement;
      dialog.showModal();
      dialog.querySelector('.close')?.focus();
    } else if (!code && dialog.open) {
      dialog.close();
    }
  });

  function restoreFocus() {
    const el = opener?.isConnected && opener !== document.body ? opener : returnTo;
    opener = null;
    el?.focus({ preventScroll: true });
  }
</script>

<dialog
  bind:this={dialog}
  class="details"
  aria-labelledby={headingId}
  onclose={() => {
    restoreFocus();
    onclose();
  }}
  onkeydown={(e) => {
    // Esc closes just this dialog, not whatever hosts the builder (e.g. a drawer).
    if (e.key === 'Escape') e.stopPropagation();
  }}
  onpointerdown={(e) => (downOnBackdrop = e.target === dialog)}
  onclick={(e) => {
    // Only a press that started and ended on the backdrop, not a text
    // selection dragged out of the panel.
    if (e.target === dialog && downOnBackdrop) dialog.close();
  }}
>
  {#if code}
    <div class="panel">
      <button class="close" aria-label="Close details" onclick={() => dialog.close()}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
      {#key code}
        <CourseDetails
          {code}
          {courses}
          {done}
          {terms}
          {offerings}
          {headingId}
          showAdd
          onopen={onopen &&
            ((c) => {
              dialog.close();
              onopen(c);
            })}
        />
      {/key}
    </div>
  {/if}
</dialog>

<style>
  dialog.details {
    position: fixed;
    inset: 0 0 0 auto;
    width: min(460px, 100vw);
    max-width: 100vw;
    height: 100dvh;
    max-height: 100dvh;
    margin: 0;
    padding: 0;
    border: none;
    border-left: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    box-shadow: -12px 0 40px rgb(0 0 0 / 0.18);
    overscroll-behavior: contain;
  }
  dialog.details[open] {
    animation: slide-in 0.2s ease-out;
  }
  dialog.details::backdrop {
    background: rgb(0 0 0 / 0.35);
  }
  .panel {
    position: relative;
    height: 100%;
    overflow-y: auto;
    padding: 20px 22px 28px;
  }
  .close {
    position: absolute;
    top: 12px;
    right: 12px;
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    padding: 0;
    border-color: transparent;
    background: transparent;
    color: var(--muted);
    z-index: 1;
  }
  .close:hover {
    border-color: var(--border);
    color: var(--text);
  }
  .close:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .close svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.5;
    stroke-linecap: round;
  }
  /* Keep the heading clear of the close button. */
  .panel :global(h2) {
    padding-right: 36px;
  }
  @keyframes slide-in {
    from {
      transform: translateX(40px);
      opacity: 0;
    }
  }

  @media (max-width: 600px) {
    dialog.details {
      inset: auto 0 0 0;
      width: 100vw;
      height: auto;
      max-height: 88dvh;
      border-left: none;
      border-radius: 16px 16px 0 0;
      box-shadow: 0 -12px 40px rgb(0 0 0 / 0.2);
    }
    .panel {
      height: auto;
      max-height: 88dvh;
      padding: 18px 16px 24px;
    }
    dialog.details[open] {
      animation-name: slide-up;
    }
    @keyframes slide-up {
      from {
        transform: translateY(40px);
        opacity: 0;
      }
    }
  }
</style>
