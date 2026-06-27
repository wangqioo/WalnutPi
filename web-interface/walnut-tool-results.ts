export const TOOL_RESULT_SCHEMAS = {
  device: "walnutpi.toolResult.device.v1",
  screen: "walnutpi.toolResult.screen.v1",
  memory: "walnutpi.toolResult.memory.v1",
  diagnostics: "walnutpi.toolResult.diagnostics.v1",
  policy: "walnutpi.toolResult.policy.v1",
  chat: "walnutpi.toolResult.chat.v1",
  eval: "walnutpi.toolResult.eval.v1",
} as const;

type ToolFamily = keyof typeof TOOL_RESULT_SCHEMAS;
type JsonObject = Record<string, any>;

export type WalnutToolResult = {
  schema: (typeof TOOL_RESULT_SCHEMAS)[ToolFamily];
  ok: boolean;
  family: ToolFamily;
  summary: string;
  result: JsonObject;
  evidence: JsonObject;
  sideEffects: Array<{ kind: string; target: string; status: string }>;
  diagnostics: JsonObject;
};

export function toolResult(
  family: ToolFamily,
  {
    ok = true,
    summary = "",
    result = {},
    evidence = {},
    sideEffects = [],
    diagnostics = {},
  }: {
    ok?: boolean;
    summary?: string;
    result?: JsonObject;
    evidence?: JsonObject;
    sideEffects?: Array<{ kind?: string; target?: string; status?: string }>;
    diagnostics?: JsonObject;
  } = {},
): WalnutToolResult {
  return {
    schema: TOOL_RESULT_SCHEMAS[family],
    ok: Boolean(ok),
    family,
    summary: String(summary || ""),
    result: objectOrEmpty(result),
    evidence: objectOrEmpty(evidence),
    sideEffects: normalizeSideEffects(sideEffects),
    diagnostics: objectOrEmpty(diagnostics),
  };
}

export function failedToolResult(family: ToolFamily, summary: string, diagnostics: JsonObject = {}) {
  return toolResult(family, {
    ok: false,
    summary,
    diagnostics,
    evidence: {
      failure: summary,
    },
  });
}

function objectOrEmpty(value: any): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeSideEffects(value: Array<{ kind?: string; target?: string; status?: string }>) {
  return (Array.isArray(value) ? value : [])
    .map((item) => ({
      kind: String(item?.kind || "").trim(),
      target: String(item?.target || "unknown").trim() || "unknown",
      status: String(item?.status || "observed").trim() || "observed",
    }))
    .filter((item) => item.kind);
}
