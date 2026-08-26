# Production deployment

The iOS TestFlight target is an Alibaba Cloud Function Compute 3 custom-runtime code package
connected to RDS PostgreSQL, a private OSS bucket and fixed-version Qwen models. This avoids a paid
container registry during the small Beta while preserving an immutable package digest. The checked-
in custom-container path remains available for a later production rollout. Local/in-memory mode is a
developer fallback and is never release evidence.

## iOS installable Beta gate

The local WidgetKit candidate is not an installable Beta until one check binds the current source,
tests, unsigned Release build, Apple signing identity, physical device, production API origin and
signed archive. Run the policy self-test in CI or after changing the checker:

```bash
node scripts/check-ios-beta-readiness.mjs --self-test
```

After the Apple Developer team and public API are available, build a signed archive with the same
team and origin, then run the real gate. Keep the values in the operator environment rather than
committing them to `project.yml`:

```bash
export JIANWEI_IOS_DEVELOPMENT_TEAM="<10-character-team-id>"
export JIANWEI_API_BASE_URL="https://<production-api-origin>"
node scripts/check-ios-beta-readiness.mjs \
  --archive .tooling/ios-beta/Jianwei.xcarchive
```

`GO` requires at least nine current iOS tests with no failures or skips, the current generic Release
build with a validated privacy manifest, matching App/Widget bundle IDs and App Group, a valid
signing identity, a connected physical iPhone or iPad, valid signatures on both archived bundles,
App Store distribution provisioning profiles for both the App and Widget, a validated privacy
manifest in the archived App, and the public HTTPS origin embedded in the archived App.
Seven-day personal-development, device-bound development, Ad Hoc and enterprise profiles are not
TestFlight evidence. The report emits only booleans, counts and blocker names; it never emits the
Team ID, API origin, signing certificate name or provisioning profile contents.

### StoreKit subscription gate

`ios/StoreKit/Jianwei.storekit` is a local-only configuration for the monthly product
`cn.jianwei.ios.pro.monthly`, priced at ¥8 with a seven-day free trial. It is included in Debug test
bundles and explicitly excluded from Release. Before TestFlight, create the same product and offer in
App Store Connect, then run `SubscriptionStoreTests` from the Xcode IDE to prove product loading,
purchase, entitlement JWS and restore. The iOS 26.5 simulator currently has an Apple-reported
`xcodebuild` regression that fails to synchronize local StoreKit configurations with
`SKInternalErrorDomain Code=3`; a CLI skip is not purchase evidence.

## Cloud prerequisites

1. Put RDS PostgreSQL, Function Compute and OSS in the same region and VPC where possible.
2. Create a private OSS bucket whose versioning has never been enabled and with an enabled lifecycle
   rule that deletes `analysis/` objects in one day or less. The API verifies both settings on startup
   and readiness checks. `Enabled` and `Suspended` versioning are rejected because suspended buckets
   can retain historical non-null object versions.
3. Give the Function Compute execution role only the OSS versioning/lifecycle-read and object
   read/write/delete permissions for that bucket and prefix. Function Compute injects a complete
   temporary STS credential set (`accessKeyId`, `accessKeySecret`, and `securityToken`) for each
   instance; production refuses AK-only credentials. Do not put long-lived OSS access keys in the
   image, repository, or deployment manifest.
4. For TestFlight, use the HTTPS Function Compute trigger URL as `JIANWEI_PUBLIC_BASE_URL`. Before an
   App Store production release, replace it with a filed custom domain and HTTPS certificate. Keep
   the platform HTTP trigger anonymous because the API enforces its own server-issued device bearer
   on every private route.
5. Store the database URL and DashScope key in the deployment environment or KMS-backed secret
   workflow. `deploy/s.code-package.yaml` and `deploy/s.yaml.example` read them from the deploying
   process and contain no values.
6. Activate the separate pay-as-you-go
   [AI Safety Guardrails service](https://help.aliyun.com/zh/document_detail/2878218.html) with the
   Alibaba Cloud primary account. Then authorize content safety for the same Bailian workspace as the
   DashScope key from Bailian's safety-management page. Allow Bailian to create
   `AliyunServiceRoleForSFMAccessingCIP`, whose documented purpose is calling content security on
   Bailian's behalf. `AliyunServiceRoleForCIPAccessLogDelivery` is a different role that Guardrails
   may create for log delivery; it does not replace the Bailian access role. See Alibaba Cloud's
   [Bailian role reference](https://help.aliyun.com/zh/model-studio/bailian-service-linked-role),
   [Guardrails role reference](https://help.aliyun.com/zh/document_detail/2998651.html), and
   [Bailian content-security integration guide](https://help.aliyun.com/zh/model-studio/content-security/).
   Production Qwen calls always send
   `X-DashScope-DataInspection: {"input":"cip","output":"cip"}` and must fail closed if this layer is
   unavailable. A plain model call succeeding does not satisfy this prerequisite. Guardrails is
   separately metered; review the current
   [pricing page](https://help.aliyun.com/zh/document_detail/2872706.html) before enabling it.
7. Run the bounded Qwen review for general knowledge, rebuild the backlog, then pin the reviewed
   bytes before building the image. Health and safety facts remain unpublished in v1:

   ```powershell
   cd backend
   pnpm review:knowledge-ai -- --credentials-file <absolute-path-to-downloaded-csv> --all --write --next-version <new-catalog-version>
   cd ..
   node scripts\build-topic-backlog.mjs
   node scripts\check-knowledge-readiness.mjs
   $env:JIANWEI_KNOWLEDGE_CATALOG_SHA256 = node scripts\hash-knowledge-catalog.mjs
   ```

   Production refuses a catalog whose bytes do not match this digest or whose approved general facts
   carry neither a valid Qwen review nor an optional human correction attestation. The protected
   release process separately binds the exact catalog/backlog bytes and the optional human-correction
   policy digest into the independently signed assembly manifest. Updating content therefore requires
   a new reviewed digest and image rollout. Sending a full catalog to Qwen requires explicit operator
   authorization because the fact text and public-source metadata leave the local machine.

Before deployment, an operator can verify the workspace, fixed models and guardrail activation with
one explicitly authorized, non-personal JPEG:

This integration does **not** require buying another Qwen token plan or a large prepaid moderation
package. The Alibaba Cloud primary account must first:

1. Open AI Safety Guardrails pay-as-you-go and allow Alibaba Cloud to create
   `AliyunServiceRoleForSFMAccessingCIP`. Activation itself is free; only actual guardrail calls are
   billed. See the official [activation and billing guide](https://help.aliyun.com/zh/document_detail/2872706.html).
2. Open Bailian **Security Management**, choose **Authorize**, and confirm content-safety access for
   the same account/workspace. See the official [Bailian input/output guardrail guide](https://help.aliyun.com/zh/model-studio/content-security/).
3. Run the text-only preflight below. Do not run the authorized-image verifier until it returns
   `guardrailAccess: "GO"`.

```powershell
cd backend
pnpm verify:qwen-guardrail-access -- --credentials-file <absolute-path-to-downloaded-csv>
```

This preflight sends one benign text-only request with the exact production inspection header. It
does not read or upload an image and prints only the HTTP status plus a validated diagnostic code.
Use it after changing AI Safety Guardrails or workspace authorization; a `GO` result only proves
that the role and inspection header are usable, so the authorized-image verification below remains
required before deployment.

```powershell
cd backend
pnpm verify:qwen-provider -- --credentials-file <absolute-path-to-downloaded-csv> --image <absolute-path-to-authorized-jpeg> --output <new-private-report-path.json> --confirm-authorized-image
```

The verifier reads the CSV only at runtime and never prints or persists the key. Before any network
request it removes APP/COM metadata segments in memory, then rejects any remaining metadata,
trailing bytes or malformed JPEG structure; original metadata is neither persisted nor sent to the
provider. It writes exactly one machine-readable report with mode `0600` and refuses to overwrite an
existing file. The report contains the sanitized fixture SHA-256, request counts and only redacted
provider diagnostics; a final preflight rejects the API key, workspace endpoint and both local input
paths if any of them appear in the report. It always carries `releaseEvidence: false` because a local
provider probe does not prove the complete hosted cloud path. Its local diagnostic fallback may
omit the optional paid guardrail solely to distinguish model access from guardrail
activation. The command still exits unsuccessfully until the production request with the guardrail
succeeds; this fallback is not available to the server runtime and is not release evidence. If the
guarded request returns `403 access_denied` while the plain model-access probe returns 200, the
machine-readable result reports `ai_safety_guardrails_not_authorized`, the exact required header and
the expected Bailian role. That diagnosis means the key and fixed model are reachable, but it does
not prove which console activation step is missing; confirm both service enablement and workspace
authorization before rerunning.

## Build and deploy

### iOS Beta code-package path

Build a fresh Function Compute package after every backend, migration, catalog, deployment-template
or package-builder change. The builder installs lockfile-pinned production dependencies as copied
files, downloads Apple root certificates only from Apple, verifies their pinned SHA-256 values,
rejects native modules built for the local Mac, and emits an independent package digest:

```bash
node scripts/build-fc-code-package.mjs \
  --output .tooling/fc-code-package \
  --report .tooling/fc-code-package-report.json
```

Set `JIANWEI_DEPLOYMENT_ARTIFACT_KIND=code-package`, `JIANWEI_CODE_PATH` to that directory and
`JIANWEI_DEPLOYMENT_ARTIFACT_DIGEST` to the report value. Then verify or deploy through the OAuth
bridge without persisting temporary Alibaba Cloud credentials:

```bash
node scripts/run-serverless-with-aliyun-oauth.mjs \
  --profile jianwei --action verify --template deploy/s.code-package.yaml

JIANWEI_CLOUD_MUTATION_CONFIRMED=YES \
node scripts/run-serverless-with-aliyun-oauth.mjs \
  --profile jianwei --action deploy --template deploy/s.code-package.yaml \
  --confirm-cloud-mutation
```

The first deployment may use a temporary valid HTTPS placeholder only to discover the generated FC
trigger URL. Immediately redeploy with that exact URL, then verify `/health/live` and
`/health/ready`; a placeholder deployment is never a usable Beta backend.

### Prepare immutable local candidate inputs first

Before any cloud mutation, build the backend and Android artifacts from the exact source. The final
local candidate is created after the container build and security scan so it can bind the image ID,
full vulnerability report and CycloneDX SBOM alongside the source, migrations, catalog, API, Room
schema and APK. It deliberately carries `releaseEvidence: false` and cannot substitute for registry,
Function Compute, signed APK or physical-device evidence.

```powershell
cd backend
pnpm build
cd ..
cd android
.\gradlew.bat test lintDebug lintRelease assembleDebug assembleDebugAndroidTest assembleRelease
cd ..
```

Do not mutate these inputs after the image scan. The candidate assembler accepts only the exact
unsigned artifact declared by Gradle's Release metadata and records that the APK signature has
**not** been cryptographically verified. Signing and `apksigner verify` remain a later controlled
release step.

Immediately before the first migration and again before signing the APK, verify that no bound byte
has changed since assembly:

```powershell
node scripts\assemble-release-candidate.mjs --verify .tooling\release-candidate\<release-id>.json --release-apk android\app\build\outputs\apk\release\app-release-unsigned.apk --debug-apk android\app\build\outputs\apk\debug\app-debug.apk --container-security-evidence .tooling\container-security\<release-id>\evidence.json --vulnerability-report .tooling\container-security\<release-id>\vulnerabilities.json --sbom .tooling\container-security\<release-id>\sbom.cdx.json
```

Verification recomputes every binding and fails if the backend, migration SQL, catalog, API, Room
schema, deployment template, assembler, APK, image ID, vulnerability report, SBOM or derived security
metrics have drifted. The generation timestamp is the only field excluded from that comparison.

The rollout order is mandatory:

1. Apply all database migrations through `015_feedback_affinity_contributions` and rerun the migration command to
   prove idempotence.
2. Deploy the digest-pinned backend image.
3. Verify `/health/live`, `/health/ready`, the independently observed deployment receipt and the full
   guarded Qwen cloud path.
4. Only then sign and distribute the Android Release APK.

Before building or deploying, run the secret-safe aggregate preflight from the repository root:

```powershell
node scripts\check-cloud-deployment-preflight.mjs --self-test
node scripts\check-cloud-deployment-preflight.mjs
```

The second command validates the local deployment tools, the selected Serverless Devs access
profile, all required FC/RDS/OSS/VPC inputs, the production HTTPS origin, Beijing DashScope
endpoint, fixed Qwen versions, catalog digest, cost circuit breakers and immutable container/base
image digests. It reports only missing or invalid variable names and never serializes their values.
`GO` means the deployment inputs are ready; it still has `releaseEvidence: false` and does not claim
that any cloud resource has been observed. Use `--output <new-private-path.json>` for an overwrite-
protected mode-0600 handoff report. The Bailian API-key CSV is only a model credential and cannot
replace the RAM identity behind the Serverless Devs access profile.

For an operator working locally, prefer Alibaba Cloud CLI OAuth over a long-lived RAM AccessKey.
After browser authorization completes, the repository bridge reads the OAuth profile only inside
its process, passes the resulting short-lived STS credential set to Serverless Devs through the
documented in-memory serverless-devs-key environment mechanism, and never writes it to the
Serverless Devs credential store:

    node scripts\\run-serverless-with-aliyun-oauth.mjs --self-test
    node scripts\\run-serverless-with-aliyun-oauth.mjs --profile jianwei --action preflight
    node scripts\\run-serverless-with-aliyun-oauth.mjs --profile jianwei --action verify

The bridge refuses non-OAuth profiles, incomplete or nearly expired STS sets, and all deployment
attempts without a separate mutation confirmation. The verify action is non-mutating. The deploy
action is reserved for the controlled rollout after the operator has approved the exact resource
charges; it requires both --confirm-cloud-mutation and JIANWEI_CLOUD_MUTATION_CONFIRMED=YES. The
OAuth profile itself remains in the official Alibaba Cloud CLI credential store, where the CLI
refreshes it; do not print or copy aliyun configure get output because that output contains temporary
secrets.

Migrations 014 and 015 are additive and defaulted. Migration 014 adds nullable object-bound columns;
migration 015 adds non-null feedback-contribution columns with deterministic backfill. This permits
the previous backend to run after both migrations, while the new backend must not run before
migration 015. New Android clients accept legacy cards whose `boundingBox` is null, and old Android
clients ignore the new JSON field. If the backend rollout fails, redeploy the previous immutable
image and keep migrations 014 and 015 in place; do not drop or reverse these columns during incident
rollback.

From the repository root:

```powershell
# Reviewed 2026-07-30: Docker Hub and the public ECR mirror returned the same
# official multi-platform index digest. Re-review the tag and scanner findings
# before a later release; never float the tag or disable TLS verification.
$env:JIANWEI_NODE_IMAGE = "public.ecr.aws/docker/library/node:22.23.1-trixie-slim@sha256:e6d9a389d34ff9678438af985c9913fbd1eb6ed36e80fea56644f4b4f6dd70ba"
if ($env:JIANWEI_NODE_IMAGE -notmatch '@sha256:[0-9a-f]{64}$') { throw "JIANWEI_NODE_IMAGE must be digest-pinned" }
$env:JIANWEI_IMAGE_TAG = "registry.cn-beijing.aliyuncs.com/<namespace>/jianwei-api:<release-id>"
docker build --platform linux/amd64 --build-arg "NODE_IMAGE=$env:JIANWEI_NODE_IMAGE" -f deploy/Dockerfile -t $env:JIANWEI_IMAGE_TAG .

# Produce a complete report plus an SBOM, then fail if any HIGH/CRITICAL item
# already has an available fixed version. Unfixed base-image findings remain
# visible in the complete report and must be reviewed; they are not called zero.
$scanDir = ".tooling\container-security\<release-id>"
New-Item -ItemType Directory -Force $scanDir | Out-Null
trivy image --scanners vuln --format json --output "$scanDir\vulnerabilities.json" $env:JIANWEI_IMAGE_TAG
trivy image --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 $env:JIANWEI_IMAGE_TAG
trivy image --format cyclonedx --output "$scanDir\sbom.cdx.json" $env:JIANWEI_IMAGE_TAG
$localImageId = docker image inspect $env:JIANWEI_IMAGE_TAG --format '{{.Id}}'
node scripts\check-container-security-evidence.mjs --report "$scanDir\vulnerabilities.json" --sbom "$scanDir\sbom.cdx.json" --image-id $localImageId --output "$scanDir\evidence.json"

# Freeze the cross-artifact candidate only after the exact local image has passed
# security verification. Every output path is new and overwrite-protected.
node scripts\assemble-release-candidate.mjs --release-apk android\app\build\outputs\apk\release\app-release-unsigned.apk --debug-apk android\app\build\outputs\apk\debug\app-debug.apk --container-security-evidence "$scanDir\evidence.json" --vulnerability-report "$scanDir\vulnerabilities.json" --sbom "$scanDir\sbom.cdx.json" --output .tooling\release-candidate\<release-id>.json
node scripts\assemble-release-candidate.mjs --verify .tooling\release-candidate\<release-id>.json --release-apk android\app\build\outputs\apk\release\app-release-unsigned.apk --debug-apk android\app\build\outputs\apk\debug\app-debug.apk --container-security-evidence "$scanDir\evidence.json" --vulnerability-report "$scanDir\vulnerabilities.json" --sbom "$scanDir\sbom.cdx.json"

docker push $env:JIANWEI_IMAGE_TAG
# Read the pushed manifest digest from ACR or the registry response; do not derive it from the tag.
$env:JIANWEI_CONTAINER_IMAGE_DIGEST = "sha256:<pushed-registry-manifest-digest>"
$env:JIANWEI_IMAGE = "$env:JIANWEI_IMAGE_TAG@$env:JIANWEI_CONTAINER_IMAGE_DIGEST"
node scripts\check-container-deployment-inputs.mjs
Copy-Item deploy\s.yaml.example s.yaml
s verify
s deploy
```

The ACR image must be in the same Alibaba Cloud account and region as the custom-container
function. The container listens on port 9000 and runs as the unprivileged `node` user. Do not commit
`s.yaml`, `.env`, credentials, signing material or rendered deployment previews.
The local security evidence has `releaseEvidence: false`: it binds the locally scanned image ID but
does not prove which manifest ACR stored or which digest Function Compute actually ran. The signed
deployment receipt and post-push ACR observation remain mandatory.

The deployment job must independently query ACR and Function Compute after rollout and create the
signed `config/deployment-receipt.example.json` contract in controlled evidence storage. Its
`beta_deployment_attestor` key must be separate from the human `beta_release_approver` key and only
available to the deployment evidence job. The receipt binds the public endpoint, Function Compute
revision, actual ACR manifest digest, embedded backend Release SHA-256 and deployment time. Merely
copying `JIANWEI_CONTAINER_IMAGE_DIGEST` into the receipt is prohibited: it must come from the
platform observation. The repository has a verifier, not a local deployment-receipt signer.

The OSS client starts with Function Compute's system environment credentials so startup can verify
the bucket lifecycle and versioning policy. For every later non-liveness invocation, production also
requires the complete `x-fc-access-key-id`, `x-fc-access-key-secret` and `x-fc-security-token` set
that Function Compute injects into Custom Container requests. The values replace an in-memory-only
credential snapshot, and `ali-oss` consults that snapshot before every operation. Missing or partial
headers fail with 503; they are never logged, persisted or returned. The production logger explicitly
redacts all three names. This closes warm-instance expiry without rereading a stale environment set.

Runtime timeouts are deliberately nested. Each Qwen call is capped at 25 seconds and each OSS call at
10 seconds; the calculated core envelope allows two vision calls, one title call, two pre-finalization
OSS calls and 15 seconds of database/serialization overhead. Android waits 150 seconds, Function
Compute waits 180 seconds, and the database processing lease lasts 210 seconds. Run
`node scripts/check-runtime-budgets.mjs` before release; it rejects an ordering that could let a live
invocation lose its lease or a normal core path exceed the client deadline.

Image deletion has three layers: the analysis path attempts immediate deletion, a live instance
retries pending deletions and scans expired objects every five minutes, and the one-day OSS lifecycle
rule is a last-resort orphan cleanup. OSS lifecycle execution is asynchronous, so the lifecycle rule
alone is not proof of a strict 24-hour deletion SLA; release evidence must demonstrate immediate and
retry deletion behavior, and monitoring must alert on leftovers.

Do not run or capture `s preview` in CI after secret-bearing environment variables are loaded: a
rendered plan can expand deployment values. If an operator needs a preview, use an access-controlled
interactive shell, inspect it without recording terminal output, and destroy the shell history.

## Required release checks

1. Build the backend and Android outputs, build the exact `linux/amd64` image, run the complete Trivy
   report, fixable-HIGH/CRITICAL gate and CycloneDX SBOM, then run both candidate/security self-tests
   and assemble a new cross-artifact candidate from the unsigned Gradle Release output plus all three
   security artifacts. Reverify the same inputs before migration and again before APK signing.
2. `node scripts/check-deployment-manifest.mjs --self-test`,
   `node scripts/check-deployment-manifest.mjs`, and after setting the real deployment environment,
   `node scripts/check-container-deployment-inputs.mjs` and
   `node scripts/check-cloud-deployment-preflight.mjs`; then run both runtime-budget checks.
3. `node scripts/build-topic-backlog.mjs` and `node scripts/check-knowledge-readiness.mjs`.
4. In `backend/`, run `pnpm check && pnpm test && pnpm migrate && pnpm migrate` against the release
   database using a controlled deployment job.
5. Confirm Function Compute probes `GET /health/live`, then call dependency-aware
   `GET /health/ready` through the production HTTPS domain and verify PostgreSQL plus OSS policy.
6. Run `pnpm verify:cloud-beta -- ... --confirm-authorized-fixtures --write` with separately
   authorized safe and sensitive metadata-free JPEG fixtures. It proves the safe Qwen path,
   server-side sensitive rejection, object observation and immediate deletion, OSS policy and
   bearer invalidation without writing credentials, tokens, object keys or photos to evidence. Pass
   `--deployment-receipt` using the independently platform-observed and deployment-attestor-signed
   receipt; the verifier checks it against the repository-pinned policy, readiness and local backend
   identity before binding it into the canonical cloud run.
7. Kill a processing instance and observe the one-day lifecycle fallback removing the orphan;
   record elapsed time without treating asynchronous lifecycle execution as a strict 24-hour proof.
8. Call `DELETE /v1/device-data`, require the 200 JSON acknowledgement to contain exactly the
   registered `deviceId` and `status: "deleted"`, then verify the bearer is invalid and all owned
   jobs/cards/objects are gone.
9. Save redacted raw evidence in the format required by `evaluation/beta-evidence.example.json`;
   never place photos, tokens, database URLs or cloud credentials in the repository.

This manifest follows Function Compute 3 custom-container conventions: port 9000, an HTTP health
check, an execution role, VPC access, Log Service collection and environment-based configuration.
Cloud resources and credentials are intentionally not created by this repository.

Platform configuration should be checked against Alibaba Cloud's current
[Function Compute custom-container guide](https://help.aliyun.com/zh/functioncompute/fc/user-guide/create-a-custom-container-function-in-a-container-runtime)
and the [Serverless Devs FC3 specification](https://docs.serverless-devs.com/user-guide/aliyun/fc3/spec/)
before each rollout; the repository gate validates the checked-in template, not the live cloud state.
