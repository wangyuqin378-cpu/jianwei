import { describe, expect, it } from "vitest";
import type { KnowledgeCatalog } from "./domain/types.js";
import { demoteUnattestedHighRisk, parseArguments } from "./review-knowledge-ai.js";

describe("AI knowledge review CLI", () => {
  it("requires explicit write versioning and bounds the batch", () => {
    expect(() => parseArguments(["--credentials-file", "/tmp/key.csv", "--write"])).toThrow(/next-version/);
    expect(() => parseArguments(["--credentials-file", "/tmp/key.csv", "--limit", "601"])).toThrow(/1 to 600/);
    expect(parseArguments(["--credentials-file", "/tmp/key.csv", "--all"]).limit).toBeNull();
    expect(parseArguments([
      "--credentials-file", "/tmp/key.csv",
      "--fact-id", "usb-flash-drive-read-disturb",
      "--fact-id", "watering-can-rose-up"
    ]).factIds).toEqual(["usb-flash-drive-read-disturb", "watering-can-rose-up"]);
    expect(() => parseArguments([
      "--credentials-file", "/tmp/key.csv",
      "--fact-id", "same-fact",
      "--fact-id", "same-fact"
    ])).toThrow(/unique/);
  });

  it("demotes legacy unattested high-risk approvals without touching general knowledge", () => {
    const catalog = {
      topics: [{ facts: [
        { riskLevel: "health", reviewStatus: "approved" },
        { riskLevel: "general", reviewStatus: "approved" }
      ] }]
    } as unknown as KnowledgeCatalog;
    expect(demoteUnattestedHighRisk(catalog)).toBe(1);
    expect(catalog.topics[0]!.facts.map((fact) => fact.reviewStatus)).toEqual(["draft", "approved"]);
  });
});
