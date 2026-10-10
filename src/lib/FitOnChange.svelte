<!-- Re-centres the chart whenever `key` changes (i.e. the set of nodes changed).
     If fitting everything would make text unreadably small, it zooms to a
     readable level with the `anchor` node (the target) near the right edge;
     the rest of the chart is a pan away. -->
<script lang="ts">
  import { useSvelteFlow } from '@xyflow/svelte';

  interface Props {
    /** refit whenever this changes */
    key: unknown;
    /** node to keep in view when zooming in for readability */
    anchor: string;
  }

  let { key, anchor }: Props = $props();
  const { fitView, getNode, getNodes, getNodesBounds, getViewport, setViewport } = useSvelteFlow();
  const MIN_READABLE = 0.55;

  $effect(() => {
    key;
    let cancelled = false;
    // Wait briefly so Svelte Flow has measured the new nodes.
    const t = setTimeout(async () => {
      await fitView({ padding: 0.12, maxZoom: 1.2 });
      const node = getNode(anchor);
      const pane = document.querySelector('.svelte-flow');
      if (cancelled || !node || !pane || getViewport().zoom >= MIN_READABLE) return;
      const { width, height } = pane.getBoundingClientRect();
      const w = node.measured?.width ?? 224;
      const h = node.measured?.height ?? 60;
      const Z = MIN_READABLE;
      // Centre the anchor vertically, but don't leave empty space above or
      // below the chart: a short chart is centred as a whole, a tall one is
      // pinned to the top edge if the anchor sits near it.
      const b = getNodesBounds(getNodes());
      const pad = 24;
      const top = pad - b.y * Z;
      const bottom = height - pad - (b.y + b.height) * Z;
      let y = height / 2 - (node.position.y + h / 2) * Z;
      y = b.height * Z + 2 * pad <= height ? (top + bottom) / 2 : Math.min(top, Math.max(bottom, y));
      setViewport({ zoom: Z, x: width - 40 - (node.position.x + w) * Z, y }, { duration: 300 });
    }, 60);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  });
</script>
