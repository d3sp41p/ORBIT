-- Token settings live in the database so the site and worker can switch to
-- the coin at launch without a redeploy. Private: only the server reads it.
create table token_config (
  id               integer primary key default 1 check (id = 1),
  -- the coin; null = use TOKEN_MINT from the environment (stand-in in development)
  mint             text,
  launched         boolean not null default false,
  launched_at      timestamptz,
  ticker           text,
  name             text,
  buy_url          text,
  x_url            text,
  excluded_wallets text[] not null default '{}',
  included_wallets text[] not null default '{}',
  -- automatic launch: watch dev_wallet and switch when it creates a token
  -- whose ticker and name match the expected ones
  armed            boolean not null default false,
  dev_wallet       text,
  expected_ticker  text,
  expected_name    text,
  -- Helius webhook managed by the worker
  webhook_id       text,
  webhook_addresses text[] not null default '{}',
  updated_at       timestamptz not null default now()
);
insert into token_config (id) values (1);
alter table token_config enable row level security;
revoke all on table token_config from anon, authenticated;

-- Dev-wallet transactions received while armed, processed by the worker.
create table launch_inbox (
  sig         text primary key,
  raw         jsonb not null,
  received_at timestamptz not null default now(),
  processed   boolean not null default false
);
alter table launch_inbox enable row level security;
revoke all on table launch_inbox from anon, authenticated;

-- Public token facts for the site (readable by anyone, pushed over Realtime),
-- maintained by the worker from token_config. token_mint stays null until launch.
alter table system_state
  add column token_mint   text,
  add column token_ticker text,
  add column token_name   text,
  add column buy_url      text,
  add column x_url        text,
  add column launched     boolean not null default false;
