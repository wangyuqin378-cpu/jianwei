# Production deployment

The production target is an Alibaba Cloud Function Compute 3 custom container connected to RDS
PostgreSQL, a private OSS bucket and fixed-version Qwen models. Local/in-memory mode is a developer
fallback and is never release evidence.

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
4. Bind a filed production domain with HTTPS, set `JIANWEI_PUBLIC_BASE_URL` to that exact origin,
   and keep the platform HTTP trigger anonymous because the API enforces its own server-issued
   device bearer on every private route.
5. Store the database URL and DashScope key in the deployment environment or KMS-backed secret
   workflow. `deploy/s.yaml.example` reads them from the deploying process and contains no values.
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
7. Complete the accountable-human content review, set `JIANWEI_KNOWLEDGE_REVIEWER_IDS` to the
   exact internal reviewer IDs, then pin the reviewed bytes before building the image:

   ```powershell
   node scripts\build-topic-backlog.mjs
   node scripts\check-knowledge-readiness.mjs
   $env:JIANWEI_KNOWLEDGE_CATALOG_SHA256 = node scripts\hash-knowledge-catalog.mjs
   ```

   Production refuses a catalog whose bytes do not match this digest or whose approved facts do not
   carry an attestation from a configured human reviewer ID. The protected release process separately
   binds the exact catalog/backlog bytes and reviewer-allowlist digest into the independently signed
   assembly manifest. Updating content therefore requires a new reviewed digest and image rollout.

Before deployment, an operator can verify the workspace, fixed models and guardrail activation with
one explicitly authorized, non-personal JPEG:

```powershell
cd backend
pnpm verify:qwen-provider -- --credentials-file <absolute-path-to-downloaded-csv> --image <absolute-path-to-authorized-jpeg> --confirm-authorized-image
```

The verifier reads the CSV only at runtime and never prints or persists the key. Its local diagnostic
fallback may omit the optional paid guardrail solely to distinguish model access from guardrail
activation. The command still exits unsuccessfully until the production request with the guardrail
succeeds; this fallback is not available to the server runtime and is not release evidence. If the
guarded request returns `403 access_denied` while the plain model-access probe returns 200, the
machine-readable result reports `ai_safety_guardrails_not_authorized`, the exact required header and
the expected Bailian role. That diagnosis means the key and fixed model are reachable, but it does
not prove which console activation step is missing; confirm both service enablement and workspace
authorization before rerunning.

## Build and deploy

From the repository root:

```powershell
# Resolve this tag from the official Node registry and record the reviewed immutable digest.
$env:JIANWEI_NODE_IMAGE = "node:22.17.0-bookworm-slim@sha256:<64-hex-digest>"
if ($env:JIANWEI_NODE_IMAGE -notmatch '@sha256:[0-9a-f]{64}$') { throw "JIANWEI_NODE_IMAGE must be digest-pinned" }
$env:JIANWEI_IMAGE_TAG = "registry.cn-beijing.aliyuncs.com/<namespace>/jianwei-api:<release-id>"
docker build --platform linux/amd64 --build-arg "NODE_IMAGE=$env:JIANWEI_NODE_IMAGE" -f deploy/Dockerfile -t $env:JIANWEI_IMAGE_TAG .
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

1. `node scripts/check-deployment-manifest.mjs --self-test`,
   `node scripts/check-deployment-manifest.mjs`, and after setting the real deployment environment,
   `node scripts/check-container-deployment-inputs.mjs`; then run both runtime-budget checks.
2. `node scripts/build-topic-backlog.mjs` and `node scripts/check-knowledge-readiness.mjs`.
3. In `backend/`, run `pnpm check && pnpm test && pnpm migrate && pnpm migrate` against the release
   database using a controlled deployment job.
4. Confirm Function Compute probes `GET /health/live`, then call dependency-aware
   `GET /health/ready` through the production HTTPS domain and verify PostgreSQL plus OSS policy.
5. Run `pnpm verify:cloud-beta -- ... --confirm-authorized-fixtures --write` with separately
   authorized safe and sensitive metadata-free JPEG fixtures. It proves the safe Qwen path,
   server-side sensitive rejection, object observation and immediate deletion, OSS policy and
   bearer invalidation without writing credentials, tokens, object keys or photos to evidence. Pass
   `--deployment-receipt` using the independently platform-observed and deployment-attestor-signed
   receipt; the verifier checks it against the repository-pinned policy, readiness and local backend
   identity before binding it into the canonical cloud run.
6. Kill a processing instance and observe the one-day lifecycle fallback removing the orphan;
   record elapsed time without treating asynchronous lifecycle execution as a strict 24-hour proof.
7. Call `DELETE /v1/device-data`, verify the bearer is invalid and all owned jobs/cards/objects are
   gone.
8. Save redacted raw evidence in the format required by `evaluation/beta-evidence.example.json`;
   never place photos, tokens, database URLs or cloud credentials in the repository.

This manifest follows Function Compute 3 custom-container conventions: port 9000, an HTTP health
check, an execution role, VPC access, Log Service collection and environment-based configuration.
Cloud resources and credentials are intentionally not created by this repository.

Platform configuration should be checked against Alibaba Cloud's current
[Function Compute custom-container guide](https://help.aliyun.com/zh/functioncompute/fc/user-guide/create-a-custom-container-function-in-a-container-runtime)
and the [Serverless Devs FC3 specification](https://docs.serverless-devs.com/user-guide/aliyun/fc3/spec/)
before each rollout; the repository gate validates the checked-in template, not the live cloud state.
