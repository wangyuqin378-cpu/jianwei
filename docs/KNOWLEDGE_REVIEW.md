# Knowledge review workflow

`reviewStatus: "approved"` alone is not release authority. A fact is publishable in production only
when it also contains a human `review` attestation with reviewer identity, review time, and source
check time. Existing seed facts intentionally have no attestation and are excluded from production.

## Controlled 200-topic backlog

`knowledge/topic-backlog.json` fixes the Beta taxonomy at exactly 200 daily-object topics. Beta.62
contains all 200 in the catalog and has no empty proposals. Rebuild
and verify the generated backlog after changing the catalog or taxonomy source:

```powershell
node scripts\build-topic-backlog.mjs --write
node scripts\build-topic-backlog.mjs
```

Research can be human-led or AI-assisted, but intake must remain a non-publishable draft. The draft
validator requires 3-5 sourced facts, rejects approval/review fields, and requires two authoritative
sources for health or safety claims:

```powershell
node scripts\validate-topic-draft.mjs knowledge\drafts\door_handle.json
```

Structural validation does not establish that a source supports a fact. See
`knowledge/drafts/README.md`; an accountable person must still open every source and use the review
workflow below.

Generate a read-only reviewer queue after each content and source-reachability run. The queue puts
3-5-fact topics first, prioritizes health/safety facts, attaches source URLs and reachability evidence,
binds the exact catalog and fact wording to SHA-256 digests, and separates topics that still need
more facts. It never writes approval or review fields:

```powershell
node scripts\build-knowledge-review-queue.mjs
node scripts\build-knowledge-review-queue.mjs --write
```

The generated JSON and Markdown live under `.tooling/knowledge-review-queue/`. They are operational
work aids, not release evidence; the accountable reviewer must still open every source and complete
a snapshot-pinned decision batch. Direct single-fact catalog mutation is disabled because it could
approve against a stale queue.

Check URL safety and reachability before asking a reviewer to spend time on a batch:

```powershell
node scripts\check-knowledge-sources.mjs --self-test
node scripts\check-knowledge-sources.mjs
node scripts\check-knowledge-sources.mjs --live
node scripts\check-knowledge-sources.mjs --all-live
node scripts\check-knowledge-sources.mjs --live --google-doh
node scripts\check-knowledge-sources.mjs --all-live --google-doh
```

The static gate checks unique public HTTPS URLs, complete metadata, references and orphan sources.
`--live` writes evidence for sources used by `approved` review candidates; `--all-live` also checks
draft-only editorial sources. A 2xx response and suitable content type prove reachability only. They
do not prove that a source supports the fact, and neither command creates a review attestation.

Use `--google-doh` only when a VPN or proxy maps ordinary DNS to the reserved `198.18.0.0/15`
benchmark range and the default resolver therefore fails closed. This mode queries the fixed
`https://dns.google/resolve` endpoint without redirects, verifies that each JSON response binds the
requested hostname and record type, and accepts only A/AAAA answers. The normal public-address
check still rejects private, local, reserved, malformed, or mixed answers; the subsequent HTTPS
request remains pinned to the vetted address while TLS certificate validation and SNI use the
original source hostname. Evidence records `resolver: "google_doh"` so this path cannot be confused
with the system resolver.

Every live run writes a `*-latest-attempt.json` diagnostic. When all sources across multiple hosts
fail for the same DNS or network reason, the command classifies the run as an infrastructure
failure, exits `NO_GO`, and does not replace the last canonical evidence file. The reviewer queue
also refuses evidence marked `infrastructureFailure: true`. Preserve the diagnostic for operators,
then rerun `--all-live` from a network environment that can perform the public-IP safety check.
Never convert a correlated infrastructure failure into hundreds of editorial source failures, and
never use reachability as semantic approval.

Import a structurally valid draft through the guarded intake command instead of editing the catalog
by hand:

```powershell
node scripts\ingest-topic-draft.mjs `
  --draft knowledge\drafts\door_handle.json `
  --write
```

Intake merges aliases and sources, but forces every imported fact to stay `draft`. A new topic draft
contains 3-5 facts. A minimal extension of an existing topic may set `"intakeMode": "extend"` and
contain 2-4 new facts; the merge still rejects any final topic outside the controlled 3-5 range. It
rejects collisions rather than overwriting an existing fact or silently changing source metadata.
For multiple topics, use `scripts/ingest-topic-batch.mjs` and a version-pinned manifest under
`knowledge/batches/`. Run it once without `--write` for a no-mutation preview, verify the sources,
then repeat with `--write`. The batch rejects stale catalog versions and validates all drafts and
cross-draft conflicts before performing one atomic catalog replacement.

If a live source check later finds an unreachable source or a draft claim needs correction, update
the original draft and use `scripts/apply-catalog-draft-correction.mjs` with a manifest under
`knowledge/corrections/`. The manifest pins both the current catalog version and SHA-256. The tool
only replaces topics whose existing facts are still unreviewed drafts, preserves every fact ID,
rejects sources shared by topics outside the correction, removes orphaned sources, validates all
replacement drafts, and performs one atomic catalog replacement. Preview without `--write` first:

```powershell
node scripts\apply-catalog-draft-correction.mjs `
  --manifest knowledge\corrections\2026-07-19-safety-sources-01.json
node scripts\apply-catalog-draft-correction.mjs `
  --manifest knowledge\corrections\2026-07-19-safety-sources-01.json `
  --write
```

The correction path cannot approve, reject, or rewrite an already reviewed fact. Run the full live
source gate and regenerate the review queue after every correction.

## Human review steps

1. Open every referenced source and confirm it directly supports the Chinese fact text.
2. Check that wording does not add unsupported causality, numbers, personal conclusions, diagnosis,
   or absolute safety claims.
3. For `health` and `safety`, require two independent `official` or `professional` sources.
4. Start the local human-review workbench for up to 20 facts. Use an internal identifier that names
   the accountable person, choose a new catalog version, and keep the output directly under the
   controlled batch directory:

```powershell
node scripts\knowledge-review-workbench.mjs --preflight --limit 20
node scripts\knowledge-review-workbench.mjs `
  --reviewer reviewer-name-or-internal-id `
  --next-version 2026-07-19-beta.63 `
  --output .tooling\knowledge-review-batches\beta63-review-01.json `
  --limit 20 `
  --confirm-human-review-session
```

The command listens only on `127.0.0.1` and prints a one-time browser URL. It uses an HttpOnly
same-site session cookie, a separate CSRF token, strict Host/Origin checks, a 128 KiB request limit,
and a restrictive CSP. Every source link opens directly in the browser; the local server does not
fetch or proxy editorial sources and clicking a link never checks its review box. All decisions and
confirmations start empty.

Each save creates a new immutable, SHA-bound local revision. A stale browser tab cannot overwrite a
newer revision. The printed session ID can resume after a browser or process restart. The output
batch is created once only after every decision passes the same validation as the atomic catalog
applicator and the reviewer checks the explicit human checkpoint. The workbench never mutates the
catalog or runs the apply command.

For a manual JSON fallback, create a pending-only template. The generator likewise never preselects
a decision or confirmation:

```powershell
node scripts\create-knowledge-review-batch.mjs `
  --output .tooling\knowledge-review-batches\batch-001.json `
  --write
```

5. In the workbench, or as the accountable human editing the fallback JSON, set each
   `decision` to `approve` or `reject`, list the source IDs actually opened, and record notes.
   Approval requires both `semanticSupportConfirmed` and `unsupportedClaimsChecked`; rejection
   requires at least one checked source and a concrete reason of at least 10 characters.
6. Apply all completed decisions in one atomic catalog replacement:

```powershell
node scripts\apply-knowledge-review-batch.mjs `
  --manifest .tooling\knowledge-review-batches\batch-001.json `
  --reviewer reviewer-name-or-internal-id `
  --confirm-human-review `
  --write
```

The apply command rejects AI/automation reviewer identities, a stale catalog or fact digest, the
placeholder version, unknown/duplicate facts, unchecked sources, pre-existing attestations and
incomplete approval/rejection confirmations. It will not write without explicit human confirmation
and `--write`; replacing an existing attestation additionally requires `--confirm-rereview`.
The whole decision batch is validated before one atomic catalog replacement. It cannot prove that a
person actually read the source; reviewer access controls, version control, review logs and periodic
sampling remain organizational controls.

After every applied batch, rebuild the source evidence and review queue before starting the next
session. A batch pins the exact catalog version, catalog SHA-256, fact wording and source set, so a
batch prepared for an earlier catalog is intentionally rejected rather than rebased automatically.

A rejection is not a dead end and must never be repaired by editing the catalog directly. Generate
a fail-closed template for one or more comma-separated rejected fact IDs, then fill its origin, new
28-80 character fact text, source set and next version. The generator copies the rejected fact's
source context but leaves publishable content blank:

```powershell
node scripts\create-rejected-fact-replacement-batch.mjs `
  --facts rejected-fact-id `
  --batch-id replacement-001 `
  --output knowledge\replacements\replacement-001.json `
  --write
```

Preview and apply the completed, version-controlled manifest:

```powershell
node scripts\apply-rejected-fact-replacements.mjs `
  --manifest knowledge\replacements\batch-001.json
node scripts\apply-rejected-fact-replacements.mjs `
  --manifest knowledge\replacements\batch-001.json `
  --write
```

The command accepts only a human-attested `rejected` target, preserves every other fact, removes
newly orphaned sources, and inserts the replacement as an unreviewed `draft`. It rejects stale
catalog/fact snapshots, source conflicts, fact-ID collisions, forged approval fields and risky facts
without two authoritative sources. Keep the manifest as the audit record, rerun full source checks,
rebuild the queue, and send the new draft through the same accountable-human review flow.

Run `node scripts/check-knowledge-readiness.mjs` after each batch. Production remains `NO_GO` until
the catalog contains exactly the 200 controlled topics, each with 3-5 total facts and every fact is
approved with a valid accountable-human attestation. The gate also rejects taxonomy drift, duplicate
IDs, dangling or unused sources, invalid/future review times, and health/safety facts without two
authoritative sources. Run its adversarial fixture with
`node scripts/check-knowledge-readiness.mjs --self-test`; the synthetic self-test is not release
evidence. Development may set
`ALLOW_UNATTESTED_FACTS=true` only with local object storage; OSS mode refuses to start with this
escape hatch enabled.
