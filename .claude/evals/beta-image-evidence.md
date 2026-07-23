# EVAL: beta-image-evidence

## Capability evals

- A 300–500 image dataset with matched human labels and pipeline results compiles into a
  digest-bound evaluation artifact.
- Every sample is authorized, uniquely identified by image SHA-256, labeled by an accountable
  human, and has a completed pipeline result.
- The dataset contains at least 100 sensitive images, covers every supported sensitive class,
  and contains at least 100 recognition images across at least 25 catalog topics.
- Sensitive leak rate uses `leftDevice`, while Top-1 counts a missing prediction as incorrect.

## Adversarial evals

- Reject a missing or extra result, duplicate image bytes, an incomplete pipeline result, an AI
  labeler identity, a stale catalog version, an unknown topic, or a sample hash mismatch.
- The Beta gate must reject the old `uploaded=false` shortcut when the pipeline never completed.
- The Beta gate must reject a recognition set concentrated in fewer than 25 topics.
- The Beta gate must reject a sensitive set that omits any supported privacy class.
- Synthetic fixtures must remain ineligible for release evidence.

## Regression evals

- `compile-image-evaluation.mjs --self-test` passes three consecutive runs.
- `check-beta-readiness.mjs --self-test` passes three consecutive runs.
- Backend tests, TypeScript compilation, source guardrails and memory TCP E2E remain green.

## Human review required

Real authorization records, image labels, sensitive-class adjudication and retained redacted
evidence must be supplied by accountable humans. No automated fixture can satisfy the release gate.
