import { closeSync, openSync, unlinkSync } from "node:fs";

// Separate experiments sharing a paid-call ledger must not overwrite each
// other's reservations. Never reclaim a stale lock automatically: an in-flight
// request may still be billable even if its parent appears unresponsive.
export function acquireCalibrationBudgetLock(file) {
  const descriptor = openSync(file, "wx", 0o600);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    closeSync(descriptor);
    unlinkSync(file);
  };
}
