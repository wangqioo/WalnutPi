import { Mastra } from "@mastra/core";
import { Agent } from "@mastra/core/agent";
import type { UIMessage } from "ai";
import { z } from "zod";

type Telemetry = Record<string, any>;

const modelConfig = {
  providerId: "walnut-ai",
  modelId: process.env.WALNUT_AI_MODEL || "gpt-5.4-mini",
  url: (process.env.WALNUT_AI_BASE_URL || "https://rehdasu.cn/v1").replace(/\/+$/, ""),
  apiKey: process.env.WALNUT_AI_API_KEY || process.env.OPENAI_API_KEY || "",
};

let mastraRegistry: Mastra | undefined;

export function createWalnutAiSdk() {
  return {
    async classifyIntent(text: string, telemetry: Telemetry = {}) {
      const schema = z.object({
        intent: z.string(),
        subject: z.string().optional(),
        delivery: z.string().optional(),
        confidence: z.number().min(0).max(1),
      });
      const agent = getAgent("router");
      const result = await agent.generate(buildStructuredPrompt([
        "You are the WalnutPi product router.",
        "Return JSON only.",
        "Choose exactly one supported intent.",
        "Do not execute commands.",
        "Do not infer evaluation oracle answers.",
        "Allowed intents: chat, screen.generate, screen.sync, device.status.read, action.confirm, action.run, diagnostics.read, memory.read.",
        "Input text:",
        text,
        "Telemetry:",
        JSON.stringify(telemetry),
      ]), {
        structuredOutput: {
          schema,
        },
        maxSteps: 1,
      });
      return normalizeStructuredOutput(result.object, schema);
    },

    async generateWidgetCatalog(prompt: string, telemetry: Telemetry = {}) {
      const schema = z.object({
        schema: z.literal("walnutpi.lvgl-widget-catalog.v1"),
        id: z.string(),
        title: z.string(),
        size: z.object({ width: z.literal(480), height: z.literal(320) }),
        theme: z.string(),
        data: z.record(z.string(), z.any()),
        root: z.string(),
        nodes: z.array(z.record(z.string(), z.any())),
      });
      const agent = getAgent("widget");
      const result = await agent.generate(buildStructuredPrompt([
        "You design a playable 480x320 WalnutPi LVGL widget app as JSON.",
        "Return JSON only.",
        "Do not generate an image. Do not use markdown.",
        "Schema must be walnutpi.lvgl-widget-catalog.v1.",
        "Canvas is exactly 480x320.",
        "Prompt:",
        prompt,
        "Telemetry:",
        JSON.stringify(telemetry),
      ]), {
        structuredOutput: {
          schema,
        },
        maxSteps: 1,
      });
      return normalizeStructuredOutput(result.object, schema);
    },

    async createChatResponse({ messages, telemetry = {} }: { messages: UIMessage[]; telemetry?: Telemetry }) {
      const lastUserMessage = [...messages].reverse().find((message) => message.role === "user");
      const userPrompt = uiMessageText(lastUserMessage).trim();
      const agent = getAgent("chat");
      const result = await agent.generate(buildStructuredPrompt([
        "You are WalnutAI for WalnutPi.",
        "Answer in Chinese.",
        "Be concise and concrete.",
        "If the request needs device state, tell the user to use the structured turn endpoint.",
        "Telemetry:",
        JSON.stringify(telemetry),
        "Conversation:",
        JSON.stringify(messages),
        "Latest user request:",
        userPrompt,
      ]), {
        maxSteps: 1,
      });

      return Response.json({
        ok: true,
        schema: "walnutpi.agentChatResponse.v1",
        text: result.text || "",
      });
    },
  };
}

function getMastraRegistry() {
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
        model: modelConfig,
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
        model: modelConfig,
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
        model: modelConfig,
      }),
    },
  });

  return mastraRegistry;
}

function getAgent(agentId: "router" | "widget" | "chat") {
  const registry = getMastraRegistry();
  const agent = registry.getAgentById(agentId);
  if (!agent) {
    throw new Error(`WalnutAiSdk agent not found: ${agentId}`);
  }
  return agent;
}

function buildStructuredPrompt(lines: string[]) {
  return lines.filter(Boolean).join("\n");
}

function normalizeStructuredOutput<T>(output: T | undefined, schema: z.ZodType<T>) {
  const parsed = schema.safeParse(output);
  if (parsed.success) {
    return parsed.data;
  }
  if (typeof output === "string") {
    const textParsed = tryParseJson(output);
    const parsedFromText = schema.safeParse(textParsed);
    if (parsedFromText.success) {
      return parsedFromText.data;
    }
  }
  return output as T;
}

function tryParseJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function uiMessageText(message: UIMessage | undefined) {
  if (!message) return "";
  const anyMessage = message as any;
  if (typeof anyMessage.content === "string") return anyMessage.content;
  if (Array.isArray(anyMessage.parts)) {
    return anyMessage.parts
      .map((part: any) => {
        if (typeof part?.text === "string") return part.text;
        if (typeof part?.content === "string") return part.content;
        return "";
      })
      .join(" ");
  }
  return "";
}
