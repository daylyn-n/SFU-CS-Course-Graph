<!-- "Ratings" section of the side panel: summary, rate button and written
     reviews for one course. Also hosts the (single) rate dialog. -->
<script lang="ts">
  import RatingSummary from './RatingSummary.svelte';
  import RateDialog from './RateDialog.svelte';
  import { DIMENSIONS, summarize } from './aggregate';
  import { ratings } from './state.svelte';
  import { instructorsOf, termLabel } from './context';

  let { code }: { code: string } = $props();

  const list = $derived(ratings.get('course', code));
  const summary = $derived(list && summarize('course', list));
  const date = (ms: number) => new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short' });

  function rate() {
    ratings.open({ kind: 'course', subject: code, contexts: instructorsOf(code) });
  }
</script>

<h3>Ratings</h3>
<div class="ratings">
  {#if !summary}
    <p class="muted">{ratings.error ?? 'Loading ratings…'}</p>
  {:else if summary.count === 0}
    <div class="empty">
      <p>No ratings yet. Taken {code}? Say how easy and useful it was.</p>
      <button class="primary" onclick={rate}>Rate this course</button>
    </div>
  {:else}
    <RatingSummary {summary} />
    <button onclick={rate}>{summary.mine ? 'Edit your rating' : 'Rate this course'}</button>
  {/if}

  {#if summary?.reviews.length}
    <ul class="reviews">
      {#each summary.reviews as r (r.id)}
        <li>
          <div class="meta">
            {#if r.liked !== null}<span title={r.liked ? 'Liked it' : "Didn't like it"}>{r.liked ? '👍' : '👎'}</span>{/if}
            {#each DIMENSIONS.course as d, i (d.key)}<span class="score">{d.label} {r.scores[i]}/5</span>{/each}
            {#if r.mine}<span class="you">You</span>{/if}
          </div>
          <p>{r.review}</p>
          <div class="muted small">
            {[r.context && `with ${r.context}`, r.term && termLabel(r.term), date(r.updatedAt)].filter(Boolean).join(' · ')}
          </div>
        </li>
      {/each}
    </ul>
  {/if}

  {#if summary && !ratings.shared}
    <p class="muted small">Ratings are saved in this browser only, so you'll only see your own.</p>
  {/if}
</div>

<RateDialog />

<style>
  .ratings {
    display: grid;
    gap: 10px;
    justify-items: start;
  }
  .ratings > :global(*) {
    width: 100%;
  }
  .ratings > button {
    width: auto;
  }
  .empty {
    padding: 10px;
    border-radius: 8px;
    border: 1px dashed var(--border);
    font-size: 13px;
  }
  .empty p {
    margin: 0 0 8px;
  }
  .reviews {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  .reviews li {
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--bg);
    font-size: 13px;
  }
  .reviews p {
    margin: 4px 0;
    white-space: pre-line;
    overflow-wrap: anywhere;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .score {
    font-size: 11px;
    font-weight: 600;
    color: var(--muted);
  }
  .you {
    margin-left: auto;
    padding: 0 6px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    color: var(--ready);
    border: 1px solid var(--ready);
  }
  .small {
    font-size: 11px;
  }
</style>
