import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const productRoots = [
  "android/app/src/main",
  "android/app/src/debug",
  "android/data/src/main",
  "android/data/src/debug",
  "android/domain/src/main",
  "backend/src"
];
const sourceFiles = (await Promise.all(productRoots.map((directory) => collect(path.join(root, directory)))))
  .flat()
  .filter((file) => !/\.(?:test|spec)\.[^.]+$/i.test(file));
const forbidden = [
  { label: "Kotlin TODO", pattern: /\bTODO\s*\(\s*\)/ },
  { label: "NotImplementedError", pattern: /\bNotImplementedError\b/ },
  { label: "stub runtime exception", pattern: /RuntimeException\s*\(\s*["'](?:stub|not implemented)/i },
  { label: "unscoped never-analyze promise", pattern: /永不分析/ },
  { label: "exact update promise", pattern: /(?:精确每日更新|实时更新|每天准时)/ },
  { label: "absolute protection promise", pattern: /(?:已经保护|已保护|绝对安全)/ },
  { label: "absolute completed-analysis promise", pattern: /已经分析/ },
  { label: "unredacted runtime logging call", pattern: /(?:(?:android\.util\.)?Log\.[vdiew]|console\.(?:log|info|debug|warn|error))\s*\(/ }
];
const failures = [];
const topicBatchIngest = await readFile(path.join(root, "scripts", "ingest-topic-batch.mjs"), "utf8");
const topicDraftCorrection = await readFile(path.join(root, "scripts", "apply-catalog-draft-correction.mjs"), "utf8");
const rejectedFactReplacementTemplate = await readFile(path.join(root, "scripts", "create-rejected-fact-replacement-batch.mjs"), "utf8");
const rejectedFactReplacement = await readFile(path.join(root, "scripts", "apply-rejected-fact-replacements.mjs"), "utf8");
const knowledgeReviewQueue = await readFile(path.join(root, "scripts", "build-knowledge-review-queue.mjs"), "utf8");
const knowledgeReviewTemplate = await readFile(path.join(root, "scripts", "create-knowledge-review-batch.mjs"), "utf8");
const knowledgeReviewTemplateLibrary = await readFile(path.join(root, "scripts", "lib", "review-template.mjs"), "utf8");
const knowledgeReviewWorkbench = await readFile(path.join(root, "scripts", "knowledge-review-workbench.mjs"), "utf8");
const knowledgeReviewWorkbenchLibrary = await readFile(path.join(root, "scripts", "lib", "review-workbench.mjs"), "utf8");
const knowledgeReviewWorkbenchClient = await readFile(path.join(root, "scripts", "lib", "review-workbench-client.mjs"), "utf8");
const knowledgeReviewApply = await readFile(path.join(root, "scripts", "apply-knowledge-review-batch.mjs"), "utf8");
const knowledgeReviewLibrary = await readFile(path.join(root, "scripts", "lib", "review-batch.mjs"), "utf8");
const deprecatedDirectReview = await readFile(path.join(root, "scripts", "review-fact.mjs"), "utf8");
const knowledgeSourcePreflight = await readFile(path.join(root, "scripts", "preflight-knowledge-sources.mjs"), "utf8");
const knowledgeSourceChecker = await readFile(path.join(root, "scripts", "check-knowledge-sources.mjs"), "utf8");
const safeSourceRequest = await readFile(path.join(root, "scripts", "lib", "safe-source-request.mjs"), "utf8");
const knowledgeReadinessGate = await readFile(path.join(root, "scripts", "check-knowledge-readiness.mjs"), "utf8");
const releaseApkVerifier = await readFile(path.join(root, "scripts", "verify-release-apk-windows.ps1"), "utf8");
const betaCohortCompiler = await readFile(path.join(root, "scripts", "compile-beta-cohort.mjs"), "utf8");
const betaCohortManifest = await readFile(path.join(root, "scripts", "create-beta-cohort-manifest.mjs"), "utf8");
const physicalDeviceManifest = await readFile(path.join(root, "scripts", "create-physical-device-run-manifest.mjs"), "utf8");
const physicalDeviceCompiler = await readFile(path.join(root, "scripts", "compile-physical-device-runs.mjs"), "utf8");
const physicalDeviceLibrary = await readFile(path.join(root, "scripts", "lib", "physical-device-runs.mjs"), "utf8");
const accessibilityAuditManifest = await readFile(path.join(root, "scripts", "create-accessibility-audit-manifest.mjs"), "utf8");
const accessibilityAuditCompiler = await readFile(path.join(root, "scripts", "compile-accessibility-audit.mjs"), "utf8");
const accessibilityAuditLibrary = await readFile(path.join(root, "scripts", "lib", "accessibility-audit.mjs"), "utf8");
const betaEvidenceAssemblyManifest = await readFile(path.join(root, "scripts", "create-beta-evidence-assembly-manifest.mjs"), "utf8");
const betaEvidenceAssembler = await readFile(path.join(root, "scripts", "assemble-beta-evidence.mjs"), "utf8");
const betaEvidenceAssemblyLibrary = await readFile(path.join(root, "scripts", "lib", "beta-evidence-assembly.mjs"), "utf8");
const betaEvidenceGate = await readFile(path.join(root, "scripts", "check-beta-readiness.mjs"), "utf8");
const mainModuleGuard = await readFile(path.join(root, "scripts", "lib", "main-module.mjs"), "utf8");
const betaEvidenceAttestation = await readFile(path.join(root, "scripts", "sign-beta-evidence.mjs"), "utf8");
const betaEvidenceAttestationLibrary = await readFile(path.join(root, "scripts", "lib", "evidence-attestation.mjs"), "utf8");
const betaEvidenceAssemblyAttestation = await readFile(path.join(root, "scripts", "sign-beta-evidence-assembly.mjs"), "utf8");
const betaEvidenceAssemblyAttestationLibrary = await readFile(path.join(root, "scripts", "lib", "assembly-attestation.mjs"), "utf8");
const betaEvidenceTrustPolicyExample = await readFile(path.join(root, "config", "evidence-trust-policy.example.json"), "utf8");
const deploymentReceiptExample = await readFile(path.join(root, "config", "deployment-receipt.example.json"), "utf8");
const imageEvaluationRunManifest = await readFile(path.join(root, "scripts", "create-image-evaluation-run.mjs"), "utf8");
const imageEvaluationRunLibrary = await readFile(path.join(root, "scripts", "lib", "image-evaluation-run.mjs"), "utf8");
const imageEvaluationCompiler = await readFile(path.join(root, "scripts", "compile-image-evaluation.mjs"), "utf8");
const imageEvaluationActivity = await readFile(path.join(root, "android", "app", "src", "debug", "kotlin", "cn", "jianwei", "app", "evaluation", "AuthorizedImageEvaluationActivity.kt"), "utf8");
const imageEvaluationWorker = await readFile(path.join(root, "android", "app", "src", "debug", "kotlin", "cn", "jianwei", "app", "evaluation", "AuthorizedImageEvaluationWorker.kt"), "utf8");
const imageEvaluationArtifacts = await readFile(path.join(root, "android", "app", "src", "debug", "kotlin", "cn", "jianwei", "app", "evaluation", "EvaluationArtifacts.kt"), "utf8");
const imageEvaluationDebugManifest = await readFile(path.join(root, "android", "app", "src", "debug", "AndroidManifest.xml"), "utf8");
const imageEvaluationHost = await readFile(path.join(root, "scripts", "run-authorized-image-evaluation-windows.ps1"), "utf8");
const betaMetricsStore = await readFile(path.join(root, "android", "app", "src", "main", "kotlin", "cn", "jianwei", "app", "BetaMetricsStore.kt"), "utf8");
const cardAuditCompiler = await readFile(path.join(root, "scripts", "compile-card-audit.mjs"), "utf8");
const cardSnapshotExporter = await readFile(path.join(root, "backend", "src", "export-card-audit-snapshots.ts"), "utf8");
const evaluationLeaseService = await readFile(path.join(root, "backend", "src", "services", "evaluation-lease.ts"), "utf8");
const evaluationLeaseMigration = await readFile(path.join(root, "backend", "migrations", "009_authorized_evaluation_leases.sql"), "utf8");
const backendReleaseMigration = await readFile(path.join(root, "backend", "migrations", "010_backend_release_identity.sql"), "utf8");
const privateDeletionMigration = await readFile(path.join(root, "backend", "migrations", "011_private_card_deletion_receipts.sql"), "utf8");
const postgresRepositories = await readFile(path.join(root, "backend", "src", "infrastructure", "postgres-repositories.ts"), "utf8");
const backendServer = await readFile(path.join(root, "backend", "src", "server.ts"), "utf8");
const analysisService = await readFile(path.join(root, "backend", "src", "services", "analysis-service.ts"), "utf8");
const cardScheduling = await readFile(path.join(root, "backend", "src", "domain", "card-scheduling.ts"), "utf8");
const postgresIntegrationTest = await readFile(path.join(root, "backend", "src", "postgres.integration.test.ts"), "utf8");
const postgresIntegrationGate = await readFile(path.join(root, "scripts", "run-postgres-integration-windows.ps1"), "utf8");
const postgresIntegrationMacGate = await readFile(path.join(root, "scripts", "run-postgres-integration-macos.sh"), "utf8");
const remoteAnalysisClient = await readFile(path.join(root, "android", "data", "src", "main", "kotlin", "cn", "jianwei", "data", "network", "RemoteAnalysisClient.kt"), "utf8");
const androidApiClient = await readFile(path.join(root, "android", "data", "src", "main", "kotlin", "cn", "jianwei", "data", "network", "JianweiApi.kt"), "utf8");
const authorizedEvaluationClient = await readFile(path.join(root, "android", "data", "src", "debug", "kotlin", "cn", "jianwei", "data", "network", "AuthorizedEvaluationAnalysisClient.kt"), "utf8");
const cloudEvidenceCore = await readFile(path.join(root, "backend", "src", "cloud-beta-verification.ts"), "utf8");
const cloudEvidenceCli = await readFile(path.join(root, "backend", "src", "verify-cloud-beta.ts"), "utf8");
const deploymentReceiptVerifier = await readFile(path.join(root, "backend", "src", "deployment-receipt.ts"), "utf8");
const assemblyDeploymentReceiptVerifier = await readFile(path.join(root, "scripts", "lib", "deployment-receipt.mjs"), "utf8");
const backendReleaseIdentity = await readFile(path.join(root, "backend", "src", "release-identity.ts"), "utf8");
const containerDeploymentInputs = await readFile(path.join(root, "scripts", "check-container-deployment-inputs.mjs"), "utf8");
const backendPackage = JSON.parse(await readFile(path.join(root, "backend", "package.json"), "utf8"));
const kimiReview = await readFile(path.join(root, "scripts", "kimi-adversarial-review.mjs"), "utf8");
const loopEngineerSkill = await readFile(path.join(root, ".claude", "skills", "loop-engineer", "SKILL.md"), "utf8");
const loopEngineeringContract = await readFile(path.join(root, "docs", "LOOP_ENGINEERING.md"), "utf8");
const gitignore = await readFile(path.join(root, ".gitignore"), "utf8");

for (const file of sourceFiles) {
  const content = await readFile(file, "utf8");
  for (const rule of forbidden) {
    if (rule.pattern.test(content)) failures.push(`${rule.label}: ${path.relative(root, file)}`);
  }
}

const androidSourceFiles = sourceFiles.filter((file) => path.relative(root, file).replaceAll("\\", "/").startsWith("android/"));
for (const file of androidSourceFiles) {
  const content = await readFile(file, "utf8");
  if (/(?:DASHSCOPE_API_KEY|OSS_ACCESS_KEY_SECRET|sk-kimi-|sk-[A-Za-z0-9]{16})/.test(content)) {
    failures.push(`client cloud credential marker: ${path.relative(root, file)}`);
  }
}

const dataBuild = await readFile(path.join(root, "android", "data", "build.gradle.kts"), "utf8");
const dataModule = await readFile(path.join(root, "android", "data", "src", "main", "kotlin", "cn", "jianwei", "data", "di", "DataModule.kt"), "utf8");
const remoteAnalysis = await readFile(path.join(root, "android", "data", "src", "main", "kotlin", "cn", "jianwei", "data", "network", "RemoteAnalysisClient.kt"), "utf8");
const serverSource = await readFile(path.join(root, "backend", "src", "server.ts"), "utf8");
const objectStoreSource = await readFile(path.join(root, "backend", "src", "infrastructure", "object-store.ts"), "utf8");
const releaseBuild = await readFile(path.join(root, "scripts", "build-android-windows.ps1"), "utf8");
const appBuild = await readFile(path.join(root, "android", "app", "build.gradle.kts"), "utf8");
const cardRepository = await readFile(path.join(root, "android", "data", "src", "main", "kotlin", "cn", "jianwei", "data", "cards", "RoomCardRepository.kt"), "utf8");
const cardMappers = await readFile(path.join(root, "android", "data", "src", "main", "kotlin", "cn", "jianwei", "data", "local", "Mappers.kt"), "utf8");
const androidSourceUrlPolicy = await readFile(path.join(root, "android", "domain", "src", "main", "kotlin", "cn", "jianwei", "domain", "model", "KnowledgeSourceUrlPolicy.kt"), "utf8");
const androidSourceUrlTest = await readFile(path.join(root, "android", "domain", "src", "test", "kotlin", "cn", "jianwei", "domain", "model", "KnowledgeSourceUrlPolicyTest.kt"), "utf8");
const sourceSyncDeviceTest = await readFile(path.join(root, "android", "data", "src", "androidTest", "kotlin", "cn", "jianwei", "data", "cards", "TooPrivateSyncOrderingInstrumentedTest.kt"), "utf8");
const backendSourceUrlPolicy = await readFile(path.join(root, "backend", "src", "domain", "source-url.ts"), "utf8");
const backendSourceUrlTest = await readFile(path.join(root, "backend", "src", "domain", "source-url.test.ts"), "utf8");
const openApi = JSON.parse(await readFile(path.join(root, "api", "openapi.json"), "utf8"));
const cardDaos = await readFile(path.join(root, "android", "data", "src", "main", "kotlin", "cn", "jianwei", "data", "local", "Daos.kt"), "utf8");
const localEntities = await readFile(path.join(root, "android", "data", "src", "main", "kotlin", "cn", "jianwei", "data", "local", "Entities.kt"), "utf8");
const databaseMigrationDeviceTest = await readFile(path.join(root, "android", "data", "src", "androidTest", "kotlin", "cn", "jianwei", "data", "local", "DatabaseMigrationInstrumentedTest.kt"), "utf8");
const deviceIdentity = await readFile(path.join(root, "android", "data", "src", "main", "kotlin", "cn", "jianwei", "data", "network", "DeviceIdentity.kt"), "utf8");
const workersSource = await readFile(path.join(root, "android", "data", "src", "main", "kotlin", "cn", "jianwei", "data", "work", "Workers.kt"), "utf8");
const uploadExecutionGate = await readFile(path.join(root, "android", "data", "src", "main", "kotlin", "cn", "jianwei", "data", "work", "UploadExecutionGate.kt"), "utf8");
const workManagerScheduler = await readFile(path.join(root, "android", "data", "src", "main", "kotlin", "cn", "jianwei", "data", "work", "WorkManagerScheduler.kt"), "utf8");
const jpegMetadataGuard = await readFile(path.join(root, "android", "data", "src", "main", "kotlin", "cn", "jianwei", "data", "photos", "JpegMetadataGuard.kt"), "utf8");
const jpegMetadataStripper = await readFile(path.join(root, "android", "data", "src", "main", "kotlin", "cn", "jianwei", "data", "photos", "JpegMetadataStripper.kt"), "utf8");
const privacyFilterSource = await readFile(path.join(root, "android", "data", "src", "main", "kotlin", "cn", "jianwei", "data", "photos", "PrivacyFilter.kt"), "utf8");
const privacySignalJvmTest = await readFile(path.join(root, "android", "data", "src", "test", "kotlin", "cn", "jianwei", "data", "photos", "PrivacySignalPolicyTest.kt"), "utf8");
const privacyFilterDeviceTest = await readFile(path.join(root, "android", "data", "src", "androidTest", "kotlin", "cn", "jianwei", "data", "photos", "PrivacyFilterInstrumentedTest.kt"), "utf8");
const imageSanitizerSource = await readFile(path.join(root, "android", "data", "src", "main", "kotlin", "cn", "jianwei", "data", "photos", "ImageSanitizer.kt"), "utf8");
const orientedBitmapDecoder = await readFile(path.join(root, "android", "data", "src", "main", "kotlin", "cn", "jianwei", "data", "photos", "OrientedBitmapDecoder.kt"), "utf8");
const androidManifest = await readFile(path.join(root, "android", "app", "src", "main", "AndroidManifest.xml"), "utf8");
const mainActivity = await readFile(path.join(root, "android", "app", "src", "main", "kotlin", "cn", "jianwei", "app", "MainActivity.kt"), "utf8");
const dailyWidget = await readFile(path.join(root, "android", "app", "src", "main", "kotlin", "cn", "jianwei", "app", "widget", "DailyWidget.kt"), "utf8");
const dailyWidgetRefresh = await readFile(path.join(root, "android", "app", "src", "main", "kotlin", "cn", "jianwei", "app", "widget", "DailyWidgetRefreshWorker.kt"), "utf8");
const dailyWidgetRefreshJvmTest = await readFile(path.join(root, "android", "app", "src", "test", "kotlin", "cn", "jianwei", "app", "widget", "DailyWidgetRefreshPolicyTest.kt"), "utf8");
const dailyWidgetRefreshDeviceTest = await readFile(path.join(root, "android", "app", "src", "androidTest", "kotlin", "cn", "jianwei", "app", "widget", "DailyWidgetRefreshInstrumentedTest.kt"), "utf8");
const dailyWidgetInfo = await readFile(path.join(root, "android", "app", "src", "main", "res", "xml", "daily_widget_info.xml"), "utf8");
const widgetStateStore = await readFile(path.join(root, "android", "data", "src", "main", "kotlin", "cn", "jianwei", "data", "widget", "WidgetStateStore.kt"), "utf8");
const widgetStateJvmTest = await readFile(path.join(root, "android", "data", "src", "test", "kotlin", "cn", "jianwei", "data", "widget", "WidgetStateStoreTest.kt"), "utf8");
const widgetStateDeviceTest = await readFile(path.join(root, "android", "data", "src", "androidTest", "kotlin", "cn", "jianwei", "data", "widget", "WidgetStateStoreInstrumentedTest.kt"), "utf8");
const widgetSwitchPolicy = await readFile(path.join(root, "android", "app", "src", "main", "kotlin", "cn", "jianwei", "app", "widget", "WidgetSwitchPolicy.kt"), "utf8");
const widgetSwitchPolicyTest = await readFile(path.join(root, "android", "app", "src", "test", "kotlin", "cn", "jianwei", "app", "widget", "WidgetSwitchPolicyTest.kt"), "utf8");
const mainViewModel = await readFile(path.join(root, "android", "app", "src", "main", "kotlin", "cn", "jianwei", "app", "MainViewModel.kt"), "utf8");
const feedbackUiPolicy = await readFile(path.join(root, "android", "app", "src", "main", "kotlin", "cn", "jianwei", "app", "FeedbackUiPolicy.kt"), "utf8");
const feedbackUiPolicyTest = await readFile(path.join(root, "android", "app", "src", "test", "kotlin", "cn", "jianwei", "app", "FeedbackUiPolicyTest.kt"), "utf8");
const feedbackAffinityPolicy = await readFile(path.join(root, "android", "domain", "src", "main", "kotlin", "cn", "jianwei", "domain", "feedback", "FeedbackAffinityPolicy.kt"), "utf8");
const feedbackAffinityPolicyTest = await readFile(path.join(root, "android", "domain", "src", "test", "kotlin", "cn", "jianwei", "domain", "feedback", "FeedbackAffinityPolicyTest.kt"), "utf8");
const dailyCardPolicy = await readFile(path.join(root, "android", "domain", "src", "main", "kotlin", "cn", "jianwei", "domain", "card", "DailyCardPolicy.kt"), "utf8");
const dailyCardPolicyTest = await readFile(path.join(root, "android", "domain", "src", "test", "kotlin", "cn", "jianwei", "domain", "card", "DailyCardPolicyTest.kt"), "utf8");
const cardRecognitionPolicy = await readFile(path.join(root, "android", "domain", "src", "main", "kotlin", "cn", "jianwei", "domain", "card", "CardRecognitionPolicy.kt"), "utf8");
const cardRecognitionPolicyTest = await readFile(path.join(root, "android", "domain", "src", "test", "kotlin", "cn", "jianwei", "domain", "card", "CardRecognitionPolicyTest.kt"), "utf8");
const backendCardPresentation = await readFile(path.join(root, "backend", "src", "domain", "card-presentation.ts"), "utf8");
const backendCardPresentationTest = await readFile(path.join(root, "backend", "src", "domain", "card-presentation.test.ts"), "utf8");
const detectedObjectMigration = await readFile(path.join(root, "backend", "migrations", "013_card_detected_object_name.sql"), "utf8");
const discoveryUiPolicy = await readFile(path.join(root, "android", "app", "src", "main", "kotlin", "cn", "jianwei", "app", "DiscoveryUiPolicy.kt"), "utf8");
const discoveryUiPolicyTest = await readFile(path.join(root, "android", "app", "src", "test", "kotlin", "cn", "jianwei", "app", "DiscoveryUiPolicyTest.kt"), "utf8");
const analysisStatusRepository = await readFile(path.join(root, "android", "data", "src", "main", "kotlin", "cn", "jianwei", "data", "status", "SharedPreferencesAnalysisStatusRepository.kt"), "utf8");
const analysisStatusDeviceTest = await readFile(path.join(root, "android", "data", "src", "androidTest", "kotlin", "cn", "jianwei", "data", "status", "AnalysisStatusRepositoryInstrumentedTest.kt"), "utf8");
const uploadRetryPolicyTest = await readFile(path.join(root, "android", "data", "src", "test", "kotlin", "cn", "jianwei", "data", "work", "UploadRetryPolicyTest.kt"), "utf8");
const dailyWidgetPolicyTest = await readFile(path.join(root, "android", "app", "src", "test", "kotlin", "cn", "jianwei", "app", "widget", "DailyWidgetPolicyTest.kt"), "utf8");
const applicationSource = await readFile(path.join(root, "android", "app", "src", "main", "kotlin", "cn", "jianwei", "app", "JianweiApplication.kt"), "utf8");
const reminderScheduler = await readFile(path.join(root, "android", "app", "src", "main", "kotlin", "cn", "jianwei", "app", "ItemReminderScheduler.kt"), "utf8");
const reminderPrivacyDeviceTest = await readFile(path.join(root, "android", "app", "src", "androidTest", "kotlin", "cn", "jianwei", "app", "ItemReminderPrivacyGuardInstrumentedTest.kt"), "utf8");
const androidApiSource = await readFile(path.join(root, "android", "data", "src", "main", "kotlin", "cn", "jianwei", "data", "network", "JianweiApi.kt"), "utf8");
const databaseSource = await readFile(path.join(root, "android", "data", "src", "main", "kotlin", "cn", "jianwei", "data", "local", "JianweiDatabase.kt"), "utf8");
const daosSource = await readFile(path.join(root, "android", "data", "src", "main", "kotlin", "cn", "jianwei", "data", "local", "Daos.kt"), "utf8");
const mediaRepository = await readFile(path.join(root, "android", "data", "src", "main", "kotlin", "cn", "jianwei", "data", "photos", "MediaPhotoRepository.kt"), "utf8");
const mediaIndexPolicy = await readFile(path.join(root, "android", "data", "src", "main", "kotlin", "cn", "jianwei", "data", "photos", "MediaStoreIndexPolicy.kt"), "utf8");
const mediaIncrementalDeviceTest = await readFile(path.join(root, "android", "data", "src", "androidTest", "kotlin", "cn", "jianwei", "data", "photos", "MediaStoreIncrementalScanInstrumentedTest.kt"), "utf8");
const appSmoke = await readFile(path.join(root, "scripts", "run-android-app-smoke-windows.ps1"), "utf8");
const accessibilitySmoke = await readFile(path.join(root, "scripts", "run-android-accessibility-smoke-windows.ps1"), "utf8");
const widgetSmoke = await readFile(path.join(root, "scripts", "run-android-widget-smoke-windows.ps1"), "utf8");
const releaseSmoke = await readFile(path.join(root, "scripts", "run-android-release-smoke-windows.ps1"), "utf8");
const androidReferenceSuite = await readFile(path.join(root, "scripts", "run-android-reference-suite-windows.ps1"), "utf8");
const androidDeviceTestGate = await readFile(path.join(root, "scripts", "run-android-device-tests-windows.ps1"), "utf8");
const ciWorkflow = await readFile(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
check(dataBuild.includes('getProperty("jianwei.apiUrl", "http://10.0.2.2:8787/")'), "Debug API default is missing");
check(dataBuild.includes('getProperty("jianwei.releaseApiUrl", "https://not-configured.invalid/")'), "Release inert API default is missing");
check(!dataBuild.includes("OSS_UPLOAD_HOST") && !dataBuild.includes("ossUploadHost"), "Client still permits a direct OSS upload target");
check(!remoteAnalysis.includes("ossUploadHost") && remoteAnalysis.includes("sameOrigin(uploadUrl, apiBaseUrl) && isExpectedApiUploadPath"), "Upload client is not fail-closed to the API same-origin session path");
check(dataModule.includes(".followRedirects(false)") && dataModule.includes(".followSslRedirects(false)"), "Android upload transport can follow a redirect away from the validated API upload URL");
check(
  remoteAnalysis.includes("class UploadHttpStatusException(val statusCode: Int)") &&
    remoteAnalysis.includes("requireSuccessfulUploadResponse(response)") &&
    remoteAnalysis.includes("if (!response.isSuccessful) throw UploadHttpStatusException(response.code)") &&
    !remoteAnalysis.includes("check(response.isSuccessful)") &&
    workersSource.includes("candidateUploadFailureDisposition(error, candidate.origin)") &&
    workersSource.includes("is UploadHttpStatusException -> error.statusCode") &&
    workersSource.includes("if (!disposition.keepImportedCopy) photos.discardImportedCopy(candidate.localId)") &&
    workersSource.includes("if (disposition.retryWork)"),
  "Raw upload HTTP status can be erased before retry policy, causing transient failures to delete imported copies"
);
check(serverSource.includes("updateOssCredentialsFromFcHeaders") && serverSource.includes("fc_credentials_missing"), "Function Compute invocation credential gate is missing");
for (const marker of ["PRODUCTION_LOG_SERIALIZERS", "safeRouteTemplate", "Server service overrides are test-only", "serializers: PRODUCTION_LOG_SERIALIZERS"]) {
  check(serverSource.includes(marker), `Production logging or test-override isolation is missing marker: ${marker}`);
}
check(objectStoreSource.includes("refreshSTSTokenInterval: 0") && objectStoreSource.includes("credentialSource.snapshot()"), "OSS warm-instance credential rotation is missing");
check(releaseBuild.includes("Formal Release requires jianwei.releaseApiUrl"), "Formal Release HTTPS guard is missing");
for (const marker of ["isIP(hostname)", "parsed.username || parsed.password", 'parsed.protocol !== "https:"', "PRIVATE_HOST_SUFFIXES", "parsed.port !== \"443\""]) {
  check(backendSourceUrlPolicy.includes(marker), `Backend source URL policy is missing marker: ${marker}`);
}
for (const marker of ["normalizedSafeKnowledgeSourceUrl", "rawUserInfo", "hostname.contains(':')", "PRIVATE_KNOWLEDGE_SOURCE_SUFFIXES", "uri.port != 443"]) {
  check(androidSourceUrlPolicy.includes(marker), `Android source URL policy is missing marker: ${marker}`);
}
for (const marker of ["javascript:alert(1)", "https://127.0.0.1/fact", "https://user:password@example.com/fact", "https://example.com:8443/fact"]) {
  check(backendSourceUrlTest.includes(marker) && androidSourceUrlTest.includes(marker), `Cross-platform source URL rejection evidence is missing: ${marker}`);
}
for (const marker of ["val downloaded = identity.authenticated", "cards.upsertAll(downloaded)", "MAX_CARD_SYNC_PAGES", "seenCursors", "validatedSources"]) {
  check(cardRepository.includes(marker), `Atomic validated card pagination is missing marker: ${marker}`);
}
check(cardMappers.includes("normalizedSafeKnowledgeSourceUrl") && cardMappers.includes("getOrDefault(emptyList())"), "Legacy Room source data is not filtered fail-closed");
check(mainActivity.includes("safeSources.forEach") && mainActivity.includes("runCatching { uriHandler.openUri(source.url) }") && mainActivity.includes("来源链接暂不可用"), "Card source click path is not revalidated and failure-safe");
for (const marker of ["invalidSourceOnLaterPageLeavesExistingCacheUntouched", "validPublicHttpsSourceIsStoredAfterCompletePagination", "corruptLegacyRoomSourceIsFilteredWithoutCrashing"]) {
  check(sourceSyncDeviceTest.includes(marker), `API 34 source-link evidence is missing marker: ${marker}`);
}
check(openApi.components?.schemas?.Source?.properties?.url?.pattern === "^https://", "OpenAPI Source URL is not HTTPS constrained");
check(openApi.components?.schemas?.Source?.properties?.authority?.enum?.length === 3, "OpenAPI Source authority enum is incomplete");
check(openApi.components?.schemas?.Card?.properties?.sources?.minItems === 1 && openApi.components?.schemas?.Card?.properties?.sources?.maxItems === 3, "OpenAPI Card source cardinality is incomplete");
check(openApi.components?.schemas?.ErrorResponse && !openApi.components.schemas.TopicAffinity.ErrorResponse, "OpenAPI schemas are structurally nested under TopicAffinity");
check(releaseBuild.includes("keystore.properties"), "Formal Release signing guard is missing");
check(appBuild.includes('manifestPlaceholders["usesCleartextTraffic"] = "false"'), "Release cleartext default is not disabled");
check(appBuild.includes('manifestPlaceholders["usesCleartextTraffic"] = "true"'), "Debug cleartext override is missing");
check(
  dailyWidgetRefresh.includes("DailyWidget().updateAll(applicationContext)") &&
    dailyWidgetRefresh.includes("scheduleFutureDailyWidgetRefreshes(applicationContext)") &&
    dailyWidgetRefresh.includes("nextDailyWidgetRefreshSlots(clock.instant())") &&
    dailyWidgetRefresh.includes("FUTURE_REFRESH_DAYS = 7") &&
    dailyWidgetRefresh.includes("DAILY_REFRESH_TIME: LocalTime = LocalTime.of(0, 5)") &&
    dailyWidgetRefresh.includes("widgetRefreshExistingWorkPolicy(): ExistingWorkPolicy = ExistingWorkPolicy.KEEP") &&
    dailyWidgetRefresh.split("widgetRefreshExistingWorkPolicy()").length - 1 >= 3 &&
    !dailyWidgetRefresh.includes("ExistingWorkPolicy.REPLACE") &&
    !dailyWidgetRefresh.includes("PeriodicWorkRequestBuilder") &&
    dailyWidgetInfo.includes('android:updatePeriodMillis="86400000"'),
  "Widget refresh is not calendar-day aligned with an independent seven-day offline fallback"
);
for (const marker of ["before daily boundary includes the current China day", "after daily boundary starts with the next China day", "unfinished immediate or calendar refresh is never replaced", "refuses an unbounded future queue"]) {
  check(dailyWidgetRefreshJvmTest.includes(marker), `Widget calendar refresh policy evidence is missing marker: ${marker}`);
}
check(
  dailyWidget.includes("isWidgetCacheDepleted(today, card?.scheduledDate)") &&
    dailyWidget.includes("新卡缓存已用完") &&
    dailyWidgetPolicyTest.includes("cache is depleted only after the selected card schedule date"),
  "Widget does not expose an honest cache-exhaustion state"
);
check(
  cardRecognitionPolicy.includes("val compactLabel: String") &&
    cardRecognitionPolicy.includes('uncertain -> "可能是 $objectName"') &&
    cardRecognitionPolicy.includes('"$objectName · 中等把握"') &&
    cardRecognitionPolicyTest.includes('compactLabel).isEqualTo("把握较低")') &&
    cardRecognitionPolicyTest.includes('compactLabel).isEqualTo("牙刷 · 中等把握")'),
  "Domain recognition policy does not provide tested compact widget wording"
);
check(
  dailyWidget.includes('Text("见微 · 今日"') &&
    dailyWidget.includes('Text("见微 · ${recognition.compactLabel}"') &&
    dailyWidget.includes("GlanceModifier.width(104.dp).fillMaxHeight().cornerRadius(16.dp)") &&
    dailyWidget.includes("Column(GlanceModifier.defaultWeight().fillMaxHeight())") &&
    dailyWidget.includes("private fun SwitchControl(label: String)") &&
    dailyWidget.includes(".background(widgetPrimary())") &&
    dailyWidget.includes("textAlign = TextAlign.Center"),
  "Widget is missing the branded 2x2/4x2 hierarchy or full-height wide layout"
);
for (const marker of ["schedulesSevenIndependentCalendarDayRefreshes", "firstIds", "isEqualTo(firstIds.getValue(day))", "hasSize(7)"]) {
  check(dailyWidgetRefreshDeviceTest.includes(marker), `Widget calendar refresh device evidence is missing marker: ${marker}`);
}
check(
  androidDeviceTestGate.includes(":app:connectedDebugAndroidTest") &&
    androidDeviceTestGate.includes("$tests -lt 40") &&
    androidDeviceTestGate.includes('android\\$_\\build\\outputs\\androidTest-results'),
  "Android device gate does not execute and count the app widget scheduling test"
);
check(
  androidReferenceSuite.includes('$deviceReports = @("data", "app")') &&
    androidReferenceSuite.includes("$deviceTests -lt 40"),
  "Android reference suite does not aggregate the app widget scheduling device evidence"
);
const ordinaryFeedbackBlock = cardRepository.slice(
  cardRepository.indexOf("private suspend fun flushFeedback("),
  cardRepository.indexOf("private suspend fun flushPrivacyFeedback(")
);
const feedbackSenderBlock = cardRepository.slice(
  cardRepository.indexOf("private suspend fun sendPendingFeedback("),
  cardRepository.indexOf("private suspend fun flushTrackedItems(")
);
check(
  ordinaryFeedbackBlock.indexOf("sendPendingFeedback(session, pending)") >= 0 &&
    ordinaryFeedbackBlock.indexOf("cards.removeFeedback(pending.id)") > ordinaryFeedbackBlock.indexOf("sendPendingFeedback(session, pending)") &&
    feedbackSenderBlock.includes("feedbackBodyOrThrow(api.feedback("),
  "Non-private feedback can be removed before a successful acknowledged response"
);
check(mainActivity.includes("确认删除云端数据？") && mainActivity.includes("showCloudDeleteConfirmation"), "Cloud data deletion is missing an explicit confirmation dialog");
const cloudDeleteCall = cardRepository.indexOf("deleteRemote = { identity.deleteExistingDeviceData(); Unit }")
const localCloudClearBinding = cardRepository.indexOf("clearLocal = cards::clearCloudState")
const identityResetBinding = cardRepository.indexOf("resetIdentity = identity::reset")
const crashSafeDeletionHelper = cardRepository.slice(
  cardRepository.indexOf("internal suspend fun completeCrashSafeCloudDeletion("),
  cardRepository.indexOf("private const val TRACK_UPSERT")
)
check(
  cloudDeleteCall >= 0 && localCloudClearBinding > cloudDeleteCall && identityResetBinding > localCloudClearBinding &&
    crashSafeDeletionHelper.indexOf("deleteRemote()") >= 0 &&
    crashSafeDeletionHelper.indexOf("clearLocal()") > crashSafeDeletionHelper.indexOf("deleteRemote()") &&
    crashSafeDeletionHelper.indexOf("resetIdentity()") > crashSafeDeletionHelper.indexOf("clearLocal()") &&
    cardRepository.indexOf("cards.clearPendingFeedback()") < 0 && cardRepository.indexOf("cards.clearTrackedItems()") < 0,
  "Android cloud deletion clears local outboxes before confirmed remote deletion or outside the atomic DAO clear"
);
check(
  cardDaos.includes("@Transaction") && cardDaos.includes("suspend fun clearCloudState()") &&
    cardDaos.indexOf("clearPendingFeedback()", cardDaos.indexOf("suspend fun clearCloudState()")) >= 0 &&
    cardDaos.indexOf("clearTrackedItems()", cardDaos.indexOf("suspend fun clearCloudState()")) >= 0,
  "Android cloud-derived cards and outboxes are not cleared in one Room transaction"
);
check(
  localEntities.includes("data class SavedCardEntity") &&
    localEntities.includes("entity = CardEntity::class") &&
    localEntities.includes("onDelete = ForeignKey.CASCADE"),
  "Saved-card state is not owned by its cached card through a cascading Room foreign key"
);
check(
  cardDaos.includes("fun observeSavedCards(): Flow<List<CardEntity>>") &&
    cardDaos.includes("suspend fun setCardSaved(cardId: String, saved: Boolean, nowMillis: Long): Boolean") &&
    cardDaos.includes("val shouldSignal = saved && current?.feedbackSignaled != true") &&
    cardDaos.includes('action = "SAVE"'),
  "Local card collection is missing persistent visibility or one-time SAVE outbox semantics"
);
const privateDeleteTransaction = cardDaos.slice(
  cardDaos.indexOf("suspend fun stagePrivateFeedbackAndDelete("),
  cardDaos.indexOf("suspend fun deletePrivateCardState(")
);
check(
  cardDaos.includes("DELETE FROM pending_feedback WHERE cardId = :cardId AND action != 'TOO_PRIVATE'") &&
    privateDeleteTransaction.includes('@Transaction') &&
    privateDeleteTransaction.includes('action = "TOO_PRIVATE"') &&
    privateDeleteTransaction.includes("suppressPhotoForPrivateCleanup") &&
    privateDeleteTransaction.includes("markPhotoNeverAnalyzeForPrivateCleanup") &&
    privateDeleteTransaction.indexOf("enqueueFeedback(") < privateDeleteTransaction.indexOf("deleteById(cardId)"),
  "TOO_PRIVATE barrier, photo suppression and private-card deletion are not one crash-atomic Room transaction"
);
check(
  localEntities.includes("data class CardFeedbackStateEntity") &&
    localEntities.includes('tableName = "card_feedback_states"') &&
    localEntities.includes("onDelete = ForeignKey.CASCADE"),
  "Ordinary card feedback has no card-owned persistent Room state"
);
const ordinaryFeedbackTransaction = cardDaos.slice(
  cardDaos.indexOf("suspend fun commitOrdinaryFeedback("),
  cardDaos.indexOf("suspend fun findPhotoForPrivateCleanup(")
);
const savedFeedbackTransaction = cardDaos.slice(
  cardDaos.indexOf("suspend fun setCardSaved("),
  cardDaos.indexOf("suspend fun pendingFeedback(")
);
check(
  cardDaos.includes("@Transaction\n    suspend fun commitOrdinaryFeedback(") &&
    ordinaryFeedbackTransaction.includes("findFeedbackState(cardId)") &&
    ordinaryFeedbackTransaction.includes("upsertFeedbackState(") &&
    ordinaryFeedbackTransaction.includes("enqueueFeedback(") &&
    ordinaryFeedbackTransaction.includes("upsertTopicAffinity(") &&
    ordinaryFeedbackTransaction.includes("recorded = false") &&
    ordinaryFeedbackTransaction.includes("recorded = true"),
  "Ordinary feedback state, outbox and affinity are not committed idempotently in one Room transaction"
);
check(
  cardDaos.includes("@Transaction\n    suspend fun setCardSaved(") &&
    savedFeedbackTransaction.includes("enqueueFeedback(") &&
    savedFeedbackTransaction.includes("upsertTopicAffinity("),
  "SAVE outbox and affinity signal are not committed in one Room transaction"
);
check(
  privateDeleteTransaction.includes("replaceTopicAffinity(") &&
    privateDeleteTransaction.includes("FeedbackAction.SAVE") &&
    privateDeleteTransaction.includes("FeedbackAction.TOO_PRIVATE"),
  "Private feedback does not replace prior ordinary and SAVE affinity signals"
);
check(
  cardRepository.includes("override fun observeFeedbackStates()") &&
    cardRepository.includes("cards.commitOrdinaryFeedback(") &&
    cardRepository.includes("FeedbackSubmissionResult(") &&
    mainViewModel.includes("feedbackStates = cardState.second.associateBy") &&
    mainViewModel.includes("feedbackResultMessage(result)"),
  "Persistent feedback state is not exposed through repository and presentation state"
);
check(
  mainActivity.includes("state.feedbackStates[card.cardId]") &&
    mainActivity.includes('"已反馈 · ${feedbackState?.action?.userLabel().orEmpty()}"') &&
    mainActivity.includes('"将这张照片标记为太私人？"') &&
    mainActivity.includes('"删除并停止分析"') &&
    mainActivity.includes('"保留卡片"') &&
    !mainActivity.includes('"在本次安装中不再分析"') &&
    feedbackUiPolicy.includes("shouldOfferOrdinaryFeedback") &&
    feedbackUiPolicyTest.includes("ordinary choices disappear after one persisted selection"),
  "Feedback UI does not persist one ordinary choice or safely confirm private deletion"
);
check(
  feedbackAffinityPolicy.includes("fun replaceTopicAffinity") &&
    feedbackAffinityPolicyTest.includes("privacy replacement removes prior ordinary and save signals"),
  "Feedback affinity replacement rule is missing domain-owned policy evidence"
);
check(
  cardRepository.includes("override fun observeSavedCards()") &&
    cardRepository.includes("override suspend fun setSaved(cardId: String, saved: Boolean): Boolean") &&
    cardRepository.includes("cards.stagePrivateFeedbackAndDelete(cardId") &&
    cardRepository.indexOf("cards.stagePrivateFeedbackAndDelete(cardId") < cardRepository.indexOf("photoRepository.markNeverAnalyze(it)"),
  "Card repository does not expose collection state or compact it at the privacy barrier"
);
check(
  mainActivity.includes("收藏 ${state.savedCards.size}") &&
    mainActivity.includes("还没有收藏") &&
    mainActivity.includes("收藏这张知识卡") &&
    mainActivity.includes("已收藏 · 点击取消"),
  "Saved-card collection has no complete visible add/list/remove UI"
);
check(
  mainActivity.includes('"今日识物"') &&
    mainActivity.includes('"为什么是这张照片"') &&
    mainActivity.includes('"这张卡对你有用吗？"') &&
    mainActivity.indexOf('"为什么是这张照片"') < mainActivity.indexOf('"收藏这张知识卡"') &&
    mainActivity.indexOf('"收藏这张知识卡"') < mainActivity.indexOf('"这张卡对你有用吗？"') &&
    mainActivity.includes("shouldStackKnowledgeCardActions(maxWidth.value, LocalDensity.current.fontScale)") &&
    discoveryUiPolicy.includes("availableWidthDp < 340f || fontScale >= 1.5f") &&
    discoveryUiPolicyTest.includes("knowledge card actions stack before labels become cramped"),
  "Knowledge card does not preserve the product hierarchy or narrow/large-text action reflow"
);
check(
  mainActivity.includes("private fun OnboardingValuePreview()") &&
    mainActivity.includes("private fun OnboardingPrivacyPreview()") &&
    mainActivity.includes("private fun OnboardingPreferences(") &&
    mainActivity.includes("private fun OnboardingEntryChoice(") &&
    mainActivity.includes('"事实有来源"') &&
    mainActivity.includes('"可靠命中才生成"') &&
    mainActivity.includes('"已选 ${interests.size} / 3"') &&
    mainActivity.includes("shouldStackOnboardingInterests(maxWidth.value, LocalDensity.current.fontScale)") &&
    mainActivity.includes("val scrollState = rememberScrollState()") &&
    mainActivity.includes("LaunchedEffect(step)") &&
    mainActivity.includes("scrollState.scrollTo(0)") &&
    mainActivity.includes("BackHandler(enabled = step > 0) { step-- }") &&
    mainActivity.includes('Text("返回上一步")') &&
    discoveryUiPolicy.includes("fun shouldStackOnboardingInterests") &&
    discoveryUiPolicyTest.includes("onboarding interests reflow before choices become cramped"),
  "Onboarding is missing its product preview, truthful privacy path, accessible reflow, or page scroll reset"
);
for (const marker of [
  "privateBarrierAndDeletionSurviveCrashRestart",
  "savedCardSurvivesRefreshAndResaveDoesNotDuplicateSignal",
  "tooPrivateDropsSaveOutboxBeforeRemoteDeletion",
  "pendingFeedback().map { it.action }",
  'doesNotContain("feedback:SAVE")',
  "successfulCloudDeletionClearsCardsOutboxesAndIdentity"
]) {
  check(sourceSyncDeviceTest.includes(marker), `API 34 saved-card lifecycle evidence is missing marker: ${marker}`);
}
check(
  sourceSyncDeviceTest.includes("ordinaryFeedbackIsPersistentIdempotentAndKeepsOneEffectiveChoice") &&
    sourceSyncDeviceTest.includes("assertThat(duplicate.accepted).isFalse()") &&
    sourceSyncDeviceTest.includes("assertThat(conflicting.effectiveAction).isEqualTo(FeedbackAction.LIKE)") &&
    sourceSyncDeviceTest.includes("findTopicAffinity(\"broom\")?.weight).isEqualTo(-0.75)"),
  "API 34 feedback idempotency or private affinity replacement evidence is missing"
);
check(
  databaseSource.includes("version = 10") &&
    databaseSource.includes("MIGRATION_9_10") &&
    databaseMigrationDeviceTest.includes("migratesVersion9To10CompactsLegacyFeedbackAndCascadesState") &&
    databaseMigrationDeviceTest.includes("card_feedback_states"),
  "Room 9-to-10 persistent feedback migration or cascade evidence is missing"
);
check(
  databaseSource.includes("version = 10") &&
    databaseSource.includes("MIGRATION_6_7") &&
    databaseSource.includes("MIGRATION_7_8") &&
    databaseMigrationDeviceTest.includes("migratesVersion7To8PreservesCardsAndCascadesSavedState"),
  "Room 7-to-8 saved-card migration or cascade evidence is missing"
);
for (const marker of ["deleteExistingDeviceData", "DELETION_STATE", "DELETION_PENDING", "DELETION_CONFIRMED", "expectedDeviceId", "registered.created", "RegisterRequest(installationId)", "AuthenticationExpiredException", "DEVICE_ID"]) {
  check(deviceIdentity.includes(marker), `Android stale-token deletion recovery is missing marker: ${marker}`);
}
check(
  androidApiSource.includes("data class RegisterResponse") && androidApiSource.includes("val created: Boolean") &&
    backendServer.includes("created: device.created") &&
    postgresRepositories.includes("devices.id = ${id} AS registration_created") &&
    postgresRepositories.includes("created: row.registration_created === true"),
  "Registration does not atomically distinguish a newly created replacement from an existing device"
);
const cloudDeleteUi = mainViewModel.slice(
  mainViewModel.indexOf("fun deleteCloudData()"),
  mainViewModel.indexOf("fun clearMessage()")
);
check(
  cloudDeleteUi.indexOf("scheduler.pauseAndCancel()") >= 0 &&
    cloudDeleteUi.indexOf("itemReminders.cancelAllAndAwait()") > cloudDeleteUi.indexOf("scheduler.pauseAndCancel()") &&
    cloudDeleteUi.indexOf("cards.clearCloudData()") > cloudDeleteUi.indexOf("itemReminders.cancelAllAndAwait()") &&
    reminderScheduler.includes("suspend fun cancelAllAndAwait()") &&
    reminderScheduler.includes("cancelAllWorkByTag(ITEM_REMINDER_WORK_TAG).result.get()"),
  "Cloud deletion does not durably cancel local reminder work before the remote request"
);
const privacyRetry = workersSource.indexOf("shouldRetryPrivacyAnalysisFailure(runAttemptCount)");
const privacyFailure = workersSource.indexOf("photos.updateAnalysis(entity.localId, AnalysisState.FAILED)");
check(privacyRetry >= 0 && privacyFailure > privacyRetry, "Transient ML Kit failures can permanently discard candidates before bounded retry");
check(workersSource.includes("if (error is CancellationException) throw error") && workersSource.includes("AnalysisState.ACCESS_UNAVAILABLE"), "Privacy worker does not preserve cancellation or permission-race semantics");
for (const marker of ["@Singleton", "Mutex()", "mutex.withLock"]) {
  check(uploadExecutionGate.includes(marker), `Upload execution gate is missing process-level serialization marker: ${marker}`);
}
check(
  workersSource.includes("private val uploadExecutionGate: UploadExecutionGate") &&
    workersSource.includes("uploadExecutionGate.runExclusive"),
  "Upload workers can still consume the same READY candidate concurrently inside one app process"
);
check(
  workersSource.includes("parseUploadOriginScope(inputData.getString(KEY_ORIGIN_SCOPE))") &&
    workersSource.includes("parseUploadOriginScope(inputData.getString(KEY_ORIGIN_SCOPE)) ?: run {") &&
    workersSource.includes("status.publishProgress(analysisFailureProgress(retrying = false, statusCode = null))") &&
    workersSource.includes("return Result.failure()") &&
    !workersSource.includes("UploadOriginScope.ALL") &&
    !workersSource.includes("enum class UploadOriginScope { ALL"),
  "Upload origin scope still fails open when WorkManager input is missing or invalid"
);
check(
  cardRepository.indexOf("flushPrivacyFeedback(session)") < cardRepository.indexOf("api.cards(bearer, cursor)") &&
    cardRepository.includes("pendingFeedbackByAction(FeedbackAction.TOO_PRIVATE.name)") &&
    cardRepository.indexOf("acknowledgePrivacyFeedback(privacyFeedback)") > cardRepository.indexOf("} while (cursor != null)") &&
    cardRepository.includes("if (dto.cardId in privacyCardIds) return@forEach") &&
    cardRepository.includes("candidate?.analysisState == AnalysisState.NEVER_ANALYZE.name") &&
    !cardRepository.slice(
      cardRepository.indexOf("private suspend fun flushPrivacyFeedback("),
      cardRepository.indexOf("private suspend fun acknowledgePrivacyFeedback(")
    ).includes("removeFeedback(") &&
    cardDaos.includes('WHERE action = :action ORDER BY createdAtMillis ASC, id ASC"') &&
    !cardDaos.includes('WHERE action = :action ORDER BY createdAtMillis ASC, id ASC LIMIT'),
  "TOO_PRIVATE feedback can be delayed behind card download or resurrected from a stale card page"
);
for (const marker of ["class ImportedCopyCleanupWorker", "photos.purgeExpiredImportedCopies(Instant.now())", "scheduleImportedCopyCleanup", "ExistingPeriodicWorkPolicy.KEEP", "Duration.ofHours(12)"]) {
  check(workersSource.includes(marker), `Pause-independent local import cleanup is missing marker: ${marker}`);
}
check(applicationSource.includes("scheduleImportedCopyCleanup(this)"), "App startup does not enqueue local import retention cleanup");
check(jpegMetadataGuard.includes("marker !in 0xE0..0xEF") && !jpegMetadataGuard.includes("requireSafeJfif"), "Final JPEG guard still accepts an application metadata segment");
check(jpegMetadataStripper.includes("marker !in 0xE0..0xEF && marker != 0xFE"), "JPEG sanitizer does not strip every APP and COM segment");
for (const marker of ["finally", "hashSample", "it !== sample", "bitmap.recycle()"] ) {
  check(privacyFilterSource.includes(marker), `ML Kit bitmap cleanup is missing marker: ${marker}`);
}
check(
  mainActivity.includes("val displayBitmap = bitmap") &&
    mainActivity.includes("DisposableEffect(displayBitmap)") &&
    mainActivity.includes("onDispose { displayBitmap?.takeUnless { it.isRecycled }?.recycle() }"),
  "Compose photo thumbnail can recycle the newly published bitmap from a stale DisposableEffect"
);
for (const marker of ["Normalizer.Form.NFKC", "sensitiveFlagsFromSignals", "IDENTITY_NUMBER", "GROUPED_BANK_CARD_NUMBER", "IDENTIFIER_SEPARATORS", "identityMarkerCount >= 3"]) {
  check(privacyFilterSource.includes(marker), `OCR-sensitive normalization is missing marker: ${marker}`);
}
for (const marker of ["fullWidthAndSeparatedIdentityNumberIsBlocked", "fullWidthGroupedVisaNumberIsBlocked", "groupedCardNumberIsBlockedEvenWhenLogoIsCroppedOut", "unrelatedDatesAndPhoneNumberAreNotPromotedToCardOrIdentity"]) {
  check(privacySignalJvmTest.includes(marker), `OCR-sensitive policy test is missing case: ${marker}`);
}
for (const marker of ["bundledOcrAndPolicyBlockGroupedBankCardOnFinalJpegBytes", "MlKitPrivacyFilter", "analyzeBytes(bytes, emptySet())", "contains(\"bank_card\")"]) {
  check(privacyFilterDeviceTest.includes(marker), `Final-byte ML Kit privacy test is missing case: ${marker}`);
}
check(imageSanitizerSource.includes("finally") && imageSanitizerSource.includes("check(activeScaled.compress") && imageSanitizerSource.includes("source.recycle()"), "Image sanitizer does not fail closed and recycle bitmaps");
check(
  orientedBitmapDecoder.includes("fun decodeBoundedThumbnail(") &&
    orientedBitmapDecoder.includes("inJustDecodeBounds = true") &&
    orientedBitmapDecoder.includes("thumbnailSampleSizeFor(bounds.outWidth, bounds.outHeight, maximumOutputSide)") &&
    orientedBitmapDecoder.includes("boundOutputBitmap(applyExifOrientation(decoded, orientation), maximumOutputSide)") &&
    orientedBitmapDecoder.includes("if (scaled !== source) source.recycle()") &&
    mainActivity.includes("decodeBoundedThumbnail(context.contentResolver, Uri.parse(uri), DETAIL_THUMBNAIL_MAX_SIDE_PX)") &&
    mainActivity.includes("DETAIL_THUMBNAIL_MAX_SIDE_PX = 1280") &&
    !mainActivity.includes("BitmapFactory::decodeStream") &&
    dailyWidget.includes("decodeBoundedThumbnail(context.contentResolver, Uri.parse(uriValue), WIDGET_THUMBNAIL_MAX_SIDE_PX)") &&
    dailyWidget.includes("WIDGET_THUMBNAIL_MAX_SIDE_PX = 320") &&
    !dailyWidget.includes("inSampleSize = 4"),
  "Detail or widget thumbnail decoding is not bounds-first, EXIF-aware, and allocation-bounded"
);
for (const marker of ["preferencesDataStore", "SharedPreferencesMigration", "widgetStateUpdateMutex.withLock", "dataStore.edit", "MAX_DAILY_WIDGET_SWITCHES", "persisted.isNewerThan(today)", "day > requestedDay"]) {
  check(widgetStateStore.includes(marker), `Widget quota persistence is missing atomic state marker: ${marker}`);
}
for (const marker of ["fun observe(): Flow<WidgetPersistentState>", "distinctUntilChanged()", "getOrNull(currentIndex + 1)"]) {
  check(widgetStateStore.includes(marker), `Widget live state or no-wrap progression is missing marker: ${marker}`);
}
check(
  dailyWidget.includes("store.selectForDisplay") &&
    dailyWidget.includes("store.observe().collectAsState(initialState)") &&
    dailyWidget.includes("widgetStateStore(context).tryAdvance") &&
    dailyWidget.includes("futureForWidget(today, MAX_DAILY_WIDGET_SWITCHES)") &&
    dailyWidget.includes("listOfNotNull(current) + future") &&
    dailyWidget.includes("MainActivity.EXTRA_CARD_ID") &&
    dailyWidget.includes("Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP") &&
    !dailyWidget.includes("getSharedPreferences(") &&
    !dailyWidget.includes(".apply()"),
  "Widget rendering, progression, or card deep-link bypasses live atomic state"
);
for (const marker of ["0 until 32", "raceTapsAndRefresh", "WidgetPersistentState(DAY_ONE, \"third\", 2)", "persisted quota survives store recreation", "switching never wraps back", "next day resets once", "late previous-day callbacks cannot roll back the quota day"]) {
  check(widgetStateJvmTest.includes(marker), `Widget JVM concurrency evidence is missing marker: ${marker}`);
}
for (const marker of ["SharedPreferencesMigration", "PreferenceDataStoreFactory.create", "0 until 32", "cancelAndJoin", "nextDayCommitted", "WidgetPersistentState(DAY_TWO, \"third\", 2)"]) {
  check(widgetStateDeviceTest.includes(marker), `Widget device persistence evidence is missing marker: ${marker}`);
}
for (const marker of ["remainingQuota", "remainingCards", "暂无更多卡片", "今天已换 2 次"]) {
  check(widgetSwitchPolicy.includes(marker), `Widget switch affordance is missing marker: ${marker}`);
}
for (const marker of ["single card never offers a dead switch action", "remaining label reflects both quota and unseen cards", "end of list and invalid current card fail closed"]) {
  check(widgetSwitchPolicyTest.includes(marker), `Widget switch affordance test is missing case: ${marker}`);
}
for (const marker of ["it.status == SCHEDULED_STATUS", "SCHEDULED_STATUS = \"scheduled\"", "!it.scheduledDate.isAfter(today)", "focusedCardId"]) {
  check(dailyCardPolicy.includes(marker), `Daily-card visibility policy is missing marker: ${marker}`);
}
for (const marker of ["future cache stays hidden", "focused future card", "unknown or unscheduled focus"]) {
  check(dailyCardPolicyTest.includes(marker), `Daily-card visibility test is missing case: ${marker}`);
}
for (const marker of ["UNCERTAIN_OBJECT_CONFIDENCE = 0.72", "cardTitleForConfidence", "这可能是", "slice(0, 30)"]) {
  check(backendCardPresentation.includes(marker), `Backend object-certainty policy is missing marker: ${marker}`);
}
for (const marker of ["below the threshold", "at and above the threshold", "keeps the title schema bound", "fails closed"]) {
  check(backendCardPresentationTest.includes(marker), `Backend object-certainty test is missing case: ${marker}`);
}
for (const marker of ["detectedObjectName: entity.displayName.trim()", "cardTitleForConfidence(draft.title, entity.displayName, entity.confidence)"]) {
  check(analysisService.includes(marker), `Analysis service does not persist explicit object identity: ${marker}`);
}
for (const marker of ["detected_object_name text", "SET NOT NULL", "BETWEEN 1 AND 60"]) {
  check(detectedObjectMigration.includes(marker), `PostgreSQL object-name migration is missing marker: ${marker}`);
}
for (const marker of ["detectedObjectName: String(row.detected_object_name)", "detected_object_name, body", "card.detectedObjectName"]) {
  check(postgresRepositories.includes(marker), `PostgreSQL card repository does not round-trip object identity: ${marker}`);
}
check(
  openApi.components?.schemas?.Card?.required?.includes("detectedObjectName") &&
    openApi.components?.schemas?.Card?.properties?.detectedObjectName?.maxLength === 60,
  "OpenAPI Card schema does not require the bounded detected object name"
);
for (const marker of ["val detectedObjectName: String", "detectedObjectName = dto.detectedObjectName"]) {
  check(
    localEntities.includes(marker) || androidApiSource.includes(marker) || cardRepository.includes(marker),
    `Android card pipeline is missing explicit object identity marker: ${marker}`
  );
}
for (const marker of ["version = 10", "MIGRATION_8_9", "ADD COLUMN `detectedObjectName` TEXT NOT NULL DEFAULT ''"]) {
  check(databaseSource.includes(marker), `Room object-name migration is missing marker: ${marker}`);
}
for (const marker of ["UNCERTAIN_OBJECT_CONFIDENCE = 0.72", "HIGH_OBJECT_CONFIDENCE = 0.90", "titleAlreadyCarriesIdentity", "识别把握较低", "未知物件"]) {
  check(cardRecognitionPolicy.includes(marker), `Android object-certainty policy is missing marker: ${marker}`);
}
for (const marker of ["canonical uncertain title does not repeat", "low confidence remains explicit", "medium qualitative label", "high qualitative label", "blank legacy value fails closed", "invalid confidence fails closed"]) {
  check(cardRecognitionPolicyTest.includes(marker), `Android object-certainty test is missing case: ${marker}`);
}
check(
  mainActivity.includes("cardRecognitionPresentation(card.title, card.detectedObjectName, card.confidence)") &&
    mainActivity.includes("recognition.visibleLabel") &&
    mainActivity.includes("recognition.accessibilityLabel"),
  "App card omits the full deduplicated object identity or accessibility presentation"
);
check(
  dailyWidget.includes("cardRecognitionPresentation(card.title, card.detectedObjectName, card.confidence)") &&
    dailyWidget.includes("recognition.compactLabel"),
  "Widget card does not consume the domain-owned compact object identity presentation"
);
check(
  mainViewModel.includes("visibleDailyCards(") &&
    mainViewModel.includes("focusedCardId") &&
    mainActivity.includes("viewModel.focusCard(intent.getStringExtra(EXTRA_CARD_ID))") &&
    mainActivity.includes('EXTRA_CARD_ID = "cn.jianwei.app.extra.CARD_ID"'),
  "App daily feed can expose future cache or widget card deep-link is not focused"
);
check(androidManifest.includes("android.permission.POST_NOTIFICATIONS"), "Item reminders are missing the Android notification permission declaration");
check(mainActivity.includes("确认并开启提醒") && mainActivity.includes("datePicker.maxDate"), "Item tracking does not require an explicit non-future start-date confirmation");
check(
  mainActivity.includes("WidgetCallToAction(onAddWidget)") &&
    mainActivity.includes("每天在桌面遇见新知识") &&
    mainActivity.includes('Text("添加桌面组件")') &&
    mainActivity.includes("shouldShowWidgetCallToAction(showSavedCards, index)") &&
    mainActivity.includes("shouldStackWidgetCallToAction(maxWidth.value, fontScale)") &&
    mainActivity.includes("shouldUseCompactTabLabels(maxWidth.value, fontScale)") &&
    mainActivity.includes("role = Role.Tab") &&
    mainActivity.includes("selected = true") &&
    mainActivity.includes('contentDescription = "每日卡片"') &&
    discoveryUiPolicy.includes("!showSavedCards && cardIndex == 0") &&
    discoveryUiPolicy.includes("availableWidthDp < 360f || fontScale >= 1.5f") &&
    discoveryUiPolicy.includes("shouldUseCompactTabLabels"),
  "The post-card widget conversion CTA is missing or can repeat in the saved collection"
);
check(mainActivity.includes("notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)"), "Notification permission is not tied to the explicit reminder flow");
check(
  mainActivity.includes("val completeOnboarding = {") &&
    mainActivity.includes("saveInterests(interests)\n                            completeOnboarding()\n                            choosePhotos()") &&
    !mainActivity.slice(
      mainActivity.indexOf("val picker = rememberLauncherForActivityResult"),
      mainActivity.indexOf("val permission = rememberLauncherForActivityResult")
    ).includes("uris.isNotEmpty()"),
  "Picker-only onboarding is still coupled to selecting at least one photo"
);
for (const marker of [
  'Tap-Text $stepThree $pickerText "photo picker"',
  'Save-Ui "system-photo-picker"',
  'Save-Ui "picker-cancelled-home"',
  "Find-ContentDescriptionNode $pickerCancelledHome $dailyCardsText",
  '$pickerCancelAnalysisWork -ne "0"',
  "pickerCancelHome=1 pickerCancelAnalysisWork=0"
]) {
  check(accessibilitySmoke.includes(marker), `Picker cancellation accessibility evidence is missing marker: ${marker}`);
}
check(
  mainActivity.includes("viewModel.ensureDailyRefresh(photoAccess)") &&
    mainViewModel.includes("fun ensureDailyRefresh(access: PhotoAccess)") &&
    mainViewModel.includes("!scheduler.isPaused() && shouldScheduleAutomaticDiscovery(access)"),
  "Daily analysis refresh is not deferred until onboarding and broad photo consent are complete"
);
check(
  mainActivity.includes("viewModel.reconcilePhotoAccess(photoAccess)") &&
    mainViewModel.includes("scheduler.stopAutomaticDiscovery()") &&
    mainViewModel.includes("scheduler.scheduleAccessReconciliation(access)") &&
    workManagerScheduler.includes("putString(DailyPipelineKickWorker.KEY_ACCESS, PhotoAccess.PICKER_ONLY.name)") &&
    !workManagerScheduler.slice(workManagerScheduler.indexOf("private fun automaticCancellationOperations"), workManagerScheduler.indexOf("private fun cancellationOperations")).includes("IMPORTED"),
  "Foreground permission reconciliation does not stop only automatic discovery after revocation"
);
check(
  workManagerScheduler.includes("beginUniqueWork(RECONCILIATION, ExistingWorkPolicy.REPLACE, scan)") &&
    workManagerScheduler.includes("UploadOriginScope.MEDIA_STORE.name") &&
    workManagerScheduler.includes("UploadOriginScope.EXPLICIT_IMPORT.name") &&
    workersSource.includes("catch (error: CancellationException)") &&
    !workersSource.includes("photos.updateAnalysis(candidate.localId, AnalysisState.QUEUED)"),
  "Permission reconciliation can still lose or cross-consume explicit-import candidates"
);
check(
  workersSource.includes("effectiveScanAccess(requestedAccess, permissionGate.currentAccess())") &&
    workersSource.includes("requested == PhotoAccess.PARTIAL || current == PhotoAccess.PARTIAL"),
  "A stale full-access ScanWorker can exceed the current partial-photo scope"
);
check(!mainViewModel.includes("init {\n        if (!scheduler.isPaused()) scheduler.scheduleDailyRefresh()"), "MainViewModel still schedules analysis work before onboarding consent");
for (const marker of ["shouldScheduleAutomaticDiscovery", "PhotoAccess.PICKER_ONLY", "不会自动扫描", "先选择一张照片", "分析已暂停"]) {
  check(discoveryUiPolicy.includes(marker), `Permission-aware empty discovery policy is missing marker: ${marker}`);
}
for (const marker of ["AnalysisPhase.QUEUED", "AnalysisPhase.SCANNING", "AnalysisPhase.FILTERING", "AnalysisPhase.SYNCING", "AnalysisPhase.NO_MATCH", "AnalysisPhase.RETRYING", "AnalysisPhase.FAILED", "EmptyDiscoveryAction.RETRY"]) {
  check(discoveryUiPolicy.includes(marker), "Truthful first-card UI state is missing marker: " + marker);
}
for (const marker of ["completedAnalysisProgress", "analysisFailureProgress", "cachedCardCount > 0", "status.publishProgress", "AnalysisPhase.NO_MATCH"]) {
  check(workersSource.includes(marker), "Durable analysis worker state is missing marker: " + marker);
}
for (const marker of ["KEY_PHASE", "KEY_DISCOVERED", "KEY_ELIGIBLE", "KEY_CACHED_CARDS", "LEGACY_KEY_MESSAGE", "observeProgress", "publishProgress"]) {
  check(analysisStatusRepository.includes(marker), "Analysis progress persistence is missing marker: " + marker);
}
for (const marker of ["pipeline phases produce truthful empty states and actions", "retry and failure remain visible even when cached cards exist"]) {
  check(discoveryUiPolicyTest.includes(marker), "Analysis progress UI test is missing marker: " + marker);
}
for (const marker of ["structuredProgressSurvivesRepositoryRecreationWithoutPhotoMetadata", "containsExactly", "cached_card_count"]) {
  check(analysisStatusDeviceTest.includes(marker), "Analysis progress device evidence is missing marker: " + marker);
}
for (const marker of ["terminal progress distinguishes ready cache from honest no match", "bounded retry becomes visible terminal failure without claiming publication"]) {
  check(uploadRetryPolicyTest.includes(marker), "Analysis terminal-state test is missing marker: " + marker);
}
for (const marker of ["preConsentAnalysisWork=0", "deniedAnalysisWork=0", "revokedAutoWork=0", "partialScope=1", "partialReconciliation=1", "deniedFallback=1", "falsely claimed automatic scanning started"]) {
  check(appSmoke.includes(marker), `App smoke is missing pre-consent or denial-state coverage: ${marker}`);
}
check(reminderScheduler.includes("OneTimeWorkRequestBuilder<ItemReminderWorker>") && reminderScheduler.includes("ExistingWorkPolicy.REPLACE"), "Local item reminders are not durable unique WorkManager jobs");
check(reminderScheduler.includes("VISIBILITY_PRIVATE") && reminderScheduler.includes("setPublicVersion("), "Reminder lock-screen content is not privacy-redacted");
check(reminderScheduler.includes("putExtra(MainActivity.EXTRA_CARD_ID, cardId)"), "Reminder notification does not route back to its tracked card");
check(
  !reminderScheduler.includes("KEY_CARD_TITLE") &&
    !reminderScheduler.includes("「$cardTitle」") &&
    !reminderPrivacyDeviceTest.includes("cardTitle ="),
  "Reminder work or notification still persists the private card title"
);
check(
  reminderScheduler.includes("@HiltWorker") &&
    reminderScheduler.includes("cards.isTrackedReminderCurrent(cardId, startedOn, reminderDays)") &&
    cardRepository.includes("override suspend fun isTrackedReminderCurrent(") &&
    cardRepository.includes("return cards.isTrackedReminderCurrent(") &&
    daosSource.includes("INNER JOIN knowledge_cards AS card ON card.cardId = tracked.cardId") &&
    daosSource.includes("tracked.syncAction != 'DELETE'") &&
    appBuild.includes("ksp(libs.androidx.hilt.compiler)"),
  "Reminder worker does not fail closed against durable tracking state before notification"
);
for (const marker of ["missingCardOrTrackingCannotNotifyEvenWhenStaleWorkStillExecutes", "missingCardRequest", "activeNotifications", "contains(\"你追踪的物品到复查时间了\")", "contentIntent.send(", "MODE_BACKGROUND_ACTIVITY_START_ALLOWED", "awaitOpenedCardId", "MainActivity.EXTRA_CARD_ID", "doesNotContain(notificationId)", "doesNotContain(\"隐私测试物品\")"]) {
  check(
    reminderPrivacyDeviceTest.includes(marker),
    `API 34 reminder privacy crash-window evidence is missing marker: ${marker}`
  );
}
const localReminderSchedule = mainViewModel.indexOf("itemReminders.schedule(cardId, startedOn, reminderDays)");
const reminderOutboxWrite = mainViewModel.indexOf("cards.track(cardId, startedOn, reminderDays)");
check(localReminderSchedule >= 0 && reminderOutboxWrite > localReminderSchedule, "Local item reminder is not committed before cloud-sync outbox work");
check(cardRepository.includes("cards.upsertTrackedItem(") && cardRepository.includes("flushTrackedItems(session)"), "Item tracking is missing its offline cloud-sync outbox");
const trackApiCall = cardRepository.indexOf("TRACK_UPSERT -> api.track(");
const trackAck = cardRepository.indexOf("cards.markTrackedItemSynced(pending.cardId, pending.updatedAtMillis)");
const untrackApiCall = cardRepository.indexOf("TRACK_DELETE -> api.cancelTracking(bearer, pending.cardId)");
const untrackAck = cardRepository.indexOf("TRACK_DELETE -> cards.removeTrackedItemIfMatches(");
check(trackApiCall >= 0 && trackAck > trackApiCall, "Pending item tracking can be acknowledged before a successful API response");
check(untrackApiCall >= 0 && untrackAck > untrackApiCall, "Pending item cancellation can be removed before a successful API response");
check(cardRepository.includes("expectedUpdatedAtMillis") || cardRepository.includes("pending.updatedAtMillis"), "Reminder outbox acknowledgements are not version-guarded");
check(androidApiSource.includes('@DELETE("v1/items/{cardId}/track")') && serverSource.includes('app.delete("/v1/items/:cardId/track"'), "Reminder cancellation API is missing on Android or backend");
check(databaseSource.includes("version = 10") && databaseSource.includes("MIGRATION_6_7"), "Persistent reminder lifecycle Room migration is missing");
check(mainActivity.includes("物品提醒已开启") && mainActivity.includes("取消物品提醒") && mainActivity.includes("确认取消"), "Reminder visible state/update/cancel UI is incomplete");
check(mediaIndexPolicy.includes("if (access == PhotoAccess.FULL) stored else null"), "Partial-photo scans still trust a stale MediaStore authorization watermark");
check(mediaRepository.includes("catch (_: SecurityException)") && !mediaRepository.includes("catch (_: Exception)"), "MediaStore query defects can still be silently reported as an empty successful scan");
check(!mediaRepository.includes("$MEDIA_FRESHNESS_EXPRESSION > ?") && mediaRepository.includes("MediaStore.Images.Media.DATE_ADDED} > ?"), "Android 14-incompatible CASE predicate remains in the incremental MediaStore query");
check(
  mediaRepository.includes("mediaRecencySelectionArgs(capturedSinceMillis)") &&
    mediaRepository.includes("capturedSinceMillis.floorDiv(1_000L)") &&
    mediaRepository.includes("MediaStore.Images.Media.DATE_ADDED} >= ? OR") &&
    mediaRepository.includes("MediaStore.Images.Media.DATE_MODIFIED} >= ?"),
  "Photos without DATE_TAKEN can still escape the requested MediaStore recency window"
);
for (const marker of ["repeat(501)", "maximum = 900", "unchanged.discovered", "added.discovered", "refreshed.discovered", "PhotoAccess.PARTIAL", "partialReconciliation.inserted"]) {
  check(mediaIncrementalDeviceTest.includes(marker), `Real MediaStore incremental device test is missing assertion: ${marker}`);
}
for (const marker of ["missingTakenDateFallsBackToRecentMediaTimestampsWithoutEscapingScanWindow", "oldWithoutTaken", "recentWithoutTaken", "oldTakenButRecentlyAdded", "recentTakenButOldMetadata"]) {
  check(mediaIncrementalDeviceTest.includes(marker), `MediaStore recency-boundary device test is missing assertion: ${marker}`);
}
for (const marker of ["cloudDeleteConfirmation=1", "reminderPermissionDeferred=1", "reminderDeniedNoWork=1", "reminderOfflineLocal=1", "reminderSyncOutbox=1", "reminderVisibleState=1", "reminderUpdate=1", "reminderCancel=1", "cloudDeleteReminderCancel=1", "cloudDeleteLocalAtomic=1"]) {
  check(appSmoke.includes(marker), `Android app smoke is missing reminder assertion: ${marker}`);
}
for (const marker of ["collectionVisible=1", "collectionRestart=1", "collectionRemove=1", "collectionResaveIdempotent=1", "SELECT count(*) FROM saved_cards", "saved=$remainingSaved"]) {
  check(appSmoke.includes(marker), `Android app smoke is missing saved-card assertion: ${marker}`);
}
check(
  appSmoke.includes("[switch]$PrepareWidgetFixture") &&
    appSmoke.indexOf('if ($PrepareWidgetFixture)') > appSmoke.indexOf('throw "Cloud deletion did not await reminder cancellation') &&
    widgetSmoke.includes("-PrepareWidgetFixture:(-not $SkipPrivateDatabaseChecks)"),
  "Widget smoke still depends on cloud state left behind by a previous smoke gate"
);
for (const marker of ["forbiddenRuntimeLogPatterns", "--uid=$packageUid", "releaseLogPrivacy=1", "analysisInstance", "privateImportPath"]) {
  check(releaseSmoke.includes(marker), `Release runtime log privacy audit is missing marker: ${marker}`);
}
check(androidReferenceSuite.includes("releaseLogPrivacy=1"), "Android reference result does not bind the Release runtime log privacy gate");
for (const command of ["pnpm build", "pnpm release:identity -- --self-test", "pnpm e2e:self-test", "pnpm e2e", "check-api-contract.mjs --self-test", "check-api-contract.mjs", "check-supply-chain.mjs --self-test", "check-supply-chain.mjs", "check-beta-readiness.mjs --self-test", "sign-beta-evidence.mjs --self-test", "sign-beta-evidence-assembly.mjs --self-test", "create-image-evaluation-run.mjs --self-test", "compile-image-evaluation.mjs --self-test", "compile-card-audit.mjs --self-test", "create-card-audit-template.mjs --self-test", "compile-beta-cohort.mjs --self-test", "create-physical-device-run-manifest.mjs --self-test", "compile-physical-device-runs.mjs --self-test", "create-accessibility-audit-manifest.mjs --self-test", "compile-accessibility-audit.mjs --self-test", "create-beta-evidence-assembly-manifest.mjs --self-test", "assemble-beta-evidence.mjs --self-test", "kimi-adversarial-review.mjs --self-test", "verify-release-apk-windows.ps1 -SelfTest", "check-knowledge-sources.mjs --self-test", "check-knowledge-sources.mjs", "preflight-knowledge-sources.mjs --self-test", "ingest-topic-batch.mjs --self-test", "apply-catalog-draft-correction.mjs --self-test", "create-rejected-fact-replacement-batch.mjs --self-test", "apply-rejected-fact-replacements.mjs --self-test", "build-knowledge-review-queue.mjs --self-test", "create-knowledge-review-batch.mjs --self-test", "knowledge-review-workbench.mjs --self-test", "apply-knowledge-review-batch.mjs --self-test"]) {
  check(ciWorkflow.includes(command), `CI is missing required gate: ${command}`);
}
for (const marker of ["ExpectedSignerSha256", "Android Debug|Test Only|Local R8 Smoke", '$badging.PackageName -ne "cn.jianwei.app"', "$badging.MinSdk -ne 26", "$badging.TargetSdk -ne 36", "formalSigning = $true", "debugCertificate = $false", "RELEASE_APK_VERIFIER_SELF_TEST=GO"]) {
  check(releaseApkVerifier.includes(marker), `Release APK verifier is missing fail-closed marker: ${marker}`);
}
for (const marker of ["manifest.reportSetSha256 === reportsSha256", "assignments.length === sortedReports.length", "expandedObservedThrough.getTime() >= completedAt.getTime() + 7 * DAY_MS", "Math.min(...grayDurations)", "validHumanId(manifest.cohortOwner)", "BETA_COHORT_COMPILER_SELF_TEST=GO", "releaseEvidence=0"]) {
  check(betaCohortCompiler.includes(marker), `Beta cohort compiler is missing fail-closed marker: ${marker}`);
}
for (const marker of ["createPhysicalDeviceRunManifest", "preconfirmed=0", "releaseEvidence=0", 'flag: "wx"']) {
  check(physicalDeviceManifest.includes(marker), `Physical-device manifest is missing fail-closed marker: ${marker}`);
}
for (const marker of ["compilePhysicalDeviceRuns", "sevenDayWindow=1", "artifactShaBinding=1", "apkShaBinding=1", "humanConfirmation=1", "bypassesRejected=11", 'flag: "wx"']) {
  check(physicalDeviceCompiler.includes(marker), `Physical-device compiler is missing fail-closed marker: ${marker}`);
}
for (const marker of ["input-set SHA-256 changed after manifest creation", "report/evidence binding is stale", "humanConfirmed !== true", "7 * DAY_MS", "cannot reuse the same retained evidence bundle", "Emulator-like build fingerprint", "validateCompiledPhysicalDeviceArtifact"]) {
  check(physicalDeviceLibrary.includes(marker), `Physical-device evidence library is missing fail-closed marker: ${marker}`);
}
for (const marker of ["createAccessibilityAuditManifest", "preconfirmed=0", "releaseEvidence=0", 'flag: "wx"']) {
  check(accessibilityAuditManifest.includes(marker), `Accessibility-audit manifest is missing fail-closed marker: ${marker}`);
}
for (const marker of ["compileAccessibilityAudit", "humanTalkBack=1", "shaBound=1", "apkShaBinding=1", "bypassesRejected=12", 'flag: "wx"']) {
  check(accessibilityAuditCompiler.includes(marker), `Accessibility-audit compiler is missing fail-closed marker: ${marker}`);
}
for (const marker of ["Accessibility report/evidence binding is stale", "explicit accountable-human confirmation", "spokenOutputReviewed !== true", "parsed value does not match its SHA-bound bytes", "Emulator-like build fingerprint", "validateCompiledAccessibilityArtifact", "not bound to the same compiled physical-device run"]) {
  check(accessibilityAuditLibrary.includes(marker), `Accessibility-audit library is missing fail-closed marker: ${marker}`);
}
for (const marker of ["createBetaEvidenceAssemblyManifest", "preconfirmed=0", "releaseEvidence=0", "artifactBindings=8", "knowledgeByteBindings=2", "reviewerPolicyBinding=1", "deploymentReceiptBinding=1", "directAccessibilityClaims=0", 'flag: "wx"']) {
  check(betaEvidenceAssemblyManifest.includes(marker), `Beta evidence assembly manifest is missing fail-closed marker: ${marker}`);
}
for (const marker of ["assembleBetaEvidence", "bypassesRejected !== 21", "REPOSITORY_ROOT", "const WORKING_ROOT = await realpath(process.cwd())", "canonicalWorkingRoot=1", "repository-pinned and cannot be overridden", "assertPinnedOrdinaryPolicy(deploymentPolicyPath)", "ordinary repository-pinned file", "--deployment-receipt", "catalogBytes", "backlogBytes", "knowledgeByteBinding=1", "reviewerPolicyBinding=1", "releaseApkShaBinding=1", "backendReleaseBinding=1", "containerImageBinding=1", "deploymentReceiptBinding=1", "deploymentReceiptSignature=1", "forgedSelfConsistentCloudRejected=1", "contentGate=GO", "attestationPending=1", "finalGate=PENDING", "autoClaims=0", 'flag: "wx"']) {
  check(betaEvidenceAssembler.includes(marker), `Beta evidence assembler is missing fail-closed marker: ${marker}`);
}
for (const marker of ["schemaVersion: 3", "assemblyProvenance", "artifactCount: ARTIFACT_NAMES.length", "knowledgeCatalogSha256", "topicBacklogSha256", "knowledgeReviewerPolicySha256", "validateKnowledgeBindings", "Knowledge catalog or topic backlog changed after human manifest approval", "Protected knowledge reviewer allowlist changed after human manifest approval", "requireTrustedAssembly: false", "verifiedDeploymentReceipt", "assessEvidence(evidence", "assessKnowledge(catalog", "SHA-256 changed after human manifest approval", "parsed value does not match its SHA-bound bytes", "validateCloudRunDigest", "verifyDeploymentReceipt", "validateDeploymentReceiptBinding", "Verified deployment receipt does not match cloud artifact", "validateCompiledAccessibilityArtifact", "assemblyApproved !== true", "Final Beta gate rejected assembled evidence", "assertOrdinaryDirectory(evaluationRoot)"]) {
  check(betaEvidenceAssemblyLibrary.includes(marker), `Beta evidence assembly library is missing fail-closed marker: ${marker}`);
}
for (const marker of ["createBetaCohortManifest", "BETA_COHORT_MANIFEST_PREVIEW=GO", "preconfirmed=0", 'flag: "wx"']) {
  check(betaCohortManifest.includes(marker), `Beta cohort manifest creator is missing fail-closed marker: ${marker}`);
}
for (const marker of ["new Set(appVersions).size === 1", "releaseApkDigests", "backendReleaseDigests", "releaseApkShaBinding=1", "backendReleaseBinding=1", "provenance.modelVersion === cardProvenance.modelVersion", "provenance.catalogVersion === cardProvenance.catalogVersion", "crossVersionBinding=1"]) {
  check(betaEvidenceGate.includes(marker), `Beta evidence gate is missing cross-version marker: ${marker}`);
}
for (const marker of ["schemaVersion === 3", "assemblyProvenance", "knowledgeCatalogSha256", "topicBacklogSha256", "knowledgeReviewerPolicySha256", "catalogBytes", "backlogBytes", "approvedReviewerIds", "trustedAssembly", "verifyEvidenceAttestation", "verifyAssemblyAttestation", "verifyDeploymentReceiptForRelease", "const trustVerificationNow = new Date()", "verificationNow: trustVerificationNow", "currentDeploymentReceiptFreshness=1", "requireTrustedAttestation", "REPOSITORY_ROOT", "repository-pinned and cannot be overridden", 'path.join(REPOSITORY_ROOT, "config", "evidence-trust-policy.json")', "JIANWEI_EVIDENCE_TRUST_POLICY_SHA256", "assertIndependentTrustParties", "threePartyKeySeparation=1", "assertPinnedOrdinaryFile(policyPath)", "ordinary non-symlink file", "--attestation", "--assembly-attestation", "bypassesRejected=27", "trustedAttestation=1", "forgedBundleRejected=1", "releaseApproverOnlyRejected=1", "assemblySignatureRequired=1", "assemblyReverification=1", "readPinnedAssemblyInputs", "signed Beta evidence is not the deterministic output of the approved eight-artifact assembly"]) {
  check(betaEvidenceGate.includes(marker), `Beta evidence gate is missing trusted-attestation marker: ${marker}`);
}
for (const marker of ["--confirm-reviewed", "--private-key", "REPOSITORY_ROOT", "JIANWEI_EVIDENCE_TRUST_POLICY_SHA256", "assertExternalOrdinaryPrivateKey(privateKeyPath, REPOSITORY_ROOT)", "must remain outside the repository", 'flag: "wx"', "rogueKeyRejected=1", "repositoryKeyRejected=1", "releaseEvidence=0"]) {
  check(betaEvidenceAttestation.includes(marker), `Beta evidence signer is missing fail-closed marker: ${marker}`);
}
for (const marker of ["beta_release_approver", "beta_assembly_attestor", "beta_deployment_attestor", "roles must use distinct", "externally pinned SHA-256", "publicKeySha256", "beta_evidence_trust_policy", "beta_evidence_attestation", "MAX_ATTESTATION_AGE_MS", "Ed25519", "policySha256", "artifactSha256", "signatureBase64"]) {
  check(betaEvidenceAttestationLibrary.includes(marker), `Beta evidence attestation library is missing trust marker: ${marker}`);
}
for (const marker of ["beta_evidence_trust_policy", "Ed25519", "beta_release_approver", "beta_assembly_attestor", "beta_deployment_attestor", "REPLACE_WITH_ED25519_SPKI_PUBLIC_KEY_PEM"]) {
  check(betaEvidenceTrustPolicyExample.includes(marker), `Beta evidence trust policy example is missing marker: ${marker}`);
}
for (const marker of ["BETA_EVIDENCE_ASSEMBLY_ATTESTATION_ROLE", "artifactBindings=8", "knowledgeByteBindings=2", "reviewerPolicyBinding=1", "singleSignerRejected=1", "JIANWEI_EVIDENCE_TRUST_POLICY_SHA256", "--confirm-reviewed", "must remain outside the repository", 'flag: "wx"']) {
  check(betaEvidenceAssemblyAttestation.includes(marker), `Beta assembly-attestation signer is missing fail-closed marker: ${marker}`);
}
for (const marker of ["beta_evidence_assembly_attestation", "validateEvidenceTrustPolicy", "publicKeySha256", "manifestSha256", "knowledgeCatalogSha256", "topicBacklogSha256", "knowledgeReviewerPolicySha256", "ARTIFACT_NAMES", "artifact bytes", "MAX_ATTESTATION_AGE_MS", "signatureBase64"]) {
  check(betaEvidenceAssemblyAttestationLibrary.includes(marker), `Beta assembly-attestation library is missing trust marker: ${marker}`);
}
for (const marker of ["approved fact must be directly publishable as a 28-80 character card body", "approved card body too long", "protected knowledge reviewer allowlist is required for release readiness", "knowledgeReviewerPolicySha256", "reviewerPolicyBinding=1"]) {
  check(knowledgeReadinessGate.includes(marker), `Knowledge readiness gate is not aligned with production card-body validation: ${marker}`);
}
for (const marker of ["trusted_deployment_receipt", "beta_deployment_attestor", "deploymentRevision", "containerImageDigest", "backendReleaseSha256", "signatureBase64"]) {
  check(deploymentReceiptExample.includes(marker), `Deployment receipt example is missing marker: ${marker}`);
  check(deploymentReceiptVerifier.includes(marker), `Deployment receipt verifier is missing marker: ${marker}`);
  const assemblyMarker = marker === "beta_deployment_attestor" ? "BETA_DEPLOYMENT_ATTESTATION_ROLE" : marker;
  check(assemblyDeploymentReceiptVerifier.includes(assemblyMarker), `Assembly deployment receipt verifier is missing marker: ${marker}`);
}
for (const marker of ["authorizationScope === \"local_and_cloud_evaluation\"", "android_authorized_image_runner", "validPublicHttpsOrigin", "emulatorFingerprint", "imageRunner.endpointOrigin === cloudProvenance.baseUrlOrigin", "cloudAuthorization=1", "androidRunner=1", "runnerCloudBinding=1"]) {
  check(betaEvidenceGate.includes(marker), `Beta evidence gate is missing authorized-image runner marker: ${marker}`);
}
for (const marker of ["createImageEvaluationRunManifest", "labelsShaBinding=1", "apkShaBinding=1", "cloudAuthorization=1", "preconfirmed=0", "photoBytesRead=0", 'flag: "wx"']) {
  check(imageEvaluationRunManifest.includes(marker), `Image evaluation run manifest is missing fail-closed marker: ${marker}`);
}
for (const marker of ["local_and_cloud_evaluation", "evaluationApkSha256", "parsed value does not match its SHA-bound bytes", "does not bind the exact authorized label artifact", "assertAccountableReviewerId"]) {
  check(imageEvaluationRunLibrary.includes(marker), `Image evaluation run library is missing fail-closed marker: ${marker}`);
}
for (const marker of ["authorizationScope", "android_authorized_image_runner", "evaluationApkSha256", "publicHttpsOrigin", "emulatorFingerprint", "bypassesRejected=11"]) {
  check(imageEvaluationCompiler.includes(marker), `Image evaluation compiler is missing Android-runner marker: ${marker}`);
}
for (const marker of ["真人启动检查点", "local_and_cloud_evaluation", "EvaluationArtifacts.approve", "AuthorizedImageEvaluationWorker.start"]) {
  check(imageEvaluationActivity.includes(marker) || imageEvaluationArtifacts.includes(marker), `Android authorized-image human checkpoint is missing marker: ${marker}`);
}
check(imageEvaluationDebugManifest.includes("AuthorizedImageEvaluationActivity") && !androidManifest.includes("AuthorizedImageEvaluationActivity"), "Authorized-image runner Activity is not isolated to the Debug source set");
for (const marker of ["EvaluationArtifacts.verifySampleFile", "APPEND_OR_REPLACE", "setRequiredNetworkType(NetworkType.CONNECTED)", "runAttemptCount < MAX_ATTEMPTS - 1", "production egress decision", "authorizedEvaluationAnalysisClient"]) {
  check(imageEvaluationWorker.includes(marker), `Android authorized-image worker is missing fail-closed marker: ${marker}`);
}
for (const marker of ["labelsSha256", "requireProductionEndpoint", "emulatorFingerprint", "verifyCompleteInputSet", "writeExclusive", "image-evaluation-lease.json", "strictFutureInstant", "AtomicMoveNotSupportedException", "现有结果文件与当前运行不一致"]) {
  check(imageEvaluationArtifacts.includes(marker), `Android authorized-image artifact handling is missing marker: ${marker}`);
}
for (const marker of ["physical Android device", "installedApkSha256", "humanCheckpoint=1", "autoUpload=0", "OutputPath already exists and will not be overwritten", "PurgeDeviceCopy", "Refusing to purge an unscoped device path", "authorized_image_evaluation_lease", "bounded evaluation lease"]) {
  check(imageEvaluationHost.includes(marker), `Authorized-image ADB operator script is missing marker: ${marker}`);
}
for (const marker of ["300-500 authorized samples", "local_and_cloud_evaluation", "tokenHash", "evaluationCandidateToken", "randomBytes(32)", "ttlHours > 168"]) {
  check(evaluationLeaseService.includes(marker), `Bounded evaluation lease service is missing marker: ${marker}`);
}
for (const marker of ["evaluation_leases", "evaluation_lease_samples", "bound_device_id", "consumed_job_id", "max_jobs BETWEEN 300 AND 500"]) {
  check(evaluationLeaseMigration.includes(marker), `Bounded evaluation lease migration is missing marker: ${marker}`);
}
for (const marker of ["x-jianwei-evaluation-lease", "Evaluation lease and context must be supplied together", "tokenHash: hashToken(leaseToken)"]) {
  check(backendServer.includes(marker), `Evaluation lease API is missing marker: ${marker}`);
}
for (const marker of ["AuthorizedEvaluationAnalysisClient", "X-Jianwei-Evaluation-Lease", "EvaluationContextRequest", "analyzeWithJobCreator"]) {
  check(authorizedEvaluationClient.includes(marker) || remoteAnalysisClient.includes(marker), `Android Debug evaluation lease client is missing marker: ${marker}`);
}
check(!androidApiClient.includes("X-Jianwei-Evaluation-Lease") && authorizedEvaluationClient.includes("X-Jianwei-Evaluation-Lease"), "Evaluation lease header is not isolated to the Android Debug source set");
check(gitignore.includes("evaluation/image-evaluation-lease.json"), "Evaluation lease bearer artifact is not gitignored");
check(imageEvaluationArtifacts.includes("evaluationApkSha256") && imageEvaluationArtifacts.includes("installedApkSha256"), "Android image evaluation is not bound to installed APK bytes");
check(betaMetricsStore.includes("installedApkSha256") && betaMetricsStore.includes("applicationInfo.sourceDir"), "App-exported Beta evidence does not hash the installed APK");
check(mainActivity.includes("withContext(Dispatchers.IO) { betaMetrics.exportJson() }"), "Installed APK hashing can block the Android main thread");
for (const marker of ["releaseApkSha256", "backendReleaseSha256", "apkShaBinding=1", "backendReleaseBinding=1"]) {
  check(cardAuditCompiler.includes(marker), `Card audit compiler is missing Release APK binding: ${marker}`);
}
check(cardSnapshotExporter.includes('required(args, "--release-artifact")') && cardSnapshotExporter.includes('required(args, "--cloud-artifact")') && cardSnapshotExporter.includes("different backend Release") && cardSnapshotExporter.includes("cloudProvenance?.containerImageDigest !== cloud.containerImageDigest"), "Card snapshot export is not derived from verified APK/cloud/OCI evidence and stamped card rows");
for (const marker of ["jianwei-backend-release-v1", "deploy/Dockerfile", "knowledge/catalog.json", "release-identity.json is required in production", "mutationSensitive=1"]) {
  check(backendReleaseIdentity.includes(marker), `Backend Release identity is missing fail-closed marker: ${marker}`);
}
for (const marker of ["backend_release_sha256", "cards_backend_release_created_idx", "backend_release_sha256_format"]) {
  check(backendReleaseMigration.includes(marker), `Backend Release identity migration is missing marker: ${marker}`);
}
for (const marker of ["privacy_deletion_receipts", "preference_weight", "ON DELETE CASCADE", "PRIMARY KEY (device_id, card_id)"]) {
  check(privateDeletionMigration.includes(marker), `Private-card deletion receipt migration is missing marker: ${marker}`);
}
for (const marker of ["deleteTooPrivate", "pg_advisory_xact_lock", "privacy_deletion_receipts", "pending_object_deletions", "suppressed_candidates"]) {
  check(postgresRepositories.includes(marker), `Private-card deletion transaction is missing marker: ${marker}`);
}
check(postgresRepositories.includes("backend_release_sha256") && postgresRepositories.includes("this.backendReleaseSha256"), "PostgreSQL cards are not stamped with the running backend Release identity");
check(
  !analysisService.includes("existing.items.length") &&
    analysisService.includes("scheduledDateInChina(new Date(), 0)") &&
    postgresRepositories.includes("card-schedule:${claimedJob.deviceId}") &&
    postgresRepositories.includes("nextAvailableScheduledDate(") &&
    postgresRepositories.includes("scheduledDate: databaseDate(row.scheduled_date)") &&
    postgresRepositories.includes("occupiedRows.map((row) => databaseDate(row.scheduled_date))") &&
    cardScheduling.includes("first unoccupied China-calendar day") &&
    cardScheduling.includes("if (!occupied.has(candidate)) return candidate"),
  "Card scheduling can drift behind historical cards or allocate concurrent duplicate days"
);
for (const marker of ["length: 32", "contiguous per-device days and repairs gaps", "expect(dates).toEqual(expectedDates)", "2026-07-22"]) {
  check(postgresIntegrationTest.includes(marker), `PostgreSQL contiguous card scheduling evidence is missing marker: ${marker}`);
}
for (const marker of ["--reporter=json", "numTotalTests", "tests=$tests", "cardScheduleConcurrency=1"]) {
  check(postgresIntegrationGate.includes(marker), `PostgreSQL gate does not bind dynamic scheduling test evidence: ${marker}`);
}
for (const marker of ["migrations=13", "tests=$TESTS", "detectedObjectMigration=1", "BACKEND_E2E_DATABASE_URL", "schema_migrations", "processStopped=1", "releaseEvidence: false", "local_postgres_integration"]) {
  check(postgresIntegrationMacGate.includes(marker), `macOS PostgreSQL gate is missing evidence marker: ${marker}`);
}
for (const marker of ["toBe(13)", "migration_013_upgrade_test", "旧卡片对象标题", "detectedObjectName).toBe(\"扫帚\")"]) {
  check(postgresIntegrationTest.includes(marker), `PostgreSQL migration 013 evidence is missing marker: ${marker}`);
}
check(backendServer.includes("loadBackendReleaseSha256") && backendServer.includes("backendReleaseSha256") && backendServer.includes("containerImageDigest: config.containerImageDigest"), "Backend readiness does not expose the validated Release and OCI identities");
for (const marker of ['ready.mode === "qwen"', "deployment.verified === true", 'deployment.role === "beta_deployment_attestor"', "ready.backendReleaseSha256 === input.backendReleaseSha256", "ready.containerImageDigest === deployment.containerImageDigest", "deployment.receiptSha256", "input.objects.findJobObject", "server_sensitive_", "waitUntil", "afterDeleteStatus === 401", 'evidenceKind: "verified_cloud_run"']) {
  check(cloudEvidenceCore.includes(marker), `Cloud evidence core is missing fail-closed marker: ${marker}`);
}
for (const marker of ["--confirm-authorized-fixtures", "--release-artifact", "--deployment-receipt", "verifyDeploymentReceipt", 'path.join(REPOSITORY_ROOT, "config", "evidence-trust-policy.json")', "assertPinnedOrdinaryPolicy(deploymentPolicyPath)", "ordinary repository-pinned file", "computeBackendReleaseIdentity", "formally verified Release APK artifact", "complete temporary OSS STS credential set", "hasSafeAnalysisLifecycle", "getBucketVersioning", 'redirect: "error"', 'flag: "wx"']) {
  check(cloudEvidenceCli.includes(marker), `Cloud evidence CLI is missing fail-closed marker: ${marker}`);
}
check(backendPackage.scripts?.["verify:cloud-beta"] === "tsx src/verify-cloud-beta.ts", "Backend cloud evidence command is missing");
for (const marker of ["cloudProvenance.evidenceKind", "cloudProvenance.runSha256", "cloudProvenance.containerImageDigest", "cloudProvenance.deploymentReceiptSha256", "cloud.versioningDisabled === true", "containerImageBinding=1", "deploymentReceiptBinding=1", "cloudProvenance=1"]) {
  check(betaEvidenceGate.includes(marker), `Beta evidence gate is missing cloud-provenance marker: ${marker}`);
}
for (const marker of ["JIANWEI_IMAGE", "JIANWEI_CONTAINER_IMAGE_DIGEST", "JIANWEI_NODE_IMAGE", "declared container digest must exactly match", "imageDigestBinding=1"]) {
  check(containerDeploymentInputs.includes(marker), `Container deployment input gate is missing marker: ${marker}`);
}
for (const marker of ["exactObjectKeys(evidence", "containsForbiddenEvidenceData(evidence)", '"devicetoken"', "postgres(?:ql)?", "evidencePrivacy=1"]) {
  check(betaEvidenceGate.includes(marker), `Beta evidence gate is missing evidence-privacy marker: ${marker}`);
}
for (const marker of ["KIMI_MAX_REVIEW_ROUND", "KIMI_MAX_OUTPUT_TOKENS", "KIMI_TOTAL_TOKEN_BUDGET", "KIMI_REQUEST_TIMEOUT_MS", "estimatedInputTokens + maxOutputTokens > totalTokenBudget", "KIMI_EXTERNAL_SEND_CONFIRMED", "source-snapshot mode is disabled", "max_tokens: maxOutputTokens", "AbortSignal.timeout(requestTimeoutMs)", 'finish_reason !== "stop"', "truncatedResponseRejected=1", "humanCheckpoint=1"]) {
  check(kimiReview.includes(marker), `Kimi review loop is missing guardrail marker: ${marker}`);
}
for (const marker of ["realpathSync.native", "fileURLToPath(metaUrl)", "path.resolve(argvEntry)"]) {
  check(mainModuleGuard.includes(marker), `Canonical CLI entry guard is missing junction-safe marker: ${marker}`);
}
check(betaEvidenceGate.includes("isMainModule(import.meta.url)") && betaEvidenceGate.includes("canonicalMainEntry=1"), "Beta evidence gate can silently skip its CLI through a junction or symlink path");
check(betaCohortCompiler.includes("isMainModule(import.meta.url)"), "Beta cohort compiler can silently skip its CLI through a junction or symlink path");
for (const marker of ["Verifiable exit condition", "Max-iteration cap", "Budget cap in code", "Sandbox", "Human checkpoint"]) {
  check(loopEngineerSkill.includes(marker), `Vendored Loop Engineer skill is missing upstream marker: ${marker}`);
}
for (const marker of ["4b9915415e9fcbecab36b2fbd77b59c4a3ebbb7a", "check-beta-readiness.mjs evaluation\\beta-evidence.json", "KIMI_EXTERNAL_SEND_CONFIRMED=YES", "Source-snapshot mode is disabled"]) {
  check(loopEngineeringContract.includes(marker), `Product loop contract is missing marker: ${marker}`);
}
for (const marker of ["evaluation/beta-evidence.json", "evaluation/beta-evidence.attestation.json", "evaluation/deployment-receipt.json", "evaluation/beta-evidence-assembly-manifest.json", "evaluation/physical-device-run-manifest.json", "evaluation/accessibility-audit-manifest.json", "evaluation/compiled-*.json", "evaluation/*-compiled.json", "evaluation/image-labels.json", "evaluation/image-results.json", "evaluation/image-evaluation-run.json", "evaluation/card-snapshots.json", "evaluation/beta-cohort-manifest.json", "*.private.pem", "*.key.pem"]) {
  check(gitignore.includes(marker), `Controlled Beta evidence is not ignored: ${marker}`);
}
for (const marker of ["Batch was prepared for", "Batch contains duplicate topic", "productionApproved=0", "atomicInput=1", "await realpath", "assertWithin(draftsRoot"]) {
  check(topicBatchIngest.includes(marker), `Topic batch intake is missing fail-closed marker: ${marker}`);
}
const topicDraftLibrary = await readFile(path.join(root, "scripts", "lib", "topic-draft.mjs"), "utf8");
for (const marker of ["draft.intakeMode === \"extend\"", "Extension draft must contain 2-4 facts", "Topic must finish with the controlled 3-5 facts"]) {
  check(topicDraftLibrary.includes(marker), `Topic draft extension is missing controlled-count marker: ${marker}`);
}
for (const marker of ["Correction catalog SHA-256 is stale", "Correction cannot replace approved or attested facts", "Correction must preserve fact identities", "productionApproved=0", "await realpath", "assertWithin(draftsRoot", "await rename"]) {
  check(topicDraftCorrection.includes(marker), `Topic draft correction is missing fail-closed marker: ${marker}`);
}
for (const marker of ["Replacement manifest catalog SHA-256 is stale", "human-attested rejected fact", "reviewStatus !== \"draft\"", "productionApproved: 0", "await realpath", "assertWithin(replacementsRoot", "await rename"]) {
  check(rejectedFactReplacement.includes(marker), `Rejected fact replacement is missing fail-closed marker: ${marker}`);
}
for (const marker of ["REPLACE_WITH_ORIGIN", "REPLACE_WITH_NEW_VERSION", "human-attested rejected fact", "productionApproved=0", "assertWithin(replacementsRoot", "flag: \"wx\""]) {
  check(rejectedFactReplacementTemplate.includes(marker), `Rejected fact replacement template is missing fail-closed marker: ${marker}`);
}
for (const marker of ["grantsApproval: false", "humanReviewRequired: true", "Reachability does not prove", "already attested fact", "mutation=0"]) {
  check(knowledgeReviewQueue.includes(marker), `Knowledge review queue is missing non-authority marker: ${marker}`);
}
for (const marker of ["decision: \"pending\"", "semanticSupportConfirmed: false", "unsupportedClaimsChecked: false", "grantsApproval=0"]) {
  check(knowledgeReviewTemplate.includes(marker) || knowledgeReviewTemplateLibrary.includes(marker), `Knowledge review template is missing fail-closed marker: ${marker}`);
}
for (const marker of ["--confirm-human-review-session", "loopback=127.0.0.1", "grantsApproval=0", "autoApply=0", "staleRevisionRejected=1", "humanCheckpoint=1", "symlinkRejected=", "decisionIdentityPreserved=1", "autosaveRaceSafe=1", "conflictPreservesInput=1", "finalizeFlush=1"]) {
  check(knowledgeReviewWorkbench.includes(marker), `Knowledge review workbench command is missing fail-closed marker: ${marker}`);
}
for (const marker of ["createReviewAutosaveController", "editVersion", "currentModel.decisions", "async function flush()", "markConflict", "本页输入仍完整保留", "重新加载会丢弃本页尚未保存的输入"]) {
  check(knowledgeReviewWorkbenchClient.includes(marker), `Knowledge review workbench client is missing data-loss prevention marker: ${marker}`);
}
check(!knowledgeReviewWorkbenchClient.includes("if(response.status===409)await load()"), "Knowledge review workbench client still reloads destructively on revision conflict");
for (const marker of ["server.listen(port, \"127.0.0.1\"", "Mutation origin is invalid", "CSRF token is invalid", "Review state is stale", "flag: \"wx\"", "assertOrdinaryDirectory(sessionDirectory)", "applyReviewBatch({ catalogText", "Explicit human finalization checkpoint is required", "The workbench writes a completed decision batch only"]) {
  const present = knowledgeReviewWorkbenchLibrary.includes(marker) ||
    (marker === "The workbench writes a completed decision batch only" && knowledgeReviewWorkbench.includes(marker));
  check(present, `Knowledge review workbench library is missing fail-closed marker: ${marker}`);
}
check(knowledgeReviewWorkbenchLibrary.includes("HttpOnly; SameSite=Lax; Path=/"), "Knowledge review workbench bootstrap cookie is not compatible with safe top-level browser navigation");
for (const marker of ["--confirm-human-review", "--write", "atomicDecisions=2", "placeholderVersionRejected=1"]) {
  check(knowledgeReviewApply.includes(marker), `Knowledge review batch apply command is missing explicit-authority marker: ${marker}`);
}
for (const marker of ["catalog SHA-256 is stale", "Approval must explicitly check every referenced source", "semanticSupportConfirmed !== true", "automated_reviewer_forbidden"]) {
  const present = knowledgeReviewLibrary.includes(marker) || (marker === "automated_reviewer_forbidden" && knowledgeReviewLibrary.includes("assertAccountableReviewerId"));
  check(present, `Knowledge review batch library is missing fail-closed marker: ${marker}`);
}
check(deprecatedDirectReview.includes("Direct single-fact approval is disabled"), "Legacy single-fact approval bypass is still enabled");
for (const marker of ["requestPublicHttpsMetadata", "bytes=0-4095", "JianweiSourceVerifier/1.0", "application/pdf", "KNOWLEDGE_SOURCE_PREFLIGHT_SELF_TEST=GO", "dnsPinning=1", "manualRedirect=1"]) {
  check(knowledgeSourcePreflight.includes(marker), `Knowledge source preflight is missing production-contract marker: ${marker}`);
}
for (const marker of ["requestPublicHttpsMetadata", "--resume-successes", "selectResumableSuccesses", "evidence.catalogVersion !== catalogVersion", "evidence.sourceScope !== sourceScope", "86_400_000", "resumedSuccesses", "checkedNow", "isSystemicNetworkFailure", "liveEvidenceOutputPlan", "canonicalUpdated=", "-latest-attempt.json", "dnsPinning=1", "manualRedirect=1", "--google-doh", "resolver: useGoogleDoh ? \"google_doh\" : \"system\"", "privateDohRejected=1"]) {
  check(knowledgeSourceChecker.includes(marker), `Knowledge source resumable evidence is missing fail-closed marker: ${marker}`);
}
for (const marker of ["evidence?.infrastructureFailure !== true", "trusted a systemic network-failure attempt"]) {
  check(knowledgeReviewQueue.includes(marker), `Knowledge review queue can trust failed source infrastructure evidence: ${marker}`);
}
for (const marker of ["dnsLookup", "all: true", "verbatim: true", "https.request", "REDIRECT_STATUSES", "maxRedirects", "addresses.some", "isPublicIpAddress", "hostnameWithoutIpv6Brackets", "servername: isIP(hostname) ? undefined : hostname", "lookup(_hostname", "timeout: timeoutMs", "resolveHostWithGoogleDoh", "https://dns.google/resolve", "application/dns-json", "redirect: \"error\"", "payload?.Question"]) {
  check(safeSourceRequest.includes(marker), `Safe source request helper is missing SSRF defense marker: ${marker}`);
}
check(ciWorkflow.includes("BACKEND_E2E_DATABASE_URL: ${{ env.DATABASE_URL }}"), "CI is missing the PostgreSQL-backed TCP E2E gate");
check(ciWorkflow.includes("name: backend-tcp-e2e-evidence"), "CI does not retain the TCP E2E evidence artifact");

if (failures.length > 0) throw new Error(`Source guardrails failed:\n${failures.join("\n")}`);
process.stdout.write("EXPLICIT_OBJECT_IDENTITY_GATE=GO persisted=1 uncertainWording=1 deduplicatedPresentation=1 accessibilityPercent=1 app=1 widget=1 roomMigration=1 postgresMigration=1\n");
process.stdout.write(`SOURCE_GUARDRAIL_GATE=GO files=${sourceFiles.length} placeholders=0 unscopedPromises=0 absolutePromises=0 clientCloudSecrets=0 evidencePrivacy=1 loopEngineer=1 kimiBudget=1 releaseConfigSeparated=1 formalReleaseVerifier=1 backendReleaseIdentity=1 containerImageBinding=1 deploymentReceiptBinding=1 authorizedImageRunner=1 boundedEvaluationLease=1 apkShaBinding=1 backendReleaseBinding=1 betaCohortProvenance=1 physicalDeviceProvenance=1 accessibilityProvenance=1 betaEvidenceAssembly=1 evidenceTrustRoot=1 assemblyAttestation=1 externalPolicyPin=1 threePartyKeySeparation=1 privateDeletionTransaction=1 persistentFeedbackState=1 feedbackIdempotency=1 privateAffinityReplacement=1 staleTokenDeleteRecovery=1 crashSafeCloudDeletion=1 destructiveConfirmation=1 privacyRetry=1 bitmapCleanup=1 ocrSensitiveNormalization=1 thumbnailBounds=1 atomicWidgetQuota=1 calendarDayWidgetRefresh=1 truthfulAnalysisState=1 widgetCacheExhaustion=1 futureCardCacheHidden=1 widgetSwitchAffordance=1 widgetLiveRefresh=1 widgetCardDeepLink=1 reminderCardDeepLink=1 reminderCardPresence=1 contiguousCardSchedule=1 safeKnowledgeSourceLinks=1 apiSchemaStructure=1 uploadStatusPreserved=1 finalJpegAppReject=1 localImportCleanup=1 cloudEvidenceVerifier=1 feedbackAckGuard=1 reminderConsent=1 reminderLifecycle=1 reminderOutbox=1 reminderPrivacyGuard=1 genericReminderContent=1 mediaStoreIncremental=1 mediaStoreRecencyBoundary=1 partialReconciliation=1 topicBatchAtomic=1 minimalTopicExtension=1 topicCorrectionAtomic=1 reviewQueueNoAuthority=1 reviewWorkbench=1 reviewBatchAtomic=1 directReviewBypass=0 sourcePreflight=1 sourceRequestDnsPinning=1 sourceEvidenceResume=1 sourceInfrastructureFailurePreserved=1 contractGate=1 supplyGate=1 tcpE2EGate=1 postgresTcpE2EGate=1\n`);

function check(condition, message) {
  if (!condition) failures.push(message);
}

async function collect(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await collect(absolute));
    else if (/\.(?:kt|kts|ts|mjs|xml)$/.test(entry.name)) output.push(absolute);
  }
  return output;
}
