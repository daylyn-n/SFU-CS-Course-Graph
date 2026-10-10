<!-- Search box over every course, by code or by name; picking one adds it to
     the schedule, and the (i) button opens its details. -->
<script>
  import TermPills from '../TermPills.svelte';
  import { searchCourses } from '../search.js';
  import { loadDetails, designationBadges } from '../details.js';

  let { courses, offerings, terms, term, inSchedule, onadd, ondetails, compact = false } = $props();

  let query = $state('');
  let open = $state(false);
  let active = $state(0);
  let input;
  let root;

  // Same matching as the rest of the app (code prefix, then title words in any order).
  const results = $derived(searchCourses(query, courses, 8).map((h) => ({ code: h.code, title: courses[h.code]?.title ?? '' })));

  // Designations, for badges: fetched once, the first time the box is focused.
  let details = $state(null);
  let asked = false;
  function loadOnce() {
    if (asked) return;
    asked = true;
    loadDetails().then((d) => (details = d));
  }

  const offeredIn = (code) => terms.filter((t) => offerings[code]?.[t.id]?.length);

  function pick(code) {
    if (!code) return;
    onadd(code);
    query = '';
    active = 0;
    input.focus();
  }

  function onkeydown(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      open = true;
      const n = results.length;
      if (n) active = (active + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const r = results[active];
      if (r && !inSchedule(r.code)) pick(r.code);
    } else if (e.key === 'Escape' && open && query.trim()) {
      e.preventDefault();
      e.stopPropagation();
      open = false;
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="search"
  class:compact
  class:open={open && query.trim()}
  bind:this={root}
  onfocusout={(e) => {
    if (!root.contains(e.relatedTarget)) open = false;
  }}
  onkeydown={(e) => {
    if (e.key === 'Escape' && e.target !== input && open) {
      e.stopPropagation();
      open = false;
      input.focus();
    }
  }}
>
  <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
  <input
    bind:this={input}
    bind:value={query}
    placeholder={compact ? 'Add a course by code or name' : 'Add a course, e.g. CMPT 225 or “data structures”'}
    aria-label="Add a course to this schedule, by code or name"
    role="combobox"
    aria-expanded={open && results.length > 0}
    aria-controls="sched-results"
    aria-activedescendant={open && results[active] ? `sched-opt-${active}` : undefined}
    aria-autocomplete="list"
    autocomplete="off"
    oninput={() => {
      open = true;
      active = 0;
    }}
    onfocus={() => {
      open = true;
      loadOnce();
    }}
    {onkeydown}
  />
  {#if open && query.trim()}
    <ul class="results" id="sched-results" role="listbox" aria-label="Matching courses">
      {#each results as r, i (r.code)}
        {@const when = offeredIn(r.code)}
        {@const added = inSchedule(r.code)}
        {@const badges = designationBadges(details?.[r.code]?.designation)}
        <li id="sched-opt-{i}" role="option" aria-selected={i === active} class:active={i === active}>
          <button
            class="pick"
            tabindex="-1"
            disabled={added}
            title={added ? 'Already in this schedule' : `Add ${r.code} to this schedule`}
            onmousedown={(e) => e.preventDefault()}
            onclick={() => pick(r.code)}
            onmouseenter={() => (active = i)}
          >
            <b>{r.code}</b>
            <span class="title">{r.title}</span>
            <span class="when">
              {#each badges as b (b.label)}<span class="badge" title={b.label}>{b.short}</span>{/each}
              {#if added}
                <span class="tag">Added</span>
              {:else if !when.length}
                <span class="tag">Not scheduled</span>
              {:else}
                {#if !when.some((t) => t.id === term)}<span class="tag warn">Not this term</span>{/if}
                <TermPills terms={when} />
              {/if}
            </span>
          </button>
          {#if ondetails}
            <button
              class="info"
              aria-label="Details for {r.code}"
              title="Description, breadth/WQB and prerequisites"
              onmousedown={(e) => e.preventDefault()}
              onclick={() => ondetails(r.code, input)}
              onmouseenter={() => (active = i)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.01" /></svg>
            </button>
          {/if}
        </li>
      {:else}
        <li class="empty">No course matches “{query.trim()}”.</li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .search {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 12px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .search:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent);
  }
  .icon {
    width: 17px;
    height: 17px;
    flex-shrink: 0;
    fill: none;
    stroke: var(--accent-text);
    stroke-width: 2.5;
    stroke-linecap: round;
  }
  input {
    flex: 1;
    min-width: 0;
    padding: 10px 0;
    border: none;
    outline: none;
    background: transparent;
    font-size: 14.5px;
  }
  input::placeholder {
    color: var(--muted);
  }

  .results {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    right: 0;
    z-index: 20;
    margin: 0;
    padding: 4px;
    list-style: none;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
    box-shadow: 0 12px 30px rgb(0 0 0 / 0.16);
  }
  .results li[role='option'] {
    display: flex;
    align-items: center;
    border-radius: 8px;
  }
  .results li.active {
    background: var(--bg);
  }
  .pick {
    flex: 1;
    min-width: 0;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    padding: 7px 10px;
    border: none;
    border-radius: 8px;
    background: transparent;
    text-align: left;
  }
  .pick:disabled {
    cursor: default;
  }
  .pick:disabled > * {
    opacity: 0.6;
  }
  .info {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    margin-right: 2px;
    padding: 0;
    border-color: transparent;
    background: transparent;
    color: var(--muted);
  }
  .info:hover,
  .info:focus-visible {
    border-color: var(--border);
    color: var(--accent-text);
    background: var(--surface);
  }
  .info svg {
    width: 17px;
    height: 17px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
  }
  .badge {
    padding: 0 4px;
    border-radius: 4px;
    background: var(--ready-bg);
    color: var(--ready);
    font-size: 10px;
    font-weight: 700;
    line-height: 15px;
    white-space: nowrap;
  }
  .compact input {
    padding: 6px 0;
    font-size: 13.5px;
  }
  .compact {
    border-radius: 10px;
  }
  .compact .results {
    min-width: 440px;
  }
  @media (max-width: 520px) {
    .pick {
      grid-template-columns: auto minmax(0, 1fr);
      row-gap: 2px;
    }
    .when {
      grid-column: 1 / -1;
    }
    .compact .results {
      min-width: 0;
    }
  }
  .results b {
    white-space: nowrap;
  }
  .title {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: var(--muted);
    font-size: 13px;
  }
  .when {
    display: flex;
    align-items: center;
    gap: 3px;
  }
  .tag {
    font-size: 11px;
    color: var(--muted);
    white-space: nowrap;
    margin-right: 3px;
  }
  .tag.warn {
    color: var(--warn);
    font-weight: 600;
  }
  .empty {
    padding: 10px;
    color: var(--muted);
  }
</style>
