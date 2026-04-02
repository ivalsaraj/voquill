import { describe, it, expect, vi, beforeEach } from "vitest";

const mockTauriFetch = vi.hoisted(() => vi.fn());

vi.mock("@voquill/voice-ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@voquill/voice-ai")>();
  return {
    ...actual,
    groqTranscribeAudio: vi.fn().mockResolvedValue({ text: "hello", wordsUsed: 1 }),
    openaiTranscribeAudio: vi.fn().mockResolvedValue({ text: "hello", wordsUsed: 1 }),
  };
});

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: mockTauriFetch,
}));

// Stub audio utilities so tests don't need real audio samples
vi.mock("../utils/audio.utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/audio.utils")>();
  return {
    ...actual,
    buildWaveFile: vi.fn().mockReturnValue(new ArrayBuffer(8)),
    normalizeSamples: vi.fn((s) => s),
    ensureFloat32Array: vi.fn((s) => s),
  };
});

import * as voiceAi from "@voquill/voice-ai";
import {
  GroqTranscribeAudioRepo,
  OpenAITranscribeAudioRepo,
} from "./transcribe-audio.repo";

const FAKE_INPUT = {
  samples: new Float32Array([0, 0]),
  sampleRate: 16000,
};

describe("GroqTranscribeAudioRepo", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes tauriFetch to groqTranscribeAudio", async () => {
    const repo = new GroqTranscribeAudioRepo("test-key", null);
    await repo.transcribeAudio(FAKE_INPUT);
    expect(voiceAi.groqTranscribeAudio).toHaveBeenCalledWith(
      expect.objectContaining({ customFetch: mockTauriFetch }),
    );
  });
});

describe("OpenAITranscribeAudioRepo", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes tauriFetch to openaiTranscribeAudio", async () => {
    const repo = new OpenAITranscribeAudioRepo("test-key", null);
    await repo.transcribeAudio(FAKE_INPUT);
    expect(voiceAi.openaiTranscribeAudio).toHaveBeenCalledWith(
      expect.objectContaining({ customFetch: mockTauriFetch }),
    );
  });
});
