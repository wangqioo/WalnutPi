import { Mastra } from "@mastra/core";
import { Agent } from "@mastra/core/agent";

const REGISTRY_MODEL = {
  providerId: "walnut-ai",
  modelId: process.env.WALNUT_AI_MODEL || "gpt-5.4-mini",
  url: (process.env.WALNUT_AI_BASE_URL || "https://rehdasu.cn/v1").replace(/\/+$/, ""),
  apiKey: process.env.WALNUT_AI_API_KEY || process.env.OPENAI_API_KEY || "",
};

let mastraRegistry: Mastra | undefined;

export function getWalnutMastraRegistry() {
  mastraRegistry ??= new Mastra({
    agents: {
      router: new Agent({
        id: "router",
        name: "WalnutPi Router",
        instructions: [
          "You are the WalnutPi product router.",
          "Return only the requested JSON object.",
          "Do not execute commands.",
          "Do not infer evaluation oracle answers.",
        ].join("\n"),
        model: REGISTRY_MODEL,
      }),
      widget: new Agent({
        id: "widget",
        name: "WalnutPi Widget Catalog Generator",
        instructions: [
          "You design a playable 480x320 WalnutPi LVGL widget app as JSON.",
          "Return only the requested JSON object.",
          "Do not generate an image.",
          "Do not use markdown.",
        ].join("\n"),
        model: REGISTRY_MODEL,
      }),
      chat: new Agent({
        id: "chat",
        name: "WalnutPi Chat Assistant",
        instructions: [
          "You are WalnutAI for WalnutPi.",
          "Answer in Chinese.",
          "Be concise and concrete.",
          "If the request needs device state, tell the user to use the structured turn endpoint.",
        ].join("\n"),
        model: REGISTRY_MODEL,
      }),
    },
  });

  return mastraRegistry;
}

export function getWalnutAgent(agentId: "router" | "widget" | "chat") {
  const registry = getWalnutMastraRegistry();
  const agent = registry.getAgentById(agentId);
  if (!agent) {
    throw new Error(`WalnutAiSdk agent not found: ${agentId}`);
  }
  return agent;
}
