import { z } from "zod";
import { getWalnutAgent } from "./mastra-registry.ts";

type Telemetry = Record<string, any>;
type WalnutChatMessage = {
  role?: string;
  content?: string;
  parts?: Array<{ text?: string; content?: string }>;
};

export function createWalnutMastraAgentApi() {
  const api = {
    async classifyIntent(text: string, telemetry: Telemetry = {}) {
      const schema = z.object({
        intent: z.string(),
        subject: z.string().optional(),
        delivery: z.string().optional(),
        confidence: z.number().min(0).max(1),
      });
      const agent = getWalnutAgent("router");
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
      const agent = getWalnutAgent("widget");
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

    async createChatResponse({ messages, telemetry = {} }: { messages: WalnutChatMessage[]; telemetry?: Telemetry }) {
      const lastUserMessage = [...messages].reverse().find((message) => message.role === "user");
      const userPrompt = uiMessageText(lastUserMessage).trim();
      const agent = getWalnutAgent("chat");
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

    async handleChat(req: Request) {
      let body: any;
      try {
        body = await req.json();
      } catch (error: any) {
        return Response.json({ ok: false, error: error.message }, { status: 400 });
      }

      const messages = Array.isArray(body?.messages) ? body.messages : [];
      return api.createChatResponse({
        messages,
        telemetry: {
          sessionId: body?.sessionId || null,
          turnId: body?.turnId || null,
        },
      });
    },
  };

  return api;
}

function buildStructuredPrompt(lines: string[]) {
  return lines.filter(Boolean).join("\n");
}

function normalizeStructuredOutput<T>(output: T | undefined, schema: z.ZodType<T>) {
  const parsed = schema.safeParse(output);
  if (parsed.success) return parsed.data;
  if (typeof output === "string") {
    const textParsed = tryParseJson(output);
    const parsedFromText = schema.safeParse(textParsed);
    if (parsedFromText.success) return parsedFromText.data;
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

function uiMessageText(message: WalnutChatMessage | undefined) {
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
