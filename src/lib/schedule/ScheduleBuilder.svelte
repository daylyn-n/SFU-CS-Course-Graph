<!-- Schedule builder: three saved timetables with section pickers, a week
     grid, conflict checks and auto-arrange. With `docked`, it lays out for a
     short, wide drawer (about 300–520px tall) under the map: one toolbar, the
     week on the left and a compact course list on the right, each scrolling
     on its own. Narrower than 640px, docked falls back to the stacked layout. -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { courseStatus } from '../graph';
  import CourseSearch from './CourseSearch.svelte';
  import WeekGrid from './WeekGrid.svelte';
  import DetailsDialog from './DetailsDialog.svelte';
  import { seatSummary, seatLabel } from './seatText';
  import { loadSeats, GOSFU_URL, type SeatData } from '../seats';
  import type { Courses, Offerings, Section, Taken, Term } from '../types';
  import {
    arrange,
    componentGroups,
    enrolOptions,
    examClashes,
    findConflicts,
    fmtMin,
    gridRange,
    isEnrol,
    meetings,
    overlaps,
    resolvePicks,
    typeOf,
    DAY_NAMES,
    type GridEvent,
    type Meeting,
  } from './schedule';
  import {
    scheduleState,
    scheduleNotice,
    setScheduleData,
    addToSchedule,
    isInSchedule,
    removeCourse,
    setPicks,
    setTerm,
    renameSlot,
    clearSlot,
    duplicateSlot,
    notify,
  } from './store.svelte';

  interface Props {
    courses: Courses;
    terms: Term[];
    offerings: Offerings;
    done: Taken;
    /** show a course's prerequisites */
    onopen: (code: string) => void;
    docked?: boolean;
  }

  let { courses, terms, offerings, done, onopen, docked = false }: Props = $props();
  untrack(() => setScheduleData({ terms, offerings }));

  // Docked layout only when there's room for the grid and list side by side.
  let width = $state(0);
  const compact = $derived(docked && (width ? width >= 640 : !matchMedia('(max-width: 700px)').matches));

  // Seat snapshots (seats.json may be missing; then only the goSFU link shows).
  let seats = $state<SeatData | null>(null);
  $effect(() => {
    let live = true;
    loadSeats().then((s) => live && (seats = s));
    return () => (live = false);
  });

  // Course details modal.
  let detailsCode = $state<string | null>(null);
  let detailsReturn = $state<HTMLElement | null>(null);
  function openDetails(code: string, returnTo: HTMLElement | null = null) {
    detailsReturn = returnTo;
    detailsCode = code;
  }

  // Course colours: oklch hues, so light and dark variants come from one number.
  const HUES = [255, 150, 75, 310, 195, 355, 110, 40];

  const slot = $derived(scheduleState.slots[scheduleState.active]);
  const fallbackTerm = $derived((terms.find((t) => t.current) ?? terms[0])?.id);
  // slot.term is a string whenever it matches a term.
  const term = $derived((terms.some((t) => t.id === slot.term) ? slot.term : fallbackTerm) as string | undefined);
  const termLabel = (id: string | undefined) => terms.find((t) => t.id === id)?.label ?? id;

  const rows = $derived(
    slot.courses.map((c, i) => {
      const sections = (term && offerings[c.code]?.[term]) || [];
      return {
        code: c.code,
        picks: c.picks,
        sections,
        ...resolvePicks(sections, c.picks),
        hue: HUES[i % HUES.length],
        offered: enrolOptions(sections).length > 0,
        elsewhere: terms.filter((t) => t.id !== term && offerings[c.code]?.[t.id]?.length),
        status: courseStatus(c.code, courses, done),
        units: parseFloat(courses[c.code]?.units ?? '') || 0,
      };
    }),
  );
  const picked = $derived(
    rows.flatMap((r) => r.chosen.map((section) => ({ code: r.code, section, hue: r.hue }))),
  );
  const conflicts = $derived(findConflicts(picked));
  const exams = $derived(examClashes(picked));
  const events: GridEvent[] = $derived(
    picked.flatMap((p) =>
      meetings(p.section).map((m) => ({
        ...m,
        key: `${p.code}|${p.section.section}|${m.day}|${m.start}`,
        code: p.code,
        section: p.section.section,
        type: typeOf(p.section),
        hue: p.hue,
      })),
    ),
  );
  const range = $derived(gridRange(events));
  const units = $derived(rows.reduce((n, r) => n + r.units, 0));
  const campusDays = $derived(new Set(events.map((e) => e.day)).size);
  const offGrid = $derived(rows.filter((r) => r.chosen.length && r.chosen.every((s) => !meetings(s).length)));
  const locked = $derived(rows.filter((r) => r.status === 'locked'));
  const taken = $derived(rows.filter((r) => r.status === 'done'));
  const clashCodes = $derived(new Set(conflicts.flatMap((c) => [c.a.code, c.b.code])));
  const anyOffered = $derived(rows.some((r) => r.offered));

  // Fill in sections for courses with incomplete picks: ones added from the
  // map before this tab opened, or saved against older data.
  $effect(() => {
    const s = slot;
    const t = term;
    untrack(() => {
      if (s.term !== t) s.term = t ?? null;
      const current = rows; // snapshot: `rows` recomputes after each write
      if (!current.some((r) => r.offered && !r.complete)) return;
      const result = arrange(
        current.map((r) => ({ code: r.code, sections: r.sections, picks: r.picks, fixed: r.complete })),
        { maxNodes: 20000 },
      );
      current.forEach((r, i) => r.offered && !r.complete && setPicks(r.code, result.picks[i]));
    });
  });

  // Notices fade after a few seconds.
  let noticeShown = $state(false);
  $effect(() => {
    if (!scheduleNotice.id) return;
    noticeShown = true;
    const timer = setTimeout(() => (noticeShown = false), 6000);
    return () => clearTimeout(timer);
  });

  // ---- Section pickers ----

  // Meetings of everything picked except `code`'s sections other than `keep`.
  type Row = (typeof rows)[number];

  function othersExcept(code: string, keep: Section[] = []): Meeting[] {
    return picked.filter((p) => p.code !== code || keep.includes(p.section)).flatMap((p) => meetings(p.section));
  }
  const clashes = (s: Section, others: Meeting[]) => meetings(s).some((m) => others.some((o) => overlaps(m, o)));

  function timesOf(s: Section): string {
    const ms = meetings(s);
    if (!ms.length) return s.delivery === 'Online' ? 'Online' : 'No set times';
    const parts = new Map<string, string[]>();
    for (const m of ms) {
      const t = `${fmtMin(m.start)}–${fmtMin(m.end)}`;
      parts.set(t, [...(parts.get(t) ?? []), m.day]);
    }
    return [...parts].map(([t, days]) => `${days.join(' ')} ${t}`).join(', ');
  }

  function label(s: Section, others: Meeting[] | null, code: string): string {
    const who = s.instructors?.length ? s.instructors.join(', ') : '';
    const where = s.delivery === 'Online' ? '' : s.campus;
    const seat = seatLabel(seats, term, code, s.section);
    const bits = [`${s.section} ${typeOf(s)}`, timesOf(s), who, where, seat].filter(Boolean);
    return (others && clashes(s, others) ? '⚠ ' : '') + bits.join(' · ');
  }

  // Choosing a lecture re-picks its labs/tutorials to avoid clashes.
  function pickEnrol(row: Row, sectionName: string) {
    const sec = row.sections.find((s) => isEnrol(s) && s.section === sectionName);
    if (!sec) return;
    const items = rows.map((r) =>
      r === row
        ? {
            code: r.code,
            sections: r.sections.filter((s) => !isEnrol(s) || s === sec),
            picks: { ...r.picks, [typeOf(sec)]: sec.section },
          }
        : { code: r.code, sections: r.sections, picks: r.picks, fixed: true },
    );
    const i = rows.indexOf(row);
    setPicks(row.code, arrange(items, { maxNodes: 20000 }).picks[i]);
  }

  function pickComponent(row: Row, key: string, sectionName: string) {
    const picks = { ...row.picks };
    if (sectionName) picks[key] = sectionName;
    else delete picks[key];
    setPicks(row.code, picks);
  }

  // ---- Auto-arrange ----

  let keepPicks = $state(true);
  let arrangeMsg = $state<{ ok: boolean; text: string } | null>(null);
  $effect(() => {
    scheduleState.active;
    term;
    arrangeMsg = null;
  });
  // The docked toolbar has no room for a lasting message, so it fades there.
  $effect(() => {
    if (!arrangeMsg || !compact) return;
    const timer = setTimeout(() => (arrangeMsg = null), 7000);
    return () => clearTimeout(timer);
  });

  function autoArrange() {
    const result = arrange(
      rows.map((r) => ({ code: r.code, sections: r.sections, picks: keepPicks ? r.picks : {} })),
      { maxNodes: 150000 },
    );
    const current = rows;
    current.forEach((r, i) => setPicks(r.code, result.picks[i]));
    const details = `${plural(result.early, 'early/late meeting')}, ${plural(result.days, 'day')} on campus`;
    const capped = result.exhaustive ? '' : ' (search capped, so this is the best found)';
    arrangeMsg =
      result.conflicts === 0
        ? {
            ok: true,
            text: `Conflict-free${keepPicks ? (result.changes ? `, changed ${plural(result.changes, 'pick')}` : ', kept your picks') : ''}: ${details}${capped}.`,
          }
        : {
            ok: false,
            text: `No conflict-free combination exists. This one has the fewest overlaps (${result.conflicts})${capped}.`,
          };
  }

  // ---- Slots ----

  let editing = $state(-1);
  let draftName = $state('');

  function startRename(i: number) {
    editing = i;
    draftName = scheduleState.slots[i].name;
  }
  function commitRename() {
    if (editing !== -1) renameSlot(editing, draftName);
    editing = -1;
  }

  function duplicateTo(to: number) {
    const target = scheduleState.slots[to];
    if (target.courses.length && !confirm(`Replace “${target.name}” with a copy of “${slot.name}”?`)) return;
    duplicateSlot(scheduleState.active, to);
    notify(`Copied into ${scheduleState.slots[to].name}`);
  }

  function clearActive() {
    if (slot.courses.length && !confirm(`Remove all courses from “${slot.name}”?`)) return;
    clearSlot(scheduleState.active);
  }

  const focusName = (el: HTMLInputElement) => {
    el.focus();
    el.select();
  };

  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const conflictText = (c: (typeof conflicts)[number]) =>
    `${c.a.code} ${c.a.section.section} × ${c.b.code} ${c.b.section.section} (${c.day} ${fmtMin(c.start)})`;
</script>

{#snippet slotTabs()}
  <div class="slots" role="tablist" aria-label="Saved schedules">
    {#each scheduleState.slots as s, i (i)}
      {#if editing === i}
        <input
          class="slot-name"
          bind:value={draftName}
          maxlength="40"
          aria-label="Schedule name"
          use:focusName
          onblur={commitRename}
          onkeydown={(e) => {
            if (e.key === 'Enter') commitRename();
            if (e.key === 'Escape') editing = -1;
          }}
        />
      {:else}
        <button
          class="slot"
          class:on={scheduleState.active === i}
          role="tab"
          aria-selected={scheduleState.active === i}
          onclick={() => (scheduleState.active === i ? startRename(i) : (scheduleState.active = i))}
          ondblclick={() => startRename(i)}
          title={scheduleState.active === i ? 'Click to rename' : `Switch to ${s.name}`}
        >
          <span class="slot-label">{s.name}</span>
          <span class="count">{s.courses.length}</span>
          {#if scheduleState.active === i}
            <svg class="pencil" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z" /></svg>
          {/if}
        </button>
      {/if}
    {/each}
  </div>
{/snippet}

{#snippet termSwitch()}
  <div class="terms" role="group" aria-label="Term">
    {#each terms as t (t.id)}
      <button class:on={t.id === term} aria-pressed={t.id === term} onclick={() => setTerm(t.id)}>{t.label}</button>
    {/each}
  </div>
{/snippet}

{#snippet search()}
  <CourseSearch
    {courses}
    {offerings}
    {terms}
    {term}
    compact={compact}
    inSchedule={isInSchedule}
    onadd={addToSchedule}
    ondetails={openDetails}
  />
{/snippet}

{#snippet arrangeIcon()}
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h11M4 12h7M4 17h13M18 4l2 3-2 3M14 9l2 3-2 3" /></svg>
{/snippet}

<!-- Picker label + select for a course's enrolment section and components. -->
{#snippet pickers(row: Row, others: Meeting[], small: boolean)}
  <label>
    <span>{row.enrol ? typeOf(row.enrol) : 'Section'}</span>
    <select
      value={row.enrol?.section ?? ''}
      aria-label={small ? `${row.code} ${row.enrol ? typeOf(row.enrol) : 'section'}` : undefined}
      onchange={(e) => pickEnrol(row, e.currentTarget.value)}
    >
      {#if !row.enrol}<option value="" disabled>Choose a section</option>{/if}
      {#each enrolOptions(row.sections) as s (s.section)}
        <option value={s.section}>{label(s, others, row.code)}</option>
      {/each}
    </select>
  </label>
  {#each row.groups as g (g.key)}
    {@const mine = othersExcept(row.code, row.chosen.filter((s) => s !== g.pick))}
    <label>
      <span>{g.type}{g.required ? '' : '?'}</span>
      <select
        value={g.pick?.section ?? ''}
        aria-label={small ? `${row.code} ${g.type}${g.required ? '' : ' (optional)'}` : undefined}
        onchange={(e) => pickComponent(row, g.key, e.currentTarget.value)}
      >
        {#if g.required}
          {#if !g.pick}<option value="" disabled>Choose a {g.type.toLowerCase()}</option>{/if}
        {:else}
          <option value="">None (optional)</option>
        {/if}
        {#each g.options as s (s.section)}
          <option value={s.section}>{label(s, mine, row.code)}</option>
        {/each}
      </select>
    </label>
  {/each}
{/snippet}

{#snippet seatLine(row: Row)}
  {@const sum = seatSummary(seats, term, row.code, row.chosen)}
  {#if sum}
    <p class="seats">
      {#each sum.items as it (it.section)}
        <span class="seat seat-{it.level}"><b>{it.section}</b> {it.text}</span>
      {/each}
      {#if sum.asOf}<span class="asof">as of {sum.asOf}</span>{/if}
    </p>
  {/if}
{/snippet}

<div class="sched" class:docked class:compact bind:clientWidth={width}>
  {#if compact}
    <!-- Docked: toolbar, then week grid | course list, then a one-line summary. -->
    <div class="dbar">
      {@render slotTabs()}
      {@render termSwitch()}
      <div class="dsearch">{@render search()}</div>
      <button class="primary darrange" onclick={autoArrange} disabled={!anyOffered} title="Pick sections with no clashes, keeping your picks where possible">
        {@render arrangeIcon()} Auto-arrange
      </button>
    </div>

    <div class="dbody">
      <div class="dgrid">
        <WeekGrid {events} {range} fit onpick={(code) => openDetails(code)} />
        {#if !events.length}
          <div class="grid-empty">
            {rows.length ? 'No scheduled meeting times yet.' : `Search above to add ${termLabel(term)} courses.`}
          </div>
        {/if}
      </div>

      <ul class="dlist" aria-label="Courses in {slot.name}">
        {#each rows as row (row.code)}
          {@const others = othersExcept(row.code)}
          <li class="drow" style:--h={row.hue}>
            <div class="dhead">
              <button class="dcode" onclick={() => openDetails(row.code)} title="{courses[row.code]?.title ?? row.code}: details">
                {row.code}
              </button>
              {#if clashCodes.has(row.code)}
                <span class="dflag clash" title="Overlaps another class">⚠ Conflict</span>
              {/if}
              {#if row.status === 'locked'}
                <span class="dflag warn" title="Prerequisites not met yet">Prereqs</span>
              {:else if row.status === 'done'}
                <span class="dflag done" title="You've already taken this">Taken</span>
              {/if}
              <span class="dtitle">{courses[row.code]?.title ?? ''}</span>
              <button class="icon-btn" title="Remove from schedule" aria-label="Remove {row.code}" onclick={() => removeCourse(row.code)}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
            {#if row.offered}
              <div class="dpicks">{@render pickers(row, others, true)}</div>
              {@render seatLine(row)}
            {:else}
              <p class="doff">
                Not offered in {termLabel(term)}{row.elsewhere.length ? `; runs in ${row.elsewhere.map((t) => t.label).join(', ')}` : ''}.
              </p>
            {/if}
          </li>
        {:else}
          <li class="dempty">
            <b>No courses in {slot.name} yet.</b>
            <span class="muted">Search above, or use “Add to schedule” on a course in the map.</span>
          </li>
        {/each}
      </ul>
    </div>

    <div class="dfoot">
      <span class="dstats">{plural(rows.length, 'course')} · {units} units · {plural(campusDays, 'day')} on campus</span>
      {#if conflicts.length}
        <span class="dconf bad" title={conflicts.map(conflictText).join('\n')}>
          ⚠ {plural(conflicts.length, 'conflict')}: {conflicts.map(conflictText).join(', ')}
        </span>
      {:else if rows.length}
        <span class="dconf ok">No time conflicts</span>
      {/if}
      {#if exams.length}
        <span class="dconf warnc" title={exams.map((x) => `${x.a} and ${x.b} finals overlap`).join('\n')}>
          {exams.length === 1 ? '1 exam clash' : `${exams.length} exam clashes`}
        </span>
      {/if}
      {#if anyOffered}
        <a class="gosfu" href={GOSFU_URL} target="_blank" rel="noopener">Check live seats in goSFU ↗</a>
      {/if}
    </div>

    {#if (noticeShown && scheduleNotice.text) || arrangeMsg}
      <div class="dtoast" role="status">
        {#if arrangeMsg}
          <span class:bad={!arrangeMsg.ok}>{arrangeMsg.text}</span>
          <button class="x" aria-label="Dismiss" onclick={() => (arrangeMsg = null)}>×</button>
        {:else}
          <span class:warnc={scheduleNotice.kind === 'warn'}>{scheduleNotice.text}</span>
          <button class="x" aria-label="Dismiss" onclick={() => (noticeShown = false)}>×</button>
        {/if}
      </div>
    {/if}
  {:else}
    <div class="topbar">
      {@render slotTabs()}
      {@render termSwitch()}

      <div class="slot-actions">
        <select
          aria-label="Duplicate this schedule"
          value=""
          onchange={(e) => {
            const to = Number(e.currentTarget.value);
            e.currentTarget.value = '';
            duplicateTo(to);
          }}
        >
          <option value="" disabled>Duplicate to…</option>
          {#each scheduleState.slots as s, i (i)}
            {#if i !== scheduleState.active}<option value={i}>{s.name}</option>{/if}
          {/each}
        </select>
        <button onclick={clearActive} disabled={!slot.courses.length}>Clear</button>
      </div>
    </div>

    <div class="body">
      <section class="left">
        <div class="search-wrap">{@render search()}</div>

        {#if noticeShown && scheduleNotice.text}
          <div class="notice {scheduleNotice.kind}" role="status">
            <span>{scheduleNotice.text}</span>
            <button class="x" aria-label="Dismiss" onclick={() => (noticeShown = false)}>×</button>
          </div>
        {/if}

        {#each rows as row (row.code)}
          {@const others = othersExcept(row.code)}
          <article class="card" id="card-{row.code.replace(' ', '-')}" style:--h={row.hue}>
            <header>
              <span class="swatch"></span>
              <button class="name" onclick={() => openDetails(row.code)} title="Description, breadth/WQB and prerequisites">
                <b>{row.code}</b>
                <span class="ctitle">{courses[row.code]?.title ?? 'Not in the loaded data'}</span>
              </button>
              {#if row.units}<span class="units">{row.units} u</span>{/if}
              <button class="icon-btn" title="Remove from schedule" aria-label="Remove {row.code}" onclick={() => removeCourse(row.code)}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </header>

            {#if row.status === 'locked'}
              <p class="flag warn">Prerequisites not met yet</p>
            {:else if row.status === 'done'}
              <p class="flag done">You've already taken this</p>
            {/if}

            {#if !row.offered}
              <p class="flag off">
                Not offered in {termLabel(term)}.
                {#if row.elsewhere.length}
                  Runs in {row.elsewhere.map((t) => t.label).join(', ')}.
                {:else}
                  Not in any published term yet.
                {/if}
              </p>
            {:else}
              <div class="pickers">{@render pickers(row, others, false)}</div>
              {@render seatLine(row)}
            {/if}

            <div class="card-links">
              <button class="link" onclick={() => openDetails(row.code)}>Details</button>
              <button class="link" onclick={() => onopen(row.code)}>Open prerequisites →</button>
              {#if row.offered}
                <a class="link gosfu" href={GOSFU_URL} target="_blank" rel="noopener">Check live seats in goSFU ↗</a>
              {/if}
            </div>
          </article>
        {:else}
          <div class="empty">
            <p><b>No courses in {slot.name} yet.</b></p>
            <p class="muted">
              Search above by code or name, or use “Add to schedule” on any course in the map. Sections are
              picked to avoid clashes, and you can change them.
            </p>
          </div>
        {/each}

        {#if locked.length || taken.length || offGrid.length}
          <div class="heads-up">
            {#if locked.length}
              <p><b>Prerequisites missing:</b> {locked.map((r) => r.code).join(', ')}. Tick what you've taken in the map to update this.</p>
            {/if}
            {#if taken.length}
              <p><b>Already taken:</b> {taken.map((r) => r.code).join(', ')}</p>
            {/if}
            {#if offGrid.length}
              <p><b>Online / TBA, not on grid:</b> {offGrid.map((r) => r.code).join(', ')}</p>
            {/if}
          </div>
        {/if}
      </section>

      <section class="right">
        <div class="stats">
          <div><b>{rows.length}</b><span>course{rows.length === 1 ? '' : 's'}</span></div>
          <div><b>{units}</b><span>units</span></div>
          <div class:bad={conflicts.length}><b>{conflicts.length}</b><span>conflict{conflicts.length === 1 ? '' : 's'}</span></div>
          <div><b>{campusDays}</b><span>day{campusDays === 1 ? '' : 's'} on campus</span></div>
          <div class="arrange">
            <button class="primary" onclick={autoArrange} disabled={!anyOffered}>
              {@render arrangeIcon()}
              Auto-arrange
            </button>
            <label class="keep" title="When on, only change sections that need changing">
              <input type="checkbox" bind:checked={keepPicks} /> Keep my picks
            </label>
          </div>
        </div>

        {#if arrangeMsg}
          <p class="arrange-msg" class:bad={!arrangeMsg.ok}>{arrangeMsg.text}</p>
        {/if}

        <div class="grid-wrap">
          <WeekGrid {events} {range} onpick={(code) => openDetails(code)} />
          {#if !events.length}
            <div class="grid-empty">
              {rows.length ? 'No scheduled meeting times yet.' : `Your ${termLabel(term)} week shows up here.`}
            </div>
          {/if}
        </div>

        {#if conflicts.length}
          <div class="issues">
            <h3>Time conflicts</h3>
            <ul>
              {#each conflicts as c, i (i)}
                <li>
                  <b>{c.a.code}</b> {c.a.section.section} {typeOf(c.a.section)} overlaps
                  <b>{c.b.code}</b> {c.b.section.section} {typeOf(c.b.section)}
                  <span class="when">· {c.day} {fmtMin(c.start)}–{fmtMin(c.end)}</span>
                </li>
              {/each}
            </ul>
          </div>
        {/if}

        {#if exams.length}
          <div class="issues exam">
            <h3>Exam clashes</h3>
            <ul>
              {#each exams as x, i (i)}
                <li>
                  <b>{x.a}</b> and <b>{x.b}</b> finals overlap
                  <span class="when">
                    · {new Date(`${x.date}T12:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                    {fmtMin(x.start)}–{fmtMin(x.end)}
                  </span>
                </li>
              {/each}
            </ul>
          </div>
        {/if}

        <p class="fineprint">
          Times from SFU course outlines for {termLabel(term)}. Seat counts are daily snapshots, not live. Always
          confirm in goSFU before enrolling.
          {#if range.days.length > 5}Weekend classes are shown.{/if}
        </p>
      </section>
    </div>
  {/if}

  <DetailsDialog
    code={detailsCode}
    returnTo={detailsReturn}
    {courses}
    {done}
    {terms}
    {offerings}
    {onopen}
    onclose={() => (detailsCode = null)}
  />
</div>

<style>
  .sched {
    --conflict: #d4213d;
    --warn: #b45309;
    --warn-bg: #fdf3e3;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    /* Layout follows the builder's own width, so it also works in a drawer. */
    container: sched / inline-size;
  }
  .sched.docked {
    height: 100%;
    background: var(--bg);
  }
  @media (prefers-color-scheme: dark) {
    .sched {
      --conflict: #ff5c74;
      --warn: #f0b45a;
      --warn-bg: #3a2c17;
    }
  }

  /* ---- Top bar: slot tabs, term, actions ---- */
  .topbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 16px;
    padding: 12px 20px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }
  .slots {
    display: flex;
    gap: 4px;
    min-width: 0;
  }
  .slot,
  .slot-name {
    display: flex;
    align-items: center;
    gap: 7px;
    max-width: 210px;
    padding: 7px 12px;
    border-radius: 10px;
    font-weight: 600;
  }
  .slot {
    border: 1px solid transparent;
    background: transparent;
    color: var(--muted);
  }
  .slot:hover {
    border-color: var(--border);
    color: var(--text);
  }
  .slot.on {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 9%, var(--surface));
    color: var(--accent-text);
  }
  .slot-label {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .count {
    min-width: 19px;
    padding: 0 5px;
    border-radius: 999px;
    background: var(--bg);
    color: var(--muted);
    font-size: 11px;
    line-height: 18px;
    text-align: center;
  }
  .slot.on .count {
    background: var(--accent);
    color: #fff;
  }
  .pencil {
    width: 13px;
    height: 13px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    opacity: 0.6;
  }
  .slot-name {
    width: 170px;
    border: 1px solid var(--accent);
    background: var(--surface);
    outline: none;
  }

  .terms {
    display: flex;
    padding: 3px;
    border-radius: 999px;
    background: var(--bg);
    border: 1px solid var(--border);
  }
  .terms button {
    padding: 4px 13px;
    border: none;
    border-radius: 999px;
    background: transparent;
    color: var(--muted);
    font-size: 13px;
    font-weight: 600;
  }
  .terms button.on {
    background: var(--sfu-red);
    color: #fff;
  }

  .slot-actions {
    display: flex;
    gap: 6px;
    margin-left: auto;
  }
  .slot-actions select,
  .slot-actions button {
    font-size: 13px;
    padding: 5px 10px;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  button:disabled:hover {
    border-color: var(--border);
  }

  /* ---- Layout ---- */
  .body {
    display: grid;
    grid-template-columns: minmax(320px, 400px) minmax(0, 1fr);
    gap: 20px;
    align-items: start;
    padding: 18px 20px 28px;
  }
  .left,
  .right {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }

  .notice {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 8px 8px 12px;
    border-radius: 10px;
    background: var(--ready-bg);
    color: var(--text);
    border: 1px solid color-mix(in srgb, var(--ready) 40%, transparent);
    font-size: 13px;
    animation: pop 0.2s ease-out;
  }
  .notice.warn {
    background: var(--warn-bg);
    border-color: color-mix(in srgb, var(--warn) 45%, transparent);
  }
  .notice span {
    flex: 1;
  }
  .x {
    border: none;
    background: transparent;
    padding: 0 6px;
    font-size: 18px;
    line-height: 1;
    color: var(--muted);
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
  }

  /* ---- Course cards ---- */
  .card {
    --c-line: oklch(58% 0.14 var(--h));
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-left: 4px solid var(--c-line);
    border-radius: 12px;
    background: var(--surface);
  }
  @media (prefers-color-scheme: dark) {
    .card {
      --c-line: oklch(72% 0.13 var(--h));
    }
  }
  .card header {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .swatch {
    display: none;
  }
  .name {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    padding: 0;
    border: none;
    background: none;
    text-align: left;
  }
  .name b {
    font-size: 15px;
  }
  .name:hover b,
  .name:focus-visible b {
    color: var(--accent-text);
    text-decoration: underline;
  }
  .name .ctitle {
    max-width: 100%;
  }
  .ctitle {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: var(--muted);
    font-size: 12.5px;
  }
  .units {
    font-size: 12px;
    color: var(--muted);
    white-space: nowrap;
  }
  .icon-btn {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border-color: transparent;
    background: transparent;
    color: var(--muted);
  }
  .icon-btn:hover {
    border-color: var(--border);
    color: var(--accent-text);
  }
  .icon-btn svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.5;
    stroke-linecap: round;
  }

  .flag {
    margin: 8px 0 0;
    padding: 4px 9px;
    border-radius: 7px;
    font-size: 12.5px;
    font-weight: 600;
  }
  .flag.warn {
    background: var(--warn-bg);
    color: var(--warn);
  }
  .flag.done {
    background: var(--done-bg);
    color: var(--done);
  }
  .flag.off {
    background: var(--bg);
    color: var(--muted);
    font-weight: 500;
  }

  .pickers {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 10px;
  }
  .pickers label {
    display: grid;
    grid-template-columns: 38px minmax(0, 1fr);
    align-items: center;
    gap: 8px;
  }
  .pickers label > span {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: var(--muted);
  }
  .pickers select {
    width: 100%;
    min-width: 0;
    padding: 6px 8px;
    font-size: 13px;
    background: var(--bg);
    text-overflow: ellipsis;
  }

  .card-links {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 14px;
    margin-top: 8px;
  }
  .link {
    padding: 0;
    border: none;
    background: none;
    color: var(--accent-text);
    font-size: 12.5px;
    font-weight: 600;
    text-decoration: none;
  }
  .link:hover {
    text-decoration: underline;
  }
  .card-links .gosfu {
    margin-left: auto;
  }

  /* Seat snapshot under the pickers. */
  .seats {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 10px;
    margin: 6px 0 0;
    font-size: 12px;
  }
  .seat {
    font-weight: 600;
    white-space: nowrap;
  }
  .seat b {
    color: var(--muted);
    font-weight: 600;
  }
  .seat-open {
    color: var(--done);
  }
  .seat-tight {
    color: var(--warn);
  }
  .seat-full {
    color: var(--conflict);
  }
  .asof {
    color: var(--muted);
    white-space: nowrap;
  }

  .empty {
    padding: 18px;
    border: 1.5px dashed var(--border);
    border-radius: 12px;
    text-align: center;
  }
  .empty p {
    margin: 0 0 4px;
  }

  .heads-up {
    padding: 10px 14px;
    border-radius: 12px;
    background: var(--surface);
    border: 1px solid var(--border);
    font-size: 13px;
  }
  .heads-up p {
    margin: 4px 0;
  }

  /* ---- Right: stats, grid, issues ---- */
  .stats {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 22px;
    padding: 10px 14px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
  }
  .stats > div:not(.arrange) {
    display: flex;
    align-items: baseline;
    gap: 5px;
  }
  .stats b {
    font-size: 20px;
    font-variant-numeric: tabular-nums;
  }
  .stats span {
    color: var(--muted);
    font-size: 12.5px;
  }
  .stats .bad b,
  .stats .bad span {
    color: var(--conflict);
  }
  .arrange {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-left: auto;
  }
  .arrange .primary {
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .arrange svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .keep {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 12.5px;
    color: var(--muted);
    cursor: pointer;
  }
  .keep input {
    accent-color: var(--sfu-red);
  }
  .arrange-msg {
    margin: 0;
    padding: 8px 12px;
    border-radius: 10px;
    background: var(--done-bg);
    color: var(--done);
    font-size: 13px;
    font-weight: 600;
  }
  .arrange-msg.bad {
    background: color-mix(in srgb, var(--conflict) 12%, var(--surface));
    color: var(--conflict);
  }

  .grid-wrap {
    position: relative;
  }
  .grid-empty {
    position: absolute;
    inset: 40px 0 0 46px;
    display: grid;
    place-items: center;
    color: var(--muted);
    pointer-events: none;
  }

  .issues {
    padding: 10px 14px;
    border: 1px solid color-mix(in srgb, var(--conflict) 40%, var(--border));
    border-radius: 12px;
    background: color-mix(in srgb, var(--conflict) 6%, var(--surface));
  }
  .issues.exam {
    border-color: color-mix(in srgb, var(--warn) 45%, var(--border));
    background: var(--warn-bg);
  }
  .issues h3 {
    margin: 0 0 4px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--conflict);
  }
  .issues.exam h3 {
    color: var(--warn);
  }
  .issues ul {
    margin: 0;
    padding-left: 18px;
    font-size: 13px;
  }
  .when {
    color: var(--muted);
    white-space: nowrap;
  }
  .fineprint {
    margin: 0;
    font-size: 11.5px;
    color: var(--muted);
  }

  /* One column: search, then the week, then the course cards. */
  @container sched (max-width: 900px) {
    .body {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 12px;
    }
    .left,
    .right {
      display: contents;
    }
    .search-wrap,
    .notice {
      order: -2;
    }
    .right > :not(.fineprint) {
      order: -1;
    }
    .fineprint {
      order: 1;
    }
    .search-wrap {
      position: relative;
      z-index: 5;
    }
  }

  @container sched (max-width: 700px) {
    .topbar {
      padding: 10px 16px;
    }
    .slots {
      width: 100%;
    }
    .slot,
    .slot-name {
      flex: 1 1 0;
      min-width: 0;
      padding: 6px 8px;
      justify-content: center;
      font-size: 13px;
    }
    .pencil {
      display: none;
    }
    .body {
      padding: 14px 16px 24px;
      gap: 14px;
    }
    .stats {
      gap: 6px 14px;
    }
    .stats b {
      font-size: 17px;
    }
    .arrange {
      width: 100%;
      margin-left: 0;
      justify-content: space-between;
    }
    .grid-empty {
      inset: 36px 0 0 30px;
      text-align: center;
      padding: 0 12px;
    }
  }
  /* ---- Docked (drawer) layout ---- */
  .sched.compact {
    display: flex;
    flex-direction: column;
    position: relative;
    overflow: hidden;
  }
  .dbar {
    display: flex;
    align-items: center;
    gap: 8px 12px;
    padding: 6px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }
  .dbar .slot {
    max-width: 150px;
    padding: 4px 9px;
    font-size: 13px;
  }
  .dbar .slot-name {
    width: 140px;
    padding: 4px 9px;
    font-size: 13px;
  }
  .dbar .pencil {
    display: none;
  }
  .dbar .terms button {
    padding: 3px 10px;
    font-size: 12.5px;
    white-space: nowrap;
  }
  .dsearch {
    flex: 1;
    min-width: 160px;
    position: relative;
    z-index: 5;
  }
  .darrange {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 11px;
    font-size: 13px;
    white-space: nowrap;
  }
  .darrange svg {
    width: 15px;
    height: 15px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .dbody {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) clamp(270px, 30%, 380px);
  }
  .dgrid {
    position: relative;
    min-width: 0;
    min-height: 0;
    overflow: auto;
    padding: 8px 10px 8px 12px;
  }
  .dgrid .grid-empty {
    inset: 36px 10px 8px 58px;
    text-align: center;
  }
  .dlist {
    min-height: 0;
    overflow-y: auto;
    margin: 0;
    padding: 8px 10px 8px 2px;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .drow {
    --c-line: oklch(58% 0.14 var(--h));
    padding: 5px 6px 6px 9px;
    border: 1px solid var(--border);
    border-left: 3px solid var(--c-line);
    border-radius: 9px;
    background: var(--surface);
  }
  @media (prefers-color-scheme: dark) {
    .drow {
      --c-line: oklch(72% 0.13 var(--h));
    }
  }
  .dhead {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .dcode {
    flex-shrink: 0;
    padding: 0;
    border: none;
    background: none;
    font-weight: 700;
    font-size: 13.5px;
    white-space: nowrap;
  }
  .dcode:hover,
  .dcode:focus-visible {
    color: var(--accent-text);
    text-decoration: underline;
  }
  .dtitle {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: var(--muted);
    font-size: 12px;
  }
  .dflag {
    flex-shrink: 0;
    padding: 0 5px;
    border-radius: 4px;
    font-size: 10.5px;
    font-weight: 700;
    line-height: 16px;
    white-space: nowrap;
  }
  .dflag.clash {
    background: color-mix(in srgb, var(--conflict) 14%, var(--surface));
    color: var(--conflict);
  }
  .dflag.warn {
    background: var(--warn-bg);
    color: var(--warn);
  }
  .dflag.done {
    background: var(--done-bg);
    color: var(--done);
  }
  .drow .icon-btn {
    width: 22px;
    height: 22px;
    flex-shrink: 0;
  }
  .drow .icon-btn svg {
    width: 12px;
    height: 12px;
  }
  .dpicks {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 4px;
  }
  .dpicks label {
    flex: 1 1 110px;
    min-width: 0;
    display: flex;
  }
  .dpicks label > span {
    display: none;
  }
  .dpicks select {
    width: 100%;
    min-width: 0;
    padding: 2px 4px;
    border-radius: 6px;
    font-size: 12px;
    background: var(--bg);
    text-overflow: ellipsis;
  }
  .drow .seats {
    margin-top: 3px;
    font-size: 11.5px;
  }
  .doff {
    margin: 3px 0 0;
    font-size: 12px;
    color: var(--muted);
  }
  .dempty {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 14px;
    border: 1.5px dashed var(--border);
    border-radius: 10px;
    font-size: 13px;
    text-align: center;
  }
  .dfoot {
    display: flex;
    align-items: center;
    gap: 14px;
    min-width: 0;
    padding: 5px 12px;
    border-top: 1px solid var(--border);
    background: var(--surface);
    font-size: 12.5px;
    white-space: nowrap;
  }
  .dstats {
    color: var(--muted);
    flex-shrink: 0;
  }
  .dconf {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 600;
  }
  .dconf.bad {
    flex: 1;
    color: var(--conflict);
  }
  .dconf.ok {
    color: var(--done);
  }
  .dconf.warnc {
    flex-shrink: 0;
    color: var(--warn);
  }
  .dfoot .gosfu {
    margin-left: auto;
    flex-shrink: 0;
    color: var(--accent-text);
    font-weight: 600;
    text-decoration: none;
  }
  .dfoot .gosfu:hover {
    text-decoration: underline;
  }
  .dtoast {
    position: absolute;
    left: 12px;
    bottom: 38px;
    z-index: 6;
    display: flex;
    align-items: center;
    gap: 6px;
    max-width: min(560px, calc(100% - 24px));
    padding: 6px 6px 6px 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    box-shadow: 0 6px 20px rgb(0 0 0 / 0.15);
    font-size: 13px;
    animation: pop 0.2s ease-out;
  }
  .dtoast span {
    flex: 1;
  }
  .dtoast .bad {
    color: var(--conflict);
  }
  .dtoast .warnc {
    color: var(--warn);
  }
  @container sched (max-width: 1000px) {
    .dbar .slot {
      max-width: 110px;
    }
    .dbar .count {
      display: none;
    }
    .dstats {
      display: none;
    }
  }
</style>
