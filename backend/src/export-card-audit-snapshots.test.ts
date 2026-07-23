import { describe, expect, it } from "vitest";
import { buildCardSnapshotArtifact } from "./export-card-audit-snapshots.js";

describe("card audit snapshot export", () => {
  it("exports digest-bound cards without device or candidate identity", () => {
    const artifact = buildCardSnapshotArtifact([{
      id: "00000000-0000-4000-8000-000000000001",
      topic_id: "broom",
      fact_id: "broom-001",
      title: "扫帚为什么这样做",
      detected_object_name: "扫帚",
      body: "扫帚的束状结构让许多细小刷毛共同接触地面，便于聚拢松散灰尘。",
      personal_context: "因为它出现在你授权分析的照片中",
      confidence: 0.91,
      sources: [{ sourceId: "source-one", url: "https://example.org/source" }],
      backend_release_sha256: "b".repeat(64),
      created_at: "2026-07-19T00:00:00.000Z"
    }], {
      runId: "audit-run-001",
      evidenceRef: "retained-postgres-export",
      appVersion: "0.1.0",
      releaseApkSha256: "a".repeat(64),
      backendReleaseSha256: "b".repeat(64),
      modelVersion: "qwen-fixed-pipeline",
      catalogVersion: "2026-07-19-beta.62",
      exportedAt: "2026-07-19T00:01:00.000Z"
    });
    expect(artifact.cards).toHaveLength(1);
    expect(artifact.cards[0].cardSha256).toMatch(/^[a-f0-9]{64}$/);
    const serialized = JSON.stringify(artifact);
    expect(serialized).not.toContain("deviceId");
    expect(serialized).not.toContain("candidateToken");
    expect(serialized).not.toContain("installationId");
    expect(serialized).not.toContain("bearer");
  });

  it("rejects private source URLs and duplicate card IDs", () => {
    const row = {
      id: "00000000-0000-4000-8000-000000000001",
      topic_id: "broom",
      fact_id: "broom-001",
      title: "Title",
      detected_object_name: "扫帚",
      body: "Body",
      personal_context: "Context",
      confidence: 0.9,
      sources: [{ sourceId: "source-one", url: "https://127.0.0.1/source" }],
      backend_release_sha256: "b".repeat(64),
      created_at: "2026-07-19T00:00:00.000Z"
    };
    const metadata = {
      runId: "audit-run-001",
      evidenceRef: "retained-export",
      appVersion: "0.1.0",
      releaseApkSha256: "a".repeat(64),
      backendReleaseSha256: "b".repeat(64),
      modelVersion: "model-fixed",
      catalogVersion: "catalog-fixed",
      exportedAt: "2026-07-19T00:01:00.000Z"
    };
    expect(() => buildCardSnapshotArtifact([row], metadata)).toThrow(/source/i);
    expect(() => buildCardSnapshotArtifact([
      { ...row, sources: [{ sourceId: "source-one", url: "https://example.org/source" }] },
      { ...row, sources: [{ sourceId: "source-one", url: "https://example.org/source" }] }
    ], metadata)).toThrow(/duplicated/i);
    expect(() => buildCardSnapshotArtifact([
      { ...row, backend_release_sha256: "c".repeat(64), sources: [{ sourceId: "source-one", url: "https://example.org/source" }] }
    ], metadata)).toThrow(/different backend Release/);
  });
});
