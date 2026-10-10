<!-- Flags a course that isn't running in every upcoming term: "Sp27 only",
     or "Not offered" when it runs in none. Shows nothing when it runs in all. -->
<script lang="ts">
  import type { Term } from './types';

  interface Props {
    /** terms the course runs in */
    offered: Term[];
    /** every upcoming term */
    terms: Term[];
  }

  let { offered, terms }: Props = $props();
</script>

{#if !offered.length}
  <span class="badge none" title="Not scheduled in {terms.map((t) => t.label).join(' or ')}">Not offered</span>
{:else if offered.length < terms.length}
  <span class="badge" title="Offered {offered.map((t) => t.label).join(' and ')} only"
    >{offered.map((t) => t.short).join('/')} only</span
  >
{/if}

<style>
  .badge {
    display: inline-block;
    padding: 0 5px;
    border-radius: 4px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    font-size: 10px;
    font-weight: 600;
    line-height: 15px;
    white-space: nowrap;
    vertical-align: 1px;
  }
  .badge.none {
    color: var(--muted);
    font-weight: 500;
    border-style: dashed;
    background: transparent;
  }
</style>
