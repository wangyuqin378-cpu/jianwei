import { describe, expect, it } from "vitest";
import { cardTitleForConfidence, composeCardTitle, UNCERTAIN_OBJECT_CONFIDENCE } from "./card-presentation.js";

describe("composeCardTitle", () => {
  it("uses the reviewed fact lead without model-written facts", () => {
    const fact = "现代扫帚常把刷毛设计成略带角度的扇形，让边缘更容易贴近墙角。";
    const first = composeCardTitle(" 扫帚 ", "broom-001", fact);
    expect(first).toBe(composeCardTitle("扫帚", "broom-001", fact));
    expect(first).toBe("现代扫帚常把刷毛设计成略带角度的扇形");
  });

  it("falls back to varied safe phrasing for context-dependent fact leads", () => {
    const titles = new Set(
      ["a", "b", "c", "d", "e", "f"].map((factId) =>
        composeCardTitle("牙刷", factId, "这项设计需要前文才能理解，因此不直接作为标题。")
      )
    );
    expect(titles.size).toBe(3);
    expect(Array.from(composeCardTitle(
      "很长".repeat(30),
      "fact-long",
      "这项设计需要前文才能理解，因此不直接作为标题。"
    ))).toHaveLength(30);
  });

  it("fails closed when the catalog identity is missing", () => {
    expect(() => composeCardTitle(" ", "fact", "有效事实正文。" )).toThrow("invalid");
    expect(() => composeCardTitle("扫帚", " ", "有效事实正文。" )).toThrow("invalid");
    expect(() => composeCardTitle("扫帚", "fact", " ")).toThrow("invalid");
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
