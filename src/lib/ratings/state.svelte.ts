// Shared, reactive ratings cache for the UI. Components ask for a subject's
// ratings with `ratings.get()`; requests made in the same tick are batched into
// one store query per kind, so a side panel full of instructors is one fetch.
import { SvelteMap } from 'svelte/reactivity';
import { createRatingsStore } from './index';
import type { Rating, RatingInput, RatingKind } from './aggregate';

/** What the rate dialog is open for. */
export interface RateRequest {
  kind: RatingKind;
  subject: string;
  /** choices for the "taken with" (course) or "for which course" (prof) select */
  contexts: string[];
  /** preselected context, e.g. the course the side panel is showing */
  context?: string;
}

const keyOf = (kind: RatingKind, subject: string) => `${kind}:${subject}`;

class RatingsState {
  readonly store = createRatingsStore();
  /** rate dialog request, null when closed */
  dialog = $state<RateRequest | null>(null);
  /** last load error, shown once in the side panel */
  error = $state<string | null>(null);

  #cache = new SvelteMap<string, Rating[]>();
  #requested = new Set<string>();
  #queue: Record<RatingKind, Set<string>> = { course: new Set(), prof: new Set() };
  #flushing = false;

  get shared() {
    return this.store.shared;
  }

  /** Ratings for a subject, or undefined while they load. Safe to call from markup. */
  get(kind: RatingKind, subject: string): Rating[] | undefined {
    const key = keyOf(kind, subject);
    if (!this.#requested.has(key)) {
      this.#requested.add(key);
      this.#queue[kind].add(subject);
      if (!this.#flushing) {
        this.#flushing = true;
        queueMicrotask(() => this.#flush());
      }
    }
    return this.#cache.get(key);
  }

  async #flush() {
    this.#flushing = false;
    for (const kind of ['course', 'prof'] as const) {
      const subjects = [...this.#queue[kind]];
      this.#queue[kind].clear();
      if (!subjects.length) continue;
      try {
        const found = await this.store.list(kind, subjects);
        for (const s of subjects) {
          this.#cache.set(
            keyOf(kind, s),
            found.filter((r) => r.subject === s),
          );
        }
      } catch (e) {
        // Not retried automatically: a re-render would just fail again.
        this.error = `Couldn't load ratings: ${message(e)}`;
      }
    }
  }

  async save(input: RatingInput) {
    const saved = await this.store.save(input);
    this.#replaceMine(saved.kind, saved.subject, saved);
    return saved;
  }

  async remove(kind: RatingKind, subject: string) {
    await this.store.remove(kind, subject);
    this.#replaceMine(kind, subject, null);
  }

  #replaceMine(kind: RatingKind, subject: string, rating: Rating | null) {
    const key = keyOf(kind, subject);
    const others = (this.#cache.get(key) ?? []).filter((r) => !r.mine);
    this.#cache.set(key, rating ? [...others, rating] : others);
  }

  open(request: RateRequest) {
    this.dialog = request;
  }
}

export function message(e: unknown): string {
  return e instanceof Error ? e.message : String((e as { message?: unknown })?.message ?? e);
}

export const ratings = new RatingsState();
