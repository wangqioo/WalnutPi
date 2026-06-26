import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { getDbConfig } from "../web-interface/platform/config/platform-config.ts";

const projectRoot = path.resolve(import.meta.dir, "..");
const migrationsDir = path.join(projectRoot, "web-interface", "platform", "db", "migrations");
const databaseUrl = getDbConfig().url;

if (!databaseUrl) {
  throw new Error("Database URL is not configured.");
}

const sql = postgres(databaseUrl, {
  max: 1,
  prepare: false,
});

try {
  const files = (await readdir(migrationsDir))
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort();
  for (const file of files) {
    const body = await readFile(path.join(migrationsDir, file), "utf8");
    const checksum = createHash("sha256").update(body).digest("hex");
    await ensureMigrationTable(sql);
    const existing = await sql`
      select checksum from platform_migrations where id = ${file} limit 1
    `;
    if (existing.length) {
      if (existing[0].checksum !== checksum) {
        throw new Error(`Migration checksum changed after apply: ${file}`);
      }
      console.log(`skip ${file}`);
      continue;
    }
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`
        insert into platform_migrations (id, checksum)
        values (${file}, ${checksum})
      `;
    });
    console.log(`applied ${file}`);
  }
} finally {
  await sql.end({ timeout: 1 });
}

async function ensureMigrationTable(sqlClient: postgres.Sql) {
  await sqlClient`
    create table if not exists platform_migrations (
      id text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
  `;
}
