import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const catalogPath = path.resolve(process.cwd(), process.argv[2] ?? "knowledge/catalog.json");
const bytes = await readFile(catalogPath);
const digest = createHash("sha256").update(bytes).digest("hex");
process.stdout.write(`${digest}\n`);
