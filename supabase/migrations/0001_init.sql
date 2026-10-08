-- ORBIT schema (spec: "Database"). Only the server writes (service role);
-- the browser reads public tables through "select for everyone" RLS policies.

-- Current state of every holder (one row per owner wallet).
create table holders (
  wallet          text primary key,
  balance         numeric(39, 0) not null default 0,
  rank            integer,
  class           text check (class in ('super', 'gas', 'ice', 'rocky', 'asteroid')),
  hold_started_at timestamptz,
  time_rank       integer,
  orbit           double precision,
  buys            integer not null default 0,
  sells           integer not null default 0,
  status          text not null default 'none' check (status in ('none', 'alive', 'dead')),
  life_no         integer not null default 0,
  -- sells of the current life as simulation input: [{frac, at (planet day), counted?}]
  sell_log        jsonb not null default '[]'::jsonb,
  updated_at      timestamptz not null default now()
);
create index holders_rank_idx on holders (rank);
create index holders_time_rank_idx on holders (time_rank);
create index holders_status_idx on holders (status);

-- Raw chain events, idempotent by (sig, ix_index).
create table chain_events (
  sig            text not null,
  ix_index       integer not null,
  wallet         text not null,
  kind           text not null check (kind in ('buy', 'sell', 'transfer_in', 'transfer_out')),
  amount         numeric(39, 0) not null,
  balance_before numeric(39, 0) not null,
  balance_after  numeric(39, 0) not null,
  block_time     timestamptz not null,
  slot           bigint not null,
  source         text not null default 'webhook' check (source in ('webhook', 'snapshot', 'backfill')),
  applied        boolean not null default false,
  created_at     timestamptz not null default now(),
  primary key (sig, ix_index)
);
create index chain_events_pending_idx on chain_events (slot, sig, ix_index) where not applied;
create index chain_events_wallet_idx on chain_events (wallet, block_time desc);

-- Simulation state of alive planets.
create table planet_state (
  wallet       text primary key references holders (wallet) on delete cascade,
  life_no      integer not null,
  tick_no      integer not null default 0,
  next_tick_at timestamptz not null,
  state        jsonb not null,
  rng_state    bigint not null,
  bible        jsonb,
  history      jsonb not null default '[]'::jsonb,
  updated_at   timestamptz not null default now()
);
create index planet_state_next_tick_idx on planet_state (next_tick_at);

-- Planet news, also the global feed.
create table planet_events (
  id          bigserial primary key,
  wallet      text not null,
  life_no     integer not null,
  day         double precision not null,
  at          timestamptz not null,
  kind        text not null,
  params      jsonb not null default '{}'::jsonb,
  text_en     text not null,
  text_source text not null default 'template' check (text_source in ('ai', 'template')),
  notable     boolean not null default false,
  created_at  timestamptz not null default now()
);
create index planet_events_notable_idx on planet_events (at desc) where notable;
create index planet_events_wallet_idx on planet_events (wallet, at desc);

-- Rare finds.
create table planet_finds (
  wallet  text not null,
  life_no integer not null,
  find_id integer not null,
  day     double precision not null,
  at      timestamptz not null,
  primary key (wallet, life_no, find_id, day)
);

-- Owner customisation.
create table planet_custom (
  wallet          text primary key,
  name            text,
  species         text,
  capital         text,
  motto           text,
  updated_at      timestamptz not null default now(),
  hidden_by_admin boolean not null default false
);

-- AI chronicle cache.
create table planet_chronicle (
  wallet       text not null,
  life_no      integer not null,
  text_en      text not null,
  generated_at timestamptz not null default now(),
  events_hash  text not null,
  primary key (wallet, life_no)
);

-- One-time messages for wallet sign-in.
create table auth_nonces (
  nonce      text primary key,
  wallet     text not null,
  expires_at timestamptz not null,
  used       boolean not null default false
);
create index auth_nonces_expires_idx on auth_nonces (expires_at);

-- Past lives of planets that died.
create table planet_archive (
  wallet   text not null,
  life_no  integer not null,
  ended_at timestamptz not null,
  summary  jsonb not null,
  primary key (wallet, life_no)
);

-- Star and header state (single row, id = 1).
create table system_state (
  id              integer primary key default 1 check (id = 1),
  mcap            double precision not null default 0,
  price           double precision not null default 0,
  holders_count   integer not null default 0,
  star_tier       integer not null default 0,
  last_webhook_at timestamptz,
  last_snapshot_at timestamptz,
  updated_at      timestamptz not null default now()
);
insert into system_state (id) values (1);

-- AI spend control.
create table ai_usage (
  date          date primary key,
  requests      integer not null default 0,
  input_tokens  bigint not null default 0,
  output_tokens bigint not null default 0,
  cost_usd      numeric(12, 6) not null default 0
);

-- Row level security on every table. Public tables are readable by anyone;
-- private ones (chain_events, auth_nonces, ai_usage) have no policy, so only
-- the service role (which bypasses RLS) can touch them.
alter table holders          enable row level security;
alter table chain_events     enable row level security;
alter table planet_state     enable row level security;
alter table planet_events    enable row level security;
alter table planet_finds     enable row level security;
alter table planet_custom    enable row level security;
alter table planet_chronicle enable row level security;
alter table auth_nonces      enable row level security;
alter table planet_archive   enable row level security;
alter table system_state     enable row level security;
alter table ai_usage         enable row level security;

create policy "public read" on holders          for select using (true);
create policy "public read" on planet_state     for select using (true);
create policy "public read" on planet_events    for select using (true);
create policy "public read" on planet_finds     for select using (true);
create policy "public read" on planet_custom    for select using (true);
create policy "public read" on planet_chronicle for select using (true);
create policy "public read" on planet_archive   for select using (true);
create policy "public read" on system_state     for select using (true);

-- Live updates for the site.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table planet_events, system_state;
  end if;
end $$;
