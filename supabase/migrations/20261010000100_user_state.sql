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
