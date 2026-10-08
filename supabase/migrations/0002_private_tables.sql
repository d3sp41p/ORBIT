-- Private tables are not part of the public API at all: the browser roles get
-- no privileges, so requests fail instead of returning empty results.
revoke all on table chain_events, auth_nonces, ai_usage from anon, authenticated;

-- Public tables are read-only for the browser roles.
revoke insert, update, delete, truncate on table
  holders, planet_state, planet_events, planet_finds, planet_custom,
  planet_chronicle, planet_archive, system_state
from anon, authenticated;
