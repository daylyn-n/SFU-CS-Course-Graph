<!-- Side-panel toggle that puts one section of a course in the timetable. -->
<script lang="ts">
  import { timetable } from './timetableStore.svelte';

  let { code, termId, section }: { code: string; termId: string; section: string } = $props();

  const current = $derived(timetable.sectionOf(termId, code));
  const added = $derived(current === section);

  function toggle() {
    if (added) timetable.remove(termId, code);
    else timetable.set(termId, code, section);
  }
</script>

<button
  class="tt-add"
  class:added
  aria-pressed={added}
  onclick={toggle}
  title={added
    ? 'Remove from your timetable'
    : current
      ? `Switch your timetable from ${current} to ${section}`
      : 'Add this section to your timetable'}
>
  {added ? '✓ In timetable' : current ? `Switch to ${section}` : '+ Timetable'}
</button>

<style>
  .tt-add {
    float: right;
    padding: 1px 8px;
    border-radius: 999px;
    font-size: 11.5px;
    font-weight: 600;
    background: var(--surface);
    color: var(--accent-text);
  }
  .tt-add:hover {
    border-color: var(--accent);
  }
  .tt-add.added {
    border-color: var(--done);
    background: var(--done-bg);
    color: var(--done);
  }
</style>
