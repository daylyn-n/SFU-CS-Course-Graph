<!-- Modal for adding or editing this browser's rating of a course or prof.
     Opens whenever `ratings.dialog` is set; Esc or clicking outside closes it. -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { DIMENSIONS, REVIEW_MAX, type Rating, type Score } from './aggregate';
  import { ratings, message } from './state.svelte';
  import { termOptions } from './context';

  let dialog: HTMLDialogElement;
  const req = $derived(ratings.dialog);
  const dims = $derived(req ? DIMENSIONS[req.kind] : DIMENSIONS.course);

  let scores = $state<(Score | null)[]>([null, null]);
  let liked = $state<boolean | null>(null);
  let review = $state('');
  let term = $state('');
  let context = $state('');
  let existing = $state<Rating | null>(null);
  let busy = $state(false);
  let error = $state<string | null>(null);

  const ready = $derived(scores.every((s) => s !== null) && !busy);

  // Open/close the native dialog to match ratings.dialog, prefilling the form
  // with any rating already given from this browser.
  $effect(() => {
    const r = req;
    if (!r) {
      if (dialog.open) dialog.close();
      return;
    }
    untrack(() => {
      const mine = ratings.get(r.kind, r.subject)?.find((x) => x.mine) ?? null;
      existing = mine;
      scores = mine ? [...mine.scores] : [null, null];
      liked = mine?.liked ?? null;
      review = mine?.review ?? '';
      term = mine?.term ?? '';
      context = mine ? (mine.context ?? '') : (r.context ?? '');
      error = null;
      busy = false;
      if (!dialog.open) dialog.showModal();
    });
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!req || !ready) return;
    busy = true;
    error = null;
    try {
      await ratings.save({
        kind: req.kind,
        subject: req.subject,
        scores: scores as [Score, Score],
        liked,
        review,
        term: term || null,
        context: context || null,
      });
      ratings.dialog = null;
    } catch (err) {
      error = `Couldn't save: ${message(err)}`;
    } finally {
      busy = false;
    }
  }

  async function remove() {
    if (!req) return;
    busy = true;
    try {
      await ratings.remove(req.kind, req.subject);
      ratings.dialog = null;
    } catch (err) {
      error = `Couldn't delete: ${message(err)}`;
    } finally {
      busy = false;
    }
  }
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="rate-title"
  onclose={() => (ratings.dialog = null)}
  onclick={(e) => e.target === dialog && dialog.close()}
>
  {#if req}
    <form onsubmit={submit}>
      <header>
        <h2 id="rate-title">{existing ? 'Edit your rating' : 'Rate'} · {req.subject}</h2>
        <button type="button" class="close" aria-label="Close" onclick={() => dialog.close()}>×</button>
      </header>

      {#each dims as d, i (d.key)}
        <fieldset class="scale">
          <legend>How {d.label.toLowerCase()} {req.kind === 'course' ? 'was it' : 'were they'}?</legend>
          <div class="segments">
            {#each [1, 2, 3, 4, 5] as const as n (n)}
              <label>
                <input type="radio" name={d.key} value={n} bind:group={scores[i]} required />
                <span>{n}</span>
              </label>
            {/each}
          </div>
          <div class="ends"><span>{d.low}</span><span>{d.high}</span></div>
        </fieldset>
      {/each}

      <fieldset class="liked">
        <legend>Would you recommend {req.kind === 'course' ? 'it' : 'them'}? <span class="optional">optional</span></legend>
        <div class="segments two">
          <label><input type="radio" name="liked" value={true} bind:group={liked} /><span>👍 Yes</span></label>
          <label><input type="radio" name="liked" value={false} bind:group={liked} /><span>👎 No</span></label>
        </div>
        {#if liked !== null}
          <button type="button" class="link" onclick={() => (liked = null)}>Clear</button>
        {/if}
      </fieldset>

      <div class="selects">
        <label>
          {req.kind === 'course' ? 'Taken with' : 'For course'}
          <select bind:value={context}>
            <option value="">Not saying</option>
            {#each req.contexts as c (c)}<option value={c}>{c}</option>{/each}
            {#if context && !req.contexts.includes(context)}<option value={context}>{context}</option>{/if}
          </select>
        </label>
        <label>
          Term
          <select bind:value={term}>
            <option value="">Not saying</option>
            {#each termOptions as t (t.id)}<option value={t.id}>{t.label}</option>{/each}
            {#if term && !termOptions.some((t) => t.id === term)}<option value={term}>{term}</option>{/if}
          </select>
        </label>
      </div>

      <label class="review">
        <span>Review <span class="optional">optional</span></span>
        <textarea
          bind:value={review}
          maxlength={REVIEW_MAX}
          rows="4"
          placeholder={req.kind === 'course'
            ? 'Workload, exams, what helped, who it suits…'
            : 'Lectures, office hours, marking, how they explain things…'}
        ></textarea>
        <span class="counter">{review.length}/{REVIEW_MAX}</span>
      </label>

      {#if error}<p class="error" role="alert">{error}</p>{/if}
      {#if !ratings.shared}
        <p class="note">Saved in this browser only. Ratings aren't shared with other students yet.</p>
      {/if}

      <footer>
        {#if existing}
          <button type="button" class="danger" onclick={remove} disabled={busy}>Delete</button>
        {/if}
        <span class="spacer"></span>
        <button type="button" onclick={() => dialog.close()}>Cancel</button>
        <button type="submit" class="primary" disabled={!ready}>{busy ? 'Saving…' : existing ? 'Update' : 'Submit'}</button>
      </footer>
    </form>
  {/if}
</dialog>

<style>
  dialog {
    width: min(440px, calc(100vw - 32px));
    max-height: calc(100vh - 32px);
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 12px 40px rgb(0 0 0 / 0.25);
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.4);
  }
  form {
    display: grid;
    gap: 14px;
    padding: 16px 18px 18px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  h2 {
    flex: 1;
    margin: 0;
    font-size: 17px;
    color: var(--accent-text);
  }
  .close {
    border: none;
    background: none;
    font-size: 22px;
    line-height: 1;
    padding: 2px 6px;
    color: var(--muted);
  }
  fieldset {
    margin: 0;
    padding: 0;
    border: none;
    min-width: 0;
  }
  legend {
    padding: 0;
    margin-bottom: 6px;
    font-weight: 600;
  }
  .optional {
    font-weight: 400;
    font-size: 12px;
    color: var(--muted);
  }

  /* Radio buttons drawn as a segmented control. */
  .segments {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
  }
  .segments.two {
    grid-template-columns: 1fr 1fr;
  }
  .segments label {
    position: relative;
  }
  .segments label + label {
    border-left: 1px solid var(--border);
  }
  .segments input {
    position: absolute;
    opacity: 0;
    inset: 0;
    margin: 0;
    cursor: pointer;
  }
  .segments span {
    display: block;
    padding: 7px 0;
    text-align: center;
    font-weight: 600;
    cursor: pointer;
  }
  .segments label:hover span {
    background: var(--bg);
  }
  .segments input:checked + span {
    background: var(--sfu-red);
    color: #fff;
  }
  .segments input:focus-visible + span {
    outline: 2px solid var(--ready);
    outline-offset: -3px;
  }
  .ends {
    display: flex;
    justify-content: space-between;
    margin-top: 3px;
    font-size: 11px;
    color: var(--muted);
  }
  .link {
    margin-top: 4px;
    padding: 0;
    border: none;
    background: none;
    font-size: 12px;
    color: var(--accent-text);
    text-decoration: underline;
  }

  .selects {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .selects label,
  .review {
    display: grid;
    gap: 4px;
    font-weight: 600;
    min-width: 0;
  }
  .selects select {
    font-weight: 400;
    padding: 6px 8px;
    min-width: 0;
  }
  textarea {
    font: inherit;
    font-weight: 400;
    color: inherit;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px 10px;
    resize: vertical;
  }
  textarea:focus,
  select:focus {
    outline: 2px solid var(--ready);
    outline-offset: -1px;
  }
  .counter {
    justify-self: end;
    font-size: 11px;
    font-weight: 400;
    color: var(--muted);
  }
  .note,
  .error {
    margin: 0;
    font-size: 12px;
  }
  .note {
    color: var(--muted);
  }
  .error {
    color: var(--accent-text);
  }

  footer {
    display: flex;
    gap: 8px;
  }
  .spacer {
    flex: 1;
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .danger {
    color: var(--accent-text);
  }

  @media (max-width: 420px) {
    .selects {
      grid-template-columns: 1fr;
    }
  }
</style>
