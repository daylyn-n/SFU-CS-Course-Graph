<!-- Two percentage meters plus a rating count, e.g. "Easy 72% · Useful 85% · 14 ratings".
     `compact` fits on one line next to an instructor's name. -->
<script lang="ts">
  import type { Summary } from './aggregate';

  let { summary, compact = false }: { summary: Summary; compact?: boolean } = $props();

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
</script>

{#if compact}
  <span class="compact" title={plural(summary.count, 'rating')}>
    {#each summary.dims as d (d.key)}
      <span class="dim">
        {d.label}
        <span class="bar" role="img" aria-label="{d.label} {d.percent}%"><i style:width="{d.percent}%"></i></span>
        <b>{d.percent}%</b>
      </span>
    {/each}
    <span class="count">({summary.count})</span>
  </span>
{:else}
  <div class="full">
    {#if summary.liked.percent !== null}
      <div class="headline">
        <b>{summary.liked.percent}%</b> liked it
        <span class="muted">({summary.liked.count} answered)</span>
      </div>
    {/if}
    {#each summary.dims as d (d.key)}
      <div class="row">
        <span class="label">{d.label}</span>
        <span class="bar" role="img" aria-label="{d.label} {d.percent}%"><i style:width="{d.percent}%"></i></span>
        <b class="pct">{d.percent}%</b>
      </div>
    {/each}
    <div class="muted count">{plural(summary.count, 'rating')}</div>
  </div>
{/if}

<style>
  .bar {
    display: inline-block;
    position: relative;
    height: 6px;
    border-radius: 3px;
    background: var(--border);
    overflow: hidden;
  }
  .bar i {
    position: absolute;
    inset: 0 auto 0 0;
    border-radius: 3px;
    background: var(--ready);
  }

  .full {
    display: grid;
    gap: 6px;
  }
  .headline {
    font-size: 13px;
  }
  .headline b {
    font-size: 20px;
    color: var(--done);
    margin-right: 2px;
  }
  .row {
    display: grid;
    grid-template-columns: 62px 1fr 38px;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }
  .row .bar {
    height: 8px;
    border-radius: 4px;
  }
  .pct {
    text-align: right;
  }
  .count {
    font-size: 12px;
  }

  .compact {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 8px;
    font-size: 11px;
    color: var(--muted);
  }
  .dim {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .dim .bar {
    width: 24px;
    height: 4px;
  }
  .dim b {
    color: var(--text);
    font-weight: 600;
  }
</style>
