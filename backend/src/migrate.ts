import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { runMigrations } from "./migrations.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const databaseUrl = loadConfig().databaseUrl;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run migrations");
const applied = await runMigrations(databaseUrl, path.join(ROOT, "migrations"));
process.stdout.write(applied.length ? `Applied migrations: ${applied.join(", ")}\n` : "Database schema is current\n");
