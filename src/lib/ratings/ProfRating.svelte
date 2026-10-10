<!-- An instructor's Clear/Engaging summary (across all their courses) and a
     "Rate" button, shown next to their name in the side panel. -->
<script lang="ts">
  import RatingSummary from './RatingSummary.svelte';
  import { summarize } from './aggregate';
  import { ratings } from './state.svelte';
  import { coursesTaughtBy } from './context';

  let { name, course }: { name: string; course: string } = $props();

  const list = $derived(ratings.get('prof', name));
  const summary = $derived(list && summarize('prof', list));

  function rate() {
    const taught = coursesTaughtBy(name);
    ratings.open({
      kind: 'prof',
      subject: name,
      contexts: taught.includes(course) ? taught : [course, ...taught],
      context: course,
    });
  }
</script>

<span class="prof-rating">
  {#if summary?.count}<RatingSummary {summary} compact />{/if}
  <button class="rate" onclick={rate} aria-label="{summary?.mine ? 'Edit your rating of' : 'Rate'} {name}">{summary?.mine ? 'Edit rating' : 'Rate'}</button>
</span>

<style>
  .prof-rating {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 8px;
  }
  .rate {
    padding: 0 6px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    line-height: 16px;
    color: var(--muted);
  }
  .rate:hover {
    color: var(--accent-text);
    border-color: var(--accent);
  }
</style>
