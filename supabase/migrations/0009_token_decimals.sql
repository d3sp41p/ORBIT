-- Token decimals for displaying balances on the site.
alter table system_state add column token_decimals integer not null default 6;
