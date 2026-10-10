<script>
  import { setContext, untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { SvelteFlow, Background, Controls } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';

  import { buildGraph, courseStatus, pathThrough, nextSteps as findNextSteps } from './lib/graph.js';
  import CourseNode from './lib/CourseNode.svelte';
  import JunctionNode from './lib/JunctionNode.svelte';
  import OtherNode from './lib/OtherNode.svelte';
  import FitOnChange from './lib/FitOnChange.svelte';
  import PrereqList from './lib/PrereqList.svelte';
  import TermPills from './lib/TermPills.svelte';
  import Header from './lib/Header.svelte';
  import { rmpUrl } from './lib/links.js';
  import { loadDetails, designationBadges } from './lib/details.js';
  import { loadSeats, seatInfo, describeSeats, formatAsOf, GOSFU_URL } from './lib/seats.js';
  import ScheduleDock from './lib/ScheduleDock.svelte';
  import CourseInput from './lib/CourseInput.svelte';
  import { matchCourse } from './lib/search.js';
  import ScheduleBuilder from './lib/schedule/ScheduleBuilder.svelte';
  import { addToSchedule, isInSchedule, scheduleNotice, setScheduleData } from './lib/schedule/store.svelte.js';

  let { data, offeringData } = $props();
  const courses = untrack(() => data.courses);
  const nodeTypes = { course: CourseNode, junction: JunctionNode, other: OtherNode };
  const STORAGE_KEY = 'sfu-prereqs:taken';

  const { terms, offerings } = untrack(() => offeringData);
  setScheduleData({ terms, offerings });

  // Show "Added X to Schedule 1" briefly after each add.
  let showNotice = $state(false);
  $effect(() => {
    if (!scheduleNotice.id) return;
    showNotice = true;
    const t = setTimeout(() => (showNotice = false), 6000);
    return () => clearTimeout(t);
  });
  const offeredIn = (code) => terms.filter((t) => offerings[code]?.[t.id]);

  // Reverse lookup: which courses list this one as a prerequisite?
  const unlocks = {};
  for (const [code, c] of Object.entries(courses)) {
    for (const ref of new Set(JSON.stringify(c.prereq ?? '').match(/[A-Z]{2,5} \d{3}[A-Z]?/g))) {
      (unlocks[ref] ??= []).push(code);
    }
  }

  function codeFromHash() {
    try {
      const code = decodeURIComponent(location.hash.slice(1)).replace('-', ' ').toUpperCase();
      return code in courses ? code : null;
    } catch {
      return null; // malformed escape like "#%E0%A4%A"
    }
  }

  function loadTaken() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
      return Array.isArray(saved) ? saved.filter((c) => typeof c === 'string') : [];
    } catch {
      return [];
    }
  }

  const initial = codeFromHash() ?? 'CMPT 410';
  let target = $state(initial);
  let selected = $state(initial);
  let maxDepth = $state(2);
  let hovered = $state(null);
  let dockOpen = $state(false);
  let hideTaken = $state(true);
  let view = $state(matchMedia('(max-width: 700px)').matches ? 'list' : 'graph');
  const done = new SvelteSet(loadTaken());
  // Svelte Flow unmounts without a pointerleave when switching views.
  $effect(() => {
    view;
    hovered = null;
  });
  const expanded = new SvelteSet();

  const graph = $derived(buildGraph(target, courses, done, { maxDepth, hideTaken, expanded, offeredIn }));
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
      (keepEdges ? `${keepEdges}{opacity:1;stroke:var(--accent);stroke-width:2.5}` : '')
    );
  });

  // What to take next (whole tree, not just what's drawn), soonest-offered first.
  const nextGroups = $derived(
    findNextSteps(target, courses, done)
      .map((group) => [...group].sort((a, b) => soonest(a) - soonest(b)))
      .sort((a, b) => soonest(a[0]) - soonest(b[0]) || a[0].localeCompare(b[0], 'en', { numeric: true })),
  );
  function soonest(code) {
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

  $effect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...done]));
    } catch {}
  });

  // Each new target gets a history entry so the Back button returns to the
  // previous course. The first one replaces, so Back can still leave the app.
  let firstHash = true;
  $effect(() => {
    const hash = '#' + target.replace(' ', '-');
    if (location.hash !== hash) history[firstHash ? 'replaceState' : 'pushState'](null, '', hash);
    firstHash = false;
  });

  function setTarget(code) {
    target = code;
    selected = code;
    expanded.clear();
  }

  function toggleDone(code) {
    if (done.has(code)) done.delete(code);
    else done.add(code);
  }

  setContext('actions', {
    toggleDone,
    expand: (code) => expanded.add(code),
  });


  const sel = $derived(courses[selected]);

  // Descriptions and seat snapshots load after the page is up (they're big
  // and not needed for the first paint).
  let details = $state({});
  let seats = $state(null);
  let descOpen = $state(false);
  $effect(() => {
    loadDetails().then((d) => (details = d));
    loadSeats().then((s) => (seats = s));
  });
  const selDetails = $derived(details[selected]);
  const selBadges = $derived(designationBadges(selDetails?.designation));
  $effect(() => {
    selected;
    descOpen = false;
  });
  const selStatus = $derived(courseStatus(selected, courses, done));
  const statusLabel = {
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
      done.add(code);
      takenInput = '';
      takenError = '';
    } else takenError = takenInput.trim() ? `No course matches "${takenInput.trim()}"` : '';
  }

  // Selecting a course in the list on a phone: bring the details into view.
  let aside = $state();
  function select(code) {
    selected = code;
    if (matchMedia('(max-width: 700px)').matches) aside?.scrollIntoView({ behavior: 'smooth' });
  }
</script>

<svelte:head>
  {@html `<style>${hoverCss}[data-id=${JSON.stringify(selected)}] .course{outline:2px dashed var(--accent);outline-offset:4px}</style>`}
</svelte:head>

<svelte:window
  onkeydown={(e) => {
    // Enter on a focused chart node selects it, like a click.
    const node = document.activeElement?.closest?.('.svelte-flow__node-course');
    if (e.key === 'Enter' && node && e.target === document.activeElement) selected = node.dataset.id;
  }}
  onhashchange={() => {
    const code = codeFromHash();
    if (code && code !== target) setTarget(code);
  }}
/>

<Header
  {courses}
  {target}
  {progress}
  {terms}
  onpick={setTarget}
  isOffered={(code) => offeredIn(code).length > 0}
  ondock={() => {
    view = 'graph';
    dockOpen = true;
  }}
  bind:view
  bind:maxDepth
  bind:hideTaken
/>

{#if view === 'schedule'}
  <ScheduleBuilder
    {courses}
    {terms}
    {offerings}
    {done}
    onopen={(code) => {
      setTarget(code);
      view = 'graph';
    }}
  />
{:else}
<main>
  <section class="canvas" class:list={view === 'list'}>
    {#if view === 'graph'}
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
        <FitOnChange key={layoutKey} anchor={target} />
      </SvelteFlow>
      <div class="legend">
        <span><i class="done"></i>Taken</span>
        <span><i class="ready"></i>Can take now</span>
        <span><i class="locked"></i>Prereqs missing</span>
        <span><i class="unknown"></i>Check requirements</span>
        <span><i class="missing"></i>Not in catalog</span>
        <span><TermPills terms={terms} /> offered (filled = this term)</span>
        <span class="hint">Tick a box to mark it taken · <b>+</b> shows more</span>
      </div>
    {:else}
      <ul class="tree">
        <PrereqList
          tree={target}
          {courses}
          {done}
          {hideTaken}
          {maxDepth}
          {expanded}
          {offeredIn}
          ontoggle={toggleDone}
          onselect={select}
          onexpand={(c) => expanded.add(c)}
        />
      </ul>
    {/if}
  </section>

  <aside bind:this={aside}>
    <div class="eyebrow">{selected === target ? 'Target course' : 'Selected course'}</div>
    <h2>{selected}</h2>
    <p class="course-title">{sel?.title ?? "This course isn't in SFU's current calendar."}</p>
    {#if sel}
      <p class="status {selStatus}">{statusLabel[selStatus]} · {sel.units} units</p>
    {/if}
    {#if selBadges.length}
      <div class="badges" aria-label="WQB and breadth designation">
        {#each selBadges as b (b.short)}<span class="badge" title={b.label}><b>{b.short}</b> {b.label}</span>{/each}
      </div>
    {/if}
    {#if selDetails?.description}
      <p class="desc" class:clamped={!descOpen}>{selDetails.description}</p>
      {#if selDetails.description.length > 220}
        <button class="link-btn" onclick={() => (descOpen = !descOpen)}>{descOpen ? 'Show less' : 'Show more'}</button>
      {/if}
    {/if}
    <div class="actions">
      <button class="primary" onclick={() => toggleDone(selected)}>
        {done.has(selected) ? 'Unmark as taken' : 'Mark as taken'}
      </button>
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

    <h3>Next steps toward {target}</h3>
    {#if done.has(target)}
      <p class="muted">You've taken {target}. Nice!</p>
    {:else if courseStatus(target, courses, done) === 'ready'}
      <p class="muted">You can take {target} now.</p>
    {:else if courseStatus(target, courses, done) === 'unknown' && !nextGroups.length}
      <p class="muted">
        You may be able to take {target} now. It has requirements that aren't SFU courses (like
        Pre-Calculus 12, a units count or permission), so check the calendar text below.
      </p>
    {:else if nextGroups.length}
      {#if courseStatus(target, courses, done) === 'unknown'}
        <p class="muted small">
          You may already qualify through a non-course requirement (see the calendar text). Otherwise:
        </p>
      {/if}
      <div class="next">
        {#each nextGroups as group (group.join())}
          {#if group.length > 1}<div class="next-or">One of</div>{/if}
          {#each group as code (code)}
            <button class="next-item" class:alt={group.length > 1} onclick={() => select(code)} title={courses[code].title}>
              <b>{code}</b>
              <span class="next-title">{courses[code].title}</span>
              <span class="next-terms">
                {#if offeredIn(code).length}<TermPills terms={offeredIn(code)} />{:else}<span class="muted">not scheduled</span>{/if}
              </span>
            </button>
          {/each}
        {/each}
      </div>
    {:else}
      <p class="muted">Tick the courses you've taken to see what's next.</p>
    {/if}

    <h3>When it runs</h3>
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
              {#each s.instructors as name}
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
      <p class="muted">Tick courses you've finished and the chart shows what you can take next.</p>
    {/if}
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

    <p class="source">
      Data: SFU Academic Calendar ({data.term.replace('/', ' ')}) and course outlines, fetched
      {new Date(offeringData.fetched).toLocaleDateString()}. Prerequisites are parsed from the
      calendar text automatically, so always check the original. RMP links search by name and may
      not match the right person.
    </p>
  </aside>
</main>
<ScheduleDock
  {courses}
  {terms}
  {offerings}
  {done}
  bind:open={dockOpen}
  onexpand={() => (view = 'schedule')}
  onopen={(code) => setTarget(code)}
/>
{/if}
