-- Everything the SFU Prerequisite Map stores in Supabase, as one script for
-- setting up through the dashboard SQL editor (safe to re-run). It is exactly
-- the files in supabase/migrations/ in order; with the Supabase CLI use those
-- instead (`npx supabase db push`). Keep the two in step: a test checks it.

-- ==== 20261010000000_ratings.sql ====

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

-- ==== 20261010000100_user_state.sql ====

-- Accounts: each signed-in user's saved document (taken courses, schedules,
-- settings), synced across devices. See docs/accounts-design.md, Layer 3.
-- Safe to re-run.
--
-- Clients can only read their own row; every write goes through the security
-- definer functions below, which act on auth.uid() only (there is no user id
-- parameter to forge).

create table if not exists public.user_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  doc jsonb not null,
  -- bumped by every save; clients send the rev they last saw (compare-and-set)
  rev bigint not null default 1,
  -- doc->schema, kept as a column so an older app version can't overwrite a newer format
  schema int not null,
  updated_at timestamptz not null default now()
);

alter table public.user_state enable row level security;
revoke all on public.user_state from public, anon, authenticated;
grant select on public.user_state to authenticated;

drop policy if exists "read own state" on public.user_state;
create policy "read own state" on public.user_state
  for select to authenticated using ((select auth.uid()) = user_id);

-- Earlier versions of each user's document, written by save_state: the
-- previous doc is kept when the newest history row is over 10 minutes old,
-- or when the client marks the save as bulk (first sync, restore, import).
-- At most 100 rows per user.
create table if not exists public.user_state_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  doc jsonb not null,
  rev bigint not null,
  schema int not null,
  saved_at timestamptz not null default now()
);

create index if not exists user_state_history_user_idx
  on public.user_state_history (user_id, saved_at desc);

alter table public.user_state_history enable row level security;
revoke all on public.user_state_history from public, anon, authenticated;
grant select on public.user_state_history to authenticated;

drop policy if exists "read own history" on public.user_state_history;
create policy "read own history" on public.user_state_history
  for select to authenticated using ((select auth.uid()) = user_id);

-- Save the caller's document if nobody saved since they last read it.
--   p_expected_rev: the rev the client last saw, or null if it saw no row.
--   p_bulk: keep the previous version in history regardless of age.
-- Returns {"ok": true, "rev": n} or, when the stored rev differs (or the doc's
-- schema is older than the stored one), {"ok": false, "doc": ..., "rev": n}
-- with the stored document so the client can merge and retry.
-- Raises on: not signed in, a doc that isn't an object with an integer
-- schema, or a doc over 256 kB.
create or replace function public.save_state(p_doc jsonb, p_expected_rev bigint, p_bulk boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_schema int;
  v_cur public.user_state%rowtype;
  v_rev bigint;
begin
  if v_uid is null then
    raise exception 'save_state: not signed in' using errcode = '42501';
  end if;
  if p_doc is null or pg_catalog.jsonb_typeof(p_doc) <> 'object'
     or pg_catalog.jsonb_typeof(p_doc -> 'schema') is distinct from 'number'
     or (p_doc ->> 'schema') !~ '^[0-9]{1,9}$' then
    raise exception 'save_state: doc must be an object with an integer schema' using errcode = '22023';
  end if;
  if pg_catalog.octet_length(p_doc::text) > 262144 then
    raise exception 'save_state: doc is over 256 kB' using errcode = '54000';
  end if;
  v_schema := (p_doc ->> 'schema')::int;

  -- Lock the row so concurrent saves are serialized.
  select * into v_cur from public.user_state where user_id = v_uid for update;

  if not found then
    -- First save (or the first since delete_my_state). If another save got
    -- here first, report its row as a conflict.
    insert into public.user_state (user_id, doc, rev, schema)
    values (v_uid, p_doc, 1, v_schema)
    on conflict (user_id) do nothing
    returning rev into v_rev;
    if v_rev is not null then
      return pg_catalog.jsonb_build_object('ok', true, 'rev', v_rev);
    end if;
    select * into v_cur from public.user_state where user_id = v_uid;
    return pg_catalog.jsonb_build_object('ok', false, 'doc', v_cur.doc, 'rev', v_cur.rev);
  end if;

  if p_expected_rev is distinct from v_cur.rev or v_schema < v_cur.schema then
    return pg_catalog.jsonb_build_object('ok', false, 'doc', v_cur.doc, 'rev', v_cur.rev);
  end if;

  if p_bulk or not exists (
    select 1 from public.user_state_history h
    where h.user_id = v_uid and h.saved_at > pg_catalog.now() - interval '10 minutes'
  ) then
    insert into public.user_state_history (user_id, doc, rev, schema)
    values (v_uid, v_cur.doc, v_cur.rev, v_cur.schema);
    delete from public.user_state_history h
    where h.user_id = v_uid and h.id not in (
      select k.id from public.user_state_history k
      where k.user_id = v_uid
      order by k.saved_at desc, k.id desc
      limit 100
    );
  end if;

  update public.user_state
  set doc = p_doc, rev = v_cur.rev + 1, schema = v_schema, updated_at = pg_catalog.now()
  where user_id = v_uid
  returning rev into v_rev;
  return pg_catalog.jsonb_build_object('ok', true, 'rev', v_rev);
end;
$$;

-- "Delete my saved data": the caller's document and its history.
create or replace function public.delete_my_state()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'delete_my_state: not signed in' using errcode = '42501';
  end if;
  delete from public.user_state_history where user_id = v_uid;
  delete from public.user_state where user_id = v_uid;
end;
$$;

revoke all on function public.save_state(jsonb, bigint, boolean) from public, anon;
revoke all on function public.delete_my_state() from public, anon;
grant execute on function public.save_state(jsonb, bigint, boolean) to authenticated;
grant execute on function public.delete_my_state() to authenticated;

