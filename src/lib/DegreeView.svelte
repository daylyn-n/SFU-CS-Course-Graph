<!-- Degree progress: checks the taken courses against the chosen program's requirements. -->
<script lang="ts">
  import { settings } from './persist/store.svelte';
  import { evaluateProgram, type Program, type RequirementResult, type SectionResult } from './degree';
  import { loadProgram, loadProgramIndex, pickerOptions, resolveProgramId, type ProgramIndexEntry } from './programs/load';
  import ProgramPicker from './programs/ProgramPicker.svelte';
  import ProgramPrompt from './programs/ProgramPrompt.svelte';
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
    /** courses filled in from ticked ones; assumed ones count but are flagged */
    implied?: ReadonlyMap<string, { via: string; certain: boolean }>;
    /** tick or untick a course as taken (the same as everywhere else in the app) */
    ontoggle: (code: string) => void;
  }

  let { courses, done, offeredIn = () => [], onselect, ontarget, implied = new Map(), ontoggle }: Props = $props();
  const isAssumed = (code: string) => implied.get(code)?.certain === false;

  const SUGGESTIONS = 6;

  // The chosen program id is saved (and synced) by persist/store; old saves
  // may hold a hand-written id ('cmpt-major-bsc'), which maps to its calendar id.
  // Only that program's file is fetched; the full list only when picking.
  const programId = $derived(resolveProgramId(settings.program));

  let program = $state<Program | null>(null);
  let loading = $state(false);
  $effect(() => {
    const id = programId;
    if (!id) {
      program = null;
      loading = false;
      return;
    }
    let current = true;
    loading = true;
    loadProgram(id).then((p) => {
      if (!current) return;
      program = p;
      loading = false;
    });
    return () => {
      current = false;
    };
  });

  // The program list, for the picker (loaded when a picker is shown).
  let index = $state<ProgramIndexEntry[] | null>(null);
  let indexFailed = $state(false);
  function needIndex() {
    if (index) return;
    indexFailed = false;
    loadProgramIndex().then((list) => {
      if (list.length) index = list;
      else indexFailed = true;
    });
  }
  const options = $derived(index ? pickerOptions(index) : []);
  const needsPick = $derived(!loading && !program);
  $effect(() => {
    if (needsPick) needIndex();
  });

  let changing = $state(false);
  function openChange() {
    needIndex();
    changing = true;
  }
  function pick(id: string) {
    settings.program = id;
    changing = false;
  }

  const result = $derived(program ? evaluateProgram(program, done, courses) : null);
  const pct = $derived(result ? Math.round(result.fraction * 100) : 0);
  // Optional concentrations (CS Table I): progress in each area.
  const level = (code: string) => parseInt(code.split(' ')[1] ?? '', 10) || 0;
  const concentrationResults = $derived.by(() => {
    const c = program?.concentrations;
    if (!c) return [];
    return c.areas.map((a) => {
      const have = a.codes.filter((code) => done.has(code));
      const upper = have.filter((code) => level(code) >= (c.upperLevel ?? 400));
      return {
        name: a.name,
        codes: a.codes,
        have: have.length,
        upper: upper.length,
        complete: have.length >= c.count && upper.length >= (c.minUpper ?? 0),
      };
    });
  });
  const counted = (s: SectionResult) => !s.section.choice || s.chosen;
  // Assumed courses (our guess at a "one of" route) that are counting here.
  const assumedCounted = $derived(
    result
      ? [
          ...new Set(
            result.sections.filter(counted).flatMap(({ results }) =>
              results.flatMap((r) =>
                r.status === 'manual' ? [] : r.req.kind === 'course' && r.status === 'met' ? [r.req.code] : r.counted,
              ),
            ),
          ),
        ].filter(isAssumed)
      : [],
  );
  // Name of the counted alternative in each choice group.
  const chosenIn = $derived(
    new Map((result?.sections ?? []).filter((s) => s.chosen).map((s) => [s.section.choice!.group, s.section.title])),
  );

  // Courses with all prerequisites met come first, then ones running soon.
  const rank: Record<Status, number> = { ready: 0, unknown: 1, locked: 2, done: 3 };
  const STATE_LABEL: Record<Status, string> = {
    done: 'Taken',
    ready: 'Can take now',
    unknown: 'Check requirements',
    locked: 'Prerequisites missing',
  };

  function suggestions(r: RequirementResult): { code: string; status: Status }[] {
    // "45 upper division units" in any subject: suggesting ARCH 100 is noise.
    if (r.req.kind === 'choose' && r.req.from.ranges?.some((x) => x.subjects.includes('*'))) return [];
    return r.candidates
      .map((code) => ({ code, status: courseStatus(code, courses, done), soon: offeredIn(code).length > 0 }))
      .sort((a, b) => rank[a.status] - rank[b.status] || Number(b.soon) - Number(a.soon))
      .slice(0, SUGGESTIONS);
  }

  const measureLabel = (r: RequirementResult) =>
    r.measure === 'units' ? `${r.have}/${r.need} units` : r.measure === 'areas' ? `${r.have}/${r.need} areas` : '';
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  let showAll = $state<Record<string, boolean>>({});

  // Ring geometry
  const R = 34;
  const C = 2 * Math.PI * R;
</script>

{#snippet pickerCard()}
  <div class="pick-card">
    {#if index}
      <ProgramPicker
        programs={options}
        value={programId}
        onpick={pick}
        title={programId ? 'We couldn’t find your program' : 'Which program are you in?'}
        description={programId
          ? 'It may have been renamed in the calendar. Pick it again to see your degree progress.'
          : 'Pick your program to see which requirements you’ve met. Only that program’s data is downloaded.'}
        autofocus={false}
      />
    {:else if indexFailed}
      <p class="notice">
        Couldn’t load the program list. <button class="link" onclick={needIndex}>Try again</button>
      </p>
    {:else}
      <p class="notice loading">Loading programs…</p>
    {/if}
  </div>
{/snippet}

<!-- One click marks a course taken (or not), the same as the checkboxes on
     the chart; the code opens its details. Unticking cascades as usual. -->
{#snippet tick(code: string, size: 'big' | 'small')}
  {@const taken = done.has(code)}
  <button
    type="button"
    class="tick {size}"
    class:on={taken}
    class:assumed={taken && isAssumed(code)}
    role="checkbox"
    aria-checked={taken}
    aria-label="{taken ? 'Untick' : 'Tick'} {code} as taken"
    title={taken && isAssumed(code)
      ? `Assumed taken (prerequisite of ${implied.get(code)?.via}). Click if you didn't take it.`
      : taken
        ? 'Taken. Click to untick'
        : 'Click to mark as taken'}
    onclick={() => ontoggle(code)}
  >
    {#if taken}<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg>{/if}
  </button>
{/snippet}

{#snippet chip(code: string)}
  {@const taken = done.has(code)}
  {@const st = taken ? 'done' : courseStatus(code, courses, done)}
  <span class="cchip {st}" class:assumed={taken && isAssumed(code)}>
    {@render tick(code, 'small')}
    <button type="button" class="ccode" title="{courses[code]?.title ?? code}: details" onclick={() => onselect(code)}>{code}</button>
    {#if !taken}<TermPills terms={offeredIn(code)} />{/if}
  </span>
{/snippet}

<div class="degree">
  {#if loading}
    <p class="notice loading" role="status">Loading your program…</p>
  {:else if !program || !result}
    {@render pickerCard()}
  {:else}
    <div class="summary">
      <svg class="ring" viewBox="0 0 80 80" role="img" aria-label="{pct}% of requirements complete">
        <circle class="track" cx="40" cy="40" r={R} />
        <circle class="fill" cx="40" cy="40" r={R} stroke-dasharray="{(C * pct) / 100} {C}" />
        <text x="40" y="45" text-anchor="middle">{pct}%</text>
      </svg>
      <div class="summary-text">
        <span class="eyebrow">Your program</span>
        <!-- The whole box opens the program picker, so it's obvious where to
             click to change it. -->
        <button
          class="program-switch"
          onclick={openChange}
          aria-label="Change program (currently {program.name})"
          title="Change program"
        >
          <h2 class="program-name">
            {program.name}{#if program.credential && !program.name.includes(program.credential)}
              <span class="cred">{program.credential}</span>{/if}
          </h2>
          <span class="change-cta" aria-hidden="true">
            <svg viewBox="0 0 16 16"><path d="M2.5 5h9m0 0L9 2.5M11.5 5 9 7.5M13.5 11h-9m0 0L7 8.5M4.5 11 7 13.5" /></svg>
            Change program
          </span>
        </button>
        <p class="stats">
          <b>{result.met}</b> of {result.total} requirements met · <b>{result.unitsCounted}</b> units counted
          {#if result.manual}
            · <span class="to-confirm">{plural(result.manual, 'item')} to confirm with an advisor</span>
          {/if}
        </p>
        <div class="bar" aria-hidden="true"><div style:width="{pct}%"></div></div>
      </div>
    </div>

    <p class="howto">
      <span class="tick small demo" aria-hidden="true"></span> Tick a course to mark it taken · click a code for
      details · <span class="key ready">can take now</span>
      <span class="key unknown">check requirements</span>
      <span class="key locked">prerequisites missing</span>
    </p>

    {#if program.grades?.length}
      <section class="grades" aria-label="Grade requirements">
        <h3>Grade requirements</h3>
        <ul>
          {#each program.grades as g (g.text)}
            <li><b>{g.label}:</b> {g.text}</li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if assumedCounted.length}
      <p class="notice assumed-note">
        Counting {assumedCounted.length} assumed course{assumedCounted.length === 1 ? '' : 's'} (dashed), filled in from
        prerequisites of courses you've taken: {assumedCounted.join(', ')}. Select one to confirm or correct it.
      </p>
    {/if}

    {#if result.duplicates.length}
      <p class="notice">
        {result.duplicates.join(', ')} not counted: an equivalent (cross-listed) course already counts.
      </p>
    {/if}

    {#each result.sections as sr, si (si)}
      {@const { section, results } = sr}
      {@const checkable = results.filter((r) => r.status !== 'manual')}
      {@const metHere = checkable.filter((r) => r.status === 'met').length}
      {@const choice = section.choice}
      {@const firstInGroup = choice && result.sections.findIndex((s) => s.section.choice?.group === choice.group) === si}
      {#if choice && firstInGroup}
        <p class="choice-head">
          {#if choice.optional}
            Optional {choice.label ?? 'stream'}s: these don’t count toward your progress.
          {:else}
            Choose one {choice.label ?? 'stream'}. Counting your best match{chosenIn.get(choice.group)
              ? `: ${chosenIn.get(choice.group)}`
              : ''}.
          {/if}
        </p>
      {/if}
      <section class="group" class:alt={choice && (!sr.chosen || choice.optional)}>
        <h3>
          {section.title}
          {#if checkable.length}
            <span class="count" class:all={metHere === checkable.length}>{metHere}/{checkable.length}</span>
          {/if}
          {#if choice && !choice.optional}
            <span class="tag">{sr.chosen ? 'counted' : 'not counted'}</span>
          {/if}
        </h3>
        {#if section.note}
          {#each section.note.split('\n') as line}<p class="note">{line}</p>{/each}
        {/if}
        {#if results.length}
          <ul>
            {#each results as r (r.req.id)}
              {@const sugg = r.status === 'manual' ? [] : suggestions(r)}
              <li class="req {r.status}" class:group-req={r.req.kind !== 'course'}>
                {#if r.req.kind === 'course'}
                  {@const code = r.req.code}
                  {@render tick(code, 'big')}
                {:else}
                  <!-- Groups ("one of", units, areas) are met by ticking their courses,
                       so their status is a coloured edge, not something to click. -->
                  <span class="sr-only">{r.status === 'manual' ? 'Check with an advisor' : r.status === 'met' ? 'Met' : r.status === 'partial' ? 'Partly met' : 'Not met'}</span>
                {/if}
                <div class="body">
                  <div class="head">
                    <span class="title">
                      {#if r.req.kind === 'course'}
                        {@const code = r.req.code}
                        <button class="code-link" onclick={() => onselect(code)}>{code}</button>
                        <span class="muted-inline">{courses[code]?.title ?? ''}</span>
                        {#if r.status === 'met' && isAssumed(code)}<span class="assumed-tag">assumed</span>{/if}
                      {:else if r.req.kind === 'note'}
                        <span class="manual-label">Can’t be checked automatically</span>
                      {:else}
                        {r.req.title}
                      {/if}
                    </span>
                    {#if measureLabel(r)}<span class="measure">{measureLabel(r)}</span>{/if}
                  </div>
                  {#if r.req.kind === 'note'}
                    <p class="manual-text">{r.req.text}</p>
                  {/if}
                  {#if r.req.note}<p class="note">{r.req.note}</p>{/if}

                  {#if r.counted.length && r.req.kind !== 'course'}
                    <div class="chips">
                      {#each showAll[r.req.id] ? r.counted : r.counted.slice(0, 10) as code (code)}
                        {@render chip(code)}
                      {/each}
                      {#if r.counted.length > 10 && !showAll[r.req.id]}
                        <button class="chip more" onclick={() => (showAll[r.req.id] = true)}>
                          +{r.counted.length - 10}
                        </button>
                      {/if}
                    </div>
                  {/if}

                  {#if r.status === 'manual'}
                    {#if r.candidates.length}
                      <div class="chips">
                        {#each r.candidates.slice(0, 12) as code (code)}
                          {@render chip(code)}
                        {/each}
                        {#if r.candidates.length > 12}<span class="chip more">+{r.candidates.length - 12}</span>{/if}
                      </div>
                    {/if}
                  {:else if r.status !== 'met'}
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
                          {@render chip(s.code)}
                        {/each}
                      </div>
                    {/if}
                  {/if}
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {/each}

    {#if program.concentrations && concentrationResults.length}
      {@const done4 = concentrationResults.filter((c) => c.complete).length}
      <section class="group concentrations">
        <h3>
          Concentrations
          <span class="count" class:all={done4 > 0}>{done4} complete</span>
        </h3>
        <p class="note">{program.concentrations.rule}</p>
        <div class="conc-grid">
          {#each concentrationResults as c (c.name)}
            {@const need = program.concentrations.count}
            {@const needUpper = program.concentrations.minUpper ?? 0}
            <div class="conc" class:complete={c.complete}>
              <div class="conc-head">
                <b>{c.name}</b>
                {#if c.complete}<span class="conc-done">Complete</span>{/if}
              </div>
              <p class="conc-progress">
                {Math.min(c.have, need)} of {need} courses · {Math.min(c.upper, needUpper)} of {needUpper} at the
                {program.concentrations.upperLevel ?? 400} level
              </p>
              <div class="conc-bar" aria-hidden="true"><div style:width="{(Math.min(c.have, need) / need) * 100}%"></div></div>
              <div class="chips">
                {#each c.codes as code (code)}{@render chip(code)}{/each}
              </div>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    {#if program.caveats?.length}
      <section class="group">
        <h3>How this was read</h3>
        <ul class="caveats">
          {#each program.caveats as c}<li>{c}</li>{/each}
        </ul>
      </section>
    {/if}

    <p class="source">
      Requirements {program.converted ? 'converted automatically' : 'transcribed'} from the
      <a href={program.source} target="_blank" rel="noopener">SFU Academic Calendar ({program.calendar}) ↗</a>.
      This is an unofficial planning aid: it doesn't check grades, GPA, WQB or residency, and the calendar
      and an academic advisor have the final word. Blue suggestions can be taken now.
    </p>
  {/if}
</div>

{#if index}
  <ProgramPrompt
    bind:open={changing}
    programs={options}
    value={programId}
    onpick={pick}
    title="Change program"
    description="Your degree progress will be checked against the program you pick."
  />
{/if}

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
  .program-line {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }
  .eyebrow {
    font-size: 12px;
    color: var(--accent-text);
    font-weight: 600;
  }
  .link {
    all: unset;
    cursor: pointer;
    color: var(--accent-text);
    font-size: 12px;
    font-weight: 600;
  }
  .link:hover {
    text-decoration: underline;
  }
  .link:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: 3px;
  }
  .program-switch {
    all: unset;
    box-sizing: border-box;
    display: flex;
    /* On narrow screens the button drops below the name instead of squeezing it. */
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    margin-top: 4px;
    padding: 8px 8px 8px 12px;
    border: 1.5px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    cursor: pointer;
    transition:
      border-color 0.15s,
      box-shadow 0.15s;
  }
  .program-switch:hover {
    border-color: var(--accent);
    box-shadow: 0 2px 10px rgb(0 0 0 / 0.06);
  }
  .program-switch:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .change-cta {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    padding: 6px 12px;
    border-radius: 999px;
    background: var(--sfu-red);
    color: #fff;
    font-size: 13px;
    font-weight: 650;
    white-space: nowrap;
  }
  .program-switch:hover .change-cta {
    background: var(--sfu-red-dark);
  }
  .change-cta svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.7;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .program-name {
    flex: 1 1 160px;
    margin: 0;
    font-size: 16px;
    font-weight: 750;
    line-height: 1.3;
  }
  .cred {
    margin-left: 6px;
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
  }
  .to-confirm {
    color: var(--unknown);
    font-weight: 600;
  }
  .pick-card {
    padding: 20px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
  }
  .loading {
    text-align: center;
    padding: 24px 0;
  }
  .choice-head {
    margin: 22px 0 -8px;
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
  }
  .group.alt {
    opacity: 0.62;
  }
  .group.alt:hover,
  .group.alt:focus-within {
    opacity: 1;
  }
  .tag {
    font-size: 10.5px;
    letter-spacing: 0;
    text-transform: none;
    font-weight: 600;
    padding: 0 7px;
    border-radius: 999px;
    border: 1px dashed var(--border);
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
  /* Groups are met by ticking their courses: status shows as the left edge. */
  .req.group-req {
    border-left: 3px solid var(--locked-border);
  }
  .req.group-req.met {
    border-left-color: var(--done);
  }
  .req.group-req.partial {
    border-left-color: var(--ready);
  }
  .req.group-req.manual {
    border-left: 3px dashed var(--unknown);
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }

  /* The tick box: the same everywhere on this page. */
  .tick {
    all: unset;
    box-sizing: border-box;
    flex-shrink: 0;
    display: grid;
    place-items: center;
    border: 2px solid var(--locked-border);
    border-radius: 5px;
    background: var(--surface);
    cursor: pointer;
    transition:
      border-color 0.12s,
      background 0.12s;
  }
  .tick.big {
    width: 22px;
    height: 22px;
  }
  .tick.small {
    width: 16px;
    height: 16px;
    border-radius: 4px;
    border-width: 1.5px;
  }
  .tick:hover {
    border-color: var(--done);
  }
  .tick:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .tick.on {
    background: var(--done);
    border-color: var(--done);
  }
  .tick.on.assumed {
    background: var(--done-bg);
    border-style: dashed;
  }
  .tick svg {
    width: 80%;
    height: 80%;
    fill: none;
    stroke: #fff;
    stroke-width: 2.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .tick.on.assumed svg {
    stroke: var(--done);
  }

  /* Course chips: tick box, code (details), term badges. Colour = can I take it? */
  .cchip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 9px 3px 5px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface);
    font-size: 12px;
  }
  .cchip.ready {
    border-color: var(--ready);
    background: var(--ready-bg);
  }
  .cchip.unknown {
    border-color: var(--unknown);
    background: var(--unknown-bg);
  }
  .cchip.done {
    border-color: var(--done);
    background: var(--done-bg);
  }
  .cchip.done.assumed {
    border-style: dashed;
    background: transparent;
  }
  .ccode {
    all: unset;
    cursor: pointer;
    font-weight: 600;
  }
  .ccode:hover {
    text-decoration: underline;
    color: var(--accent-text);
  }
  .cchip.ready .ccode {
    color: var(--ready);
  }
  .cchip.unknown .ccode {
    color: var(--unknown);
  }
  .cchip.done .ccode {
    color: var(--done);
  }

  .howto {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
    margin: 4px 2px 12px;
    font-size: 12.5px;
    color: var(--muted);
  }
  .tick.demo {
    display: inline-block;
    pointer-events: none;
  }
  .key {
    padding: 0 8px;
    border-radius: 999px;
    border: 1px solid var(--border);
  }
  .key.ready {
    border-color: var(--ready);
    color: var(--ready);
    background: var(--ready-bg);
  }
  .key.unknown {
    border-color: var(--unknown);
    color: var(--unknown);
    background: var(--unknown-bg);
  }

  .grades {
    margin: 0 0 16px;
    padding: 10px 14px;
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent);
    border-radius: 10px;
    background: var(--surface);
  }
  .grades h3 {
    margin: 0 0 4px;
    font-size: 13px;
  }
  .grades ul {
    margin: 0;
    padding: 0 0 0 18px;
    border: none;
    border-radius: 0;
    background: none;
    overflow: visible;
    list-style: disc;
    font-size: 13px;
  }
  .grades li + li {
    margin-top: 2px;
  }

  .conc-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 10px;
    margin-top: 8px;
  }
  .conc {
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
  }
  .conc.complete {
    border-color: var(--done);
    background: var(--done-bg);
  }
  .conc-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .conc-done {
    font-size: 11px;
    font-weight: 700;
    color: var(--done);
  }
  .conc-progress {
    margin: 2px 0 6px;
    font-size: 12px;
    color: var(--muted);
  }
  .conc-bar {
    height: 5px;
    border-radius: 999px;
    background: var(--border);
    overflow: hidden;
  }
  .conc-bar div {
    height: 100%;
    background: var(--done);
    transition: width 0.3s;
  }







  .manual-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--unknown);
  }
  .manual-text {
    margin: 2px 0 0;
    font-size: 13px;
    color: var(--text);
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


  .assumed-tag {
    margin-left: 6px;
    font-size: 10.5px;
    font-weight: 600;
    padding: 0 6px;
    border: 1px dashed var(--done);
    border-radius: 999px;
    color: var(--done);
  }
  .chip.more {
    color: var(--muted);
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
