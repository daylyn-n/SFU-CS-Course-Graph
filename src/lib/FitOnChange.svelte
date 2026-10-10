<!-- Re-centres the chart whenever `key` changes (i.e. the set of nodes changed).
     If fitting everything would make text unreadably small, it zooms to a
     readable level with the `anchor` node (the target) near the right edge;
     the rest of the chart is a pan away. -->
<script>
  import { useSvelteFlow } from '@xyflow/svelte';

  let { key, anchor } = $props();
  const { fitView, getNode, getViewport, setViewport } = useSvelteFlow();
  const MIN_READABLE = 0.55;

  $effect(() => {
    key;
    let cancelled = false;
    // Wait briefly so Svelte Flow has measured the new nodes.
    const t = setTimeout(async () => {
      await fitView({ padding: 0.12, maxZoom: 1.2 });
      const node = getNode(anchor);
      if (cancelled || !node || getViewport().zoom >= MIN_READABLE) return;
      const pane = document.querySelector('.svelte-flow');
      const { width, height } = pane.getBoundingClientRect();
      const w = node.measured?.width ?? 200;
      const h = node.measured?.height ?? 60;
      setViewport(
        {
          zoom: MIN_READABLE,
          x: width - 40 - (node.position.x + w) * MIN_READABLE,
          y: height / 2 - (node.position.y + h / 2) * MIN_READABLE,
        },
        { duration: 300 },
      );
    }, 60);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  });
</script>
