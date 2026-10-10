<script>
  import { setContext, untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { SvelteFlow, Background, Controls } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';

  import data from './data/courses.json';
  import { buildGraph, courseStatus } from './lib/graph.js';
  import CourseNode from './lib/CourseNode.svelte';
  import JunctionNode from './lib/JunctionNode.svelte';
  import FitOnChange from './lib/FitOnChange.svelte';
  import PrereqList from './lib/PrereqList.svelte';

  const courses = data.courses;
  const codes = Object.keys(courses);
  const nodeTypes = { course: CourseNode, junction: JunctionNode };
  const STORAGE_KEY = 'sfu-prereqs:taken';

  // Reverse lookup: which courses list this one as a prerequisite?
  const unlocks = {};
  for (const [code, c] of Object.entries(courses)) {
    for (const ref of new Set(JSON.stringify(c.prereq ?? '').match(/[A-Z]{2,5} \d{3}[A-Z]?/g))) {
      (unlocks[ref] ??= []).push(code);
    }
  }

  function codeFromHash() {
    const code = decodeURIComponent(location.hash.slice(1)).replace('-', ' ');
    return code in courses ? code : null;
  }

  function loadTaken() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    } catch {
      return [];
    }
  }

  const initial = codeFromHash() ?? 'CMPT 410';
  let target = $state(initial);
  let selected = $state(initial);
  let search = $state('');
  let maxDepth = $state(2);
  let hideTaken = $state(true);
  let view = $state(matchMedia('(max-width: 700px)').matches ? 'list' : 'graph');
  const done = new SvelteSet(loadTaken());
  const expanded = new SvelteSet();

  const graph = $derived(buildGraph(target, courses, done, { maxDepth, hideTaken, expanded }));
  // Svelte Flow needs writable arrays, so mirror the derived graph into state.
  let nodes = $state.raw(untrack(() => graph.nodes));
  let edges = $state.raw(untrack(() => graph.edges));
  $effect.pre(() => {
    nodes = graph.nodes;
    edges = graph.edges;
  });
  const layoutKey = $derived(graph.nodes.map((n) => n.id).join() + target);

  $effect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...done]));
    } catch {}
  });

  $effect(() => {
    const hash = '#' + target.replace(' ', '-');
    if (location.hash !== hash) history.replaceState(null, '', hash);
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

  function submitSearch() {
    const m = search.trim().toUpperCase().match(/^([A-Z]{2,5})\s*(\d{3}[A-Z]?)/);
    const code = m && `${m[1]} ${m[2]}`;
    if (code && code in courses) {
      setTarget(code);
      search = '';
    }
  }

  const sel = $derived(courses[selected]);
  const selStatus = $derived(courseStatus(selected, courses, done));
  const statusLabel = { done: 'Taken', ready: 'Can take now', locked: 'Prerequisites missing' };
</script>

<svelte:window onhashchange={() => codeFromHash() && setTarget(codeFromHash())} />

<header>
  <h1>SFU Prerequisite Map</h1>
  <form
    class="search"
    onsubmit={(e) => {
      e.preventDefault();
      submitSearch();
    }}
  >
    <input
      list="course-list"
      placeholder="Find a course, e.g. CMPT 410"
      bind:value={search}
      oninput={() => codes.includes(search.split(' — ')[0]) && submitSearch()}
      aria-label="Course to look up"
    />
    <datalist id="course-list">
      {#each codes as code}
        <option value="{code} — {courses[code].title}"></option>
      {/each}
    </datalist>
    <button type="submit">Go</button>
  </form>
  <div class="controls">
    <div class="seg" role="group" aria-label="View">
      <button class:on={view === 'graph'} onclick={() => (view = 'graph')}>Chart</button>
      <button class:on={view === 'list'} onclick={() => (view = 'list')}>List</button>
    </div>
    <label>
      Levels
      <select bind:value={maxDepth}>
        {#each [1, 2, 3, 4] as d}<option value={d}>{d}</option>{/each}
        <option value={Infinity}>All</option>
      </select>
    </label>
    <label><input type="checkbox" bind:checked={hideTaken} /> Hide what's behind taken courses</label>
  </div>
</header>

<main>
  <section class="canvas" class:list={view === 'list'}>
    {#if view === 'graph'}
      <SvelteFlow
        bind:nodes
        bind:edges
        {nodeTypes}
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        minZoom={0.2}
        onnodeclick={({ node }) => node.type === 'course' && (selected = node.id)}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} />
        <Controls showLock={false} />
        <FitOnChange key={layoutKey} />
      </SvelteFlow>
      <div class="legend">
        <span><i class="done"></i>Taken</span>
        <span><i class="ready"></i>Can take now</span>
        <span><i class="locked"></i>Not yet</span>
        <span><i class="missing"></i>Not in data</span>
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
          ontoggle={toggleDone}
          onselect={(c) => (selected = c)}
          onexpand={(c) => expanded.add(c)}
        />
      </ul>
    {/if}
  </section>

  <aside>
    <div class="eyebrow">{selected === target ? 'Target course' : 'Selected course'}</div>
    <h2>{selected}</h2>
    <p class="course-title">{sel?.title ?? 'This course is not in the loaded data.'}</p>
    {#if sel}
      <p class="status {selStatus}">{statusLabel[selStatus]} · {sel.units} units</p>
    {/if}
    <div class="actions">
      <button onclick={() => toggleDone(selected)}>
        {done.has(selected) ? 'Unmark as taken' : 'Mark as taken'}
      </button>
      {#if selected !== target && sel}
        <button onclick={() => setTarget(selected)}>Show its prerequisites</button>
      {/if}
    </div>

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

    <p class="source">Data: SFU Academic Calendar, {data.term.replace('/', ' ')}. Prerequisites are parsed from the calendar text automatically, so always check the original.</p>
  </aside>
</main>
