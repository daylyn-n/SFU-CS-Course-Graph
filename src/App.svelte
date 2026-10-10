<script lang="ts">
  import { untrack } from 'svelte';
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import { SvelteFlow, Background, Controls, ControlButton } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';

  import data from './data/courses.json';
  import offeringData from './data/offerings.json';
  import { buildGraph, courseStatus } from './lib/graph';
  import CourseNode from './lib/CourseNode.svelte';
  import JunctionNode from './lib/JunctionNode.svelte';
  import FitOnChange from './lib/FitOnChange.svelte';
  import PrereqList from './lib/PrereqList.svelte';
  import TermPills from './lib/TermPills.svelte';
  import Header from './lib/Header.svelte';
  import { setActions } from './lib/context';
  import type { Courses, Offerings, Status, Term, View } from './lib/types';
  import ExploreView from './lib/ExploreView.svelte';
  import PlanView from './lib/PlanView.svelte';

  // JSON imports infer loose types (e.g. op: string), so assert the real shapes.
  const courses = data.courses as unknown as Courses;
  const nodeTypes = { course: CourseNode, junction: JunctionNode };
  const STORAGE_KEY = 'sfu-prereqs:taken';
  const RMP_SCHOOL_ID = 1482; // Simon Fraser University on ratemyprofessors.com

  const { terms, offerings } = offeringData as unknown as { terms: Term[]; offerings: Offerings };
  const offeredIn = (code: string): Term[] => terms.filter((t) => offerings[code]?.[t.id]);
  const rmpUrl = (name: string) =>
    `https://www.ratemyprofessors.com/search/professors/${RMP_SCHOOL_ID}?q=${encodeURIComponent(name)}`;

  // Reverse lookup: which courses list this one as a prerequisite?
  const unlocks: Record<string, string[]> = {};
  for (const [code, c] of Object.entries(courses)) {
    for (const ref of new Set(JSON.stringify(c.prereq ?? '').match(/[A-Z]{2,5} \d{3}[A-Z]?/g))) {
      (unlocks[ref] ??= []).push(code);
    }
  }

  function codeFromHash(): string | null {
    const code = decodeURIComponent(location.hash.slice(1)).replace('-', ' ');
    return code in courses ? code : null;
  }

  function loadTaken(): string[] {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    } catch {
      return [];
    }
  }

  const initial = codeFromHash() ?? 'CMPT 410';
  let target = $state(initial);
  let selected = $state(initial);
  let maxDepth = $state(2);
  let hideTaken = $state(true);
  let view = $state<View>(matchMedia('(max-width: 700px)').matches ? 'list' : 'graph');
  const done = new SvelteSet<string>(loadTaken());
  const expanded = new SvelteSet<string>();

  const graph = $derived(buildGraph(target, courses, done, { maxDepth, hideTaken, expanded, offeredIn }));
  // Where the user has dragged blocks to. Kept across re-layouts (ticking a
  // box, expanding) and cleared when the target changes.
  const moved = new SvelteMap<string, { x: number; y: number }>();
  const placed = $derived(
    graph.nodes.map((n) => (moved.has(n.id) ? { ...n, position: moved.get(n.id)! } : n)),
  );
  // Svelte Flow needs writable arrays, so mirror the derived graph into state.
  let nodes = $state.raw(untrack(() => placed));
  let edges = $state.raw(untrack(() => graph.edges));
  $effect.pre(() => {
    nodes = placed;
    edges = graph.edges;
  });
  const progress = $derived.by(() => {
    const counts: Record<Status, number> = { done: 0, ready: 0, locked: 0 };
    for (const n of graph.nodes) {
      if (n.type === 'course' && n.id !== target) counts[n.data.status]++;
    }
    return counts;
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

  function setTarget(code: string) {
    target = code;
    selected = code;
    expanded.clear();
    moved.clear();
  }

  function toggleDone(code: string) {
    if (done.has(code)) done.delete(code);
    else done.add(code);
  }

  setActions({
    toggleDone,
    expand: (code) => expanded.add(code),
  });


  const sel = $derived(courses[selected]);
  const selStatus = $derived(courseStatus(selected, courses, done));
  const statusLabel: Record<Status, string> = { done: 'Taken', ready: 'Can take now', locked: 'Prerequisites missing' };
</script>

<svelte:window onhashchange={() => codeFromHash() && setTarget(codeFromHash()!)} />

<Header
  {courses}
  {target}
  {progress}
  {terms}
  onpick={setTarget}
  bind:view
  bind:maxDepth
  bind:hideTaken
/>

<main>
  <section class="canvas" class:list={view !== 'graph'}>
    {#if view === 'graph'}
      <SvelteFlow
        bind:nodes
        bind:edges
        {nodeTypes}
        fitView
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable={false}
        minZoom={0.2}
        onnodeclick={({ node }) => node.type === 'course' && (selected = node.id)}
        onnodedragstop={({ nodes: dragged }) => {
          for (const n of dragged) moved.set(n.id, { ...n.position });
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} />
        <Controls showLock={false}>
          {#if moved.size}
            <ControlButton onclick={() => moved.clear()} title="Reset layout" aria-label="Reset layout">
              <svg viewBox="0 0 24 24" aria-hidden="true"
                ><path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4" fill="none" stroke="currentColor" stroke-width="2.2" /></svg
              >
            </ControlButton>
          {/if}
        </Controls>
        <FitOnChange key={layoutKey} />
      </SvelteFlow>
      <div class="legend">
        <span><i class="done"></i>Taken</span>
        <span><i class="ready"></i>Can take now</span>
        <span><i class="locked"></i>Not yet</span>
        <span><i class="missing"></i>Not in data</span>
        <span><TermPills terms={terms} /> offered (filled = this term)</span>
        <span class="hint">Tick a box to mark it taken · <b>+</b> shows more · drag to rearrange</span>
      </div>
    {:else if view === 'explore'}
      <ExploreView
        {courses}
        {done}
        {terms}
        {offeredIn}
        {selected}
        onselect={(c) => (selected = c)}
        ontoggle={toggleDone}
        ontarget={(c) => {
          setTarget(c);
          view = matchMedia('(max-width: 700px)').matches ? 'list' : 'graph';
        }}
      />
    {:else if view === 'plan'}
      <PlanView {target} {courses} {done} {terms} {offerings} {selected} onselect={(c) => (selected = c)} />
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
      <button class="primary" onclick={() => toggleDone(selected)}>
        {done.has(selected) ? 'Unmark as taken' : 'Mark as taken'}
      </button>
      {#if selected !== target && sel}
        <button onclick={() => setTarget(selected)}>Show its prerequisites</button>
      {/if}
    </div>

    <h3>When it runs</h3>
    {#each terms as term (term.id)}
      {@const sections = offerings[selected]?.[term.id]}
      <div class="term">
        <div class="term-name">
          {term.label}{term.current ? ' (this term)' : ''}
          {#if !sections}<span class="muted"> · not offered</span>{/if}
        </div>
        {#each sections ?? [] as s (s.section)}
          <div class="section">
            <div class="section-head">
              <b>{s.section}</b>
              {[s.campus, s.delivery].filter(Boolean).join(' · ')}
            </div>
            {#if s.schedule}<div class="muted">{s.schedule}</div>{/if}
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

    <p class="source">
      Data: SFU Academic Calendar ({data.term.replace('/', ' ')}) and course outlines, fetched
      {new Date(offeringData.fetched).toLocaleDateString()}. Prerequisites are parsed from the
      calendar text automatically, so always check the original. RMP links search by name and may
      not match the right person.
    </p>
  </aside>
</main>
