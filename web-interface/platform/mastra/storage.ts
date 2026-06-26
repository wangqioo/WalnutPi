import { PostgresStore } from "@mastra/pg";
import { getDbConfig } from "../config/platform-config.ts";

let mastraStorage: PostgresStore | undefined;

export function getWalnutMastraStorage() {
  const databaseUrl = getDbConfig().url;
  if (!databaseUrl) {
    throw new Error("Mastra Postgres storage requires db.url.");
  }
  mastraStorage ??= new PostgresStore({
    id: "walnutpi-mastra",
    connectionString: databaseUrl,
    schemaName: "public",
  });
  return mastraStorage;
}
