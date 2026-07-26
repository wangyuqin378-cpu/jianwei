import { describe, expect, it } from "vitest";
import { validateJobStatusResponse } from "./job-status-response.js";

const JOB_ID = "00000000-0000-4000-8000-000000000001";
const CANDIDATE_ID = "10000000-0000-4000-8000-000000000001";
const VALID = {
  jobId: JOB_ID,
  candidateToken: CANDIDATE_ID,
  status: "uploaded",
  errorCode: null,
  createdAt: "2026-07-26T00:00:00.000Z",
  updatedAt: "2026-07-26T00:00:01.000Z"
};

describe("cloud job status response", () => {
  it("accepts an exact canonical snapshot", () => {
    expect(validateJobStatusResponse(VALID, JOB_ID)).toEqual(VALID);
  });

  it("rejects crossed, malformed, and ambiguous snapshots", () => {
    for (const body of [
      { ...VALID, jobId: "00000000-0000-4000-8000-000000000002" },
      { ...VALID, candidateToken: "candidate" },
      { ...VALID, status: "done" },
      { ...VALID, errorCode: "contains whitespace" },
      { ...VALID, createdAt: "2026-07-26T00:00:00Z" },
      { ...VALID, updatedAt: "2026-07-25T23:59:59.000Z" },
      { ...VALID, unexpected: true }
    ]) {
      expect(() => validateJobStatusResponse(body, JOB_ID)).toThrow(/job status response/);
    }
  });
});
