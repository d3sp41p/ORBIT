-- AI texts (stage 6): a queue for the worker, the template kept next to an AI
-- rewrite (for audits), and a way for the site to ask for a chronicle.

-- What the worker should write. news: one event; bible: the culture of a new
-- civilization; chronicle: the planet's chronicle (asked for by the site).
create table ai_jobs (
  id           bigserial primary key,
  kind         text not null check (kind in ('news', 'bible', 'chronicle')),
  wallet       text not null,
  life_no      integer not null,
  event_id     bigint references planet_events (id) on delete cascade,
  attempts     integer not null default 0,
  not_before   timestamptz not null default now(),
  locked_until timestamptz,
  created_at   timestamptz not null default now()
);
create unique index ai_jobs_event_idx on ai_jobs (event_id) where event_id is not null;
create unique index ai_jobs_planet_idx on ai_jobs (kind, wallet, life_no) where event_id is null;
create index ai_jobs_due_idx on ai_jobs (not_before) where attempts < 3;

alter table ai_jobs enable row level security;
revoke all on table ai_jobs from anon, authenticated;
revoke all on sequence ai_jobs_id_seq from anon, authenticated;

-- The template text an AI rewrite replaced.
alter table planet_events add column text_template text;

-- The site asks for a chronicle when a mission page opens. Only queues work
-- when the chronicle is missing or 5+ events behind; repeated calls are no-ops.
-- events_hash is "<events counted>:<last event id>" at generation time.
create function request_chronicle(p_wallet text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_life integer;
  v_count integer;
  v_have integer;
begin
  select life_no into v_life from planet_state where wallet = p_wallet;
  if v_life is null then
    return false;
  end if;
  select count(*) into v_count from planet_events where wallet = p_wallet and life_no = v_life;
  select nullif(split_part(events_hash, ':', 1), '')::integer into v_have
    from planet_chronicle where wallet = p_wallet and life_no = v_life;
  if v_have is not null and v_count - v_have < 5 then
    return false;
  end if;
  insert into ai_jobs (kind, wallet, life_no) values ('chronicle', p_wallet, v_life)
    on conflict do nothing;
  return true;
end $$;
revoke all on function request_chronicle(text) from public;
grant execute on function request_chronicle(text) to anon, authenticated;

-- A finished chronicle reaches an open mission page through Realtime.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table planet_chronicle;
  end if;
end $$;
