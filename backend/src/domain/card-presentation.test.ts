import { describe, expect, it } from "vitest";
import { cardTitleForConfidence, UNCERTAIN_OBJECT_CONFIDENCE } from "./card-presentation.js";

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
