import { buildServer } from "./server.js";
import { loadConfig } from "./config.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "./migrations.js";

const config = loadConfig();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (config.databaseUrl) await runMigrations(config.databaseUrl, path.join(ROOT, "migrations"));
const app = await buildServer({ config });

const shutdown = async () => {
  await app.close();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ host: config.host, port: config.port });
process.stdout.write(`Jianwei API listening on ${config.publicBaseUrl}\n`);
