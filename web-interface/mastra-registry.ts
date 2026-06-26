import { Mastra } from "@mastra/core";
import { Agent } from "@mastra/core/agent";
import { getAiModelConfig } from "./platform/config/platform-config.ts";

const REGISTRY_MODEL = getAiModelConfig();

type WalnutAgentId = "router" | "widget" | "chat";
type WalnutMastraRegistry = {
  getAgentById(agentId: WalnutAgentId): any;
};

let mastraRegistry: WalnutMastraRegistry | undefined;

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

export function getWalnutAgent(agentId: WalnutAgentId) {
  const registry = getWalnutMastraRegistry();
  const agent = registry.getAgentById(agentId);
  if (!agent) {
    throw new Error(`Walnut Mastra agent not found: ${agentId}`);
  }
  return agent;
}
