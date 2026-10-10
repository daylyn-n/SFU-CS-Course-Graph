<!-- Term-by-term plan for reaching the target course from what's taken. -->
<script lang="ts">
  import { courseStatus } from './graph';
  import { planCourses } from './planner';
  import type { Courses, Offerings, Taken, Term } from './types';

  let {
    target,
    courses,
    done,
    terms,
    offerings,
    selected,
    onselect,
  }: {
    target: string;
    courses: Courses;
    done: Taken;
    terms: Term[];
    offerings: Offerings;
    selected: string;
    onselect: (code: string) => void;
  } = $props();

  const STORAGE_KEY = 'sfu-prereqs:per-term';
  const LOADS = [2, 3, 4, 5, 6];

  function loadPerTerm(): number {
    try {
      const n = Number(localStorage.getItem(STORAGE_KEY));
      return LOADS.includes(n) ? n : 4;
    } catch {
      return 4;
    }
  }

  let perTerm = $state(loadPerTerm());
  $effect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(perTerm));
    } catch {}
  });

  const plan = $derived(planCourses(target, courses, done, { terms, offerings, maxPerTerm: perTerm }));
  const unconfirmed = $derived(plan.terms.some((t) => t.courses.some((c) => !c.confirmed)));
  const anyUnknown = $derived(
    plan.terms.some((t) => t.courses.some((c) => courseStatus(c.code, courses, done) === 'unknown')),
  );
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
</script>

<div class="plan">
  <div class="bar">
    <div class="summary">
      <div class="eyebrow">Semester plan</div>
      {#if plan.alreadyTaken}
        <h2>You've already taken {target}</h2>
      {:else}
        <h2>{target} in {plural(plan.terms.length, 'term')}</h2>
        <p class="muted">
          {plural(plan.courseCount, 'course')} · {plan.totalUnits} units · starting {plan.terms[0]?.label}
        </p>
      {/if}
    </div>
    <div class="load" role="group" aria-label="Courses per term">
      <span class="label">Per term</span>
      <div class="seg">
        {#each LOADS as n}
          <button class:on={perTerm === n} aria-pressed={perTerm === n} onclick={() => (perTerm = n)}>{n}</button>
        {/each}
      </div>
    </div>
  </div>

  {#if !plan.alreadyTaken}
    <ol class="terms">
      {#each plan.terms as term, i (term.id)}
        <li class="card" class:unknown={!term.known}>
          <div class="term-head">
            <span class="step">{i + 1}</span>
            <span class="term-label">{term.label}</span>
            <span class="units">
              {#if term.courses.length}{term.courses.reduce((s, c) => s + (c.units ?? 0), 0)} units{/if}
            </span>
          </div>
          {#if !term.known}
            <div class="note">Offerings not published yet</div>
          {/if}
          {#each term.courses as c (c.code)}
            <button
              class="course {courseStatus(c.code, courses, done)}"
              class:is-target={c.isTarget}
              class:missing={c.missing}
              class:on={c.code === selected}
              title={c.confirmed ? c.title : `${c.title} — not confirmed to run this term`}
              onclick={() => onselect(c.code)}
            >
              <span class="code">
                {c.code}
                {#if !c.confirmed}<span class="unconfirmed" aria-label="unconfirmed offering">?</span>{/if}
              </span>
              <span class="title">{c.title}</span>
            </button>
          {:else}
            <p class="empty">Nothing on the path runs this term.</p>
          {/each}
        </li>
      {/each}
    </ol>

    <div class="key">
      <span><i class="ready"></i>Can take now</span>
      {#if anyUnknown}<span><i class="unknown"></i>Check requirements</span>{/if}
      <span><i class="locked"></i>After earlier terms</span>
      {#if unconfirmed}<span><span class="unconfirmed">?</span>Unconfirmed offering</span>{/if}
      {#if plan.missing.length}<span><i class="missing"></i>Not in data</span>{/if}
    </div>

    {#if plan.missing.length || plan.cycles.length}
      <div class="warnings">
        {#if plan.missing.length}
          <p>
            {plan.missing.join(', ')}
            {plan.missing.length === 1 ? "isn't" : "aren't"} in the loaded data, so
            {plan.missing.length === 1 ? 'its' : 'their'} prerequisites aren't planned.
          </p>
        {/if}
        {#if plan.cycles.length}
          <p>The prerequisites of {plan.cycles.join(', ')} loop back on themselves; the loop was ignored.</p>
        {/if}
      </div>
    {/if}

    <p class="fine">
      Picks the fewest courses for each "one of" and fills terms in order. Terms after
      {terms.at(-1)?.label ?? 'the published ones'} have no schedule yet, so check the calendar before
      enrolling.
    </p>
  {/if}
</div>

<style>
  .plan {
    max-width: 1200px;
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px 24px;
    margin-bottom: 16px;
  }
  .eyebrow {
    font-size: 12px;
    color: var(--accent-text);
    font-weight: 600;
  }
  h2 {
    margin: 2px 0 0;
    font-size: 22px;
    line-height: 1.2;
  }
  .summary .muted {
    margin-top: 2px;
  }

  .load {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .label {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
  }
  .seg {
    display: flex;
    padding: 3px;
    border-radius: 999px;
    background: var(--surface);
    border: 1px solid var(--border);
  }
  .seg button {
    border: none;
    border-radius: 999px;
    min-width: 32px;
    padding: 3px 10px;
    background: transparent;
    font-weight: 600;
  }
  .seg button.on {
    background: var(--sfu-red);
    color: #fff;
  }

  .terms {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
    gap: 12px;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px;
    border-radius: 10px;
    background: var(--surface);
    border: 1px solid var(--border);
  }
  .card.unknown {
    border-style: dashed;
    background: transparent;
  }
  .term-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .step {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    flex-shrink: 0;
    border-radius: 50%;
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--muted);
    font-size: 11px;
    font-weight: 700;
  }
  .term-label {
    flex: 1;
    font-weight: 700;
  }
  .units {
    font-size: 12px;
    color: var(--muted);
  }
  .note {
    font-size: 11px;
    color: var(--muted);
    margin-top: -4px;
  }

  .course {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    width: 100%;
    min-width: 0;
    padding: 6px 10px;
    border-radius: 8px;
    border: 1.5px solid var(--locked-border);
    background: var(--locked-bg);
    text-align: left;
  }
  .course.ready {
    border-color: var(--ready);
    background: var(--ready-bg);
  }
  .course.unknown {
    border-color: var(--unknown);
    background: var(--unknown-bg);
  }
  .course.is-target {
    border-color: var(--accent);
  }
  .course.missing {
    border-style: dashed;
    opacity: 0.75;
  }
  .course:hover {
    border-color: var(--accent);
  }
  .course.on {
    box-shadow: 0 0 0 3px var(--accent);
  }
  .course:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .code {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 700;
  }
  .title {
    max-width: 100%;
    font-size: 11px;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .unconfirmed {
    display: inline-grid;
    place-items: center;
    width: 15px;
    height: 15px;
    border-radius: 50%;
    border: 1px dashed var(--term);
    color: var(--term);
    font-size: 10px;
    font-weight: 700;
  }
  .empty {
    margin: 0;
    font-size: 12px;
    color: var(--muted);
  }

  .key {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    margin-top: 14px;
    font-size: 12px;
    color: var(--muted);
  }
  .key > span {
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .key i {
    width: 12px;
    height: 12px;
    border-radius: 3px;
    border: 1.5px solid var(--locked-border);
    background: var(--locked-bg);
  }
  .key i.ready {
    border-color: var(--ready);
    background: var(--ready-bg);
  }
  .key i.unknown {
    border-color: var(--unknown);
    background: var(--unknown-bg);
  }
  .key i.missing {
    border-style: dashed;
  }

  .warnings {
    margin-top: 12px;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent);
    background: var(--surface);
    font-size: 13px;
  }
  .warnings p {
    margin: 2px 0;
  }
  .fine {
    margin: 12px 0 0;
    font-size: 11px;
    color: var(--muted);
  }

  @media (max-width: 700px) {
    .terms {
      grid-template-columns: 1fr;
    }
    h2 {
      font-size: 19px;
    }
  }
</style>
