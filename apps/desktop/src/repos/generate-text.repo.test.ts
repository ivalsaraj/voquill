import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted ensures mockTauriFetch is defined before vi.mock factories run
const mockTauriFetch = vi.hoisted(() => vi.fn());

// Spread importOriginal so all other exports (types, constants) remain intact
vi.mock("@voquill/voice-ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@voquill/voice-ai")>();
  return {
    ...actual,
    groqGenerateTextResponse: vi.fn().mockResolvedValue({ text: "hi", tokensUsed: 2 }),
    groqStreamChat: vi.fn(async function* () { yield { type: "finish", finishReason: "stop" }; }),
    openaiGenerateTextResponse: vi.fn().mockResolvedValue({ text: "hi", tokensUsed: 2 }),
    openaiStreamChat: vi.fn(async function* () { yield { type: "finish", finishReason: "stop" }; }),
    claudeGenerateTextResponse: vi.fn().mockResolvedValue({ text: "hi", tokensUsed: 2 }),
    claudeStreamChat: vi.fn(async function* () { yield { type: "finish", finishReason: "stop" }; }),
    deepseekGenerateTextResponse: vi.fn().mockResolvedValue({ text: "hi", tokensUsed: 2 }),
    deepseekStreamChat: vi.fn(async function* () { yield { type: "finish", finishReason: "stop" }; }),
    openrouterGenerateTextResponse: vi.fn().mockResolvedValue({ text: "hi", tokensUsed: 2 }),
    openrouterStreamChat: vi.fn(async function* () { yield { type: "finish", finishReason: "stop" }; }),
    azureOpenAIGenerateText: vi.fn().mockResolvedValue({ text: "hi", tokensUsed: 2 }),
    azureOpenaiStreamChat: vi.fn(async function* () { yield { type: "finish", finishReason: "stop" }; }),
  };
});

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: mockTauriFetch,
}));

import * as voiceAi from "@voquill/voice-ai";
import {
  GroqGenerateTextRepo,
  OpenAIGenerateTextRepo,
  ClaudeGenerateTextRepo,
  DeepseekGenerateTextRepo,
  OpenRouterGenerateTextRepo,
  AzureOpenAIGenerateTextRepo,
} from "./generate-text.repo";

describe("GroqGenerateTextRepo", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes tauriFetch to groqGenerateTextResponse", async () => {
    const repo = new GroqGenerateTextRepo("test-key", null);
    await repo.generateText({ prompt: "test" });
    expect(voiceAi.groqGenerateTextResponse).toHaveBeenCalledWith(
      expect.objectContaining({ customFetch: mockTauriFetch }),
    );
  });

  it("passes tauriFetch to groqStreamChat", async () => {
    const repo = new GroqGenerateTextRepo("test-key", null);
    const gen = repo.streamChat({ messages: [{ role: "user", content: "hi" }] });
    for await (const _ of gen) { break; }
    expect(voiceAi.groqStreamChat).toHaveBeenCalledWith(
      expect.objectContaining({ customFetch: mockTauriFetch }),
    );
  });
});

describe("OpenAIGenerateTextRepo", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes tauriFetch to openaiGenerateTextResponse", async () => {
    const repo = new OpenAIGenerateTextRepo("test-key", null);
    await repo.generateText({ prompt: "test" });
    expect(voiceAi.openaiGenerateTextResponse).toHaveBeenCalledWith(
      expect.objectContaining({ customFetch: mockTauriFetch }),
    );
  });

  it("passes tauriFetch to openaiStreamChat", async () => {
    const repo = new OpenAIGenerateTextRepo("test-key", null);
    const gen = repo.streamChat({ messages: [{ role: "user", content: "hi" }] });
    for await (const _ of gen) { break; }
    expect(voiceAi.openaiStreamChat).toHaveBeenCalledWith(
      expect.objectContaining({ customFetch: mockTauriFetch }),
    );
  });
});

describe("ClaudeGenerateTextRepo", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes tauriFetch to claudeGenerateTextResponse", async () => {
    const repo = new ClaudeGenerateTextRepo("test-key", null);
    await repo.generateText({ prompt: "test" });
    expect(voiceAi.claudeGenerateTextResponse).toHaveBeenCalledWith(
      expect.objectContaining({ customFetch: mockTauriFetch }),
    );
  });

  it("passes tauriFetch to claudeStreamChat", async () => {
    const repo = new ClaudeGenerateTextRepo("test-key", null);
    const gen = repo.streamChat({ messages: [{ role: "user", content: "hi" }] });
    for await (const _ of gen) { break; }
    expect(voiceAi.claudeStreamChat).toHaveBeenCalledWith(
      expect.objectContaining({ customFetch: mockTauriFetch }),
    );
  });
});

describe("DeepseekGenerateTextRepo", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes tauriFetch to deepseekGenerateTextResponse", async () => {
    const repo = new DeepseekGenerateTextRepo("test-key", null);
    await repo.generateText({ prompt: "test" });
    expect(voiceAi.deepseekGenerateTextResponse).toHaveBeenCalledWith(
      expect.objectContaining({ customFetch: mockTauriFetch }),
    );
  });

  it("passes tauriFetch to deepseekStreamChat", async () => {
    const repo = new DeepseekGenerateTextRepo("test-key", null);
    const gen = repo.streamChat({ messages: [{ role: "user", content: "hi" }] });
    for await (const _ of gen) { break; }
    expect(voiceAi.deepseekStreamChat).toHaveBeenCalledWith(
      expect.objectContaining({ customFetch: mockTauriFetch }),
    );
  });
});

describe("OpenRouterGenerateTextRepo", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes tauriFetch to openrouterGenerateTextResponse", async () => {
    const repo = new OpenRouterGenerateTextRepo("test-key", null);
    await repo.generateText({ prompt: "test" });
    expect(voiceAi.openrouterGenerateTextResponse).toHaveBeenCalledWith(
      expect.objectContaining({ customFetch: mockTauriFetch }),
    );
  });

  it("passes tauriFetch to openrouterStreamChat", async () => {
    const repo = new OpenRouterGenerateTextRepo("test-key", null);
    const gen = repo.streamChat({ messages: [{ role: "user", content: "hi" }] });
    for await (const _ of gen) { break; }
    expect(voiceAi.openrouterStreamChat).toHaveBeenCalledWith(
      expect.objectContaining({ customFetch: mockTauriFetch }),
    );
  });
});

describe("AzureOpenAIGenerateTextRepo", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes tauriFetch to azureOpenAIGenerateText", async () => {
    const repo = new AzureOpenAIGenerateTextRepo("test-key", "https://example.azure.com", null);
    await repo.generateText({ prompt: "test" });
    expect(voiceAi.azureOpenAIGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({ customFetch: mockTauriFetch }),
    );
  });

  it("passes tauriFetch to azureOpenaiStreamChat", async () => {
    const repo = new AzureOpenAIGenerateTextRepo("test-key", "https://example.azure.com", null);
    const gen = repo.streamChat({ messages: [{ role: "user", content: "hi" }] });
    for await (const _ of gen) { break; }
    expect(voiceAi.azureOpenaiStreamChat).toHaveBeenCalledWith(
      expect.objectContaining({ customFetch: mockTauriFetch }),
    );
  });
});
