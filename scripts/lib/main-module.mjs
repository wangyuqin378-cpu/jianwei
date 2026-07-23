import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function isMainModule(metaUrl, argvEntry = process.argv[1]) {
  if (typeof metaUrl !== "string" || typeof argvEntry !== "string" || !argvEntry) return false;
  try {
    const modulePath = realpathSync.native(fileURLToPath(metaUrl));
    const entryPath = realpathSync.native(path.resolve(argvEntry));
    return modulePath === entryPath;
  } catch {
    return false;
  }
}
