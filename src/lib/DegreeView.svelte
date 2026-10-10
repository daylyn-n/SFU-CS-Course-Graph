<!-- Degree progress: checks the taken courses against a program's requirements. -->
<script lang="ts">
  import { PROGRAMS, DEFAULT_PROGRAM } from '../data/programs';
  import { evaluateProgram, type RequirementResult } from './degree';
  import { courseStatus } from './graph';
  import TermPills from './TermPills.svelte';
  import type { Courses, Status, Taken, Term } from './types';

  interface Props {
    courses: Courses;
    done: Taken;
    offeredIn?: (code: string) => Term[];
    /** show a course in the side panel */
    onselect: (code: string) => void;
    /** map a course's prerequisites */
    ontarget: (code: string) => void;
  }

  let { courses, done, offeredIn = () => [], onselect, ontarget }: Props = $props();

  const STORAGE_KEY = 'sfu-prereqs:program';
  const SUGGESTIONS = 6;

  function loadProgram(): string {
    try {
      const id = localStorage.getItem(STORAGE_KEY);
      if (id && PROGRAMS.some((p) => p.id === id)) return id;
    } catch {}
    return DEFAULT_PROGRAM;
  }

  let programId = $state(loadProgram());
  $effect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, programId);
    } catch {}
  });

  const program = $derived(PROGRAMS.find((p) => p.id === programId) ?? PROGRAMS[0]);
  const result = $derived(evaluateProgram(program, done, courses));
  const pct = $derived(Math.round(result.fraction * 100));
  // Courses with all prerequisites met come first, then ones running soon.
  const rank: Record<Status, number> = { ready: 0, unknown: 1, locked: 2, done: 3 };
  const STATE_LABEL: Record<Status, string> = {
    done: 'Taken',
    ready: 'Can take now',
    unknown: 'Check requirements',
    locked: 'Prerequisites missing',
  };

  function suggestions(r: RequirementResult): { code: string; status: Status }[] {
    return r.candidates
      .map((code) => ({ code, status: courseStatus(code, courses, done), soon: offeredIn(code).length > 0 }))
      .sort((a, b) => rank[a.status] - rank[b.status] || Number(b.soon) - Number(a.soon))
      .slice(0, SUGGESTIONS);
  }

  const measureLabel = (r: RequirementResult) =>
    r.measure === 'units' ? `${r.have}/${r.need} units` : r.measure === 'areas' ? `${r.have}/${r.need} areas` : '';

  let showAll = $state<Record<string, boolean>>({});

  // Ring geometry
  const R = 34;
  const C = 2 * Math.PI * R;
</script>

<div class="degree">
  <div class="summary">
    <svg class="ring" viewBox="0 0 80 80" role="img" aria-label="{pct}% of requirements complete">
      <circle class="track" cx="40" cy="40" r={R} />
      <circle class="fill" cx="40" cy="40" r={R} stroke-dasharray="{(C * pct) / 100} {C}" />
      <text x="40" y="45" text-anchor="middle">{pct}%</text>
    </svg>
    <div class="summary-text">
      <label class="picker">
        <span class="eyebrow">Program</span>
        <select bind:value={programId}>
          {#each PROGRAMS as p (p.id)}
            <option value={p.id}>{p.name} ({p.credential})</option>
          {/each}
        </select>
      </label>
      <p class="stats">
        <b>{result.met}</b> of {result.total} requirements met · <b>{result.unitsCounted}</b> units counted
      </p>
      <div class="bar" aria-hidden="true"><div style:width="{pct}%"></div></div>
    </div>
  </div>

  {#if result.duplicates.length}
    <p class="notice">
      {result.duplicates.join(', ')} not counted: an equivalent (cross-listed) course already counts.
    </p>
  {/if}

  {#each result.sections as { section, results } (section.title)}
    {@const metHere = results.filter((r) => r.status === 'met').length}
    <section class="group">
      <h3>
        {section.title}
        <span class="count" class:all={metHere === results.length}>{metHere}/{results.length}</span>
      </h3>
      {#if section.note}<p class="note">{section.note}</p>{/if}
      <ul>
        {#each results as r (r.req.id)}
          {@const sugg = suggestions(r)}
          <li class="req {r.status}">
            <span class="icon" role="img" aria-label={r.status}>
              {#if r.status === 'met'}
                <svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7" /></svg>
              {:else if r.status === 'partial'}
                <svg viewBox="0 0 16 16"><path d="M8 2.5a5.5 5.5 0 0 1 0 11z" class="half" /></svg>
              {/if}
            </span>
            <div class="body">
              <div class="head">
                <span class="title">
                  {#if r.req.kind === 'course'}
                    {@const code = r.req.code}
                    <button class="code-link" onclick={() => onselect(code)}>{code}</button>
                    <span class="muted-inline">{courses[code]?.title ?? ''}</span>
                  {:else}
                    {r.req.title}
                  {/if}
                </span>
                {#if measureLabel(r)}<span class="measure">{measureLabel(r)}</span>{/if}
              </div>
              {#if r.req.note}<p class="note">{r.req.note}</p>{/if}

              {#if r.counted.length && r.req.kind !== 'course'}
                <div class="chips">
                  {#each showAll[r.req.id] ? r.counted : r.counted.slice(0, 10) as code (code)}
                    <button class="chip done" onclick={() => onselect(code)}>{code}</button>
                  {/each}
                  {#if r.counted.length > 10 && !showAll[r.req.id]}
                    <button class="chip more" onclick={() => (showAll[r.req.id] = true)}>
                      +{r.counted.length - 10}
                    </button>
                  {/if}
                </div>
              {/if}

              {#if r.status !== 'met'}
                {#if r.remaining && r.req.kind !== 'course'}
                  <p class="remaining">Still needed: {r.remaining}</p>
                {/if}
                {#if r.req.kind === 'course'}
                  {@const code = r.req.code}
                  {@const st = courseStatus(code, courses, done)}
                  <div class="course-line">
                    <span class="state {st}">{STATE_LABEL[st]}</span>
                    <TermPills terms={offeredIn(code)} />
                    <button class="map-link" onclick={() => ontarget(code)}>Map prerequisites →</button>
                  </div>
                {:else if sugg.length}
                  <div class="chips suggest">
                    {#each sugg as s (s.code)}
                      <span class="sugg {s.status}">
                        <button class="chip" title={courses[s.code]?.title ?? s.code} onclick={() => onselect(s.code)}>
                          {s.code}
                          <TermPills terms={offeredIn(s.code)} />
                        </button>
                        <button
                          class="map"
                          title="Map prerequisites for {s.code}"
                          aria-label="Map prerequisites for {s.code}"
                          onclick={() => ontarget(s.code)}
                        >
                          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h9M8.5 4.5L12 8l-3.5 3.5" /></svg>
                        </button>
                      </span>
                    {/each}
                  </div>
                {/if}
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    </section>
  {/each}

  {#if program.caveats?.length}
    <section class="group">
      <h3>How this was read</h3>
      <ul class="caveats">
        {#each program.caveats as c}<li>{c}</li>{/each}
      </ul>
    </section>
  {/if}

  <p class="source">
    Requirements transcribed from the
    <a href={program.source} target="_blank" rel="noopener">SFU Academic Calendar ({program.calendar}) ↗</a>.
    This is an unofficial planning aid: it doesn't check grades, GPA, WQB or residency, and the calendar
    and an academic advisor have the final word. Blue suggestions can be taken now.
  </p>
</div>

<style>
  .degree {
    max-width: 820px;
    margin: 0 auto;
  }

  .summary {
    display: flex;
    align-items: center;
    gap: 18px;
    padding: 14px 16px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
  }
  .ring {
    width: 84px;
    height: 84px;
    flex-shrink: 0;
  }
  .ring circle {
    fill: none;
    stroke-width: 8;
  }
  .ring .track {
    stroke: var(--border);
  }
  .ring .fill {
    stroke: var(--done);
    stroke-linecap: round;
    transform: rotate(-90deg);
    transform-origin: 40px 40px;
    transition: stroke-dasharray 0.5s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .ring text {
    fill: var(--text);
    font-size: 17px;
    font-weight: 800;
  }
  .summary-text {
    flex: 1;
    min-width: 0;
  }
  .picker {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .eyebrow {
    font-size: 12px;
    color: var(--accent-text);
    font-weight: 600;
  }
  .picker select {
    max-width: 100%;
    font-weight: 700;
    font-size: 15px;
  }
  .stats {
    margin: 8px 0 6px;
    font-size: 13px;
    color: var(--muted);
  }
  .stats b {
    color: var(--text);
  }
  .bar {
    height: 6px;
    border-radius: 999px;
    background: var(--border);
    overflow: hidden;
  }
  .bar div {
    height: 100%;
    background: var(--done);
    transition: width 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  .notice {
    margin: 12px 0 0;
    font-size: 13px;
    color: var(--muted);
  }

  .group {
    margin-top: 18px;
  }
  h3 {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 6px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
  }
  .count {
    padding: 0 7px;
    border-radius: 999px;
    border: 1px solid var(--border);
    font-size: 11px;
    letter-spacing: 0;
  }
  .count.all {
    border-color: var(--done);
    color: var(--done);
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
    overflow: hidden;
  }
  .req {
    display: flex;
    gap: 10px;
    padding: 10px 14px;
  }
  .req + .req {
    border-top: 1px solid var(--border);
  }
  .icon {
    flex-shrink: 0;
    width: 18px;
    height: 18px;
    margin-top: 1px;
    border-radius: 50%;
    border: 1.5px solid var(--locked-border);
  }
  .icon svg {
    display: block;
    width: 100%;
    height: 100%;
    fill: none;
    stroke: #fff;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .req.met .icon {
    background: var(--done);
    border-color: var(--done);
  }
  .req.partial .icon {
    border-color: var(--ready);
  }
  .icon .half {
    fill: var(--ready);
    stroke: none;
  }
  .body {
    flex: 1;
    min-width: 0;
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 2px 10px;
  }
  .title {
    flex: 1;
    min-width: 0;
    font-weight: 600;
  }
  .req.met .title {
    color: var(--muted);
  }
  .muted-inline {
    margin-left: 6px;
    font-weight: 400;
    font-size: 13px;
    color: var(--muted);
  }
  .code-link {
    all: unset;
    cursor: pointer;
    font-weight: 700;
  }
  .code-link:hover {
    color: var(--accent-text);
    text-decoration: underline;
  }
  .req.met .code-link {
    color: var(--done);
  }
  .measure {
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: var(--muted);
  }
  .note,
  .remaining {
    margin: 2px 0 0;
    font-size: 12.5px;
    color: var(--muted);
  }
  .remaining {
    color: var(--text);
  }

  .course-line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
    margin-top: 3px;
    font-size: 12.5px;
  }
  .state {
    color: var(--muted);
  }
  .state.ready {
    color: var(--ready);
    font-weight: 600;
  }
  .state.unknown {
    color: var(--unknown);
    font-weight: 600;
  }
  .map-link {
    all: unset;
    cursor: pointer;
    color: var(--accent-text);
    font-size: 12px;
  }
  .map-link:hover {
    text-decoration: underline;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 6px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 9px;
    font-size: 12px;
    border-radius: 999px;
  }
  .chip.done {
    border-color: var(--done);
    color: var(--done);
    background: var(--done-bg);
  }
  .chip.more {
    color: var(--muted);
  }
  .sugg {
    display: inline-flex;
    align-items: stretch;
  }
  .sugg .chip {
    border-radius: 999px 0 0 999px;
    border-right: none;
  }
  .sugg.ready .chip,
  .sugg.ready .map {
    border-color: var(--ready);
    color: var(--ready);
    background: var(--ready-bg);
  }
  .sugg.unknown .chip,
  .sugg.unknown .map {
    border-color: var(--unknown);
    color: var(--unknown);
    background: var(--unknown-bg);
  }
  .map {
    display: inline-flex;
    align-items: center;
    padding: 0 7px 0 5px;
    border-radius: 0 999px 999px 0;
    color: var(--muted);
  }
  .map svg {
    width: 12px;
    height: 12px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .chip:hover,
  .map:hover {
    border-color: var(--accent);
    color: var(--accent-text);
  }

  .caveats {
    padding: 10px 14px 10px 30px;
    list-style: disc;
    font-size: 12.5px;
    color: var(--muted);
  }
  .caveats li + li {
    margin-top: 4px;
  }

  .source {
    margin: 18px 0 8px;
    font-size: 11.5px;
    color: var(--muted);
  }
  .source a {
    color: var(--accent-text);
  }

  @media (max-width: 700px) {
    .summary {
      gap: 12px;
      padding: 12px;
    }
    .ring {
      width: 68px;
      height: 68px;
    }
    .req {
      padding: 10px 12px;
    }
  }
</style>
