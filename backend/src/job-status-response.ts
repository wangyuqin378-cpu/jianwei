const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ERROR_CODE_PATTERN = /^[A-Za-z0-9._:-]{1,120}$/;
const JOB_STATUSES = new Set([
  "awaiting_upload", "uploading", "uploaded", "processing",
  "completed", "needs_content", "rejected", "failed"
]);
const FIELDS = ["candidateToken", "createdAt", "errorCode", "jobId", "status", "updatedAt"];

export interface ValidatedJobStatusResponse {
  jobId: string;
  candidateToken: string;
  status: string;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export function validateJobStatusResponse(
  body: unknown,
  expectedJobId: string
): ValidatedJobStatusResponse {
  if (!isRecord(body) || Object.keys(body).sort().join("\0") !== FIELDS.join("\0")) {
    throw new Error("Cloud job status response has an invalid field set");
  }
  const { jobId, candidateToken, status, errorCode, createdAt, updatedAt } = body;
  if (
    typeof jobId !== "string" || !UUID_PATTERN.test(jobId) || jobId !== expectedJobId ||
    typeof candidateToken !== "string" || !UUID_PATTERN.test(candidateToken) ||
    typeof status !== "string" || !JOB_STATUSES.has(status) ||
    !(errorCode === null || (typeof errorCode === "string" && ERROR_CODE_PATTERN.test(errorCode))) ||
    typeof createdAt !== "string" || !isCanonicalIsoInstant(createdAt) ||
    typeof updatedAt !== "string" || !isCanonicalIsoInstant(updatedAt) ||
    updatedAt < createdAt
  ) {
    throw new Error("Cloud job status response is invalid or crossed the job boundary");
  }
  return { jobId, candidateToken, status, errorCode, createdAt, updatedAt };
}

function isCanonicalIsoInstant(value: string): boolean {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
