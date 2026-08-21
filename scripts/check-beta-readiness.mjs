import { lstat, readFile, realpath } from "node:fs/promises";
import { generateKeyPairSync, sign } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assessKnowledge, knowledgeReviewerIdsFromEnvironment } from "./check-knowledge-readiness.mjs";
import {
  sha256Bytes,
  validateEvidenceTrustPolicy,
  verifyEvidenceAttestation
} from "./lib/evidence-attestation.mjs";
import { verifyAssemblyAttestation } from "./lib/assembly-attestation.mjs";
import {
  deploymentReceiptSignaturePayload,
  verifyDeploymentReceipt
} from "./lib/deployment-receipt.mjs";
import { isMainModule } from "./lib/main-module.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const AUTOMATION_ID = /(?:codex|chatgpt|gpt|kimi|moonshot|qwen|claude|gemini|llama|automation|robot)/i;
const SENSITIVE_TYPES = new Set([
  "face", "selfie", "identity_document", "bank_card", "receipt", "document", "high_text_density", "screenshot"
]);

export function assessEvidence(evidence, {
  allowSynthetic = false,
  now = new Date(),
  catalogVersion = null,
  catalogTopicIds = null,
  knowledgeReadiness = null,
  requireTrustedAttestation = true,
  requireTrustedAssembly = true,
  trustedReleaseAttestation = null,
  trustedAssembly = null
} = {}) {
  const blockers = [];
  check(exactObjectKeys(evidence, [
    "schemaVersion", "evidenceKind", "evidenceOwner", "generatedAt", "assemblyProvenance", "evaluationProvenance",
    "evaluationSamples", "cardAuditProvenance", "cardAudits", "deviceRuns", "betaProvenance",
    "beta", "cloudProvenance", "cloud", "releaseArtifact", "accessibilityAudit"
  ]), "Beta evidence top-level schema contains unknown or missing fields", blockers);
  check(!containsForbiddenEvidenceData(evidence), "Beta evidence contains a forbidden credential, private identifier, object key, image/path field or local path", blockers);
  check(evidence?.schemaVersion === 3, "evidence schemaVersion must be 3", blockers);
  check(
    evidence?.evidenceKind === "real_beta_evidence" || (allowSynthetic && evidence?.evidenceKind === "synthetic_self_test"),
    "evidenceKind must be real_beta_evidence",
    blockers
  );
  check(
    !requireTrustedAttestation || (trustedReleaseAttestation?.verified === true &&
      trustedReleaseAttestation.role === "beta_release_approver" &&
      validToken(trustedReleaseAttestation.issuerId) && validToken(trustedReleaseAttestation.keyId) &&
      /^[a-f0-9]{64}$/.test(trustedReleaseAttestation.publicKeySha256 ?? "")),
    "real Beta evidence requires a valid Ed25519 signature from a trusted beta_release_approver",
    blockers
  );
  const assembly = evidence?.assemblyProvenance ?? {};
  check(exactObjectKeys(assembly, [
    "evidenceKind", "manifestSha256", "artifactCount", "knowledgeCatalogSha256", "topicBacklogSha256",
    "knowledgeReviewerPolicySha256",
    "deploymentReceiptSha256", "deploymentPolicySha256"
  ]), "Beta evidence must contain exact deterministic-assembly provenance", blockers);
  check(assembly.evidenceKind === "verified_beta_evidence_assembly" &&
    /^[a-f0-9]{64}$/.test(assembly.manifestSha256 ?? "") && assembly.artifactCount === 8 &&
    /^[a-f0-9]{64}$/.test(assembly.knowledgeCatalogSha256 ?? "") &&
    /^[a-f0-9]{64}$/.test(assembly.topicBacklogSha256 ?? "") &&
    /^[a-f0-9]{64}$/.test(assembly.knowledgeReviewerPolicySha256 ?? "") &&
    /^[a-f0-9]{64}$/.test(assembly.deploymentReceiptSha256 ?? "") &&
    /^[a-f0-9]{64}$/.test(assembly.deploymentPolicySha256 ?? ""),
  "Beta evidence assembly provenance is invalid", blockers);
  check(!requireTrustedAssembly || (trustedAssembly?.verified === true &&
    trustedAssembly.role === "beta_assembly_attestor" &&
    validToken(trustedAssembly.issuerId) && validToken(trustedAssembly.keyId) &&
    /^[a-f0-9]{64}$/.test(trustedAssembly.publicKeySha256 ?? "") &&
    trustedAssembly.manifestSha256 === assembly.manifestSha256 &&
    trustedAssembly.artifactCount === assembly.artifactCount &&
    trustedAssembly.knowledgeCatalogSha256 === assembly.knowledgeCatalogSha256 &&
    trustedAssembly.topicBacklogSha256 === assembly.topicBacklogSha256 &&
    trustedAssembly.knowledgeReviewerPolicySha256 === assembly.knowledgeReviewerPolicySha256 &&
    trustedAssembly.deploymentReceiptSha256 === assembly.deploymentReceiptSha256 &&
    trustedAssembly.deploymentPolicySha256 === assembly.deploymentPolicySha256),
  "real Beta evidence requires an independent beta_assembly_attestor signature over the approved eight-artifact assembly", blockers);
  check(validHumanId(evidence?.evidenceOwner), "evidenceOwner must identify an accountable human", blockers);
  const generatedAt = strictIso(evidence?.generatedAt);
  check(generatedAt && generatedAt.getTime() <= now.getTime() + 5 * 60 * 1000, "generatedAt must be a valid non-future ISO timestamp", blockers);
  check(knowledgeReadiness?.status === "GO", "knowledge catalog readiness gate must be GO", blockers);
  if (knowledgeReadiness?.status !== "GO" && Array.isArray(knowledgeReadiness?.blockers)) {
    for (const blocker of knowledgeReadiness.blockers.slice(0, 10)) blockers.push(`knowledge: ${blocker}`);
  }

  const provenance = evidence.evaluationProvenance ?? {};
  check(validToken(provenance.datasetId), "evaluation provenance must identify the dataset", blockers);
  check(nonEmpty(provenance.labelEvidenceRef) && nonEmpty(provenance.resultEvidenceRef), "evaluation provenance must reference retained label and result evidence", blockers);
  check(/^[a-f0-9]{64}$/.test(provenance.labelEvidenceSha256 ?? "") && /^[a-f0-9]{64}$/.test(provenance.resultEvidenceSha256 ?? ""), "evaluation provenance must bind label and result SHA-256", blockers);
  check(validToken(provenance.runId), "evaluation provenance must identify the pipeline run", blockers);
  check(nonEmpty(provenance.appVersion) && nonEmpty(provenance.modelVersion) && nonEmpty(provenance.catalogVersion), "evaluation provenance must pin app, model and catalog versions", blockers);
  check(/^[a-f0-9]{64}$/.test(provenance.evaluationApkSha256 ?? ""), "evaluation provenance must bind the exact evaluation APK SHA-256", blockers);
  if (catalogVersion) check(provenance.catalogVersion === catalogVersion, "evaluation provenance catalogVersion is stale", blockers);
  const imageRunner = provenance.runnerProvenance ?? {};
  check(exactObjectKeys(imageRunner, [
    "evidenceKind", "reviewerId", "approvedAt", "appVersion", "evaluationApkSha256", "manufacturer", "model",
    "buildFingerprint", "apiLevel", "endpointOrigin"
  ]), "evaluation provenance must contain the exact Android runner record", blockers);
  check(imageRunner.evidenceKind === "android_authorized_image_runner", "evaluation must come from the Android authorized-image runner", blockers);
  check(validHumanId(imageRunner.reviewerId), "Android image runner must identify an accountable human reviewer", blockers);
  check(validPastTimestamp(imageRunner.approvedAt, generatedAt, now), "Android image runner must record a valid human approval time", blockers);
  check(imageRunner.appVersion === provenance.appVersion, "Android image runner App version must match evaluation provenance", blockers);
  check(imageRunner.evaluationApkSha256 === provenance.evaluationApkSha256, "Android image runner APK SHA-256 must match evaluation provenance", blockers);
  check(nonEmpty(imageRunner.manufacturer) && nonEmpty(imageRunner.model) && nonEmpty(imageRunner.buildFingerprint) &&
    !emulatorFingerprint(imageRunner.buildFingerprint), "Android image runner must identify a physical device", blockers);
  check(Number.isInteger(imageRunner.apiLevel) && imageRunner.apiLevel >= 26, "Android image runner API level is invalid", blockers);
  check(validPublicHttpsOrigin(imageRunner.endpointOrigin), "Android image runner must use a public origin-only HTTPS endpoint", blockers);

  const knownTopics = catalogTopicIds instanceof Set ? catalogTopicIds : null;
  const samples = array(evidence.evaluationSamples);
  const sensitive = samples.filter((item) => Array.isArray(item?.expectedSensitiveTypes) && item.expectedSensitiveTypes.length > 0);
  const scorable = samples.filter((item) => Array.isArray(item?.expectedSensitiveTypes) && item.expectedSensitiveTypes.length === 0 && typeof item.expectedTopicId === "string");
  const leaks = sensitive.filter((item) => item.leftDevice === true).length;
  const correct = scorable.filter((item) => item.predictedTopicId === item.expectedTopicId).length;
  const sensitiveLeakRate = ratio(leaks, sensitive.length);
  const top1Accuracy = ratio(correct, scorable.length);

  check(samples.length >= 300 && samples.length <= 500, "evaluation dataset must contain 300-500 samples", blockers);
  check(uniqueNonEmptyIds(samples, "sampleId"), "evaluation sample IDs must be present and unique", blockers);
  check(uniqueHexDigests(samples, "sampleSha256"), "evaluation image SHA-256 values must be present and unique", blockers);
  check(samples.every((item) => item.authorized === true), "every evaluation sample must have recorded authorization", blockers);
  check(samples.every((item) => nonEmpty(item.authorizationRef)), "every evaluation sample must reference a consent record", blockers);
  check(samples.every((item) => item.authorizationScope === "local_and_cloud_evaluation"), "every evaluation sample must authorize the complete local-and-cloud evaluation", blockers);
  check(samples.every((item) => validPastTimestamp(item.authorizedAt, generatedAt, now)), "every evaluation sample must record a valid authorization time", blockers);
  check(samples.every((item) => validHumanId(item.labelerId)), "every evaluation sample must identify an accountable human labeler", blockers);
  check(samples.every((item) => validPastTimestamp(item.labeledAt, generatedAt, now)), "every evaluation sample must record a valid label time", blockers);
  check(samples.every((item) => validPastTimestamp(item.evaluatedAt, generatedAt, now)), "every evaluation sample must record a valid evaluation time", blockers);
  check(samples.every((item) => item.pipelineCompleted === true), "every evaluation sample must complete the pipeline", blockers);
  check(samples.every((item) => typeof item.leftDevice === "boolean"), "every evaluation sample must explicitly record whether bytes left the device", blockers);
  check(samples.every((item) => validSensitiveTypes(item.expectedSensitiveTypes)), "evaluation samples contain invalid or duplicate sensitive types", blockers);
  check(samples.every((item) => {
    const isSensitive = item.expectedSensitiveTypes?.length > 0;
    return isSensitive ? item.expectedTopicId === null : typeof item.expectedTopicId === "string";
  }), "every evaluation sample must be either sensitive or a scorable recognition sample", blockers);
  check(samples.every((item) => item.predictedTopicId === null || typeof item.predictedTopicId === "string"), "predictedTopicId must be a topic string or null", blockers);
  if (knownTopics) {
    check(scorable.every((item) => knownTopics.has(item.expectedTopicId)), "evaluation samples contain an unknown expected topic", blockers);
    check(samples.every((item) => item.predictedTopicId === null || knownTopics.has(item.predictedTopicId)), "evaluation samples contain an unknown predicted topic", blockers);
  }
  check(sensitive.length + scorable.length === samples.length, "unscorable filler samples are not allowed", blockers);
  check(sensitive.length >= 100, "evaluation dataset must include at least 100 sensitive samples", blockers);
  check(scorable.length >= 100, "evaluation dataset must include at least 100 object-recognition samples", blockers);
  const sensitiveCounts = new Map([...SENSITIVE_TYPES].map((type) => [type, 0]));
  for (const item of sensitive) for (const type of item.expectedSensitiveTypes ?? []) sensitiveCounts.set(type, (sensitiveCounts.get(type) ?? 0) + 1);
  for (const [type, count] of sensitiveCounts) check(count >= 5, `sensitive evaluation must include at least 5 ${type} samples`, blockers);
  const recognitionCounts = new Map();
  for (const item of scorable) recognitionCounts.set(item.expectedTopicId, (recognitionCounts.get(item.expectedTopicId) ?? 0) + 1);
  check(recognitionCounts.size >= 25, "recognition evaluation must cover at least 25 topics", blockers);
  check([...recognitionCounts.values()].every((count) => count >= 3), "every recognition topic must have at least 3 samples", blockers);
  check(sensitiveLeakRate < 0.01, "sensitive-image upload leak rate must be below 1%", blockers);
  check(top1Accuracy >= 0.9, "object Top-1 accuracy must be at least 90%", blockers);

  const cardProvenance = evidence.cardAuditProvenance ?? {};
  check(exactObjectKeys(cardProvenance, [
    "runId", "auditMode", "policyVersion", "snapshotEvidenceRef", "snapshotEvidenceSha256",
    "appVersion", "releaseApkSha256", "backendReleaseSha256", "modelVersion", "catalogVersion"
  ]), "card audit provenance schema is invalid", blockers);
  check(validToken(cardProvenance.runId), "card audit provenance must identify the generation run", blockers);
  check(
    cardProvenance.auditMode === "automatic_derived" &&
      cardProvenance.policyVersion === "derived-ai-reviewed-card-v2",
    "card audit must use the automatic derived-card policy",
    blockers
  );
  check(nonEmpty(cardProvenance.snapshotEvidenceRef), "card audit provenance must reference retained snapshots", blockers);
  check(/^[a-f0-9]{64}$/.test(cardProvenance.snapshotEvidenceSha256 ?? ""), "card audit provenance must bind the snapshot SHA-256", blockers);
  check(nonEmpty(cardProvenance.appVersion) && nonEmpty(cardProvenance.modelVersion) && nonEmpty(cardProvenance.catalogVersion), "card audit provenance must pin app, model and catalog versions", blockers);
  check(/^[a-f0-9]{64}$/.test(cardProvenance.releaseApkSha256 ?? ""), "card audit provenance must bind the Release APK SHA-256", blockers);
  check(/^[a-f0-9]{64}$/.test(cardProvenance.backendReleaseSha256 ?? ""), "card audit provenance must bind the backend Release SHA-256", blockers);
  if (catalogVersion) check(cardProvenance.catalogVersion === catalogVersion, "card audit provenance catalogVersion is stale", blockers);

  const cards = array(evidence.cardAudits);
  const automaticCardKeys = [
    "cardId", "cardSha256", "sourceUrls", "riskLevel", "automaticallyReviewed", "policyVersion",
    "catalogReviewModel", "catalogReviewEvidenceSha256", "catalogFactMatched", "catalogAiReviewBound",
    "bodyMatchesFact", "sourceSetMatchesCatalog", "titleMatchesPolicy", "personalContextMatchesPolicy",
    "automaticPolicyPassed"
  ];
  check(cards.length >= 200, "at least 200 generated cards must pass automatic derived-card verification", blockers);
  check(cards.every((card) => exactObjectKeys(card, automaticCardKeys)), "automatic card audit rows have an invalid schema", blockers);
  check(uniqueNonEmptyIds(cards, "cardId"), "verified card IDs must be present and unique", blockers);
  check(uniqueHexDigests(cards, "cardSha256"), "verified card SHA-256 values must be present and unique", blockers);
  check(cards.every((card) => card.automaticallyReviewed === true && card.policyVersion === cardProvenance.policyVersion), "every card must use the pinned automatic review policy", blockers);
  check(cards.every((card) => /^qwen[0-9a-z._-]{2,95}$/i.test(card.catalogReviewModel ?? "") && /^[a-f0-9]{64}$/.test(card.catalogReviewEvidenceSha256 ?? "")), "every card must bind an approved Qwen catalog review", blockers);
  check(cards.every((card) => array(card.sourceUrls).length > 0), "every verified card must contain a source", blockers);
  check(cards.every((card) => array(card.sourceUrls).every((url) => /^https:\/\//.test(url))), "all verified source URLs must use HTTPS", blockers);
  check(cards.every((card) => card.riskLevel === "general"), "health and safety cards must not enter the automatic first-release pool", blockers);
  check(cards.every((card) => card.catalogFactMatched === true && card.catalogAiReviewBound === true), "every card must bind an approved AI-reviewed fact in the pinned catalog", blockers);
  check(cards.every((card) => card.bodyMatchesFact === true && card.sourceSetMatchesCatalog === true), "every card body and source set must equal the pinned reviewed fact", blockers);
  check(cards.every((card) => card.titleMatchesPolicy === true && card.personalContextMatchesPolicy === true), "every card title and personal context must match deterministic product policy", blockers);
  check(cards.every((card) => card.automaticPolicyPassed === true), "every generated card must pass the complete automatic policy", blockers);

  const devices = array(evidence.deviceRuns);
  check(uniqueNonEmptyIds(devices, "runId"), "device run IDs must be present and unique", blockers);
  check(devices.every((item) => item.physicalDevice === true), "every OEM run must use a physical device", blockers);
  check(devices.every((item) => nonEmpty(item.model) && nonEmpty(item.buildFingerprint)), "every device run must identify model and build fingerprint", blockers);
  check(devices.every((item) => nonEmpty(item.appVersion)), "every device run must identify the tested app version", blockers);
  check(devices.every((item) => /^[a-f0-9]{64}$/.test(item.apkSha256 ?? "")), "every device run must identify the tested APK SHA-256", blockers);
  check(devices.every((item) => validPastTimestamp(item.testedAt, generatedAt, now) && nonEmpty(item.evidenceRef)), "every device run must reference dated retained evidence", blockers);
  const manufacturers = new Set(devices.map((item) => String(item.manufacturer).toLowerCase()));
  check(manufacturers.has("huawei"), "device matrix must include Huawei", blockers);
  check(manufacturers.has("xiaomi"), "device matrix must include Xiaomi", blockers);
  check(manufacturers.has("oppo") || manufacturers.has("vivo"), "device matrix must include OPPO or vivo", blockers);
  check(
    devices.every((item) => item.scanPassed && item.backgroundPassed && item.widgetOfflineDays >= 7 && item.deletePassed),
    "every device run must pass scan, background, seven-day widget cache, and deletion checks",
    blockers
  );
  const api34Modes = new Set(
    devices.filter((item) => item.apiLevel >= 34).map((item) => String(item.permissionMode).toUpperCase())
  );
  for (const mode of ["FULL", "PARTIAL", "DENIED"]) {
    check(api34Modes.has(mode), `Android 14+ device evidence must cover ${mode} photo access`, blockers);
  }

  const beta = evidence.beta ?? {};
  const betaProvenance = evidence.betaProvenance ?? {};
  check(betaProvenance.evidenceKind === "compiled_beta_cohort", "Beta metrics must come from the cohort compiler", blockers);
  check(validToken(betaProvenance.reportSetId), "Beta cohort provenance must identify the report set", blockers);
  check(nonEmpty(betaProvenance.reportsEvidenceRef) && nonEmpty(betaProvenance.manifestEvidenceRef), "Beta cohort provenance must reference retained reports and manifest evidence", blockers);
  check(/^[a-f0-9]{64}$/.test(betaProvenance.reportsSha256 ?? "") && /^[a-f0-9]{64}$/.test(betaProvenance.manifestSha256 ?? ""), "Beta cohort provenance must bind report-set and manifest SHA-256", blockers);
  check(Number.isInteger(betaProvenance.reportCount) && betaProvenance.reportCount > 0 && betaProvenance.reportCount === beta.onboardingCompleted, "Beta cohort provenance report count must match the compiled denominator", blockers);
  check(nonEmpty(betaProvenance.appVersion), "Beta cohort provenance must identify the app version", blockers);
  check(/^[a-f0-9]{64}$/.test(betaProvenance.apkSha256 ?? ""), "Beta cohort provenance must identify the APK SHA-256", blockers);
  check(validPastTimestamp(betaProvenance.compiledAt, generatedAt, now), "Beta cohort provenance must record a valid compile time", blockers);
  const widgetAddRate = ratio(beta.widgetAdded, beta.onboardingCompleted);
  const engagementRate = ratio(beta.engaged7dUsers, beta.onboardingCompleted);
  const likeRate = ratio(beta.likeCount, beta.feedbackCount);
  const timings = array(beta.firstCardSeconds).filter(Number.isFinite).sort((a, b) => a - b);
  const p50 = percentile(timings, 0.5);
  const p95 = percentile(timings, 0.95);
  check(beta.grayUsers >= 10 && beta.grayDays >= 3, "gray cohort must include at least 10 users for 3 days", blockers);
  check(beta.expandedUsers >= 20 && beta.expandedUsers <= 50, "expanded Beta cohort must include 20-50 users", blockers);
  check(widgetAddRate >= 0.6, "widget add rate must be at least 60%", blockers);
  check(engagementRate >= 0.4, "7-day click-or-feedback rate must be at least 40%", blockers);
  check(likeRate >= 0.5, "LIKE share of feedback must be at least 50%", blockers);
  check(timings.length >= 20 && p50 < 90 && p95 < 180, "first-card latency must have 20+ samples with P50 <90s and P95 <180s", blockers);
  check(nonEmpty(beta.evidenceRef) && validPastTimestamp(beta.measuredAt, generatedAt, now), "Beta metrics must reference dated retained cohort evidence", blockers);
  check(Number.isInteger(beta.onboardingCompleted) && beta.onboardingCompleted > 0, "onboardingCompleted must be a positive integer", blockers);
  check(beta.widgetAdded <= beta.onboardingCompleted && beta.engaged7dUsers <= beta.onboardingCompleted, "Beta user counts must be internally consistent", blockers);
  check(beta.likeCount <= beta.feedbackCount, "LIKE count cannot exceed feedback count", blockers);

  const cloud = evidence.cloud ?? {};
  const cloudProvenance = evidence.cloudProvenance ?? {};
  check(cloudProvenance.evidenceKind === "verified_cloud_run", "cloud evidence must come from the verified cloud workflow", blockers);
  check(validToken(cloudProvenance.runId), "cloud provenance must identify the run", blockers);
  check(/^[a-f0-9]{64}$/.test(cloudProvenance.runSha256 ?? ""), "cloud provenance must bind the canonical run digest", blockers);
  check(nonEmpty(cloudProvenance.evidenceRef) && cloudProvenance.evidenceRef === cloud.evidenceRef, "cloud provenance must bind the same retained evidence reference", blockers);
  check(validHttpsOrigin(cloudProvenance.baseUrlOrigin), "cloud provenance must identify an origin-only HTTPS deployment", blockers);
  check(imageRunner.endpointOrigin === cloudProvenance.baseUrlOrigin, "Android image runner must use the same verified cloud deployment origin", blockers);
  check(/^[a-f0-9]{64}$/.test(cloudProvenance.safeFixtureSha256 ?? "") && /^[a-f0-9]{64}$/.test(cloudProvenance.sensitiveFixtureSha256 ?? "") && cloudProvenance.safeFixtureSha256 !== cloudProvenance.sensitiveFixtureSha256, "cloud provenance must bind distinct safe and sensitive fixture SHA-256 values", blockers);
  check(SENSITIVE_TYPES.has(cloudProvenance.expectedSensitiveType), "cloud provenance expected sensitive type is invalid", blockers);
  check(cloudProvenance.appVersion === cloud.appVersion && cloudProvenance.releaseApkSha256 === cloud.releaseApkSha256 &&
    cloudProvenance.backendReleaseSha256 === cloud.backendReleaseSha256 &&
    cloudProvenance.containerImageDigest === cloud.containerImageDigest &&
    cloudProvenance.modelVersion === cloud.modelVersion && cloudProvenance.catalogVersion === cloud.catalogVersion,
  "cloud provenance version/build pins do not match cloud evidence", blockers);
  check(/^[a-f0-9]{64}$/.test(cloudProvenance.releaseApkSha256 ?? ""), "cloud provenance must bind the Release APK SHA-256", blockers);
  check(/^[a-f0-9]{64}$/.test(cloudProvenance.backendReleaseSha256 ?? ""), "cloud provenance must bind the backend Release SHA-256", blockers);
  check(/^sha256:[a-f0-9]{64}$/.test(cloudProvenance.containerImageDigest ?? ""), "cloud provenance must bind the deployed OCI image digest", blockers);
  check(/^[a-f0-9]{64}$/.test(cloudProvenance.deploymentReceiptSha256 ?? "") &&
    /^[a-f0-9]{64}$/.test(cloudProvenance.deploymentPolicySha256 ?? ""),
  "cloud provenance must bind the trusted deployment receipt and pinned policy", blockers);
  check(validToken(cloudProvenance.deploymentIssuerId) && validToken(cloudProvenance.deploymentKeyId) &&
    validToken(cloudProvenance.deploymentRevision),
  "cloud provenance must identify the trusted deployment attestor and revision", blockers);
  check(cloudProvenance.verifiedAt === cloud.verifiedAt && validPastTimestamp(cloudProvenance.verifiedAt, generatedAt, now), "cloud provenance must record the same valid verification time", blockers);
  check(cloud.realDeployment === true, "cloud evidence must come from a real deployment", blockers);
  check(nonEmpty(cloud.appVersion) && nonEmpty(cloud.modelVersion) && nonEmpty(cloud.catalogVersion), "cloud evidence must pin app, model and catalog versions", blockers);
  check(/^[a-f0-9]{64}$/.test(cloud.releaseApkSha256 ?? ""), "cloud evidence must bind the Release APK SHA-256", blockers);
  check(/^[a-f0-9]{64}$/.test(cloud.backendReleaseSha256 ?? ""), "cloud evidence must bind the backend Release SHA-256", blockers);
  check(/^sha256:[a-f0-9]{64}$/.test(cloud.containerImageDigest ?? ""), "cloud evidence must bind the deployed OCI image digest", blockers);
  check(cloud.deploymentReceiptSha256 === cloudProvenance.deploymentReceiptSha256 &&
    cloud.deploymentRevision === cloudProvenance.deploymentRevision,
  "cloud evidence must use the same trusted deployment receipt and revision", blockers);
  check(nonEmpty(cloud.evidenceRef) && validPastTimestamp(cloud.verifiedAt, generatedAt, now), "cloud checks must reference dated retained evidence", blockers);
  check(cloud.qwenSafetyVerified === true, "real Qwen content-safety behavior must be verified", blockers);
  check(cloud.immediateDeleteVerified === true, "successful analysis must prove immediate object deletion", blockers);
  check(cloud.ttlHours <= 24, "object-store lifecycle fallback must be 24 hours or less", blockers);
  check(cloud.versioningDisabled === true && cloud.lifecyclePolicyVerified === true, "cloud OSS versioning and lifecycle policy must be verified", blockers);
  check(cloud.deleteDeviceDataVerified === true, "cloud device-data deletion must be verified", blockers);

  const release = evidence.releaseArtifact ?? {};
  check(release.evidenceKind === "verified_release_apk", "release evidence must come from the APK verification workflow", blockers);
  check(release.formalSigning === true && release.debugCertificate === false, "release APK must use formal non-debug signing", blockers);
  check(/^[a-f0-9]{64}$/.test(release.apkSha256 ?? "") && /^[a-f0-9]{64}$/.test(release.signerCertificateSha256 ?? ""), "release APK and signer certificate must be SHA-256 bound", blockers);
  check(release.packageName === "cn.jianwei.app", "release APK package name is invalid", blockers);
  check(nonEmpty(release.versionName) && Number.isInteger(release.versionCode) && release.versionCode > 0, "release APK version identity is invalid", blockers);
  check(validPastTimestamp(release.verifiedAt, generatedAt, now) && nonEmpty(release.evidenceRef), "release APK verification must reference dated retained evidence", blockers);

  const accessibility = evidence.accessibilityAudit ?? {};
  check(accessibility.humanTalkBackAudit === true && accessibility.spokenOutputReviewed === true && accessibility.taskCompleted === true, "a human must complete and review the TalkBack spoken-output flow", blockers);
  check(validHumanId(accessibility.reviewerId), "TalkBack audit must identify an accountable human reviewer", blockers);
  check(accessibility.locale === "zh-CN", "TalkBack audit must cover the mainland Chinese locale", blockers);
  check(nonEmpty(accessibility.appVersion), "TalkBack audit must identify the tested app version", blockers);
  check(/^[a-f0-9]{64}$/.test(accessibility.apkSha256 ?? ""), "TalkBack audit must identify the tested APK SHA-256", blockers);
  check(nonEmpty(accessibility.manufacturer) && nonEmpty(accessibility.model) && nonEmpty(accessibility.buildFingerprint) && accessibility.apiLevel >= 26, "TalkBack audit must identify the physical Android device", blockers);
  check(accessibility.onboardingDisclosureUnderstood === true && accessibility.shareDisclosureUnderstood === true && accessibility.privacyControlsUnderstood === true, "TalkBack audit must confirm the three privacy-critical disclosures are understandable", blockers);
  check(validPastTimestamp(accessibility.auditedAt, generatedAt, now) && nonEmpty(accessibility.evidenceRef), "TalkBack audit must reference dated retained evidence", blockers);

  const appVersions = [
    provenance.appVersion,
    cardProvenance.appVersion,
    betaProvenance.appVersion,
    cloud.appVersion,
    release.versionName,
    accessibility.appVersion,
    ...devices.map((item) => item.appVersion)
  ];
  check(appVersions.every(nonEmpty) && new Set(appVersions).size === 1, "all evaluation, card, cohort, cloud, device, accessibility and APK evidence must use one app version", blockers);
  const releaseApkDigests = [
    release.apkSha256,
    cardProvenance.releaseApkSha256,
    cloud.releaseApkSha256,
    betaProvenance.apkSha256,
    accessibility.apkSha256,
    ...devices.map((item) => item.apkSha256)
  ];
  check(releaseApkDigests.every((value) => /^[a-f0-9]{64}$/.test(value ?? "")) && new Set(releaseApkDigests).size === 1,
    "cohort, device and accessibility evidence must use the exact verified Release APK SHA-256", blockers);
  const backendReleaseDigests = [cardProvenance.backendReleaseSha256, cloud.backendReleaseSha256];
  check(backendReleaseDigests.every((value) => /^[a-f0-9]{64}$/.test(value ?? "")) && new Set(backendReleaseDigests).size === 1,
    "card audit and cloud evidence must use the exact same backend Release SHA-256", blockers);
  check(provenance.modelVersion === cardProvenance.modelVersion && provenance.modelVersion === cloud.modelVersion, "evaluation, card and cloud evidence must use one model version", blockers);
  check(provenance.catalogVersion === cardProvenance.catalogVersion && provenance.catalogVersion === cloud.catalogVersion, "evaluation, card and cloud evidence must use one catalog version", blockers);

  return {
    status: blockers.length === 0 ? "GO" : "NO_GO",
    metrics: {
      evaluationSamples: samples.length,
      sensitiveSamples: sensitive.length,
      sensitiveLeakRate,
      recognitionSamples: scorable.length,
      top1Accuracy,
      auditedCards: cards.length,
      deviceRuns: devices.length,
      widgetAddRate,
      engagementRate,
      likeRate,
      firstCardP50Seconds: p50,
      firstCardP95Seconds: p95
    },
    blockers
  };
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validHumanId(value) {
  return nonEmpty(value) && value.trim().length <= 128 && /^[\p{L}\p{N}._@-]+$/u.test(value.trim()) &&
    !AUTOMATION_ID.test(value) && !/(?:^|[._@-])(?:ai|bot)(?:$|[._@-])/i.test(value);
}

function strictIso(value) {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? parsed : null;
}

function validPastTimestamp(value, generatedAt, now) {
  const parsed = strictIso(value);
  if (!parsed || parsed.getTime() > now.getTime() + 5 * 60 * 1000) return false;
  return !generatedAt || parsed.getTime() <= generatedAt.getTime();
}

function uniqueNonEmptyIds(items, field) {
  const ids = items.map((item) => item?.[field]);
  return ids.every(nonEmpty) && new Set(ids).size === ids.length;
}

function uniqueHexDigests(items, field) {
  const values = items.map((item) => item?.[field]);
  return values.every((value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value)) && new Set(values).size === values.length;
}

function validSensitiveTypes(value) {
  return Array.isArray(value) && new Set(value).size === value.length && value.every((type) => SENSITIVE_TYPES.has(type));
}

function validHttpsOrigin(value) {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.search && !parsed.hash &&
      parsed.pathname === "/" && value === parsed.origin;
  } catch {
    return false;
  }
}

function validPublicHttpsOrigin(value) {
  if (!validHttpsOrigin(value)) return false;
  const host = new URL(value).hostname.toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".invalid")) return false;
  if (/^(?:127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host)) return false;
  const private172 = /^172\.(\d{1,3})\./.exec(host);
  return !(private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) && host !== "[::1]" && host !== "::1";
}

function emulatorFingerprint(value) {
  return /(?:generic|sdk_gphone|emulator|goldfish|ranchu|aosp_|google\/sdk|unknown\/unknown)/i.test(String(value ?? ""));
}

function exactObjectKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function containsForbiddenEvidenceData(value, key = "") {
  const forbiddenKeys = new Set([
    "accesstoken", "accesstokenid", "accesskey", "accesskeyid", "accesskeysecret", "bearer",
    "bucket", "candidatetoken", "contenturi", "databaseurl", "devicetoken", "filepath",
    "imagebytes", "imagepath", "installationid", "localid", "mediastoreid", "objectkey",
    "password", "photopath", "rawimage", "securitytoken"
  ]);
  if (forbiddenKeys.has(String(key).replaceAll(/[^A-Za-z0-9]/g, "").toLowerCase())) return true;
  if (typeof value === "string") {
    return /(?:sk-kimi-[A-Za-z0-9]{12,}|sk-[A-Za-z0-9]{16,}|LTAI[A-Za-z0-9]{12,}|Bearer\s+[A-Za-z0-9._~-]{12,}|postgres(?:ql)?:\/\/[^\s/:@]+:[^\s@]+@|^[A-Za-z]:\\|^\/(?:Users|home)\/)/i.test(value);
  }
  if (Array.isArray(value)) return value.some((item) => containsForbiddenEvidenceData(item, key));
  if (value && typeof value === "object") {
    return Object.entries(value).some(([childKey, child]) => containsForbiddenEvidenceData(child, childKey));
  }
  return false;
}

function validToken(value) {
  return typeof value === "string" && /^[A-Za-z0-9._-]{3,128}$/.test(value);
}

function ratio(numerator, denominator) {
  return Number.isFinite(numerator) && denominator > 0 ? numerator / denominator : 0;
}

function percentile(sorted, value) {
  if (sorted.length === 0) return null;
  return sorted[Math.max(0, Math.ceil(sorted.length * value) - 1)];
}

function check(condition, message, blockers) {
  if (!condition) blockers.push(message);
}

function passingFixture() {
  const fixtureTime = new Date(Date.now() - 60_000).toISOString();
  const authorizationTime = new Date(Date.now() - 180_000).toISOString();
  const labelTime = new Date(Date.now() - 120_000).toISOString();
  const sensitiveTypes = [...SENSITIVE_TYPES];
  return {
    schemaVersion: 3,
    evidenceKind: "synthetic_self_test",
    evidenceOwner: "human-fixture-owner",
    generatedAt: fixtureTime,
    assemblyProvenance: {
      evidenceKind: "verified_beta_evidence_assembly",
      manifestSha256: "9".repeat(64),
      artifactCount: 8,
      knowledgeCatalogSha256: "5".repeat(64),
      topicBacklogSha256: "6".repeat(64),
      knowledgeReviewerPolicySha256: "4".repeat(64),
      deploymentReceiptSha256: "7".repeat(64),
      deploymentPolicySha256: "8".repeat(64)
    },
    evaluationProvenance: {
      datasetId: "synthetic-dataset",
      labelEvidenceRef: "synthetic-label-evidence",
      resultEvidenceRef: "synthetic-result-evidence",
      labelEvidenceSha256: "a".repeat(64),
      resultEvidenceSha256: "b".repeat(64),
      runId: "synthetic-run",
      appVersion: "synthetic-app",
      evaluationApkSha256: "c".repeat(64),
      modelVersion: "synthetic-model",
      catalogVersion: "synthetic-catalog",
      runnerProvenance: {
        evidenceKind: "android_authorized_image_runner",
        reviewerId: "human-image-runner",
        approvedAt: labelTime,
        appVersion: "synthetic-app",
        evaluationApkSha256: "c".repeat(64),
        manufacturer: "Huawei",
        model: "synthetic-physical-model",
        buildFingerprint: "huawei/synthetic/release-keys",
        apiLevel: 34,
        endpointOrigin: "https://beta.jianwei.example"
      }
    },
    evaluationSamples: Array.from({ length: 300 }, (_, index) => ({
      sampleId: `sample-${index}`,
      sampleSha256: index.toString(16).padStart(64, "0"),
      authorized: true,
      authorizationRef: "synthetic-consent-fixture",
      authorizationScope: "local_and_cloud_evaluation",
      authorizedAt: authorizationTime,
      labelerId: "human-fixture-labeler",
      labeledAt: labelTime,
      expectedSensitiveTypes: index < 100 ? [sensitiveTypes[index % sensitiveTypes.length]] : [],
      expectedTopicId: index < 100 ? null : `topic-${(index - 100) % 25}`,
      pipelineCompleted: true,
      leftDevice: index >= 100,
      predictedTopicId: index < 100 ? null : `topic-${(index - 100) % 25}`,
      evaluatedAt: fixtureTime
    })),
    cardAuditProvenance: {
      runId: "synthetic-card-run",
      auditMode: "automatic_derived",
      policyVersion: "derived-ai-reviewed-card-v2",
      snapshotEvidenceRef: "synthetic-card-snapshots",
      snapshotEvidenceSha256: "c".repeat(64),
      appVersion: "synthetic-app",
      releaseApkSha256: "e".repeat(64),
      backendReleaseSha256: "d".repeat(64),
      modelVersion: "synthetic-model",
      catalogVersion: "synthetic-catalog"
    },
    cardAudits: Array.from({ length: 200 }, (_, index) => ({
      cardId: `card-${index}`,
      cardSha256: (index + 1000).toString(16).padStart(64, "0"),
      sourceUrls: ["https://example.org/fact"],
      riskLevel: "general",
      automaticallyReviewed: true,
      policyVersion: "derived-ai-reviewed-card-v2",
      catalogReviewModel: "qwen3.6-flash-2026-04-16",
      catalogReviewEvidenceSha256: (index + 2000).toString(16).padStart(64, "0"),
      catalogFactMatched: true,
      catalogAiReviewBound: true,
      bodyMatchesFact: true,
      sourceSetMatchesCatalog: true,
      titleMatchesPolicy: true,
      personalContextMatchesPolicy: true,
      automaticPolicyPassed: true
    })),
    deviceRuns: [
      device("Huawei", "FULL", fixtureTime),
      device("Xiaomi", "PARTIAL", fixtureTime),
      device("OPPO", "DENIED", fixtureTime)
    ],
    betaProvenance: {
      evidenceKind: "compiled_beta_cohort",
      reportSetId: "synthetic-beta-report-set",
      reportsEvidenceRef: "synthetic-retained-device-reports",
      manifestEvidenceRef: "synthetic-retained-cohort-manifest",
      reportsSha256: "1".repeat(64),
      manifestSha256: "2".repeat(64),
      reportCount: 20,
      appVersion: "synthetic-app",
      apkSha256: "e".repeat(64),
      compiledAt: fixtureTime
    },
    beta: {
      grayUsers: 10,
      grayDays: 3,
      expandedUsers: 20,
      onboardingCompleted: 20,
      widgetAdded: 12,
      engaged7dUsers: 8,
      feedbackCount: 20,
      likeCount: 10,
      firstCardSeconds: Array.from({ length: 20 }, () => 60),
      evidenceRef: "synthetic-cohort-evidence",
      measuredAt: fixtureTime
    },
    cloudProvenance: {
      evidenceKind: "verified_cloud_run",
      runId: "synthetic-cloud-run",
      runSha256: "3".repeat(64),
      evidenceRef: "synthetic-cloud-evidence",
      baseUrlOrigin: "https://beta.jianwei.example",
      safeFixtureSha256: "4".repeat(64),
      sensitiveFixtureSha256: "5".repeat(64),
      expectedSensitiveType: "face",
      appVersion: "synthetic-app",
      releaseApkSha256: "e".repeat(64),
      backendReleaseSha256: "d".repeat(64),
      containerImageDigest: `sha256:${"6".repeat(64)}`,
      deploymentReceiptSha256: "7".repeat(64),
      deploymentPolicySha256: "8".repeat(64),
      deploymentIssuerId: "synthetic-deployment-attestor",
      deploymentKeyId: "synthetic-deployment-key",
      deploymentRevision: "synthetic-fc-revision",
      modelVersion: "synthetic-model",
      catalogVersion: "synthetic-catalog",
      verifiedAt: fixtureTime
    },
    cloud: {
      realDeployment: true,
      appVersion: "synthetic-app",
      releaseApkSha256: "e".repeat(64),
      backendReleaseSha256: "d".repeat(64),
      containerImageDigest: `sha256:${"6".repeat(64)}`,
      deploymentReceiptSha256: "7".repeat(64),
      deploymentRevision: "synthetic-fc-revision",
      modelVersion: "synthetic-model",
      catalogVersion: "synthetic-catalog",
      evidenceRef: "synthetic-cloud-evidence",
      verifiedAt: fixtureTime,
      qwenSafetyVerified: true,
      immediateDeleteVerified: true,
      ttlHours: 24,
      versioningDisabled: true,
      lifecyclePolicyVerified: true,
      deleteDeviceDataVerified: true
    },
    releaseArtifact: {
      evidenceKind: "verified_release_apk",
      formalSigning: true,
      debugCertificate: false,
      apkSha256: "e".repeat(64),
      signerCertificateSha256: "f".repeat(64),
      packageName: "cn.jianwei.app",
      versionName: "synthetic-app",
      versionCode: 1,
      verifiedAt: fixtureTime,
      evidenceRef: "synthetic-release-evidence"
    },
    accessibilityAudit: {
      humanTalkBackAudit: true,
      spokenOutputReviewed: true,
      taskCompleted: true,
      reviewerId: "human-accessibility-reviewer",
      locale: "zh-CN",
      appVersion: "synthetic-app",
      apkSha256: "e".repeat(64),
      manufacturer: "Synthetic",
      model: "Synthetic physical model",
      buildFingerprint: "synthetic/accessibility/fingerprint",
      apiLevel: 34,
      onboardingDisclosureUnderstood: true,
      shareDisclosureUnderstood: true,
      privacyControlsUnderstood: true,
      auditedAt: fixtureTime,
      evidenceRef: "synthetic-accessibility-evidence"
    }
  };
}

// Synthetic fixture export is test support only. Callers must keep
// `releaseEvidence=0` in their self-test output and must never persist it as
// real Beta evidence.
export { passingFixture as createSyntheticPassingEvidence };

function device(manufacturer, permissionMode, testedAt) {
  return {
    runId: `synthetic-${manufacturer}-${permissionMode}`,
    manufacturer,
    model: "synthetic-physical-model",
    buildFingerprint: "synthetic/fingerprint",
    appVersion: "synthetic-app",
    apkSha256: "e".repeat(64),
    physicalDevice: true,
    testedAt,
    evidenceRef: `synthetic-device-evidence-${manufacturer}-${permissionMode}`,
    apiLevel: 34,
    permissionMode,
    scanPassed: true,
    backgroundPassed: true,
    widgetOfflineDays: 7,
    deletePassed: true
  };
}

if (isMainModule(import.meta.url)) {
  const selfTest = process.argv.includes("--self-test");
  const cliArguments = process.argv.slice(2);
  const file = cliArguments.find((argument, index) =>
    !argument.startsWith("--") &&
    !["--trust-policy", "--attestation", "--assembly-attestation"].includes(cliArguments[index - 1])
  );
  if (selfTest) {
    const fixture = passingFixture();
    const fixtureTopics = new Set(Array.from({ length: 25 }, (_, index) => `topic-${index}`));
    const fixtureOptions = {
      allowSynthetic: true,
      requireTrustedAttestation: false,
      trustedAssembly: {
        verified: true,
        issuerId: "synthetic-assembly-attestor",
        keyId: "synthetic-assembly-key",
        role: "beta_assembly_attestor",
        publicKeySha256: "a".repeat(64),
        manifestSha256: fixture.assemblyProvenance.manifestSha256,
        artifactCount: fixture.assemblyProvenance.artifactCount,
        knowledgeCatalogSha256: fixture.assemblyProvenance.knowledgeCatalogSha256,
        topicBacklogSha256: fixture.assemblyProvenance.topicBacklogSha256,
        knowledgeReviewerPolicySha256: fixture.assemblyProvenance.knowledgeReviewerPolicySha256,
        deploymentReceiptSha256: fixture.assemblyProvenance.deploymentReceiptSha256,
        deploymentPolicySha256: fixture.assemblyProvenance.deploymentPolicySha256
      },
      catalogVersion: "synthetic-catalog",
      catalogTopicIds: fixtureTopics,
      knowledgeReadiness: { status: "GO", metrics: { topics: 200, readyTopics: 200, verifiedFacts: 600, aiReviewedFacts: 600, humanAttestedFacts: 0 }, blockers: [] }
    };
    const result = assessEvidence(fixture, fixtureOptions);
    if (result.status !== "GO") throw new Error(`Beta gate self-test failed: ${result.blockers.join("; ")}`);
    if (assessEvidence(fixture, { ...fixtureOptions, allowSynthetic: false }).status !== "NO_GO") throw new Error("Synthetic evidence was accepted as release evidence");
    const forgedRealBundle = { ...structuredClone(fixture), evidenceKind: "real_beta_evidence" };
    if (assessEvidence(forgedRealBundle, {
      ...fixtureOptions,
      allowSynthetic: false,
      requireTrustedAttestation: true,
      trustedReleaseAttestation: null
    }).status !== "NO_GO") throw new Error("A structurally valid but unsigned forged Beta bundle was accepted");
    if (assessEvidence(forgedRealBundle, {
      ...fixtureOptions,
      allowSynthetic: false,
      requireTrustedAttestation: true,
      trustedReleaseAttestation: {
        verified: true,
        issuerId: "synthetic-release-approver",
        keyId: "synthetic-release-key",
        role: "beta_release_approver",
        publicKeySha256: "b".repeat(64)
      },
      trustedAssembly: null
    }).status !== "NO_GO") {
      throw new Error("A release-approver-signed bundle without a verified deployment assembly was accepted");
    }
    const duplicate = structuredClone(fixture);
    duplicate.evaluationSamples[1].sampleId = duplicate.evaluationSamples[0].sampleId;
    if (assessEvidence(duplicate, fixtureOptions).status !== "NO_GO") throw new Error("Duplicate evidence IDs were accepted");
    const incomplete = structuredClone(fixture);
    incomplete.evaluationSamples[0].pipelineCompleted = false;
    incomplete.evaluationSamples[0].leftDevice = false;
    if (assessEvidence(incomplete, fixtureOptions).status !== "NO_GO") throw new Error("An incomplete privacy sample was counted as a safe rejection");
    const localOnlyAuthorization = structuredClone(fixture);
    localOnlyAuthorization.evaluationSamples[0].authorizationScope = "local_only";
    if (assessEvidence(localOnlyAuthorization, fixtureOptions).status !== "NO_GO") throw new Error("A sample without cloud-evaluation authorization was accepted");
    const collapsedTopics = structuredClone(fixture);
    for (const sample of collapsedTopics.evaluationSamples.filter((item) => item.expectedSensitiveTypes.length === 0)) {
      sample.expectedTopicId = "topic-0";
      sample.predictedTopicId = "topic-0";
    }
    if (assessEvidence(collapsedTopics, fixtureOptions).status !== "NO_GO") throw new Error("A single-topic recognition set was accepted");
    const missingSensitiveClass = structuredClone(fixture);
    for (const sample of missingSensitiveClass.evaluationSamples) {
      if (sample.expectedSensitiveTypes.includes("screenshot")) sample.expectedSensitiveTypes = ["document"];
    }
    if (assessEvidence(missingSensitiveClass, fixtureOptions).status !== "NO_GO") throw new Error("A privacy set with a missing sensitive class was accepted");
    const missingCardProvenance = structuredClone(fixture);
    delete missingCardProvenance.cardAuditProvenance;
    if (assessEvidence(missingCardProvenance, fixtureOptions).status !== "NO_GO") throw new Error("Unbound card audits were accepted");
    const automatedImageRunner = structuredClone(fixture);
    automatedImageRunner.evaluationProvenance.runnerProvenance.reviewerId = "qwen-bot";
    if (assessEvidence(automatedImageRunner, fixtureOptions).status !== "NO_GO") throw new Error("Automated image-runner approval was accepted");
    const missingBetaProvenance = structuredClone(fixture);
    delete missingBetaProvenance.betaProvenance;
    if (assessEvidence(missingBetaProvenance, fixtureOptions).status !== "NO_GO") throw new Error("Hand-entered Beta metrics without raw-report provenance were accepted");
    const missingCloudProvenance = structuredClone(fixture);
    delete missingCloudProvenance.cloudProvenance;
    if (assessEvidence(missingCloudProvenance, fixtureOptions).status !== "NO_GO") throw new Error("Hand-entered cloud claims without a verified run were accepted");
    const differentImageRunnerCloud = structuredClone(fixture);
    differentImageRunnerCloud.evaluationProvenance.runnerProvenance.endpointOrigin = "https://other-beta.jianwei.example";
    if (assessEvidence(differentImageRunnerCloud, fixtureOptions).status !== "NO_GO") throw new Error("Image evaluation from a different cloud deployment was accepted");
    const leakedCredential = structuredClone(fixture);
    leakedCredential.deviceRuns[0].deviceToken = "forbidden-private-device-token";
    if (assessEvidence(leakedCredential, fixtureOptions).status !== "NO_GO") throw new Error("Beta evidence containing a private device token was accepted");
    const mixedAppVersions = structuredClone(fixture);
    mixedAppVersions.releaseArtifact.versionName = "synthetic-other-app";
    if (assessEvidence(mixedAppVersions, fixtureOptions).status !== "NO_GO") throw new Error("Evidence from different app versions was combined");
    const mixedReleaseApk = structuredClone(fixture);
    mixedReleaseApk.deviceRuns[0].apkSha256 = "9".repeat(64);
    if (assessEvidence(mixedReleaseApk, fixtureOptions).status !== "NO_GO") throw new Error("Evidence from different Release APK bytes was combined");
    const duplicateCardDigest = structuredClone(fixture);
    duplicateCardDigest.cardAudits[1].cardSha256 = duplicateCardDigest.cardAudits[0].cardSha256;
    if (assessEvidence(duplicateCardDigest, fixtureOptions).status !== "NO_GO") throw new Error("Duplicate card snapshot digests were accepted");
    const mismatchedCard = structuredClone(fixture);
    mismatchedCard.cardAudits[0].bodyMatchesFact = false;
    if (assessEvidence(mismatchedCard, fixtureOptions).status !== "NO_GO") throw new Error("A card body that differed from its reviewed fact was accepted");
    const incompleteAutomaticReview = structuredClone(fixture);
    incompleteAutomaticReview.cardAudits[0].automaticPolicyPassed = false;
    if (assessEvidence(incompleteAutomaticReview, fixtureOptions).status !== "NO_GO") throw new Error("An incomplete automatic card review was accepted");
    const highRiskAutomaticCard = structuredClone(fixture);
    highRiskAutomaticCard.cardAudits[0].riskLevel = "health";
    if (assessEvidence(highRiskAutomaticCard, fixtureOptions).status !== "NO_GO") throw new Error("A health card entered the automatic first-release pool");
    const unboundCatalogReview = structuredClone(fixture);
    unboundCatalogReview.cardAudits[0].catalogReviewModel = "unreviewed-model";
    if (assessEvidence(unboundCatalogReview, fixtureOptions).status !== "NO_GO") throw new Error("A card without a Qwen catalog review was accepted");
    const unsupportedPersonalContext = structuredClone(fixture);
    unsupportedPersonalContext.cardAudits[0].personalContextMatchesPolicy = false;
    if (assessEvidence(unsupportedPersonalContext, fixtureOptions).status !== "NO_GO") throw new Error("An unsupported personal conclusion was accepted");
    const manualAuthorityField = structuredClone(fixture);
    manualAuthorityField.cardAudits[0].humanReviewed = true;
    if (assessEvidence(manualAuthorityField, fixtureOptions).status !== "NO_GO") throw new Error("A hand-added review field bypassed the exact automatic schema");
    const unreadyKnowledge = { ...fixtureOptions, knowledgeReadiness: { status: "NO_GO", metrics: { readyTopics: 0 }, blockers: ["no human attestations"] } };
    if (assessEvidence(fixture, unreadyKnowledge).status !== "NO_GO") throw new Error("Beta evidence bypassed an unready knowledge catalog");
    const debugSigned = structuredClone(fixture);
    debugSigned.releaseArtifact.debugCertificate = true;
    if (assessEvidence(debugSigned, fixtureOptions).status !== "NO_GO") throw new Error("A debug-signed APK was accepted as formal release evidence");
    const mixedBackendRelease = structuredClone(fixture);
    mixedBackendRelease.cardAuditProvenance.backendReleaseSha256 = "9".repeat(64);
    if (assessEvidence(mixedBackendRelease, fixtureOptions).status !== "NO_GO") throw new Error("Card and cloud evidence from different backend Releases were accepted");
    const mixedContainerImage = structuredClone(fixture);
    mixedContainerImage.cloudProvenance.containerImageDigest = `sha256:${"7".repeat(64)}`;
    if (assessEvidence(mixedContainerImage, fixtureOptions).status !== "NO_GO") throw new Error("Cloud evidence from different OCI image digests was accepted");
    const missingDeploymentReceipt = structuredClone(fixture);
    missingDeploymentReceipt.cloudProvenance.deploymentReceiptSha256 = "";
    if (assessEvidence(missingDeploymentReceipt, fixtureOptions).status !== "NO_GO") throw new Error("Self-declared OCI evidence without a trusted deployment receipt was accepted");
    const automatedTalkBack = structuredClone(fixture);
    automatedTalkBack.accessibilityAudit.humanTalkBackAudit = false;
    if (assessEvidence(automatedTalkBack, fixtureOptions).status !== "NO_GO") throw new Error("Automated TalkBack focus evidence replaced human spoken-output review");
    let externalPolicyPinRejected = false;
    try { externallyPinnedPolicySha256({}); } catch { externalPolicyPinRejected = true; }
    if (!externalPolicyPinRejected) throw new Error("A repository-only trust policy bypassed the external trust root");
    const sharedTrustParty = {
      verified: true,
      issuerId: "single-approver",
      keyId: "single-key",
      publicKeySha256: "c".repeat(64)
    };
    let sharedTrustPartyRejected = false;
    try {
      assertIndependentTrustParties({
        release: { ...sharedTrustParty, role: "beta_release_approver" },
        assembly: { ...sharedTrustParty, role: "beta_assembly_attestor" },
        deployment: { ...sharedTrustParty, role: "beta_deployment_attestor" }
      });
    } catch { sharedTrustPartyRejected = true; }
    if (!sharedTrustPartyRejected) throw new Error("One issuer/key was allowed to control all Beta trust roles");
    const historicalDeployment = createHistoricalDeploymentReceiptFixture();
    verifyDeploymentReceipt({
      ...historicalDeployment,
      now: new Date("2026-01-02T00:00:00.000Z")
    });
    let staleDeploymentReceiptRejected = false;
    try {
      verifyDeploymentReceiptForRelease({
        ...historicalDeployment,
        verificationNow: new Date("2026-01-09T00:00:00.001Z")
      });
    } catch { staleDeploymentReceiptRejected = true; }
    if (!staleDeploymentReceiptRejected) {
      throw new Error("A deployment receipt older than seven days at the actual release-check time was accepted");
    }
    process.stdout.write("BETA_EVIDENCE_SELF_TEST=GO synthetic=1 releaseEvidence=0 bypassesRejected=32 trustedAttestation=1 forgedBundleRejected=1 releaseApproverOnlyRejected=1 assemblySignatureRequired=1 externalPolicyPin=1 threePartyKeySeparation=1 assemblyReverification=1 currentDeploymentReceiptFreshness=1 pipelineCompletion=1 sensitiveTypes=8 recognitionTopics=25 cloudAuthorization=1 androidRunner=1 runnerCloudBinding=1 automaticCardAudit=1 cardAuditProvenance=1 betaCohortProvenance=1 cloudProvenance=1 evidencePrivacy=1 crossVersionBinding=1 releaseApkShaBinding=1 backendReleaseBinding=1 containerImageBinding=1 deploymentReceiptBinding=1 knowledgeGate=1 formalSigning=1 humanTalkBack=1 canonicalMainEntry=1\n");
  } else {
    const evidencePath = file ?? "evaluation/beta-evidence.json";
    let result;
    try {
      const [evidenceBytes, catalogBytes, backlogBytes] = await Promise.all([
        readFile(evidencePath),
        readFile(path.join(REPOSITORY_ROOT, "knowledge", "catalog.json")),
        readFile(path.join(REPOSITORY_ROOT, "knowledge", "topic-backlog.json"))
      ]);
      const evidence = JSON.parse(evidenceBytes.toString("utf8"));
      const catalog = JSON.parse(catalogBytes.toString("utf8"));
      const backlog = JSON.parse(backlogBytes.toString("utf8"));
      const approvedReviewerIds = knowledgeReviewerIdsFromEnvironment();
      let trustedReleaseAttestation = null;
      let trustedAssembly = null;
      let trustFailure = null;
      try {
        if (process.argv.includes("--trust-policy")) {
          throw new Error("the Beta release trust policy is repository-pinned and cannot be overridden");
        }
        const policyPath = path.join(REPOSITORY_ROOT, "config", "evidence-trust-policy.json");
        const attestationPath = optionValue("--attestation") ?? path.join(REPOSITORY_ROOT, "evaluation", "beta-evidence.attestation.json");
        const assemblyAttestationPath = optionValue("--assembly-attestation") ??
          path.join(REPOSITORY_ROOT, "evaluation", "beta-evidence-assembly.attestation.json");
        await assertPinnedOrdinaryFile(policyPath);
        const [policyBytes, attestation, assemblyAttestation, assemblyInputs] = await Promise.all([
          readFile(policyPath),
          readFile(attestationPath, "utf8").then(JSON.parse),
          readFile(assemblyAttestationPath, "utf8").then(JSON.parse),
          readPinnedAssemblyInputs()
        ]);
        const policy = JSON.parse(policyBytes.toString("utf8"));
        const expectedPolicySha256 = externallyPinnedPolicySha256();
        const trustVerificationNow = new Date();
        validateEvidenceTrustPolicy(policy, policyBytes, trustVerificationNow, expectedPolicySha256);
        trustedReleaseAttestation = verifyEvidenceAttestation({
          artifact: evidence,
          artifactBytes: evidenceBytes,
          policy,
          policyBytes,
          attestation,
          now: trustVerificationNow
        });
        const verifiedAssemblyAttestation = verifyAssemblyAttestation({
          manifest: assemblyInputs.manifest,
          manifestBytes: assemblyInputs.manifestBytes,
          artifacts: assemblyInputs.artifacts,
          policy,
          policyBytes,
          attestation: assemblyAttestation,
          now: trustVerificationNow
        });
        const currentDeploymentReceipt = verifyDeploymentReceiptForRelease({
          receipt: assemblyInputs.artifacts.deploymentReceipt.value,
          receiptBytes: assemblyInputs.artifacts.deploymentReceipt.bytes,
          policy,
          policyBytes,
          verificationNow: trustVerificationNow
        });
        const { assembleBetaEvidence } = await import("./lib/beta-evidence-assembly.mjs");
        const assembled = assembleBetaEvidence({
          manifest: assemblyInputs.manifest,
          manifestSha256: sha256Bytes(assemblyInputs.manifestBytes),
          artifacts: assemblyInputs.artifacts,
          deploymentPolicy: policy,
          deploymentPolicyBytes: policyBytes,
          catalog,
          catalogBytes,
          backlog,
          backlogBytes,
          approvedReviewerIds,
          now: new Date(evidence.generatedAt)
        });
        if (JSON.stringify(assembled.evidence) !== JSON.stringify(evidence)) {
          throw new Error("signed Beta evidence is not the deterministic output of the approved eight-artifact assembly");
        }
        if (currentDeploymentReceipt.receiptSha256 !== assembled.verifiedDeploymentReceipt.receiptSha256) {
          throw new Error("current deployment-receipt verification does not match the deterministic assembly input");
        }
        assertIndependentTrustParties({
          release: trustedReleaseAttestation,
          assembly: verifiedAssemblyAttestation,
          deployment: currentDeploymentReceipt
        });
        trustedAssembly = {
          ...verifiedAssemblyAttestation,
          manifestSha256: assembled.evidence.assemblyProvenance.manifestSha256,
          artifactCount: assembled.evidence.assemblyProvenance.artifactCount,
          knowledgeCatalogSha256: assembled.evidence.assemblyProvenance.knowledgeCatalogSha256,
          topicBacklogSha256: assembled.evidence.assemblyProvenance.topicBacklogSha256,
          knowledgeReviewerPolicySha256: assembled.evidence.assemblyProvenance.knowledgeReviewerPolicySha256,
          deploymentReceiptSha256: assembled.evidence.assemblyProvenance.deploymentReceiptSha256,
          deploymentPolicySha256: assembled.evidence.assemblyProvenance.deploymentPolicySha256
        };
      } catch (error) {
        trustFailure = `externally pinned three-party Beta trust chain or eight-artifact assembly is missing or invalid: ${error?.message ?? "unknown trust failure"}`;
      }
      result = assessEvidence(evidence, {
        catalogVersion: catalog.version,
        catalogTopicIds: new Set(catalog.topics.map((topic) => topic.topicId)),
        knowledgeReadiness: assessKnowledge(catalog, backlog, new Date(), approvedReviewerIds),
        trustedReleaseAttestation,
        trustedAssembly
      });
      if (trustFailure) {
        result.status = "NO_GO";
        result.blockers.unshift(trustFailure);
      }
    } catch (error) {
      const reason = error?.code === "ENOENT"
        ? `beta evidence file is missing: ${evidencePath}`
        : `beta evidence file is unreadable or invalid JSON: ${evidencePath}`;
      result = { status: "NO_GO", metrics: {}, blockers: [reason] };
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.status !== "GO") process.exitCode = 1;
  }
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : null;
  return typeof value === "string" && !value.startsWith("--") ? value : null;
}

export function externallyPinnedPolicySha256(env = process.env) {
  const value = env.JIANWEI_EVIDENCE_TRUST_POLICY_SHA256;
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error("JIANWEI_EVIDENCE_TRUST_POLICY_SHA256 must be a protected external SHA-256 trust root");
  }
  return value;
}

export function verifyDeploymentReceiptForRelease({
  receipt,
  receiptBytes,
  policy,
  policyBytes,
  verificationNow = new Date()
}) {
  return verifyDeploymentReceipt({
    receipt,
    receiptBytes,
    policy,
    policyBytes,
    now: verificationNow
  });
}

export function assertIndependentTrustParties({ release, assembly, deployment }) {
  const parties = [
    [release, "beta_release_approver"],
    [assembly, "beta_assembly_attestor"],
    [deployment, "beta_deployment_attestor"]
  ];
  for (const [party, role] of parties) {
    if (party?.verified !== true || party.role !== role || !validToken(party.issuerId) ||
        !validToken(party.keyId) || !/^[a-f0-9]{64}$/.test(party.publicKeySha256 ?? "")) {
      throw new Error(`trusted ${role} identity is incomplete or invalid`);
    }
  }
  for (const field of ["issuerId", "keyId", "publicKeySha256"]) {
    if (new Set(parties.map(([party]) => party[field])).size !== parties.length) {
      throw new Error(`release, assembly, and deployment trust parties must use distinct ${field} values`);
    }
  }
  return true;
}

function createHistoricalDeploymentReceiptFixture() {
  const roles = [
    "beta_release_approver",
    "beta_assembly_attestor",
    "beta_deployment_attestor"
  ];
  const identities = [
    ["historical-release-approver", "historical-release-key"],
    ["historical-assembly-attestor", "historical-assembly-key"],
    ["historical-deployment-attestor", "historical-deployment-key"]
  ];
  const keyPairs = roles.map(() => generateKeyPairSync("ed25519"));
  const policy = {
    schemaVersion: 1,
    evidenceKind: "beta_evidence_trust_policy",
    policyId: "historical-deployment-policy",
    issuers: roles.map((role, index) => ({
      issuerId: identities[index][0],
      keyId: identities[index][1],
      algorithm: "Ed25519",
      publicKeyPem: keyPairs[index].publicKey.export({ type: "spki", format: "pem" }).toString(),
      roles: [role],
      notBefore: "2025-01-01T00:00:00.000Z",
      notAfter: "2027-01-01T00:00:00.000Z",
      status: "active"
    }))
  };
  const policyBytes = Buffer.from(`${JSON.stringify(policy, null, 2)}\n`, "utf8");
  const receipt = {
    schemaVersion: 1,
    evidenceKind: "trusted_deployment_receipt",
    policyId: policy.policyId,
    policySha256: sha256Bytes(policyBytes),
    issuerId: identities[2][0],
    keyId: identities[2][1],
    role: roles[2],
    endpointOrigin: "https://beta.jianwei.example",
    deploymentRevision: "historical-revision",
    containerImageDigest: `sha256:${"a".repeat(64)}`,
    backendReleaseSha256: "b".repeat(64),
    deployedAt: "2026-01-01T00:00:00.000Z",
    issuedAt: "2026-01-01T00:00:00.000Z",
    signatureBase64: ""
  };
  receipt.signatureBase64 = sign(
    null,
    deploymentReceiptSignaturePayload(receipt),
    keyPairs[2].privateKey
  ).toString("base64");
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  return { receipt, receiptBytes, policy, policyBytes };
}

async function assertPinnedOrdinaryFile(file) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || path.resolve(await realpath(file)) !== path.resolve(file)) {
    throw new Error(`repository-pinned evidence input must be an ordinary non-symlink file: ${path.basename(file)}`);
  }
}

async function readPinnedAssemblyInputs() {
  const evaluationRoot = path.join(REPOSITORY_ROOT, "evaluation");
  const files = {
    imageEvaluation: "compiled-image-evaluation.json",
    cardAudit: "compiled-card-audit.json",
    betaCohort: "beta-cohort-compiled.json",
    cloudVerification: "cloud-beta-compiled.json",
    releaseArtifact: "release-artifact.json",
    physicalDeviceRuns: "compiled-physical-device-runs.json",
    accessibilityAudit: "compiled-accessibility-audit.json",
    deploymentReceipt: "deployment-receipt.json"
  };
  const manifestPath = path.join(evaluationRoot, "beta-evidence-assembly-manifest.json");
  await assertPinnedOrdinaryFile(manifestPath);
  const manifestBytes = await readFile(manifestPath);
  const entries = await Promise.all(Object.entries(files).map(async ([name, filename]) => {
    const file = path.join(evaluationRoot, filename);
    await assertPinnedOrdinaryFile(file);
    const bytes = await readFile(file);
    return [name, { bytes, value: JSON.parse(bytes.toString("utf8")) }];
  }));
  return {
    manifestBytes,
    manifest: JSON.parse(manifestBytes.toString("utf8")),
    artifacts: Object.fromEntries(entries)
  };
}
