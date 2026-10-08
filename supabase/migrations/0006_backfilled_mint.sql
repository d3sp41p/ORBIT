-- Mint whose history backfill has completed. A worker restarted in the middle
-- of a backfill sees the mismatch and resumes it (inserts are idempotent).
alter table token_config add column backfilled_mint text;
