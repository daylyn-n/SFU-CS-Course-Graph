-- Shared course and professor ratings for the SFU Prerequisite Map.
-- Run once in the Supabase SQL editor (safe to re-run).
--
-- There are no user accounts. Each browser makes up a random uuid ("author")
-- and keeps it in localStorage. Anyone can read ratings, but the author column
-- is hidden from the API and all writes go through the functions below, which
-- only touch rows matching the caller's author id. So the id works like a
-- password for that browser's own ratings, and one browser gets one rating per
-- course or prof.

create table if not exists public.ratings (
  id bigint generated always as identity primary key,
  author uuid not null,
  kind text not null check (kind in ('course', 'prof')),
  -- course code ("CMPT 225") or instructor name
  subject text not null check (char_length(subject) between 1 and 80),
  -- course: easy, useful. prof: clear, engaging. 1 (worst) to 5 (best).
  score_a smallint not null check (score_a between 1 and 5),
  score_b smallint not null check (score_b between 1 and 5),
  liked boolean,
  review text check (char_length(review) <= 500),
  term text check (char_length(term) <= 20),
  -- the prof a course was taken with, or the course a prof taught
  context text check (char_length(context) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (author, kind, subject)
);

create index if not exists ratings_subject_idx on public.ratings (kind, subject);

alter table public.ratings enable row level security;

-- Reads: everyone, every row, but not the author column.
revoke all on public.ratings from anon, authenticated;
grant select (id, kind, subject, score_a, score_b, liked, review, term, context, created_at, updated_at)
  on public.ratings to anon, authenticated;

drop policy if exists "ratings are public" on public.ratings;
create policy "ratings are public" on public.ratings for select to anon, authenticated using (true);

-- No insert/update/delete policies: the table can only be written through these
-- security definer functions.

create or replace function public.upsert_rating(
  p_author uuid,
  p_kind text,
  p_subject text,
  p_score_a int,
  p_score_b int,
  p_liked boolean,
  p_review text,
  p_term text,
  p_context text
)
returns table (
  id bigint, kind text, subject text, score_a smallint, score_b smallint, liked boolean,
  review text, term text, context text, updated_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  insert into public.ratings as r (author, kind, subject, score_a, score_b, liked, review, term, context)
  values (p_author, p_kind, btrim(p_subject), p_score_a, p_score_b, p_liked,
          nullif(btrim(p_review), ''), nullif(btrim(p_term), ''), nullif(btrim(p_context), ''))
  on conflict (author, kind, subject) do update set
    score_a = excluded.score_a,
    score_b = excluded.score_b,
    liked = excluded.liked,
    review = excluded.review,
    term = excluded.term,
    context = excluded.context,
    updated_at = now()
  returning r.id, r.kind, r.subject, r.score_a, r.score_b, r.liked, r.review, r.term, r.context, r.updated_at;
$$;

create or replace function public.delete_rating(p_author uuid, p_kind text, p_subject text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.ratings where author = p_author and kind = p_kind and subject = p_subject;
$$;

-- Which of these subjects' ratings were written by this browser, so the UI can
-- mark "your rating" and prefill the edit form.
create or replace function public.my_rating_ids(p_author uuid, p_kind text, p_subjects text[])
returns setof bigint
language sql
stable
security definer
set search_path = public
as $$
  select id from public.ratings where author = p_author and kind = p_kind and subject = any(p_subjects);
$$;

revoke all on function public.upsert_rating(uuid, text, text, int, int, boolean, text, text, text) from public;
revoke all on function public.delete_rating(uuid, text, text) from public;
revoke all on function public.my_rating_ids(uuid, text, text[]) from public;
grant execute on function public.upsert_rating(uuid, text, text, int, int, boolean, text, text, text) to anon, authenticated;
grant execute on function public.delete_rating(uuid, text, text) to anon, authenticated;
grant execute on function public.my_rating_ids(uuid, text, text[]) to anon, authenticated;
