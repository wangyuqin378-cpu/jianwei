# Beta evidence gate

This gate prevents a successful build from being mistaken for a validated Beta. The example file is
schema documentation only. Do not copy fields into the final file by hand. Compile every component,
bind the exact files in an accountable-human assembly manifest, have an independent QA assembly
attestor sign that exact manifest and its eight artifact bindings, let the deterministic assembler
create `evaluation/beta-evidence.json`, and have a third accountable release approver sign its exact
bytes with a different externally held Ed25519 key; then execute:

```powershell
node scripts/check-beta-readiness.mjs evaluation/beta-evidence.json
```

The command exits with code 0 only when every product acceptance threshold is met, both
`evaluation/beta-evidence-assembly.attestation.json` and `evaluation/beta-evidence.attestation.json`
verify against `config/evidence-trust-policy.json`, and that policy's exact SHA-256 equals the
protected external `JIANWEI_EVIDENCE_TRUST_POLICY_SHA256` release-environment variable. The release
CLI resolves the policy from the repository root and rejects `--trust-policy`; the external digest
prevents a repository editor from replacing the public policy and appointing new signers. Run
`node scripts/check-beta-readiness.mjs --self-test` to verify the gate itself without claiming
that real evidence exists. Self-test output explicitly says `synthetic=1 releaseEvidence=0`, and
the normal gate rejects the synthetic evidence kind.

### Authorized image evaluation

Do not hand-type `evaluationSamples` or `image-results.json`. Keep human labels, photos and pipeline
results in an access-controlled evidence directory outside the repository, starting from
`evaluation/image-labels.example.json`. Every sample must have a consent reference and the exact
`authorizationScope: "local_and_cloud_evaluation"`; local-only consent is insufficient because a
local privacy false negative must exercise the real HTTPS/server rejection and deletion path. Use
staged or otherwise explicitly authorized fixtures, never ordinary private photos whose consent
does not cover cloud evaluation.

The controlled directory must contain exactly:

```text
authorized-dataset/
  image-labels.json
  image-evaluation-run.json
  image-evaluation-lease.json  # short-lived bearer; never commit or attach as evidence
  images/
    300-500 authorized image files
```

Filenames are not trusted and never enter release evidence. The Android runner maps every file to
the human label by exact image SHA-256 and carries only sample ID/hash into the pipeline, so the
ground-truth sensitive class or topic cannot influence the local upload decision. First build the
exact Debug APK that will be installed, then create the pending run manifest. This command reads
the labels and hashes that APK, but reads no photo bytes:

```powershell
node scripts\create-image-evaluation-run.mjs `
  --labels C:\controlled-evidence\authorized-dataset\image-labels.json `
  --run-id beta17-image-run-001 `
  --evidence-ref controlled://image-evaluation/results-001 `
  --app-version 0.1.0-beta17 `
  --apk android\app\build\outputs\apk\debug\app-debug.apk `
  --model-version <fixed-qwen-pipeline-version> `
  --catalog-version 2026-07-19-beta.62 `
  --output C:\controlled-evidence\authorized-dataset\image-evaluation-run.json `
  --write
```

The normal anonymous-device budget is intentionally too small for a 300-500 image evidence run.
Do not raise the normal production limits. After migration `009_authorized_evaluation_leases` is
deployed, an accountable backend operator must issue one database-backed lease against the exact
label bytes and run manifest. `DATABASE_URL` must already be present in the operator environment;
never put it or the returned bearer on the command line:

```powershell
cd backend
pnpm migrate
pnpm issue:evaluation-lease -- `
  --labels C:\controlled-evidence\authorized-dataset\image-labels.json `
  --run-manifest C:\controlled-evidence\authorized-dataset\image-evaluation-run.json `
  --out C:\controlled-evidence\authorized-dataset\image-evaluation-lease.json `
  --ttl-hours 72
cd ..
```

The command prints only the lease ID, limit, expiry and output path. The file contains the bearer,
must remain in the access-controlled directory, and is gitignored. The database stores only its
SHA-256 plus the 300-500 allowed sample IDs and deterministic candidate IDs. The first accepted
sample binds the lease to one anonymous device. Lease-authorized jobs are excluded from that
device's ordinary daily/monthly counters, including future ordinary requests; the ordinary limits
are not raised. The global count and model-cost fuses still apply. It expires in at most seven
days, rejects unlisted/replayed-conflicting samples and can be revoked immediately.

Install the exact Debug APK hashed into the manifest, with `jianwei.apiUrl` set to the real public
HTTPS Beta endpoint. The evaluation Activity/Worker and lease header exist only in the Debug source
set and are excluded from the formal APK. The host launcher hashes the installed base APK and
refuses a manifest/build mismatch; the app repeats that check before starting and before emitting
the final result. Connect exactly one physical device, stage the controlled directory and complete
the on-device human checkpoint:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\run-authorized-image-evaluation-windows.ps1 `
  -RunId beta17-image-run-001 `
  -DatasetDirectory C:\controlled-evidence\authorized-dataset
```

The screen shows dataset/model/catalog metadata and explains that a local false negative can upload
an authorized sensitive fixture. An accountable human enters their reviewer ID and explicitly
confirms the authorization, physical device and production endpoint. WorkManager then processes one
sample per durable job with the production ML Kit, sanitizer, exact-upload-byte privacy recheck and
real cloud client. Progress is stored in private app storage, inputs are rehashed before use and at
completion, and no result is emitted until all samples finish. `leftDevice` records the production
egress decision: a sensitive ground-truth image that passes the local gates counts as a leak even if
the server later rejects and deletes it.

After the device reports completion, pull the exclusively created result back to the controlled
store:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\run-authorized-image-evaluation-windows.ps1 `
  -RunId beta17-image-run-001 `
  -Collect `
  -OutputPath C:\controlled-evidence\authorized-dataset\image-results.json `
  -PurgeDeviceCopy
```

Revoke the lease immediately after the exclusive result pull, or at once if the run is abandoned:

```powershell
cd backend
pnpm revoke:evaluation-lease -- --lease-id <lease-id-printed-at-issuance>
cd ..
```

Deleting the bound device's server data also revokes the lease. The result and compiled evidence
never contain the bearer, token hash, lease ID, installation identity or candidate token.

Compile the independent label and Android-runner artifacts only after the complete 300–500 image
run:

```powershell
node scripts\compile-image-evaluation.mjs `
  --labels evaluation\image-labels.json `
  --results evaluation\image-results.json
node scripts\compile-image-evaluation.mjs `
  --labels evaluation\image-labels.json `
  --results evaluation\image-results.json `
  --output evaluation\compiled-image-evaluation.json `
  --write
```

The first command is a no-write preview. The compiler rejects unmatched or duplicate images,
incomplete runs, local-only consent, stale catalog versions, unknown topics, AI/automation labelers
or runner reviewers, emulator fingerprints, non-public/non-HTTPS endpoints, missing privacy classes
and weak recognition-topic coverage. The final gate also requires the runner endpoint origin to be
the same origin proven by the real cloud verification artifact. Retain the photos, labels, run
manifest and raw result outside
the repository. The final assembler consumes the compiled artifact directly; do not copy
`evaluationProvenance` or `evaluationSamples` manually. `-PurgeDeviceCopy` is accepted only after an
exclusive result pull whose evidence kind/run ID match; it then removes the staged images and
private progress. Omit the switch only when the controlled evidence process requires a temporary
device-side retention, and purge or uninstall the Debug APK immediately after that checkpoint.

### Generated-card automatic verification

Do not hand-type `cardAudits`. Export 200-500 redacted generated-card snapshots from the real
PostgreSQL deployment. The exporter selects no device ID, candidate token, installation ID, bearer,
photo or local media identifier:

```powershell
cd backend
pnpm export:card-audit -- `
  --run-id beta-card-audit-001 `
  --evidence-ref retained://beta/card-snapshots-001 `
  --release-artifact ..\evaluation\release-artifact.json `
  --cloud-artifact ..\evaluation\cloud-beta-compiled.json `
  --limit 200 `
  --output C:\controlled-evidence\card-snapshots.json `
  --write
cd ..
```

`DATABASE_URL` must point to the accountable evidence-source database. Run the real cloud verifier
described below before this export. The exporter derives the app version and Release APK SHA-256
from the formally verified release artifact, and derives model/catalog/backend Release identity
from the verified cloud artifact; it does not accept those values as manual claims. Migration 010
stamps every newly generated PostgreSQL card with the running backend Release SHA-256. The exporter
rejects old unstamped rows or cards created by any other backend build. Keep the snapshot outside
the repository because it contains card text and a coarse personal context, even though it contains
no photo or device identity.
Compile the retained snapshots directly against the pinned catalog:

```powershell
node scripts\compile-card-audit.mjs `
  --snapshots C:\controlled-evidence\card-snapshots.json
node scripts\compile-card-audit.mjs `
  --snapshots C:\controlled-evidence\card-snapshots.json `
  --output evaluation\compiled-card-audit.json `
  --write
```

The compiler binds every row by canonical card SHA-256 and recomputes the complete published-card
contract: the fact must be a general fact approved by the fixed Qwen review policy, the body and
source set must exactly equal that pinned catalog fact, and the title plus personal context must
equal the deterministic server presentation policy for the recorded confidence. Any mismatch stays
as a negative result and the final gate rejects the whole artifact. This is a full automatic audit of
the sampled production cards, not a second model rewrite and not a hand-filled approval queue. The
optional `create-card-audit-template.mjs` remains available for product-quality investigations but
does not grant release authority. Retain the snapshot artifact in the controlled evidence store.

## Physical OEM device runs

Do not type `deviceRuns` into the final assembly manifest. For each Huawei, Xiaomi and OPPO or vivo
device, export the app's local Beta report after the observation period and retain one evidence
bundle containing the redacted test log, screenshots or screen recording, background-delivery
record, seven-day offline-widget observation and deletion result. Keep those bundles outside the
repository. Generate one pending manifest for the complete OEM matrix:

```powershell
node scripts\create-physical-device-run-manifest.mjs `
  --run-set-id beta17-oem-matrix `
  --run reports\huawei.json C:\controlled-evidence\huawei-run.zip `
  --run reports\xiaomi.json C:\controlled-evidence\xiaomi-run.zip `
  --run reports\oppo.json C:\controlled-evidence\oppo-run.zip `
  --output evaluation\physical-device-run-manifest.json `
  --write
```

The generator derives the evidence ID, manufacturer, model, API level, build fingerprint and App
version from the app export. It SHA-256 binds both the report and evidence bundle, rejects reused
bundles, emulator-like fingerprints, mixed App versions and an incomplete OEM matrix, and starts
every permission/check/timestamp field empty or false.

An accountable human fills each run's retained `evidenceRef`, `permissionMode`, observation times
and explicit confirmations. `widgetObservedFrom` to `widgetObservedThrough` must cover seven full
days; `testedAt` and the app report export follow that observation. Compile using the exact same
complete file pairs:

```powershell
node scripts\compile-physical-device-runs.mjs `
  --manifest evaluation\physical-device-run-manifest.json `
  --run reports\huawei.json C:\controlled-evidence\huawei-run.zip `
  --run reports\xiaomi.json C:\controlled-evidence\xiaomi-run.zip `
  --run reports\oppo.json C:\controlled-evidence\oppo-run.zip

node scripts\compile-physical-device-runs.mjs `
  --manifest evaluation\physical-device-run-manifest.json `
  --run reports\huawei.json C:\controlled-evidence\huawei-run.zip `
  --run reports\xiaomi.json C:\controlled-evidence\xiaomi-run.zip `
  --run reports\oppo.json C:\controlled-evidence\oppo-run.zip `
  --write
```

The compiler requires Huawei, Xiaomi and OPPO or vivo, collectively covers Android 14+ `FULL`,
`PARTIAL` and `DENIED`, derives every final device identity field from the SHA-bound app reports,
and produces `compiled-physical-device-runs.json`. The final assembler consumes only this compiled
artifact; it has no direct device-claim input.

## Human zh-CN TalkBack audit

Automated focus traversal cannot satisfy the release gate. On one physical device already included
in the OEM matrix, an accountable human must enable TalkBack in `zh-CN`, listen to the spoken
output, complete the user task, and verify that the onboarding upload disclosure, share consent and
Privacy Center controls are understandable. Retain a redacted screen recording or equivalent audit
bundle outside the repository. Use the exact app-export report and evidence ID from that physical
device run to create a pending-only manifest:

```powershell
node scripts\create-accessibility-audit-manifest.mjs `
  --audit-id beta17-talkback-001 `
  --report reports\huawei.json `
  --evidence C:\controlled-evidence\huawei-talkback-audit.zip `
  --output evaluation\accessibility-audit-manifest.json `
  --write
```

The generated manifest preconfirms nothing. The human reviewer fills `reviewerId`, keeps `locale` as
`zh-CN`, explicitly confirms the TalkBack, spoken-output, task-completion and three disclosure
checks, records `auditedAt` and a redacted `evidenceRef`, then sets `humanConfirmed: true` and
`confirmedAt`. Compile with the exact same report and retained bundle, previewing before the
exclusive write:

```powershell
node scripts\compile-accessibility-audit.mjs `
  --manifest evaluation\accessibility-audit-manifest.json `
  --report reports\huawei.json `
  --evidence C:\controlled-evidence\huawei-talkback-audit.zip

node scripts\compile-accessibility-audit.mjs `
  --manifest evaluation\accessibility-audit-manifest.json `
  --report reports\huawei.json `
  --evidence C:\controlled-evidence\huawei-talkback-audit.zip `
  --output evaluation\compiled-accessibility-audit.json `
  --write
```

The compiler SHA-256 binds the report, retained evidence and reviewed manifest; rejects AI/bot
reviewers, emulator fingerprints and preconfirmed or incomplete audits; and derives the device and
App identity from the app report. During final assembly, the compiled audit must match the same
`runId`, manufacturer, model, build fingerprint, API level and App version in
`compiled-physical-device-runs.json`.

## Deterministic final assembly

Do not assemble the final Beta file until all eight compiler/verifier/attestor outputs exist:

- `compiled-image-evaluation.json`
- `compiled-card-audit.json`
- `beta-cohort-compiled.json`
- `cloud-beta-compiled.json`
- `release-artifact.json`
- `compiled-physical-device-runs.json`
- `compiled-accessibility-audit.json`
- `deployment-receipt.json`

Create a pending-only manifest that SHA-256 binds the exact bytes of all eight files, including the
unaltered signed deployment receipt. The same manifest also binds the exact bytes of
`knowledge/catalog.json`, `knowledge/topic-backlog.json`, and the domain-separated digest of the
optional protected human-correction reviewer allowlist. For the default AI-only flow the allowlist
is empty and its empty-set digest is still bound; do not derive reviewer identities from catalog
contents:

```powershell
node scripts\create-beta-evidence-assembly-manifest.mjs
node scripts\create-beta-evidence-assembly-manifest.mjs `
  --output evaluation\beta-evidence-assembly-manifest.json `
  --write
```

The first command is a no-write preview. The generated manifest contains no owner, approval, direct
device claim or direct accessibility claim. Physical runs and TalkBack conclusions come only from
their separately compiled artifacts. An accountable human sets the manifest owner,
`assemblyApproved: true` and `approvedAt` only after comparing all eight artifacts with the
retained evidence and checking that the two knowledge-file digests and reviewer-policy digest match
the protected release inputs. Do not add paths, credentials, device tokens, installation IDs, photo
identifiers or OSS object keys.

The final readiness command does not trust the release signature or its own reassembly alone. It reloads this approved
manifest and all eight fixed-path artifacts, re-verifies every SHA binding and the deployment
attestor signature, verifies an independent assembly-attestor signature over the exact manifest and
all eight artifact digests, deterministically rebuilds schema v3 evidence at the recorded generation
time, rehashes the exact catalog/backlog bytes and protected reviewer policy, and requires an exact
semantic match with the release-approver-signed file. Skipping the
assembler or possessing only one of the three keys therefore cannot produce `GO`.

Preview the exact final assembly, write it once, then sign the exact output only after an accountable
human reviews all eight retained artifacts. Copy `config/evidence-trust-policy.example.json` to
`config/evidence-trust-policy.json`, replace all three placeholders with the release approver's,
independent QA assembly attestor's, and independent deployment pipeline's Ed25519 public keys, and
commit that public policy before evidence collection. An independent protected release environment
must pin the exact policy SHA-256 in `JIANWEI_EVIDENCE_TRUST_POLICY_SHA256`; do not derive or replace
that variable inside the repository's release job. Every issuer must hold exactly one role, and the
three roles must use different issuer IDs, key IDs, and SPKI public-key fingerprints:
`beta_assembly_attestor` signs the manifest plus all eight artifact bindings,
`beta_deployment_attestor` signs only a platform-observed deployment receipt, and
`beta_release_approver` signs the final deterministic evidence. The matching private keys must stay
in access-controlled storage outside this repository and must never be copied into CI logs or project
files.

```powershell
$env:JIANWEI_EVIDENCE_TRUST_POLICY_SHA256 = "<protected-policy-sha256>"
node scripts\sign-beta-evidence-assembly.mjs `
  --issuer-id <independent-qa-assembly-id> `
  --key-id <assembly-policy-key-id> `
  --private-key C:\controlled-evidence\beta-assembly.private.pem `
  --confirm-reviewed
node scripts\sign-beta-evidence-assembly.mjs `
  --issuer-id <independent-qa-assembly-id> `
  --key-id <assembly-policy-key-id> `
  --private-key C:\controlled-evidence\beta-assembly.private.pem `
  --confirm-reviewed `
  --write
node scripts\assemble-beta-evidence.mjs
node scripts\assemble-beta-evidence.mjs --write
node scripts\sign-beta-evidence.mjs `
  --issuer-id <accountable-human-id> `
  --key-id <policy-key-id> `
  --private-key C:\controlled-evidence\beta-release.private.pem `
  --confirm-reviewed
node scripts\sign-beta-evidence.mjs `
  --issuer-id <accountable-human-id> `
  --key-id <policy-key-id> `
  --private-key C:\controlled-evidence\beta-release.private.pem `
  --confirm-reviewed `
  --write
node scripts\check-beta-readiness.mjs evaluation\beta-evidence.json
```

The assembly signer and assembler reparse each SHA-bound file and reject a split between parsed values and bound bytes,
recomputes the canonical verified-cloud run digest, rejects mixed App/model/catalog versions, runs
the current 200-topic knowledge-readiness gate, and executes the complete content gate in memory.
The assembler reports `READY_FOR_ATTESTATION`, never final `GO`; output uses exclusive creation and
cannot replace an existing evidence file. Both signers also use exclusive creation. The final gate
rejects unsigned evidence, a missing assembly signature, an unknown or inactive issuer, a non-Ed25519
key, an externally unpinned policy, any issuer/key/public-key reuse across the three roles, a policy,
manifest, artifact or evidence byte change, a signature from the wrong key, and attestations older
than seven days. It also re-verifies the deployment receipt against the actual final-check clock, so
an old evidence `generatedAt` cannot make an expired receipt appear fresh. The assembly manifest,
both attestations and every raw component remain the audit trail. Synthetic self-tests always report
`releaseEvidence=0` and cannot create a passing real file.

## Evidence records

### Local device metrics

Each tester opens Privacy Center and explicitly chooses **导出内测报告**. The JSON contains only
counts, timestamps, app version, manufacturer/model, API level and the non-unique Android build
fingerprint needed to identify the tested ROM. It contains no photo, label, location, MediaStore ID,
installation identity or device bearer and is never uploaded automatically.

Validate the exports, then generate a manifest that binds the complete report set. The manifest
starts with no owner, evidence references or cohort dates preconfirmed:

```powershell
node scripts/summarize-beta-device-metrics.mjs reports\device-01.json reports\device-02.json
node scripts/create-beta-cohort-manifest.mjs `
  --report-set-id beta17-controlled-cohort `
  --output evaluation\beta-cohort-manifest.json `
  --write `
  reports\device-01.json reports\device-02.json
```

An accountable human fills the owner, controlled evidence references, `measuredAt`, and each
assignment's expanded observation dates. The first gray users also receive gray start/end dates;
non-gray assignments keep both gray fields `null`. Compile only after every expanded user has seven
full days of observation:

```powershell
node scripts/compile-beta-cohort.mjs `
  --manifest evaluation\beta-cohort-manifest.json `
  reports\device-01.json reports\device-02.json
node scripts/compile-beta-cohort.mjs `
  --manifest evaluation\beta-cohort-manifest.json `
  --output evaluation\beta-cohort-compiled.json `
  --write `
  reports\device-01.json reports\device-02.json
```

The final assembler consumes `betaProvenance` and `beta` directly. Keep the original
exports and signed-off manifest in the access-controlled evidence store, not this repository. The
compiler binds the complete canonical report set and exact manifest by SHA-256, rejects missing or
extra assignments, AI/bot owners, inconsistent app versions and under-observed users, and derives
`grayUsers`, `grayDays`, `expandedUsers` and every product metric instead of accepting hand-entered
totals.

- Top-level metadata: the assembler sets `schemaVersion` to `3`, `evidenceKind` to
  `real_beta_evidence`, binds the approved eight-artifact manifest in `assemblyProvenance`, and names an
  accountable human `evidenceOwner`, and record a non-future ISO `generatedAt`. The example uses
  `template` deliberately and cannot pass. The top-level schema is exact. Unknown fields and any
  nested credential, bearer, installation/candidate identifier, OSS object key/Bucket, image bytes,
  photo/file path, local user path or credential-looking value fail closed.
- `evaluationProvenance`: dataset/run identity, app/model/catalog versions, retained label/result
  evidence references, SHA-256 for both raw artifacts, and the compiled Android-runner record with
  accountable reviewer, approval time, physical device identity/API level and public HTTPS origin.
- `evaluationSamples`: 300-500 compiled authorized image records. Every row has a unique image
  SHA-256, human labeler and timestamps, `authorizationScope: "local_and_cloud_evaluation"`,
  `expectedSensitiveTypes`, `expectedTopicId`, a completed pipeline outcome, `leftDevice`, and
  `predictedTopicId`. At least 100 sensitive samples must cover
  all eight supported privacy classes with five examples each. At least 100 recognition samples
  must span 25 catalog topics with three examples per topic. A missing prediction counts as wrong;
  an incomplete run cannot count as a safe local rejection.
- `cardAuditProvenance`: run identity, automatic policy version, app/model/catalog versions, retained
  PostgreSQL snapshot reference and SHA-256, the formal Release APK and the exact backend Release
  that created every sampled card.
- `cardAudits`: at least 200 automatically compiled card checks. Each row is bound to a generated-card
  digest and the approved Qwen catalog-review evidence, then records exact fact-body/source binding,
  deterministic title policy, deterministic personal context and the complete automatic result.
  Health/safety facts cannot enter this first-release pool.
- `deviceRuns`: generated only by the physical-device compiler from SHA-bound app reports and
  retained evidence bundles. Huawei, Xiaomi, and OPPO or vivo Android 14+ runs collectively cover `FULL`,
  `PARTIAL`, and `DENIED`, plus background execution, seven offline widget days, and deletion. Every
  row requires a unique `runId`, `physicalDevice: true`, model, build fingerprint, test time and
  redacted evidence reference plus the exact tested `appVersion` and installed base-APK SHA-256;
  emulator records cannot satisfy this gate.
- `betaProvenance`: compiled report-set identity, retained report/manifest references, both SHA-256
  bindings, report count, app version and compile time.
- `beta`: compiler-derived cohort counts and first-card latency samples. Do not hand-enter totals or
  percentages; the final gate calculates rates and requires the denominator to equal the bound
  report count.
- `cloud`: evidence from the real Qwen and OSS deployment, including safety behavior, immediate
  deletion, lifecycle fallback, and device-data deletion. Set `realDeployment: true` only for the
  live stack and record `verifiedAt` plus a redacted `evidenceRef`; pin the exact `appVersion`,
  `modelVersion`, `catalogVersion`, backend Release SHA-256 and the actual deployed OCI image
  digest obtained independently from the registry/deployment record.

  Run the controlled verifier with two separately authorized, metadata-free JPEG fixtures. The
  sensitive fixture is intentionally uploaded with empty client flags to test the server-side Qwen
  privacy gate. Set temporary OSS STS credentials only in the current process environment; never
  place them in arguments or evidence:

  ```powershell
  cd backend
  pnpm verify:cloud-beta -- `
    --base-url https://beta.example.cn/ `
    --safe-fixture C:\controlled-evidence\authorized-safe.jpg `
    --sensitive-fixture C:\controlled-evidence\authorized-face.jpg `
    --expected-sensitive-type face `
    --run-id cloud-beta-001 `
    --evidence-ref controlled://cloud/cloud-beta-001 `
    --release-artifact ..\evaluation\release-artifact.json `
    --deployment-receipt C:\controlled-evidence\fc-deployment-receipt.json `
    --model-version <fixed-qwen-pipeline-version> `
    --catalog-version 2026-07-19-beta.62 `
    --output ..\evaluation\cloud-beta-compiled.json `
    --confirm-authorized-fixtures `
    --write
  cd ..
  ```

The deployment image generates `release-identity.json` during its Docker build by hashing the
  deployable backend source, the exact Dockerfile, ordered SQL migrations, dependency lock/config
  files and exact knowledge catalog. Production refuses to start without this immutable file, `/health/ready`
  exposes its digest, and the verifier independently recomputes the expected digest from the local
  candidate source. Environment variables cannot supply or override this identity. Production also
  requires `CONTAINER_IMAGE_DIGEST`; readiness exposes it. Before deployment,
  `check-container-deployment-inputs.mjs` rejects a mutable image tag, an unpinned Node base image,
  or a digest declaration that differs from the `JIANWEI_IMAGE` `@sha256:` suffix.

Environment-variable equality is not release evidence. An independent deployment pipeline must
  read the actual Function Compute revision, endpoint, ACR manifest digest and embedded backend
  Release SHA-256 from the platform, then emit and Ed25519-sign the exact
  `config/deployment-receipt.example.json` contract using a policy key whose only required role is
  `beta_deployment_attestor`. The cloud verifier uses the repository-pinned policy to verify that
  receipt, rejects receipts older than seven days, and requires its endpoint, backend identity and
  OCI digest to match the tested deployment. A human-typed digest or the service's own environment
  variable cannot substitute for this receipt.

The verifier requires HTTPS/Qwen readiness and an exact backend Release digest match, observes both objects after authenticated upload,
  proves immediate deletion after terminal processing, verifies disabled OSS versioning and the
  one-day lifecycle rule, and proves device deletion invalidates the bearer. Its output retains
  hashes and public version metadata only—never photos, object keys, bearer, installation ID,
  bucket, credentials or database URL. App version and Release APK SHA-256 are derived from the
  formal release artifact. The final assembler does not trust those self-reported summaries: it
  reloads the repository-pinned policy, cryptographically verifies the exact eighth-artifact receipt
  bytes, and cross-checks receipt SHA-256, policy SHA-256, issuer, key, endpoint, deployment revision,
  OCI image digest and backend Release identity against the canonical cloud run before consuming
  `cloudProvenance` and `cloud`.
- `releaseArtifact`: generate this object with `scripts/verify-release-apk-windows.ps1`. The verifier
  requires one v2 signer, matches its certificate SHA-256 to the separately pinned release
  fingerprint, rejects Android Debug/test-only identities, checks package `cn.jianwei.app`, minSdk 26
  and targetSdk 36, and binds the APK SHA-256. Test-signed R8 smoke APKs cannot satisfy this field.

  ```powershell
  powershell -NoProfile -ExecutionPolicy RemoteSigned -File scripts\verify-release-apk-windows.ps1 `
    -ApkPath <formal-release.apk> `
    -ExpectedSignerSha256 <pinned-public-certificate-sha256> `
    -EvidenceRef <redacted-evidence-reference> `
    -OutputPath evaluation\release-artifact.json `
    -Write
  ```

  Pin the public certificate fingerprint in the controlled release record before running this
  command. Do not put the keystore path or password in the evidence file or shell history.
- `accessibilityAudit`: generated only by the accessibility compiler from a SHA-bound app report,
  retained audit bundle and pending-only human manifest. An accountable human must listen to the
  real TalkBack output on a physical device in `zh-CN`, finish the flow, and confirm that onboarding
  upload disclosure, share consent and Privacy Center controls are understandable. The compiler
  derives the App/device identity, and the final assembler cross-binds it to the same compiled OEM
  run. Automated focus traversal remains reference evidence only and cannot set these booleans.

The final gate requires the same app version across image evaluation, card audit, cohort, cloud,
every physical-device run, TalkBack audit and the signed APK. Card audit, cloud verification,
cohort, every OEM run and TalkBack must also carry the exact same SHA-256 as the formally verified
Release APK. The authorized image runner is separately bound end to end to the exact installed
Debug APK because that controlled runner cannot exist in Release. The gate also requires one model
version across image/card/cloud evidence and one catalog version across image/card/cloud evidence;
card audit and cloud evidence must also use the same exact backend Release SHA-256. Evidence from
different mobile or backend builds cannot be combined into a release claim.

The example intentionally returns `NO_GO`. Never replace missing external evidence with generated
or synthetic values. The self-test fixture only tests gate logic and is not release evidence.
