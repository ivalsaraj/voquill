import { describe, expect, it, vi } from "vitest";

vi.mock("../store", () => ({
  getAppState: vi.fn(() => ({
    apiKeyById: {},
    settings: { aiTranscription: {}, aiPostProcessing: {} },
  })),
}));

vi.mock("../utils/enterprise.utils", () => ({
  getIsEnterpriseEnabled: () => false,
}));

vi.mock("../utils/env.utils", () => ({
  getIsEmulators: () => false,
}));

import { createTranscriptionSession } from "./index";
import { GeminiCombinedTranscriptionSession } from "./gemini-combined-transcription-session";
import { BatchTranscriptionSession } from "./batch-transcription-session";

describe("createTranscriptionSession", () => {
  it("returns GeminiCombinedTranscriptionSession when both sides use gemini with same key", () => {
    const session = createTranscriptionSession(
      {
        mode: "api",
        provider: "gemini",
        apiKeyId: "key-1",
        apiKeyValue: "fake-api-key",
        transcriptionModel: "gemini-2.5-flash",
        warnings: [],
      },
      {
        generativePrefs: {
          mode: "api",
          provider: "gemini",
          apiKeyId: "key-1",
          postProcessingModel: "gemini-2.5-flash",
        },
      },
    );

    expect(session).toBeInstanceOf(GeminiCombinedTranscriptionSession);
  });

  it("falls back to BatchTranscriptionSession when gemini keys differ", () => {
    const session = createTranscriptionSession(
      {
        mode: "api",
        provider: "gemini",
        apiKeyId: "key-1",
        apiKeyValue: "fake-api-key",
        transcriptionModel: "gemini-2.5-flash",
        warnings: [],
      },
      {
        generativePrefs: {
          mode: "api",
          provider: "gemini",
          apiKeyId: "key-2",
          postProcessingModel: "gemini-2.5-flash",
        },
      },
    );

    expect(session).toBeInstanceOf(BatchTranscriptionSession);
  });

  it("falls back to BatchTranscriptionSession when no generativePrefs provided", () => {
    const session = createTranscriptionSession({
      mode: "api",
      provider: "gemini",
      apiKeyId: "key-1",
      apiKeyValue: "fake-api-key",
      transcriptionModel: "gemini-2.5-flash",
      warnings: [],
    });

    expect(session).toBeInstanceOf(BatchTranscriptionSession);
  });
});
