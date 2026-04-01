import {
  GEMINI_TRANSCRIPTION_MODELS,
  GEMINI_GENERATE_TEXT_MODELS,
} from "@voquill/voice-ai";

/**
 * Models that appear in both GEMINI_TRANSCRIPTION_MODELS and GEMINI_GENERATE_TEXT_MODELS.
 * Only these can handle combined transcription + post-processing in a single call.
 */
export const GEMINI_COMBINED_ELIGIBLE_MODELS: readonly string[] =
  GEMINI_TRANSCRIPTION_MODELS.filter((m) =>
    (GEMINI_GENERATE_TEXT_MODELS as readonly string[]).includes(m),
  );

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

type TranscriptionInput =
  | {
      mode: "api";
      provider: string;
      apiKeyId: string;
      transcriptionModel: string | null;
    }
  | { mode: "cloud" | "local" };

type PostProcessingInput =
  | {
      mode: "api";
      provider: string;
      apiKeyId: string;
      postProcessingModel: string | null;
    }
  | { mode: "cloud" | "none" };

export type CombinedModeInput = {
  transcription: TranscriptionInput;
  postProcessing: PostProcessingInput;
};

/**
 * Returns true when both transcription and post-processing are configured for
 * Gemini API with the same key AND BOTH models support combined mode.
 */
export const isCombinedGeminiModeEligible = (
  input: CombinedModeInput,
): boolean => {
  const { transcription, postProcessing } = input;

  if (transcription.mode !== "api" || postProcessing.mode !== "api") {
    return false;
  }

  if (
    transcription.provider !== "gemini" ||
    postProcessing.provider !== "gemini"
  ) {
    return false;
  }

  if (transcription.apiKeyId !== postProcessing.apiKeyId) {
    return false;
  }

  const effectiveTranscriptionModel =
    transcription.transcriptionModel ?? DEFAULT_GEMINI_MODEL;
  const effectivePostProcessingModel =
    postProcessing.postProcessingModel ?? DEFAULT_GEMINI_MODEL;

  // Both models must be in the eligible set AND must be the same model.
  // The combined API call uses a single model for both transcription and processing.
  if (effectiveTranscriptionModel !== effectivePostProcessingModel) {
    return false;
  }

  return GEMINI_COMBINED_ELIGIBLE_MODELS.includes(effectiveTranscriptionModel);
};
