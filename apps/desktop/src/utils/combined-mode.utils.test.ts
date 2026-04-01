import { describe, expect, it } from "vitest";
import {
  isCombinedGeminiModeEligible,
  GEMINI_COMBINED_ELIGIBLE_MODELS,
} from "./combined-mode.utils";

describe("isCombinedGeminiModeEligible", () => {
  it("returns true when both transcription and post-processing use gemini with the same api key", () => {
    expect(
      isCombinedGeminiModeEligible({
        transcription: {
          mode: "api",
          provider: "gemini",
          apiKeyId: "key-1",
          transcriptionModel: "gemini-2.5-flash",
        },
        postProcessing: {
          mode: "api",
          provider: "gemini",
          apiKeyId: "key-1",
          postProcessingModel: "gemini-2.5-flash",
        },
      }),
    ).toBe(true);
  });

  it("returns false when api key ids differ", () => {
    expect(
      isCombinedGeminiModeEligible({
        transcription: {
          mode: "api",
          provider: "gemini",
          apiKeyId: "key-1",
          transcriptionModel: "gemini-2.5-flash",
        },
        postProcessing: {
          mode: "api",
          provider: "gemini",
          apiKeyId: "key-2",
          postProcessingModel: "gemini-2.5-flash",
        },
      }),
    ).toBe(false);
  });

  it("returns false when transcription is not api mode", () => {
    expect(
      isCombinedGeminiModeEligible({
        transcription: { mode: "cloud" },
        postProcessing: {
          mode: "api",
          provider: "gemini",
          apiKeyId: "key-1",
          postProcessingModel: "gemini-2.5-flash",
        },
      }),
    ).toBe(false);
  });

  it("returns false when post-processing is off", () => {
    expect(
      isCombinedGeminiModeEligible({
        transcription: {
          mode: "api",
          provider: "gemini",
          apiKeyId: "key-1",
          transcriptionModel: "gemini-2.5-flash",
        },
        postProcessing: { mode: "none" },
      }),
    ).toBe(false);
  });

  it("returns false when providers differ", () => {
    expect(
      isCombinedGeminiModeEligible({
        transcription: {
          mode: "api",
          provider: "groq",
          apiKeyId: "key-1",
          transcriptionModel: "whisper-large-v3-turbo",
        },
        postProcessing: {
          mode: "api",
          provider: "gemini",
          apiKeyId: "key-1",
          postProcessingModel: "gemini-2.5-flash",
        },
      }),
    ).toBe(false);
  });

  it("returns false when transcription model is not in the eligible set", () => {
    expect(
      isCombinedGeminiModeEligible({
        transcription: {
          mode: "api",
          provider: "gemini",
          apiKeyId: "key-1",
          transcriptionModel: "gemini-2.5-flash-lite",
        },
        postProcessing: {
          mode: "api",
          provider: "gemini",
          apiKeyId: "key-1",
          postProcessingModel: "gemini-2.5-flash",
        },
      }),
    ).toBe(false);
  });

  it("returns false when post-processing model is not in the eligible set", () => {
    expect(
      isCombinedGeminiModeEligible({
        transcription: {
          mode: "api",
          provider: "gemini",
          apiKeyId: "key-1",
          transcriptionModel: "gemini-2.5-flash",
        },
        postProcessing: {
          mode: "api",
          provider: "gemini",
          apiKeyId: "key-1",
          postProcessingModel: "gemini-3-pro-preview",
        },
      }),
    ).toBe(false);
  });

  it("returns false when same key but models differ", () => {
    expect(
      isCombinedGeminiModeEligible({
        transcription: {
          mode: "api",
          provider: "gemini",
          apiKeyId: "key-1",
          transcriptionModel: "gemini-2.5-flash",
        },
        postProcessing: {
          mode: "api",
          provider: "gemini",
          apiKeyId: "key-1",
          postProcessingModel: "gemini-2.5-pro",
        },
      }),
    ).toBe(false);
  });

  it("returns true when transcription model is null and falls back to default", () => {
    expect(
      isCombinedGeminiModeEligible({
        transcription: {
          mode: "api",
          provider: "gemini",
          apiKeyId: "key-1",
          transcriptionModel: null,
        },
        postProcessing: {
          mode: "api",
          provider: "gemini",
          apiKeyId: "key-1",
          postProcessingModel: "gemini-2.5-flash",
        },
      }),
    ).toBe(true);
  });
});

describe("GEMINI_COMBINED_ELIGIBLE_MODELS", () => {
  it("includes models that overlap between transcription and generation", () => {
    expect(GEMINI_COMBINED_ELIGIBLE_MODELS).toContain("gemini-2.5-flash");
    expect(GEMINI_COMBINED_ELIGIBLE_MODELS).toContain("gemini-2.5-pro");
    expect(GEMINI_COMBINED_ELIGIBLE_MODELS).toContain("gemini-3-flash-preview");
  });

  it("does not include generation-only models", () => {
    expect(GEMINI_COMBINED_ELIGIBLE_MODELS).not.toContain(
      "gemini-2.5-flash-lite",
    );
    expect(GEMINI_COMBINED_ELIGIBLE_MODELS).not.toContain(
      "gemini-3-pro-preview",
    );
  });
});
