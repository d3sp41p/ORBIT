-- Wallet sign-in, planet customisation and moderation (stage 7).
-- Everything here is private: only the server (service role) touches it.

-- The exact message a wallet signs (domain, address, nonce, times).
alter table auth_nonces add column message text;

-- Sessions: the browser keeps a random token in an httpOnly cookie, the
-- database keeps only its SHA-256.
create table auth_sessions (
  token_hash text primary key,
  wallet     text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index auth_sessions_expires_idx on auth_sessions (expires_at);

-- "Report name" complaints; the admin resolves them.
create table name_reports (
  id          bigserial primary key,
  wallet      text not null,
  reason      text,
  ip_hash     text not null,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);
create index name_reports_open_idx on name_reports (wallet) where resolved_at is null;

-- Fixed-window request counters (auth per IP, reports per IP).
create table rate_hits (
  key          text not null,
  window_start timestamptz not null,
  hits         integer not null default 0,
  primary key (key, window_start)
);

alter table auth_sessions enable row level security;
alter table name_reports  enable row level security;
alter table rate_hits     enable row level security;
revoke all on table auth_sessions, name_reports, rate_hits from anon, authenticated;
revoke all on sequence name_reports_id_seq from anon, authenticated;

-- One hit on a counter; false when the limit for this window is used up.
create function rate_hit(p_key text, p_limit integer, p_window_sec integer) returns boolean
language sql as $$
  insert into rate_hits (key, window_start, hits)
  values (p_key, to_timestamp(floor(extract(epoch from now()) / p_window_sec) * p_window_sec), 1)
  on conflict (key, window_start) do update set hits = rate_hits.hits + 1
  returning hits <= p_limit
$$;
revoke all on function rate_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function rate_hit(text, integer, integer) to service_role;

-- A nonce is good once, for its wallet, before it expires. Returns the
-- signed message, or nothing.
create function consume_nonce(p_nonce text, p_wallet text) returns text
language sql as $$
  update auth_nonces set used = true
  where nonce = p_nonce and wallet = p_wallet and not used and expires_at > now()
  returning message
$$;
revoke all on function consume_nonce(text, text) from public, anon, authenticated;
grant execute on function consume_nonce(text, text) to service_role;

-- Names hidden by the admin are not public at all.
drop policy "public read" on planet_custom;
create policy "public read" on planet_custom for select using (not hidden_by_admin);
