import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

export interface Migration {
  id: string;
  fileName: string;
  checksum: string;
  source: string;
}

export async function loadMigrations(directory: string): Promise<Migration[]> {
  const fileNames = (await readdir(directory))
    .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))
    .sort((left, right) => left.localeCompare(right));
  const migrations = await Promise.all(fileNames.map(async (fileName) => {
    const source = await readFile(path.join(directory, fileName), "utf8");
    return {
      id: fileName.slice(0, -4),
      fileName,
      checksum: createHash("sha256").update(source).digest("hex"),
      source
    };
  }));
  const ids = new Set(migrations.map((migration) => migration.id));
  if (ids.size !== migrations.length) throw new Error("Duplicate migration IDs");
  if (migrations.length === 0) throw new Error(`No migrations found in ${directory}`);
  return migrations;
}

export async function runMigrations(databaseUrl: string, directory: string): Promise<string[]> {
  const migrations = await loadMigrations(directory);
  const sql = postgres(databaseUrl, { max: 1, idle_timeout: 5, transform: { undefined: null } });
  const applied: string[] = [];
  try {
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await sql`SELECT pg_advisory_lock(1246387831)`;
    for (const migration of migrations) {
      const existing = await sql<{ checksum: string }[]>`
        SELECT checksum FROM schema_migrations WHERE id = ${migration.id} LIMIT 1`;
      if (existing[0]) {
        if (existing[0].checksum !== migration.checksum) {
          throw new Error(`Applied migration checksum changed: ${migration.fileName}`);
        }
        continue;
      }
      await sql.begin(async (transaction) => {
        await transaction.unsafe(migration.source);
        await transaction`
          INSERT INTO schema_migrations (id, checksum)
          VALUES (${migration.id}, ${migration.checksum})`;
      });
      applied.push(migration.id);
    }
    return applied;
  } finally {
    await sql`SELECT pg_advisory_unlock(1246387831)`.catch(() => undefined);
    await sql.end({ timeout: 5 });
  }
}
