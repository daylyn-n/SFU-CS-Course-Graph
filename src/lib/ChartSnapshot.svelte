<!-- Lets the share menu export the chart as a PNG. Must sit inside <SvelteFlow>. -->
<script lang="ts">
  import { useSvelteFlow, getViewportForBounds } from '@xyflow/svelte';
  import { registerChartSnapshot } from './share';

  const { getNodes, getNodesBounds } = useSvelteFlow();
  const PADDING = 40;
  const MAX_SIDE = 4096;

  // Renders the whole chart (not just what's on screen), following the
  // html-to-image recipe from the Svelte Flow docs.
  async function snapshot(): Promise<string> {
    const { toPng } = await import('html-to-image');
    const viewport = document.querySelector<HTMLElement>('.svelte-flow__viewport');
    if (!viewport) throw new Error('The chart is not on screen.');

    const bounds = getNodesBounds(getNodes());
    // Draw at 1:1, but cap the size so huge charts don't produce giant files.
    const scale = Math.min(1, MAX_SIDE / (bounds.width + PADDING * 2), MAX_SIDE / (bounds.height + PADDING * 2));
    const width = Math.ceil((bounds.width + PADDING * 2) * scale);
    const height = Math.ceil((bounds.height + PADDING * 2) * scale);
    const { x, y, zoom } = getViewportForBounds(bounds, width, height, 0.1, 2, `${PADDING * scale}px`);

    // html-to-image doesn't carry stylesheet rules onto SVG children, so edges
    // would come out without a stroke. Inline their computed paint while we render.
    const paths = [...viewport.querySelectorAll<SVGPathElement>('.svelte-flow__edge-path')];
    const saved = paths.map((p) => p.getAttribute('style'));
    for (const p of paths) {
      const cs = getComputedStyle(p);
      p.style.stroke = cs.stroke;
      p.style.strokeWidth = cs.strokeWidth;
      p.style.fill = 'none';
    }
    try {
      return await toPng(viewport, {
        backgroundColor: getComputedStyle(document.body).backgroundColor,
        width,
        height,
        pixelRatio: 2,
        style: { width: `${width}px`, height: `${height}px`, transform: `translate(${x}px, ${y}px) scale(${zoom})` },
      });
    } finally {
      paths.forEach((p, i) => (saved[i] === null ? p.removeAttribute('style') : p.setAttribute('style', saved[i]!)));
    }
  }

  $effect(() => registerChartSnapshot(snapshot));
</script>
