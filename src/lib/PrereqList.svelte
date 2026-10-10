<!-- Indented checklist version of the chart, for small screens. -->
<script>
  import Self from './PrereqList.svelte';
  import { courseStatus, satisfied } from './graph.js';
  import TermPills from './TermPills.svelte';

  // tree: a course code string, { other: label } for a non-course alternative,
  // or { op, args }. `flat` is set for a course's own prerequisites, where an
  // AND just means "list them all" with no header.
  let {
    tree,
    courses,
    done,
    hideTaken,
    ontoggle,
    onselect,
    maxDepth,
    expanded,
    onexpand,
    offeredIn,
    ancestors = [],
    flat = false,
  } = $props();
  const shared = $derived({
    courses,
    done,
    hideTaken,
    ontoggle,
    onselect,
    maxDepth,
    expanded,
    onexpand,
    offeredIn,
  });
  // High school courses come with "(or equivalent)" in the calendar.
  const otherText = (label) => (/\b1[12]$|^(AP|IB) /.test(label) ? `${label} (or equivalent)` : label);
</script>

{#if typeof tree === 'string'}
  {@const course = courses[tree]}
  {@const status = courseStatus(tree, courses, done)}
  {@const showable = course?.prereq && !(hideTaken && done.has(tree)) && !ancestors.includes(tree)}
  {@const open = showable && (ancestors.length < maxDepth || expanded.has(tree))}
  <li>
    <div class="row {status}">
      <input
        type="checkbox"
        checked={status === 'done'}
        onchange={() => ontoggle(tree)}
        aria-label="Mark {tree} as taken"
      />
      <button class="link" onclick={() => onselect(tree)}>{tree}</button>
      <span class="terms"><TermPills terms={offeredIn(tree)} /></span>
      {#if showable && !open}
        <button class="more" onclick={() => onexpand(tree)} title="Show prerequisites">+</button>
      {/if}
      <span class="title">{course?.title ?? 'Not in catalog'}</span>
    </div>
    {#if open}
      <ul>
        <Self tree={course.prereq} {...shared} ancestors={[...ancestors, tree]} flat />
      </ul>
    {/if}
  </li>
{:else if tree.other}
  <li>
    <div class="row other" title="Not tracked here: check it yourself">{otherText(tree.other)}</div>
  </li>
{:else if tree.op === 'and' && flat}
  {#each tree.args as arg}
    <Self tree={arg} {...shared} {ancestors} />
  {/each}
{:else}
  <li>
    <div class="group" class:met={satisfied(tree, done)}>
      {tree.op === 'or' ? 'One of:' : 'All of:'}
    </div>
    <ul>
      {#each tree.args as arg}
        <Self tree={arg} {...shared} {ancestors} />
      {/each}
    </ul>
  </li>
{/if}

<style>
  li {
    list-style: none;
  }
  ul {
    margin: 0;
    padding-left: 22px;
    border-left: 1px solid var(--border);
    margin-left: 7px;
  }
  .row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 4px 0;
  }
  .row input {
    accent-color: var(--done);
    transform: translateY(2px);
  }
  .link {
    all: unset;
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
  }
  .link:hover {
    color: var(--accent);
    text-decoration: underline;
  }
  .row.ready .link {
    color: var(--ready);
  }
  .row.unknown .link {
    color: var(--unknown);
  }
  .row.done .link {
    color: var(--done);
  }
  .terms {
    display: inline-flex;
    gap: 3px;
    align-self: center;
  }
  .terms:empty {
    display: none;
  }
  .title {
    color: var(--muted);
    font-size: 13px;
  }
  .more {
    width: 20px;
    height: 20px;
    padding: 0;
    border-radius: 50%;
    line-height: 1;
    align-self: center;
  }
  @media (max-width: 700px) {
    .row input {
      width: 20px;
      height: 20px;
    }
    .more {
      width: 28px;
      height: 28px;
    }
    ul {
      padding-left: 12px;
      margin-left: 6px;
    }
    .row {
      flex-wrap: wrap;
      column-gap: 6px;
      row-gap: 0;
    }
  }
  .row.other {
    color: var(--muted);
    font-style: italic;
    padding-left: 22px;
  }
  .group {
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
    padding: 4px 0;
  }
  .group.met {
    color: var(--done);
  }
</style>
