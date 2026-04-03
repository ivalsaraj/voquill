import { describe, it, expect } from "vitest";
import {
  classifyEntity,
  mergeByUpdatedAt,
  buildManifest,
  type SyncRecord,
} from "./sync-engine";

describe("classifyEntity", () => {
  it("returns UPLOAD when local is newer", () => {
    expect(
      classifyEntity("2026-04-02T10:00:00Z", "2026-04-02T09:00:00Z"),
    ).toBe("UPLOAD");
  });

  it("returns DOWNLOAD when drive is newer", () => {
    expect(
      classifyEntity("2026-04-02T09:00:00Z", "2026-04-02T10:00:00Z"),
    ).toBe("DOWNLOAD");
  });

  it("returns IN_SYNC when equal", () => {
    expect(
      classifyEntity("2026-04-02T10:00:00Z", "2026-04-02T10:00:00Z"),
    ).toBe("IN_SYNC");
  });

  it("returns UPLOAD when drive timestamp is null (first sync)", () => {
    expect(classifyEntity("2026-04-02T10:00:00Z", null)).toBe("UPLOAD");
  });

  it("returns DOWNLOAD when local timestamp is null (restore)", () => {
    expect(classifyEntity(null, "2026-04-02T10:00:00Z")).toBe("DOWNLOAD");
  });
});

describe("mergeByUpdatedAt", () => {
  it("includes records present only on local side", () => {
    const local: SyncRecord[] = [{ id: "1" }];
    const remote: SyncRecord[] = [];
    expect(mergeByUpdatedAt(local, remote)).toHaveLength(1);
  });

  it("includes records present only on remote side", () => {
    const local: SyncRecord[] = [];
    const remote: SyncRecord[] = [{ id: "2" }];
    expect(mergeByUpdatedAt(local, remote)).toHaveLength(1);
  });

  it("prefers local when both records lack updatedAt", () => {
    const local: SyncRecord[] = [{ id: "1", value: "local" }];
    const remote: SyncRecord[] = [{ id: "1", value: "remote" }];
    const result = mergeByUpdatedAt(local, remote);
    expect(result).toHaveLength(1);
    expect((result[0] as { value: string }).value).toBe("local");
  });

  it("prefers newer record when both have updatedAt", () => {
    const local: SyncRecord[] = [
      { id: "1", value: "old", updatedAt: "2026-04-01T10:00:00Z" },
    ];
    const remote: SyncRecord[] = [
      { id: "1", value: "new", updatedAt: "2026-04-02T10:00:00Z" },
    ];
    const result = mergeByUpdatedAt(local, remote);
    expect(result).toHaveLength(1);
    expect((result[0] as { value: string }).value).toBe("new");
  });

  it("includes tombstone records (isDeleted: true) from remote side", () => {
    const local: SyncRecord[] = [];
    const remote: SyncRecord[] = [
      { id: "1", isDeleted: true, updatedAt: "2026-04-02T10:00:00Z" },
    ];
    const result = mergeByUpdatedAt(local, remote);
    expect(result).toHaveLength(1);
    expect((result[0] as { isDeleted: boolean }).isDeleted).toBe(true);
  });

  it("preserves local live record when local updatedAt is newer than remote tombstone", () => {
    const local: SyncRecord[] = [
      { id: "1", value: "alive", updatedAt: "2026-04-03T10:00:00Z" },
    ];
    const remote: SyncRecord[] = [
      { id: "1", isDeleted: true, updatedAt: "2026-04-02T10:00:00Z" },
    ];
    const result = mergeByUpdatedAt(local, remote);
    expect(result).toHaveLength(1);
    expect((result[0] as { value: string }).value).toBe("alive");
  });

  it("merges non-overlapping records from both sides", () => {
    const local: SyncRecord[] = [{ id: "1" }];
    const remote: SyncRecord[] = [{ id: "2" }];
    expect(mergeByUpdatedAt(local, remote)).toHaveLength(2);
  });
});

describe("buildManifest", () => {
  it("includes a schemaVersion of 1", () => {
    const manifest = buildManifest({}, {});
    expect(manifest.schemaVersion).toBe(1);
  });

  it("sets lastSyncedAt to a recent ISO timestamp", () => {
    const before = Date.now();
    const manifest = buildManifest({}, {});
    const after = Date.now();
    const ts = new Date(manifest.lastSyncedAt).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});
