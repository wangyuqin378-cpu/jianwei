import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function isMainModule(metaUrl: string, argvEntry = process.argv[1]): boolean {
  if (!argvEntry) return false;
  try {
    return realpathSync.native(fileURLToPath(metaUrl)) === realpathSync.native(path.resolve(argvEntry));
  } catch {
    return false;
  }
}
