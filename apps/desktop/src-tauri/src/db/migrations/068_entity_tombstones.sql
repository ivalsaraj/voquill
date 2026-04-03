-- conversations already have updated_at; add is_deleted for tombstone propagation
ALTER TABLE conversations ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0;

-- app_targets need both is_deleted and updated_at
ALTER TABLE app_targets ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE app_targets ADD COLUMN updated_at TEXT;
UPDATE app_targets SET updated_at = created_at WHERE updated_at IS NULL;

-- hotkeys need both is_deleted and updated_at
ALTER TABLE hotkeys ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE hotkeys ADD COLUMN updated_at TEXT;
UPDATE hotkeys SET updated_at = datetime('now') WHERE updated_at IS NULL;

-- chat_messages support update (content edits) and individual deletion — need full tombstone support
ALTER TABLE chat_messages ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chat_messages ADD COLUMN updated_at TEXT;
UPDATE chat_messages SET updated_at = datetime(created_at / 1000, 'unixepoch') WHERE updated_at IS NULL;
