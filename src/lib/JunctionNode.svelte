<script lang="ts">
  import { Handle, Position, type Node, type NodeProps } from '@xyflow/svelte';
  import type { JunctionNodeData } from './graph';

  type Props = NodeProps<Node<JunctionNodeData, 'junction'>>;

  let { data }: Props = $props();
</script>

<div class="junction" class:met={data.met}>
  <Handle type="target" position={Position.Left} />
  {data.label}
  <Handle type="source" position={Position.Right} />
</div>

<style>
  .junction {
    width: 64px;
    height: 26px;
    box-sizing: border-box;
    display: grid;
    place-items: center;
    border-radius: 13px;
    border: 1.5px solid var(--locked-border);
    background: var(--surface);
    color: var(--muted);
    font-size: 11px;
    font-weight: 600;
  }
  .junction.met {
    border-color: var(--done);
    color: var(--done);
  }
</style>
