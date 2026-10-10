<script lang="ts">
  import { matchCourse, searchCourses } from './search';
  import CourseInput from './CourseInput.svelte';
  import type { Snippet } from 'svelte';
  import type { Courses, Term, View } from './types';

  interface Props {
    courses: Courses;
    target: string;
    /** counts for the courses on the map */
    progress: { done: number; ready: number; locked: number };
    terms: Term[];
    onpick: (code: string) => void;
    /** is the course running in an upcoming term? (filters the quick picks) */
    isOffered?: ((code: string) => boolean) | null;
    view: View;
    /** the account button (sign in / avatar), when accounts are set up */
    account?: Snippet;
  }

  let {
    courses,
    target,
    progress, // { done, ready, locked } counts for the courses on the map
    terms,
    onpick,
    isOffered = null,
    view = $bindable(),
    account,
  }: Props = $props();

  // Quick picks, skipping any that aren't in the data or not running soon.
  // svelte-ignore state_referenced_locally
  const PICKS = ['CMPT 225', 'CMPT 276', 'CMPT 300', 'CMPT 310', 'CMPT 354', 'CMPT 410', 'MACM 316']
    .filter((c) => c in courses && (!isOffered || isOffered(c)))
    .slice(0, 5);

  let search = $state('');
  let input = $state<HTMLInputElement>();

  let message = $state('');

  function submitSearch() {
    const code = matchCourse(search, courses);
    if (code) {
      onpick(code);
      search = '';
      message = '';
      input?.blur();
      return;
    }
    showNoMatch(search, searchCourses(search, courses, 3));
  }

  function showNoMatch(query: string, hits: { code: string }[]) {
    message = !query.trim()
      ? ''
      : hits.length
        ? `Pick one: ${hits.map((h) => h.code).join(', ')}${hits.length === 3 ? '…' : ''}`
        : `No course matches "${query.trim()}"`;
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
      input?.focus();
    }
  }

  const total = $derived(progress.done + progress.ready + progress.locked);
  const pct = (n: number) => (total ? (n / total) * 100 : 0);
</script>

<svelte:window {onkeydown} />

<header class="hero">
  <div class="pattern-clip" aria-hidden="true">
  <svg class="pattern">
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
  </div>

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
      <CourseInput
        {courses}
        bind:value={search}
        bind:input
        placeholder="Search by code or name, e.g. CMPT 410 or machine learning"
        label="Course to look up"
        onpick={(code) => {
          message = '';
          onpick(code);
          input?.blur();
        }}
        oninput={() => (message = '')}
        onnomatch={showNoMatch}
      />
      <kbd>/</kbd>
      <button type="submit">Map it</button>
      {#if message}<div class="message" role="status">{message}</div>{/if}
    </form>
    {#if account}<div class="account">{@render account()}</div>{/if}
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
        <button class:on={view === 'schedule'} onclick={() => (view = 'schedule')}>Schedule</button>
        <button class:on={view === 'degree'} onclick={() => (view = 'degree')}>Degree</button>
      </div>
    </div>
  </div>
</header>

<style>
  .hero {
    position: relative;
    padding: 14px 20px 12px;
    color: #fff;
    background:
      radial-gradient(120% 160% at 100% 0%, rgb(255 255 255 / 0.16), transparent 55%),
      radial-gradient(90% 140% at 0% 100%, rgb(0 0 0 / 0.28), transparent 60%),
      linear-gradient(120deg, var(--sfu-red-dark), var(--header-bg) 45%, #c42a40);
    box-shadow: 0 2px 0 var(--sfu-red-dark), 0 6px 18px rgb(80 10 20 / 0.25);
    z-index: 10;
  }

  /* Clips the drifting pattern without clipping dropdowns in the header. */
  .pattern-clip {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
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
  .account {
    flex-shrink: 0;
  }
  .row.top {
    z-index: 2; /* search dropdown sits above the row below */
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
  .search :global(input) {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    color: #1c1c1e;
    padding: 8px 10px;
    font-size: 15px;
  }
  .search :global(input::placeholder) {
    color: #8a8283;
  }
  .message {
    position: absolute;
    top: calc(100% + 6px);
    left: 14px;
    padding: 4px 10px;
    border-radius: 6px;
    background: #fff;
    color: var(--sfu-red);
    font-size: 12.5px;
    font-weight: 600;
    box-shadow: 0 4px 12px rgb(60 0 10 / 0.25);
    z-index: 20;
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





  /* Checkbox drawn as a switch */







  @media (max-width: 700px) {
    /* Six tabs don't fit a phone: let the row scroll sideways. */
    .controls {
      max-width: 100%;
    }
    .seg {
      max-width: 100%;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .seg button {
      flex-shrink: 0;
    }
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
    .message {
    position: absolute;
    top: calc(100% + 6px);
    left: 14px;
    padding: 4px 10px;
    border-radius: 6px;
    background: #fff;
    color: var(--sfu-red);
    font-size: 12.5px;
    font-weight: 600;
    box-shadow: 0 4px 12px rgb(60 0 10 / 0.25);
    z-index: 20;
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
