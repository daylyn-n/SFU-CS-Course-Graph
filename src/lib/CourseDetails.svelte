<!-- One course's calendar details: title, units, WQB/breadth designation,
     description, prerequisites with the student's status, and (given terms
     and offerings) its sections with seat snapshots. Descriptions and seats
     are fetched lazily the first time any CourseDetails mounts. -->
<script lang="ts">
  import { courseStatus } from './graph';
  import { loadDetails, designationBadges, type Details } from './details';
  import { loadSeats, seatInfo, describeSeats, formatAsOf, GOSFU_URL, type SeatData } from './seats';
  import TermPills from './TermPills.svelte';
  import { rmpUrl } from './links';
  import { addToSchedule, isInSchedule } from './schedule/store.svelte';
  import type { Courses, Offerings, Status, Taken, Term } from './types';

  interface Props {
    code: string;
    courses: Courses;
    done: Taken;
    terms?: Term[];
    offerings?: Offerings;
    /** show the course in the prerequisite map */
    onopen?: ((code: string) => void) | null;
    /** show an "Add to schedule" button */
    showAdd?: boolean;
    /** id for the heading, so a dialog can be labelled by it */
    headingId?: string;
  }

  let {
    code,
    courses,
    done,
    terms = [],
    offerings = {},
    onopen = null,
    showAdd = false,
    headingId = undefined,
  }: Props = $props();

  let details = $state<Details | null>(null); // null while loading
  let seats = $state<SeatData | null>(null);
  $effect(() => {
    let live = true;
    loadDetails().then((d) => live && (details = d));
    if (terms.length) loadSeats().then((s) => live && (seats = s));
    return () => (live = false);
  });

  const STATUS: Record<Status, string> = {
    done: 'Taken',
    ready: 'Can take now',
    locked: 'Prereqs missing',
    unknown: 'Check calendar requirements',
  };

  const course = $derived(courses[code]);
  const status = $derived(courseStatus(code, courses, done));
  const info = $derived(details?.[code]);
  const badges = $derived(designationBadges(info?.designation));
  const units = $derived(course?.units);
  const offered = $derived(terms.filter((t) => offerings[code]?.[t.id]?.length));
  // Only the sections you enrol in (lectures/seminars), not their labs.
  const runs = $derived(
    terms.map((t) => ({ term: t, sections: (offerings[code]?.[t.id] ?? []).filter((s) => s.enrol !== false) })),
  );
  const inSchedule = $derived(isInSchedule(code));
</script>

<div class="cd">
  <header>
    <h2 id={headingId}>{code}</h2>
    <p class="ctitle">{course?.title ?? "This course isn't in SFU's current calendar."}</p>
    <p class="meta">
      {#if course}<span class="st st-{status}">{STATUS[status]}</span>{/if}
      {#if units}<span>{units} units</span>{/if}
      {#if offered.length}<span class="pills"><TermPills terms={offered} /></span>{/if}
    </p>
  </header>

  {#if (showAdd && course) || onopen}
    <div class="actions">
      {#if showAdd && course}
        <button class="primary" disabled={inSchedule} onclick={() => addToSchedule(code)}>
          {inSchedule ? '✓ In schedule' : 'Add to schedule'}
        </button>
      {/if}
      {#if onopen && course}
        <button onclick={() => onopen(code)}>Open in prerequisite map →</button>
      {/if}
    </div>
  {/if}

  <section>
    <h3>Designation</h3>
    {#if details === null}
      <p class="muted loading">Loading…</p>
    {:else if !info}
      <p class="muted">Designation unavailable. Check the SFU Calendar.</p>
    {:else if badges.length}
      <ul class="badges">
        {#each badges as b (b.label)}
          <li class="badge" title={b.label}>
            <b>{b.short}</b>{#if b.short !== b.label}<span>{b.label}</span>{/if}
          </li>
        {/each}
      </ul>
    {:else}
      <p class="muted">No WQB/breadth designation</p>
    {/if}
  </section>

  <section>
    <h3>Description</h3>
    {#if details === null}
      <div class="skeleton" aria-label="Loading description" role="status">
        <span></span><span></span><span class="short"></span>
      </div>
    {:else if info?.description}
      <p class="desc">{info.description}</p>
      {#if info.notes}<p class="notes">{info.notes}</p>{/if}
    {:else}
      <p class="muted">Description unavailable.</p>
    {/if}
  </section>

  <section>
    <h3>Prerequisites</h3>
    <p class="raw">{course?.prereqText || 'No prerequisites listed.'}</p>
  </section>

  {#if terms.length}
    <section>
      <h3>When it runs</h3>
      {#each runs as { term, sections } (term.id)}
        <div class="term">
          <div class="term-name">
            {term.label}{term.current ? ' (this term)' : ''}
            {#if !sections.length}<span class="muted"> · not offered</span>{/if}
          </div>
          {#each sections as s (s.section)}
            {@const seat = seatInfo(seats, term.id, code, s.section)}
            {@const d = seat && describeSeats(seat)}
            <div class="sec">
              <div><b>{s.section}</b> {[s.campus, s.delivery].filter(Boolean).join(' · ')}</div>
              {#if s.schedule}<div class="muted">{s.schedule}</div>{/if}
              <div class="muted">
                {#each s.instructors ?? [] as name, i}{i ? ', ' : ''}<a
                    class="rmp"
                    href={rmpUrl(name)}
                    target="_blank"
                    rel="noopener"
                    title="Search Rate My Professors">{name} <small>RMP ↗</small></a
                  >{:else}Instructor TBA{/each}
              </div>
              {#if seat && d}
                <div class="seat seat-{d.level}">{d.text} · as of {formatAsOf(seat.asOf)}</div>
              {/if}
            </div>
          {/each}
        </div>
      {/each}
      {#if offered.length}
        <a class="gosfu" href={GOSFU_URL} target="_blank" rel="noopener">Check live seats in goSFU ↗</a>
      {/if}
    </section>
  {/if}
</div>

<style>
  .cd {
    --seat-full: #d4213d;
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-width: 0;
  }
  @media (prefers-color-scheme: dark) {
    .cd {
      --seat-full: #ff5c74;
    }
  }
  h2 {
    margin: 0;
    font-size: 22px;
    line-height: 1.2;
    color: var(--accent-text);
  }
  .ctitle {
    margin: 2px 0 6px;
    font-size: 15px;
    font-weight: 600;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 12px;
    margin: 0;
    font-size: 13px;
    color: var(--muted);
  }
  .pills {
    display: inline-flex;
    gap: 3px;
  }
  .st {
    font-weight: 600;
  }
  .st-done {
    color: var(--done);
  }
  .st-ready {
    color: var(--ready);
  }
  .st-locked {
    color: var(--accent-text);
  }
  .st-unknown {
    color: var(--unknown);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .actions button:disabled {
    opacity: 0.65;
    cursor: default;
  }
  .actions button.primary:disabled {
    background: var(--done-bg);
    border-color: var(--done);
    color: var(--done);
    opacity: 1;
  }

  section {
    min-width: 0;
  }
  h3 {
    margin: 0 0 6px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
  }
  .muted {
    margin: 0;
    color: var(--muted);
  }

  .badges {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 2px 9px 2px 3px;
    border: 1px solid var(--ready);
    border-radius: 999px;
    background: var(--ready-bg);
    font-size: 13px;
  }
  .badge b {
    padding: 0 6px;
    border-radius: 999px;
    background: var(--ready);
    color: var(--surface);
    font-size: 11.5px;
    line-height: 18px;
  }

  .desc {
    margin: 0;
    white-space: pre-line;
  }
  .notes {
    margin: 8px 0 0;
    font-size: 13px;
    color: var(--muted);
    white-space: pre-line;
  }
  .raw {
    margin: 0;
    padding: 10px;
    border-radius: 8px;
    background: var(--bg);
    font-size: 13px;
  }

  .skeleton {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  .skeleton span {
    height: 11px;
    border-radius: 6px;
    background: linear-gradient(90deg, var(--bg), var(--border), var(--bg));
    background-size: 200% 100%;
    animation: shimmer 1.2s linear infinite;
  }
  .skeleton .short {
    width: 60%;
  }
  @keyframes shimmer {
    to {
      background-position: -200% 0;
    }
  }

  .term {
    margin-bottom: 10px;
  }
  .term-name {
    font-weight: 600;
    margin-bottom: 4px;
  }
  .sec {
    padding: 7px 10px;
    margin-bottom: 5px;
    border-radius: 8px;
    background: var(--bg);
    font-size: 13px;
  }
  .seat {
    margin-top: 2px;
    font-weight: 600;
    font-size: 12.5px;
  }
  .seat-open {
    color: var(--done);
  }
  .seat-tight {
    color: var(--unknown);
  }
  .seat-full {
    color: var(--seat-full);
  }
  .gosfu {
    display: inline-block;
    margin-top: 2px;
    color: var(--accent-text);
    font-size: 13px;
    font-weight: 600;
    text-decoration: none;
  }
  .gosfu:hover {
    text-decoration: underline;
  }
  .rmp {
    color: var(--accent-text);
    text-decoration: none;
  }
  .rmp:hover {
    text-decoration: underline;
  }
  .rmp small {
    font-size: 10px;
    font-weight: 600;
    opacity: 0.75;
  }
</style>
