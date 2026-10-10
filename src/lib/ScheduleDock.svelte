<!-- The schedule builder docked under the prerequisite map: a slim bar that
     opens into a resizable drawer, so you can build a timetable while looking
     at prerequisites. On phones the drawer is a full-height sheet. -->
<script lang="ts">
  import ScheduleBuilder from './schedule/ScheduleBuilder.svelte';
  import { activeSlot } from './schedule/store.svelte';
  import type { Courses, Offerings, Taken, Term } from './types';

  interface Props {
    courses: Courses;
    terms: Term[];
    offerings: Offerings;
    done: Taken;
    open?: boolean;
    /** switch to the full schedule tab */
    onexpand: () => void;
    /** show a course's prerequisites */
    onopen: (code: string) => void;
  }

  let { courses, terms, offerings, done, open = $bindable(false), onexpand, onopen }: Props = $props();

  const KEY = 'sfu-prereqs:dock-height';
  const MIN = 220;
  let height = $state(readHeight());
  let dragging = $state(false);

  function readHeight() {
    try {
      const h = Number(localStorage.getItem(KEY));
      return h >= MIN ? h : 380;
    } catch {
      return 380;
    }
  }
  // Leave the map at least ~180px when the window is short.
  const maxHeight = () => Math.max(MIN, innerHeight - 260);
  const shown = $derived(Math.min(height, typeof innerHeight === 'number' ? maxHeight() : height));

  function startDrag(e: PointerEvent) {
    e.preventDefault();
    dragging = true;
    const move = (ev: PointerEvent) => {
      height = Math.round(Math.min(maxHeight(), Math.max(MIN, innerHeight - ev.clientY)));
    };
    const up = () => {
      dragging = false;
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      try {
        localStorage.setItem(KEY, String(height));
      } catch {}
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  }

  function onkeydown(e: KeyboardEvent) {
    // Keyboard resizing for the handle.
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      height = Math.min(maxHeight(), Math.max(MIN, height + (e.key === 'ArrowUp' ? 40 : -40)));
    }
  }

  const slot = $derived(activeSlot());
  const termLabel = $derived(terms.find((t) => t.id === slot?.term)?.label);
  const count = $derived(slot?.courses.length ?? 0);
</script>

<svelte:window onkeydown={(e) => open && e.key === 'Escape' && innerWidth <= 700 && (open = false)} />

{#if open}
  <!-- Phones only (hidden on desktop): tap outside the sheet to close it. -->
  <button class="backdrop" aria-label="Close schedule" tabindex="-1" onclick={() => (open = false)}></button>
{/if}
<section class="dock" class:open class:dragging style:--h="{shown}px" aria-label="Schedule">
  {#if open}
    <!-- A focusable separator is the ARIA "window splitter" pattern. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div
      class="handle"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize schedule"
      aria-valuenow={shown}
      tabindex="0"
      onpointerdown={startDrag}
      {onkeydown}
    ></div>
  {/if}
  <div class="bar">
    <button class="toggle" onclick={() => (open = !open)} aria-expanded={open}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
      <b>{slot?.name ?? 'Schedule'}</b>
      <span class="meta">{termLabel ? `${termLabel} · ` : ''}{count} course{count === 1 ? '' : 's'}</span>
      <span class="chev" aria-hidden="true">{open ? '▾' : '▴'}</span>
    </button>
    <button class="expand" onclick={onexpand} title="Open the full schedule tab">Full view ↗</button>
  </div>
  {#if open}
    <div class="body">
      <ScheduleBuilder {courses} {terms} {offerings} {done} {onopen} docked />
    </div>
  {/if}
</section>

<style>
  .dock {
    position: relative;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border-top: 2px solid var(--sfu-red);
    box-shadow: 0 -6px 18px rgb(0 0 0 / 0.08);
    z-index: 6;
  }
  .dock.open {
    height: var(--h);
  }
  .dock.dragging {
    user-select: none;
  }
  .handle {
    position: absolute;
    top: -6px;
    left: 0;
    right: 0;
    height: 12px;
    cursor: ns-resize;
    z-index: 2;
  }
  .handle::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 3px;
    width: 44px;
    height: 5px;
    margin-left: -22px;
    border-radius: 999px;
    background: var(--border);
  }
  .handle:hover::after,
  .handle:focus-visible::after,
  .dragging .handle::after {
    background: var(--accent);
  }
  .handle:focus-visible {
    outline: none;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px 0 6px;
    min-height: 42px;
  }
  .toggle {
    all: unset;
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 8px;
    cursor: pointer;
  }
  .toggle:hover {
    background: var(--bg);
  }
  .toggle:focus-visible {
    outline: 2px solid var(--accent);
  }
  .toggle svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: var(--sfu-red);
    stroke-width: 2;
    flex-shrink: 0;
  }
  .meta {
    color: var(--muted);
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .chev {
    margin-left: auto;
    color: var(--muted);
  }
  .expand {
    font-size: 12.5px;
    padding: 4px 10px;
    white-space: nowrap;
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    border-top: 1px solid var(--border);
  }

  .backdrop {
    display: none;
  }
  @media (max-width: 700px) {
    .backdrop {
      all: unset;
      display: block;
      position: fixed;
      inset: 0;
      background: rgb(0 0 0 / 0.4);
      z-index: 59;
    }
    /* A bar pinned to the bottom of the screen; opening it covers the page. */
    .dock {
      position: sticky;
      bottom: 0;
    }
    .dock.open {
      position: fixed;
      inset: 8vh 0 0 0;
      height: auto;
      border-radius: 14px 14px 0 0;
      box-shadow: 0 -10px 40px rgb(0 0 0 / 0.35);
      z-index: 60;
    }
    .handle {
      display: none;
    }
  }
</style>
