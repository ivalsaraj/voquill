import { getAppState, produceAppState } from "../store";
import {
  getTermRepo,
  getToneRepo,
  getConversationRepo,
  getChatMessageRepo,
  getHotkeyRepo,
  getAppTargetRepo,
  getUserPreferencesRepo,
  getTranscriptionRepo,
} from "../repos";
import { buildGoogleDriveClient } from "./google-drive.actions";
import {
  runSyncCycle,
  type SyncContext,
  type SyncRecord,
  SCHEMA_VERSION,
  type SyncableTranscription,
} from "./sync-engine";

let intervalId: ReturnType<typeof setInterval> | null = null;
let syncing = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export function triggerEventSync(): void {
  const prefs = getAppState().userPrefs;
  if (prefs?.googleDriveSyncMode !== "event" || !prefs?.googleDriveEmail)
    return;

  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    syncNow();
  }, 3000);
}

export async function syncNow(): Promise<void> {
  if (syncing) return;
  syncing = true;
  produceAppState((draft) => {
    draft.googleDriveSync.status = "syncing";
    draft.googleDriveSync.errorMessage = null;
  });

  try {
    const client = await buildGoogleDriveClient();
    if (!client) {
      produceAppState((draft) => {
        draft.googleDriveSync.status = "idle";
      });
      return;
    }

    const rootFolderId = await client.getOrCreateFolder("Voquill");
    const transcriptionsFolderId = await client.getOrCreateFolder(
      "transcriptions",
      rootFolderId,
    );

    const ctx: SyncContext = {
      getLocalEntityRecords: async (name: string) => {
        switch (name) {
          case "terms": {
            const repo = getTermRepo();
            if (repo.listTermsAll) return (await repo.listTermsAll()) as unknown as SyncRecord[];
            return (await repo.listTerms()) as unknown as SyncRecord[];
          }
          case "tones": {
            const repo = getToneRepo();
            if (repo.listTonesAll) return (await repo.listTonesAll()) as unknown as SyncRecord[];
            return (await repo.listTones()) as unknown as SyncRecord[];
          }
          case "conversations": {
            const repo = getConversationRepo();
            if (repo.listConversationsAll) return (await repo.listConversationsAll()) as unknown as SyncRecord[];
            return (await repo.listConversations()) as unknown as SyncRecord[];
          }
          case "hotkeys": {
            const repo = getHotkeyRepo();
            if (repo.listHotkeysAll) return (await repo.listHotkeysAll()) as unknown as SyncRecord[];
            return (await repo.listHotkeys()) as unknown as SyncRecord[];
          }
          case "app_targets": {
            const repo = getAppTargetRepo();
            if (repo.listAppTargetsAll) return (await repo.listAppTargetsAll()) as unknown as SyncRecord[];
            return (await repo.listAppTargets()) as unknown as SyncRecord[];
          }
          case "preferences": {
            const prefs = getAppState().userPrefs;
            return prefs ? [prefs as unknown as SyncRecord] : [];
          }
          case "user_profile": {
            const user = getAppState().user;
            return user ? [user as unknown as SyncRecord] : [];
          }
          default:
            return [];
        }
      },
      getLocalTranscriptionIds: async () => {
        const transcriptions = await getTranscriptionRepo().listTranscriptions();
        return transcriptions.map((t) => ({
          id: t.id,
          createdAt: t.createdAt,
        }));
      },
      getLocalTranscription: async (
        id: string,
      ): Promise<SyncableTranscription | null> => {
        const transcriptions = await getTranscriptionRepo().listTranscriptions();
        const t = transcriptions.find((tr) => tr.id === id);
        if (!t) return null;
        return {
          id: t.id,
          transcript: t.transcript,
          rawTranscript: t.rawTranscript ?? null,
          createdAt: t.createdAt,
          toneId: t.toneId ?? null,
          postProcessMode: t.postProcessMode ?? null,
          warnings: t.warnings ?? null,
          schemaVersion: SCHEMA_VERSION,
        };
      },
      applyEntityRecords: async () => {},
      applyTranscription: async () => {},
    };

    const result = await runSyncCycle(
      client,
      rootFolderId,
      transcriptionsFolderId,
      ctx,
    );

    if (result.errors.length > 0) {
      console.error("[sync] errors:", result.errors);
      produceAppState((draft) => {
        draft.googleDriveSync.status = "error";
        draft.googleDriveSync.errorMessage = result.errors[0];
      });
    } else {
      const now = new Date().toISOString();
      const prefs = getAppState().userPrefs;
      if (prefs) {
        const updated = { ...prefs, googleDriveLastSyncedAt: now };
        await getUserPreferencesRepo().setUserPreferences(updated);
        produceAppState((draft) => {
          draft.userPrefs = updated;
          draft.googleDriveSync.status = "idle";
          draft.googleDriveSync.errorMessage = null;
        });
      } else {
        produceAppState((draft) => {
          draft.googleDriveSync.status = "idle";
        });
      }
    }
  } catch (error) {
    console.error("[sync] fatal:", error);
    produceAppState((draft) => {
      draft.googleDriveSync.status = "error";
      draft.googleDriveSync.errorMessage = String(error);
    });
  } finally {
    syncing = false;
  }
}

export function startSyncScheduler(): void {
  stopSyncScheduler();
  const prefs = getAppState().userPrefs;
  if (!prefs?.googleDriveEmail) return;

  const mode = prefs.googleDriveSyncMode;
  if (mode === "interval") {
    const mins = prefs.googleDriveSyncIntervalMinutes ?? 15;
    intervalId = setInterval(
      () => {
        syncNow();
      },
      mins * 60 * 1000,
    );
  }
}

export function stopSyncScheduler(): void {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
