import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadMigrations } from "./migrations.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("database migrations", () => {
  it("loads immutable, ordered migration files", async () => {
    const migrations = await loadMigrations(path.join(ROOT, "migrations"));

    expect(migrations.map((migration) => migration.id)).toEqual([
      "001_init",
      "002_server_issued_device_tokens",
      "003_suppressed_candidates",
      "004_analysis_job_content_type",
      "005_global_analysis_budget_events",
      "006_analysis_budget_cost_reservations",
      "007_production_hardening",
      "008_upload_leases_and_preferences",
      "009_authorized_evaluation_leases",
      "010_backend_release_identity",
      "011_private_card_deletion_receipts",
      "012_fair_object_deletion_retries",
      "013_card_detected_object_name"
    ]);
    expect(migrations.every((migration) => /^[a-f0-9]{64}$/.test(migration.checksum))).toBe(true);
    expect(migrations.every((migration) => migration.source.trim().endsWith(";"))).toBe(true);
  });
});
