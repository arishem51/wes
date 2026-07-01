-- Migration 002e: AGV initial position (point name) — column the AgvEntity expects
-- but which was never added in schema.sql or an earlier migration.
ALTER TABLE agvs
  ADD COLUMN IF NOT EXISTS initial_position VARCHAR(100);
