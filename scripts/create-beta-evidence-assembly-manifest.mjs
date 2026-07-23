import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  createBetaEvidenceAssemblyManifest,
  prepareEvaluationRoot,
  resolveEvaluationOutput
} from "./lib/beta-evidence-assembly.mjs";
import {
  knowledgeReviewerIdsFromEnvironment,
  knowledgeReviewerPolicySha256
} from "./check-knowledge-readiness.mjs";
import { parseFlagArgs } from "./lib/fact-review.mjs";

if (process.argv.includes("--self-test")) {
  const artifacts = minimalArtifacts();
  const knowledge = minimalKnowledge();
  const reviewerPolicySha256 = knowledgeReviewerPolicySha256(new Set(["fixture-human-reviewer"]));
  const manifest = createBetaEvidenceAssemblyManifest({ artifacts, ...knowledge, reviewerPolicySha256, now: new Date("2026-01-01T00:00:00.000Z") });
  if (manifest.evidenceOwner !== "" || manifest.assemblyApproved !== false || manifest.approvedAt !== "" ||
      Object.hasOwn(manifest, "accessibilityAudit") ||
      Object.values(manifest.artifacts).some((item) => !/^[a-f0-9]{64}$/.test(item.sha256)) ||
      Object.values(manifest.knowledge).some((digest) => !/^[a-f0-9]{64}$/.test(digest))) {
    throw new Error("Beta assembly manifest self-test pre-confirmed release evidence");
  }
  process.stdout.write("BETA_EVIDENCE_ASSEMBLY_MANIFEST_SELF_TEST=GO synthetic=1 releaseEvidence=0 pendingOwner=1 pendingApproval=1 directDeviceClaims=0 directAccessibilityClaims=0 artifactBindings=8 knowledgeByteBindings=2 reviewerPolicyBinding=1 deploymentReceiptBinding=1\n");
  process.exit(0);
}

const args = parseFlagArgs(process.argv.slice(2));
const [artifacts, catalogBytes, backlogBytes] = await Promise.all([
  readArtifacts(args),
  readFile(path.resolve(process.cwd(), String(args.get("--catalog") ?? "knowledge/catalog.json"))),
  readFile(path.resolve(process.cwd(), String(args.get("--backlog") ?? "knowledge/topic-backlog.json")))
]);
const reviewerPolicySha256 = knowledgeReviewerPolicySha256(knowledgeReviewerIdsFromEnvironment());
const manifest = createBetaEvidenceAssemblyManifest({ artifacts, catalogBytes, backlogBytes, reviewerPolicySha256 });
if (!args.has("--write")) {
  process.stdout.write("BETA_EVIDENCE_ASSEMBLY_MANIFEST_PREVIEW=GO artifactBindings=8 knowledgeByteBindings=2 reviewerPolicyBinding=1 deploymentReceiptBinding=1 preconfirmed=0 releaseEvidence=0 wrote=0\n");
  process.exit(0);
}
const evaluationRoot = await prepareEvaluationRoot(process.cwd());
const output = await resolveEvaluationOutput(
  evaluationRoot,
  path.resolve(process.cwd(), String(args.get("--output") ?? "evaluation/beta-evidence-assembly-manifest.json"))
);
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
process.stdout.write(`BETA_EVIDENCE_ASSEMBLY_MANIFEST=GO artifactBindings=8 knowledgeByteBindings=2 reviewerPolicyBinding=1 deploymentReceiptBinding=1 preconfirmed=0 releaseEvidence=0 shaBound=1 wrote=1\n`);

async function readArtifacts(args) {
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
    const bytes = await readFile(path.resolve(process.cwd(), file));
    return [name, { bytes, value: JSON.parse(bytes.toString("utf8")) }];
  })));
}

function minimalArtifacts() {
  const generatedAt = "2026-01-01T00:00:00.000Z";
  return pack({
    imageEvaluation: { schemaVersion: 1, evidenceKind: "compiled_image_evaluation", generatedAt, evaluationProvenance: {}, metrics: {}, evaluationSamples: [] },
    cardAudit: { schemaVersion: 1, evidenceKind: "compiled_card_audit", generatedAt, cardAuditProvenance: {}, metrics: {}, cardAudits: [] },
    betaCohort: { schemaVersion: 1, evidenceKind: "compiled_beta_cohort", generatedAt, betaProvenance: {}, beta: {} },
    cloudVerification: { schemaVersion: 1, evidenceKind: "verified_cloud_run", generatedAt, cloudProvenance: {}, checks: {}, cloud: {} },
    releaseArtifact: {
      evidenceKind: "verified_release_apk", formalSigning: false, debugCertificate: true,
      apkSha256: "", signerCertificateSha256: "", packageName: "cn.jianwei.app", versionName: "",
      versionCode: 0, verifiedAt: generatedAt, evidenceRef: ""
    },
    physicalDeviceRuns: {
      schemaVersion: 1,
      evidenceKind: "compiled_physical_device_runs",
      generatedAt,
      physicalDeviceRunProvenance: {},
      deviceRuns: []
    },
    accessibilityAudit: {
      schemaVersion: 1,
      evidenceKind: "compiled_accessibility_audit",
      generatedAt,
      accessibilityAuditProvenance: {},
      accessibilityAudit: {}
    },
    deploymentReceipt: {
      schemaVersion: 1,
      evidenceKind: "trusted_deployment_receipt",
      policyId: "synthetic-policy",
      policySha256: "a".repeat(64),
      issuerId: "synthetic-deployment-issuer",
      keyId: "synthetic-deployment-key",
      role: "beta_deployment_attestor",
      endpointOrigin: "https://beta.jianwei.example",
      deploymentRevision: "synthetic-deployment-revision",
      containerImageDigest: `sha256:${"b".repeat(64)}`,
      backendReleaseSha256: "c".repeat(64),
      deployedAt: generatedAt,
      issuedAt: generatedAt,
      signatureBase64: "AA=="
    }
  });
}

function pack(values) {
  return Object.fromEntries(Object.entries(values).map(([name, value]) => {
    const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    return [name, { bytes, value }];
  }));
}

function minimalKnowledge() {
  return {
    catalogBytes: Buffer.from('{"version":"fixture","topics":[],"sources":[]}\n', "utf8"),
    backlogBytes: Buffer.from('{"schemaVersion":1,"controlledTopics":[]}\n', "utf8")
  };
}
