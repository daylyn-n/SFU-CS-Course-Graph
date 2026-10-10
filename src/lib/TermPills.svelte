<!-- Small badges for the terms a course is offered in, e.g. "Fa26 Sp27". -->
<script>
  let { terms } = $props();
</script>

{#each terms as t (t.id)}
  <span class="pill" class:current={t.current} title="Offered {t.label}">{t.short}</span>
{/each}

<style>
  .pill {
    display: inline-block;
    padding: 0 5px;
    border-radius: 4px;
    border: 1px solid var(--term);
    color: var(--term);
    font-size: 10px;
    font-weight: 600;
    line-height: 15px;
    vertical-align: 1px;
  }
  .pill.current {
    background: var(--term);
    color: var(--surface);
  }
</style>
