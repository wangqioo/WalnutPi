import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, streamText } from "ai";
import { getAiSdkConfig } from "../config/platform-config.ts";

export function createWalnutAiSdkProvider(options: { apiKey?: string; baseUrl?: string; name?: string } = {}) {
  const config = getAiSdkConfig();
  return createOpenAICompatible({
    name: options.name || config.provider,
    baseURL: (options.baseUrl || config.baseUrl).replace(/\/+$/, ""),
    apiKey: options.apiKey || config.apiKey,
  });
}

export function createWalnutAiSdkModel(modelId = getAiSdkConfig().model) {
  return createWalnutAiSdkProvider().languageModel(modelId);
}

export async function generateWalnutAiSdkText(prompt: string) {
  return generateText({
    model: createWalnutAiSdkModel(),
    prompt,
    experimental_telemetry: {
      isEnabled: true,
      functionId: "walnut.ai-sdk.generateText",
    },
  });
}

export function streamWalnutAiSdkText(prompt: string) {
  return streamText({
    model: createWalnutAiSdkModel(),
    prompt,
    experimental_telemetry: {
      isEnabled: true,
      functionId: "walnut.ai-sdk.streamText",
    },
  });
}
