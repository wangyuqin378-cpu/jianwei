# Beta cohort evidence provenance

## Objective

Prove that the Beta conversion, engagement, feedback and first-card metrics consumed by the release
gate were derived from the complete retained set of app-exported device reports, not copied or
edited by hand.

## Passing evidence

- Every report uses the exact privacy-minimized `local_beta_device_metrics` schema.
- Report IDs are unique and the manifest covers the same IDs exactly; users cannot be dropped after
  outcomes are known.
- The manifest pins a deterministic SHA-256 of the complete canonical report set and its own exact
  file SHA-256 is retained.
- One app version is used for the cohort.
- Every expanded-cohort report has at least seven days of observation after onboarding.
- At least the manifest-declared gray subset has explicit start and observation timestamps; gray
  days are derived from the shortest observation, never typed by hand.
- Counts, rates and latency samples are compiled from reports and copied into final Beta evidence
  with provenance. Synthetic self-tests state `releaseEvidence=0`.

## Failing evidence

- Missing, duplicate or extra reports or assignments.
- An AI/bot reviewer identity, future timestamps, stale hashes or inconsistent app versions.
- Cherry-picked reports, under-observed users, hand-entered percentages or a manifest not bound to
  the retained raw exports.
