<script lang="ts">
  import type { Courses, Term, View } from './types';

  interface Props {
    courses: Courses;
    target: string;
    progress: { done: number; ready: number; locked: number };
    terms: Term[];
    onpick: (code: string) => void;
    view: View;
    maxDepth: number;
    hideTaken: boolean;
  }

  let {
    courses,
    target,
    progress, // { done, ready, locked } counts for the courses on the map
    terms,
    onpick,
    view = $bindable(),
    maxDepth = $bindable(),
    hideTaken = $bindable(),
  }: Props = $props();

  // svelte-ignore state_referenced_locally
  const codes = Object.keys(courses);
  const PICKS = ['CMPT 225', 'CMPT 300', 'CMPT 310', 'CMPT 354', 'CMPT 410'].filter((c) => c in courses);

  let search = $state('');
  let input: HTMLInputElement;

  function submitSearch() {
    const m = search.trim().toUpperCase().match(/^([A-Z]{2,5})\s*(\d{3}[A-Z]?)/);
    const code = m && `${m[1]} ${m[2]}`;
    if (code && code in courses) {
      onpick(code);
      search = '';
      input.blur();
    }
  }

  // "/" jumps to the search box, like on GitHub or YouTube.
  function onkeydown(e: KeyboardEvent) {
    const el = document.activeElement;
    const typing =
      el?.tagName === 'TEXTAREA' ||
      el?.tagName === 'SELECT' ||
      (el?.tagName === 'INPUT' && !['checkbox', 'radio', 'button'].includes((el as HTMLInputElement).type));
    if (e.key === '/' && !typing) {
      e.preventDefault();
      input.focus();
    }
  }

  const total = $derived(progress.done + progress.ready + progress.locked);
  const pct = (n: number) => (total ? (n / total) * 100 : 0);
</script>

<svelte:window {onkeydown} />

<header class="hero">
  <svg class="pattern" aria-hidden="true">
    <defs>
      <pattern id="net" width="140" height="90" patternUnits="userSpaceOnUse">
        <path d="M10 20 C45 20 45 60 80 60 S115 25 150 25 M80 60 L80 100 M-10 70 C20 70 30 20 10 20" />
        <circle cx="10" cy="20" r="3.5" />
        <circle cx="80" cy="60" r="4.5" />
        <circle cx="140" cy="25" r="3" />
      </pattern>
    </defs>
    <rect width="200%" height="100%" fill="url(#net)" />
  </svg>

  <div class="row top">
    <div class="brand">
      <svg class="mark" viewBox="0 0 32 32" aria-hidden="true">
        <path d="M9 10 C15 10 15 16 22 16 M9 22 C15 22 15 16 22 16" />
        <circle cx="8" cy="10" r="3" /><circle cx="8" cy="22" r="3" /><circle cx="23" cy="16" r="3.5" />
      </svg>
      <div>
        <h1>SFU Prerequisite Map</h1>
        <p class="tagline">Plan your path to any course · {Object.keys(courses).length} courses · {terms.map((t) => t.label).join(' & ')}</p>
      </div>
    </div>

    <form
      class="search"
      onsubmit={(e) => {
        e.preventDefault();
        submitSearch();
      }}
    >
      <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
      <input
        bind:this={input}
        list="course-list"
        placeholder="Where do you want to go? e.g. CMPT 410"
        bind:value={search}
        oninput={() => codes.includes(search.split(' — ')[0]) && submitSearch()}
        aria-label="Course to look up"
      />
      <kbd>/</kbd>
      <datalist id="course-list">
        {#each codes as code}
          <option value="{code} — {courses[code].title}"></option>
        {/each}
      </datalist>
      <button type="submit">Map it</button>
    </form>
  </div>

  <div class="row bottom">
    <div class="picks">
      <span class="label">Try</span>
      {#each PICKS as code}
        <button class="pick" class:on={code === target} onclick={() => onpick(code)}>{code}</button>
      {/each}
    </div>

    <div class="progress" title="Courses shown on the map for {target}">
      <div class="progress-text">
        <b>{target}</b>
        <span><i class="dot done"></i>{progress.done} taken</span>
        <span><i class="dot ready"></i>{progress.ready} ready</span>
        <span><i class="dot locked"></i>{progress.locked} to go</span>
      </div>
      <div class="bar" role="img" aria-label="{progress.done} taken, {progress.ready} ready, {progress.locked} to go">
        <div class="seg-done" style:width="{pct(progress.done)}%"></div>
        <div class="seg-ready" style:width="{pct(progress.ready)}%"></div>
      </div>
    </div>

    <div class="controls">
      <div class="seg" role="group" aria-label="View">
        <button class:on={view === 'graph'} onclick={() => (view = 'graph')}>Chart</button>
        <button class:on={view === 'list'} onclick={() => (view = 'list')}>List</button>
        <button class:on={view === 'explore'} onclick={() => (view = 'explore')}>Explore</button>
        <button class:on={view === 'plan'} onclick={() => (view = 'plan')}>Plan</button>
      </div>
      <label>
        Levels
        <select bind:value={maxDepth}>
          {#each [1, 2, 3, 4] as d}<option value={d}>{d}</option>{/each}
          <option value={Infinity}>All</option>
        </select>
      </label>
      <label class="toggle">
        <input type="checkbox" bind:checked={hideTaken} />
        <span class="switch" aria-hidden="true"></span>
        Hide what's behind taken
      </label>
    </div>
  </div>
</header>

<style>
  .hero {
    position: relative;
    overflow: hidden;
    padding: 14px 20px 12px;
    color: #fff;
    background:
      radial-gradient(120% 160% at 100% 0%, rgb(255 255 255 / 0.16), transparent 55%),
      radial-gradient(90% 140% at 0% 100%, rgb(0 0 0 / 0.28), transparent 60%),
      linear-gradient(120deg, var(--sfu-red-dark), var(--header-bg) 45%, #c42a40);
    box-shadow: 0 2px 0 var(--sfu-red-dark), 0 6px 18px rgb(80 10 20 / 0.25);
    z-index: 10;
  }

  .pattern {
    position: absolute;
    inset: 0;
    width: 200%;
    height: 100%;
    pointer-events: none;
    opacity: 0.13;
    animation: drift 60s linear infinite;
  }
  .pattern :global(path) {
    fill: none;
    stroke: #fff;
    stroke-width: 1.5;
  }
  .pattern :global(circle) {
    fill: #fff;
  }
  @keyframes drift {
    to {
      transform: translateX(-140px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .pattern {
      animation: none;
    }
  }

  .row {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 22px;
  }
  .row.bottom {
    margin-top: 12px;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }
  .mark {
    width: 42px;
    height: 42px;
    flex-shrink: 0;
    padding: 7px;
    border-radius: 12px;
    background: rgb(255 255 255 / 0.14);
    border: 1px solid rgb(255 255 255 / 0.3);
  }
  .mark path {
    fill: none;
    stroke: #fff;
    stroke-width: 2;
  }
  .mark circle {
    fill: #fff;
  }
  h1 {
    margin: 0;
    font-size: 22px;
    font-weight: 800;
    letter-spacing: -0.01em;
    line-height: 1.1;
  }
  .tagline {
    margin: 2px 0 0;
    font-size: 12.5px;
    opacity: 0.85;
  }

  .search {
    position: relative;
    flex: 1 1 340px;
    max-width: 560px;
    margin-left: auto;
    display: flex;
    align-items: center;
    background: #fff;
    border-radius: 999px;
    padding: 4px 4px 4px 14px;
    box-shadow: 0 4px 14px rgb(60 0 10 / 0.3);
    transition: box-shadow 0.15s, transform 0.15s;
  }
  .search:focus-within {
    box-shadow: 0 0 0 3px rgb(255 255 255 / 0.45), 0 6px 20px rgb(60 0 10 / 0.35);
    transform: translateY(-1px);
  }
  .icon {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
    fill: none;
    stroke: var(--sfu-red);
    stroke-width: 2.5;
    stroke-linecap: round;
  }
  .search input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    color: #1c1c1e;
    padding: 8px 10px;
    font-size: 15px;
  }
  .search input::placeholder {
    color: #8a8283;
  }
  kbd {
    font: 600 11px ui-monospace, monospace;
    color: #8a8283;
    border: 1px solid #ddd5d6;
    border-bottom-width: 2px;
    border-radius: 5px;
    padding: 1px 6px;
    margin-right: 8px;
  }
  .search:focus-within kbd {
    display: none;
  }
  .search button {
    border: none;
    border-radius: 999px;
    padding: 8px 18px;
    background: var(--sfu-red);
    color: #fff;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.15s, transform 0.1s;
  }
  .search button:hover {
    background: var(--sfu-red-dark);
  }
  .search button:active {
    transform: scale(0.96);
  }

  .picks {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .label {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    opacity: 0.75;
    margin-right: 2px;
  }
  .pick {
    padding: 3px 11px;
    border-radius: 999px;
    border: 1px solid rgb(255 255 255 / 0.4);
    background: rgb(255 255 255 / 0.1);
    color: #fff;
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, transform 0.15s;
  }
  .pick:hover {
    background: rgb(255 255 255 / 0.22);
    transform: translateY(-1px);
  }
  .pick.on {
    background: #fff;
    color: var(--sfu-red);
    border-color: #fff;
  }

  .progress {
    flex: 1 1 220px;
    max-width: 340px;
    min-width: 0;
  }
  .progress-text {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 12px;
    font-size: 12px;
    margin-bottom: 5px;
  }
  .progress-text span {
    display: flex;
    align-items: center;
    gap: 5px;
    opacity: 0.9;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: rgb(255 255 255 / 0.35);
  }
  .dot.done {
    background: #7be09a;
  }
  .dot.ready {
    background: #9cc2ff;
  }
  .bar {
    display: flex;
    height: 7px;
    border-radius: 999px;
    overflow: hidden;
    background: rgb(255 255 255 / 0.2);
  }
  .bar div {
    transition: width 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .seg-done {
    background: #7be09a;
  }
  .seg-ready {
    background: #9cc2ff;
  }

  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 16px;
    margin-left: auto;
    font-size: 13px;
  }
  .controls label {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }
  .seg {
    display: flex;
    padding: 3px;
    border-radius: 999px;
    background: rgb(0 0 0 / 0.18);
  }
  .seg button {
    border: none;
    border-radius: 999px;
    padding: 4px 14px;
    background: transparent;
    color: #fff;
    font-weight: 600;
    cursor: pointer;
  }
  .seg button.on {
    background: #fff;
    color: var(--sfu-red);
  }
  select {
    border: 1px solid rgb(255 255 255 / 0.45);
    border-radius: 999px;
    padding: 3px 8px;
    background: rgb(255 255 255 / 0.1);
    color: #fff;
    cursor: pointer;
  }
  select option {
    color: #1c1c1e;
    background: #fff;
  }

  /* Checkbox drawn as a switch */
  .toggle input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
  .switch {
    position: relative;
    width: 30px;
    height: 17px;
    border-radius: 999px;
    background: rgb(0 0 0 / 0.25);
    transition: background 0.2s;
  }
  .switch::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 13px;
    height: 13px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.2s;
  }
  .toggle input:checked + .switch {
    background: #7be09a;
  }
  .toggle input:checked + .switch::after {
    transform: translateX(13px);
  }
  .toggle input:focus-visible + .switch {
    outline: 2px solid #fff;
    outline-offset: 2px;
  }

  @media (max-width: 700px) {
    .hero {
      padding: 12px 16px 10px;
    }
    h1 {
      font-size: 18px;
    }
    .mark {
      width: 36px;
      height: 36px;
    }
    .tagline {
      display: none;
    }
    .search {
      flex-basis: 100%;
      margin-left: 0;
    }
    kbd {
      display: none;
    }
    .progress {
      flex-basis: 100%;
      max-width: none;
    }
    .controls {
      margin-left: 0;
    }
  }
</style>
