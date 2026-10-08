-- Planet life on the server (stage 5).
-- nature: planet class at birth; it fixes the kind of simulation (rocky, gas,
-- ice, asteroid) while size and bonuses follow the current rank.
alter table planet_state add column nature text not null default 'rocky'
  check (nature in ('super', 'gas', 'ice', 'rocky', 'asteroid'));
alter table planet_state add column hold_started_at timestamptz;

-- When the current life ended (balance fell below the threshold).
alter table holders add column died_at timestamptz;

-- Archive is read by the site for the 24-hour debris cloud.
create index planet_archive_ended_idx on planet_archive (ended_at desc);
create index planet_finds_wallet_idx on planet_finds (wallet, life_no);
