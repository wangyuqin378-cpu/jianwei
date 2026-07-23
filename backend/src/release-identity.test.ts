import { describe, expect, it } from "vitest";
import { computeBackendReleaseIdentity, hashReleaseEntries } from "./release-identity.js";

describe("backend Release identity", () => {
  it("is deterministic, path-bound and content-sensitive", () => {
    const entries = [
      { name: "backend/src/server.ts", bytes: Buffer.from("server") },
      { name: "knowledge/catalog.json", bytes: Buffer.from("{}") }
    ];
    expect(hashReleaseEntries(entries)).toBe(hashReleaseEntries([...entries].reverse()));
    expect(hashReleaseEntries(entries)).not.toBe(hashReleaseEntries([
      { ...entries[0]!, bytes: Buffer.from("changed") },
      entries[1]!
    ]));
    expect(() => hashReleaseEntries([{ name: "../escape", bytes: Buffer.from("x") }])).toThrow(/unsafe path/);
  });

  it("hashes the complete current deployable source set", async () => {
    const identity = await computeBackendReleaseIdentity();
    expect(identity).toMatchObject({ schemaVersion: 1, evidenceKind: "backend_release_identity" });
    expect(identity.backendReleaseSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(identity.fileCount).toBeGreaterThan(20);
  });
});
