<!-- Text box with a dropdown of courses matching by code or name.
     Arrow keys move through results, Enter picks, Esc closes. -->
<script lang="ts">
  import { matchCourse, searchCourses, type SearchHit } from './search';
  import type { Courses } from './types';

  interface Props {
    courses: Courses;
    onpick: (code: string) => void;
    placeholder?: string;
    label?: string;
    value?: string;
    input?: HTMLInputElement;
    onnomatch?: ((query: string, suggestions: SearchHit[]) => void) | null;
    oninput?: (() => void) | null;
    limit?: number;
    /** codes to offer while the box is focused and empty */
    suggestions?: string[];
  }

  let {
    courses,
    onpick, // (code) => void
    placeholder = 'Search courses',
    label = 'Search courses',
    value = $bindable(''),
    input = $bindable(),
    onnomatch = null, // (query, suggestions) => void, when Enter finds nothing
    oninput = null,
    limit = 8,
    suggestions = [],
  }: Props = $props();

  const id = `ci-${Math.random().toString(36).slice(2, 8)}`;
  let open = $state(false);
  let active = $state(-1);
  const empty = $derived(!value.trim());
  const results = $derived(
    !open ? [] : empty ? suggestions.map((code) => ({ code })) : searchCourses(value, courses, limit),
  );

  function pick(code: string) {
    onpick(code);
    value = '';
    open = false;
    active = -1;
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      open = true;
      const n = results.length;
      if (n) active = (active + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const code = active >= 0 && results[active] ? results[active].code : matchCourse(value, courses);
      if (code) pick(code);
      else if (value.trim()) onnomatch?.(value, searchCourses(value, courses, 3));
    } else if (e.key === 'Escape') {
      open = false;
      active = -1;
    }
  }
</script>

<div class="ci">
  <input
    bind:this={input}
    bind:value
    {placeholder}
    aria-label={label}
    role="combobox"
    aria-expanded={open && results.length > 0}
    aria-controls="{id}-list"
    aria-autocomplete="list"
    aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
    autocomplete="off"
    spellcheck="false"
    oninput={() => {
      open = true;
      active = -1;
      oninput?.();
    }}
    onfocus={() => (open = true)}
    onblur={() => setTimeout(() => (open = false), 120)}
    {onkeydown}
  />
  {#if open && results.length}
    <ul class="results" id="{id}-list" role="listbox" aria-label={empty ? 'Suggestions' : undefined}>
      {#if empty}<li class="heading" role="presentation">Try</li>{/if}
      {#each results as r, i (r.code)}
        <li
          id="{id}-{i}"
          role="option"
          aria-selected={i === active}
          class:active={i === active}
          onmousedown={(e) => {
            e.preventDefault(); // keep focus so blur doesn't close first
            pick(r.code);
          }}
          onmouseenter={() => (active = i)}
        >
          <b>{r.code}</b>
          <span>{courses[r.code].title}</span>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .ci {
    position: relative;
    flex: 1;
    min-width: 0;
    display: flex;
  }
  input {
    flex: 1;
    min-width: 0;
  }
  .results {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    right: 0;
    z-index: 50;
    margin: 0;
    padding: 4px;
    list-style: none;
    max-height: min(360px, 60vh);
    overflow-y: auto;
    border-radius: 10px;
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    box-shadow: 0 10px 28px rgb(0 0 0 / 0.18);
    text-align: left;
  }
  li {
    display: flex;
    gap: 10px;
    align-items: baseline;
    padding: 7px 10px;
    border-radius: 7px;
    cursor: pointer;
    font-size: 14px;
  }
  li b {
    white-space: nowrap;
    min-width: 76px;
  }
  li span {
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  li.heading {
    padding: 4px 10px 2px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
    cursor: default;
  }
  li.active {
    background: var(--bg);
  }
  li.active b {
    color: var(--accent-text);
  }
</style>
