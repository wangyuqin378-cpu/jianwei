# Card audit evidence hardening

## Capability evals

1. A generated-card snapshot artifact and an independently completed human-audit artifact can be
   compiled into the `cardAuditProvenance` and `cardAudits` fields consumed by the Beta gate.
2. Every compiled row is bound to a real snapshot by `cardId` and a canonical card SHA-256.
3. The compiler derives fact risk, whitelist state and authoritative-source count from the pinned
   knowledge catalog instead of trusting hand-entered audit metadata.
4. The compiler preserves negative quality outcomes so the Beta gate can block them; it never turns
   a failed audit into a structurally invalid file that operators are tempted to omit.
5. A production-operations exporter can read PostgreSQL cards without exporting device IDs,
   candidate tokens, photos, installation IDs or bearer credentials.

## Regression evals

1. Existing image-evaluation provenance and thresholds remain unchanged.
2. The Beta gate still rejects synthetic evidence as release evidence.
3. The Beta gate rejects card audit rows without provenance, with duplicate IDs/digests, with stale
   catalog version, with unmatched catalog facts, or with incomplete source checks.
4. Existing backend type checks, unit tests, TCP E2E, knowledge gates and source guardrails pass.

## Adversarial fixtures

- Missing audit row.
- Card snapshot digest mismatch.
- Automated reviewer identity.
- Stale catalog version.
- Duplicate card ID.
- Audit that omits a referenced source.
- Snapshot whose body or sources differ from the pinned catalog.

## Success metrics

- Compiler self-test rejects all seven bypass classes.
- Beta gate self-test rejects at least one provenance bypass and all prior bypass fixtures.
- Compiler and Beta gate pass three consecutive self-test runs (`pass^3 = 100%`).
- Real release evidence remains `NO_GO` until actual PostgreSQL snapshots and human audit files are
  supplied; synthetic fixtures explicitly report `releaseEvidence=0`.
