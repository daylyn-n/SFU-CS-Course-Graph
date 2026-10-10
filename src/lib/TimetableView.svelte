<!-- Weekly timetable builder: pick lecture sections for a term, see them on a
     Mon–Fri grid, spot clashes, and let auto-arrange find a clash-free set. -->
<script lang="ts">
  import type { Courses, Offerings, Section, Term } from './types';
  import {
    DAYS,
    DAY_NAMES,
    autoPick,
    describeConflict,
    findConflicts,
    formatTime,
    overlaps,
    parseSchedule,
    type Day,
    type Meeting,
    type Pick,
  } from './timetable';
  import { timetable } from './timetableStore.svelte';

  let {
    courses,
    terms,
    offerings,
    onselect,
  }: {
    courses: Courses;
    terms: Term[];
    offerings: Offerings;
    onselect?: (code: string) => void;
  } = $props();

  // Distinct hues, skipping the reds used for conflicts.
  const HUES = [212, 145, 38, 272, 186, 88, 318, 24, 236, 165, 55, 292];
  const HOUR_PX = 52;
  const WEEKDAYS: Day[] = ['Mo', 'Tu', 'We', 'Th', 'Fr'];

  const termsWithData = $derived(
    terms.filter((t) => Object.values(offerings).some((byTerm) => byTerm[t.id]?.length)),
  );
  const term = $derived(
    termsWithData.find((t) => t.id === timetable.term) ??
      termsWithData.find((t) => t.current) ??
      termsWithData[0],
  );
  const termId = $derived(term?.id ?? '');
  const sectionsFor = (code: string): Section[] => offerings[code]?.[termId] ?? [];

  const offeredCodes = $derived(Object.keys(offerings).filter((c) => offerings[c][termId]?.length).sort());
  const campuses = $derived([
    ...new Set(offeredCodes.flatMap((c) => sectionsFor(c).map((s) => s.campus)).filter(Boolean)),
  ].sort());

  interface Entry {
    code: string;
    hue: number;
    sectionName: string;
    section: Section | undefined;
    meetings: Meeting[];
    tba: boolean;
    flexible: boolean;
    errors: string[];
  }

  const entries: Entry[] = $derived(
    Object.entries(timetable.for(termId)).map(([code, sectionName], i) => {
      const section = sectionsFor(code).find((s) => s.section === sectionName);
      const parsed = parseSchedule(section?.schedule);
      return {
        code,
        hue: HUES[i % HUES.length],
        sectionName,
        section,
        meetings: parsed.flexible ? [] : parsed.meetings,
        tba: parsed.tba,
        flexible: parsed.flexible,
        errors: parsed.errors,
      };
    }),
  );

  const conflicts = $derived(
    findConflicts(entries.filter((e) => e.section).map((e): Pick => ({ code: e.code, section: e.section! }))),
  );
  const clashing = $derived(new Set(conflicts.flatMap((c) => [c.a.code, c.b.code])));
  const units = $derived(entries.reduce((sum, e) => sum + (Number(courses[e.code]?.units) || 0), 0));

  interface Block {
    entry: Entry;
    meeting: Meeting;
    conflict: boolean;
    lane: number;
    lanes: number;
  }

  // Meetings per day, with side-by-side lanes for overlapping blocks.
  const blocksByDay = $derived.by(() => {
    const out = {} as Record<Day, Block[]>;
    for (const day of DAYS) {
      const list: Block[] = entries
        .flatMap((entry) => entry.meetings.filter((m) => m.day === day).map((meeting) => ({ entry, meeting })))
        .sort((a, b) => a.meeting.start - b.meeting.start || a.meeting.end - b.meeting.end)
        .map(({ entry, meeting }, _, all) => ({
          entry,
          meeting,
          conflict: all.some((o) => o.entry.code !== entry.code && overlaps(o.meeting, meeting)),
          lane: 0,
          lanes: 1,
        }));
      // Greedy lane assignment within each cluster of overlapping blocks.
      let cluster: Block[] = [];
      let clusterEnd = -1;
      const close = () => {
        const n = Math.max(1, ...cluster.map((b) => b.lane + 1));
        for (const b of cluster) b.lanes = n;
      };
      for (const b of list) {
        if (b.meeting.start >= clusterEnd) {
          close();
          cluster = [];
        }
        const used = cluster.filter((o) => o.meeting.end > b.meeting.start).map((o) => o.lane);
        let lane = 0;
        while (used.includes(lane)) lane++;
        b.lane = lane;
        cluster.push(b);
        clusterEnd = Math.max(clusterEnd, b.meeting.end);
      }
      close();
      out[day] = list;
    }
    return out;
  });

  const days = $derived<Day[]>([
    ...WEEKDAYS,
    ...(['Sa', 'Su'] as Day[]).filter((d) => blocksByDay[d].length),
  ]);
  const allMeetings = $derived(entries.flatMap((e) => e.meetings));
  const dayStart = $derived(Math.min(8 * 60, ...allMeetings.map((m) => Math.floor(m.start / 60) * 60)));
  const dayEnd = $derived(Math.max(18 * 60, ...allMeetings.map((m) => Math.ceil(m.end / 60) * 60)));
  const hours = $derived(
    Array.from({ length: (dayEnd - dayStart) / 60 }, (_, i) => dayStart + i * 60),
  );
  const offGrid = $derived(entries.filter((e) => !e.meetings.length || e.errors.length || !e.section));

  // ---- actions ----

  let query = $state('');
  let message = $state<{ text: string; tone: 'ok' | 'warn' } | null>(null);

  function sectionLabel(s: Section) {
    return [s.section, s.campus, s.schedule || 'times TBA'].filter(Boolean).join(' · ');
  }

  /** A section for a newly added course: preferred campus, no clash if possible. */
  function bestSection(code: string): string | undefined {
    const chosen = entries.filter((e) => e.section).map((e): Pick => ({ code: e.code, section: e.section! }));
    const options = sectionsFor(code);
    const onCampus = (s: Section) => !timetable.campus || s.campus === timetable.campus;
    const free = options.filter((s) => !findConflicts([{ code, section: s }, ...chosen]).length);
    return (free.find(onCampus) ?? free[0] ?? options.find(onCampus) ?? options[0])?.section;
  }

  function addCourse(raw: string) {
    const m = raw.trim().toUpperCase().match(/^([A-Z]{2,5})\s*(\d{3}[A-Z]?)/);
    const code = m && `${m[1]} ${m[2]}`;
    if (!code) return;
    if (!sectionsFor(code).length) {
      message = { text: `${code} has no lecture sections listed for ${term?.label}.`, tone: 'warn' };
      return;
    }
    if (timetable.sectionOf(termId, code)) {
      message = { text: `${code} is already in your timetable.`, tone: 'warn' };
    } else {
      const section = bestSection(code);
      if (section) timetable.set(termId, code, section);
      message = null;
    }
    query = '';
  }

  function arrange() {
    const current = timetable.for(termId);
    const codes = Object.keys(current);
    if (!codes.length) return;
    const r = autoPick(codes, sectionsFor, { campus: timetable.campus || undefined, current });
    if (!r.ok) {
      message = {
        text: 'No clash-free combination of lecture sections exists for these courses. Try removing one.',
        tone: 'warn',
      };
      return;
    }
    const changed = codes.filter((c) => r.picks[c] && r.picks[c] !== current[c]).length;
    timetable.replace(termId, r.picks);
    message = {
      text:
        (changed ? `Switched ${changed} section${changed === 1 ? '' : 's'}. ` : 'Already the best fit. ') +
        'No clashes.' +
        (r.offCampus ? ` ${r.offCampus} course${r.offCampus === 1 ? ' is' : 's are'} only clash-free off ${timetable.campus}.` : ''),
      tone: 'ok',
    };
  }

  const top = (min: number) => ((min - dayStart) / 60) * HOUR_PX;
  const fmtRange = (m: Meeting) => `${formatTime(m.start)}–${formatTime(m.end)}`;
</script>

<div class="tt">
  {#if !term}
    <p class="empty">No section data is loaded for any term yet. Run <code>npm run fetch-offerings</code>.</p>
  {:else}
    <div class="toolbar">
      <div class="seg" role="group" aria-label="Term">
        {#each termsWithData as t (t.id)}
          <button class:on={t.id === termId} onclick={() => timetable.setTerm(t.id)}>{t.label}</button>
        {/each}
      </div>

      <form
        class="add"
        onsubmit={(e) => {
          e.preventDefault();
          addCourse(query);
        }}
      >
        <input
          list="tt-courses"
          placeholder="Add a course, e.g. CMPT 225"
          aria-label="Course to add to the timetable"
          bind:value={query}
          oninput={() => offeredCodes.includes(query.split(' — ')[0]) && addCourse(query)}
        />
        <datalist id="tt-courses">
          {#each offeredCodes as code (code)}
            <option value="{code} — {courses[code]?.title ?? ''}"></option>
          {/each}
        </datalist>
        <button type="submit">Add</button>
      </form>

      <label class="campus">
        Prefer
        <select value={timetable.campus} onchange={(e) => timetable.setCampus(e.currentTarget.value)}>
          <option value="">Any campus</option>
          {#each campuses as c (c)}<option value={c}>{c}</option>{/each}
        </select>
      </label>

      <button class="primary" onclick={arrange} disabled={!entries.length}>Auto-arrange</button>
      {#if entries.length}
        <button class="ghost" onclick={() => timetable.clear(termId)}>Clear</button>
      {/if}

      <div class="units"><b>{units}</b> units · {entries.length} course{entries.length === 1 ? '' : 's'}</div>
    </div>

    {#if message}
      <p class="message {message.tone}" role="status">{message.text}</p>
    {/if}

    {#if conflicts.length}
      <div class="conflicts" role="alert">
        <b>{conflicts.length} time conflict{conflicts.length === 1 ? '' : 's'}</b>
        <ul>
          {#each conflicts as c, i (i)}<li>{describeConflict(c)}</li>{/each}
        </ul>
        <span>Pick another section below, or try <b>Auto-arrange</b>.</span>
      </div>
    {/if}

    {#if entries.length}
      <ul class="cards">
        {#each entries as e (e.code)}
          <li class="card" class:conflict={clashing.has(e.code)} style:--h={e.hue}>
            <div class="card-head">
              <button class="code" onclick={() => onselect?.(e.code)} title="Show in side panel">{e.code}</button>
              <span class="title">{courses[e.code]?.title ?? ''}</span>
              <button class="remove" onclick={() => timetable.remove(termId, e.code)} aria-label="Remove {e.code}"
                >×</button
              >
            </div>
            <select
              value={e.sectionName}
              onchange={(ev) => timetable.set(termId, e.code, ev.currentTarget.value)}
              aria-label="Section of {e.code}"
            >
              {#if !e.section}<option value={e.sectionName}>{e.sectionName} (no longer listed)</option>{/if}
              {#each sectionsFor(e.code) as s (s.section)}
                <option value={s.section}>{sectionLabel(s)}</option>
              {/each}
            </select>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="empty">
        Add courses with the box above, or with <b>+ Timetable</b> next to a section in the side panel. Lecture
        sections only; labs and tutorials aren't in the data.
      </p>
    {/if}

    <!-- Desktop: week grid -->
    <div class="grid" style:--cols={days.length} style:--hour="{HOUR_PX}px">
      <div class="corner"></div>
      {#each days as d (d)}<div class="day-head">{DAY_NAMES[d].slice(0, 3)}</div>{/each}

      <div class="axis" style:height="{hours.length * HOUR_PX}px">
        {#each hours as h (h)}<span style:top="{top(h)}px">{formatTime(h)}</span>{/each}
      </div>
      {#each days as d (d)}
        <div class="col" style:height="{hours.length * HOUR_PX}px">
          {#each blocksByDay[d] as b, i (i)}
            <button
              class="block"
              class:conflict={b.conflict}
              class:short={b.meeting.end - b.meeting.start < 60}
              style:--h={b.entry.hue}
              style:top="{top(b.meeting.start)}px"
              style:height="{((b.meeting.end - b.meeting.start) / 60) * HOUR_PX}px"
              style:left="calc({(b.lane / b.lanes) * 100}% + 2px)"
              style:width="calc({100 / b.lanes}% - 4px)"
              onclick={() => onselect?.(b.entry.code)}
              title="{b.entry.code} {b.entry.sectionName} · {fmtRange(b.meeting)}{b.conflict ? ' · conflict' : ''}"
            >
              <b>{b.entry.code}</b>
              <span>{b.entry.sectionName}{b.entry.section?.campus ? ` · ${b.entry.section.campus}` : ''}</span>
              <span class="time">{fmtRange(b.meeting)}</span>
            </button>
          {/each}
        </div>
      {/each}
    </div>

    <!-- Phone: one list per day -->
    <div class="daylist">
      {#each days as d (d)}
        <section>
          <h4>{DAY_NAMES[d]}</h4>
          {#each blocksByDay[d] as b, i (i)}
            <button class="row" class:conflict={b.conflict} style:--h={b.entry.hue} onclick={() => onselect?.(b.entry.code)}>
              <span class="time">{fmtRange(b.meeting)}</span>
              <b>{b.entry.code}</b>
              <span>{b.entry.sectionName}{b.entry.section?.campus ? ` · ${b.entry.section.campus}` : ''}</span>
              {#if b.conflict}<span class="flag">Conflict</span>{/if}
            </button>
          {:else}
            <p class="free">No classes</p>
          {/each}
        </section>
      {/each}
    </div>

    {#if offGrid.length}
      <div class="offgrid">
        <h4>Not on the grid</h4>
        <ul>
          {#each offGrid as e (e.code)}
            <li style:--h={e.hue}>
              <b>{e.code} {e.sectionName}</b>
              {#if !e.section}
                no longer listed for {term.label}
              {:else if e.flexible}
                flexible / full-time placement ({e.section.schedule})
              {:else if e.tba}
                meeting times not published yet
              {/if}
              {#if e.errors.length}
                <span class="warn">couldn't read “{e.errors.join(', ')}”</span>
              {/if}
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  {/if}
</div>

<style>
  .tt {
    --conflict: #c62828;
    --conflict-bg: #fdecec;
    position: absolute;
    inset: 0;
    overflow: auto;
    padding: 16px;
  }
  @media (prefers-color-scheme: dark) {
    .tt {
      --conflict: #ff6b6b;
      --conflict-bg: #3a1c1e;
    }
  }

  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
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
    padding: 4px 12px;
    background: transparent;
    font-weight: 600;
  }
  .seg button.on {
    background: var(--sfu-red);
    color: #fff;
  }
  .add {
    display: flex;
    flex: 1 1 220px;
    max-width: 340px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface);
    padding: 3px 3px 3px 12px;
  }
  .add:focus-within {
    border-color: var(--accent);
  }
  .add input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
  }
  .add button {
    border-radius: 999px;
    padding: 3px 12px;
  }
  .campus {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--muted);
    font-size: 13px;
  }
  .primary:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .ghost {
    background: transparent;
  }
  .units {
    margin-left: auto;
    color: var(--muted);
  }
  .units b {
    color: var(--text);
    font-size: 16px;
  }

  .message {
    margin: 10px 0 0;
    padding: 6px 10px;
    border-radius: 8px;
    font-size: 13px;
  }
  .message.ok {
    background: var(--done-bg);
    color: var(--done);
  }
  .message.warn {
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--muted);
  }

  .conflicts {
    margin-top: 10px;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid var(--conflict);
    background: var(--conflict-bg);
    color: var(--conflict);
    font-size: 13px;
  }
  .conflicts ul {
    margin: 4px 0;
    padding-left: 18px;
  }

  .cards {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 12px 0;
    padding: 0;
    list-style: none;
  }
  .card {
    flex: 0 1 260px;
    min-width: 0;
    padding: 8px 10px;
    border-radius: 10px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-left: 4px solid hsl(var(--h) 55% 48%);
  }
  .card.conflict {
    border-color: var(--conflict);
    border-left-color: var(--conflict);
  }
  .card-head {
    display: flex;
    align-items: baseline;
    gap: 6px;
    margin-bottom: 6px;
  }
  .card .code {
    border: none;
    background: none;
    padding: 0;
    font-weight: 700;
    white-space: nowrap;
    color: var(--accent-text);
  }
  .card .title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: 12.5px;
    color: var(--muted);
  }
  .remove {
    border: none;
    background: none;
    padding: 0 4px;
    font-size: 16px;
    line-height: 1;
    color: var(--muted);
  }
  .remove:hover {
    color: var(--conflict);
  }
  .card select {
    width: 100%;
    font-size: 12.5px;
    padding: 4px 6px;
  }

  .empty {
    color: var(--muted);
    margin: 14px 0;
  }

  /* week grid */
  .grid {
    display: grid;
    grid-template-columns: 48px repeat(var(--cols), minmax(90px, 1fr));
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    overflow: hidden;
  }
  .corner,
  .day-head {
    padding: 6px;
    border-bottom: 1px solid var(--border);
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
    text-align: center;
  }
  .axis,
  .col {
    position: relative;
    background-image: linear-gradient(to bottom, var(--border) 1px, transparent 1px);
    background-size: 100% var(--hour);
  }
  .col {
    border-left: 1px solid var(--border);
  }
  .axis span {
    position: absolute;
    right: 6px;
    transform: translateY(2px);
    font-size: 11px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .block {
    position: absolute;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0;
    overflow: hidden;
    padding: 3px 6px;
    border: none;
    border-left: 4px solid hsl(var(--h) 55% 45%);
    border-radius: 6px;
    background: hsl(var(--h) 75% 93%);
    color: hsl(var(--h) 55% 20%);
    font-size: 11.5px;
    line-height: 1.25;
    text-align: left;
    transition: transform 0.1s, box-shadow 0.15s;
  }
  .block:hover {
    box-shadow: 0 2px 8px rgb(0 0 0 / 0.15);
    z-index: 1;
  }
  .block b {
    font-size: 12.5px;
  }
  .block .time {
    opacity: 0.75;
    font-variant-numeric: tabular-nums;
  }
  .block.short .time {
    display: none;
  }
  .block.conflict {
    border-left-color: var(--conflict);
    outline: 2px solid var(--conflict);
    outline-offset: -2px;
    background-image: repeating-linear-gradient(
      -45deg,
      transparent 0 6px,
      color-mix(in srgb, var(--conflict) 16%, transparent) 6px 12px
    );
  }

  /* per-day list (phones) */
  .daylist {
    display: none;
  }
  .daylist section {
    margin-bottom: 12px;
  }
  .daylist h4,
  .offgrid h4 {
    margin: 0 0 6px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 2px 10px;
    width: 100%;
    margin-bottom: 4px;
    text-align: left;
    border-left: 4px solid hsl(var(--h) 55% 45%);
    background: hsl(var(--h) 75% 95%);
    color: hsl(var(--h) 55% 20%);
  }
  .row .time {
    min-width: 90px;
    font-variant-numeric: tabular-nums;
  }
  .row.conflict {
    border-color: var(--conflict);
  }
  .flag {
    margin-left: auto;
    color: var(--conflict);
    font-weight: 700;
    font-size: 12px;
  }
  .free {
    margin: 0;
    font-size: 13px;
    color: var(--muted);
  }

  .offgrid {
    margin-top: 14px;
    font-size: 13px;
  }
  .offgrid ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .offgrid li {
    padding: 4px 8px;
    margin-bottom: 4px;
    border-left: 4px solid hsl(var(--h) 55% 45%);
    border-radius: 4px;
    background: var(--surface);
    color: var(--muted);
  }
  .offgrid li b {
    color: var(--text);
    margin-right: 4px;
  }
  .warn {
    color: var(--conflict);
  }

  @media (prefers-color-scheme: dark) {
    .block,
    .row {
      background-color: hsl(var(--h) 32% 21%);
      color: hsl(var(--h) 70% 88%);
      border-left-color: hsl(var(--h) 60% 62%);
    }
    .card {
      border-left-color: hsl(var(--h) 60% 62%);
    }
    .offgrid li {
      border-left-color: hsl(var(--h) 60% 62%);
    }
    .block.conflict,
    .row.conflict {
      border-left-color: var(--conflict);
    }
  }

  @media (max-width: 700px) {
    .tt {
      padding: 12px 16px;
    }
    .grid {
      display: none;
    }
    .daylist {
      display: block;
    }
    .add {
      max-width: none;
      flex-basis: 100%;
    }
    .units {
      margin-left: 0;
    }
  }
</style>
