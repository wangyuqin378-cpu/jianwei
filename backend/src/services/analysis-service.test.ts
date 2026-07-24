import { describe, expect, it } from "vitest";
import { personalContextForPhoto, scheduledDateInChina } from "./analysis-service.js";
import { InMemoryRepositories } from "../infrastructure/in-memory-repositories.js";
import { nextAvailableScheduledDate } from "../domain/card-scheduling.js";

describe("China-local card scheduling", () => {
  it("uses the next China calendar day after 16:00 UTC", () => {
    expect(scheduledDateInChina(new Date("2026-07-18T16:30:00.000Z"), 0)).toBe("2026-07-19");
  });

  it("builds a seven-day inclusive cache without UTC drift", () => {
    const now = new Date("2026-07-18T16:30:00.000Z");
    expect(Array.from({ length: 7 }, (_, index) => scheduledDateInChina(now, index))).toEqual([
      "2026-07-19",
      "2026-07-20",
      "2026-07-21",
      "2026-07-22",
      "2026-07-23",
      "2026-07-24",
      "2026-07-25"
    ]);
  });

  it("does not push a returning user behind historical cards", () => {
    const historical = Array.from({ length: 100 }, (_, index) =>
      new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10)
    );

    expect(nextAvailableScheduledDate("2026-07-20", historical)).toBe("2026-07-20");
  });

  it("fills the first future gap instead of extending a sparse tail", () => {
    expect(nextAvailableScheduledDate("2026-07-20", [
      "2026-07-20",
      "2026-07-22",
      "2026-08-30"
    ])).toBe("2026-07-21");
  });

  it("rejects an invalid schedule base date", () => {
    expect(() => nextAvailableScheduledDate("2026-02-30", [])).toThrow("valid ISO calendar date");
  });
});

describe("photo provenance copy", () => {
  it("turns an ISO capture bucket into a human explanation", () => {
    expect(personalContextForPhoto("2026-07-23", "自行车"))
      .toBe("你在 2026 年 7 月 23 日拍下了「自行车」，所以今天从它讲起。");
  });

  it("does not expose malformed metadata as display copy", () => {
    expect(personalContextForPhoto("not-a-date", " 扫帚 "))
      .toBe("它来自你主动授权的照片，所以今天从「扫帚」讲起。");
    expect(personalContextForPhoto(null, ""))
      .toBe("它来自你主动授权的照片，所以今天从「这个日常物件」讲起。");
  });
});

describe("pending object deletion scheduling", () => {
  it("moves failed items behind untouched work and applies bounded retry backoff", async () => {
    const repositories = new InMemoryRepositories();
    for (let index = 0; index < 101; index += 1) {
      await repositories.objectDeletionsRepository.enqueue(`analysis/${String(index).padStart(3, "0")}.image`);
    }
    const firstWindow = new Date(Date.now() + 1_000);
    const firstBatch = await repositories.objectDeletionsRepository.list(100, firstWindow.toISOString());
    expect(firstBatch).toHaveLength(100);
    for (const objectKey of firstBatch) await repositories.objectDeletionsRepository.enqueue(objectKey);

    const nextBatch = await repositories.objectDeletionsRepository.list(100, firstWindow.toISOString());
    expect(nextBatch).toEqual(["analysis/100.image"]);
    await repositories.objectDeletionsRepository.remove(nextBatch[0]!);
    expect(await repositories.objectDeletionsRepository.list(
      100,
      new Date(firstWindow.getTime() + 2 * 60 * 1000).toISOString()
    )).toEqual(firstBatch);
  });
});
