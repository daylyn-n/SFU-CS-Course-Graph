<!-- Re-centres the chart whenever `key` changes (i.e. the set of nodes changed). -->
<script lang="ts">
  import { useSvelteFlow } from '@xyflow/svelte';

  interface Props {
    /** refit whenever this changes */
    key: unknown;
  }

  let { key }: Props = $props();
  const { fitView } = useSvelteFlow();

  $effect(() => {
    key;
    // Wait briefly so Svelte Flow has measured the new nodes.
    const t = setTimeout(() => fitView({ duration: 300, padding: 0.12, maxZoom: 1.2 }), 60);
    return () => clearTimeout(t);
  });
</script>
