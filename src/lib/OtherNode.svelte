<!-- A non-course alternative such as "Pre-Calculus 12": shown, not tracked. -->
<script lang="ts">
  import { Handle, Position, type Node, type NodeProps } from '@xyflow/svelte';
  import type { OtherNodeData } from './graph';

  type Props = NodeProps<Node<OtherNodeData, 'other'>>;

  let { data }: Props = $props();
</script>

<div class="other" title="{data.label}: not tracked here, check it yourself">
  {data.label}
  <Handle type="source" position={Position.Right} />
</div>

<style>
  .other {
    width: 170px;
    height: 26px;
    box-sizing: border-box;
    padding: 0 10px;
    line-height: 23px;
    text-align: center;
    border-radius: 13px;
    border: 1.5px dashed var(--unknown);
    background: var(--unknown-bg);
    color: var(--unknown);
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
