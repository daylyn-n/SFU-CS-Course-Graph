<!--
  Cmd/Ctrl+K palette: fuzzy-find any course by code or title, plus a few app
  commands. Enter maps the course; Shift+Enter ticks it as taken.
  Anything can open it with window.dispatchEvent(new Event('open-command-palette')).
-->
<script lang="ts" module>
  export const OPEN_EVENT = 'open-command-palette';
</script>

<script lang="ts">
  import { tick } from 'svelte';
  import type { SvelteSet } from 'svelte/reactivity';
  import type { Courses, View } from './types';
  import { fuzzyScore, rankCourses } from './fuzzy';
  import { clearTaken, copyShareLink, exportPng, exportProgress, importProgress } from './shareActions.svelte';

  const VIEWS: { id: View; label: string }[] = [
    { id: 'graph', label: 'Chart' },
    { id: 'list', label: 'List' },
    { id: 'explore', label: 'Explore' },
    { id: 'plan', label: 'Plan' },
    { id: 'timetable', label: 'Timetable' },
    { id: 'degree', label: 'Degree' },
  ];

  let {
    courses,
    target,
    done,
    onpick,
    view = $bindable(),
  }: {
    courses: Courses;
    target: string;
    done: SvelteSet<string>;
    onpick: (code: string) => void;
    view: View;
  } = $props();

  interface Command {
    id: string;
    label: string;
    keywords: string;
    run: () => void;
  }

  type Item =
    | { kind: 'course'; code: string; title: string; codeHits: number[]; titleHits: number[] }
    | { kind: 'command'; cmd: Command; hits: number[] };

  let dialog: HTMLDialogElement;
  let input: HTMLInputElement;
  let list: HTMLElement;
  let query = $state('');
  let active = $state(0);
  let returnFocus: HTMLElement | null = null;

  const commands: Command[] = $derived([
    ...VIEWS.filter((v) => v.id !== view).map((v) => ({
      id: `view-${v.id}`,
      label: `Switch to ${v.label} view`,
      keywords: `view ${v.id} toggle`,
      run: () => (view = v.id),
    })),
    { id: 'share', label: 'Copy share link', keywords: 'share url link clipboard', run: () => copyShareLink(target, done) },
    { id: 'export', label: 'Export progress (JSON)', keywords: 'backup download save file', run: () => exportProgress(target, done) },
    { id: 'import', label: 'Import progress from file…', keywords: 'restore backup upload load json', run: () => importProgress(done) },
    { id: 'png', label: 'Save chart as PNG', keywords: 'image picture export download screenshot', run: () => exportPng(target, () => (view = 'graph')) },
    { id: 'clear', label: 'Clear all taken courses', keywords: 'reset remove untick unmark', run: () => clearTaken(done) },
  ]);

  const items: Item[] = $derived.by(() => {
    const q = query.trim();
    if (!q) return commands.map((cmd) => ({ kind: 'command' as const, cmd, hits: [] }));

    const cmdMatches = commands
      .map((cmd) => {
        const m = fuzzyScore(q, cmd.label);
        const k = m ? null : fuzzyScore(q, cmd.keywords);
        return { cmd, score: m?.score ?? (k ? k.score / 2 : -1), hits: m?.hits ?? [] };
      })
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score);
    const courseMatches = rankCourses(q, courses, 30);

    const cmdItems = cmdMatches.map(({ cmd, hits }) => ({ kind: 'command' as const, cmd, hits }));
    const courseItems = courseMatches.map((c) => ({ kind: 'course' as const, ...c }));
    // Whichever group has the best match goes first.
    return (cmdMatches[0]?.score ?? -1) > (courseMatches[0]?.score ?? -1)
      ? [...cmdItems, ...courseItems]
      : [...courseItems, ...cmdItems];
  });

  // Keep the highlight on the first result as the query changes.
  $effect(() => {
    query;
    active = 0;
  });

  export function open() {
    if (dialog.open) return;
    returnFocus = document.activeElement as HTMLElement | null;
    query = '';
    dialog.showModal();
    input.focus();
  }

  function close() {
    if (dialog.open) dialog.close();
  }

  function onclose() {
    returnFocus?.focus?.();
    returnFocus = null;
  }

  function run(item: Item | undefined, secondary = false) {
    if (!item) return;
    if (item.kind === 'command') {
      close();
      item.cmd.run();
    } else if (secondary) {
      toggle(item.code);
    } else {
      close();
      onpick(item.code);
    }
  }

  function toggle(code: string) {
    if (done.has(code)) done.delete(code);
    else done.add(code);
  }

  async function move(delta: number) {
    if (!items.length) return;
    active = (active + delta + items.length) % items.length;
    await tick();
    list.querySelector(`#cp-opt-${active}`)?.scrollIntoView({ block: 'nearest' });
  }

  function onInputKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      run(items[active], e.shiftKey);
    } else if (e.key === 'Tab') {
      // The input is the only focus stop; options are reached with the arrows.
      e.preventDefault();
    }
  }

  function onWindowKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (dialog.open) close();
      else open();
    }
  }

  /** Splits text into runs so matched letters can be bolded. */
  function segments(text: string, hits: number[]) {
    const set = new Set(hits);
    const out: { text: string; hit: boolean }[] = [];
    for (let i = 0; i < text.length; i++) {
      const hit = set.has(i);
      const last = out[out.length - 1];
      if (last && last.hit === hit) last.text += text[i];
      else out.push({ text: text[i], hit });
    }
    return out;
  }

  $effect(() => {
    addEventListener(OPEN_EVENT, open);
    return () => removeEventListener(OPEN_EVENT, open);
  });

  const firstCommand = $derived(items.findIndex((i) => i.kind === 'command'));
  const firstCourse = $derived(items.findIndex((i) => i.kind === 'course'));
</script>

<svelte:window onkeydown={onWindowKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog
  bind:this={dialog}
  class="palette"
  aria-label="Command palette"
  {onclose}
  onclick={(e) => e.target === dialog && close()}
>
  <div class="field">
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
    <input
      bind:this={input}
      bind:value={query}
      onkeydown={onInputKeydown}
      placeholder="Search courses or type a command…"
      role="combobox"
      aria-expanded="true"
      aria-controls="cp-list"
      aria-autocomplete="list"
      aria-activedescendant={items.length ? `cp-opt-${active}` : undefined}
      autocomplete="off"
      spellcheck="false"
    />
    <kbd>esc</kbd>
  </div>

  <div class="results" id="cp-list" role="listbox" aria-label="Results" bind:this={list}>
    {#each items as item, i (item.kind === 'course' ? item.code : item.cmd.id)}
      {#if i === firstCourse}
        <div class="group" role="presentation">Courses</div>
      {:else if i === firstCommand}
        <div class="group" role="presentation">Commands</div>
      {/if}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        id="cp-opt-{i}"
        class="option"
        class:active={i === active}
        role="option"
        aria-selected={i === active}
        tabindex="-1"
        onmousemove={() => (active = i)}
        onmousedown={(e) => e.preventDefault()}
        onclick={() => run(item)}
      >
        {#if item.kind === 'course'}
          <span class="code">
            {#each segments(item.code, item.codeHits) as s}{#if s.hit}<mark>{s.text}</mark>{:else}{s.text}{/if}{/each}
          </span>
          <span class="title">
            {#each segments(item.title, item.titleHits) as s}{#if s.hit}<mark>{s.text}</mark>{:else}{s.text}{/if}{/each}
          </span>
          {#if item.code === target}<span class="tag">Mapped</span>{/if}
          <button
            class="taken"
            class:on={done.has(item.code)}
            tabindex="-1"
            aria-label="{done.has(item.code) ? 'Unmark' : 'Mark'} {item.code} as taken"
            title="Toggle taken (Shift+Enter)"
            onclick={(e) => {
              e.stopPropagation();
              toggle(item.code);
            }}
          >
            {done.has(item.code) ? '✓ Taken' : 'Mark taken'}
          </button>
        {:else}
          <span class="cmd-icon" aria-hidden="true">›</span>
          <span class="title">
            {#each segments(item.cmd.label, item.hits) as s}{#if s.hit}<mark>{s.text}</mark>{:else}{s.text}{/if}{/each}
          </span>
        {/if}
      </div>
    {:else}
      <p class="empty">No courses or commands match “{query}”.</p>
    {/each}
  </div>

  <div class="footer" aria-hidden="true">
    <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
    <span><kbd>↵</kbd> show prerequisites</span>
    <span><kbd>⇧</kbd><kbd>↵</kbd> toggle taken</span>
  </div>
</dialog>

<style>
  .palette {
    width: min(620px, calc(100% - 32px));
    max-height: min(560px, 76vh);
    margin: 12vh auto auto;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 24px 60px rgb(0 0 0 / 0.3);
    overflow: hidden;
  }
  .palette[open] {
    display: flex;
    flex-direction: column;
    animation: pop 0.14s ease-out;
  }
  .palette::backdrop {
    background: rgb(20 8 10 / 0.45);
    backdrop-filter: blur(2px);
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: translateY(-6px) scale(0.99);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .palette[open] {
      animation: none;
    }
  }

  .field {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border);
  }
  .icon {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
    fill: none;
    stroke: var(--accent-text);
    stroke-width: 2.5;
    stroke-linecap: round;
  }
  input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    font-size: 16px;
  }
  input::placeholder {
    color: var(--muted);
  }

  .results {
    flex: 1;
    overflow-y: auto;
    padding: 6px;
    overscroll-behavior: contain;
  }
  .group {
    padding: 8px 10px 4px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
  }
  .option {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 40px;
    padding: 6px 10px;
    border-radius: 8px;
    cursor: pointer;
  }
  .option.active {
    background: var(--bg);
    box-shadow: inset 3px 0 0 var(--accent);
  }
  .code {
    flex-shrink: 0;
    min-width: 76px;
    font-weight: 700;
    color: var(--accent-text);
  }
  .title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  mark {
    background: none;
    color: inherit;
    font-weight: 700;
    text-decoration: underline;
    text-decoration-color: var(--accent);
    text-underline-offset: 2px;
  }
  .tag {
    flex-shrink: 0;
    font-size: 11px;
    color: var(--muted);
  }
  .taken {
    flex-shrink: 0;
    padding: 2px 9px;
    border-radius: 999px;
    font-size: 12px;
    color: var(--muted);
    visibility: hidden;
  }
  .option.active .taken,
  .option:hover .taken,
  .taken.on {
    visibility: visible;
  }
  .taken.on {
    border-color: var(--done);
    background: var(--done-bg);
    color: var(--done);
  }
  .cmd-icon {
    width: 76px;
    flex-shrink: 0;
    color: var(--muted);
    font-weight: 700;
    text-align: center;
  }
  .empty {
    margin: 0;
    padding: 18px 10px;
    color: var(--muted);
    text-align: center;
  }

  .footer {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
    padding: 8px 14px;
    border-top: 1px solid var(--border);
    font-size: 12px;
    color: var(--muted);
  }
  kbd {
    font: 600 11px ui-monospace, monospace;
    color: var(--muted);
    border: 1px solid var(--border);
    border-bottom-width: 2px;
    border-radius: 5px;
    padding: 0 5px;
    margin-right: 3px;
  }

  @media (max-width: 700px) {
    .palette {
      margin-top: 8vh;
    }
    .footer {
      display: none;
    }
    .code,
    .cmd-icon {
      min-width: 64px;
      width: auto;
    }
    .taken {
      visibility: visible;
    }
  }
</style>
