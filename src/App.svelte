<script lang="ts">
  import { untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { SvelteFlow, Background, Controls } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';

  import { buildGraph, courseStatus, pathThrough, nextSteps as findNextSteps } from './lib/graph';
  import type { CourseData, OfferingData, Status, Term, View } from './lib/types';
  import CourseNode from './lib/CourseNode.svelte';
  import JunctionNode from './lib/JunctionNode.svelte';
  import OtherNode from './lib/OtherNode.svelte';
  import FitOnChange from './lib/FitOnChange.svelte';
  import PrereqList from './lib/PrereqList.svelte';
  import OfferBadge from './lib/OfferBadge.svelte';
  import { readPref, writePref } from './lib/prefs';
  import Header from './lib/Header.svelte';
  import { setActions } from './lib/context';
  import { rmpUrl } from './lib/links';
  import { loadDetails, designationBadges } from './lib/details';
  import { loadSeats, seatInfo, describeSeats, formatAsOf, GOSFU_URL } from './lib/seats';
  import ScheduleDock from './lib/ScheduleDock.svelte';
  import CourseInput from './lib/CourseInput.svelte';
  import { matchCourse } from './lib/search';
  import ScheduleBuilder from './lib/schedule/ScheduleBuilder.svelte';
  import { addToSchedule, isInSchedule, scheduleNotice, setScheduleData } from './lib/schedule/store.svelte';
  import ExploreView from './lib/ExploreView.svelte';
  import PlanView from './lib/PlanView.svelte';
  import DegreeView from './lib/DegreeView.svelte';
  import CommandPalette from './lib/CommandPalette.svelte';
  import ShareBanner from './lib/ShareBanner.svelte';
  import ShareMenu from './lib/ShareMenu.svelte';
  import ChartSnapshot from './lib/ChartSnapshot.svelte';
  import { decodeShareHash } from './lib/share';
  import { inferTaken, untick } from './lib/implied';
  import { flash } from './lib/shareActions.svelte';
  import { done, notTaken, settings, getDoc } from './lib/persist/store.svelte';
  import { startAutosnap } from './lib/persist/autosnap';
  import { installUndoShortcuts } from './lib/persist/undo.svelte';
  import HistoryPanel from './lib/persist/HistoryPanel.svelte';
  import SaveError from './lib/persist/SaveError.svelte';
  import { loadProgramIndex } from './lib/programs/load';
  import Welcome from './lib/Welcome.svelte';
  import { scheduleState } from './lib/schedule/store.svelte';

  interface Props {
    data: CourseData;
    offeringData: OfferingData;
  }

  let { data, offeringData }: Props = $props();
  const courses = untrack(() => data.courses);
  const nodeTypes = { course: CourseNode, junction: JunctionNode, other: OtherNode };

  const { terms, offerings } = untrack(() => offeringData);
  setScheduleData({ terms, offerings });

  // Version history: snapshots when edits settle and before bulk changes.
  startAutosnap();
  let historyOpen = $state(false);

  // First visit: a welcome screen before the app. Skipped for anyone who
  // already has progress, and for share links (the sender
  // wants them to see the chart). A per-device preference, not synced.
  const WELCOMED_KEY = 'sfu-prereqs:welcomed';
  const codes = Object.keys(courses);
  function alreadyWelcomed(): boolean {
    try {
      if (localStorage.getItem(WELCOMED_KEY)) return true;
    } catch {}
    return (
      done.size > 0 ||
      scheduleState.slots.some((s) => s.courses.length) ||
      /[?&]taken=/.test(location.hash)
    );
  }
  let welcomed = $state(alreadyWelcomed());
  function finishWelcome() {
    welcomed = true;
    try {
      localStorage.setItem(WELCOMED_KEY, '1');
    } catch {}
  }
  let programCount = $state(368);
  $effect(() => {
    if (!welcomed) loadProgramIndex().then((i) => i.length && (programCount = i.length));
  });
  // Ctrl/Cmd+Z everywhere except text fields and while a dialog (the command
  // palette, history, course details) is open.
  $effect(() => installUndoShortcuts(() => !!document.querySelector('dialog[open]')));

  // Show "Added X to Schedule 1" briefly after each add.
  let showNotice = $state(false);
  $effect(() => {
    if (!scheduleNotice.id) return;
    showNotice = true;
    const t = setTimeout(() => (showNotice = false), 6000);
    return () => clearTimeout(t);
  });
  const offeredIn = (code: string): Term[] => terms.filter((t) => offerings[code]?.[t.id]);

  // Reverse lookup: which courses list this one as a prerequisite?
  const unlocks: Record<string, string[]> = {};
  for (const [code, c] of Object.entries(courses)) {
    for (const ref of new Set(JSON.stringify(c.prereq ?? '').match(/[A-Z]{2,5} \d{3}[A-Z]?/g))) {
      (unlocks[ref] ??= []).push(code);
    }
  }

  // Share links look like "#CMPT-410?taken=…"; decodeShareHash also copes with
  // lowercase codes and malformed escapes like "#%E0%A4%A".
  function codeFromHash(): string | null {
    const code = decodeShareHash(location.hash).target;
    return code && code in courses ? code : null;
  }


  const narrow = () => matchMedia('(max-width: 700px)').matches;
  const initial = codeFromHash() ?? 'CMPT 410';
  let target = $state(initial);
  let selected = $state(initial);
  let maxDepth = $state(2);
  let hovered = $state<string | null>(null);
  let dockOpen = $state(false);
  let hideTaken = $state(true);
  let view = $state<View>(narrow() ? 'list' : 'graph');
  // `done` is what you've ticked (saved by persist/store). Their
  // prerequisites are filled in on top (`implied`): required ones for
  // certain, a best guess for "one of" groups. `notTaken` holds guesses
  // you've rejected. Everything that asks "has this been taken?" uses
  // `known`, the two together.
  const implied = $derived(settings.assumePrereqs ? inferTaken(courses, done, notTaken) : new Map());
  const known = $derived(new Set([...done, ...implied.keys()]));
  // Svelte Flow unmounts without a pointerleave when switching views.
  $effect(() => {
    view;
    hovered = null;
  });
  const expanded = new SvelteSet<string>();

  const graph = $derived(buildGraph(target, courses, known, { maxDepth, hideTaken, expanded, offeredIn, implied }));
  // Svelte Flow needs writable arrays, so mirror the derived graph into state.
  let nodes = $state.raw(untrack(() => graph.nodes));
  let edges = $state.raw(untrack(() => graph.edges));
  $effect.pre(() => {
    nodes = graph.nodes;
    edges = graph.edges;
  });
  // While hovering a course, fade everything not on a path through it. This is
  // done with a generated stylesheet rather than by changing the nodes, since
  // re-rendering nodes mid-click would swallow checkbox clicks.
  const hoverCss = $derived.by(() => {
    if (view !== 'graph' || !hovered || !graph.nodes.some((n) => n.id === hovered)) return '';
    const keep = pathThrough(graph, hovered);
    const q = JSON.stringify;
    const keepNodes = [...keep].map((id) => `[data-id=${q(id)}]`).join(',');
    const keepEdges = graph.edges
      .filter((e) => keep.has(e.source) && keep.has(e.target))
      .map((e) => `.svelte-flow__edge[data-id=${q(e.id)}] .svelte-flow__edge-path`)
      .join(',');
    return (
      `.svelte-flow__node:not(${keepNodes}){opacity:.25}` +
      `.svelte-flow__edge .svelte-flow__edge-path{opacity:.15}` +
      (keepEdges ? `${keepEdges}{opacity:1;stroke:var(--text);stroke-width:2.5}` : '')
    );
  });

  // What to take next (whole tree, not just what's drawn), soonest-offered first.
  const nextGroups = $derived(
    findNextSteps(target, courses, known)
      .map((group) => [...group].sort((a, b) => soonest(a) - soonest(b)))
      .sort((a, b) => soonest(a[0]) - soonest(b[0]) || a[0].localeCompare(b[0], 'en', { numeric: true })),
  );
  // Standalone required courses are listed together; each "one of" group gets its own box.
  const requiredNext = $derived(nextGroups.filter((g) => g.length === 1).map((g) => g[0]));
  const oneOfNext = $derived(nextGroups.filter((g) => g.length > 1));
  function soonest(code: string): number {
    const i = terms.findIndex((t) => offerings[code]?.[t.id]);
    return i === -1 ? terms.length : i;
  }

  const progress = $derived.by(() => {
    const counts = { done: 0, ready: 0, locked: 0 };
    for (const n of graph.nodes) {
      if (n.type !== 'course' || n.id === target || n.data.missing) continue;
      counts[n.data.status === 'unknown' ? 'ready' : n.data.status]++;
    }
    return counts;
  });
  const layoutKey = $derived(graph.nodes.map((n) => n.id).join() + target);

  // Each new target gets a history entry so the Back button returns to the
  // previous course. The first one replaces, so Back can still leave the app.
  // Only the hash's course is compared, so an incoming share link's
  // "?taken=…" stays until ShareBanner has dealt with it.
  let firstHash = true;
  $effect(() => {
    const hash = '#' + target.replace(' ', '-');
    if (decodeShareHash(location.hash).target !== target) {
      history[firstHash ? 'replaceState' : 'pushState'](null, '', hash);
    }
    firstHash = false;
  });

  function setTarget(code: string) {
    target = code;
    selected = code;
    expanded.clear();
  }

  // Ticking a box. Unticking also unticks what only had its prerequisites
  // through that course; unticking a filled-in guess means "I didn't take
  // this", which moves the guess to another route (see implied.ts).
  function toggleDone(code: string) {
    if (done.has(code) || implied.has(code)) unmark(code);
    else markTaken(code);
  }

  function unmark(code: string) {
    const was = { taken: [...done], notTaken: [...notTaken] };
    const r = untick(courses, done, notTaken, code, settings.assumePrereqs);
    replaceSet(done, r.taken);
    replaceSet(notTaken, r.notTaken);
    if (r.cascaded.length) {
      const list = r.cascaded.length === 1 ? r.cascaded[0] : `${r.cascaded.slice(0, -1).join(', ')} and ${r.cascaded.at(-1)}`;
      flash(`Also unticked ${list}, which needed ${code}.`, {
        action: {
          label: 'Undo',
          run: () => {
            replaceSet(done, was.taken);
            replaceSet(notTaken, was.notTaken);
          },
        },
      });
    }
  }

  function replaceSet(set: Set<string>, values: string[]) {
    set.clear();
    for (const v of values) set.add(v);
  }

  function markTaken(code: string) {
    done.add(code);
    notTaken.delete(code);
  }

  setActions({
    toggleDone,
    expand: (code) => expanded.add(code),
    terms,
  });

  // Side panel: which sections are open, and whether the whole panel is
  // folded away to a strip. Remembered per device.
  type Section = 'desc' | 'next' | 'runs';
  const SECTIONS_KEY = 'sfu-prereqs:panel-sections';
  const PANEL_KEY = 'sfu-prereqs:panel-collapsed';
  const savedSections = readPref<Partial<Record<Section, boolean>> | null>(SECTIONS_KEY, null);
  const sectionOpen = $state<Record<Section, boolean>>({
    desc: false,
    next: true,
    runs: false,
    ...(savedSections && typeof savedSections === 'object' ? savedSections : {}),
  });
  $effect(() => writePref(SECTIONS_KEY, { ...sectionOpen }));
  let panelCollapsed = $state(readPref<unknown>(PANEL_KEY, false) === true);
  $effect(() => writePref(PANEL_KEY, panelCollapsed));

  // The legend opens by itself on the first visit; once closed it stays a button.
  const LEGEND_KEY = 'sfu-prereqs:legend-dismissed';
  let legendOpen = $state(!readPref(LEGEND_KEY, false));
  function closeLegend() {
    legendOpen = false;
    writePref(LEGEND_KEY, true);
  }

  const sel = $derived(courses[selected]);

  // Descriptions and seat snapshots load after the page is up (they're big
  // and not needed for the first paint).
  let details = $state<Awaited<ReturnType<typeof loadDetails>>>({});
  let seats = $state<Awaited<ReturnType<typeof loadSeats>> | null>(null);
  $effect(() => {
    loadDetails().then((d) => (details = d));
    loadSeats().then((s) => (seats = s));
  });
  const selDetails = $derived(details[selected]);
  const selBadges = $derived(designationBadges(selDetails?.designation));
  const selStatus = $derived(courseStatus(selected, courses, known));
  const selImplied = $derived(implied.get(selected));
  const impliedList = $derived(
    [...implied].sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })),
  );
  const statusLabel: Record<Status, string> = {
    done: 'Taken',
    ready: 'Can take now',
    locked: 'Prereqs missing',
    unknown: 'Check calendar requirements',
  };

  // "I've taken…" box in the side panel, for marking courses not on the map.
  let takenInput = $state('');
  let takenError = $state('');
  function addTaken() {
    const code = matchCourse(takenInput, courses);
    if (code) {
      markTaken(code);
      takenInput = '';
      takenError = '';
    } else takenError = takenInput.trim() ? `No course matches "${takenInput.trim()}"` : '';
  }

  // Selecting a course in the list on a phone: bring the details into view.
  let aside = $state<HTMLElement>();
  function select(code: string) {
    selected = code;
    if (narrow()) aside?.scrollIntoView({ behavior: 'smooth' });
  }

  // Leaving Explore/Degree/Schedule for a course's prerequisites lands on the map.
  function showOnMap(code: string) {
    setTarget(code);
    view = narrow() ? 'list' : 'graph';
  }
</script>

<svelte:head>
  {@html `<style>${hoverCss}[data-id=${JSON.stringify(selected)}] .course{outline:2px dashed var(--muted);outline-offset:4px}[data-id=${JSON.stringify(selected)}] .course .ctl{opacity:1}</style>`}
</svelte:head>

<svelte:window
  onkeydown={(e) => {
    // Enter on a focused chart node selects it, like a click.
    const node = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('.svelte-flow__node-course');
    if (e.key === 'Enter' && node?.dataset.id && e.target === document.activeElement) selected = node.dataset.id;
    if (e.key === 'Escape' && legendOpen) closeLegend();
  }}
  onpointerdown={(e) => {
    if (legendOpen && !(e.target as Element).closest?.('.legend-wrap')) closeLegend();
  }}
  onhashchange={() => {
    const code = codeFromHash();
    if (code && code !== target) setTarget(code);
  }}
/>

{#if !welcomed}
  <Welcome
    courseCount={codes.length}
    {programCount}
    {terms}
    onstart={finishWelcome}
  />
{:else}
<SaveError {target} />
<Header
  {courses}
  {target}
  {progress}
  {terms}
  onpick={setTarget}
  isOffered={(code) => offeredIn(code).length > 0}
  bind:view
/>

{#if view === 'schedule'}
  <ScheduleBuilder {courses} {terms} {offerings} done={known} onopen={showOnMap} />
  <button
    class="dock-fab"
    onclick={() => {
      view = 'graph';
      dockOpen = true;
    }}
    title="Show the schedule under the prerequisite map">Dock under map ↙</button
  >
{:else}
<main>
  <section class="canvas" class:list={view !== 'graph'} class:graph={view === 'graph'}>
    {#snippet viewOptions()}
      <!-- Chart/List options live with the chart, not in the header, so the
           header (and its tabs) look the same on every view. -->
      <div class="view-bar">
        <label>
          Levels
          <select bind:value={maxDepth}>
            {#each [1, 2, 3, 4] as d}<option value={d}>{d}</option>{/each}
            <option value={Infinity}>All</option>
          </select>
        </label>
        <label class="switch-label">
          <input type="checkbox" bind:checked={hideTaken} />
          <span class="switch" aria-hidden="true"></span>
          Hide prereqs of taken courses
        </label>
        {#if view === 'graph'}
          <div class="legend-wrap">
            <button
              class="legend-btn"
              aria-expanded={legendOpen}
              aria-controls="legend"
              onclick={() => (legendOpen ? closeLegend() : (legendOpen = true))}
              ><span class="q" aria-hidden="true">?</span> Legend</button
            >
            {#if legendOpen}
              <div class="legend" id="legend" role="dialog" aria-label="Legend">
                <span><i class="done"></i>Taken</span>
                <span><i class="assumed"></i>Assumed taken</span>
                <span><i class="ready"></i>Can take now</span>
                <span><i class="locked"></i>Prereqs missing</span>
                <span><i class="unknown"></i>Check requirements</span>
                <span><i class="missing"></i>Not in catalog</span>
                <span><OfferBadge offered={terms.slice(0, 1)} {terms} /> only runs in some terms</span>
                <span class="hint">Hover or select a course to tick it as taken · <b>+</b> shows more</span>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    {/snippet}
    {#if view === 'graph'}
      {@render viewOptions()}
      <div class="flow">
      <SvelteFlow
        bind:nodes
        bind:edges
        {nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        minZoom={0.2}
        onnodeclick={({ node }) => node.type === 'course' && (selected = node.id)}
        edgesFocusable={false}
        onnodepointerenter={({ node }) => node.type === 'course' && (hovered = node.id)}
        onnodepointerleave={() => (hovered = null)}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} />
        <Controls showLock={false} />
        <FitOnChange key={layoutKey + panelCollapsed} anchor={target} />
        <ChartSnapshot />
      </SvelteFlow>
      </div>
    {:else if view === 'explore'}
      <ExploreView
        {courses}
        done={known}
        {terms}
        {offeredIn}
        {selected}
        onselect={select}
        ontoggle={toggleDone}
        ontarget={showOnMap}
      />
    {:else if view === 'degree'}
      <DegreeView {courses} done={known} {implied} {offeredIn} onselect={select} ontarget={showOnMap} ontoggle={toggleDone} />
    {:else if view === 'plan'}
      <PlanView {target} {courses} done={known} {terms} {offerings} {selected} onselect={select} />
    {:else}
      {@render viewOptions()}
      <ul class="tree">
        <PrereqList
          tree={target}
          {courses}
          done={known}
          {implied}
          {hideTaken}
          {maxDepth}
          {expanded}
          {offeredIn}
          ontoggle={toggleDone}
          onselect={select}
          onexpand={(c: string) => expanded.add(c)}
        />
      </ul>
    {/if}
  </section>

  {#snippet sectionHead(key: Section, label: string)}
    <h3 class="acc-head">
      <button aria-expanded={sectionOpen[key]} aria-controls="sec-{key}" onclick={() => (sectionOpen[key] = !sectionOpen[key])}>
        <svg class="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" /></svg>
        {label}
      </button>
    </h3>
  {/snippet}
  {#snippet nextItem(code: string)}
    <button class="next-item" onclick={() => select(code)} title={courses[code].title}>
      <b>{code}</b>
      <span class="next-title">{courses[code].title}</span>
      <span class="next-terms"><OfferBadge offered={offeredIn(code)} {terms} /></span>
    </button>
  {/snippet}

  {#if panelCollapsed}
    <button class="panel-strip" onclick={() => (panelCollapsed = false)} aria-expanded="false" aria-label="Show course details">
      <svg class="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M10 4l-4 4 4 4" /></svg>
      <span>{selected}</span>
    </button>
  {:else}
  <aside bind:this={aside}>
    <button class="panel-collapse" onclick={() => (panelCollapsed = true)} aria-expanded="true" title="Hide panel" aria-label="Hide course details panel">
      <svg class="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" /></svg>
    </button>
    <div class="eyebrow">{selected === target ? 'Target course' : 'Selected course'}</div>
    <h2>{selected}</h2>
    <p class="course-title">{sel?.title ?? "This course isn't in SFU's current calendar."}</p>
    {#if sel}
      <p class="status {selStatus}">
        {#if selImplied}
          {selImplied.certain ? 'Taken' : 'Assumed taken'} · prerequisite of
          <button class="link-btn inline" onclick={() => select(selImplied.via)}>{selImplied.via}</button>
        {:else}
          {statusLabel[selStatus]}{notTaken.has(selected) ? ' · you said you didn’t take it' : ''}
        {/if}
        · {sel.units} units
      </p>
    {/if}
    <div class="actions">
      {#if selImplied}
        <!-- Filled in from another course: confirm it, or say it's wrong. -->
        <button class="primary" onclick={() => markTaken(selected)}>I took this</button>
        <button onclick={() => unmark(selected)}>I didn't take this</button>
      {:else}
        <button class="primary" onclick={() => toggleDone(selected)}>
          {done.has(selected) ? 'Unmark as taken' : 'Mark as taken'}
        </button>
      {/if}
      {#if selected !== target && sel}
        <button onclick={() => setTarget(selected)}>Show its prerequisites</button>
      {/if}
      {#if sel && offeredIn(selected).length}
        <button onclick={() => addToSchedule(selected)} disabled={isInSchedule(selected)}>
          {isInSchedule(selected) ? 'In your schedule' : 'Add to schedule'}
        </button>
      {/if}
    </div>
    {#key scheduleNotice.id}
      {#if showNotice && scheduleNotice.text}
        <p class="notice {scheduleNotice.kind}" role="status">
          {scheduleNotice.text}
          <button class="link-btn" onclick={() => (view = 'schedule')}>Open schedule →</button>
        </p>
      {/if}
    {/key}

    {#if selDetails?.description || selBadges.length}
      {@render sectionHead('desc', 'Description')}
      {#if sectionOpen.desc}
        <div class="acc-body" id="sec-desc">
          {#if selBadges.length}
            <div class="badges" aria-label="WQB and breadth designation">
              {#each selBadges as b (b.short)}<span class="badge" title={b.label}><b>{b.short}</b> {b.label}</span>{/each}
            </div>
          {/if}
          {#if selDetails?.description}<p class="desc">{selDetails.description}</p>{/if}
        </div>
      {/if}
    {/if}

    {@render sectionHead('next', `Next steps toward ${target}`)}
    {#if sectionOpen.next}
    <div class="acc-body" id="sec-next">
    {#if known.has(target)}
      <p class="muted">You've taken {target}. Nice!</p>
    {:else if courseStatus(target, courses, known) === 'ready'}
      <p class="muted">You can take {target} now.</p>
    {:else if courseStatus(target, courses, known) === 'unknown' && !nextGroups.length}
      <p class="muted">
        You may be able to take {target} now. It has requirements that aren't SFU courses (like
        Pre-Calculus 12, a units count or permission), so check the calendar text below.
      </p>
    {:else if nextGroups.length}
      {#if courseStatus(target, courses, known) === 'unknown'}
        <p class="muted small">
          You may already qualify through a non-course requirement (see the calendar text). Otherwise:
        </p>
      {/if}
      <div class="next">
        {#if requiredNext.length}
          <div class="next-group">
            <div class="next-label">Required</div>
            {#each requiredNext as code (code)}{@render nextItem(code)}{/each}
          </div>
        {/if}
        {#each oneOfNext as group (group.join())}
          <div class="next-group one-of" role="group" aria-label="One of">
            <div class="next-label">One of</div>
            {#each group as code (code)}{@render nextItem(code)}{/each}
          </div>
        {/each}
      </div>
    {:else}
      <p class="muted">Tick the courses you've taken to see what's next.</p>
    {/if}
    </div>
    {/if}

    {@render sectionHead('runs', 'When it runs')}
    {#if sectionOpen.runs}
    <div class="acc-body" id="sec-runs">
      {#each terms as term (term.id)}
        <!-- Only the sections you enrol in (lectures/seminars), not their labs. -->
        {@const sections = offerings[selected]?.[term.id]?.filter((s) => s.enrol !== false)}
        <div class="term">
          <div class="term-name">
            {term.label}{term.current ? ' (this term)' : ''}
            {#if !sections}<span class="muted"> · not offered</span>{/if}
          </div>
          {#each sections ?? [] as s (s.section)}
            {@const seat = seatInfo(seats, term.id, selected, s.section)}
            <div class="section">
              <div class="section-head">
                <b>{s.section}</b>
                {[s.campus, s.delivery].filter(Boolean).join(' · ')}
              </div>
              {#if s.schedule}<div class="muted">{s.schedule}</div>{/if}
              {#if seat}
                {@const d = describeSeats(seat)}
                <div class="seat seat-{d.level}">{d.text} <span class="muted">· as of {formatAsOf(seat.asOf)}</span></div>
              {/if}
              <div class="profs">
                {#each s.instructors ?? [] as name}
                  <a href={rmpUrl(name)} target="_blank" rel="noopener" title="Search Rate My Professors"
                    >{name} <span class="rmp">RMP ↗</span></a
                  >
                {:else}
                  <span class="muted">Instructor TBA</span>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      {/each}

      {#if terms.some((t) => offerings[selected]?.[t.id])}
        <a class="gosfu" href={GOSFU_URL} target="_blank" rel="noopener">Check live seats in goSFU ↗</a>
        <p class="muted small">Seat counts are SFU's daily snapshot during registration, not live.</p>
      {/if}
    </div>
    {/if}

    <h3>Calendar text</h3>
    <p class="raw">{sel?.prereqText || 'No prerequisites listed.'}</p>

    {#if unlocks[selected]?.length}
      <h3>Leads to</h3>
      <div class="chips">
        {#each unlocks[selected] as code}
          <button class="chip" onclick={() => setTarget(code)} title={courses[code].title}>{code}</button>
        {/each}
      </div>
    {/if}

    <h3>Taken ({done.size})</h3>
    {#if done.size}
      <div class="chips">
        {#each [...done].sort() as code}
          <button class="chip done" onclick={() => toggleDone(code)} title="Click to unmark">{code} ×</button>
        {/each}
      </div>
    {:else}
      <p class="muted">
        Tick courses you've finished and the chart shows what you can take next. Their prerequisites are filled in
        for you.
      </p>
    {/if}
    {#if implied.size}
      <h4 class="sub">Filled in from those ({implied.size})</h4>
      <p class="muted small">
        Solid: required, so you must have taken it. Dashed: our guess for a "one of" requirement. Click one to confirm
        or correct it.
      </p>
      <div class="chips">
        {#each impliedList as [code, info] (code)}
          <button
            class="chip done implied"
            class:assumed={!info.certain}
            onclick={() => select(code)}
            title="{info.certain ? 'Required' : 'Assumed'}: prerequisite of {info.via}">{code}</button
          >
        {/each}
      </div>
    {/if}
    {#if notTaken.size}
      <h4 class="sub">Marked not taken ({notTaken.size})</h4>
      <div class="chips">
        {#each [...notTaken].sort() as code (code)}
          <button class="chip" onclick={() => notTaken.delete(code)} title="Undo: allow it to be filled in again"
            >{code} ×</button
          >
        {/each}
      </div>
    {/if}
    <label class="assume-toggle">
      <input type="checkbox" bind:checked={settings.assumePrereqs} />
      Fill in prerequisites of courses I've taken
    </label>
    <form
      class="add-taken"
      onsubmit={(e) => {
        e.preventDefault();
        addTaken();
      }}
    >
      <CourseInput
        {courses}
        bind:value={takenInput}
        placeholder="I've taken… e.g. CMPT 120"
        label="Add a course you've taken"
        onpick={(code) => {
          done.add(code);
          takenError = '';
        }}
        oninput={() => (takenError = '')}
        onnomatch={(q) => (takenError = `No single course matches "${q.trim()}". Pick one from the list.`)}
      />
      <button type="submit">Add</button>
    </form>
    {#if takenError}<p class="error">{takenError}</p>{/if}

    <ShareMenu
      {target}
      {done}
      onshowchart={() => (view = 'graph')}
      onhistory={() => (historyOpen = true)}
      onpick={setTarget}
    />

    <button class="link-btn about" onclick={() => (welcomed = false)}>About this site</button>
    <p class="data-source">
      Data: SFU Academic Calendar ({data.term.replace('/', ' ')}) and course outlines, fetched
      {new Date(offeringData.fetched).toLocaleDateString()}. Prerequisites are parsed from the
      calendar text automatically, so always check the original. RMP links search by name and may
      not match the right person.
    </p>
  </aside>
  {/if}
</main>
<ScheduleDock {courses} {terms} {offerings} done={known} bind:open={dockOpen} onexpand={() => (view = 'schedule')} onopen={setTarget} />
{/if}

<CommandPalette {courses} {target} {done} onpick={setTarget} bind:view onhistory={() => (historyOpen = true)} />
<HistoryPanel bind:open={historyOpen} owner={null} syncing={false} />
{/if}

{#if welcomed}<ShareBanner {done} onpick={setTarget} />{/if}
