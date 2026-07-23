import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import OSS from "ali-oss";
import type { ObjectStore } from "../domain/types.js";

export class LocalObjectStore implements ObjectStore {
  constructor(
    private readonly root: string,
    private readonly publicBaseUrl: string,
    private readonly ttlHours: number
  ) {}

  async verifyRetentionPolicy(): Promise<void> {}

  async createObjectKey(jobId: string): Promise<string> {
    return `${jobId}.image`;
  }

  async put(objectKey: string, body: Buffer): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await writeFile(path.join(this.root, path.basename(objectKey)), body, { mode: 0o600 });
  }

  async head(objectKey: string): Promise<{ size: number; contentType: string | null }> {
    const metadata = await stat(path.join(this.root, path.basename(objectKey)));
    return { size: metadata.size, contentType: null };
  }

  async get(objectKey: string): Promise<Buffer> {
    return readFile(path.join(this.root, path.basename(objectKey)));
  }

  async delete(objectKey: string): Promise<void> {
    await rm(path.join(this.root, path.basename(objectKey)), { force: true });
  }

  async purgeExpired(): Promise<number> {
    const entries = await readdir(this.root, { withFileTypes: true }).catch(() => []);
    const cutoff = Date.now() - retentionWindowMs(this.ttlHours);
    let deleted = 0;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const target = path.join(this.root, entry.name);
      const metadata = await stat(target).catch(() => null);
      if (metadata && metadata.mtimeMs <= cutoff) {
        await rm(target, { force: true });
        deleted += 1;
      }
    }
    return deleted;
  }
}

export class OssObjectStore implements ObjectStore {
  private readonly client: OssClientWithVersioning;
  private readonly bucket: string;

  constructor(input: OssClientOptionsInput & {
    ttlHours: number;
  }, clientOverride?: OSS, credentialSource?: RotatingOssCredentialSource) {
    this.client = (clientOverride ?? new OSS(buildOssClientOptions(input, credentialSource))) as OssClientWithVersioning;
    this.bucket = input.bucket;
    this.ttlHours = input.ttlHours;
  }

  private readonly ttlHours: number;

  async verifyRetentionPolicy(): Promise<void> {
    if (this.ttlHours > 24) throw new Error("OSS object TTL must not exceed 24 hours");
    const [lifecycle, versioning] = await Promise.all([
      this.client.getBucketLifecycle(this.bucket),
      this.client.getBucketVersioning(this.bucket)
    ]);
    if (!isDisabledBucketVersioning(versioning.versionStatus)) {
      throw new Error("OSS bucket versioning must be disabled; Enabled and Suspended retain object versions");
    }
    const protectedByLifecycle = hasSafeAnalysisLifecycle(lifecycle.rules);
    if (!protectedByLifecycle) {
      throw new Error("OSS bucket must have an enabled <=1 day lifecycle rule covering analysis/");
    }
  }

  async createObjectKey(jobId: string): Promise<string> {
    // Upload authorization is owned by the authenticated API and its database
    // session. The OSS client never creates or returns a direct PUT capability.
    return `analysis/${new Date().toISOString().slice(0, 10)}/${jobId}.image`;
  }

  async put(objectKey: string, body: Buffer): Promise<void> {
    await this.client.put(objectKey, body, { mime: "image/jpeg" });
  }

  async head(objectKey: string): Promise<{ size: number; contentType: string | null }> {
    const result = await this.client.head(objectKey);
    const headers = result.res.headers as Record<string, string | number | undefined>;
    const size = Number(headers["content-length"]);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error("OSS object has an invalid Content-Length");
    const rawContentType = headers["content-type"];
    return {
      size,
      contentType: rawContentType === undefined ? null : String(rawContentType).split(";")[0]?.trim().toLowerCase() ?? null
    };
  }

  async get(objectKey: string): Promise<Buffer> {
    // Bound the response even if a still-valid PUT URL races with the preceding
    // metadata check and overwrites the object with a larger payload.
    const result = await this.client.get(objectKey, undefined, {
      headers: { Range: `bytes=0-${MAX_ANALYSIS_IMAGE_BYTES}` }
    });
    return Buffer.isBuffer(result.content) ? result.content : Buffer.from(result.content);
  }

  async delete(objectKey: string): Promise<void> {
    await this.client.delete(objectKey);
  }

  async purgeExpired(): Promise<number> {
    const cutoff = Date.now() - retentionWindowMs(this.ttlHours);
    let marker: string | undefined;
    let deleted = 0;
    do {
      const result = await this.client.list({
        prefix: "analysis/",
        ...(marker ? { marker } : {}),
        "max-keys": 500
      }, {});
      const expired = result.objects
        .filter((item) => Date.parse(item.lastModified) <= cutoff)
        .map((item) => item.name);
      if (expired.length) {
        await this.client.deleteMulti(expired, { quiet: true });
        deleted += expired.length;
      }
      marker = result.isTruncated ? result.nextMarker : undefined;
    } while (marker);
    return deleted;
  }
}

export interface OssClientOptionsInput {
  region: string;
  bucket: string;
  accessKeyId: string;
  accessKeySecret: string;
  securityToken?: string | null;
}

export interface OssTemporaryCredentials {
  accessKeyId: string;
  accessKeySecret: string;
  stsToken: string;
}

export class RotatingOssCredentialSource {
  private current: OssTemporaryCredentials;

  constructor(initial: OssTemporaryCredentials) {
    this.current = validateTemporaryCredentials(initial);
  }

  update(next: OssTemporaryCredentials): void {
    this.current = validateTemporaryCredentials(next);
  }

  snapshot(): OssTemporaryCredentials {
    return { ...this.current };
  }
}

export function buildOssClientOptions(
  input: OssClientOptionsInput,
  credentialSource?: RotatingOssCredentialSource
) {
  return {
    region: input.region,
    bucket: input.bucket,
    accessKeyId: input.accessKeyId,
    accessKeySecret: input.accessKeySecret,
    ...(input.securityToken ? { stsToken: input.securityToken } : {}),
    ...(credentialSource ? {
      // This callback is memory-only and reads credentials injected by Function
      // Compute on the latest invocation. A zero interval makes ali-oss consult
      // it before every operation instead of retaining an expired warm-instance
      // token for another refresh window.
      refreshSTSTokenInterval: 0,
      refreshSTSToken: async () => credentialSource.snapshot()
    } : {}),
    secure: true,
    timeout: OSS_REQUEST_TIMEOUT_MS
  };
}

function validateTemporaryCredentials(input: OssTemporaryCredentials): OssTemporaryCredentials {
  const values = [input.accessKeyId, input.accessKeySecret, input.stsToken];
  if (values.some((value) => typeof value !== "string" || value.length < 1 || value.length > 4096)) {
    throw new Error("OSS temporary credentials must be a complete bounded set");
  }
  return { ...input };
}

export const MAX_ANALYSIS_IMAGE_BYTES = 3 * 1024 * 1024;
export const OSS_REQUEST_TIMEOUT_MS = 10_000;

function retentionWindowMs(ttlHours: number): number {
  return Math.max(1, ttlHours * 60 - 5) * 60 * 1000;
}

export function hasSafeAnalysisLifecycle(
  rules: Array<{ status: string; prefix: string; days?: number | string | undefined }>
): boolean {
  return rules.some((rule) =>
    rule.status === "Enabled" &&
    "analysis/".startsWith(rule.prefix) &&
    Number(rule.days) > 0 &&
    Number(rule.days) <= 1
  );
}

export function isDisabledBucketVersioning(versionStatus: unknown): boolean {
  // ali-oss returns undefined when versioning has never been enabled. OSS does
  // not return "Disabled" today, but accepting that explicit equivalent keeps
  // the guard compatible while failing closed for empty/unknown values.
  return versionStatus === undefined || versionStatus === "Disabled";
}

type OssClientWithVersioning = OSS & {
  getBucketVersioning(bucketName: string): Promise<{ versionStatus?: string }>;
};
