-- Last chain slot reflected in a holder's balance. Events at or before it are
-- already counted (e.g. by a reconciliation snapshot) and are skipped, so a
-- late webhook can never apply the same sell twice.
alter table holders add column last_slot bigint not null default 0;
