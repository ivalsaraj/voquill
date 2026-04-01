import { describe, expect, it } from "vitest";
import { buildCombinedSessionResult } from "./gemini-combined-transcription-session";

describe("buildCombinedSessionResult", () => {
  it("maps combined output to TranscriptionSessionResult with both transcripts", () => {
    const result = buildCombinedSessionResult({
      rawTranscript: "hello world",
      processedTranscription: "Hello, world.",
      tokensUsed: 42,
      model: "gemini-2.5-flash",
      durationMs: 1200,
    });

    expect(result.rawTranscript).toBe("hello world");
    expect(result.processedTranscript).toBe("Hello, world.");
    expect(result.metadata.inferenceDevice).toBe("API • Gemini (Combined)");
    expect(result.metadata.modelSize).toBe("gemini-2.5-flash");
    expect(result.metadata.transcriptionMode).toBe("api");
    expect(result.metadata.transcriptionDurationMs).toBe(1200);
    expect(result.postProcessMetadata?.postProcessMode).toBe("api");
    expect(result.postProcessMetadata?.postProcessDevice).toBe(
      "API • Gemini (Combined)",
    );
    expect(result.postProcessMetadata?.postprocessDurationMs).toBe(1200);
    expect(result.warnings).toEqual([]);
  });

  it("returns null processedTranscript when empty", () => {
    const result = buildCombinedSessionResult({
      rawTranscript: "hello",
      processedTranscription: "",
      tokensUsed: 10,
      model: "gemini-2.5-flash",
      durationMs: 500,
    });

    expect(result.rawTranscript).toBe("hello");
    expect(result.processedTranscript).toBeNull();
  });
});
