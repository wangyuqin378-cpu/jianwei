import { createHash } from "node:crypto";
import { access, lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { assessEvidence } from "../check-beta-readiness.mjs";
import { assessKnowledge, knowledgeReviewerPolicySha256 } from "../check-knowledge-readiness.mjs";
import { assertAccountableReviewerId, assertExactKeys } from "./fact-review.mjs";
import { validateCompiledAccessibilityArtifact } from "./accessibility-audit.mjs";
import { validateCompiledPhysicalDeviceArtifact } from "./physical-device-runs.mjs";
import { verifyDeploymentReceipt } from "./deployment-receipt.mjs";

const MANIFEST_KIND = "beta_evidence_assembly_manifest";
const ARTIFACT_NAMES = [
  "imageEvaluation", "cardAudit", "betaCohort", "cloudVerification", "releaseArtifact",
  "physicalDeviceRuns", "accessibilityAudit", "deploymentReceipt"
];
const ARTIFACT_KINDS = {
  imageEvaluation: "compiled_image_evaluation",
  cardAudit: "compiled_card_audit",
  betaCohort: "compiled_beta_cohort",
  cloudVerification: "verified_cloud_run",
  releaseArtifact: "verified_release_apk",
  physicalDeviceRuns: "compiled_physical_device_runs",
  accessibilityAudit: "compiled_accessibility_audit",
  deploymentReceipt: "trusted_deployment_receipt"
};
const ARTIFACT_TOP_LEVEL_KEYS = {
  imageEvaluation: ["schemaVersion", "evidenceKind", "generatedAt", "evaluationProvenance", "metrics", "evaluationSamples"],
  cardAudit: ["schemaVersion", "evidenceKind", "generatedAt", "cardAuditProvenance", "metrics", "cardAudits"],
  betaCohort: ["schemaVersion", "evidenceKind", "generatedAt", "betaProvenance", "beta"],
  cloudVerification: ["schemaVersion", "evidenceKind", "generatedAt", "cloudProvenance", "checks", "cloud"],
  releaseArtifact: [
    "evidenceKind", "formalSigning", "debugCertificate", "apkSha256", "signerCertificateSha256",
    "packageName", "versionName", "versionCode", "verifiedAt", "evidenceRef"
  ],
  physicalDeviceRuns: ["schemaVersion", "evidenceKind", "generatedAt", "physicalDeviceRunProvenance", "deviceRuns"],
  accessibilityAudit: ["schemaVersion", "evidenceKind", "generatedAt", "accessibilityAuditProvenance", "accessibilityAudit"],
  deploymentReceipt: [
    "schemaVersion", "evidenceKind", "policyId", "policySha256", "issuerId", "keyId", "role",
    "endpointOrigin", "deploymentRevision", "containerImageDigest", "backendReleaseSha256",
    "deployedAt", "issuedAt", "signatureBase64"
  ]
};
const CLOUD_CHECK_KEYS = [
  "httpsReady", "qwenProvider", "catalogPinned", "safeObjectObserved", "safeTerminalStatus",
  "safeImmediateDelete", "sensitiveObjectObserved", "serverSensitiveRejected", "sensitiveErrorCode",
  "sensitiveImmediateDelete", "lifecyclePolicyVerified", "versioningDisabled", "deviceDataDeleteVerified",
  "bearerInvalidated"
];
const OUTPUT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{2,96}\.json$/;

export function createBetaEvidenceAssemblyManifest({ artifacts, catalogBytes, backlogBytes, reviewerPolicySha256, now = new Date() }) {
  assertValidDate(now, "Manifest creation time");
  validateArtifacts(artifacts);
  parseExactJsonBytes(catalogBytes, "Knowledge catalog");
  parseExactJsonBytes(backlogBytes, "Topic backlog");
  if (!/^[a-f0-9]{64}$/.test(reviewerPolicySha256 ?? "")) {
    throw new Error("Protected knowledge reviewer policy SHA-256 is required");
  }
  return {
    schemaVersion: 3,
    evidenceKind: MANIFEST_KIND,
    createdAt: now.toISOString(),
    evidenceOwner: "",
    assemblyApproved: false,
    approvedAt: "",
    knowledge: {
      catalogSha256: sha256Bytes(catalogBytes),
      topicBacklogSha256: sha256Bytes(backlogBytes),
      reviewerPolicySha256
    },
    artifacts: Object.fromEntries(ARTIFACT_NAMES.map((name) => [name, {
      evidenceKind: ARTIFACT_KINDS[name],
      sha256: sha256Bytes(artifacts[name].bytes)
    }]))
  };
}

export function assembleBetaEvidence({
  manifest,
  manifestSha256,
  artifacts,
  deploymentPolicy,
  deploymentPolicyBytes,
  catalog,
  catalogBytes,
  backlog,
  backlogBytes,
  now = new Date(),
  knowledgeReadiness = null,
  approvedReviewerIds = null
}) {
  assertValidDate(now, "Assembly time");
  validateManifest(manifest, manifestSha256, now);
  validateArtifacts(artifacts);
  validateArtifactBindings(manifest, artifacts);
  validateKnowledgeBindings(manifest, catalog, catalogBytes, backlog, backlogBytes, approvedReviewerIds);
  validateArtifactTimes(manifest, artifacts);
  validateCloudRunDigest(artifacts.cloudVerification.value);
  const verifiedDeploymentReceipt = verifyDeploymentReceipt({
    receipt: artifacts.deploymentReceipt.value,
    receiptBytes: artifacts.deploymentReceipt.bytes,
    policy: deploymentPolicy,
    policyBytes: deploymentPolicyBytes,
    now
  });
  validateDeploymentReceiptBinding(verifiedDeploymentReceipt, artifacts.cloudVerification.value);
  validateExternalArtifacts(
    manifest,
    artifacts.physicalDeviceRuns.value,
    artifacts.accessibilityAudit.value,
    now
  );

  const image = artifacts.imageEvaluation.value;
  const cards = artifacts.cardAudit.value;
  const cohort = artifacts.betaCohort.value;
  const cloud = artifacts.cloudVerification.value;
  const release = artifacts.releaseArtifact.value;
  const evidence = {
    schemaVersion: 3,
    evidenceKind: "real_beta_evidence",
    evidenceOwner: manifest.evidenceOwner,
    generatedAt: now.toISOString(),
    assemblyProvenance: {
      evidenceKind: "verified_beta_evidence_assembly",
      manifestSha256,
      artifactCount: ARTIFACT_NAMES.length,
      knowledgeCatalogSha256: manifest.knowledge.catalogSha256,
      topicBacklogSha256: manifest.knowledge.topicBacklogSha256,
      knowledgeReviewerPolicySha256: manifest.knowledge.reviewerPolicySha256,
      deploymentReceiptSha256: verifiedDeploymentReceipt.receiptSha256,
      deploymentPolicySha256: verifiedDeploymentReceipt.policySha256
    },
    evaluationProvenance: structuredClone(image.evaluationProvenance),
    evaluationSamples: structuredClone(image.evaluationSamples),
    cardAuditProvenance: structuredClone(cards.cardAuditProvenance),
    cardAudits: structuredClone(cards.cardAudits),
    deviceRuns: structuredClone(artifacts.physicalDeviceRuns.value.deviceRuns),
    betaProvenance: structuredClone(cohort.betaProvenance),
    beta: structuredClone(cohort.beta),
    cloudProvenance: structuredClone(cloud.cloudProvenance),
    cloud: structuredClone(cloud.cloud),
    releaseArtifact: structuredClone(release),
    accessibilityAudit: structuredClone(artifacts.accessibilityAudit.value.accessibilityAudit)
  };

  const readiness = knowledgeReadiness ?? assessKnowledge(catalog, backlog, now, approvedReviewerIds);
  const topicIds = new Set(Array.isArray(catalog?.topics) ? catalog.topics.map((topic) => topic.topicId) : []);
  const assessment = assessEvidence(evidence, {
    now,
    catalogVersion: catalog?.version ?? null,
    catalogTopicIds: topicIds,
    knowledgeReadiness: readiness,
    requireTrustedAssembly: false,
    // Assembly proves deterministic content and cross-artifact binding. The release gate separately
    // requires an Ed25519 attestation over the exact output bytes before it can return GO.
    requireTrustedAttestation: false
  });
  if (assessment.status !== "GO") {
    throw new Error(`Final Beta gate rejected assembled evidence:\n${assessment.blockers.join("\n")}`);
  }
  return { evidence, assessment, verifiedDeploymentReceipt };
}

export async function prepareEvaluationRoot(workspaceRoot) {
  const evaluationRoot = path.join(path.resolve(workspaceRoot), "evaluation");
  await mkdir(evaluationRoot, { recursive: true });
  await assertOrdinaryDirectory(evaluationRoot);
  return evaluationRoot;
}

export async function resolveEvaluationOutput(evaluationRoot, value, { allowExisting = false } = {}) {
  const root = path.resolve(evaluationRoot);
  await assertOrdinaryDirectory(root);
  const output = path.resolve(value);
  if (!samePath(path.dirname(output), root) || !OUTPUT_NAME.test(path.basename(output))) {
    throw new Error("Beta evidence output must be a simple JSON filename directly under evaluation");
  }
  if (!allowExisting) {
    try {
      await access(output);
      throw new Error("Beta evidence output already exists and will not be overwritten");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return output;
}

export function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function validateManifest(manifest, manifestSha256, now) {
  assertExactKeys(manifest, [
    "schemaVersion", "evidenceKind", "createdAt", "evidenceOwner", "assemblyApproved", "approvedAt",
    "knowledge", "artifacts"
  ], "Beta evidence assembly manifest");
  if (manifest.schemaVersion !== 3 || manifest.evidenceKind !== MANIFEST_KIND) {
    throw new Error("Beta evidence assembly manifest schema or evidence kind is invalid");
  }
  if (!/^[a-f0-9]{64}$/.test(manifestSha256 ?? "")) throw new Error("Exact assembly manifest SHA-256 is required");
  assertAccountableReviewerId(manifest.evidenceOwner);
  if (manifest.assemblyApproved !== true) throw new Error("Assembly manifest requires explicit accountable-human approval");
  const createdAt = strictIso(manifest.createdAt);
  const approvedAt = strictIso(manifest.approvedAt);
  if (!createdAt || !approvedAt || createdAt > approvedAt || approvedAt > now) {
    throw new Error("Assembly manifest creation/approval timestamps are invalid");
  }
  assertExactKeys(manifest.knowledge, ["catalogSha256", "topicBacklogSha256", "reviewerPolicySha256"], "Assembly knowledge bindings");
  if (!/^[a-f0-9]{64}$/.test(manifest.knowledge.catalogSha256 ?? "") ||
      !/^[a-f0-9]{64}$/.test(manifest.knowledge.topicBacklogSha256 ?? "") ||
      !/^[a-f0-9]{64}$/.test(manifest.knowledge.reviewerPolicySha256 ?? "")) {
    throw new Error("Assembly knowledge bindings must contain exact SHA-256 digests");
  }
  assertExactKeys(manifest.artifacts, ARTIFACT_NAMES, "Assembly artifact bindings");
  for (const name of ARTIFACT_NAMES) {
    assertExactKeys(manifest.artifacts[name], ["evidenceKind", "sha256"], `Assembly artifact binding ${name}`);
    if (manifest.artifacts[name].evidenceKind !== ARTIFACT_KINDS[name] ||
        !/^[a-f0-9]{64}$/.test(manifest.artifacts[name].sha256 ?? "")) {
      throw new Error(`Assembly artifact binding is invalid: ${name}`);
    }
  }
}

function validateKnowledgeBindings(manifest, catalog, catalogBytes, backlog, backlogBytes, approvedReviewerIds) {
  const parsedCatalog = parseExactJsonBytes(catalogBytes, "Knowledge catalog");
  const parsedBacklog = parseExactJsonBytes(backlogBytes, "Topic backlog");
  if (JSON.stringify(parsedCatalog) !== JSON.stringify(catalog) ||
      JSON.stringify(parsedBacklog) !== JSON.stringify(backlog)) {
    throw new Error("Parsed knowledge inputs do not match their exact SHA-bound bytes");
  }
  if (sha256Bytes(catalogBytes) !== manifest.knowledge.catalogSha256 ||
      sha256Bytes(backlogBytes) !== manifest.knowledge.topicBacklogSha256) {
    throw new Error("Knowledge catalog or topic backlog changed after human manifest approval");
  }
  if (knowledgeReviewerPolicySha256(approvedReviewerIds) !== manifest.knowledge.reviewerPolicySha256) {
    throw new Error("Protected knowledge reviewer allowlist changed after human manifest approval");
  }
}

function parseExactJsonBytes(bytes, label) {
  if (!Buffer.isBuffer(bytes)) throw new Error(`${label} exact bytes are required`);
  try {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value;
  } catch {
    throw new Error(`${label} bytes are not valid UTF-8 JSON objects`);
  }
}

function validateArtifacts(artifacts) {
  assertExactKeys(artifacts, ARTIFACT_NAMES, "Beta component artifacts");
  for (const name of ARTIFACT_NAMES) {
    const artifact = artifacts[name];
    if (!Buffer.isBuffer(artifact?.bytes) || !artifact.value || typeof artifact.value !== "object" || Array.isArray(artifact.value)) {
      throw new Error(`Beta component artifact is missing bytes or parsed value: ${name}`);
    }
    let parsed;
    try {
      parsed = JSON.parse(artifact.bytes.toString("utf8"));
    } catch {
      throw new Error(`Beta component artifact bytes are not valid JSON: ${name}`);
    }
    if (JSON.stringify(parsed) !== JSON.stringify(artifact.value)) {
      throw new Error(`Beta component artifact parsed value does not match its SHA-bound bytes: ${name}`);
    }
    assertExactKeys(artifact.value, ARTIFACT_TOP_LEVEL_KEYS[name], `Beta component artifact ${name}`);
    if (artifact.value.evidenceKind !== ARTIFACT_KINDS[name] ||
        (name !== "releaseArtifact" && artifact.value.schemaVersion !== 1)) {
      throw new Error(`Beta component artifact schema or evidence kind is invalid: ${name}`);
    }
  }
}

function validateArtifactBindings(manifest, artifacts) {
  for (const name of ARTIFACT_NAMES) {
    if (sha256Bytes(artifacts[name].bytes) !== manifest.artifacts[name].sha256) {
      throw new Error(`Beta component artifact SHA-256 changed after human manifest approval: ${name}`);
    }
  }
}

function validateArtifactTimes(manifest, artifacts) {
  const approvedAt = strictIso(manifest.approvedAt);
  for (const name of ARTIFACT_NAMES) {
    const value = artifacts[name].value;
    const timestamp = strictIso(name === "releaseArtifact" ? value.verifiedAt :
      name === "deploymentReceipt" ? value.issuedAt : value.generatedAt);
    if (!timestamp || timestamp > approvedAt) {
      throw new Error(`Beta component artifact was generated after manifest approval or has an invalid timestamp: ${name}`);
    }
  }
}

function validateDeploymentReceiptBinding(receipt, cloudArtifact) {
  const provenance = cloudArtifact.cloudProvenance;
  const cloud = cloudArtifact.cloud;
  const expected = [
    [receipt.receiptSha256, provenance.deploymentReceiptSha256, "exact receipt SHA-256"],
    [receipt.policySha256, provenance.deploymentPolicySha256, "trust-policy SHA-256"],
    [receipt.issuerId, provenance.deploymentIssuerId, "deployment issuer"],
    [receipt.keyId, provenance.deploymentKeyId, "deployment key"],
    [receipt.endpointOrigin, provenance.baseUrlOrigin, "HTTPS endpoint"],
    [receipt.deploymentRevision, provenance.deploymentRevision, "deployment revision"],
    [receipt.containerImageDigest, provenance.containerImageDigest, "OCI image digest"],
    [receipt.containerImageDigest, cloud.containerImageDigest, "cloud-observed OCI image digest"],
    [receipt.backendReleaseSha256, provenance.backendReleaseSha256, "backend Release identity"],
    [receipt.backendReleaseSha256, cloud.backendReleaseSha256, "cloud-observed backend Release identity"]
  ];
  for (const [trusted, claimed, label] of expected) {
    if (trusted !== claimed) throw new Error(`Verified deployment receipt does not match cloud artifact ${label}`);
  }
}

function validateExternalArtifacts(manifest, physicalDeviceArtifact, accessibilityArtifact, now) {
  const approvedAt = strictIso(manifest.approvedAt);
  validateCompiledPhysicalDeviceArtifact(physicalDeviceArtifact, approvedAt, now);
  validateCompiledAccessibilityArtifact(accessibilityArtifact, physicalDeviceArtifact, approvedAt, now);
}

function validateCloudRunDigest(artifact) {
  const provenance = artifact.cloudProvenance;
  const cloud = artifact.cloud;
  const checks = artifact.checks;
  assertExactKeys(checks, CLOUD_CHECK_KEYS, "Verified cloud checks");
  const requiredTrue = [
    "httpsReady", "qwenProvider", "catalogPinned", "safeObjectObserved", "safeImmediateDelete",
    "sensitiveObjectObserved", "serverSensitiveRejected", "sensitiveImmediateDelete",
    "lifecyclePolicyVerified", "versioningDisabled", "deviceDataDeleteVerified", "bearerInvalidated"
  ];
  if (!requiredTrue.every((key) => checks[key] === true) ||
      !["completed", "needs_content"].includes(checks.safeTerminalStatus) ||
      !/^server_sensitive_/.test(checks.sensitiveErrorCode ?? "")) {
    throw new Error("Verified cloud artifact contains an incomplete or unsafe check set");
  }
  const payload = [
    "jianwei-verified-cloud-run-v5",
    provenance.runId,
    provenance.baseUrlOrigin,
    provenance.appVersion,
    provenance.releaseApkSha256,
    provenance.backendReleaseSha256,
    provenance.containerImageDigest,
    provenance.deploymentReceiptSha256,
    provenance.deploymentPolicySha256,
    provenance.deploymentIssuerId,
    provenance.deploymentKeyId,
    provenance.deploymentRevision,
    provenance.modelVersion,
    provenance.catalogVersion,
    provenance.safeFixtureSha256,
    provenance.sensitiveFixtureSha256,
    provenance.expectedSensitiveType,
    cloud.ttlHours,
    provenance.verifiedAt,
    checks
  ];
  if (sha256Bytes(Buffer.from(JSON.stringify(payload), "utf8")) !== provenance.runSha256) {
    throw new Error("Verified cloud run digest does not match its canonical checks");
  }
}

async function assertOrdinaryDirectory(directory) {
  const resolved = path.resolve(directory);
  const info = await lstat(resolved);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Controlled path must be an ordinary directory: ${resolved}`);
  const actual = await realpath(resolved);
  if (!samePath(actual, resolved)) throw new Error(`Controlled directory cannot resolve through a symlink or junction: ${resolved}`);
}

function samePath(left, right) {
  const normalize = (value) => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
  return normalize(left) === normalize(right);
}

function strictIso(value) {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? parsed : null;
}

function assertValidDate(value, label) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error(`${label} is invalid`);
}
