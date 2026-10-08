-- Stock planet name (derived from the wallet), stored for search. Custom
-- names from planet_custom take precedence on the site (stage 7).
alter table holders add column name text;
create index holders_name_idx on holders (lower(name));
