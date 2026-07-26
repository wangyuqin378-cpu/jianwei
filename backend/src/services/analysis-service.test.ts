import { describe, expect, it } from "vitest";
import {
  AnalysisService,
  type CreateJobInput,
  personalContextForPhoto,
  scheduledDateInChina,
  UPLOAD_CLAIM_LEASE_MS
} from "./analysis-service.js";
import { InMemoryRepositories } from "../infrastructure/in-memory-repositories.js";
import { nextAvailableScheduledDate } from "../domain/card-scheduling.js";
import type { ObjectStore, VisionProvider } from "../domain/types.js";
import type { KnowledgeCatalogService } from "./knowledge-catalog.js";

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
    expect(personalContextForPhoto("2026-02-31", "扫帚"))
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

describe("upload claim recovery", () => {
  it("replaces a stale upload claim without letting the old session finish the new upload", async () => {
    const repositories = new InMemoryRepositories();
    const device = await repositories.devicesRepository.register("upload-installation", "upload-token");
    const objects = new TrackingObjectStore();
    const service = analysisService(repositories, objects);
    const input = createJobInput("00000000-0000-4000-8000-000000000015");
    const first = await service.createJob(device, input);
    const oldSessionId = first.job.uploadSessionId!;
    const oldObjectKey = first.job.objectKey!;
    expect(await repositories.jobsRepository.claimForUpload(
      oldSessionId,
      device.id,
      new Date(Date.now() - UPLOAD_CLAIM_LEASE_MS - 1).toISOString()
    )).toMatchObject({ status: "uploading" });

    const retried = await service.createJob(device, input);

    expect(retried.job.id).toBe(first.job.id);
    expect(retried.job.status).toBe("awaiting_upload");
    expect(retried.job.uploadSessionId).not.toBe(oldSessionId);
    expect(retried.job.objectKey).not.toBe(oldObjectKey);
    expect(objects.deleted).toEqual([oldObjectKey]);
    await expect(repositories.jobsRepository.finishUpload(
      first.job.id,
      oldSessionId,
      null
    )).resolves.toBeNull();
    await expect(repositories.jobsRepository.claimForUpload(
      retried.job.uploadSessionId!,
      device.id,
      new Date().toISOString()
    )).resolves.toMatchObject({ status: "uploading" });
  });

  it("does not steal a fresh upload claim", async () => {
    const repositories = new InMemoryRepositories();
    const device = await repositories.devicesRepository.register("fresh-installation", "fresh-token");
    const objects = new TrackingObjectStore();
    const service = analysisService(repositories, objects);
    const input = createJobInput("00000000-0000-4000-8000-000000000016");
    const first = await service.createJob(device, input);
    await repositories.jobsRepository.claimForUpload(
      first.job.uploadSessionId!,
      device.id,
      new Date().toISOString()
    );

    await expect(service.createJob(device, input)).rejects.toMatchObject({
      code: "upload_in_progress",
      statusCode: 409
    });
    expect(objects.deleted).toEqual([]);
  });
});

function analysisService(repositories: InMemoryRepositories, objects: ObjectStore): AnalysisService {
  const vision: VisionProvider = {
    detect: async () => ({
      canonicalTopicId: "broom",
      displayName: "扫帚",
      confidence: 0.9,
      boundingBox: null,
      alternatives: [],
      sensitiveFlags: []
    })
  };
  return new AnalysisService(
    repositories.jobsRepository,
    repositories.cardsRepository,
    objects,
    repositories.objectDeletionsRepository,
    vision,
    {} as KnowledgeCatalogService,
    100,
    1_000,
    10_000,
    100_000,
    1,
    10_000,
    100_000,
    true,
    "https://api.example.test"
  );
}

function createJobInput(candidateToken: string): CreateJobInput {
  return {
    candidateToken,
    capturedAtBucket: "2026-07-26",
    localLabels: ["broom"],
    qualityScore: 0.9,
    sensitiveFlags: [],
    contentType: "image/jpeg"
  };
}

class TrackingObjectStore implements ObjectStore {
  readonly deleted: string[] = [];

  async verifyRetentionPolicy(): Promise<void> {}
  async createObjectKey(jobId: string, uploadSessionId: string): Promise<string> {
    return `analysis/${jobId}/${uploadSessionId}.image`;
  }
  async put(): Promise<void> {}
  async head(): Promise<{ size: number; contentType: string | null }> {
    return { size: 64, contentType: "image/jpeg" };
  }
  async get(): Promise<Buffer> { return Buffer.alloc(64); }
  async delete(objectKey: string): Promise<void> { this.deleted.push(objectKey); }
  async purgeExpired(): Promise<number> { return 0; }
}
