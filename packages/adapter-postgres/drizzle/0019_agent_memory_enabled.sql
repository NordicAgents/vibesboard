-- IF NOT EXISTS: this migration originally shipped with a journal "when" older
-- than 0018's, so drizzle skipped it on any already-migrated database. The
-- journal timestamp was fixed (idx 19 re-stamped after 0018), which re-applies
-- this file on dev databases that ran the broken journal — the guard makes the
-- re-application a no-op there.
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "memory_enabled" boolean NOT NULL DEFAULT false;
