export { getWalnutAgent, getWalnutMastraRegistry } from "../../mastra-registry.ts";
export { createWalnutMastraMcpClient, listWalnutMastraMcpTools } from "./mcp-client.ts";
import { getAiModelConfig } from "../config/platform-config.ts";

export const WALNUT_MASTRA_MODEL = getAiModelConfig();
