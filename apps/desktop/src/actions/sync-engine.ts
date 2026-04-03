import type { GoogleDriveClient } from "../repos/google-drive.client";

export const SCHEMA_VERSION = 1;

export type SyncRecord = { id: string; [key: string]: unknown };

export type SyncableTranscription = {
  id: string;
  transcript: string;
  rawTranscript?: string | null;
  createdAt: string;
  toneId?: string | null;
  postProcessMode?: string | null;
  warnings?: string[] | null;
  schemaVersion: number;
  isDeleted?: boolean;
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

export type SyncClassification = "UPLOAD" | "DOWNLOAD" | "IN_SYNC";

export function classifyEntity(
  localTs: string | null,
  driveTs: string | null,
): SyncClassification {
  if (!driveTs) return "UPLOAD";
  if (!localTs) return "DOWNLOAD";
  if (localTs > driveTs) return "UPLOAD";
  if (localTs < driveTs) return "DOWNLOAD";
  return "IN_SYNC";
}

export function mergeByUpdatedAt<T extends SyncRecord>(
  local: T[],
  remote: T[],
): T[] {
  const localMap = new Map<string, T>(local.map((r) => [r.id, r]));
  const remoteMap = new Map<string, T>(remote.map((r) => [r.id, r]));
  const allIds = new Set([...localMap.keys(), ...remoteMap.keys()]);
  const result: T[] = [];
  for (const id of allIds) {
    const l = localMap.get(id);
    const r = remoteMap.get(id);
    if (!l && r) {
      result.push(r);
    } else if (l && !r) {
      result.push(l);
    } else if (l && r) {
      const lTs = (l as Record<string, unknown>).updatedAt as
        | string
        | undefined;
      const rTs = (r as Record<string, unknown>).updatedAt as
        | string
        | undefined;
      if (lTs && rTs) {
        result.push(lTs >= rTs ? l : r);
      } else {
        result.push(l);
      }
    }
  }
  return result;
}

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
  getLocalTranscriptionIds: () => Promise<
    Array<{ id: string; createdAt: string }>
  >;
  getLocalTranscription: (
    id: string,
  ) => Promise<SyncableTranscription | null>;
  applyEntityRecords: (
    entityName: string,
    merged: SyncRecord[],
  ) => Promise<void>;
  applyTranscription: (record: SyncableTranscription) => Promise<void>;
};

const ENTITY_NAMES = [
  "terms",
  "tones",
  "preferences",
  "conversations",
  "chat_messages",
  "app_targets",
  "hotkeys",
  "user_profile",
] as const;

export async function runSyncCycle(
  client: GoogleDriveClient,
  rootFolderId: string,
  transcriptionsFolderId: string,
  ctx: SyncContext,
): Promise<{ uploaded: number; downloaded: number; errors: string[] }> {
  const errors: string[] = [];
  let uploaded = 0;
  let downloaded = 0;

  let manifest: DriveManifest | null = null;
  try {
    const manifestFileId = await client.findFile(
      "manifest.json",
      rootFolderId,
    );
    if (manifestFileId) {
      const raw = await client.readJson<DriveManifest>(manifestFileId);
      if (raw && raw.schemaVersion > SCHEMA_VERSION) {
        errors.push(
          `Drive schemaVersion ${raw.schemaVersion} > app schemaVersion ${SCHEMA_VERSION}. Update the app before syncing.`,
        );
        return { uploaded: 0, downloaded: 0, errors };
      }
      if (raw) manifest = raw;
    }
  } catch (e) {
    errors.push(`Manifest read failed: ${String(e)}`);
  }

  const newEntitySyncedAts: Record<string, string> = {};

  for (const name of ENTITY_NAMES) {
    try {
      const localRecords = await ctx.getLocalEntityRecords(name);
      const localMap = new Map(localRecords.map((r) => [r.id, r]));

      let driveRecords: SyncRecord[] = [];
      const fileId = await client.findFile(`${name}.json`, rootFolderId);
      if (fileId) {
        const driveFile = await client.readJson<EntityFile>(fileId);
        if (driveFile && driveFile.schemaVersion <= SCHEMA_VERSION) {
          driveRecords = driveFile.records;
        }
      }

      const merged = mergeByUpdatedAt(localRecords, driveRecords);

      const recordsToApply: SyncRecord[] = [];
      for (const driveRecord of driveRecords) {
        const local = localMap.get(driveRecord.id);
        if (!local) {
          recordsToApply.push(driveRecord);
        } else if (driveRecord.isDeleted && !local.isDeleted) {
          recordsToApply.push(driveRecord);
        } else {
          const driveTs = (driveRecord as Record<string, unknown>)
            .updatedAt as string | undefined;
          const localTs = (local as Record<string, unknown>).updatedAt as
            | string
            | undefined;
          if (driveTs && localTs && driveTs > localTs) {
            recordsToApply.push(driveRecord);
          }
        }
      }
      if (recordsToApply.length > 0) {
        await ctx.applyEntityRecords(name, recordsToApply);
        downloaded += recordsToApply.filter((r) => !r.isDeleted).length;
      }

      const now = new Date().toISOString();
      const mergedFile: EntityFile = {
        schemaVersion: SCHEMA_VERSION,
        syncedAt: now,
        records: merged,
      };
      await client.writeJson(`${name}.json`, rootFolderId, mergedFile);
      newEntitySyncedAts[name] = now;
      uploaded++;
    } catch (e) {
      errors.push(`Entity sync failed (${name}): ${String(e)}`);
    }
  }

  const newTranscriptionIndex: Record<string, { createdAt: string }> = {
    ...(manifest?.transcriptions ?? {}),
  };

  try {
    const localTranscriptions = await ctx.getLocalTranscriptionIds();
    const driveIndex = manifest?.transcriptions ?? {};

    for (const local of localTranscriptions) {
      if (!driveIndex[local.id]) {
        const record = await ctx.getLocalTranscription(local.id);
        if (record) {
          await client.writeJson(
            `${local.id}.json`,
            transcriptionsFolderId,
            record,
          );
          newTranscriptionIndex[local.id] = { createdAt: local.createdAt };
          uploaded++;
        }
      }
    }

    const localIds = new Set(localTranscriptions.map((t) => t.id));
    for (const [id] of Object.entries(driveIndex)) {
      if (!localIds.has(id)) {
        const fileId = await client.findFile(
          `${id}.json`,
          transcriptionsFolderId,
        );
        if (fileId) {
          const driveRecord =
            await client.readJson<SyncableTranscription>(fileId);
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

  try {
    const newManifest = buildManifest(
      newEntitySyncedAts,
      newTranscriptionIndex,
    );
    await client.writeJson("manifest.json", rootFolderId, newManifest);
  } catch (e) {
    errors.push(`Manifest write failed: ${String(e)}`);
  }

  return { uploaded, downloaded, errors };
}
