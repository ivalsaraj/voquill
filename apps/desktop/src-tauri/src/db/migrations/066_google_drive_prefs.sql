ALTER TABLE user_preferences ADD COLUMN google_drive_email TEXT;
ALTER TABLE user_preferences ADD COLUMN google_drive_sync_mode TEXT;
ALTER TABLE user_preferences ADD COLUMN google_drive_sync_interval_minutes INTEGER;
ALTER TABLE user_preferences ADD COLUMN google_drive_last_synced_at TEXT;
-- Sync timestamp for conflict resolution (newer updatedAt wins between machines)
ALTER TABLE user_preferences ADD COLUMN updated_at TEXT;
UPDATE user_preferences SET updated_at = datetime('now') WHERE updated_at IS NULL;
