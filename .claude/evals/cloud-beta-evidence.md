# Real cloud Beta evidence

## Objective

Generate release evidence only from the deployed HTTPS API using Qwen, PostgreSQL and a private OSS
bucket with temporary STS credentials.

## Passing evidence

- Dependency-aware readiness reports Qwen and the pinned catalog through HTTPS.
- An explicitly authorized non-sensitive JPEG is observed in OSS after the authenticated one-time
  upload, completes through Qwen, and disappears immediately after terminal processing.
- A separately authorized sensitive JPEG is submitted with empty client flags, rejected by the
  server-side Qwen privacy result, and also deleted immediately.
- OSS versioning is disabled and an enabled lifecycle rule covers `analysis/` for at most one day.
- Device-data deletion invalidates the bearer.
- The result contains no image bytes, object key, token, installation ID, bucket, credentials or
  database URL; it records only fixture hashes, public origin, versions, checks and a run digest.

## Failing evidence

- HTTP or a non-Qwen readiness mode, catalog drift, missing STS token, object never observed, object
  remaining after terminal processing, client-side-only sensitive rejection, unsafe lifecycle or
  a bearer that remains valid after deletion.
