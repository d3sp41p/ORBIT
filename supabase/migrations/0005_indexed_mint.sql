-- Mint whose data is currently in the token tables. When the effective mint
-- differs (stand-in -> launched coin), the worker clears them and re-indexes.
alter table token_config add column indexed_mint text;
