import { Mastra } from "@mastra/core";
import { Agent } from "@mastra/core/agent";
import { getMastraModelConfig } from "./platform/config/platform-config.ts";
import { getWalnutMastraStorage } from "./platform/mastra/storage.ts";

type WalnutAgentId = "router" | "widget" | "chat";

const REGISTRY_MODEL = getMastraModelConfig();

let mastraRegistry: Mastra | undefined;

export function getWalnutMastraRegistry() {
  if (!mastraRegistry) {
    const storage = getWalnutMastraStorage();
    const registry = new Mastra({
      storage,
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
    registry.setStorage(storage);
    mastraRegistry = registry;
  }
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
