-- Launch time is public once the coin is live: the header counts mission time from it.
alter table system_state add column launched_at timestamptz;
