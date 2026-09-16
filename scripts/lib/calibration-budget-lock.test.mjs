import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { acquireCalibrationBudgetLock } from "./calibration-budget-lock.mjs";

test("paid calibration processes cannot share a writable budget ledger concurrently", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "jianwei-calibration-lock-"));
  const file = path.join(directory, "budget.lock");
  try {
    const release = acquireCalibrationBudgetLock(file);
    assert.throws(() => acquireCalibrationBudgetLock(file), { code: "EEXIST" });
    release();
    release();
    const releaseNext = acquireCalibrationBudgetLock(file);
    releaseNext();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
