** Rules **

- Do not propose band-aid fixes to problems. Identify the root cause, be it architectural or logical, and address it directly. Don't be afraid to remove broken code. If something is broken, fix it at the root, even if that means refactoring and overhauling systems (if necessary).
- Enforce DRY code principles. If you find yourself copying and pasting code, stop and refactor it into a reusable function or module.
- Avoid over-engineering. Implement solutions that are as simple as possible while still meeting requirements.
- Your changes should have minimal impact. Do not break existing functionality.
- Write clear, maintainable code that is self documenting. Do not comments on new code except where it's necessary to explain non-obvious things.
- Prefer to follow existing patterns such as dialogs, state management, and API interactions, etc.

** Repository structure **

- This is a Turborepo monorepo. Root-level: `pnpm run build`, `pnpm run lint`, `pnpm run check-types`, `pnpm run test`.
- Shared packages live in `packages/` (types, functions, ui, etc.). After modifying `packages/types` or `packages/functions`, rebuild them before downstream consumers can see changes.
- Use `<FormattedMessage defaultMessage="..." />` or `useIntl()` for i18n — never pass an `id` prop.

** `apps/desktop` — Tauri desktop app (Rust + TypeScript/React) **

- "Rust is the API, TypeScript is the Brain" — all business logic lives in TypeScript, never duplicated in Rust. Rust provides pure API capabilities without decision-making.
- Single source of truth for state is Zustand (with Immer) in TypeScript.
- Data flow: User/Native Event → Actions (`src/actions/`) → Repos (`src/repos/`) → Tauri Commands (`src-tauri/src/commands.rs`) → SQLite/Whisper/APIs.
- Repos abstract local vs remote: `BaseXxxRepo` defines interface, `LocalXxxRepo` / `CloudXxxRepo` implement. Use `toLocalXxx()` / `fromLocalXxx()` at the Tauri boundary.
- Database migrations go in `src-tauri/src/db/migrations/` as `NNN_description.sql`, registered in `db/mod.rs`.
- New Tauri commands: define in `commands.rs`, register in `app.rs` invoke_handler, create a repo, use in actions.

** `enterprise/gateway` — Enterprise API gateway **

- Handler pattern: if-else chain in `src/index.ts`.
- Scripts: `pnpm run build`, `pnpm run check-types`, `pnpm run test`

** `enterprise/admin` — Enterprise admin dashboard (React) **

- Follows STT provider pattern for new provider types (state, actions, tab, dialog, side effects).
- Scripts: `pnpm run build`, `pnpm run lint`.

** `mobile/` — Flutter mobile app **

- Flutter project at repository root (`mobile/`), not inside `apps/`.
- Uses `flutter run`, `flutter build`, standard Flutter tooling.
- Uses `flutter_zustand` and `draft` for state management, following similar patterns as the desktop app.
- Use `./mobile/generate.sh` to re-generate code.

** `apps/web` — Marketing website (Next.js static export) **

- Next.js App Router with `output: 'export'` for fully static HTML.
- Page components live in `src/views/`, route definitions in `src/app/`.
- Uses react-intl for i18n with babel-plugin-formatjs (custom `.babelrc.js`).
- Build output goes to `out/` directory (deployed via Firebase Hosting).
- Scripts: `pnpm run build`.

** Important scripts **

---

## UPSTREAM SYNC — MANDATORY PROTOCOL

This is a **fork** of `https://github.com/voquill/voquill`. We maintain custom additions on top. Every upstream pull is a risk to our custom code.

### Before ANY upstream merge or rebase:

1. `git fetch upstream`
2. Run `git diff main upstream/main -- <file>` on every file in the **Protected Files** list below
3. For each conflict or divergence: **stop and report to the user** with a plain-language summary of what upstream changed vs what we added. Do NOT auto-resolve.
4. Get explicit approval on each conflict before proceeding.
5. After merge: run `pnpm run build` and confirm it passes before committing.

### Never silently:
- Accept an upstream change that touches a Protected File
- Let upstream overwrite our custom additions
- Auto-resolve merge conflicts in Protected Files

---

## OUR CUSTOM ADDITIONS (vs upstream)

### 1. Remote Desktop — Command-V paste fix
**Files:** `apps/desktop/src-tauri/src/platform/macos/input.rs`
**What:** `simulate_cmd_v()` sends explicit `KEY_COMMAND` key-down and key-up events wrapping the V keypress, instead of just setting `CGEventFlagCommand` on the V event alone.
**Why:** Remote desktop clients (macOS Screen Sharing etc.) track physical modifier key state in the HID stream. The flag-only approach causes them to strip the modifier and type a bare `v`. Upstream reverted this fix in their tree — we must re-apply it after every upstream merge.
**Rule:** After any upstream merge that touches `input.rs`, verify `simulate_cmd_v` still sends the full `KEY_COMMAND` down → V down → V up → `KEY_COMMAND` up sequence.

### 2. Google Drive Sync
**Branch:** `feat/google-drive-sync`
**Files:** `apps/desktop/src/actions/google-drive.actions.ts`, `sync-scheduler.ts`, `sync-engine.ts`, `sync-engine.test.ts`, `apps/desktop/src/repos/preferences.repo.ts`, `packages/types/src/preferences.types.ts`
**What:** Full Google Drive OAuth + bidirectional sync for terms, tones, conversations, messages, hotkeys, transcriptions, and preferences.
**Why:** User-requested feature not in upstream.
**Rule:** When rebasing this branch onto an updated `main`, check all repo/type files for new fields added by both sides.

### 3. Type field propagation fixes
**What:** `isDeleted` and `updatedAt` fields added to `ChatMessage`, `Conversation`, `Hotkey`, `Term`, `Tone`, `UserPreferences` — propagated through all construction sites, repo mappers, and call sites.
**Why:** Upstream added these fields to types but left callers incomplete; we fixed all 45 TS errors.
**Rule:** After an upstream merge, run `pnpm run build` immediately — new upstream type changes may re-introduce similar mismatches.

### 4. `.gitignore` — `docs/superpowers/`
**What:** `docs/superpowers/` is ignored locally (AI planning docs, not for the repo).
**Rule:** If upstream modifies `.gitignore`, ensure this line is preserved.

---

## PROTECTED FILES (check diff before every upstream merge)

```
apps/desktop/src-tauri/src/platform/macos/input.rs   ← simulate_cmd_v fix
apps/desktop/src/actions/google-drive.actions.ts      ← custom feature
apps/desktop/src/actions/sync-scheduler.ts            ← custom feature
apps/desktop/src/actions/sync-engine.ts               ← custom feature
apps/desktop/src/repos/preferences.repo.ts            ← Google Drive fields
packages/types/src/preferences.types.ts              ← Google Drive fields
.gitignore                                             ← docs/superpowers/ line
```
