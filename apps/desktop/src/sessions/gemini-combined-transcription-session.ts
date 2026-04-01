import {
  geminiCombinedTranscribe,
  geminiTranscribeAudio,
  type GeminiTranscriptionModel,
} from "@voquill/voice-ai";
import { showToast } from "../actions/toast.actions";
import { getAppState } from "../store";
import type {
  StopRecordingResponse,
  TranscriptionSession,
  TranscriptionSessionFinalizeOptions,
  TranscriptionSessionResult,
} from "../types/transcription-session.types";
import {
  buildWaveFile,
  ensureFloat32Array,
  normalizeSamples,
} from "../utils/audio.utils";
import {
  coerceToDictationLanguage,
  mapDictationLanguageToWhisperLanguage,
  getDisplayNameForLanguage,
} from "../utils/language.utils";
import { getLogger } from "../utils/log.utils";
import {
  buildLocalizedTranscriptionPrompt,
  collectDictionaryEntries,
} from "../utils/prompt.utils";
import { getToneById, getToneConfig } from "../utils/tone.utils";
import {
  getMyUserName,
  loadMyEffectiveDictationLanguage,
} from "../utils/user.utils";

export type BuildCombinedSessionResultInput = {
  rawTranscript: string;
  processedTranscription: string;
  tokensUsed: number;
  model: string;
  durationMs: number;
};

export const buildCombinedSessionResult = (
  input: BuildCombinedSessionResultInput,
): TranscriptionSessionResult => {
  const device = "API • Gemini (Combined)";
  return {
    rawTranscript: input.rawTranscript || null,
    processedTranscript: input.processedTranscription || null,
    metadata: {
      inferenceDevice: device,
      modelSize: input.model,
      transcriptionMode: "api",
      transcriptionDurationMs: input.durationMs,
    },
    postProcessMetadata: {
      postProcessMode: "api",
      postProcessDevice: device,
      postprocessDurationMs: input.durationMs,
    },
    warnings: [],
  };
};

export class GeminiCombinedTranscriptionSession
  implements TranscriptionSession
{
  private apiKey: string;
  private model: GeminiTranscriptionModel;

  constructor(apiKey: string, model: string | null) {
    this.apiKey = apiKey;
    this.model = (model as GeminiTranscriptionModel) ?? "gemini-2.5-flash";
  }

  async onRecordingStart(_sampleRate: number): Promise<void> {}

  async finalize(
    audio: StopRecordingResponse,
    options?: TranscriptionSessionFinalizeOptions,
  ): Promise<TranscriptionSessionResult> {
    const payloadSamples = Array.isArray(audio.samples)
      ? audio.samples
      : Array.from(audio.samples ?? []);
    const rate = audio.sampleRate;

    if (rate == null || rate <= 0 || payloadSamples.length === 0) {
      getLogger().warning(
        `Gemini combined session: skipping (rate=${rate}, samples=${payloadSamples.length})`,
      );
      return { rawTranscript: null, metadata: {}, warnings: [] };
    }

    const normalizedSamples = normalizeSamples(payloadSamples);
    const floatSamples = ensureFloat32Array(normalizedSamples);
    const wavBuffer = buildWaveFile(floatSamples, rate);

    const state = getAppState();
    const dictationLanguage = await loadMyEffectiveDictationLanguage(state);
    const whisperLanguage =
      mapDictationLanguageToWhisperLanguage(dictationLanguage);
    const dictionaryEntries = collectDictionaryEntries(state);
    const transcriptionPrompt = buildLocalizedTranscriptionPrompt({
      entries: dictionaryEntries,
      dictationLanguage,
      state,
    });

    const toneId = options?.toneId ?? null;
    const tone = getToneById(state, toneId);
    const shouldSkipPostProcessing =
      tone?.shouldDisablePostProcessing ||
      state.enterpriseConfig?.allowPostProcessing === false;

    if (shouldSkipPostProcessing) {
      getLogger().info(
        "Gemini combined: post-processing disabled, transcription only",
      );
      return this.transcribeOnly(wavBuffer, transcriptionPrompt, whisperLanguage);
    }

    // Build style prompt for combined mode — NOT using buildPostProcessingPrompt
    // because that function expects {{transcript}} placeholder substitution.
    // In combined mode, Gemini hears the audio directly.
    const toneConfig = getToneConfig(state, toneId);
    const userName = getMyUserName(state);
    const languageName = getDisplayNameForLanguage(dictationLanguage);

    let toneStylePrompt: string;
    let toneSystemPrompt: string | undefined;
    if (toneConfig.kind === "template") {
      toneStylePrompt = toneConfig.promptTemplate
        .replace(/<username\/>/g, userName)
        .replace(/<transcript\/>/g, "[audio transcript]")
        .replace(/<language\/>/g, languageName);
      if (toneConfig.systemPromptTemplate) {
        toneSystemPrompt = toneConfig.systemPromptTemplate
          .replace(/<username\/>/g, userName)
          .replace(/<transcript\/>/g, "[audio transcript]")
          .replace(/<language\/>/g, languageName);
      }
    } else {
      toneStylePrompt = toneConfig.stylePrompt;
    }

    try {
      getLogger().info(
        `Gemini combined: transcribing + processing (model=${this.model}, lang=${dictationLanguage})`,
      );
      const start = performance.now();
      const result = await geminiCombinedTranscribe({
        apiKey: this.apiKey,
        model: this.model,
        blob: wavBuffer,
        mimeType: "audio/wav",
        language: whisperLanguage,
        transcriptionPrompt,
        userName,
        languageName,
        toneStylePrompt,
        toneSystemPrompt,
      });
      const durationMs = Math.round(performance.now() - start);

      getLogger().info(
        `Gemini combined: complete in ${durationMs}ms (raw=${result.rawTranscript.length} chars, processed=${result.processedTranscription.length} chars)`,
      );

      return buildCombinedSessionResult({
        ...result,
        model: this.model,
        durationMs,
      });
    } catch (error) {
      getLogger().error(
        `Gemini combined: failed, falling back to transcription-only: ${error}`,
      );
      return this.transcribeOnly(wavBuffer, transcriptionPrompt, whisperLanguage);
    }
  }

  private async transcribeOnly(
    wavBuffer: ArrayBuffer,
    prompt: string,
    language?: string,
  ): Promise<TranscriptionSessionResult> {
    try {
      const start = performance.now();
      const { text } = await geminiTranscribeAudio({
        apiKey: this.apiKey,
        model: this.model,
        blob: wavBuffer,
        mimeType: "audio/wav",
        prompt,
        language,
      });
      const durationMs = Math.round(performance.now() - start);

      return {
        rawTranscript: text.trim() || null,
        metadata: {
          inferenceDevice: "API • Gemini",
          modelSize: this.model,
          transcriptionMode: "api",
          transcriptionDurationMs: durationMs,
        },
        warnings: [],
      };
    } catch (error) {
      getLogger().error(`Gemini transcription-only fallback failed: ${error}`);
      const message = String(error);
      showToast({ title: "Transcription failed", message, toastType: "error" });
      return {
        rawTranscript: null,
        metadata: {},
        warnings: [`Transcription failed: ${message}`],
      };
    }
  }

  cleanup(): void {}

  supportsStreaming(): boolean {
    return false;
  }

  setInterimResultCallback(): void {}
}
