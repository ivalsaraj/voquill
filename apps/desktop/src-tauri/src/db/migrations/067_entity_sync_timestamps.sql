-- Add updated_at (ISO 8601) to terms — already has is_deleted from migration 003
ALTER TABLE terms ADD COLUMN updated_at TEXT;
UPDATE terms SET updated_at = datetime(created_at / 1000, 'unixepoch') WHERE updated_at IS NULL;

-- Add is_deleted + updated_at to tones
ALTER TABLE tones ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tones ADD COLUMN updated_at TEXT;
UPDATE tones SET updated_at = datetime(created_at / 1000, 'unixepoch') WHERE updated_at IS NULL;
