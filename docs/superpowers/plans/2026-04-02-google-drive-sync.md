# Google Drive Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two-way Google Drive sync to the Voquill desktop app (local mode), storing text data in a structured `Voquill/` folder, with configurable sync triggers and UI indicators.

**Architecture:** A new `GoogleDriveClient` class handles Drive REST API v3 calls from TypeScript. A pure `SyncEngine` function runs the diff→download→upload→manifest cycle. A `SyncScheduler` fires the engine on event (debounced), interval, or manual trigger. Rust commands handle the OAuth loopback server and OS keychain token storage.

**Tech Stack:** TypeScript/React (Tauri webview), Rust (Tauri commands), Google Drive REST API v3, OAuth2 PKCE, `keyring` crate (OS keychain), Vitest, MUI, react-intl

---

## Prerequisites (Manual Setup — Do Before Task 1)

1. Create a Google Cloud project at console.cloud.google.com
2. Enable **Google Drive API** for the project
3. Create **OAuth 2.0 credentials** → Application type: **Desktop app**
4. Copy the **Client ID** (no client secret needed for PKCE desktop flow)
5. Add to `apps/desktop/.env` (create if missing):
   ```
   VITE_GOOGLE_OAUTH_CLIENT_ID=your-client-id.apps.googleusercontent.com
   ```
6. Add `apps/desktop/.env` to `.gitignore` if not already there

---

## File Map

**Create:**
- `apps/desktop/src/repos/google-drive.client.ts` — Drive REST API v3 wrapper; read, write, list, create folder
- `apps/desktop/src/actions/sync-engine.ts` — pure sync cycle: diff, download, upload, manifest update
- `apps/desktop/src/actions/sync-engine.test.ts` — unit tests for diff and merge logic
- `apps/desktop/src/actions/google-drive.actions.ts` — connect, disconnect, triggerSync; Zustand state updates
- `apps/desktop/src/actions/sync-scheduler.ts` — debounce/interval/manual scheduler
- `apps/desktop/src/components/settings/GoogleDriveSyncSection.tsx` — sync settings UI
- `apps/desktop/src-tauri/src/db/migrations/065_google_drive_prefs.sql` — new pref columns
- `apps/desktop/src-tauri/src/db/migrations/066_entity_sync_timestamps.sql` — `updated_at` + `is_deleted` for terms/tones
- `apps/desktop/src-tauri/src/db/migrations/067_entity_tombstones.sql` — `is_deleted`/`updated_at` for conversations, app_targets, hotkeys

**Modify:**
- `packages/types/src/preferences.types.ts` — add 4 sync fields + SyncablePreferences DTO
- `packages/types/src/term.types.ts` — add `isDeleted: boolean` and `updatedAt: string | null`
- `packages/types/src/tone.types.ts` — add `isDeleted: boolean` and `updatedAt: string | null`
- `packages/types/src/chat.types.ts` — add `isDeleted: boolean` to `Conversation`; add `isDeleted: boolean` and `updatedAt: string | null` to `ChatMessage`
- `packages/types/src/app-target.types.ts` — add `isDeleted: boolean` and `updatedAt: string | null`
- `packages/types/src/hotkey.types.ts` — add `isDeleted: boolean` and `updatedAt: string | null`
- `packages/types/src/preferences.types.ts` — also add `updatedAt: Nullable<string>` for conflict resolution
- `apps/desktop/src/state/app.state.ts` — add `googleDriveSync` sub-state
- `apps/desktop/src/state/settings.state.ts` — add `googleDriveSyncSectionVisible`
- `apps/desktop/src-tauri/Cargo.toml` — add `keyring` dep
- `apps/desktop/src-tauri/src/commands.rs` — add `oauth_start_callback_server`, `secure_store`, `secure_get`, `secure_delete`
- `apps/desktop/src-tauri/src/app.rs` — register 4 new commands
- `apps/desktop/src-tauri/src/db/mod.rs` — register migration 065
- `apps/desktop/src/components/settings/SettingsPage.tsx` — add `<GoogleDriveSyncSection />`
- `apps/desktop/src/components/root/Header.tsx` — add Drive sync status icon
- `apps/desktop/src/components/root/RootSideEffects.ts` — call `startSyncScheduler()` after initial data load
- `apps/desktop/src/components/dictionary/DictionaryPage.tsx` — `notifySyncWrite()` after createTerm
- `apps/desktop/src/components/dictionary/DictionaryRow.tsx` — `notifySyncWrite()` after updateTerm/deleteTerm
- `apps/desktop/src/actions/tone.actions.ts` — `notifySyncWrite()` after mutations
- `apps/desktop/src/actions/transcribe.actions.ts` — `notifySyncWrite()` after createTranscription
- `apps/desktop/src/actions/remote-transcript.actions.ts` — `notifySyncWrite()` after createTranscription
- `apps/desktop/src/actions/chat.actions.ts` — `notifySyncWrite()` after chat message writes
- `apps/desktop/src/actions/app-target.actions.ts` — `notifySyncWrite()` after app target writes
- `apps/desktop/src/components/settings/HotkeySetting.tsx` — `notifySyncWrite()` after hotkey save
- `apps/desktop/src/actions/user.actions.ts` — `notifySyncWrite()` in `updateUserPreferences()`

---

## Task 1: Add Sync Types to Preferences, AppState, and SettingsState

**Files:**
- Modify: `packages/types/src/preferences.types.ts`
- Modify: `apps/desktop/src/state/app.state.ts`
- Modify: `apps/desktop/src/state/settings.state.ts`

- [ ] **Step 1: Add sync fields to UserPreferences and define SyncablePreferences DTO**

  Open `packages/types/src/preferences.types.ts`. After the `pasteKeybind` field (before the `// deprecated` comment), add:

  ```typescript
  googleDriveEmail: Nullable<string>;
  googleDriveSyncMode: Nullable<'event' | 'interval' | 'manual'>;
  googleDriveSyncIntervalMinutes: Nullable<number>;
  googleDriveLastSyncedAt: Nullable<string>; // ISO 8601
  updatedAt: Nullable<string>; // ISO 8601 — used for per-record conflict resolution during sync
  ```

  At the bottom of the same file, add the DTO that is safe to write to Google Drive (excludes all API key references and sensitive tokens):

  ```typescript
  /**
   * Subset of UserPreferences that is safe to write to Google Drive.
   * API key IDs and sensitive tokens are intentionally excluded.
   */
  export type SyncablePreferences = Omit<
    UserPreferences,
    | 'transcriptionApiKeyId'
    | 'postProcessingApiKeyId'
    | 'agentModeApiKeyId'
    | 'openclawToken'
    | 'openclawGatewayUrl'
    | 'isEnterprise'
  >;
  ```

- [ ] **Step 1b: Add `isDeleted` and `updatedAt` to Term and Tone types**

  Open `packages/types/src/term.types.ts`. Add `isDeleted` and `updatedAt` to `DatabaseTerm` (the DB already has an `is_deleted` column; `updated_at` will be added by migration 066):

  ```typescript
  export type DatabaseTerm = {
    id: string;
    createdAt: FiremixTimestamp;
    sourceValue: string;
    destinationValue: string;
    isReplacement: boolean;
    isGlobal?: boolean;
    isDeleted: boolean;   // maps to existing is_deleted column
    updatedAt: string | null; // maps to new updated_at column (migration 066)
  };
  ```

  Update `TermZod` to include the new fields:

  ```typescript
  export const TermZod = z
    .object({
      id: z.string(),
      createdAt: z.string(),
      sourceValue: z.string(),
      destinationValue: z.string(),
      isReplacement: z.boolean(),
      isGlobal: z.boolean().optional(),
      isDeleted: z.boolean(),
      updatedAt: z.string().nullable(),
    })
    .strict() satisfies z.ZodType<Term>;
  ```

  Open `packages/types/src/tone.types.ts`. Add `isDeleted` and `updatedAt` to `DatabaseTone` (both columns will be added by migration 066):

  ```typescript
  export type DatabaseTone = {
    id: string;
    name: string;
    description?: string;
    promptTemplate: string;
    isSystem: boolean;
    createdAt: FiremixTimestamp;
    sortOrder: number;
    isGlobal?: boolean;
    isDeprecated?: boolean;
    shouldDisablePostProcessing?: boolean;
    systemPromptTemplate?: string;
    isTemplateTone?: boolean;
    isDeleted: boolean;   // maps to new is_deleted column (migration 066)
    updatedAt: string | null; // maps to new updated_at column (migration 066)
  };
  ```

  Update `ToneZod` to include the new fields:

  ```typescript
  isDeleted: z.boolean(),
  updatedAt: z.string().nullable(),
  ```

  Note: These type changes expose existing soft-delete infrastructure (for terms) and new fields (for tones) that the sync engine will use for per-record conflict resolution and tombstone propagation.

  Open `packages/types/src/chat.types.ts`. Add `isDeleted` to `Conversation` (already has `updatedAt`) and full tombstone/update support to `ChatMessage`:

  ```typescript
  export type Conversation = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    isDeleted: boolean; // maps to new is_deleted column (migration 067)
  };

  export type ChatMessage = {
    id: string;
    conversationId: string;
    role: ChatMessageRole;
    content: string;
    createdAt: string;
    metadata: Nullable<Record<string, unknown>>;
    isDeleted: boolean;       // maps to new is_deleted column (migration 067)
    updatedAt: string | null; // maps to new updated_at column (migration 067)
  };
  ```

  Open `packages/types/src/app-target.types.ts`. Add `isDeleted` and `updatedAt`:

  ```typescript
  export type AppTarget = {
    id: string;
    name: string;
    createdAt: string;
    toneId: Nullable<string>;
    iconPath: Nullable<string>;
    pasteKeybind: Nullable<string>;
    isDeleted: boolean;     // maps to new is_deleted column (migration 067)
    updatedAt: string | null; // maps to new updated_at column (migration 067)
  };
  ```

  Open `packages/types/src/hotkey.types.ts`. Add `isDeleted` and `updatedAt`:

  ```typescript
  export type Hotkey = {
    id: string;
    actionName: string;
    keys: string[];
    isDeleted: boolean;     // maps to new is_deleted column (migration 067)
    updatedAt: string | null; // maps to new updated_at column (migration 067)
  };
  ```

- [ ] **Step 2: Add GoogleDriveSyncState to AppState**

  Open `apps/desktop/src/state/app.state.ts`. Add this type before `AppState`:

  ```typescript
  export type GoogleDriveSyncState = {
    status: 'idle' | 'syncing' | 'error';
    errorMessage: Nullable<string>;
  };
  ```

  Then add this field to the `AppState` type:

  ```typescript
  googleDriveSync: GoogleDriveSyncState;
  ```

  In the initial state object (wherever `AppState` is initialized with defaults), add:

  ```typescript
  googleDriveSync: { status: 'idle', errorMessage: null },
  ```

- [ ] **Step 3: Add dialog flag to SettingsState**

  Open `apps/desktop/src/state/settings.state.ts`. Add to the `SettingsState` type:

  ```typescript
  googleDriveSyncSectionVisible: boolean;
  ```

  Add to the initial settings state:

  ```typescript
  googleDriveSyncSectionVisible: false,
  ```

- [ ] **Step 4: Rebuild packages/types**

  ```bash
  cd /path/to/voquill && pnpm --filter @voquill/types build
  ```

  Expected: builds with no errors.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/types/src/preferences.types.ts \
    apps/desktop/src/state/app.state.ts \
    apps/desktop/src/state/settings.state.ts
  git commit -m "feat: add google drive sync fields to types and state"
  ```

---

## Task 2: SQLite Migration for Sync Preferences

**Files:**
- Create: `apps/desktop/src-tauri/src/db/migrations/065_google_drive_prefs.sql`
- Modify: `apps/desktop/src-tauri/src/db/mod.rs`

- [ ] **Step 1: Create migration SQL**

  Create `apps/desktop/src-tauri/src/db/migrations/065_google_drive_prefs.sql`:

  ```sql
  ALTER TABLE user_preferences ADD COLUMN google_drive_email TEXT;
  ALTER TABLE user_preferences ADD COLUMN google_drive_sync_mode TEXT;
  ALTER TABLE user_preferences ADD COLUMN google_drive_sync_interval_minutes INTEGER;
  ALTER TABLE user_preferences ADD COLUMN google_drive_last_synced_at TEXT;
  -- Sync timestamp for conflict resolution (newer updatedAt wins between machines)
  ALTER TABLE user_preferences ADD COLUMN updated_at TEXT;
  UPDATE user_preferences SET updated_at = datetime('now') WHERE updated_at IS NULL;
  ```

- [ ] **Step 2: Register migration in mod.rs**

  Open `apps/desktop/src-tauri/src/db/mod.rs`. At the top, after the last `include_str!` constant, add:

  ```rust
  pub const GOOGLE_DRIVE_PREFS_MIGRATION_SQL: &str =
      include_str!("migrations/065_google_drive_prefs.sql");
  ```

  In the `migrations()` function, after the last entry (version 64), add:

  ```rust
  tauri_plugin_sql::Migration {
      version: 65,
      description: "add_google_drive_prefs",
      sql: GOOGLE_DRIVE_PREFS_MIGRATION_SQL,
      kind: tauri_plugin_sql::MigrationKind::Up,
  },
  ```

- [ ] **Step 3: Verify Rust compiles**

  ```bash
  cd apps/desktop/src-tauri && cargo check
  ```

  Expected: compiles with no errors.

- [ ] **Step 4: Commit migration 065**

  ```bash
  git add apps/desktop/src-tauri/src/db/migrations/065_google_drive_prefs.sql \
    apps/desktop/src-tauri/src/db/mod.rs
  git commit -m "feat: migration 065 — add google drive sync pref columns"
  ```

- [ ] **Step 5: Create migration 066 — entity sync timestamps**

  Create `apps/desktop/src-tauri/src/db/migrations/066_entity_sync_timestamps.sql`:

  ```sql
  -- Add updated_at (ISO 8601) to terms — already has is_deleted from migration 003
  ALTER TABLE terms ADD COLUMN updated_at TEXT;
  UPDATE terms SET updated_at = datetime(created_at / 1000, 'unixepoch') WHERE updated_at IS NULL;

  -- Add is_deleted + updated_at to tones
  ALTER TABLE tones ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE tones ADD COLUMN updated_at TEXT;
  UPDATE tones SET updated_at = datetime(created_at / 1000, 'unixepoch') WHERE updated_at IS NULL;
  ```

  Note: `updated_at` for hotkeys and app_targets is backfilled from their respective creation timestamps. All entity types now support full two-way tombstone propagation.

- [ ] **Step 6: Register migration 066 in mod.rs**

  Open `apps/desktop/src-tauri/src/db/mod.rs`. After the `GOOGLE_DRIVE_PREFS_MIGRATION_SQL` constant, add:

  ```rust
  pub const ENTITY_SYNC_TIMESTAMPS_MIGRATION_SQL: &str =
      include_str!("migrations/066_entity_sync_timestamps.sql");
  ```

  In the `migrations()` function, after the version 65 entry, add:

  ```rust
  tauri_plugin_sql::Migration {
      version: 66,
      description: "add_entity_sync_timestamps",
      sql: ENTITY_SYNC_TIMESTAMPS_MIGRATION_SQL,
      kind: tauri_plugin_sql::MigrationKind::Up,
  },
  ```

- [ ] **Step 7: Verify Rust compiles**

  ```bash
  cd apps/desktop/src-tauri && cargo check
  ```

  Expected: compiles with no errors.

- [ ] **Step 8: Commit migration 066**

  ```bash
  git add apps/desktop/src-tauri/src/db/migrations/066_entity_sync_timestamps.sql \
    apps/desktop/src-tauri/src/db/mod.rs
  git commit -m "feat: migration 066 — add updatedAt + isDeleted to terms/tones for tombstone sync"
  ```

- [ ] **Step 9: Create migration 067 — remaining entity tombstone columns**

  Create `apps/desktop/src-tauri/src/db/migrations/067_entity_tombstones.sql`:

  ```sql
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
  ```

- [ ] **Step 10: Register migration 067 in mod.rs**

  Open `apps/desktop/src-tauri/src/db/mod.rs`. After the `ENTITY_SYNC_TIMESTAMPS_MIGRATION_SQL` constant, add:

  ```rust
  pub const ENTITY_TOMBSTONES_MIGRATION_SQL: &str =
      include_str!("migrations/067_entity_tombstones.sql");
  ```

  In the `migrations()` function, after the version 66 entry, add:

  ```rust
  tauri_plugin_sql::Migration {
      version: 67,
      description: "add_entity_tombstones",
      sql: ENTITY_TOMBSTONES_MIGRATION_SQL,
      kind: tauri_plugin_sql::MigrationKind::Up,
  },
  ```

- [ ] **Step 11: Verify Rust compiles**

  ```bash
  cd apps/desktop/src-tauri && cargo check
  ```

- [ ] **Step 12: Commit migration 067**

  ```bash
  git add apps/desktop/src-tauri/src/db/migrations/067_entity_tombstones.sql \
    apps/desktop/src-tauri/src/db/mod.rs
  git commit -m "feat: migration 067 — add is_deleted/updated_at to conversations, app_targets, hotkeys"
  ```

---

## Task 2b: Repo Layer — Soft-Delete Queries and ListAll Methods

**Why this task exists:** The sync engine calls `list*All()` methods (including soft-deleted records for tombstone upload) and depends on delete operations creating tombstone rows instead of hard-deleting them. Without this task, tombstone propagation silently fails.

**Files:**
- Modify: `apps/desktop/src-tauri/src/db/term_queries.rs` — add `list_terms_all`; include `updated_at` in SELECT
- Modify: `apps/desktop/src-tauri/src/db/tone_queries.rs` — convert hard-delete to soft-delete; add `list_tones_all`
- Modify: `apps/desktop/src-tauri/src/db/conversation_queries.rs` — convert hard-delete to soft-delete; add `list_conversations_all`
- Modify: `apps/desktop/src-tauri/src/db/chat_message_queries.rs` — convert hard-deletes to soft-delete; add `list_chat_messages_all`
- Modify: `apps/desktop/src-tauri/src/db/hotkey_queries.rs` — convert hard-delete to soft-delete; add `list_hotkeys_all`
- Modify: `apps/desktop/src-tauri/src/db/app_target_queries.rs` — convert hard-delete to soft-delete; add `list_app_targets_all`
- Modify: `apps/desktop/src-tauri/src/commands.rs` — add 6 new `*_list_all` commands; `app_target_delete` soft-delete
- Modify: `apps/desktop/src-tauri/src/app.rs` — register new commands
- Modify: relevant TypeScript repo files — add `list*All()` methods; update delete methods

- [ ] **Step 1: Convert hard-deletes to soft-deletes in Rust query files**

  **Pattern for soft-delete** (apply to each entity that currently uses hard-delete):

  Before (hard-delete):
  ```sql
  DELETE FROM tones WHERE id = ?1
  ```
  After (soft-delete):
  ```sql
  UPDATE tones SET is_deleted = 1, updated_at = datetime('now') WHERE id = ?1
  ```

  Apply this pattern to the delete functions in:
  - `tone_queries.rs` → `delete_tone` function (hard-delete at line ~46)
  - `conversation_queries.rs` → `delete_conversation` function. Change to:
    1. Soft-delete all chat messages for the conversation: `UPDATE chat_messages SET is_deleted = 1, updated_at = datetime('now') WHERE conversation_id = ?1`
    2. Soft-delete the conversation: `UPDATE conversations SET is_deleted = 1, updated_at = datetime('now') WHERE id = ?1`
  - `chat_message_queries.rs` → both single-delete and batch-delete functions:
    - Single: `UPDATE chat_messages SET is_deleted = 1, updated_at = datetime('now') WHERE id = ?1`
    - Batch: `UPDATE chat_messages SET is_deleted = 1, updated_at = datetime('now') WHERE id IN (...)`
  - `hotkey_queries.rs` → `delete_hotkey` function (hard-delete at line ~52)
  - `app_target_queries.rs` → find the delete function and apply same pattern

  Note: `term_queries.rs` already has soft-delete (`SET is_deleted = 1`) — no change needed for the delete function.

- [ ] **Step 2: Add `list_all` query functions in Rust**

  **Pattern for list-all** (add alongside existing list function for each entity):

  For terms, add after `list_terms`:
  ```rust
  pub async fn list_terms_all(pool: SqlitePool) -> Result<Vec<LocalTerm>, sqlx::Error> {
      // Same as list_terms but without WHERE is_deleted = 0 filter
      sqlx::query("SELECT id, created_at, created_by_user_id, source_value, destination_value, \
                          is_replacement, is_deleted, updated_at \
                   FROM terms ORDER BY created_at DESC")
          .fetch_all(&pool)
          // ...map to LocalTerm including is_deleted and updated_at fields
  }
  ```

  For tones, add `list_tones_all` (without `WHERE is_deleted = 0` once migration 066 adds the column).

  For conversations, add `list_conversations_all` (without `WHERE is_deleted = 0` once migration 067 adds the column).

  For chat_messages, add `list_chat_messages_all(conversation_id)` (without any `is_deleted` filter).

  For hotkeys, add `list_hotkeys_all` (without `is_deleted` filter).

  For app_targets, add `list_app_targets_all` (without `is_deleted` filter).

  Also update **all existing list queries** to read the `updated_at` and `is_deleted` fields when they are present (after migrations 066+067 add those columns). The Rust `LocalXxx` structs and their `from_row` implementations need to read and expose these fields.

- [ ] **Step 3: Add Tauri commands for list-all and register them**

  In `commands.rs`, add one command for each entity following the pattern:

  ```rust
  #[tauri::command]
  pub async fn term_list_all(state: State<'_, AppState>) -> Result<Vec<LocalTerm>, String> {
      let database = state.database.lock().unwrap();
      crate::db::term_queries::list_terms_all(database.pool())
          .await
          .map_err(|e| e.to_string())
  }
  ```

  Add analogous commands: `tone_list_all`, `conversation_list_all`, `chat_message_list_all`,
  `hotkey_list_all`, `app_target_list_all`.

  In `app.rs`, register all 6 new commands in the `invoke_handler`.

- [ ] **Step 4: Update TypeScript repos to use new commands**

  For each entity repo, add a `list*All()` method that invokes the new Tauri command:

  **conversation.repo.ts** — add:
  ```typescript
  abstract listConversationsAll(): Promise<Conversation[]>;
  // LocalConversationRepo implements:
  async listConversationsAll(): Promise<Conversation[]> {
    const rows = await invoke<LocalConversation[]>('conversation_list_all');
    return rows.map(fromLocalConversation);
  }
  ```

  Apply the same pattern for:
  - `chat-message.repo.ts` → `listChatMessagesAll(conversationId: string): Promise<ChatMessage[]>`
  - `app-target.repo.ts` → `listAppTargetsAll(): Promise<AppTarget[]>`
  - `hotkey.repo.ts` → `listHotkeysAll(): Promise<Hotkey[]>`
  - The term repo (wherever `listTerms` is defined) → `listTermsAll(): Promise<Term[]>`
  - The tone repo (wherever `listTones` is defined) → `listTonesAll(): Promise<Tone[]>`

  Also update the `fromLocalXxx` mapping functions to include the new `isDeleted` and `updatedAt` fields where they now exist.

- [ ] **Step 5: Verify cargo check and type check**

  ```bash
  cd apps/desktop/src-tauri && cargo check
  cd apps/desktop && pnpm run check-types
  ```

  Expected: no errors.

- [ ] **Step 6: Commit**

  ```bash
  git add apps/desktop/src-tauri/src/db/term_queries.rs \
    apps/desktop/src-tauri/src/db/tone_queries.rs \
    apps/desktop/src-tauri/src/db/conversation_queries.rs \
    apps/desktop/src-tauri/src/db/chat_message_queries.rs \
    apps/desktop/src-tauri/src/db/hotkey_queries.rs \
    apps/desktop/src-tauri/src/db/app_target_queries.rs \
    apps/desktop/src-tauri/src/commands.rs \
    apps/desktop/src-tauri/src/app.rs
  git commit -m "feat: add soft-delete and list-all to entity repos for sync tombstone support"
  git add apps/desktop/src/repos/
  git commit -m "feat: add list*All() methods to TypeScript repos for sync tombstone upload"
  ```

---

## Task 3: Rust Commands — OAuth Callback Server and Secure Token Storage

**Files:**
- Modify: `apps/desktop/src-tauri/Cargo.toml`
- Modify: `apps/desktop/src-tauri/src/commands.rs`
- Modify: `apps/desktop/src-tauri/src/app.rs`

- [ ] **Step 1: Add keyring dependency to Cargo.toml**

  Open `apps/desktop/src-tauri/Cargo.toml`. In the `[dependencies]` section, add:

  ```toml
  keyring = { version = "2", features = ["apple-native", "windows-native", "linux-native"] }
  ```

- [ ] **Step 2: Add `secure_store`, `secure_get`, `secure_delete` commands to commands.rs**

  Open `apps/desktop/src-tauri/src/commands.rs`. At the top, add the import:

  ```rust
  use keyring::Entry;
  ```

  Then add these three commands at the end of the file:

  ```rust
  #[tauri::command]
  pub fn secure_store(key: String, value: String) -> Result<(), String> {
      Entry::new("voquill", &key)
          .map_err(|e| e.to_string())?
          .set_password(&value)
          .map_err(|e| e.to_string())
  }

  #[tauri::command]
  pub fn secure_get(key: String) -> Result<Option<String>, String> {
      let entry = Entry::new("voquill", &key).map_err(|e| e.to_string())?;
      match entry.get_password() {
          Ok(val) => Ok(Some(val)),
          Err(keyring::Error::NoEntry) => Ok(None),
          Err(e) => Err(e.to_string()),
      }
  }

  #[tauri::command]
  pub fn secure_delete(key: String) -> Result<(), String> {
      let entry = Entry::new("voquill", &key).map_err(|e| e.to_string())?;
      match entry.delete_credential() {
          Ok(_) => Ok(()),
          Err(keyring::Error::NoEntry) => Ok(()),
          Err(e) => Err(e.to_string()),
      }
  }
  ```

- [ ] **Step 3: Add `oauth_start_callback_server` command to commands.rs**

  Add this import at the top of commands.rs (with existing imports):

  ```rust
  use std::net::TcpListener;
  use std::io::{Read, Write};
  ```

  Add this command at the end of the file:

  ```rust
  /// Starts a local HTTP server on a random port to receive the Google OAuth callback.
  /// Returns the port. Emits a "google-oauth-code" event on the app window with
  /// payload { code: String } once the callback arrives.
  #[tauri::command]
  pub async fn oauth_start_callback_server(app: tauri::AppHandle) -> Result<u16, String> {
      let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
      let port = listener.local_addr().map_err(|e| e.to_string())?.port();

      tokio::task::spawn_blocking(move || {
          if let Ok((mut stream, _)) = listener.accept() {
              let mut request = String::new();
              let mut buf = [0u8; 4096];
              if let Ok(n) = stream.read(&mut buf) {
                  request = String::from_utf8_lossy(&buf[..n]).to_string();
              }

              // Parse the `code` query parameter from the GET request line
              let code = request
                  .lines()
                  .next()
                  .and_then(|line| line.split_whitespace().nth(1))
                  .and_then(|path| {
                      path.split('?').nth(1).and_then(|query| {
                          query.split('&').find_map(|pair| {
                              let mut parts = pair.splitn(2, '=');
                              if parts.next() == Some("code") {
                                  parts.next().map(|v| v.to_string())
                              } else {
                                  None
                              }
                          })
                      })
                  });

              // Send a plain HTTP response so the browser shows something
              let html = b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n\
                  <html><body><h2>Voquill: Google Drive connected.</h2>\
                  <p>You can close this tab.</p></body></html>";
              let _ = stream.write_all(html);

              // Extract both `code` and `state` from query string
              let extract_param = |query: &str, key: &str| -> Option<String> {
                  query.split('&').find_map(|pair| {
                      let mut parts = pair.splitn(2, '=');
                      if parts.next() == Some(key) { parts.next().map(|v| v.to_string()) } else { None }
                  })
              };

              let query_str = request.lines().next()
                  .and_then(|line| line.split_whitespace().nth(1))
                  .and_then(|path| path.split('?').nth(1))
                  .unwrap_or("");

              let code = extract_param(query_str, "code");
              let state = extract_param(query_str, "state");

              if let Some(code) = code {
                  let _ = app.emit("google-oauth-code", serde_json::json!({ "code": code, "state": state }));
              }
          }
      });

      Ok(port)
  }
  ```

- [ ] **Step 4: Register the 4 new commands in app.rs**

  Open `apps/desktop/src-tauri/src/app.rs`. Find the `.invoke_handler(tauri::generate_handler![` block. Add the four new commands to the list:

  ```rust
  crate::commands::secure_store,
  crate::commands::secure_get,
  crate::commands::secure_delete,
  crate::commands::oauth_start_callback_server,
  ```

- [ ] **Step 5: Verify Rust compiles**

  ```bash
  cd apps/desktop/src-tauri && cargo check
  ```

  Expected: compiles with no errors. Fix any import issues if they arise.

- [ ] **Step 6: Commit**

  ```bash
  git add apps/desktop/src-tauri/Cargo.toml \
    apps/desktop/src-tauri/src/commands.rs \
    apps/desktop/src-tauri/src/app.rs
  git commit -m "feat: add rust commands for oauth callback server and secure token storage"
  ```

---

## Task 4: GoogleDriveClient TypeScript Class

**Files:**
- Create: `apps/desktop/src/repos/google-drive.client.ts`

- [ ] **Step 1: Create the client**

  Create `apps/desktop/src/repos/google-drive.client.ts`:

  ```typescript
  import { invoke } from '@tauri-apps/api/core';

  const DRIVE_API = 'https://www.googleapis.com/drive/v3';
  const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
  const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

  export type DriveFile = { id: string; name: string; mimeType: string };

  export class GoogleDriveClient {
    private accessToken: string;
    private readonly refreshToken: string;
    private readonly clientId: string;

    constructor(accessToken: string, refreshToken: string, clientId: string) {
      this.accessToken = accessToken;
      this.refreshToken = refreshToken;
      this.clientId = clientId;
    }

    private async authHeaders(): Promise<Record<string, string>> {
      return { Authorization: `Bearer ${this.accessToken}` };
    }

    private async refreshIfNeeded(response: Response): Promise<boolean> {
      if (response.status !== 401) return false;
      const body = new URLSearchParams({
        client_id: this.clientId,
        refresh_token: this.refreshToken,
        grant_type: 'refresh_token',
      });
      const res = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      if (!res.ok) throw new Error('Token refresh failed');
      const data = await res.json();
      this.accessToken = data.access_token;
      // Persist the new access token
      await invoke('secure_store', { key: 'google_drive_access_token', value: this.accessToken });
      return true;
    }

    private async get(url: string): Promise<Response> {
      let res = await fetch(url, { headers: await this.authHeaders() });
      if (await this.refreshIfNeeded(res)) {
        res = await fetch(url, { headers: await this.authHeaders() });
      }
      return res;
    }

    private async post(url: string, body: unknown, contentType = 'application/json'): Promise<Response> {
      const headers = { ...(await this.authHeaders()), 'Content-Type': contentType };
      let res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
      if (await this.refreshIfNeeded(res)) {
        res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
      }
      return res;
    }

    private async patch(url: string, body: string, contentType = 'application/json'): Promise<Response> {
      const headers = { ...(await this.authHeaders()), 'Content-Type': contentType };
      let res = await fetch(url, { method: 'PATCH', headers, body });
      if (await this.refreshIfNeeded(res)) {
        res = await fetch(url, { method: 'PATCH', headers, body });
      }
      return res;
    }

    /** Returns the file ID if the path exists in the given parent folder, else null. */
    async findFile(name: string, parentId: string): Promise<string | null> {
      const q = encodeURIComponent(`name='${name}' and '${parentId}' in parents and trashed=false`);
      const res = await this.get(`${DRIVE_API}/files?q=${q}&fields=files(id,name)`);
      if (!res.ok) throw new Error(`Drive list failed: ${res.status}`);
      const data = await res.json();
      return data.files?.[0]?.id ?? null;
    }

    /** Creates a folder; returns its ID. */
    async createFolder(name: string, parentId?: string): Promise<string> {
      const metadata: Record<string, unknown> = { name, mimeType: 'application/vnd.google-apps.folder' };
      if (parentId) metadata.parents = [parentId];
      const res = await this.post(`${DRIVE_API}/files?fields=id`, metadata);
      if (!res.ok) throw new Error(`Drive createFolder failed: ${res.status}`);
      const data = await res.json();
      return data.id as string;
    }

    /** Gets or creates a folder by name under an optional parent. Returns its Drive file ID. */
    async getOrCreateFolder(name: string, parentId?: string): Promise<string> {
      const q = parentId
        ? encodeURIComponent(`name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`)
        : encodeURIComponent(`name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
      const res = await this.get(`${DRIVE_API}/files?q=${q}&fields=files(id)`);
      if (!res.ok) throw new Error(`Drive folder lookup failed: ${res.status}`);
      const data = await res.json();
      if (data.files?.length > 0) return data.files[0].id as string;
      return this.createFolder(name, parentId);
    }

    /** Reads a file's JSON content by Drive file ID. Returns null if not found. */
    async readJson<T>(fileId: string): Promise<T | null> {
      const res = await this.get(`${DRIVE_API}/files/${fileId}?alt=media`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Drive read failed: ${res.status}`);
      return res.json() as Promise<T>;
    }

    /**
     * Writes JSON to a file. Creates the file if it doesn't exist, updates it if it does.
     * Returns the file ID.
     */
    async writeJson(name: string, parentId: string, content: unknown): Promise<string> {
      const existingId = await this.findFile(name, parentId);
      const body = JSON.stringify(content);

      if (existingId) {
        const res = await this.patch(
          `${UPLOAD_API}/files/${existingId}?uploadType=media`,
          body,
          'application/json',
        );
        if (!res.ok) throw new Error(`Drive update failed: ${res.status}`);
        return existingId;
      }

      // Multipart upload: metadata + media
      const boundary = 'voquill_boundary';
      const metadata = JSON.stringify({ name, parents: [parentId], mimeType: 'application/json' });
      const multipart =
        `--${boundary}\r\nContent-Type: application/json\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n` +
        `--${boundary}--`;

      const headers = {
        ...(await this.authHeaders()),
        'Content-Type': `multipart/related; boundary=${boundary}`,
      };
      let res = await fetch(`${UPLOAD_API}/files?uploadType=multipart&fields=id`, {
        method: 'POST',
        headers,
        body: multipart,
      });
      if (await this.refreshIfNeeded(res)) {
        res = await fetch(`${UPLOAD_API}/files?uploadType=multipart&fields=id`, {
          method: 'POST',
          headers,
          body: multipart,
        });
      }
      if (!res.ok) throw new Error(`Drive create failed: ${res.status}`);
      const data = await res.json();
      return data.id as string;
    }
  }
  ```

- [ ] **Step 2: Run type check**

  ```bash
  cd apps/desktop && pnpm run check-types
  ```

  Expected: no TypeScript errors in the new file.

- [ ] **Step 3: Commit**

  ```bash
  git add apps/desktop/src/repos/google-drive.client.ts
  git commit -m "feat: add GoogleDriveClient for Drive REST API v3"
  ```

---

## Task 5: SyncEngine — Diff, Merge, and Manifest Logic (TDD)

**Files:**
- Create: `apps/desktop/src/actions/sync-engine.ts`
- Create: `apps/desktop/src/actions/sync-engine.test.ts`

- [ ] **Step 1: Write failing tests**

  Create `apps/desktop/src/actions/sync-engine.test.ts`:

  ```typescript
  import { describe, it, expect } from 'vitest';
  import {
    classifyEntity,
    mergeByUpdatedAt,
    buildManifest,
    type DriveManifest,
    type SyncRecord,
  } from './sync-engine';

  describe('classifyEntity', () => {
    it('returns UPLOAD when local is newer', () => {
      expect(classifyEntity('2026-04-02T10:00:00Z', '2026-04-02T09:00:00Z')).toBe('UPLOAD');
    });

    it('returns DOWNLOAD when drive is newer', () => {
      expect(classifyEntity('2026-04-02T09:00:00Z', '2026-04-02T10:00:00Z')).toBe('DOWNLOAD');
    });

    it('returns IN_SYNC when equal', () => {
      expect(classifyEntity('2026-04-02T10:00:00Z', '2026-04-02T10:00:00Z')).toBe('IN_SYNC');
    });

    it('returns UPLOAD when drive timestamp is null (first sync)', () => {
      expect(classifyEntity('2026-04-02T10:00:00Z', null)).toBe('UPLOAD');
    });

    it('returns DOWNLOAD when local timestamp is null (restore)', () => {
      expect(classifyEntity(null, '2026-04-02T10:00:00Z')).toBe('DOWNLOAD');
    });
  });

  describe('mergeByUpdatedAt', () => {
    it('includes records present only on local side', () => {
      const local: SyncRecord[] = [{ id: '1' }];
      const remote: SyncRecord[] = [];
      expect(mergeByUpdatedAt(local, remote)).toHaveLength(1);
    });

    it('includes records present only on remote side', () => {
      const local: SyncRecord[] = [];
      const remote: SyncRecord[] = [{ id: '2' }];
      expect(mergeByUpdatedAt(local, remote)).toHaveLength(1);
    });

    it('prefers local when both records lack updatedAt', () => {
      const local: SyncRecord[] = [{ id: '1', value: 'local' }];
      const remote: SyncRecord[] = [{ id: '1', value: 'remote' }];
      const result = mergeByUpdatedAt(local, remote);
      expect(result).toHaveLength(1);
      expect((result[0] as { value: string }).value).toBe('local');
    });

    it('prefers newer record when both have updatedAt', () => {
      const local: SyncRecord[] = [{ id: '1', value: 'old', updatedAt: '2026-04-01T10:00:00Z' }];
      const remote: SyncRecord[] = [{ id: '1', value: 'new', updatedAt: '2026-04-02T10:00:00Z' }];
      const result = mergeByUpdatedAt(local, remote);
      expect(result).toHaveLength(1);
      expect((result[0] as { value: string }).value).toBe('new');
    });

    it('includes tombstone records (isDeleted: true) from remote side', () => {
      const local: SyncRecord[] = [];
      const remote: SyncRecord[] = [{ id: '1', isDeleted: true, updatedAt: '2026-04-02T10:00:00Z' }];
      const result = mergeByUpdatedAt(local, remote);
      expect(result).toHaveLength(1);
      expect((result[0] as { isDeleted: boolean }).isDeleted).toBe(true);
    });

    it('preserves local live record when local updatedAt is newer than remote tombstone', () => {
      const local: SyncRecord[] = [{ id: '1', value: 'alive', updatedAt: '2026-04-03T10:00:00Z' }];
      const remote: SyncRecord[] = [{ id: '1', isDeleted: true, updatedAt: '2026-04-02T10:00:00Z' }];
      const result = mergeByUpdatedAt(local, remote);
      expect(result).toHaveLength(1);
      expect((result[0] as { value: string }).value).toBe('alive');
    });

    it('merges non-overlapping records from both sides', () => {
      const local: SyncRecord[] = [{ id: '1' }];
      const remote: SyncRecord[] = [{ id: '2' }];
      expect(mergeByUpdatedAt(local, remote)).toHaveLength(2);
    });
  });

  describe('buildManifest', () => {
    it('includes a schemaVersion of 1', () => {
      const manifest = buildManifest({}, {});
      expect(manifest.schemaVersion).toBe(1);
    });

    it('sets lastSyncedAt to a recent ISO timestamp', () => {
      const before = Date.now();
      const manifest = buildManifest({}, {});
      const after = Date.now();
      const ts = new Date(manifest.lastSyncedAt).getTime();
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });
  });
  ```

- [ ] **Step 2: Run tests to confirm they fail**

  ```bash
  cd apps/desktop && pnpm run test:unit -- sync-engine.test.ts
  ```

  Expected: multiple failures — `classifyEntity`, `mergeByUpdatedAt`, `buildManifest` not found.

- [ ] **Step 3: Implement sync-engine.ts**

  Create `apps/desktop/src/actions/sync-engine.ts`:

  ```typescript
  import type { GoogleDriveClient } from '../repos/google-drive.client';
  import type { SyncablePreferences } from '@voquill/types';

  export const SCHEMA_VERSION = 1;

  /**
   * Entity sync strategy: merge-then-upload on every cycle.
   * No per-entity timestamp comparison — entities are small text files.
   * On each cycle: download Drive entity file (if exists) → union with local
   * (local wins on same-ID conflict) → upload merged result to Drive.
   * This ensures both machines accumulate each other's new records.
   *
   * Known v1 limitation: edits to existing records on one machine while
   * another machine syncs will be overwritten (last sync wins per record ID).
   * Deletions are not propagated — both sides keep their records.
   */

  /** Minimal shape required by sync logic — just needs an `id`. */
  export type SyncRecord = { id: string; [key: string]: unknown };

  /**
   * Safe transcription DTO — audio file path is excluded.
   * Only text fields are written to Drive.
   */
  export type SyncableTranscription = {
    id: string;
    transcript: string;
    rawTranscript?: string | null;
    createdAt: string; // used as the sync timestamp
    toneId?: string | null;
    postProcessMode?: string | null;
    warnings?: string[] | null;
    schemaVersion: number;
    isDeleted?: boolean; // tombstone flag — when true, recipient deletes the local record
  };

  export type DriveManifest = {
    schemaVersion: number;
    lastSyncedAt: string;
    entities: Record<string, { syncedAt: string }>;
    transcriptions: Record<string, { createdAt: string }>;
  };

  export type EntityFile = {
    schemaVersion: number;
    syncedAt: string;
    records: SyncRecord[];
  };

  /** Compares two ISO timestamps. Returns classification for the local entity. */
  export function classifyEntity(
    localTs: string | null,
    driveTs: string | null,
  ): SyncClassification {
    if (!driveTs) return 'UPLOAD';
    if (!localTs) return 'DOWNLOAD';
    if (localTs > driveTs) return 'UPLOAD';
    if (localTs < driveTs) return 'DOWNLOAD';
    return 'IN_SYNC';
  }

  /**
   * Merges two record arrays by `id` with per-record conflict resolution.
   *
   * Resolution rules (in priority order):
   * 1. When both records have `updatedAt`: the record with the later timestamp wins.
   * 2. When one or both lack `updatedAt`: local wins (safe fallback — should not occur after
   *    migrations 066+067 backfill existing records with initial timestamps).
   * 3. Tombstone records (`isDeleted: true`) participate in timestamp comparison; a tombstone
   *    only wins if its `updatedAt` is newer than the live local record's `updatedAt`.
   *
   * The merged output includes tombstone records so they propagate to other machines on
   * the next upload. The caller (`runSyncCycle`) is responsible for applying tombstones
   * to the local store.
   */
  export function mergeByUpdatedAt<T extends SyncRecord>(local: T[], remote: T[]): T[] {
    const localMap = new Map<string, T>(local.map((r) => [r.id, r]));
    const remoteMap = new Map<string, T>(remote.map((r) => [r.id, r]));
    const allIds = new Set([...localMap.keys(), ...remoteMap.keys()]);
    const result: T[] = [];
    for (const id of allIds) {
      const l = localMap.get(id);
      const r = remoteMap.get(id);
      if (!l && r) {
        result.push(r); // new from remote (may be tombstone — caller handles apply)
      } else if (l && !r) {
        result.push(l); // local only
      } else if (l && r) {
        const lTs = (l as Record<string, unknown>).updatedAt as string | undefined;
        const rTs = (r as Record<string, unknown>).updatedAt as string | undefined;
        if (lTs && rTs) {
          result.push(lTs >= rTs ? l : r); // newer wins (includes tombstone wins)
        } else {
          result.push(l); // no timestamps: local wins (safe fallback)
        }
      }
    }
    return result;
  }

  /** Builds a fresh manifest from the current entity timestamps and transcription index. */
  export function buildManifest(
    entitySyncedAts: Record<string, string>,
    transcriptionIndex: Record<string, { createdAt: string }>,
  ): DriveManifest {
    const entities: Record<string, { syncedAt: string }> = {};
    for (const [key, syncedAt] of Object.entries(entitySyncedAts)) {
      entities[key] = { syncedAt };
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      lastSyncedAt: new Date().toISOString(),
      entities,
      transcriptions: transcriptionIndex,
    };
  }

  export type SyncContext = {
    getLocalEntityRecords: (entityName: string) => Promise<SyncRecord[]>;
    getLocalTranscriptionIds: () => Promise<Array<{ id: string; createdAt: string }>>;
    getLocalTranscription: (id: string) => Promise<SyncableTranscription | null>;
    applyEntityRecords: (entityName: string, merged: SyncRecord[]) => Promise<void>;
    applyTranscription: (record: SyncableTranscription) => Promise<void>;
  };

  const ENTITY_NAMES = [
    'terms', 'tones', 'preferences', 'conversations',
    'chat_messages', 'app_targets', 'hotkeys', 'user_profile',
  ] as const;

  /**
   * Runs one complete sync cycle.
   *
   * Entity files: merge-then-upload on every cycle (download → union → upload).
   * Transcription files: per-record, upload new ones only (keyed by createdAt).
   *
   * Returns { uploaded, downloaded, errors }.
   */
  export async function runSyncCycle(
    client: GoogleDriveClient,
    rootFolderId: string,
    transcriptionsFolderId: string,
    ctx: SyncContext,
  ): Promise<{ uploaded: number; downloaded: number; errors: string[] }> {
    const errors: string[] = [];
    let uploaded = 0;
    let downloaded = 0;

    // Step 1: Read manifest (informational — used for transcription index and display)
    let manifest: DriveManifest | null = null;
    try {
      const manifestFileId = await client.findFile('manifest.json', rootFolderId);
      if (manifestFileId) {
        const raw = await client.readJson<DriveManifest>(manifestFileId);
        if (raw && raw.schemaVersion > SCHEMA_VERSION) {
          // Drive was written by a newer app version — abort to avoid data corruption
          errors.push(`Drive schemaVersion ${raw.schemaVersion} > app schemaVersion ${SCHEMA_VERSION}. Update the app before syncing.`);
          return { uploaded: 0, downloaded: 0, errors };
        }
        if (raw) manifest = raw;
      }
    } catch (e) {
      errors.push(`Manifest read failed: ${String(e)}`);
    }

    // Step 2: For each entity — download, merge by timestamp, apply diff, upload.
    // getLocalEntityRecords MUST return ALL records including soft-deleted (isDeleted: true)
    // so tombstones are included in the merged output for propagation to other machines.
    const newEntitySyncedAts: Record<string, string> = {};

    for (const name of ENTITY_NAMES) {
      try {
        const localRecords = await ctx.getLocalEntityRecords(name); // includes tombstones
        const localMap = new Map(localRecords.map((r) => [r.id, r]));

        // Download Drive entity file
        let driveRecords: SyncRecord[] = [];
        const fileId = await client.findFile(`${name}.json`, rootFolderId);
        if (fileId) {
          const driveFile = await client.readJson<EntityFile>(fileId);
          if (driveFile && driveFile.schemaVersion <= SCHEMA_VERSION) {
            driveRecords = driveFile.records;
          }
        }

        // Merge: newer updatedAt wins; local wins as fallback for records without timestamps.
        // Result includes tombstones so they propagate on upload.
        const merged = mergeByUpdatedAt(localRecords, driveRecords);

        // Compute which Drive records need to be applied to local:
        // - New from Drive (not in local): create locally
        // - Drive tombstone where local is alive: delete locally
        // - Drive record is newer than local (Drive won the merge): update locally
        const recordsToApply: SyncRecord[] = [];
        for (const driveRecord of driveRecords) {
          const local = localMap.get(driveRecord.id);
          if (!local) {
            recordsToApply.push(driveRecord); // new from Drive (may be tombstone)
          } else if (driveRecord.isDeleted && !local.isDeleted) {
            recordsToApply.push(driveRecord); // tombstone propagation
          } else {
            const driveTs = (driveRecord as Record<string, unknown>).updatedAt as string | undefined;
            const localTs = (local as Record<string, unknown>).updatedAt as string | undefined;
            if (driveTs && localTs && driveTs > localTs) {
              recordsToApply.push(driveRecord); // Drive is newer → update local
            }
          }
        }
        if (recordsToApply.length > 0) {
          await ctx.applyEntityRecords(name, recordsToApply);
          downloaded += recordsToApply.filter((r) => !r.isDeleted).length;
        }

        // Upload merged result (always) — includes tombstones for cross-machine propagation
        const now = new Date().toISOString();
        const mergedFile: EntityFile = { schemaVersion: SCHEMA_VERSION, syncedAt: now, records: merged };
        await client.writeJson(`${name}.json`, rootFolderId, mergedFile);
        newEntitySyncedAts[name] = now;
        uploaded++;
      } catch (e) {
        errors.push(`Entity sync failed (${name}): ${String(e)}`);
      }
    }

    // Step 3: Sync transcriptions (per-record, keyed by createdAt)
    const newTranscriptionIndex: Record<string, { createdAt: string }> = {
      ...(manifest?.transcriptions ?? {}),
    };

    try {
      const localTranscriptions = await ctx.getLocalTranscriptionIds();
      const driveIndex = manifest?.transcriptions ?? {};

      // Upload local transcriptions not yet in Drive
      for (const local of localTranscriptions) {
        if (!driveIndex[local.id]) {
          const record = await ctx.getLocalTranscription(local.id);
          if (record) {
            await client.writeJson(`${local.id}.json`, transcriptionsFolderId, record);
            newTranscriptionIndex[local.id] = { createdAt: local.createdAt };
            uploaded++;
          }
        }
      }

      // Download Drive transcriptions not present locally
      const localIds = new Set(localTranscriptions.map((t) => t.id));
      for (const [id] of Object.entries(driveIndex)) {
        if (!localIds.has(id)) {
          const fileId = await client.findFile(`${id}.json`, transcriptionsFolderId);
          if (fileId) {
            const driveRecord = await client.readJson<SyncableTranscription>(fileId);
            if (driveRecord && driveRecord.schemaVersion <= SCHEMA_VERSION) {
              await ctx.applyTranscription(driveRecord);
              downloaded++;
            }
          }
        }
      }
    } catch (e) {
      errors.push(`Transcription sync failed: ${String(e)}`);
    }

    // Step 4: Write updated manifest
    try {
      const newManifest = buildManifest(newEntitySyncedAts, newTranscriptionIndex);
      await client.writeJson('manifest.json', rootFolderId, newManifest);
    } catch (e) {
      errors.push(`Manifest write failed: ${String(e)}`);
    }

    return { uploaded, downloaded, errors };
  }
  ```

- [ ] **Step 4: Run tests — confirm they pass**

  ```bash
  cd apps/desktop && pnpm run test:unit -- sync-engine.test.ts
  ```

  Expected: all 13 tests pass.

- [ ] **Step 5: Run type check**

  ```bash
  cd apps/desktop && pnpm run check-types
  ```

  Expected: no errors.

- [ ] **Step 6: Commit**

  ```bash
  git add apps/desktop/src/actions/sync-engine.ts \
    apps/desktop/src/actions/sync-engine.test.ts
  git commit -m "feat: add SyncEngine with diff, merge, and manifest logic (tests pass)"
  ```

---

## Task 6: Google Drive Auth Actions

**Files:**
- Create: `apps/desktop/src/actions/google-drive.actions.ts`

- [ ] **Step 1: Create the actions file**

  Create `apps/desktop/src/actions/google-drive.actions.ts`:

  ```typescript
  import { invoke } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';
  import { open } from '@tauri-apps/plugin-opener';
  import { GoogleDriveClient } from '../repos/google-drive.client';
  import { produceAppState, getAppState } from '../store';
  import { getUserPreferencesRepo } from '../repos';
  import { showSnackbar, showErrorSnackbar } from './app.actions';

  const CLIENT_ID = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID as string;
  const SCOPE = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/oauth2/v2/userinfo.email';
  const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
  const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v2/userinfo';

  async function storeTokens(accessToken: string, refreshToken: string): Promise<void> {
    await invoke('secure_store', { key: 'google_drive_access_token', value: accessToken });
    await invoke('secure_store', { key: 'google_drive_refresh_token', value: refreshToken });
  }

  async function loadTokens(): Promise<{ accessToken: string; refreshToken: string } | null> {
    const accessToken = await invoke<string | null>('secure_get', { key: 'google_drive_access_token' });
    const refreshToken = await invoke<string | null>('secure_get', { key: 'google_drive_refresh_token' });
    if (!accessToken || !refreshToken) return null;
    return { accessToken, refreshToken };
  }

  async function clearTokens(): Promise<void> {
    await invoke('secure_delete', { key: 'google_drive_access_token' });
    await invoke('secure_delete', { key: 'google_drive_refresh_token' });
  }

  export async function buildGoogleDriveClient(): Promise<GoogleDriveClient | null> {
    const tokens = await loadTokens();
    if (!tokens) return null;
    return new GoogleDriveClient(tokens.accessToken, tokens.refreshToken, CLIENT_ID);
  }

  export async function connectGoogleDrive(): Promise<void> {
    try {
      // Start the local OAuth callback server
      const port = await invoke<number>('oauth_start_callback_server');
      const redirectUri = `http://127.0.0.1:${port}/oauth/callback`;

      // Generate PKCE code verifier and challenge
      const verifierBytes = new Uint8Array(32);
      crypto.getRandomValues(verifierBytes);
      const codeVerifier = btoa(String.fromCharCode(...verifierBytes))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
      const encoder = new TextEncoder();
      const data = encoder.encode(codeVerifier);
      const digest = await crypto.subtle.digest('SHA-256', data);
      const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

      // CSRF state token — verified in callback to prevent open-redirect attacks
      const stateBytes = new Uint8Array(16);
      crypto.getRandomValues(stateBytes);
      const csrfState = btoa(String.fromCharCode(...stateBytes))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authUrl.searchParams.set('client_id', CLIENT_ID);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope', SCOPE);
      authUrl.searchParams.set('code_challenge', codeChallenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');
      authUrl.searchParams.set('access_type', 'offline');
      authUrl.searchParams.set('prompt', 'consent');
      authUrl.searchParams.set('state', csrfState);

      // Open browser and wait for callback
      await open(authUrl.toString());

      const code = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('OAuth timeout after 5 minutes')), 5 * 60 * 1000);
        const unlisten = listen<{ code: string; state?: string }>('google-oauth-code', (event) => {
          clearTimeout(timeout);
          unlisten.then((fn) => fn()); // clean up listener
          if (event.payload.state !== csrfState) {
            reject(new Error('OAuth state mismatch — possible CSRF attack'));
            return;
          }
          resolve(event.payload.code);
        });
      });

      // Exchange code for tokens
      const tokenRes = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: CLIENT_ID,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
          code_verifier: codeVerifier,
        }).toString(),
      });
      if (!tokenRes.ok) throw new Error(`Token exchange failed: ${tokenRes.status}`);
      const tokenData = await tokenRes.json();

      await storeTokens(tokenData.access_token, tokenData.refresh_token);

      // Fetch user email
      const infoRes = await fetch(USERINFO_ENDPOINT, {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const info = await infoRes.json();
      const email: string = info.email;

      // Update preferences
      const prefs = getAppState().userPrefs;
      if (prefs) {
        const updated = {
          ...prefs,
          googleDriveEmail: email,
          googleDriveSyncMode: prefs.googleDriveSyncMode ?? 'event',
          googleDriveSyncIntervalMinutes: prefs.googleDriveSyncIntervalMinutes ?? 15,
        };
        await getUserPreferencesRepo().setUserPreferences(updated);
        produceAppState((draft) => {
          draft.userPrefs = updated;
          draft.googleDriveSync.status = 'idle';
          draft.googleDriveSync.errorMessage = null;
        });
      }

      showSnackbar(`Google Drive connected as ${email}`, { mode: 'success' });
    } catch (error) {
      produceAppState((draft) => {
        draft.googleDriveSync.status = 'error';
        draft.googleDriveSync.errorMessage = String(error);
      });
      showErrorSnackbar(error);
    }
  }

  export async function disconnectGoogleDrive(): Promise<void> {
    await clearTokens();
    const prefs = getAppState().userPrefs;
    if (prefs) {
      const updated = {
        ...prefs,
        googleDriveEmail: null,
        googleDriveSyncMode: null,
        googleDriveSyncIntervalMinutes: null,
        googleDriveLastSyncedAt: null,
      };
      await getUserPreferencesRepo().setUserPreferences(updated);
      produceAppState((draft) => {
        draft.userPrefs = updated;
        draft.googleDriveSync.status = 'idle';
        draft.googleDriveSync.errorMessage = null;
      });
    }
    showSnackbar('Google Drive disconnected', { mode: 'success' });
  }

  export async function updateSyncMode(
    mode: 'event' | 'interval' | 'manual',
    intervalMinutes?: number,
  ): Promise<void> {
    const prefs = getAppState().userPrefs;
    if (!prefs) return;
    const updated = {
      ...prefs,
      googleDriveSyncMode: mode,
      googleDriveSyncIntervalMinutes: intervalMinutes ?? prefs.googleDriveSyncIntervalMinutes ?? 15,
    };
    await getUserPreferencesRepo().setUserPreferences(updated);
    produceAppState((draft) => {
      draft.userPrefs = updated;
    });
  }
  ```

- [ ] **Step 2: Run type check**

  ```bash
  cd apps/desktop && pnpm run check-types
  ```

  Expected: no errors. If `@tauri-apps/plugin-shell` is not found, check the import — it may be `@tauri-apps/api/shell` in older Tauri v2 setups. Use the version that the existing codebase uses.

- [ ] **Step 3: Commit**

  ```bash
  git add apps/desktop/src/actions/google-drive.actions.ts
  git commit -m "feat: add google drive connect/disconnect actions with oauth2 pkce flow"
  ```

---

## Task 7: SyncScheduler

**Files:**
- Create: `apps/desktop/src/actions/sync-scheduler.ts`

- [ ] **Step 1: Create the scheduler**

  Create `apps/desktop/src/actions/sync-scheduler.ts`:

  ```typescript
  import { getAppState, produceAppState } from '../store';
  import { buildGoogleDriveClient } from './google-drive.actions';
  import { runSyncCycle, type SyncContext, type SyncRecord, type SyncableTranscription, SCHEMA_VERSION } from './sync-engine';
  import type { SyncablePreferences } from '@voquill/types';
  import {
    getUserPreferencesRepo, getTermRepo, getToneRepo, getTranscriptionRepo,
    getConversationRepo, getChatMessageRepo, getAppTargetRepo, getHotkeyRepo,
    getUserRepo,
  } from '../repos';

  const DEBOUNCE_MS = 5_000;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let intervalTimer: ReturnType<typeof setInterval> | null = null;
  let rootFolderId: string | null = null;
  let transcriptionsFolderId: string | null = null;

  /** Returns a stable ISO timestamp representing "the last time this entity set was modified".
   *  For entities without updatedAt, we use the most recent createdAt across all records.
   *  Falls back to epoch if no records exist. */
  function latestCreatedAt(records: Array<{ createdAt?: string | number | null }>): string {
    if (records.length === 0) return '1970-01-01T00:00:00Z';
    return records.reduce((max, r) => {
      const ts = r.createdAt ? new Date(r.createdAt).toISOString() : '1970-01-01T00:00:00Z';
      return ts > max ? ts : max;
    }, '1970-01-01T00:00:00Z');
  }

  function buildSyncContext(): SyncContext {
    return {
      getLocalEntityRecords: async (entityName): Promise<SyncRecord[]> => {
        switch (entityName) {
          case 'terms':
            // listTermsAll() returns ALL terms including soft-deleted (is_deleted = 1)
            // so tombstones are included in the entity file for cross-machine propagation.
            // Requires a new repo method or raw SQL query that omits the is_deleted = 0 filter.
            return (await getTermRepo().listTermsAll()) as SyncRecord[];
          case 'tones':
            // Include soft-deleted tones (tombstones) for propagation; exclude system tones.
            return (await getToneRepo().listTonesAll()).filter((t) => !t.isSystem) as SyncRecord[];
          case 'preferences': {
            const prefs = getAppState().userPrefs;
            if (!prefs) return [];
            // Strip sensitive fields before writing to Drive
            const {
              transcriptionApiKeyId, postProcessingApiKeyId,
              agentModeApiKeyId, openclawToken, openclawGatewayUrl,
              isEnterprise, ...safe
            } = prefs;
            return [{ ...safe, id: prefs.userId }] as SyncRecord[];
          }
          case 'conversations':
            // Include soft-deleted conversations (tombstones) for cross-machine propagation.
            // When a conversation tombstone is applied, chat messages are also soft-deleted (Task 2b Step 1).
            return (await getConversationRepo().listConversationsAll?.()
              ?? await getConversationRepo().listConversations()) as SyncRecord[];
          case 'chat_messages': {
            // Include ALL messages including soft-deleted (tombstones) for propagation.
            // Requires listChatMessagesAll() that omits is_deleted = 0 filter.
            const conversations = await getConversationRepo().listConversationsAll?.()
              ?? await getConversationRepo().listConversations();
            const all: SyncRecord[] = [];
            for (const conv of conversations) {
              const messages = await getChatMessageRepo().listChatMessagesAll?.(conv.id)
                ?? await getChatMessageRepo().listChatMessages(conv.id);
              all.push(...(messages as SyncRecord[]));
            }
            return all;
          }
          case 'app_targets':
            return (await getAppTargetRepo().listAppTargetsAll?.()
              ?? await getAppTargetRepo().listAppTargets()) as SyncRecord[];
          case 'hotkeys':
            return (await getHotkeyRepo().listHotkeysAll?.()
              ?? await getHotkeyRepo().listHotkeys()) as SyncRecord[];
          case 'user_profile': {
            const user = await getUserRepo().getMyUser();
            if (!user) return [];
            return [user as SyncRecord];
          }
          default:
            return [];
        }
      },

      getLocalTranscriptionIds: async () => {
        // Include ALL transcriptions — deleted ones become tombstones for cross-machine propagation.
        // Requires listTranscriptionsAll() that omits the is_deleted = 0 filter, or a direct
        // SQL query. If the repo only has listTranscriptions (filtered), use that and document
        // that deleted transcription tombstones will NOT propagate in the current release.
        const transcriptions = await getTranscriptionRepo().listTranscriptionsAll?.({ limit: 100_000 })
          ?? await getTranscriptionRepo().listTranscriptions({ limit: 100_000 });
        return transcriptions.map((t) => ({
          id: t.id,
          createdAt: typeof t.createdAt === 'string' ? t.createdAt : new Date(t.createdAt as number).toISOString(),
        }));
      },

      getLocalTranscription: async (id): Promise<SyncableTranscription | null> => {
        const transcriptions = await getTranscriptionRepo().listTranscriptionsAll?.({ limit: 100_000 })
          ?? await getTranscriptionRepo().listTranscriptions({ limit: 100_000 });
        const t = transcriptions.find((tr) => tr.id === id);
        if (!t) return null;
        // Strip audio file path — text only; include isDeleted for tombstone propagation
        return {
          id: t.id,
          transcript: t.transcript,
          rawTranscript: t.rawTranscript ?? null,
          createdAt: typeof t.createdAt === 'string' ? t.createdAt : new Date(t.createdAt as number).toISOString(),
          toneId: null,
          postProcessMode: t.postProcessMode ?? null,
          warnings: t.warnings ?? null,
          schemaVersion: SCHEMA_VERSION,
          isDeleted: t.isDeleted ?? false,
        };
      },

      applyEntityRecords: async (entityName, records) => {
        // records may contain: new records (create), newer records (update), tombstones (delete)
        switch (entityName) {
          case 'terms': {
            // Use Zustand state for quick existence check (avoids extra DB round-trip)
            const termDoc = getAppState().termDoc;
            for (const record of records) {
              if (record.isDeleted) {
                // Tombstone from Drive: hard-delete locally (Drive propagated a deletion)
                await getTermRepo().deleteTerm(record.id);
              } else if (termDoc?.termById[record.id]) {
                // Existing term: Drive version was determined newer by mergeByUpdatedAt
                await getTermRepo().updateTerm(record.id, record as Parameters<(typeof getTermRepo())['updateTerm']>[1]);
              } else {
                // New term from Drive
                await getTermRepo().createTerm(record as Parameters<(typeof getTermRepo())['createTerm']>[0]);
              }
            }
            break;
          }
          case 'tones': {
            const toneDoc = getAppState().toneDoc;
            for (const record of records) {
              if (record.isDeleted) {
                await getToneRepo().deleteTone(record.id);
              } else if (toneDoc?.toneById[record.id]) {
                await getToneRepo().upsertTone(record as Parameters<(typeof getToneRepo())['upsertTone']>[0]);
              } else {
                await getToneRepo().upsertTone(record as Parameters<(typeof getToneRepo())['upsertTone']>[0]);
              }
            }
            break;
          }
          case 'conversations': {
            const localConvMap = new Map((getAppState().conversationIds ?? [])
              .map((id) => [id, true]));
            for (const record of records) {
              if (record.isDeleted) {
                // Tombstone: delete conversation locally. The repo deletes associated
                // chat_messages via explicit SQL (not DB cascade) before deleting the conversation.
                await getConversationRepo().deleteConversation(record.id);
              } else if (!localConvMap.has(record.id)) {
                // New from Drive
                await getConversationRepo().createConversation(record as Parameters<(typeof getConversationRepo())['createConversation']>[0]);
              } else {
                // Existing: Drive was determined newer by mergeByUpdatedAt, update title
                await getConversationRepo().updateConversation?.(record.id, record as Parameters<NonNullable<(typeof getConversationRepo())['updateConversation']>>[1]);
              }
            }
            break;
          }
          case 'chat_messages': {
            // chat_messages support content edits and individual deletion in the app.
            // Note: conversation deletion explicitly deletes its messages via SQL (not cascaded).
            const allConvs = await getConversationRepo().listConversations();
            const existingMsgMap = new Map<string, ChatMessage>();
            for (const conv of allConvs) {
              const msgs = await getChatMessageRepo().listChatMessages(conv.id);
              msgs.forEach((m) => existingMsgMap.set(m.id, m as ChatMessage));
            }
            for (const record of records) {
              if (record.isDeleted) {
                await getChatMessageRepo().deleteChatMessages([record.id]);
              } else if (existingMsgMap.has(record.id)) {
                // Drive version was determined newer by mergeByUpdatedAt: update content
                await getChatMessageRepo().updateChatMessage(record as Parameters<(typeof getChatMessageRepo())['updateChatMessage']>[0]);
              } else {
                await getChatMessageRepo().createChatMessage(record as Parameters<(typeof getChatMessageRepo())['createChatMessage']>[0]);
              }
            }
            break;
          }
          case 'app_targets': {
            const appTargetState = getAppState().appTargets ?? [];
            const localMap = new Map(appTargetState.map((a) => [a.id, a]));
            for (const record of records) {
              if (record.isDeleted) {
                await getAppTargetRepo().deleteAppTarget(record.id);
              } else if (localMap.has(record.id)) {
                // Drive is newer: update
                await getAppTargetRepo().upsertAppTarget(record as Parameters<(typeof getAppTargetRepo())['upsertAppTarget']>[0]);
              } else {
                // New from Drive
                await getAppTargetRepo().upsertAppTarget(record as Parameters<(typeof getAppTargetRepo())['upsertAppTarget']>[0]);
              }
            }
            break;
          }
          case 'hotkeys': {
            for (const record of records) {
              if (record.isDeleted) {
                await getHotkeyRepo().deleteHotkey?.(record.id);
              } else {
                // saveHotkey handles both create and update (upsert semantics)
                await getHotkeyRepo().saveHotkey(record as Parameters<(typeof getHotkeyRepo())['saveHotkey']>[0]);
              }
            }
            break;
          }
          case 'preferences': {
            for (const record of records) {
              const localPrefs = getAppState().userPrefs;
              if (!localPrefs || record.id !== localPrefs.userId) break;
              // Only apply Drive prefs if Drive version is newer (or no timestamps available)
              const driveTs = (record as { updatedAt?: string | null }).updatedAt;
              const localTs = localPrefs.updatedAt;
              if (driveTs && localTs && driveTs <= localTs) break; // local is same or newer
              // Drive is newer (or no timestamps): merge preserving local sensitive fields
              const merged = {
                ...record,
                transcriptionApiKeyId: localPrefs.transcriptionApiKeyId,
                postProcessingApiKeyId: localPrefs.postProcessingApiKeyId,
                agentModeApiKeyId: localPrefs.agentModeApiKeyId,
                openclawToken: localPrefs.openclawToken,
                openclawGatewayUrl: localPrefs.openclawGatewayUrl,
                isEnterprise: localPrefs.isEnterprise,
              };
              await getUserPreferencesRepo().setUserPreferences(
                merged as Parameters<(typeof getUserPreferencesRepo())['setUserPreferences']>[0],
              );
              produceAppState((draft) => { draft.userPrefs = merged as typeof localPrefs; });
            }
            break;
          }
          case 'user_profile': {
            // Apply Drive user_profile if Drive version is newer, or on restore (empty local)
            for (const record of records) {
              const localUser = getAppState().myUser;
              if (!localUser) {
                // Restore scenario: no local profile
                await getUserRepo().setMyUser(record as Parameters<(typeof getUserRepo())['setMyUser']>[0]);
              } else {
                const driveTs = (record as { updatedAt?: string }).updatedAt;
                const localTs = (localUser as { updatedAt?: string }).updatedAt;
                if (driveTs && localTs && driveTs > localTs) {
                  await getUserRepo().setMyUser(record as Parameters<(typeof getUserRepo())['setMyUser']>[0]);
                }
              }
            }
            break;
          }
          default: break;
        }
      },

      applyTranscription: async (record: SyncableTranscription) => {
        if (record.isDeleted) {
          // Tombstone from Drive: delete the transcription locally.
          // Transcription content is immutable once created; the only meaningful
          // "update" to a transcription is soft-deletion.
          await getTranscriptionRepo().deleteTranscription(record.id);
          return;
        }
        // Transcription content is immutable — create if not present locally (restore).
        const existing = await getTranscriptionRepo().listTranscriptions({ limit: 100_000 });
        const exists = existing.some((t) => t.id === record.id);
        if (!exists) {
          await getTranscriptionRepo().createTranscription(record as Parameters<(typeof getTranscriptionRepo())['createTranscription']>[0]);
        }
        // If already exists and not deleted: content is immutable, nothing to update.
      },
    };
  }

  async function runSync(): Promise<void> {
    const prefs = getAppState().userPrefs;
    if (!prefs?.googleDriveEmail) return; // not connected

    const client = await buildGoogleDriveClient();
    if (!client) return;

    // Ensure folder IDs are initialised
    if (!rootFolderId) {
      rootFolderId = await client.getOrCreateFolder('Voquill');
    }
    if (!transcriptionsFolderId) {
      transcriptionsFolderId = await client.getOrCreateFolder('transcriptions', rootFolderId);
    }

    produceAppState((draft) => {
      draft.googleDriveSync.status = 'syncing';
      draft.googleDriveSync.errorMessage = null;
    });

    try {
      const result = await runSyncCycle(client, rootFolderId, transcriptionsFolderId, buildSyncContext());

      const now = new Date().toISOString();
      const currentPrefs = getAppState().userPrefs;
      if (currentPrefs) {
        const updated = { ...currentPrefs, googleDriveLastSyncedAt: now };
        await getUserPreferencesRepo().setUserPreferences(updated);
        produceAppState((draft) => {
          if (draft.userPrefs) draft.userPrefs.googleDriveLastSyncedAt = now;
          draft.googleDriveSync.status = result.errors.length > 0 ? 'error' : 'idle';
          draft.googleDriveSync.errorMessage = result.errors.length > 0 ? result.errors.join('; ') : null;
        });
      }
    } catch (error) {
      produceAppState((draft) => {
        draft.googleDriveSync.status = 'error';
        draft.googleDriveSync.errorMessage = String(error);
      });
    }
  }

  /** Call after any local data write when mode is 'event'. Debounces 5 seconds. */
  export function notifySyncWrite(): void {
    const prefs = getAppState().userPrefs;
    if (!prefs?.googleDriveEmail || prefs.googleDriveSyncMode !== 'event') return;

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      runSync();
    }, DEBOUNCE_MS);
  }

  /** Trigger sync immediately (used by "Sync Now" button). */
  export function triggerManualSync(): void {
    runSync();
  }

  export function startSyncScheduler(): void {
    stopSyncScheduler();

    const prefs = getAppState().userPrefs;
    if (!prefs?.googleDriveEmail) return;

    if (prefs.googleDriveSyncMode === 'interval') {
      const minutes = prefs.googleDriveSyncIntervalMinutes ?? 15;
      intervalTimer = setInterval(runSync, minutes * 60 * 1000);
    }
    // Event mode: driven by notifySyncWrite(). Interval mode: driven by above.
    // Manual mode: driven by triggerManualSync() only.
  }

  export function stopSyncScheduler(): void {
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    if (intervalTimer) { clearInterval(intervalTimer); intervalTimer = null; }
  }
  ```

- [ ] **Step 2: Run type check**

  ```bash
  cd apps/desktop && pnpm run check-types
  ```

  Expected: no errors. If `upsertTerm` / `upsertTranscription` do not exist on the repos, check the actual method names in `term.repo.ts` and `transcription.repo.ts` and update accordingly (it may be `createTerm` + `updateTerm` separately).

- [ ] **Step 3: Commit**

  ```bash
  git add apps/desktop/src/actions/sync-scheduler.ts
  git commit -m "feat: add SyncScheduler with debounce, interval, and manual trigger modes"
  ```

---

## Task 8: Settings UI — GoogleDriveSyncSection Component

**Files:**
- Create: `apps/desktop/src/components/settings/GoogleDriveSyncSection.tsx`
- Modify: `apps/desktop/src/components/settings/SettingsPage.tsx`

- [ ] **Step 1: Create GoogleDriveSyncSection.tsx**

  Create `apps/desktop/src/components/settings/GoogleDriveSyncSection.tsx`:

  ```tsx
  import { useState, useRef, useEffect } from 'react';
  import { FormattedMessage, useIntl } from 'react-intl';
  import {
    Box, Button, CircularProgress, Divider, Radio, RadioGroup,
    FormControlLabel, Stack, TextField, Typography, Alert,
  } from '@mui/material';
  import GoogleIcon from '@mui/icons-material/Google';
  import CloudDoneOutlinedIcon from '@mui/icons-material/CloudDoneOutlined';
  import { useAppStore } from '../../store';
  import { produceAppState } from '../../store';
  import { connectGoogleDrive, disconnectGoogleDrive, updateSyncMode } from '../../actions/google-drive.actions';
  import { triggerManualSync } from '../../actions/sync-scheduler';

  function formatLastSynced(iso: string | null | undefined): string {
    if (!iso) return 'Never';
    const diff = Date.now() - new Date(iso).getTime();
    const minutes = Math.floor(diff / 60_000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    return new Date(iso).toLocaleDateString();
  }

  export function GoogleDriveSyncSection() {
    const intl = useIntl();
    const prefs = useAppStore((s) => s.userPrefs);
    const syncState = useAppStore((s) => s.googleDriveSync);
    const sectionVisible = useAppStore((s) => s.settings.googleDriveSyncSectionVisible);
    const sectionRef = useRef<HTMLDivElement>(null);
    const [intervalInput, setIntervalInput] = useState(
      String(prefs?.googleDriveSyncIntervalMinutes ?? 15),
    );
    const [isConnecting, setIsConnecting] = useState(false);

    // Scroll into view when header icon or other navigation sets googleDriveSyncSectionVisible
    useEffect(() => {
      if (sectionVisible && sectionRef.current) {
        sectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        produceAppState((draft) => { draft.settings.googleDriveSyncSectionVisible = false; });
      }
    }, [sectionVisible]);

    const isConnected = !!prefs?.googleDriveEmail;
    const mode = prefs?.googleDriveSyncMode ?? 'event';

    const handleConnect = async () => {
      setIsConnecting(true);
      try {
        await connectGoogleDrive();
      } finally {
        setIsConnecting(false);
      }
    };

    const handleModeChange = async (newMode: 'event' | 'interval' | 'manual') => {
      const minutes = parseInt(intervalInput, 10);
      await updateSyncMode(newMode, isNaN(minutes) ? 15 : Math.max(5, minutes));
    };

    const handleIntervalBlur = async () => {
      const minutes = parseInt(intervalInput, 10);
      const clamped = isNaN(minutes) ? 15 : Math.max(5, minutes);
      setIntervalInput(String(clamped));
      if (mode === 'interval') await updateSyncMode('interval', clamped);
    };

    return (
      <Stack ref={sectionRef} spacing={2} sx={{ py: 1 }}>
        {isConnected ? (
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <CloudDoneOutlinedIcon color="success" fontSize="small" />
            <Typography variant="body2" sx={{ flex: 1 }}>
              {prefs?.googleDriveEmail}
            </Typography>
            <Button
              size="small"
              color="error"
              variant="outlined"
              onClick={disconnectGoogleDrive}
            >
              <FormattedMessage defaultMessage="Disconnect" />
            </Button>
          </Stack>
        ) : (
          <Button
            variant="outlined"
            startIcon={isConnecting ? <CircularProgress size={16} /> : <GoogleIcon />}
            onClick={handleConnect}
            disabled={isConnecting}
            sx={{ alignSelf: 'flex-start' }}
          >
            <FormattedMessage defaultMessage="Connect Google Drive" />
          </Button>
        )}

        {isConnected && (
          <>
            <Divider />

            <Typography variant="body2" fontWeight={600}>
              <FormattedMessage defaultMessage="Sync mode" />
            </Typography>

            <RadioGroup
              value={mode}
              onChange={(e) => handleModeChange(e.target.value as 'event' | 'interval' | 'manual')}
            >
              <FormControlLabel
                value="event"
                control={<Radio size="small" />}
                label={
                  <Typography variant="body2">
                    <FormattedMessage defaultMessage="After every change (recommended)" />
                  </Typography>
                }
              />
              <Stack direction="row" alignItems="center" spacing={1}>
                <FormControlLabel
                  value="interval"
                  control={<Radio size="small" />}
                  label={
                    <Typography variant="body2">
                      <FormattedMessage defaultMessage="Every" />
                    </Typography>
                  }
                />
                <TextField
                  size="small"
                  type="number"
                  value={intervalInput}
                  onChange={(e) => setIntervalInput(e.target.value)}
                  onBlur={handleIntervalBlur}
                  disabled={mode !== 'interval'}
                  inputProps={{ min: 5, style: { width: 52 } }}
                  sx={{ width: 80 }}
                />
                <Typography variant="body2">
                  <FormattedMessage defaultMessage="minutes" />
                </Typography>
              </Stack>
              <FormControlLabel
                value="manual"
                control={<Radio size="small" />}
                label={
                  <Typography variant="body2">
                    <FormattedMessage defaultMessage="Manual only" />
                  </Typography>
                }
              />
            </RadioGroup>

            <Divider />

            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Typography variant="caption" color="text.secondary">
                <FormattedMessage
                  defaultMessage="Last synced: {time}"
                  values={{ time: formatLastSynced(prefs?.googleDriveLastSyncedAt) }}
                />
              </Typography>
              <Button
                size="small"
                variant="contained"
                onClick={triggerManualSync}
                disabled={syncState.status === 'syncing'}
                startIcon={syncState.status === 'syncing' ? <CircularProgress size={14} /> : undefined}
              >
                <FormattedMessage defaultMessage="Sync Now" />
              </Button>
            </Stack>

            {syncState.status === 'error' && syncState.errorMessage && (
              <Alert severity="warning" sx={{ fontSize: 12 }}>
                {syncState.errorMessage}
              </Alert>
            )}
          </>
        )}

        <Box
          sx={{
            background: (theme) => theme.palette.warning.light + '22',
            border: (theme) => `1px solid ${theme.palette.warning.light}`,
            borderRadius: 1,
            px: 1.5,
            py: 1,
          }}
        >
          <Typography variant="caption" color="text.secondary">
            <FormattedMessage defaultMessage="⚠ API keys are not synced for security. You'll need to add them on each device." />
          </Typography>
        </Box>
      </Stack>
    );
  }
  ```

- [ ] **Step 2: Add the section to SettingsPage.tsx**

  Open `apps/desktop/src/components/settings/SettingsPage.tsx`. Add the import at the top:

  ```typescript
  import { GoogleDriveSyncSection } from './GoogleDriveSyncSection';
  ```

  Find where the sections are assembled (look for `<Section title=...>`). Add a new section — place it after the existing "General" or "Advanced" section:

  ```tsx
  const cloudSync = (
    <Section title={<FormattedMessage defaultMessage="Cloud Sync" />}>
      <GoogleDriveSyncSection />
    </Section>
  );
  ```

  Then include `{cloudSync}` in the returned JSX stack.

- [ ] **Step 3: Run type check**

  ```bash
  cd apps/desktop && pnpm run check-types
  ```

  Expected: no errors. Fix any missing imports.

- [ ] **Step 4: Commit**

  ```bash
  git add apps/desktop/src/components/settings/GoogleDriveSyncSection.tsx \
    apps/desktop/src/components/settings/SettingsPage.tsx
  git commit -m "feat: add Google Drive sync section to settings page"
  ```

---

## Task 9: Header Sync Status Indicator

**Files:**
- Modify: `apps/desktop/src/components/root/Header.tsx`

- [ ] **Step 1: Add Drive status icon to Header.tsx**

  Open `apps/desktop/src/components/root/Header.tsx`. Add these imports at the top:

  ```typescript
  import CloudDoneOutlinedIcon from '@mui/icons-material/CloudDoneOutlined';
  import CloudOffOutlinedIcon from '@mui/icons-material/CloudOffOutlined';
  import CloudSyncOutlinedIcon from '@mui/icons-material/CloudSyncOutlined';
  import { useAppStore } from '../../store';
  import { produceAppState } from '../../store';
  ```

  Inside the `AppHeader` component, add these selectors (after the existing `myName` selector):

  ```typescript
  const googleDriveEmail = useAppStore((s) => s.userPrefs?.googleDriveEmail ?? null);
  const syncStatus = useAppStore((s) => s.googleDriveSync.status);
  const syncError = useAppStore((s) => s.googleDriveSync.errorMessage);
  const lastSyncedAt = useAppStore((s) => s.userPrefs?.googleDriveLastSyncedAt ?? null);

  const driveTooltip = syncStatus === 'syncing'
    ? `${googleDriveEmail} — Syncing…`
    : syncStatus === 'error'
    ? `${googleDriveEmail} — ${syncError ?? 'Sync failed'} (click to review)`
    : lastSyncedAt
    ? `${googleDriveEmail} — Last synced: ${new Date(lastSyncedAt).toLocaleTimeString()}`
    : `${googleDriveEmail} — Never synced`;

  // Navigate to Settings and scroll to sync section.
  const openSyncSettings = () => {
    produceAppState((draft) => {
      draft.settings.googleDriveSyncSectionVisible = true;
    });
    if (window.location.pathname !== '/dashboard/settings') {
      window.location.href = '/dashboard/settings';
    }
  };
  ```

  In the JSX, find where the profile avatar/name button is rendered. Add the Drive indicator just before (or after) the avatar. Show both the icon AND the account email so the connected account is visible at a glance:

  ```tsx
  {googleDriveEmail && (
    <Tooltip title={driveTooltip}>
      <Stack
        direction="row"
        alignItems="center"
        spacing={0.5}
        onClick={openSyncSettings}
        sx={{ cursor: 'pointer', mr: 1 }}
      >
        {syncStatus === 'syncing' ? (
          <CloudSyncOutlinedIcon fontSize="small" color="primary" sx={{ animation: 'spin 1s linear infinite', '@keyframes spin': { from: { transform: 'rotate(0deg)' }, to: { transform: 'rotate(360deg)' } } }} />
        ) : syncStatus === 'error' ? (
          <CloudOffOutlinedIcon fontSize="small" color="warning" />
        ) : (
          <CloudDoneOutlinedIcon fontSize="small" color="success" />
        )}
        <Typography variant="caption" sx={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {googleDriveEmail}
        </Typography>
      </Stack>
    </Tooltip>
  )}
  ```

  If `Tooltip` and `IconButton` are not already imported from MUI, add them:

  ```typescript
  import { Tooltip, IconButton } from '@mui/material';
  ```

- [ ] **Step 2: Run type check**

  ```bash
  cd apps/desktop && pnpm run check-types
  ```

  Expected: no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add apps/desktop/src/components/root/Header.tsx
  git commit -m "feat: add google drive sync status icon to header"
  ```

---

## Task 10: Wire Post-Write Hooks and App Boot

**Files:**
- Modify: `apps/desktop/src/components/dictionary/DictionaryPage.tsx` — createTerm hook
- Modify: `apps/desktop/src/components/dictionary/DictionaryRow.tsx` — updateTerm/deleteTerm hooks
- Modify: `apps/desktop/src/actions/tone.actions.ts` — tone write hooks
- Modify: `apps/desktop/src/actions/transcribe.actions.ts` — transcription create hook
- Modify: `apps/desktop/src/actions/remote-transcript.actions.ts` — remote transcription create hook
- Modify: `apps/desktop/src/actions/chat.actions.ts` — chat message write hooks
- Modify: `apps/desktop/src/actions/app-target.actions.ts` — app target write hooks
- Modify: `apps/desktop/src/components/settings/HotkeySetting.tsx` — hotkey save hook
- Modify: `apps/desktop/src/actions/user.actions.ts` — preference write hook
- Modify: `apps/desktop/src/components/root/RootSideEffects.ts` — start scheduler after initial data load

- [ ] **Step 1: Add notifySyncWrite to term write locations**

  Terms are written directly from UI components, not from a single actions file.

  Open `apps/desktop/src/components/dictionary/DictionaryPage.tsx`. After the `getTermRepo().createTerm(...)` call succeeds, add:

  ```typescript
  import { notifySyncWrite } from '../../actions/sync-scheduler';
  // ...after createTerm call:
  notifySyncWrite();
  ```

  Open `apps/desktop/src/components/dictionary/DictionaryRow.tsx`. After both `getTermRepo().updateTerm(...)` and `getTermRepo().deleteTerm(...)` succeed:

  ```typescript
  import { notifySyncWrite } from '../../actions/sync-scheduler';
  // ...after each write:
  notifySyncWrite();
  ```

- [ ] **Step 2: Add notifySyncWrite to tone.actions.ts**

  Open `apps/desktop/src/actions/tone.actions.ts`. Add the import:

  ```typescript
  import { notifySyncWrite } from './sync-scheduler';
  ```

  Add `notifySyncWrite()` after every successful `produceAppState(...)` in `upsertTone` and `deleteTone`.

- [ ] **Step 3: Add notifySyncWrite to transcription create and delete locations**

  Open `apps/desktop/src/actions/transcribe.actions.ts`. Find the `getTranscriptionRepo().createTranscription(...)` call (around line 439). After it succeeds:

  ```typescript
  import { notifySyncWrite } from './sync-scheduler';
  // ...after createTranscription:
  notifySyncWrite();
  ```

  Open `apps/desktop/src/actions/remote-transcript.actions.ts`. Find the `getTranscriptionRepo().createTranscription(...)` call (around line 60). After it succeeds, add the same `notifySyncWrite()` call with the same import.

  Open `apps/desktop/src/components/transcriptions/TranscriptRow.tsx`. Add the import at the top:

  ```typescript
  import { notifySyncWrite } from '../../actions/sync-scheduler';
  ```

  In `handleDeleteTranscript` (around line 90), after `await getTranscriptionRepo().deleteTranscription(id);` succeeds (before the `showSnackbar` call), add `notifySyncWrite();`.

- [ ] **Step 4: Add notifySyncWrite to chat, app-target, and hotkey writes**

  Open `apps/desktop/src/actions/chat.actions.ts`. Add the import at the top:

  ```typescript
  import { notifySyncWrite } from './sync-scheduler';
  ```

  Add `notifySyncWrite()` after the `return saved` / `produceAppState` call in each of the following exported functions:
  - `createConversation` — after `return saved;` (line ~41)
  - `updateConversation` — after `return saved;` (line ~53)
  - `deleteConversation` — after the `produceAppState` block (line ~70)
  - `createChatMessage` — after `return saved;` (line ~96)
  - `updateChatMessage` — after `return saved;` (line ~108)
  - `deleteChatMessages` — after the `produceAppState` block (line ~127)

  Open `apps/desktop/src/actions/app-target.actions.ts`. Add the import and call `notifySyncWrite()` after each successful app target upsert/delete.

  Open `apps/desktop/src/components/settings/HotkeySetting.tsx`. Add the import at the top:

  ```typescript
  import { notifySyncWrite } from '../../actions/sync-scheduler';
  ```

  In `saveKey` (around line 97), after `await syncHotkeyCombosToNative();`, add `notifySyncWrite();`.

  In `handleDeleteHotkey` (around line 113), after `await syncHotkeyCombosToNative();`, add `notifySyncWrite();`.

  Open `apps/desktop/src/components/settings/DictationLanguageDialog.tsx`. Add the same import and add `notifySyncWrite()` after the loop that calls `repo.deleteHotkey(id)` / `repo.saveHotkey(hotkey)` and `await syncHotkeyCombosToNative()` (around line 229).

  Open `apps/desktop/src/components/onboarding/KeybindingsForm.tsx`. Add the import:

  ```typescript
  import { notifySyncWrite } from '../../../actions/sync-scheduler';
  ```

  After `await syncHotkeyCombosToNative();` (around line 104), add `notifySyncWrite();`.

  Open `apps/desktop/src/agents/run-agent.ts`. Add the import at the top:

  ```typescript
  import { notifySyncWrite } from '../actions/sync-scheduler';
  ```

  After the `await getChatMessageRepo().createChatMessage(final);` call (around line 277), add `notifySyncWrite();`.

- [ ] **Step 5: Add notifySyncWrite to user.actions.ts**

  Open `apps/desktop/src/actions/user.actions.ts`. Add:

  ```typescript
  import { notifySyncWrite } from './sync-scheduler';
  ```

  Find `updateUserPreferences` (or equivalent function that saves preferences via the repo). After the successful repo save and `produceAppState(...)` call, add:

  ```typescript
  notifySyncWrite();
  ```

- [ ] **Step 6: Start scheduler in RootSideEffects.ts**

  Open `apps/desktop/src/components/root/RootSideEffects.ts`. Add this import at the top:

  ```typescript
  import { startSyncScheduler } from '../../actions/sync-scheduler';
  ```

  Inside `useAsyncEffect`, after the `await Promise.allSettled(loaders)` line (the initial data load is complete, so preferences are in state):

  ```typescript
  startSyncScheduler();
  ```

- [ ] **Step 6: Run full type check and tests**

  ```bash
  cd apps/desktop && pnpm run check-types && pnpm run test:unit
  ```

  Expected: all types valid, all unit tests pass (9 tests in sync-engine.test.ts).

- [ ] **Step 7: Commit**

  ```bash
  git add apps/desktop/src/components/dictionary/DictionaryPage.tsx \
    apps/desktop/src/components/dictionary/DictionaryRow.tsx \
    apps/desktop/src/actions/tone.actions.ts \
    apps/desktop/src/actions/transcribe.actions.ts \
    apps/desktop/src/actions/remote-transcript.actions.ts \
    apps/desktop/src/components/transcriptions/TranscriptRow.tsx \
    apps/desktop/src/actions/chat.actions.ts \
    apps/desktop/src/actions/app-target.actions.ts \
    apps/desktop/src/components/settings/HotkeySetting.tsx \
    apps/desktop/src/components/settings/DictationLanguageDialog.tsx \
    apps/desktop/src/components/onboarding/KeybindingsForm.tsx \
    apps/desktop/src/agents/run-agent.ts \
    apps/desktop/src/actions/user.actions.ts
  git commit -m "feat: wire notifySyncWrite into write actions for event-driven sync"
  ```

- [ ] **Step 8: Final integration commit**

  ```bash
  git add -A
  git commit -m "feat: complete google drive sync integration — scheduler starts on boot"
  ```

---

## Verification Checklist

After all tasks are complete, verify:

- [ ] `pnpm run check-types` passes from repo root
- [ ] `pnpm run test:unit` passes (9 sync-engine tests)
- [ ] `cargo check` passes in `apps/desktop/src-tauri`
- [ ] Connect Google Drive in Settings → browser opens Google consent → email appears in settings
- [ ] Create a term → 5 seconds later → sync runs (check "Last synced" updates)
- [ ] Change sync mode to "interval" → set 5 minutes → interval timer fires
- [ ] "Sync Now" button triggers immediate sync regardless of mode
- [ ] Drive icon in header shows green when connected, spins during sync
- [ ] Disconnect removes email and Drive icon from header
- [ ] API keys warning is visible in the Sync settings section
- [ ] Install on a second machine, connect same Google account → existing data appears after sync
