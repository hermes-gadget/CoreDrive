-- Accounts deleted before migration 005 were initialised at generation 0, and
-- legacy envelopes default to generation 0 too. Advance them once so any
-- pre-upgrade envelope is invalidated.
UPDATE users
   SET data_generation = data_generation + 1
 WHERE data_deleted_at IS NOT NULL
   AND data_generation = 0;
