<!-- "What can I take next?": courses ready now or one course away, ranked by what they open up. -->
<script lang="ts">
  import { department, explore, level, reverseIndex, sortEntries, type ExploreEntry, type SortKey } from './explore';
  import { courseStatus } from './graph';
  import TermPills from './TermPills.svelte';
  import type { Courses, Taken, Term } from './types';

  interface Props {
    courses: Courses;
    done: Taken;
    terms: Term[];
    offeredIn: (code: string) => Term[];
    selected: string;
    onselect: (code: string) => void;
    ontoggle: (code: string) => void;
    /** show this course's prerequisites on the map */
    ontarget: (code: string) => void;
  }

  let { courses, done, terms, offeredIn, selected, onselect, ontoggle, ontarget }: Props = $props();

  // Main departments first, the rest alphabetically.
  const DEPT_ORDER = ['CMPT', 'MACM', 'MATH', 'STAT'];
  const LEVELS = [100, 200, 300, 400];

  const index = $derived(reverseIndex(courses));
  const result = $derived(explore(courses, done, index));

  const thisTerm = $derived(terms.find((t) => t.current));
  const nextTerm = $derived(thisTerm ? terms[terms.indexOf(thisTerm) + 1] : undefined);

  let tab = $state<'ready' | 'almost'>('ready');
  let query = $state('');
  let dept = $state('');
  let lvl = $state(0);
  let when = $state<'' | 'this' | 'next'>('');
  let sort = $state<SortKey>('score');

  const base = $derived(tab === 'ready' ? result.ready : result.almost);

  const depts = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const e of base) counts.set(department(e.code), (counts.get(department(e.code)) ?? 0) + 1);
    const rank = (d: string) => (DEPT_ORDER.includes(d) ? DEPT_ORDER.indexOf(d) : DEPT_ORDER.length);
    return [...counts].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
  });

  function offered(code: string, term: Term | undefined): boolean {
    return !!term && offeredIn(code).some((t) => t.id === term.id);
  }

  const rows = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const term = when === 'this' ? thisTerm : when === 'next' ? nextTerm : undefined;
    const list = base.filter(
      (e) =>
        (!dept || department(e.code) === dept) &&
        (!lvl || level(e.code) === lvl) &&
        (!when || offered(e.code, term)) &&
        (!q || e.code.toLowerCase().includes(q) || courses[e.code].title.toLowerCase().includes(q)),
    );
    return sortEntries(list, sort);
  });

  function scoreTitle(e: ExploreEntry): string {
    const parts = [];
    if (e.unlocks.length) parts.push(`Makes ${e.unlocks.length} ready: ${e.unlocks.join(', ')}`);
    if (e.closer.length) parts.push(`Brings ${e.closer.length} closer: ${e.closer.join(', ')}`);
    return parts.join('\n') || 'Not a prerequisite for anything else still to take';
  }

  function clearFilters() {
    query = '';
    dept = '';
    lvl = 0;
    when = '';
  }
</script>

<div class="explore">
  <div class="toolbar">
    <div class="tabs" role="tablist" aria-label="Which courses">
      <button role="tab" aria-selected={tab === 'ready'} class:on={tab === 'ready'} onclick={() => (tab = 'ready')}>
        Ready now <span class="count">{result.ready.length}</span>
      </button>
      <button role="tab" aria-selected={tab === 'almost'} class:on={tab === 'almost'} onclick={() => (tab = 'almost')}>
        Almost there <span class="count">{result.almost.length}</span>
      </button>
    </div>

    <input class="filter" type="search" placeholder="Filter by code or title" bind:value={query} aria-label="Filter courses" />

    <div class="filters">
      <div class="chips" role="group" aria-label="Department">
        <button class="chip" class:on={!dept} onclick={() => (dept = '')}>All</button>
        {#each depts as [d, n] (d)}
          <button class="chip" class:on={dept === d} onclick={() => (dept = dept === d ? '' : d)}>
            {d} <span class="n">{n}</span>
          </button>
        {/each}
      </div>
      <div class="selects">
        <label>
          Level
          <select bind:value={lvl}>
            <option value={0}>Any</option>
            {#each LEVELS as l}<option value={l}>{l}s</option>{/each}
          </select>
        </label>
        <label>
          Offered
          <select bind:value={when}>
            <option value="">Any term</option>
            {#if thisTerm}<option value="this">This term ({thisTerm.short})</option>{/if}
            {#if nextTerm}<option value="next">Next term ({nextTerm.short})</option>{/if}
          </select>
        </label>
        <label>
          Sort
          <select bind:value={sort}>
            <option value="score">Unlock score</option>
            <option value="code">Code</option>
            <option value="level">Level</option>
          </select>
        </label>
      </div>
    </div>
  </div>

  <p class="summary">
    {#if tab === 'ready'}
      Prerequisites met, not taken yet. The score counts courses each one makes ready or brings closer.
    {:else}
      One course away: take any one of the courses listed and it's ready.
    {/if}
    <span class="shown">Showing {rows.length} of {base.length}</span>
  </p>

  {#if rows.length}
    <ul class="rows">
      {#each rows as e (e.code)}
        {@const course = courses[e.code]}
        <li class="row {tab}" class:selected={e.code === selected}>
          <button class="main" onclick={() => onselect(e.code)}>
            <span class="head">
              <b class="code">{e.code}</b>
              <span class="terms"><TermPills terms={offeredIn(e.code)} /></span>
              <span class="units">{course.units} units</span>
            </span>
            <span class="title">{course.title}</span>
            {#if e.missing.length}
              <!-- Missing courses you could take right now are shown in blue. -->
              <span class="needs">
                {e.missing.length > 1 ? 'Needs one of' : 'Needs'}
                {#each e.missing as m, i}<b class:ready={courseStatus(m, courses, done) === 'ready' && m in courses}
                    >{m}</b
                  >{i < e.missing.length - 1 ? ', ' : ''}{/each}
              </span>
            {:else if e.unlocks.length}
              <span class="needs">
                Opens {e.unlocks.slice(0, 4).join(', ')}{e.unlocks.length > 4 ? ` +${e.unlocks.length - 4} more` : ''}
              </span>
            {/if}
          </button>
          <div class="side">
            <span class="score" class:zero={!e.score} title={scoreTitle(e)}>
              <b>{e.score}</b> unlock{e.score === 1 ? '' : 's'}
            </span>
            <div class="buttons">
              <button class="small" onclick={() => ontoggle(e.code)}>Mark taken</button>
              <button class="small" onclick={() => ontarget(e.code)}>View prerequisites</button>
            </div>
          </div>
        </li>
      {/each}
    </ul>
  {:else}
    <div class="empty">
      {#if base.length}
        <p>No courses match these filters.</p>
        <button onclick={clearFilters}>Clear filters</button>
      {:else if tab === 'ready'}
        <p>Nothing is ready yet. Check "Almost there" for the closest courses.</p>
      {:else}
        <p>Nothing is exactly one course away right now.</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .explore {
    max-width: 960px;
    margin: 0 auto;
  }

  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 12px;
    padding: 12px;
    border-radius: 12px;
    background: var(--surface);
    border: 1px solid var(--border);
  }

  .tabs {
    display: flex;
    padding: 3px;
    border-radius: 999px;
    background: var(--bg);
    border: 1px solid var(--border);
  }
  .tabs button {
    border: none;
    border-radius: 999px;
    padding: 4px 14px;
    background: transparent;
    font-weight: 600;
    color: var(--muted);
  }
  .tabs button.on {
    background: var(--sfu-red);
    color: #fff;
  }
  .count {
    font-size: 11px;
    font-weight: 700;
    opacity: 0.8;
    margin-left: 2px;
  }

  .filter {
    flex: 1 1 200px;
    min-width: 0;
    padding: 6px 14px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--bg);
    outline: none;
  }
  .filter:focus {
    border-color: var(--accent);
  }

  .filters {
    flex-basis: 100%;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 16px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    padding: 3px 10px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
  }
  .chip .n {
    font-weight: 500;
    color: var(--muted);
  }
  .chip.on {
    border-color: var(--accent);
    background: var(--accent);
    color: #fff;
  }
  .chip.on .n {
    color: inherit;
    opacity: 0.8;
  }
  .selects {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 12px;
    font-size: 12px;
    color: var(--muted);
  }
  .selects label {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .selects select {
    padding: 3px 8px;
    border-radius: 999px;
    font-size: 13px;
    color: var(--text);
  }

  .summary {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 2px 12px;
    margin: 12px 4px 8px;
    font-size: 12.5px;
    color: var(--muted);
  }
  .shown {
    font-weight: 600;
  }

  .rows {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-left: 4px solid var(--locked-border);
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .row.ready {
    border-left-color: var(--ready);
  }
  .row:hover {
    box-shadow: 0 2px 8px rgb(0 0 0 / 0.06);
  }
  .row.selected {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }

  .main {
    all: unset;
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
    cursor: pointer;
  }
  .main:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 4px;
    border-radius: 4px;
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
  }
  .code {
    font-size: 15px;
  }
  .row.ready .code {
    color: var(--ready);
  }
  .main:hover .code {
    text-decoration: underline;
  }
  .terms {
    display: inline-flex;
    gap: 3px;
  }
  .terms:empty {
    display: none;
  }
  .units {
    font-size: 12px;
    color: var(--muted);
  }
  .title {
    font-size: 13.5px;
  }
  .needs {
    font-size: 12px;
    color: var(--muted);
  }
  .needs b {
    color: var(--text);
  }
  .needs b.ready {
    color: var(--ready);
  }

  .side {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }
  .score {
    min-width: 76px;
    text-align: center;
    padding: 2px 10px;
    border-radius: 999px;
    background: var(--ready-bg);
    color: var(--ready);
    font-size: 12px;
    white-space: nowrap;
    cursor: help;
  }
  .score b {
    font-size: 14px;
  }
  .score.zero {
    background: var(--bg);
    color: var(--muted);
  }
  .buttons {
    display: flex;
    gap: 6px;
  }
  .small {
    padding: 4px 10px;
    font-size: 12.5px;
    white-space: nowrap;
  }
  .small:hover {
    border-color: var(--accent);
    color: var(--accent-text);
  }

  .empty {
    padding: 32px 16px;
    text-align: center;
    color: var(--muted);
  }
  .empty p {
    margin: 0 0 10px;
  }

  @media (max-width: 700px) {
    .toolbar {
      padding: 10px;
    }
    .tabs {
      flex-basis: 100%;
    }
    .tabs button {
      flex: 1;
    }
    .filter {
      flex-basis: 100%;
    }
    .row {
      flex-direction: column;
      align-items: stretch;
      gap: 8px;
    }
    .side {
      justify-content: space-between;
    }
  }
</style>
