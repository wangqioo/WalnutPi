import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getDbConfig } from "../config/platform-config.ts";
import * as schema from "./schema.ts";

export function createWalnutPostgresClient(databaseUrl = getDbConfig().url) {
  if (!databaseUrl) {
    return {
      ok: false,
      skipped: true,
      reason: "database url is not configured",
      db: null,
      sql: null,
    };
  }
  const sql = postgres(databaseUrl, {
    max: 1,
    prepare: false,
  });
  const db = drizzle(sql, { schema });
  return {
    ok: true,
    skipped: false,
    db,
    sql,
  };
}

export { schema };
