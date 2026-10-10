<!-- "Which program are you in?": a searchable list grouped by faculty. Used in the Degree tab, inline and in ProgramPrompt. -->
<script lang="ts">
  import { tick } from 'svelte';
  import { groupPrograms, type ProgramOption } from './search';

  interface Props {
    programs: ProgramOption[];
    /** the chosen program id (the app stores it; this component doesn't) */
    value: string;
    onpick: (id: string) => void;
    /** shows a "Skip for now" button */
    onskip?: () => void;
    title?: string;
    description?: string;
    /** focus the search box when shown */
    autofocus?: boolean;
  }

  let {
    programs,
    value = $bindable(''),
    onpick,
    onskip,
    title = 'Which program are you in?',
    description = 'We use it to track your degree requirements. You can change it any time in the Degree tab.',
    autofocus = true,
  }: Props = $props();

  const uid = $props.id();

  let query = $state('');
  let input = $state<HTMLInputElement>();
  let list = $state<HTMLElement>();

  const groups = $derived(groupPrograms(programs, query));
  const flat = $derived(groups.flatMap((g) => g.programs));
  const count = $derived(flat.length);

  // The keyboard-highlighted option (aria-activedescendant).
  let active = $state(-1);
  const optId = (id: string) => `${uid}-opt-${id.replace(/[^\w-]/g, '_')}`;
  const indexOf = $derived(new Map(flat.map((p, i) => [p.id, i])));

  // New results: highlight the best match while searching, else the current program.
  $effect(() => {
    void flat;
    active = query.trim() ? (flat.length ? 0 : -1) : flat.findIndex((p) => p.id === value);
    tick().then(() => reveal('center'));
  });

  $effect(() => {
    if (autofocus) tick().then(() => input?.focus({ preventScroll: true }));
  });

  function reveal(block: ScrollLogicalPosition = 'nearest') {
    const p = flat[active];
    if (!p || !list) return;
    const el = list.querySelector<HTMLElement>(`#${CSS.escape(optId(p.id))}`);
    if (!el) return;
    // Scroll only the list, never the page or dialog.
    const top = el.offsetTop - list.offsetTop;
    const want =
      block === 'center'
        ? top - list.clientHeight / 2 + el.offsetHeight / 2
        : top < list.scrollTop + 28
          ? top - 28 // keep the sticky faculty heading clear
          : top + el.offsetHeight > list.scrollTop + list.clientHeight
            ? top + el.offsetHeight - list.clientHeight
            : list.scrollTop;
    list.scrollTop = Math.max(0, want);
  }

  function move(to: number) {
    if (!flat.length) return;
    active = Math.max(0, Math.min(flat.length - 1, to));
    reveal();
  }

  function pick(id: string) {
    value = id;
    onpick(id);
  }

  function onkeydown(e: KeyboardEvent) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        move(active + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        move(active - 1);
        break;
      case 'PageDown':
        e.preventDefault();
        move(active + 8);
        break;
      case 'PageUp':
        e.preventDefault();
        move(active - 8);
        break;
      case 'Enter':
        e.preventDefault();
        if (flat[active]) pick(flat[active].id);
        break;
      case 'Escape':
        // First Esc clears the search; the next one reaches the dialog.
        if (query) {
          e.preventDefault();
          e.stopPropagation();
          query = '';
        }
        break;
    }
  }
</script>

<div class="picker">
  <h2 id="{uid}-title">{title}</h2>
  {#if description}<p class="pp-desc">{description}</p>{/if}

  <div class="search">
    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
    <input
      bind:this={input}
      bind:value={query}
      type="search"
      role="combobox"
      aria-expanded="true"
      aria-controls="{uid}-list"
      aria-autocomplete="list"
      aria-activedescendant={flat[active] ? optId(flat[active].id) : undefined}
      aria-labelledby="{uid}-title"
      placeholder="Search {programs.length} programs"
      autocomplete="off"
      spellcheck="false"
      {onkeydown}
    />
  </div>
  <p class="count" role="status" aria-live="polite">
    {#if query.trim()}{count === 0 ? 'No programs match' : `${count} program${count === 1 ? '' : 's'}`}{/if}
  </p>

  <div class="list" id="{uid}-list" role="listbox" aria-labelledby="{uid}-title" bind:this={list} tabindex="-1">
    {#each groups as g (g.faculty)}
      {@const gid = `${uid}-g-${g.faculty.replace(/[^\w]/g, '_')}`}
      <div role="group" aria-labelledby={gid}>
        <div class="faculty" id={gid} role="presentation">{g.faculty}</div>
        {#each g.programs as p (p.id)}
          {@const i = indexOf.get(p.id) ?? -1}
          <div
            id={optId(p.id)}
            class="option"
            class:active={i === active}
            class:selected={p.id === value}
            role="option"
            aria-selected={p.id === value}
            tabindex="-1"
            onpointerdown={(e) => e.preventDefault() /* keep focus in the search box */}
            onpointermove={() => (active = i)}
            onclick={() => pick(p.id)}
            onkeydown={(e) => e.key === 'Enter' && pick(p.id)}
          >
            <span class="name">{p.name}</span>
            {#if p.id === value}
              <svg class="tick" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
            {/if}
          </div>
        {/each}
      </div>
    {:else}
      <div class="empty">
        No program matches “{query.trim()}”. Try fewer words{onskip ? ', or skip this for now' : ''}.
      </div>
    {/each}
  </div>

  {#if onskip}
    <div class="foot">
      <button type="button" class="skip" onclick={() => onskip?.()}>Skip for now</button>
    </div>
  {/if}
</div>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  h2 {
    margin: 0;
    font-size: 20px;
    font-weight: 800;
    letter-spacing: -0.01em;
  }
  .pp-desc {
    margin: 6px 0 14px;
    color: var(--muted);
    font-size: 14px;
  }

  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg);
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .search:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent);
  }
  .search svg {
    width: 17px;
    height: 17px;
    flex-shrink: 0;
    fill: none;
    stroke: var(--muted);
    stroke-width: 2.2;
    stroke-linecap: round;
  }
  .search input::-webkit-search-cancel-button {
    -webkit-appearance: none;
    appearance: none;
  }
  .search input {
    flex: 1;
    min-width: 0;
    padding: 10px 0;
    border: none;
    outline: none;
    background: transparent;
    font-size: 16px; /* no zoom on iOS */
  }
  .count {
    margin: 4px 2px 0;
    min-height: 1.3em;
    font-size: 12px;
    color: var(--muted);
  }

  .list {
    position: relative;
    max-height: min(340px, 48vh);
    overflow-y: auto;
    overscroll-behavior: contain;
    margin-top: 2px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
  }
  .list:focus {
    outline: none;
  }
  .faculty {
    position: sticky;
    top: 0;
    z-index: 1;
    padding: 5px 12px;
    background: color-mix(in srgb, var(--bg) 92%, var(--text));
    border-bottom: 1px solid var(--border);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .option {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    cursor: pointer;
    font-size: 14px;
    border-left: 3px solid transparent;
  }
  .option.active {
    background: color-mix(in srgb, var(--accent) 10%, var(--surface));
    border-left-color: var(--accent);
  }
  .option.selected {
    font-weight: 700;
    color: var(--accent-text);
  }
  .name {
    flex: 1;
    min-width: 0;
  }
  .tick {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
    fill: none;
    stroke: var(--accent-text);
    stroke-width: 2.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .empty {
    padding: 18px 14px;
    color: var(--muted);
    text-align: center;
    font-size: 13.5px;
  }

  .foot {
    display: flex;
    justify-content: flex-end;
    margin-top: 12px;
  }
  .skip {
    border: none;
    background: none;
    padding: 6px 4px;
    color: var(--muted);
    font-weight: 600;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .skip:hover {
    color: var(--text);
  }
  .skip:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
</style>
