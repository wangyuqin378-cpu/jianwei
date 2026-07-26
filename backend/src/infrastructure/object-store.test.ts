import { mkdtemp, readdir, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type OSS from "ali-oss";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildOssClientOptions,
  hasSafeAnalysisLifecycle,
  isDisabledBucketVersioning,
  LocalObjectStore,
  OssObjectStore,
  RotatingOssCredentialSource
} from "./object-store.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("OSS lifecycle guard", () => {
  it("creates only a private object key and never a direct OSS upload capability", async () => {
    const { store } = ossStoreWithPolicy(undefined);
    await expect(store.createObjectKey(
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002"
    )).resolves.toMatch(
      /^analysis\/\d{4}-\d{2}-\d{2}\/00000000-0000-4000-8000-000000000001-00000000-0000-4000-8000-000000000002\.image$/
    );
  });

  it("accepts only enabled one-day rules that cover the analysis prefix", () => {
    expect(hasSafeAnalysisLifecycle([{ status: "Enabled", prefix: "analysis/", days: 1 }])).toBe(true);
    expect(hasSafeAnalysisLifecycle([{ status: "Enabled", prefix: "", days: "1" }])).toBe(true);
    expect(hasSafeAnalysisLifecycle([{ status: "Disabled", prefix: "analysis/", days: 1 }])).toBe(false);
    expect(hasSafeAnalysisLifecycle([{ status: "Enabled", prefix: "other/", days: 1 }])).toBe(false);
    expect(hasSafeAnalysisLifecycle([{ status: "Enabled", prefix: "analysis/", days: 2 }])).toBe(false);
  });

  it("accepts only never-enabled or explicitly disabled bucket versioning", () => {
    expect(isDisabledBucketVersioning(undefined)).toBe(true);
    expect(isDisabledBucketVersioning("Disabled")).toBe(true);
    expect(isDisabledBucketVersioning("Enabled")).toBe(false);
    expect(isDisabledBucketVersioning("Suspended")).toBe(false);
    expect(isDisabledBucketVersioning(null)).toBe(false);
    expect(isDisabledBucketVersioning("")).toBe(false);
  });

  it.each(["Enabled", "Suspended"])(
    "fails readiness when bucket versioning is %s even with a safe lifecycle",
    async (versionStatus) => {
      const { store, getBucketLifecycle, getBucketVersioning } = ossStoreWithPolicy(versionStatus);
      await expect(store.verifyRetentionPolicy()).rejects.toThrow(/versioning must be disabled/);
      expect(getBucketLifecycle).toHaveBeenCalledWith("test-bucket");
      expect(getBucketVersioning).toHaveBeenCalledWith("test-bucket");
    }
  );

  it("requires both disabled versioning and a one-day analysis lifecycle", async () => {
    const safe = ossStoreWithPolicy(undefined);
    await expect(safe.store.verifyRetentionPolicy()).resolves.toBeUndefined();

    const unsafeLifecycle = ossStoreWithPolicy(undefined, [
      { status: "Enabled", prefix: "analysis/", days: 2 }
    ]);
    await expect(unsafeLifecycle.store.verifyRetentionPolicy()).rejects.toThrow(/lifecycle rule/);
    expect(unsafeLifecycle.getBucketVersioning).toHaveBeenCalledWith("test-bucket");
  });

  it("passes temporary execution-role tokens without inventing an environment refresh callback", () => {
    const common = {
      region: "oss-cn-test",
      bucket: "test-bucket",
      accessKeyId: "test-id",
      accessKeySecret: "test-secret"
    };
    expect(buildOssClientOptions({ ...common, securityToken: "test-sts-token" })).toMatchObject({
      stsToken: "test-sts-token",
      secure: true
    });
    expect(buildOssClientOptions({ ...common, securityToken: "test-sts-token" })).not.toHaveProperty(
      "refreshSTSToken"
    );
    expect(buildOssClientOptions(common)).not.toHaveProperty("stsToken");
  });

  it("refreshes every OSS operation from the latest invocation credential set", async () => {
    const source = new RotatingOssCredentialSource({
      accessKeyId: "initial-id",
      accessKeySecret: "initial-secret",
      stsToken: "initial-token"
    });
    const options = buildOssClientOptions({
      region: "oss-cn-test",
      bucket: "test-bucket",
      accessKeyId: "initial-id",
      accessKeySecret: "initial-secret",
      securityToken: "initial-token"
    }, source);
    expect(options.refreshSTSTokenInterval).toBe(0);
    await expect(options.refreshSTSToken?.()).resolves.toEqual({
      accessKeyId: "initial-id",
      accessKeySecret: "initial-secret",
      stsToken: "initial-token"
    });

    source.update({
      accessKeyId: "rotated-id",
      accessKeySecret: "rotated-secret",
      stsToken: "rotated-token"
    });
    await expect(options.refreshSTSToken?.()).resolves.toEqual({
      accessKeyId: "rotated-id",
      accessKeySecret: "rotated-secret",
      stsToken: "rotated-token"
    });
    expect(() => source.update({
      accessKeyId: "",
      accessKeySecret: "secret",
      stsToken: "token"
    })).toThrow(/complete bounded set/);
  });
});

function ossStoreWithPolicy(
  versionStatus: string | undefined,
  rules: Array<{ status: string; prefix: string; days?: number | string }> = [
    { status: "Enabled", prefix: "analysis/", days: 1 }
  ]
) {
  const getBucketLifecycle = vi.fn(async () => ({ rules }));
  const getBucketVersioning = vi.fn(async () => ({ versionStatus }));
  const client = { getBucketLifecycle, getBucketVersioning } as unknown as OSS;
  const store = new OssObjectStore({
    region: "oss-cn-test",
    bucket: "test-bucket",
    accessKeyId: "temporary-id",
    accessKeySecret: "temporary-secret",
    securityToken: "temporary-token",
    ttlHours: 24
  }, client);
  return { store, getBucketLifecycle, getBucketVersioning };
}

describe("LocalObjectStore retention", () => {
  it("deletes analysis images older than the configured retention window", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianwei-objects-"));
    cleanup.push(directory);
    const store = new LocalObjectStore(directory, "http://127.0.0.1:8787", 1);
    await store.put("expired.image", Buffer.alloc(64, 1));
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await utimes(path.join(directory, "expired.image"), old, old);

    expect(await store.purgeExpired()).toBe(1);
    expect(await readdir(directory)).toEqual([]);
  });
});
