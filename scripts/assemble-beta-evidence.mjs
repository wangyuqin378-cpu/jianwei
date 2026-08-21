import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { lstat, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createSyntheticPassingEvidence } from "./check-beta-readiness.mjs";
import {
  knowledgeReviewerIdsFromEnvironment,
  knowledgeReviewerPolicySha256
} from "./check-knowledge-readiness.mjs";
import {
  assembleBetaEvidence,
  createBetaEvidenceAssemblyManifest,
  prepareEvaluationRoot,
  resolveEvaluationOutput,
  sha256Bytes
} from "./lib/beta-evidence-assembly.mjs";
import { deploymentReceiptSignaturePayload } from "./lib/deployment-receipt.mjs";
import { parseFlagArgs } from "./lib/fact-review.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKING_ROOT = await realpath(process.cwd());

if (process.argv.includes("--self-test")) {
  await runSelfTest();
  process.exit(0);
}

const args = parseFlagArgs(process.argv.slice(2));
if (args.has("--trust-policy")) {
  throw new Error("the deployment trust policy is repository-pinned and cannot be overridden");
}
const deploymentPolicyPath = path.join(REPOSITORY_ROOT, "config", "evidence-trust-policy.json");
await assertPinnedOrdinaryPolicy(deploymentPolicyPath);
const [manifestBytes, catalogBytes, backlogBytes, deploymentPolicyBytes, artifacts] = await Promise.all([
  readFile(path.resolve(WORKING_ROOT, String(args.get("--manifest") ?? "evaluation/beta-evidence-assembly-manifest.json"))),
  readFile(path.resolve(WORKING_ROOT, String(args.get("--catalog") ?? "knowledge/catalog.json"))),
  readFile(path.resolve(WORKING_ROOT, String(args.get("--backlog") ?? "knowledge/topic-backlog.json"))),
  readFile(deploymentPolicyPath),
  readArtifacts(args, WORKING_ROOT)
]);
const result = assembleBetaEvidence({
  manifest: JSON.parse(manifestBytes.toString("utf8")),
  manifestSha256: sha256Bytes(manifestBytes),
  artifacts,
  deploymentPolicy: JSON.parse(deploymentPolicyBytes.toString("utf8")),
  deploymentPolicyBytes,
  catalog: JSON.parse(catalogBytes.toString("utf8")),
  catalogBytes,
  backlog: JSON.parse(backlogBytes.toString("utf8")),
  backlogBytes,
  approvedReviewerIds: knowledgeReviewerIdsFromEnvironment()
});
if (!args.has("--write")) {
  process.stdout.write(`BETA_EVIDENCE_ASSEMBLY_PREVIEW=GO samples=${result.assessment.metrics.evaluationSamples} cards=${result.assessment.metrics.auditedCards} devices=${result.assessment.metrics.deviceRuns} contentGate=GO attestationPending=1 finalGate=PENDING wrote=0\n`);
  process.exit(0);
}
const evaluationRoot = await prepareEvaluationRoot(WORKING_ROOT);
const output = await resolveEvaluationOutput(
  evaluationRoot,
  path.resolve(WORKING_ROOT, String(args.get("--output") ?? "evaluation/beta-evidence.json"))
);
const outputText = `${JSON.stringify(result.evidence, null, 2)}\n`;
await writeFile(output, outputText, { encoding: "utf8", flag: "wx" });
process.stdout.write(`BETA_EVIDENCE_ASSEMBLY=READY_FOR_ATTESTATION samples=${result.assessment.metrics.evaluationSamples} cards=${result.assessment.metrics.auditedCards} devices=${result.assessment.metrics.deviceRuns} manifestSha256=${sha256Bytes(manifestBytes)} evidenceSha256=${sha256Bytes(Buffer.from(outputText, "utf8"))} contentGate=GO attestationPending=1 finalGate=PENDING wrote=1\n`);

async function readArtifacts(args, workingRoot) {
  const files = {
    imageEvaluation: String(args.get("--image") ?? "evaluation/compiled-image-evaluation.json"),
    cardAudit: String(args.get("--cards") ?? "evaluation/compiled-card-audit.json"),
    betaCohort: String(args.get("--cohort") ?? "evaluation/beta-cohort-compiled.json"),
    cloudVerification: String(args.get("--cloud") ?? "evaluation/cloud-beta-compiled.json"),
    releaseArtifact: String(args.get("--release") ?? "evaluation/release-artifact.json"),
    physicalDeviceRuns: String(args.get("--devices") ?? "evaluation/compiled-physical-device-runs.json"),
    accessibilityAudit: String(args.get("--accessibility") ?? "evaluation/compiled-accessibility-audit.json"),
    deploymentReceipt: String(args.get("--deployment-receipt") ?? "evaluation/deployment-receipt.json")
  };
  return Object.fromEntries(await Promise.all(Object.entries(files).map(async ([name, file]) => {
    const bytes = await readFile(path.resolve(workingRoot, file));
    return [name, { bytes, value: JSON.parse(bytes.toString("utf8")) }];
  })));
}

async function runSelfTest() {
  const fixture = createSyntheticPassingEvidence();
  const generatedAt = fixture.generatedAt;
  const deployment = syntheticDeploymentFixture(fixture, generatedAt);
  const artifacts = fixtureArtifacts(fixture, generatedAt, deployment.receipt);
  const fixtureTime = new Date(generatedAt);
  const createdAt = new Date(fixtureTime.getTime() + 60_000);
  const approvedAt = new Date(fixtureTime.getTime() + 120_000);
  const now = new Date(fixtureTime.getTime() + 180_000);
  const catalog = {
    version: fixture.evaluationProvenance.catalogVersion,
    topics: Array.from(new Set(fixture.evaluationSamples.flatMap((item) => [item.expectedTopicId, item.predictedTopicId]).filter(Boolean)))
      .map((topicId) => ({ topicId })),
    sources: []
  };
  const backlog = {};
  const catalogBytes = Buffer.from(`${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  const backlogBytes = Buffer.from(`${JSON.stringify(backlog, null, 2)}\n`, "utf8");
  const approvedReviewerIds = new Set(["human-reviewer-1"]);
  const reviewerPolicySha256 = knowledgeReviewerPolicySha256(approvedReviewerIds);
  const manifest = createBetaEvidenceAssemblyManifest({ artifacts, catalogBytes, backlogBytes, reviewerPolicySha256, now: createdAt });
  manifest.evidenceOwner = "human-evidence-owner";
  manifest.assemblyApproved = true;
  manifest.approvedAt = approvedAt.toISOString();
  const readyKnowledge = { status: "GO", metrics: { topics: 200, readyTopics: 200, verifiedFacts: 600, aiReviewedFacts: 600, humanAttestedFacts: 0 }, blockers: [] };
  const assemble = (candidateManifest = manifest, candidateArtifacts = artifacts, overrides = {}) => {
    const manifestBytes = Buffer.from(`${JSON.stringify(candidateManifest, null, 2)}\n`, "utf8");
    return assembleBetaEvidence({
      manifest: candidateManifest,
      manifestSha256: sha256Bytes(manifestBytes),
      artifacts: candidateArtifacts,
      deploymentPolicy: deployment.policy,
      deploymentPolicyBytes: deployment.policyBytes,
      catalog,
      catalogBytes,
      backlog,
      backlogBytes,
      approvedReviewerIds,
      now,
      knowledgeReadiness: readyKnowledge,
      ...overrides
    });
  };
  const result = assemble();
  if (result.assessment.status !== "GO" || result.evidence.evidenceKind !== "real_beta_evidence" ||
      result.evidence.evaluationSamples.length !== 300 || result.evidence.cardAudits.length !== 200) {
    throw new Error("Beta evidence assembler passing fixture failed");
  }

  let bypassesRejected = 0;
  const reject = async (operation) => {
    try { await operation(); } catch { bypassesRejected += 1; return; }
    throw new Error("Beta evidence assembler accepted an invalid fixture");
  };
  await reject(() => assemble({ ...manifest, assemblyApproved: false }));
  await reject(() => assemble({ ...manifest, evidenceOwner: "kimi-bot" }));
  await reject(() => {
    const changed = cloneArtifacts(artifacts);
    changed.imageEvaluation.bytes = Buffer.concat([changed.imageEvaluation.bytes, Buffer.from(" ")]);
    return assemble(manifest, changed);
  });
  await reject(() => assemble(manifest, artifacts, {
    approvedReviewerIds: new Set(["different-human-reviewer"])
  }));
  await reject(() => {
    const splitView = cloneArtifacts(artifacts);
    splitView.imageEvaluation.value.evaluationProvenance.appVersion = "value-not-present-in-bound-bytes";
    return assemble(manifest, splitView);
  });
  await reject(() => {
    const mixed = cloneArtifacts(artifacts);
    mixed.releaseArtifact.value.versionName = "different-app-version";
    repack(mixed.releaseArtifact);
    const rebound = structuredClone(manifest);
    rebound.artifacts.releaseArtifact.sha256 = sha256Bytes(mixed.releaseArtifact.bytes);
    return assemble(rebound, mixed);
  });
  await reject(() => {
    const changed = cloneArtifacts(artifacts);
    changed.cloudVerification.value.checks.safeImmediateDelete = false;
    repack(changed.cloudVerification);
    const rebound = structuredClone(manifest);
    rebound.artifacts.cloudVerification.sha256 = sha256Bytes(changed.cloudVerification.bytes);
    return assemble(rebound, changed);
  });
  await reject(() => {
    const missing = cloneArtifacts(artifacts);
    delete missing.cardAudit;
    return assemble(manifest, missing);
  });
  await reject(() => {
    const privateDevice = cloneArtifacts(artifacts);
    privateDevice.physicalDeviceRuns.value.deviceRuns[0].deviceToken = "forbidden";
    repack(privateDevice.physicalDeviceRuns);
    const rebound = structuredClone(manifest);
    rebound.artifacts.physicalDeviceRuns.sha256 = sha256Bytes(privateDevice.physicalDeviceRuns.bytes);
    return assemble(rebound, privateDevice);
  });
  await reject(() => {
    const mismatchedAccessibility = cloneArtifacts(artifacts);
    mismatchedAccessibility.accessibilityAudit.value.accessibilityAudit.model = "different-physical-model";
    repack(mismatchedAccessibility.accessibilityAudit);
    const rebound = structuredClone(manifest);
    rebound.artifacts.accessibilityAudit.sha256 = sha256Bytes(mismatchedAccessibility.accessibilityAudit.bytes);
    return assemble(rebound, mismatchedAccessibility);
  });
  await reject(() => {
    const mixedApk = cloneArtifacts(artifacts);
    mixedApk.physicalDeviceRuns.value.deviceRuns[0].apkSha256 = "9".repeat(64);
    repack(mixedApk.physicalDeviceRuns);
    const rebound = structuredClone(manifest);
    rebound.artifacts.physicalDeviceRuns.sha256 = sha256Bytes(mixedApk.physicalDeviceRuns.bytes);
    return assemble(rebound, mixedApk);
  });
  await reject(() => {
    const mixedBackend = cloneArtifacts(artifacts);
    mixedBackend.cardAudit.value.cardAuditProvenance.backendReleaseSha256 = "9".repeat(64);
    repack(mixedBackend.cardAudit);
    const rebound = structuredClone(manifest);
    rebound.artifacts.cardAudit.sha256 = sha256Bytes(mixedBackend.cardAudit.bytes);
    return assemble(rebound, mixedBackend);
  });
  await reject(() => {
    const mixedContainer = cloneArtifacts(artifacts);
    mixedContainer.cloudVerification.value.cloud.containerImageDigest = `sha256:${"9".repeat(64)}`;
    repack(mixedContainer.cloudVerification);
    const rebound = structuredClone(manifest);
    rebound.artifacts.cloudVerification.sha256 = sha256Bytes(mixedContainer.cloudVerification.bytes);
    return assemble(rebound, mixedContainer);
  });
  await reject(() => {
    const untrustedDeployment = cloneArtifacts(artifacts);
    untrustedDeployment.cloudVerification.value.cloudProvenance.deploymentReceiptSha256 = "9".repeat(64);
    repack(untrustedDeployment.cloudVerification);
    const rebound = structuredClone(manifest);
    rebound.artifacts.cloudVerification.sha256 = sha256Bytes(untrustedDeployment.cloudVerification.bytes);
    return assemble(rebound, untrustedDeployment);
  });
  await reject(() => {
    const forged = cloneArtifacts(artifacts);
    const forgedDigest = `sha256:${"9".repeat(64)}`;
    forged.deploymentReceipt.value.containerImageDigest = forgedDigest;
    repack(forged.deploymentReceipt);
    forged.cloudVerification.value.cloudProvenance.containerImageDigest = forgedDigest;
    forged.cloudVerification.value.cloud.containerImageDigest = forgedDigest;
    refreshCloudRunDigest(forged.cloudVerification.value);
    repack(forged.cloudVerification);
    const rebound = structuredClone(manifest);
    rebound.artifacts.deploymentReceipt.sha256 = sha256Bytes(forged.deploymentReceipt.bytes);
    rebound.artifacts.cloudVerification.sha256 = sha256Bytes(forged.cloudVerification.bytes);
    return assemble(rebound, forged);
  });
  await reject(() => assemble({ ...manifest, approvedAt: new Date(fixtureTime.getTime() - 60_000).toISOString() }));
  await reject(() => assemble(manifest, artifacts, { knowledgeReadiness: { status: "NO_GO", metrics: {}, blockers: ["unreviewed facts"] } }));
  await reject(() => {
    const changedCatalog = structuredClone(catalog);
    changedCatalog.sources.push({ sourceId: "post-approval-source" });
    return assemble(manifest, artifacts, {
      catalog: changedCatalog,
      catalogBytes: Buffer.from(`${JSON.stringify(changedCatalog, null, 2)}\n`, "utf8")
    });
  });
  await reject(() => assembleBetaEvidence({
    manifest,
    manifestSha256: "0".repeat(63),
    artifacts,
    deploymentPolicy: deployment.policy,
    deploymentPolicyBytes: deployment.policyBytes,
    catalog,
    catalogBytes,
    backlog,
    backlogBytes,
    approvedReviewerIds,
    now,
    knowledgeReadiness: readyKnowledge
  }));

  const workspace = path.join(REPOSITORY_ROOT, ".tooling", `beta-assembly-self-test-${randomBytes(6).toString("hex")}`);
  let symlinkRejected = false;
  try {
    const evaluationRoot = await prepareEvaluationRoot(workspace);
    await reject(() => resolveEvaluationOutput(evaluationRoot, path.join(workspace, "escaped.json")));
    const linked = path.join(workspace, "linked-evaluation");
    try {
      await symlink(evaluationRoot, linked, process.platform === "win32" ? "junction" : "dir");
      await reject(() => resolveEvaluationOutput(linked, path.join(linked, "escaped.json")));
      symlinkRejected = true;
    } catch (error) {
      if (!/[Ee](?:PERM|ACCES)|privilege|operation not permitted/i.test(`${error?.code ?? ""} ${error?.message ?? ""}`)) throw error;
    }
  } finally {
    const resolved = path.resolve(workspace);
    const tooling = path.resolve(REPOSITORY_ROOT, ".tooling");
    if (resolved.startsWith(`${tooling}${path.sep}`)) await rm(resolved, { recursive: true, force: true });
  }
  if (bypassesRejected !== 21) throw new Error(`Expected 21 rejected bypasses, observed ${bypassesRejected}`);
  process.stdout.write(`BETA_EVIDENCE_ASSEMBLER_SELF_TEST=GO synthetic=1 releaseEvidence=0 bypassesRejected=${bypassesRejected} artifactShaBinding=1 knowledgeByteBinding=1 reviewerPolicyBinding=1 cloudRunDigest=1 crossVersionBinding=1 releaseApkShaBinding=1 backendReleaseBinding=1 containerImageBinding=1 deploymentReceiptBinding=1 deploymentReceiptSignature=1 forgedSelfConsistentCloudRejected=1 knowledgeGate=1 manifestApproval=1 pathEscapeRejected=1 symlinkRejected=${symlinkRejected ? 1 : 0} canonicalWorkingRoot=1 contentGate=GO attestationPending=1 finalGate=PENDING autoClaims=0\n`);
}

function fixtureArtifacts(evidence, generatedAt, deploymentReceipt) {
  const checks = {
    httpsReady: true,
    qwenProvider: true,
    catalogPinned: true,
    safeObjectObserved: true,
    safeTerminalStatus: "completed",
    safeImmediateDelete: true,
    sensitiveObjectObserved: true,
    serverSensitiveRejected: true,
    sensitiveErrorCode: "server_sensitive_face",
    sensitiveImmediateDelete: true,
    lifecyclePolicyVerified: true,
    versioningDisabled: true,
    deviceDataDeleteVerified: true,
    bearerInvalidated: true
  };
  const cloudProvenance = structuredClone(evidence.cloudProvenance);
  cloudProvenance.runSha256 = sha256Bytes(Buffer.from(JSON.stringify([
    "jianwei-verified-cloud-run-v5",
    cloudProvenance.runId,
    cloudProvenance.baseUrlOrigin,
    cloudProvenance.appVersion,
    cloudProvenance.releaseApkSha256,
    cloudProvenance.backendReleaseSha256,
    cloudProvenance.containerImageDigest,
    cloudProvenance.deploymentReceiptSha256,
    cloudProvenance.deploymentPolicySha256,
    cloudProvenance.deploymentIssuerId,
    cloudProvenance.deploymentKeyId,
    cloudProvenance.deploymentRevision,
    cloudProvenance.modelVersion,
    cloudProvenance.catalogVersion,
    cloudProvenance.safeFixtureSha256,
    cloudProvenance.sensitiveFixtureSha256,
    cloudProvenance.expectedSensitiveType,
    evidence.cloud.ttlHours,
    cloudProvenance.verifiedAt,
    checks
  ]), "utf8"));
  const physicalDeviceRuns = {
    schemaVersion: 1,
    evidenceKind: "compiled_physical_device_runs",
    generatedAt,
    physicalDeviceRunProvenance: {
      evidenceKind: "compiled_physical_device_runs",
      runSetId: "synthetic-physical-matrix",
      inputSetSha256: "f".repeat(64),
      manifestSha256: "e".repeat(64),
      runCount: evidence.deviceRuns.length,
      appVersion: evidence.releaseArtifact.versionName,
      apkSha256: evidence.releaseArtifact.apkSha256,
      compiledAt: generatedAt
    },
    deviceRuns: evidence.deviceRuns.map((run, index) => ({
      ...structuredClone(run),
      runId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`
    }))
  };
  const sourceRun = physicalDeviceRuns.deviceRuns[0];
  const accessibilityAudit = {
    schemaVersion: 1,
    evidenceKind: "compiled_accessibility_audit",
    generatedAt,
    accessibilityAuditProvenance: {
      evidenceKind: "compiled_accessibility_audit",
      auditId: "synthetic-talkback-audit",
      sourceDeviceRunId: sourceRun.runId,
      reportSha256: "a".repeat(64),
      evidenceSha256: "b".repeat(64),
      manifestSha256: "c".repeat(64),
      appVersion: sourceRun.appVersion,
      apkSha256: sourceRun.apkSha256,
      compiledAt: generatedAt
    },
    accessibilityAudit: {
      ...structuredClone(evidence.accessibilityAudit),
      appVersion: sourceRun.appVersion,
      apkSha256: sourceRun.apkSha256,
      manufacturer: sourceRun.manufacturer,
      model: sourceRun.model,
      buildFingerprint: sourceRun.buildFingerprint,
      apiLevel: sourceRun.apiLevel,
      auditedAt: sourceRun.testedAt
    }
  };
  return pack({
    imageEvaluation: {
      schemaVersion: 1,
      evidenceKind: "compiled_image_evaluation",
      generatedAt,
      evaluationProvenance: structuredClone(evidence.evaluationProvenance),
      metrics: {},
      evaluationSamples: structuredClone(evidence.evaluationSamples)
    },
    cardAudit: {
      schemaVersion: 1,
      evidenceKind: "compiled_card_audit",
      generatedAt,
      cardAuditProvenance: structuredClone(evidence.cardAuditProvenance),
      metrics: {},
      cardAudits: structuredClone(evidence.cardAudits)
    },
    betaCohort: {
      schemaVersion: 1,
      evidenceKind: "compiled_beta_cohort",
      generatedAt,
      betaProvenance: structuredClone(evidence.betaProvenance),
      beta: structuredClone(evidence.beta)
    },
    cloudVerification: {
      schemaVersion: 1,
      evidenceKind: "verified_cloud_run",
      generatedAt,
      cloudProvenance,
      checks,
      cloud: structuredClone(evidence.cloud)
    },
    releaseArtifact: structuredClone(evidence.releaseArtifact),
    physicalDeviceRuns,
    accessibilityAudit,
    deploymentReceipt
  });
}

function syntheticDeploymentFixture(evidence, generatedAt) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const { publicKey: releasePublicKey } = generateKeyPairSync("ed25519");
  const { publicKey: assemblyPublicKey } = generateKeyPairSync("ed25519");
  const policy = {
    schemaVersion: 1,
    evidenceKind: "beta_evidence_trust_policy",
    policyId: "synthetic-beta-policy",
    issuers: [
      syntheticTrustIssuer("synthetic-release-approver", "synthetic-release-key", "beta_release_approver", releasePublicKey),
      syntheticTrustIssuer("synthetic-assembly-attestor", "synthetic-assembly-key", "beta_assembly_attestor", assemblyPublicKey),
      syntheticTrustIssuer(
        evidence.cloudProvenance.deploymentIssuerId,
        evidence.cloudProvenance.deploymentKeyId,
        "beta_deployment_attestor",
        publicKey
      )
    ]
  };
  const policyBytes = Buffer.from(`${JSON.stringify(policy, null, 2)}\n`, "utf8");
  const receipt = {
    schemaVersion: 1,
    evidenceKind: "trusted_deployment_receipt",
    policyId: policy.policyId,
    policySha256: createHash("sha256").update(policyBytes).digest("hex"),
    issuerId: evidence.cloudProvenance.deploymentIssuerId,
    keyId: evidence.cloudProvenance.deploymentKeyId,
    role: "beta_deployment_attestor",
    endpointOrigin: evidence.cloudProvenance.baseUrlOrigin,
    deploymentRevision: evidence.cloudProvenance.deploymentRevision,
    containerImageDigest: evidence.cloudProvenance.containerImageDigest,
    backendReleaseSha256: evidence.cloudProvenance.backendReleaseSha256,
    deployedAt: generatedAt,
    issuedAt: generatedAt,
    signatureBase64: ""
  };
  receipt.signatureBase64 = sign(null, deploymentReceiptSignaturePayload(receipt), privateKey).toString("base64");
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  evidence.cloudProvenance.deploymentReceiptSha256 = sha256Bytes(receiptBytes);
  evidence.cloudProvenance.deploymentPolicySha256 = sha256Bytes(policyBytes);
  evidence.cloud.deploymentReceiptSha256 = evidence.cloudProvenance.deploymentReceiptSha256;
  evidence.cloud.deploymentRevision = evidence.cloudProvenance.deploymentRevision;
  return { policy, policyBytes, receipt };
}

function syntheticTrustIssuer(issuerId, keyId, role, publicKey) {
  return {
    issuerId,
    keyId,
    algorithm: "Ed25519",
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    roles: [role],
    notBefore: "2025-01-01T00:00:00.000Z",
    notAfter: "2027-12-31T23:59:59.999Z",
    status: "active"
  };
}

function refreshCloudRunDigest(cloudArtifact) {
  const provenance = cloudArtifact.cloudProvenance;
  provenance.runSha256 = sha256Bytes(Buffer.from(JSON.stringify([
    "jianwei-verified-cloud-run-v5", provenance.runId, provenance.baseUrlOrigin, provenance.appVersion,
    provenance.releaseApkSha256, provenance.backendReleaseSha256, provenance.containerImageDigest,
    provenance.deploymentReceiptSha256, provenance.deploymentPolicySha256, provenance.deploymentIssuerId,
    provenance.deploymentKeyId, provenance.deploymentRevision, provenance.modelVersion, provenance.catalogVersion,
    provenance.safeFixtureSha256, provenance.sensitiveFixtureSha256, provenance.expectedSensitiveType,
    cloudArtifact.cloud.ttlHours, provenance.verifiedAt, cloudArtifact.checks
  ]), "utf8"));
}

async function assertPinnedOrdinaryPolicy(file) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || path.resolve(await realpath(file)) !== path.resolve(file)) {
    throw new Error("the deployment trust policy must be an ordinary repository-pinned file");
  }
}

function pack(values) {
  return Object.fromEntries(Object.entries(values).map(([name, value]) => {
    const item = { value };
    repack(item);
    return [name, item];
  }));
}

function repack(artifact) {
  artifact.bytes = Buffer.from(`${JSON.stringify(artifact.value, null, 2)}\n`, "utf8");
}

function cloneArtifacts(artifacts) {
  return pack(Object.fromEntries(Object.entries(artifacts).map(([name, item]) => [name, structuredClone(item.value)])));
}
