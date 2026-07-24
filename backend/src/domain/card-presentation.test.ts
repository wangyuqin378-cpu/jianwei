import { describe, expect, it } from "vitest";
import { cardTitleForConfidence, composeCardTitle, UNCERTAIN_OBJECT_CONFIDENCE } from "./card-presentation.js";

describe("composeCardTitle", () => {
  it("creates a stable, safe title without model-written facts", () => {
    const first = composeCardTitle(" 扫帚 ", "broom-001");
    expect(first).toBe(composeCardTitle("扫帚", "broom-001"));
    expect(first).toContain("扫帚");
    expect(Array.from(first).length).toBeLessThanOrEqual(30);
  });

  it("varies safe phrasing between facts and bounds long object names", () => {
    const titles = new Set(["a", "b", "c", "d", "e", "f"].map((factId) => composeCardTitle("牙刷", factId)));
    expect(titles.size).toBe(3);
    expect(Array.from(composeCardTitle("很长".repeat(30), "fact-long"))).toHaveLength(30);
  });

  it("fails closed when the catalog identity is missing", () => {
    expect(() => composeCardTitle(" ", "fact")).toThrow("invalid");
    expect(() => composeCardTitle("扫帚", " ")).toThrow("invalid");
  });
});

describe("cardTitleForConfidence", () => {
  it("replaces a confident generated headline with explicit uncertainty below the threshold", () => {
    expect(cardTitleForConfidence("牙刷刷毛的设计", "牙刷", UNCERTAIN_OBJECT_CONFIDENCE - 0.01))
      .toBe("这可能是牙刷");
  });

  it("keeps the reviewed-card headline at and above the threshold", () => {
    expect(cardTitleForConfidence("牙刷刷毛的设计", "牙刷", UNCERTAIN_OBJECT_CONFIDENCE))
      .toBe("牙刷刷毛的设计");
  });

  it("normalizes object whitespace and keeps the title schema bound", () => {
    const value = cardTitleForConfidence("知识标题", `  ${"长".repeat(40)}   物件  `, 0.6);
    expect(Array.from(value)).toHaveLength(30);
    expect(value.startsWith("这可能是长")).toBe(true);
  });

  it("fails closed for invalid presentation input", () => {
    expect(() => cardTitleForConfidence("标题", " ", 0.7)).toThrow("invalid");
    expect(() => cardTitleForConfidence("标题", "牙刷", Number.NaN)).toThrow("invalid");
  });
});
