<script lang="ts">
  import { Handle, Position, type Node, type NodeProps } from '@xyflow/svelte';
  import TermPills from './TermPills.svelte';
  import { getActions } from './context';
  import type { CourseNodeData } from './graph';

  type Props = NodeProps<Node<CourseNodeData, 'course'>>;

  let { data }: Props = $props();
  const actions = getActions();
</script>

<div
  class="course {data.status}"
  class:is-target={data.isTarget}
  class:missing={data.missing}
  class:assumed={data.inferred === 'assumed'}
  title={data.inferred
    ? `${data.title}\n${data.inferred === 'assumed' ? 'Assumed taken' : 'Taken'}: prerequisite of ${data.via}`
    : data.title}
>
  <Handle type="target" position={Position.Left} />
  <input
    class="check nodrag"
    type="checkbox"
    checked={data.status === 'done'}
    onclick={(e) => e.stopPropagation()}
    onchange={() => actions.toggleDone(data.code)}
    aria-label={data.inferred ? `${data.code} is assumed taken; untick if you didn't take it` : `Mark ${data.code} as taken`}
  />
  <div class="text">
    <div class="code">{data.code} <TermPills terms={data.offered} /></div>
    <div class="title">{data.title}</div>
  </div>
  {#if data.collapsed}
    <button
      class="more nodrag"
      onclick={(e) => {
        e.stopPropagation();
        actions.expand(data.code);
      }}
      title="Show prerequisites">+</button
    >
  {/if}
  <Handle type="source" position={Position.Right} />
</div>

<style>
  .course {
    position: relative;
    width: 200px;
    height: 60px;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px;
    border-radius: 10px;
    border: 1.5px solid var(--locked-border);
    background: var(--locked-bg);
    color: var(--text);
    cursor: pointer;
  }
  .course.ready {
    border-color: var(--ready);
    background: var(--ready-bg);
  }
  .course.unknown {
    border-color: var(--unknown);
    border-style: dashed;
    background: var(--unknown-bg);
  }
  .course.done.assumed {
    border-style: dashed;
    background: color-mix(in srgb, var(--done-bg) 55%, var(--locked-bg));
  }
  .course.done.assumed .check {
    opacity: 0.6;
  }
  .course.done {
    border-color: var(--done);
    background: var(--done-bg);
  }
  .course.is-target {
    box-shadow: 0 0 0 3px var(--accent);
  }
  .course.missing {
    border-style: dashed;
    opacity: 0.75;
  }
  .text {
    min-width: 0;
    flex: 1;
  }
  .code {
    font-weight: 700;
    font-size: 14px;
    white-space: nowrap;
  }
  .title {
    font-size: 11px;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .check {
    width: 16px;
    height: 16px;
    margin: 0;
    accent-color: var(--done);
    cursor: pointer;
  }
  .more {
    position: absolute;
    left: -11px;
    top: 50%;
    transform: translateY(-50%);
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 1.5px solid var(--locked-border);
    background: var(--surface);
    color: var(--text);
    font-size: 14px;
    line-height: 1;
    padding: 0;
    cursor: pointer;
    z-index: 1;
  }
  .more:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  :global(.svelte-flow__handle) {
    opacity: 0;
    pointer-events: none;
  }
</style>
