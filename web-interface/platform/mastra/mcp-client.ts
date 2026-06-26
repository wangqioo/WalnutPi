import { MCPClient } from "@mastra/mcp";
import { getMcpConfig } from "../config/platform-config.ts";

export type WalnutMastraMcpClientOptions = {
  endpoint?: string | URL;
  fetchImpl?: typeof fetch;
  id?: string;
  timeoutMs?: number;
};

export function createWalnutMastraMcpClient({
  endpoint = getMcpConfig().endpoint,
  fetchImpl,
  id = "walnutpi-local-mcp",
  timeoutMs = 10_000,
}: WalnutMastraMcpClientOptions = {}) {
  const url = endpoint instanceof URL ? endpoint : new URL(String(endpoint));
  return new MCPClient({
    id,
    timeout: timeoutMs,
    servers: {
      walnutpi: {
        url,
        connectTimeout: timeoutMs,
        ...(fetchImpl ? { fetch: (requestUrl, init) => fetchImpl(requestUrl, init) } : {}),
        requireToolApproval: ({ annotations }) => {
          if (!annotations) return true;
          if (annotations.readOnlyHint && annotations.destructiveHint === false) return false;
          return true;
        },
      },
    },
  });
}

export async function listWalnutMastraMcpTools(options: WalnutMastraMcpClientOptions = {}) {
  const client = createWalnutMastraMcpClient(options);
  try {
    const tools = await client.listTools();
    return {
      ok: true,
      toolNames: Object.keys(tools).sort(),
      tools,
    };
  } finally {
    await client.disconnect();
  }
}
