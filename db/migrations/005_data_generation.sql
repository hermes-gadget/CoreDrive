-- Deletion generation. Every accepted envelope carries the generation it was
-- stamped with; a deletion increments the user's generation, invalidating any
-- envelope still in flight.
ALTER TABLE users ADD COLUMN IF NOT EXISTS data_generation integer NOT NULL DEFAULT 0;
