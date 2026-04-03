import type { Term, Tone, Conversation, ChatMessage, Hotkey, AppTarget, UserPreferences, SyncablePreferences } from "@voquill/types";
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

function stripSensitivePrefs(prefs: UserPreferences): SyncablePreferences & { id: string } {
  const {
    transcriptionApiKeyId,
    postProcessingApiKeyId,
    agentModeApiKeyId,
    openclawToken,
    openclawGatewayUrl,
    isEnterprise,
    ...safe
  } = prefs;
  return { ...safe, id: prefs.userId };
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

    let transcriptionCache: Awaited<ReturnType<typeof getTranscriptionRepo>["listTranscriptions"]> | null = null;
    const getTranscriptions = async () => {
      if (!transcriptionCache) {
        transcriptionCache = await getTranscriptionRepo().listTranscriptions();
      }
      return transcriptionCache;
    };

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
            let tones: Tone[];
            if (repo.listTonesAll) {
              tones = await repo.listTonesAll();
            } else {
              tones = await repo.listTones();
            }
            return tones.filter((t) => !t.isSystem) as unknown as SyncRecord[];
          }
          case "conversations": {
            const repo = getConversationRepo();
            if (repo.listConversationsAll) return (await repo.listConversationsAll()) as unknown as SyncRecord[];
            return (await repo.listConversations()) as unknown as SyncRecord[];
          }
          case "chat_messages": {
            const repo = getConversationRepo();
            const conversations = repo.listConversationsAll
              ? await repo.listConversationsAll()
              : await repo.listConversations();
            const msgRepo = getChatMessageRepo();
            const allMessages: ChatMessage[] = [];
            for (const conv of conversations) {
              const msgs = msgRepo.listChatMessagesAll
                ? await msgRepo.listChatMessagesAll(conv.id)
                : await msgRepo.listChatMessages(conv.id);
              allMessages.push(...msgs);
            }
            return allMessages as unknown as SyncRecord[];
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
            return prefs ? [stripSensitivePrefs(prefs) as unknown as SyncRecord] : [];
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
        const transcriptions = await getTranscriptions();
        return transcriptions.map((t) => ({
          id: t.id,
          createdAt: t.createdAt,
        }));
      },
      getLocalTranscription: async (
        id: string,
      ): Promise<SyncableTranscription | null> => {
        const transcriptions = await getTranscriptions();
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
      applyEntityRecords: async (entityName: string, records: SyncRecord[]) => {
        for (const record of records) {
          try {
            switch (entityName) {
              case "terms": {
                const term = record as unknown as Term;
                if (term.isDeleted) {
                  await getTermRepo().deleteTerm(term.id);
                } else {
                  await getTermRepo().createTerm(term).catch(() =>
                    getTermRepo().updateTerm(term),
                  );
                }
                break;
              }
              case "tones": {
                const tone = record as unknown as Tone;
                if (tone.isDeleted) {
                  await getToneRepo().deleteTone(tone.id);
                } else {
                  await getToneRepo().upsertTone(tone);
                }
                break;
              }
              case "conversations": {
                const conv = record as unknown as Conversation;
                if (conv.isDeleted) {
                  await getConversationRepo().deleteConversation(conv.id);
                } else {
                  await getConversationRepo().createConversation(conv).catch(() =>
                    getConversationRepo().updateConversation(conv),
                  );
                }
                break;
              }
              case "chat_messages": {
                const msg = record as unknown as ChatMessage;
                if (msg.isDeleted) {
                  await getChatMessageRepo().deleteChatMessages([msg.id]);
                } else {
                  await getChatMessageRepo().createChatMessage(msg).catch(() =>
                    getChatMessageRepo().updateChatMessage(msg),
                  );
                }
                break;
              }
              case "hotkeys": {
                const hotkey = record as unknown as Hotkey;
                if (hotkey.isDeleted) {
                  await getHotkeyRepo().deleteHotkey(hotkey.id);
                } else {
                  await getHotkeyRepo().saveHotkey(hotkey);
                }
                break;
              }
              case "app_targets": {
                const target = record as unknown as AppTarget;
                if (target.isDeleted) {
                  await getAppTargetRepo().deleteAppTarget(target.id);
                } else {
                  await getAppTargetRepo().upsertAppTarget({
                    id: target.id,
                    name: target.name,
                    toneId: target.toneId ?? null,
                    iconPath: target.iconPath ?? null,
                    pasteKeybind: target.pasteKeybind ?? null,
                  });
                }
                break;
              }
              case "preferences": {
                const incoming = record as unknown as Record<string, unknown>;
                const currentPrefs = getAppState().userPrefs;
                if (currentPrefs) {
                  const merged = { ...currentPrefs };
                  for (const [key, value] of Object.entries(incoming)) {
                    if (
                      key !== "transcriptionApiKeyId" &&
                      key !== "postProcessingApiKeyId" &&
                      key !== "agentModeApiKeyId" &&
                      key !== "openclawToken" &&
                      key !== "openclawGatewayUrl" &&
                      key !== "isEnterprise"
                    ) {
                      (merged as Record<string, unknown>)[key] = value;
                    }
                  }
                  await getUserPreferencesRepo().setUserPreferences(
                    merged as UserPreferences,
                  );
                  produceAppState((draft) => {
                    draft.userPrefs = merged as UserPreferences;
                  });
                }
                break;
              }
            }
          } catch (e) {
            console.error(`[sync] apply ${entityName}/${record.id} failed:`, e);
          }
        }
      },
      applyTranscription: async (record: SyncableTranscription) => {
        try {
          await getTranscriptionRepo().createTranscription({
            id: record.id,
            transcript: record.transcript,
            rawTranscript: record.rawTranscript ?? "",
            createdAt: record.createdAt,
            toneId: record.toneId ?? null,
            postProcessMode: record.postProcessMode ?? null,
            warnings: record.warnings ?? [],
          } as Parameters<typeof getTranscriptionRepo>["0"] extends never ? never : any);
        } catch {
          // already exists, skip
        }
      },
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
