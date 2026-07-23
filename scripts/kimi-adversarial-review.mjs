import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const scriptPath = new URL(import.meta.url).pathname.replace(/^\/(.:)/, "$1");
const root = path.resolve(path.dirname(scriptPath), "..");
const apiKey = process.env.MOONSHOT_API_KEY ?? process.env.KIMI_API_KEY;
const kimiCode = apiKey?.startsWith("sk-kimi-") ?? false;
const model = process.env.KIMI_MODEL ?? (kimiCode ? "kimi-for-coding" : "kimi-k3");
const endpoint = process.env.KIMI_ENDPOINT ?? (kimiCode
  ? "https://api.kimi.com/coding/v1/chat/completions"
  : "https://api.moonshot.cn/v1/chat/completions");
const selfTest = process.argv.includes("--self-test");
const safeMode = process.env.KIMI_SAFE_MODE === "1" || selfTest;
const reportPath = path.join(root, "reports", "kimi-adversarial-review.md");
const round = Number.parseInt(process.env.KIMI_REVIEW_ROUND ?? "1", 10);
const maxReviewRound = Number.parseInt(process.env.KIMI_MAX_REVIEW_ROUND ?? "20", 10);
const maxOutputTokens = Number.parseInt(process.env.KIMI_MAX_OUTPUT_TOKENS ?? "32768", 10);
const totalTokenBudget = Number.parseInt(process.env.KIMI_TOTAL_TOKEN_BUDGET ?? "50000", 10);
const requestTimeoutMs = Number.parseInt(process.env.KIMI_REQUEST_TIMEOUT_MS ?? "300000", 10);
const roundReportPath = path.join(root, "reports", `kimi-adversarial-review-round-${round}.md`);

if (!Number.isInteger(round) || round < 1 || !Number.isInteger(maxReviewRound) || maxReviewRound < 1 || maxReviewRound > 100 || round > maxReviewRound) {
  throw new Error("Kimi review round exceeds the hard iteration cap");
}
if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1024 || maxOutputTokens > 32768 ||
    !Number.isInteger(totalTokenBudget) || totalTokenBudget < 4096 || totalTokenBudget > 100000 ||
    !Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 30_000 || requestTimeoutMs > 600_000) {
  throw new Error("Kimi review token budget is invalid");
}
if (!selfTest && !safeMode) throw new Error("Kimi source-snapshot mode is disabled; use KIMI_SAFE_MODE=1");
if (!selfTest && process.env.KIMI_EXTERNAL_SEND_CONFIRMED !== "YES") {
  throw new Error("External Kimi send requires the explicit KIMI_EXTERNAL_SEND_CONFIRMED=YES human checkpoint");
}

if (!apiKey && !selfTest) {
  console.error("未设置 MOONSHOT_API_KEY 或 KIMI_API_KEY；Kimi 对抗审查未运行。");
  process.exit(2);
}

const files = safeMode ? [] : await collect(root);
const budget = 180_000;
let remaining = budget;
const excerpts = [];
for (const file of files) {
  const content = await readFile(file, "utf8");
  const relative = path.relative(root, file).replaceAll("\\", "/");
  const block = `\n\n--- FILE: ${relative} ---\n${content}`;
  if (block.length > remaining) continue;
  excerpts.push(block);
  remaining -= block.length;
}

if (safeMode) {
  excerpts.push(`

--- SAFE REVIEW PACKET (NO SOURCE CODE) ---
ROUND 3 DELTA (claims requiring local verification): MediaStore permission is re-checked while selecting each upload candidate and repeatedly inside the upload client: before reading, after sanitization, after exact-byte privacy analysis, before job creation/upload, and after upload before completion. Retryable WorkManager jobs are capped at three attempts and use exponential backoff. A JPEG marker parser now rejects APP1-APP15 and COM metadata segments while allowing APP0/JFIF, in addition to signature checks. Upload URLs are limited to API same-origin or one exactly configured HTTPS OSS host on port 443; userinfo, suffix tricks, alternate buckets/ports, and redirects are rejected. Bearer credentials are attached only to API same-origin uploads. Device bearer tokens are random 256-bit server-issued values; the installation UUID is only hashed for idempotent registration, re-registration rotates the bearer, and tests prove the old bearer becomes invalid. A raw-evidence Beta gate now requires 300-500 authorized samples, <1% sensitive leak, >=90% Top-1, 200 manual card audits, Android 14 permission modes, Huawei/Xiaomi/OPPO-or-vivo runs, cloud deletion evidence, and cohort metrics. Its synthetic self-test passes while the empty real-evidence template intentionally returns NO_GO. Backend typecheck plus 8 integration tests pass; Android domain/data tests, lint, and APK assembly pass. External evidence is still explicitly UNRUN.
ROUND 4 DELTA (claims requiring local verification): Android 14 partial access now re-opens the exact MediaStore URI at every critical boundary, so removing one photo from the selected set is detected even when the broad partial-access permission remains granted. TOO_PRIVATE and explicit never-analyze both queue the privacy action; the server then deletes the owned card, matching candidate job, and any remaining object, while the client deletes its card and private import copy. No embedding or vector store exists. OSS mode now refuses startup unless the bucket exposes an enabled one-day-or-less lifecycle rule covering the analysis prefix; immediate deletion in a finally block and periodic purge remain defense in depth. Android bearer tokens are AES-GCM encrypted with an Android Keystore key. WorkManager logs are WARN-only. Exact-daily UI wording was removed. Accessibility changes make each interest row one labeled checkbox target, make onboarding vertically scrollable, split feedback actions into two rows, and announce busy state. Backend typecheck plus 9 tests pass; Android domain 2 tests, data 6 tests, lint, APK assembly, and v2 signature verification pass. The catalog readiness gate currently reports 50/200 topics, 11 approved facts, and 0 topics with 3-5 approved facts, so content remains NO_GO. Real device, cloud, evaluation-set, content-review, and Beta evidence remains UNRUN.
ROUND 5 DELTA (claims requiring local verification; supersedes older test counts): TOO_PRIVATE now writes a server-side suppression tombstone before cascading deletion, and integration coverage proves the same candidate token returns 410 instead of being recreated. The Android installation secret and bearer are both Keystore AES-GCM encrypted; a 401 causes one mutex-coordinated re-registration with the same installation secret and exactly one retry. Public request schemas reject unknown fields and cross-device job/card/track access is tested. PostgreSQL migrations now have ordered checksummed execution, an advisory lock, transactional application, and idempotent CI invocations against PostgreSQL 17. After a direct OSS upload, completion retrieves the stored bytes and revalidates the declared size, JPEG content type, and magic before vision processing; corrupted stored bytes are rejected and deleted. Status-approved facts are no longer publishable without explicit human attestation; the local-only escape hatch is refused with OSS, and the audit CLI rejects AI/bot reviewer identities. Backend typecheck plus 16 tests pass. Android domain 2 tests and data 7 JVM tests pass; Debug Lint, Debug APK, the two-test instrumentation APK, R8 Release, and v2 signature verification pass. The two instrumentation tests are COMPILED BUT UNRUN because no device is connected. The knowledge gate reports 50/200 topics, 11 status-approved facts, 0 human-attested facts, and 0 ready topics, so content remains NO_GO. Real PostgreSQL/OSS/Qwen, authorized evaluation images, Android 14/OEM devices, formal signing, and Beta cohort evidence remain UNRUN.
POST-ROUND-5 LOCAL HARDENING: A separate Room suppression table now stores stable local photo identifiers and survives clearing the photo index, closing same-installation resurrection under a different candidate token; a third compiled device test covers persistence. JFIF APP0 is accepted only at the exact standard length, malformed/extended segment tests were added, URL tests now include Unicode, insecure-scheme and fragment variants, and OSS lifecycle policy is rechecked before every new upload target. Android now has 2 domain and 9 data JVM tests plus 3 compiled-but-unrun device tests.
ROUND 6 DELTA (supersedes older Android execution counts): The official Android 14/API 34 Google APIs x86_64 emulator now runs with hardware acceleration. The first connected-test attempt exposed that the library had no instrumentation runner and reported zero tests; the build was changed to declare AndroidJUnitRunner and the reusable gate now rejects fewer than three tests. The first real device execution then caught two defects: one JUnit test method had a non-void expression body, and Android Bitmap.compress emitted application metadata that the final JPEG guard correctly rejected. The test was fixed, and a structural JPEG sanitizer now parses the freshly encoded stream, removes all APP0-APP15 and COM segments before SOS, and then validates marker lengths, scan data, exact EOI, and absence of application metadata. Android now passes 2 domain tests, 10 data JVM tests, and 3/3 API 34 instrumentation tests with zero failures, errors, or skips. The instrumentation tests cover Keystore encryption and key invalidation, suppression persistence after clearing the photo index, and real Bitmap downscaling plus EXIF/GPS removal. A separately repeatable app smoke gate installs the real APK and proves onboarding, denied, full, and partial permission UI states with an empty crash buffer; the Android 14 system partial-photo picker was also exercised with one selected image. Debug Lint has zero errors, Debug and R8 Release build, and Debug APK v2 verification passes. This is reference-emulator evidence, not physical or OEM device evidence. The content gate remains NO_GO at 50/200 topics, 11 status-approved facts, zero human-attested facts, and zero ready topics. Real PostgreSQL/OSS/Qwen, an authorized 300-500 image set, physical Huawei/Xiaomi/OPPO-or-vivo devices, formal signing, and Beta cohort evidence remain unrun.
POST-ROUND-6 LOCAL HARDENING: The review identified a real explicit-consent gap in the exported Android share path. MainActivity no longer consumes ACTION_SEND or ACTION_SEND_MULTIPLE at all. The only exported ShareReceiverActivity accepts image MIME plus at most 20 distinct content:// URIs, displays an in-app disclosure naming the image count and that a filtered metadata-free compressed copy may upload, and copies/schedules only after the user taps “import and analyze”; cancel/back performs no import. The repeatable APK smoke gate now asserts this confirmation UI in addition to onboarding and denied/full/partial permission states, with an empty crash buffer. Picker/share URIs are copied to app-private storage before analysis, closing provider-content replacement after consent. A source search confirms the only production Bitmap.compress call is ImageSanitizer, immediately followed by structural stripping and validation, and the upload client consumes that returned byte array. The final full gate again passes 2 domain, 10 data JVM and 3 API 34 instrumentation tests, Lint with zero errors, Debug, R8 Release and Debug v2 signature verification. Anonymous reinstall can reset the per-install budget; persistent hardware fingerprinting was intentionally rejected as contrary to the privacy model, so controlled distribution, IP registration limiting and cloud-account cost quotas remain deployment controls. Physical OEM, real cloud, authorized data, content attestation and cohort gates remain NO_GO.
POST-ROUND-7 LOCAL HARDENING: The direct OSS upload now uses a coroutine-cancellable OkHttp callback, so pause/WorkManager cancellation cancels an in-flight request instead of waiting on a blocking execute call. A newly rebuilt R8 Release was signed with the local debug certificate only for test installation and passed the same API 34 onboarding, denied/full/partial permission, share-consent and empty-crash-buffer smoke gate; this is R8 runtime evidence but not formal signing or OEM evidence. Broad MediaStore revocation intentionally blocks automatic MediaStore candidates only; explicit Picker/share imports remain usable because they are separate per-item consent fallbacks. For MediaStore, ImageSanitizer creates one byte array, the final privacy model analyzes that exact byte array, and the upload sends that same array, so the source URI is never reopened between final privacy analysis and upload. The production stripper removes all APP/COM segments and exact-EOI validation rejects trailing data; the guard's ability to accept an exact empty-thumbnail JFIF is defense-in-depth, not production output. All final Android and backend gates remain green, while external Beta gates remain NO_GO.
ROUND 8 DELTA (claims requiring local verification): A repeatable accessibility smoke gate now changes the API 34 AVD to 320dp width and 1.5x font scale, verifies all three onboarding steps, scrollable interest choices, both photo entry actions, share confirmation, minimum target sizes, viewport containment and an empty crash buffer, then restores display settings. A separate widget smoke gate installs the real APK, executes the native requestPinAppWidget flow, verifies the Pixel Launcher preview name/description/2x2 size, accepts it, requires the appwidget binding count for DailyWidgetReceiver to increase, and confirms the empty-state widget text is rendered on the Launcher. The backend now has atomic per-device and global day/month budget decisions. PostgreSQL serializes them with pg_advisory_xact_lock; a separate aggregate budget-event table stores only event IDs and timestamps and intentionally survives device-data deletion, so deleting data and registering a new anonymous installation cannot reset the global fuse. Local regression tests cover the global daily fuse after deletion/reinstall and the global monthly fuse across devices. Backend typecheck and 19 tests pass; Android 2 domain, 10 data JVM, 3/3 API 34 instrumentation, Lint, Debug build, standard APK smoke, small-screen smoke and real Launcher widget smoke pass. The global event ledger protects aggregate spend without persistent hardware fingerprinting; per-person attribution across anonymous reinstall is intentionally not claimed. Physical OEM, TalkBack, real PostgreSQL/OSS/Qwen, authorized evaluation data, human content attestation, formal signing and cohort evidence remain NO_GO.
POST-ROUND-8 LOCAL HARDENING (supersedes private-import retention and JPEG test counts): Picker/share imports are explicit per-item consent, independent of broad MediaStore access; revoking broad MediaStore access does not retroactively revoke that in-app consent. Even so, full private copies no longer persist after a terminal decision. Privacy-filtered, low-quality and non-retryable failed imports are deleted immediately. A completed card replaces the private original in place with the exact 1280px metadata-free JPEG bytes that passed the final privacy model and were uploaded; non-card terminal results delete the copy. Raw imports that never reach a terminal state expire after 24 hours, sanitized card thumbnails after 30 days, and clearing the local index deletes all imports. The production JPEG stripper removes APP0-APP15 and COM before SOS; a separate final guard may parse an exact thumbnail-free JFIF only as defense in depth, but production never emits it. New tests cover APP0, APP13, COM, post-SOS COM, trailing payloads and a deterministic 512-input malformed corpus without bounds failures. An API 34 instrumentation test executes raw-copy replacement, explicit deletion and TTL purge. Android now passes 2 domain, 13 data JVM and 4/4 API 34 instrumentation tests, plus Lint, build, permission/share, 320dp/1.5x and real Launcher widget gates. TalkBack, physical OEM, real cloud, authorized datasets, content attestation, formal signing and cohorts remain NO_GO.
POST-ROUND-9 LOCAL HARDENING: Automatic MediaStore uploads now use a custom streaming request body that reopens and verifies access to the exact source URI before every 64 KiB written and once after the final chunk; revocation or removal from the Android 14 selected set aborts an in-flight PUT instead of waiting for a post-upload check. Existing boundary checks before sanitization, after sanitization, after exact-byte privacy analysis, before job creation, before upload and before completion remain. A unit test revokes access during a three-chunk body and proves only two chunks are written. Explicit Picker/share consent remains independent by design. To constrain a malicious or endless exported content provider, private import copy now fails closed at 25 MiB per item, 100 MiB per batch and zero bytes, deleting partial files on failure; unit tests cover success, oversize and empty streams. Android now passes 2 domain, 15 data JVM and 4/4 API 34 instrumentation tests; Lint/build and all APK UI/widget smoke gates pass on the rebuilt artifact. Release cleartext traffic is disabled; certificate pinning is not claimed because it creates certificate-rotation availability risk, so real HTTPS/cloud verification remains a Beta gate. External NO_GO items are unchanged.
ROUND 11 DELTA (claims requiring local verification): Debug and Release network configuration are now variant-separated. Debug alone defaults to the emulator HTTP address; unsigned engineering Release defaults to https://not-configured.invalid/, while the formal Release wrapper refuses to build without both a signing keystore and an explicit HTTPS API URL plus exact Alibaba OSS host. The current R8 artifact was test-signed only inside ignored tooling, v2 verified, installed on API 34, and passed the full app permission/share smoke plus native Pixel Launcher widget binding/render; the gate explicitly reports formalSigning=0. The 320dp accessibility smoke now passes at 2.0x font scale. A separate reference test binds the actual Google TalkBack service in the AVD and traverses two onboarding and two share-confirmation focus targets without crashes; it explicitly reports spokenOutput=0 and humanAudit=0, so human auditory review remains NO_GO. A real isolated PostgreSQL 17.10 instance applied all five migrations, reported no changes on the second migration run, and passed four repository integration tests. Four independent connection pools submitted 32 concurrent jobs to a global limit of five and exactly five were created; concurrent duplicate candidates produced one job/event, and the identifier-free global ledger survived device deletion and reinstall. The server was stopped after the gate. A controlled taxonomy backlog now contains exactly 200 topics (50 seeded plus 150 proposed), but proposals contain zero publishable facts. A draft validator rejects approved/review fields from human- or AI-assisted intake and rejects health/safety drafts without two authoritative sources. Production content remains NO_GO at zero human-attested ready topics. Base backend typecheck/19 tests, separate real-PostgreSQL 4 tests, Android 2 domain/15 JVM/4 API34 tests, Lint, Debug, R8, app, widget, 2.0x and TalkBack-reference gates pass. Real OSS/Qwen/HTTPS deployment, physical OEM and human TalkBack evidence, authorized evaluation images, human content attestation, formal signing, and cohorts remain external NO_GO.
POST-ROUND-11 LOCAL HARDENING: Product wording now limits photo suppression to the current installation and explicitly says uninstall/app-data clearing resets the local exclusion; no stable hardware fingerprint or cross-install promise is introduced. The exported share receiver strictly validates SEND/SEND_MULTIPLE, declared image MIME, 1-20 unique content URIs, and any non-null provider MIME before consent. The client computes SHA-256 over sanitized bytes and verifies it after the final privacy pass, before upload creation, and after upload, so mutation cannot separate the analyzed and uploaded payload. HTTP 410 is terminal; 409/429/503 remain bounded retry cases. A 429 retains the local candidate and exposes a persistent in-app status instead of silently looping. Unit tests cover share policy, payload mutation and retry/status policy. A source guard fails on runtime placeholders, unscoped exclusion promises, exact-update wording and Debug/Release configuration regressions. Production content remains 50 skeleton topics and zero human-attested ready topics despite the separate 200-topic backlog.
POST-ROUND-12 LOCAL HARDENING: The share consent copy now states plainly that the image pixels themselves may be uploaded as a compressed copy, while location/device metadata is removed and the server deletes the copy after processing. The future-card fill policy is now a tested invariant: fill while fewer than seven scheduled cards exist, stop at seven or after 24 uploads in one run. The widget's local-day switch counter is extracted and tested to permit counts zero and one, reject count two or greater, and reset on a new day. A first-principles audit found an unrelated UTC drift: China users between local midnight and 08:00 could receive the prior UTC date. Server scheduling now derives the Asia/Shanghai calendar date and tests the midnight boundary plus seven consecutive inclusive dates. Base backend tests are now 21; Android has 2 domain, 5 app, 19 data JVM and 4 API34 instrumentation tests. The final rebuilt R8/app/widget, 320dp/2.0x and TalkBack-reference gates pass. These tests prove policy and reference behavior, not seven days of elapsed physical-device operation, spoken-output quality, or OEM background reliability.
POST-ROUND-13 LOCAL HARDENING: The reported P0 upload contradiction was a safe-packet wording ambiguity, not the implementation. Each 64 KiB callback opens the original MediaStore file descriptor only to force Android to re-evaluate access; it never reads source pixels. The OkHttp request body writes only the sanitized byte array. A new test writes a multi-chunk payload, proves byte-for-byte equality and SHA-256 equality with the sanitized array, and counts the independent permission gates. Separate request-construction tests prove OSS receives the sanitized bytes without Authorization while API same-origin receives the anonymous bearer. The server now exposes test-only provider injection, and end-to-end tests make malicious writers return a forged fact ID and a forged source ID; both responses are 502, no card is stored, and the object is deleted. Source guardrails now also reject absolute protection/completed-analysis claims and cloud credential markers in Android product sources. Base backend tests are 23; Android has 2 domain, 5 app, 22 data JVM and 4 API34 instrumentation tests. The final R8 reference runtime gate passes after an ADB infrastructure retry and still reports formalSigning=0. Permission revocation does not cancel explicit Picker/share consent by design; each MediaStore candidate is rechecked inside every worker and before/during upload, while Pause Analysis cancels the global work chain. Remaining cloud, OEM, authorized-data, human-content, signing and cohort gates stay NO_GO.
POST-ROUND-14 LOCAL HARDENING: The server no longer trusts the client's sensitiveFlags field as the only privacy signal. The structured vision result must independently return a strict sensitiveFlags enum covering face, selfie, identity document, bank card, receipt, document, high text density and screenshot. Any server-detected flag changes the job to rejected, skips fact selection and the card writer, stores no card, and still deletes the image in finally. The Qwen request enables provider content inspection and explicitly requests the privacy flags; an unknown flag fails schema validation. Tests cover a malicious client submitting sensitiveFlags=[] while the server detects a face, prove the writer is not called and the object/card are absent, verify the Qwen inspection header/structured flag, and fail closed on an invented flag. This is a server-side second classification gate, but its real false-negative rate remains blocked on the authorized 300-500 image set and real fixed-version Qwen deployment. Share consent now also states that exceptional retention is at most 24 hours. Base backend tests are 26 plus four separate PostgreSQL tests; final R8 and 320dp/2.0x gates pass. Local PostgreSQL 17.10 is proven; hosted PostgreSQL failover/operations, OSS and Qwen remain external.
POST-ROUND-15 LOCAL HARDENING: The final review had no new locally reproducible P0. One actionable P1 was closed: API same-origin uploads now permit only the exact base-prefix plus /v1/analysis-jobs/{UUID}/image path, with no query or fragment. Tests reject a same-origin admin path, non-UUID path, query and path traversal. Pause Analysis was rechecked and already cancels INITIAL, IMPORTED, DAILY and daily-pipeline unique work, so the claim that explicit-import work survives pause was rejected. Android now has 2 domain, 5 app and 23 data JVM tests plus 4 API34 instrumentation tests. The frozen R8 runtime gate passes with formalSigning=0. The engineering Alpha is frozen; remaining P0 items require human-reviewed content, authorized data, real OSS/Qwen/HTTPS, formal signing, OEM devices and cohorts rather than additional safe-packet rounds.
POST-ROUND-15 CONTINUATION / ROUND 16 DELTA: A first-principles audit found that round 15's pause statement covered current unique-work cancellation but not process restart: MainViewModel recreated the daily schedule after restart. Pause is now persisted in SharedPreferences, all schedule entry points refuse work while paused, and Scan/Privacy/Upload/CardSync/DailyKick each fail closed before work. Deleting cloud data also persists pause; resume is explicit. An API34 test proves the pause bit survives scheduler recreation and is read by the worker guard. Picker/share consent remains independent of broad MediaStore permission, and the share dialog now states both that distinction and how to stop all pending tasks. Imported bytes now receive SHA-256 source digests and random candidate tokens; Room v3 has a unique nullable digest index with a tested v2-to-v3 migration. An API34 MediaStore test imports identical bytes through two distinct content URIs and proves one private candidate/copy. Perceptual near-duplicates are compared against prior READY/DEFERRED/QUEUED/COMPLETED/NEVER_ANALYZE hashes and the current batch; lower-priority duplicates become FILTERED and cannot resurrect from DEFERRED. Android and backend scheduling now both use Asia/Shanghai dates. Product-source guardrails reject Android/console runtime logging calls in addition to credential markers and overclaims. Current local gates: backend typecheck and 26 base tests; prior isolated PostgreSQL 17.10 four-test proof remains unchanged; Android 5 domain, 5 app and 23 data JVM tests plus 7/7 API34 instrumentation tests; Lint, Debug, R8 test-signed runtime, permission/share/widget, 320dp/2.0x and TalkBack-reference focus gates pass. Formal signing=0, TalkBack spokenOutput=0/humanAudit=0, and all external content/data/cloud/OEM/cohort blockers remain NO_GO.
POST-ROUND-16 LOCAL FOLLOW-UP (not an additional Kimi round): Added transactional cost reservation and clarified per-item Picker/share consent. Its earlier direct-upload notes are superseded by the latest local-only hardening below.
LATEST LOCAL-ONLY HARDENING (supersedes older direct-upload claims; not an additional Kimi round): The backend no longer returns OSS presigned URLs. It issues a random 10-minute API same-origin upload-session URL, atomically consumes it once, writes the bounded JPEG to private OSS with Function Compute STS credentials, and rejects replay after success or device deletion/re-registration. Processing uses expiring database leases; stale workers cannot finalize. Card bodies are the exact reviewed fact text. Feedback preferences are idempotent and persisted. OSS Enabled/Suspended versioning is rejected. Production requires a security token rather than AK-only credentials.
LATEST RELEASE-GATE HARDENING (not an additional Kimi round): Human-rejected facts can only be replaced through a catalog/fact-digest-pinned manifest; the replacement stays draft and cannot inherit review authority. Generated-card audits bind a de-identified PostgreSQL card snapshot to a separate human audit by exact card digest and retain negative outcomes. The final Beta gate invokes current knowledge readiness and requires a formal non-debug v2-signed APK bound to a pinned public certificate fingerprint plus a physical-device zh-CN human TalkBack listening record; test signing and automated focus traversal are explicitly insufficient.
LATEST EVIDENCE-PROVENANCE HARDENING (not an additional Kimi round): Beta conversion/engagement metrics can no longer be hand-entered. The complete privacy-minimized device-report set is canonically hashed, exactly covered by a human-owned cohort manifest, required to have seven full observation days, and compiled into final metrics. The release gate rejects evidence assembled across different app versions and requires image/card/cloud evidence to share one model and catalog version. Synthetic tests explicitly grant no release evidence.
LATEST DUAL-ATTESTOR CLOSURE (not an additional Kimi round): Final evidence is schema v3 and binds the approved eight-artifact assembly-manifest SHA-256 plus deployment receipt/policy digests. The readiness checker reloads the repository-pinned policy, approved manifest and all eight fixed-path exact artifacts, re-verifies the deployment-attestor Ed25519 receipt, deterministically reassembles at the recorded generation time, and requires an exact match with the release-approver-signed evidence. A negative test gives the candidate a valid release-approver marker but no trusted assembly and requires NO_GO. The assembler also rejects a receipt/cloud pair made internally self-consistent without re-signing. These are local gates, not real deployment or release evidence.
LATEST THREE-PARTY TRUST CLOSURE (supersedes the prior dual-attestor paragraph; not an additional Kimi round): Repository content is no longer its own release trust root. The final checker requires the exact public-policy bytes to match protected external JIANWEI_EVIDENCE_TRUST_POLICY_SHA256 and rejects command-line policy replacement. Policy validation forces beta_deployment_attestor, beta_assembly_attestor and beta_release_approver to use mutually exclusive roles plus distinct issuer IDs, key IDs and Ed25519 SPKI fingerprints. The independent QA assembly signature binds the exact approved manifest and all eight artifact SHA-256/byte-length pairs; deployment signs the platform-observed release; release approval signs the deterministic schema-v3 output. Final verification checks all three signatures, reassembles the fixed artifacts, and enforces three-way identity/key separation. Negative tests reject role collapse, public-key reuse, an incorrect external policy digest, a missing assembly signature, artifact/manifest mutation and a single signer. Current local counts are Beta gate 26 bypasses, release signer 6, assembly signer 5, assembler 19. These remain synthetic local controls, not real external evidence.
POST-ROUND-17 LOCAL HARDENING (supersedes older local counts; claims require local verification): The backend rate limiter keys on stable authenticated device identity across bearer rotation; PostgreSQL object-deletion retries use nextAttemptAt, bounded exponential backoff and fair ordering; outbound Qwen requests reject redirects. The release assembly binds exact knowledge catalog bytes, topic-backlog bytes and a domain-separated protected human-reviewer allowlist digest. CLI main-entry checks canonicalize junction paths, the assembler canonicalizes its working root, and deployment receipts are checked against the actual verification time so stale signed receipts cannot be replayed. Knowledge-source preflight and batch live checks no longer use automatic redirects: every HTTPS hop is credential-free port 443, DNS must resolve exclusively to public addresses, the selected address is pinned into the TLS connection while the original hostname remains the certificate/SNI authority, and every redirect is re-resolved and revalidated; private DNS, private redirects, IPv4/IPv6 literals and excess redirects fail closed. Current local evidence is backend typecheck/build plus 70 base tests, PostgreSQL 17.10 with 12 migrations and 10 integration tests plus TCP E2E, Android API 34 with 20/20 instrumentation tests plus app/widget/320dp-2x/TalkBack-reference/R8 runtime gates, API-contract/runtime/supply/source gates, Beta gate 27 rejected bypasses and assembler 21 rejected bypasses. TalkBack reference still proves focus only (spokenOutput=0, humanAudit=0); R8 uses a local test key (formalSigning=0). The catalog still has 200 topics and 624 facts, with 613 draft, 11 status-approved, zero human-attested and zero ready topics. Real hosted OSS/Qwen/PostgreSQL/HTTPS, immutable deployed images and signed deployment receipt, authorized 300-500 images, formal APK signing, OEM seven-day runs, human zh-CN TalkBack listening, 200-card audit and 10-50-person cohort remain external NO-GO evidence.
POST-ROUND-18 LOCAL HARDENING (supersedes older JPEG and Android evidence claims; claims require local verification): The final post-sanitization JPEG guard now rejects every APP0-APP15 and COM segment without a JFIF exception. Explicit Picker/share imports retain their independent per-item consent, but their app-private raw copies now have a pause-independent cleanup path scheduled immediately on every app start and periodically every 12 hours; Android force-stop can defer all scheduled work until the OS or user next permits execution, while uninstall removes app-private storage. Current Android evidence is a cold Debug/Release/R8/Lint build, 16 JVM suites with 60/60 tests, API 34 wipe-data instrumentation 20/20, and app permission/share/reminder, native widget, 320dp/2.0x, TalkBack-focus and test-signed R8 runtime gates. The current test-signed Release SHA-256 is 1CE886F51409D69BE44BFD4BC6FF304EE454A6FBDE0AF12E85EE952E3EF505E3; formalSigning=0, spokenOutput=0 and humanAudit=0 remain explicit. Round 18 concerns about unreviewed-fact publication, cross-topic fact binding, TOO_PRIVATE widget retention and the final upload permission race were checked against local invariants and rejected: production selection requires attested approved facts from a protected reviewer allowlist, catalog validation requires fact.topicId equal topic.topicId, model IDs must exactly equal the server-selected fact/source IDs, TOO_PRIVATE removes the Room card and local copy transactionally, and URI/session checks run during every 64 KiB chunk, after the last chunk, after the HTTP upload and immediately before completion. These are local claims for renewed adversarial review, not external Beta evidence. All real content, cloud, signing, OEM, human-listening, authorized-image, card-audit and cohort blockers remain NO_GO.
  产品：面向中国大陆 Android 的照片冷知识桌面组件。
数据流声明：相册扫描 -> 端侧隐私过滤 -> 1280px JPEG 重编码 -> 临时上传 -> 视觉对象识别 -> 已审核事实检索 -> 卡片缓存 -> Glance 组件。
权限声明：支持完整、Android 14 部分照片、拒绝后 Photo Picker；分享图片复制到应用私有目录。Scan/Privacy/Upload 三层在处理 MEDIA_STORE 候选前都重新读取当前权限；用户逐张选择/分享的私有副本按独立的逐项同意处理。
端侧声明：过滤人脸、截图、高文字密度、证件号、银行卡、票据、文档、模糊和近重复图。上传任务对最终 1280px JPEG 字节重新执行同一隐私检测，再将同一字节上传；JPEG 元数据守卫拒绝 EXIF/XMP/ICC/IPTC/GPS 标记。
服务端声明：匿名设备 Bearer、按 Bearer 哈希分钟限流、每设备及全局日/月硬上限、候选幂等、图片魔数与 content-type 一致性检查、严格 JSON、模型只能返回选定 fact/source ID、处理后删除图片、周期清理过期对象。全局成本账本只含随机事件 ID、时间戳和部署方配置的单任务最坏成本预留额，不含设备、照片或候选标识且不随设备隐私删除级联；它按事件数和预留人民币微单位同时熔断，但不声称跨重装识别同一个人。
内容声明：生产目录 2026-07-19-beta.62 已覆盖全部 200 个受控主题和 624 条事实；613 条为 draft，11 条仅有状态 approved，0 条有真人签注。176 个主题各有 3 条事实、24 个主题各有 4 条，0 个空提案、0 个不完整主题，但仍有 0 个主题达到真人审核就绪。531/531 个编辑来源与 13/13 个状态批准候选来源联网可达，但可达不等于语义审核。全量证据仅在目录版本、来源范围相同且 24 小时内复用成功结果，并记录复用与重查数量；Beta.62 因目录版本变化从零重新检查全部 531 个来源并一次通过，证据记录 0 个复用与 531 个重查；发布候选也从零通过 13/13，请求协议没有放宽。本轮 5 个安全主题的 15 条事实全部保持 draft，每条绑定至少两个 official 来源；最终 11 个精确 URL 均在导入前通过生产请求协议预检，403/404 候选未入库。只读人工审核队列按风险排列 200 个主题的全部 624 条事实，附来源可达证据但明确不授予批准权限；Beta.62 待审模板默认全部 pending，应用器固定目录/事实 SHA-256、拒绝过期快照与 AI 审核身份、批准时要求显式核对全部来源并整批原子落库，旧单事实直写入口已关闭。候选来源先以生产请求协议预检；失败页面不入库，预检工具具备失败关闭自测并受 CI/源码护栏约束。新主题批量导入固定基线/目标版本；已有一条事实的主题可用两条事实最小扩展，但合并后仍必须达到 3-5 条。两种路径均整批预校验后只做一次原子写入，且不能写 approved/review；草稿纠错同样固定目录版本与 SHA-256，只能替换事实 ID 不变且尚未审核的主题，并清理孤儿来源后原子提交。健康或安全事实要求两条权威来源；未审核事实不发布。
客户端声明：WorkManager 唯一链、Room 会在未来卡少于 7 张时分批提升 deferred 候选并补卡、单轮最多上传 24 个、2x2/4x2 组件、每天最多换两次、系统 Pin Widget 引导、反馈、用户主动确认物品追踪。提醒会持久显示并可更新或确认取消；Room 以版本化 UPSERT/NONE/DELETE 状态防止旧网络回执覆盖较新选择，服务端取消接口按设备隔离且幂等，锁屏公开通知不显示物件名。“太私人/本次安装不再分析”会删除本地卡片和私有图片副本；卸载或清除应用数据会重置本地排除。
  上传边界声明：客户端只接受 API 同源、无 query/fragment 的 '/v1/analysis-jobs/{UUID}/image' 会话地址；请求构造器再次校验后才附带匿名 Bearer。任何 OSS 或第三方直传地址都被拒绝。
  最新验证计数与可信链（以下数据取代下一行中的旧计数）：后端 68 项基础测试，PostgreSQL 17.10 三次运行 11 个迁移并通过 10 项事务/并发测试；Android domain/app/data JVM 为 7/12/41，API 34 instrumentation 为 20/20。后端 Release SHA-256 覆盖精确 Dockerfile；正式门禁固定仓库信任策略并拒绝覆盖，受控云验证还必须验证独立 beta_deployment_attestor 对 endpoint/Function Compute revision/后端身份/ACR OCI sha256 的签名回执，服务环境变量不能自证。最终证据需要仓库外 Ed25519 私钥签名；旧令牌删号、TOO_PRIVATE 原子删除、永久删除确认、ML Kit 资源释放与瞬时失败重试均有本地执行证据。以上仍不代替真实云、正式签名、OEM、真人或 cohort 证据。
  自动验证声明：后端类型检查、构建与 66 项基础测试通过，另有真实 PostgreSQL 17.10 三次运行 10 个迁移并通过 9 项事务/并发集成测试；后端容器构建会生成不可由环境变量覆盖的 Release SHA-256，运行时健康端点、新卡、真实云验证、卡片抽检和最终 Beta 装配必须使用同一摘要；Android 领域 7 项、应用层 12 项、数据层 40 项 JVM 测试与 Android 14 模拟器 18 项 instrumentation 测试通过。真实 MediaStore 用例发布 503 条测试媒体，证明 500 硬上限、空增量、新增、内容编辑和部分授权重新对账；APK 烟测覆盖拒绝、完整、部分权限、原生部分照片选择流程和提醒可见/更新/取消生命周期且无崩溃；320dp/2.0 倍字体烟测通过；真实 TalkBack 服务绑定及焦点烟测通过但未验证语音；Pixel Launcher 原生 Pin Widget 预览、真实绑定和桌面渲染通过；测试签名 R8 运行通过但不等于正式签名；Lint 0 error；源码护栏无占位实现、越界承诺、运行时日志调用或 Android 云密钥标记。授权图片评测保持普通设备额度不变，使用最多 7 天且绑定 300–500 个授权样本和首台设备的 PostgreSQL 租约，并继续受全局成本熔断；授权图片评测要求独立人类标签与真实管线结果按图片 SHA-256 匹配、全部样本完成执行、八类敏感内容覆盖和至少 25 个识别主题；生成卡片抽检要求去身份快照与独立真人审核按卡片摘要合并；最终门禁直接执行知识就绪、正式签名和真人 TalkBack 证据检查。评测编译器与 Beta 门禁连续三轮自测通过且不产生发布证据。
明确未完成：200 个完成真人签注的审核主题、300-500 张隐私评测集、Android 14 国产品牌实体真机回归、真人 TalkBack 听读、真实 OSS/Qwen/HTTPS 部署、正式签名、10-50 人 Beta 指标与人工卡片抽检。
审查限制：你看不到源码。不得把以上“声明”当作已证明；请把最可能的绕过路径、需要本地核验的具体不变量和最小测试写成 P0/P1。`);
  // The block above is retained only as an in-repository history of prior review deltas.
  // Never send its stale counters to a new reviewer: each external round receives one
  // current, internally consistent packet so evidence drift cannot masquerade as a defect.
  excerpts.length = 0;
  const currentSafePacket = `

--- CURRENT SAFE REVIEW PACKET (NO SOURCE CODE, NO HISTORICAL COUNTERS) ---
产品与范围：见微是面向中国大陆 Android 的照片冷知识桌面组件。匿名安装、无广告 SDK、原图不建立云端照片库；通知默认关闭。Photo Picker/分享是逐张显式同意，独立于系统广泛相册权限；界面明确说明撤销广泛权限只停止自动发现，已逐张同意的导入仍会处理，“暂停分析”会停止全部待处理分析任务。分享确认前不调用 ContentResolver.getType 探测第三方 URI，避免失效 grant 让 Android 框架把完整 URI 写入日志；ACTION/MIME/数量/URI scheme 只做入口筛选，真正安全边界仍是确认后的有界复制、图像解码、重编码与最终隐私检查。

当前 Android 数据流声明：MediaStore 近 90 天最多 500 张增量扫描 -> 端侧人脸/OCR/截图/文档/证件/银行卡/票据/高文字密度/模糊/重复过滤 -> 长边 1280px 重新编码 -> 删除全部 APP0-APP15/COM 并用最终守卫再次拒绝任一 APP/COM、尾随字节和畸形 JPEG -> 对最终同一字节再做隐私检测和 SHA-256 一致性检查 -> API 同源一次性上传会话 -> 服务端二次敏感分类 -> 视觉主题 -> 真人审核事实检索 -> Room/Glance。客户端只接受无 userinfo/query/fragment 的 API 同源 /v1/analysis-jobs/{UUID}/image，不接受 OSS/第三方直传；共享 OkHttpClient 同时关闭普通重定向和 HTTPS 重定向，属性单测与源码守卫固定该行为。MEDIA_STORE 候选在净化前后、建任务前、每 64 KiB 写入前、最后一块后、HTTP 返回后和 complete 前都重验会话与精确 URI；检查失败抛终止异常，服务端未收到 complete 就不运行模型，临时对象仍受删除/TTL 门禁。网络已经发送的字节不能因之后撤权而物理撤回，所以真实网络竞态仍需外部设备验证。

导入与暂停声明：Picker/share 原始副本单图 25 MiB、单批 100 MiB；敏感、低质和不可重试终态立即删除，成功卡片只留下净化缩略图。未终态原始副本 24 小时、缩略图 30 天。暂停位跨重启，Scan/Privacy/Upload/CardSync/Daily workers 和所有调度入口失败关闭。独立 ImportedCopyCleanupWorker 在每次应用启动立即排队并每 12 小时运行，不读取暂停位。Android force-stop 会延迟所有任务到系统或用户再次允许运行；卸载删除应用私有目录。

服务端当前声明：随机 256-bit Bearer；稳定已认证 device ID 限流；每设备和全局日/月数量与人民币微单位最坏成本原子熔断；同一 device+candidate 幂等；同一候选重试只创建一条任务/成本事件。一次性 10 分钟 API 上传会话原子消费，处理租约过期可恢复且旧 worker 不能终态写入。生产强制 PostgreSQL、OSS、Qwen、HTTPS、完整临时 STS、<=24h 生命周期、禁用 OSS versioning、固定目录摘要和容器摘要。Qwen 禁止重定向；知识来源请求每跳无凭据 HTTPS/443、最多五次手动重定向、DNS 全地址必须为公网，selected address is pinned into the TLS connection，原 hostname 用于 Host/TLS SNI 与证书校验。

模型与内容声明：服务端忽略客户端空敏感标记并做二次敏感识别。视觉输出严格枚举；目录要求 fact.topicId 等于 topic.topicId；服务端先选择该主题的真人签注 approved fact，再要求卡片模型原样返回所选 fact/source ID，卡片 body 使用已审事实原文。生产拒绝未签注事实，审核 reviewerId 必须存在于受保护白名单；健康/安全事实还必须有两条 official 来源。当前目录 2026-07-19-beta.62 有 200 个受控主题、624 条事实、613 draft、11 仅状态 approved、0 human-attested、0 ready topic，因此当前不能发布任何知识卡。静态目录有 531 个唯一 HTTPS 来源；本机解析器把目录域名映射到保留测试网段，安全请求器按设计拒绝，所以本轮没有把旧联网结果冒充当前 live evidence。

反馈与保留声明：TOO_PRIVATE 在 PostgreSQL 单事务中写幂等回执、偏好扣减、候选抑制与对象删除队列，然后删除卡片/任务；Android 只有服务端确认后才移除反馈 outbox，并立即删除 Room 卡、追踪状态和私有副本。Widget 只读 Room。删除云端数据需要二次确认并保留失败恢复凭据；服务端先删除或持久排队删除对象，再删除设备，PostgreSQL 级联清除任务及其上传会话、卡片、反馈、追踪、偏好、候选抑制和隐私删除回执；只保留无设备标识的全局成本账本，防止重装绕过熔断。成功后 Android 暂停分析并清除本地卡片/身份。“暂停分析”是持久化的本地停止开关，不等同于删除云端数据。

调度与产品声明：唯一 WorkManager 链；未来卡少于 7 时补卡，单轮最多 24 个候选；2x2/4x2 Glance；Asia/Shanghai 日期；每日最多两次手动换卡。物品提醒必须由用户确认启用日和周期后才请求通知权限，授权后先建立本地唯一任务再同步 outbox，锁屏公开版本不显示物件名。组件实时性、七天 OEM 后台可靠性和提醒精确时刻均不承诺。

发布与日志声明：正式证据必须把正式非 Debug v2 APK、证书指纹、APK SHA-256、后端 Release SHA-256、精确 Dockerfile、不可变 OCI sha256、部署 revision/endpoint、目录/模型版本和八个 Beta 工件绑定到三个角色/issuer/key/SPKI 都互斥的 Ed25519 签名；仓库内策略还必须匹配受保护外部策略摘要。生产 server service overrides 在 environment 非 test 时失败关闭，不存在远程 provider-injection 路由。生产日志 serializer 只保留 HTTP method、代码中的 route template、statusCode、受限 error type/code、固定 message 与空 stack；不保留实例 URL、远端 IP、headers 或异常正文。Release 运行时 logcat 隐私门禁检查 Bearer/Authorization/device token/installation secret/评测租约/FC 凭据/云密钥/MediaStore URI/实例化分析 URL/私有导入路径。

当前唯一计数（所有历史计数作废）：后端 TypeScript check/build 与 73/73 基础测试通过；真实本地 PostgreSQL 17.10 三次运行 12 个迁移、10/10 集成测试和编译服务 TCP E2E 通过，其中 16 个并发重复候选只产生 1 个 job 与 1 个 cost event，HTTP 重试同一 candidate 也只占一次最坏成本，设备删除级联逐表与上传会话清除均被真实数据库测试覆盖。Android Debug/Release/R8/Lint 构建通过；17 个 JVM suite 共 61/61；API 34 wipe-data instrumentation 20/20；权限/分享/提醒、原生 widget、320dp+2.0x、真实 TalkBack 服务焦点和测试签名 R8 runtime 通过；Release logcat 隐私门禁在一次真实捕获并修复 MediaStore URI 泄漏后重跑通过。测试签名 Release SHA-256 为 39A6B991AC1757444F46226B2362949356D94AC6AA88997F3AAEFB65AFD7343F，releaseLogPrivacy=1，formalSigning=0，spokenOutput=0，humanAudit=0。API contract gate 为 13 个后端操作、8 个 Retrofit、1 个原始上传、9 个 DTO；Beta gate 27 rejected bypasses，assembler 21 rejected bypasses。以上只是本地声明，需要审查假设，不是外部发布证据。

明确仍为 NO_GO 的外部证据：624 条事实真人语义审核并达到 200 个 ready topics；300-500 张授权图片真实管线与八类敏感漏传率/Top-1；真实 OSS/Qwen/PostgreSQL/HTTPS 部署、生命周期和独立签名回执；不可变容器与固定基础镜像；正式 APK 密钥签名；华为/小米/OPPO或vivo 各实体机七天矩阵；真人 zh-CN TalkBack 听读；200 张卡片人工抽检；10-50 人七天 cohort；外部信任策略摘要、三把私钥和最终八工件签名装配。任何一项缺失都不得 Beta GO。

审查限制：你看不到源码、路径、照片、环境变量或密钥。不得把声明当作证明；请提出新的、可本地复现的不变量缺口，避免把上述明确外部 NO_GO 重复包装成新的代码缺陷。`;
  excerpts.push(currentSafePacket);
  remaining = budget - currentSafePacket.length;
}

const prompt = `你是“见微”Android 照片冷知识产品的敌对审查员。不要鼓励，不要泛泛总结；目标是尽最大可能阻止一个会泄露照片、误导用户、后台失效或无法构建的 Beta 上线。

这是第 ${round} 轮持续审查。` + `

逐项检查：
1. Android 14+ 完整、部分、拒绝权限是否真的区分；权限撤销后是否还可能扫描或上传。
2. 人脸、截图、证件、文档、高文字密度、模糊图是否都在上传前拦截；异常与竞态是否能绕过。
3. 压缩副本是否真正去 EXIF；服务端是否最多 24 小时且处理后删除；删除接口是否级联。
4. 事实与来源 ID 是否不可由模型编造；健康/安全事实是否双权威来源并审核；牙刷措辞是否准确。
5. WorkManager 唯一任务、重试、杀进程、权限撤销、重复上传、成本上限、七天离线缓存和组件换卡两次是否成立。
6. API 鉴权、越权、SSRF、上传地址、内容类型、速率限制、SQL/JSON、日志和密钥处理。
7. Kotlin/Gradle/TypeScript 是否有明显编译错误、版本冲突、错误 API 用法或不可运行占位实现。
8. 前端是否产生“已经分析/已经保护/精确每日更新”等超出实现的承诺；无障碍与小屏适配是否存在阻断问题。

输出 Markdown，严格按以下结构：
# Kimi 对抗审查
## 阻断上线（P0）
## Beta 前必须修（P1）
## 可以排期（P2）
## 已验证的安全边界
每条问题必须给出：证据文件、具体风险、可复现路径、最小修复方案。找不到证据时写“证据不足”，不要臆测已实现。最后给出 GO / NO-GO 结论。

以下是本次审查材料：${excerpts.join("")}`;
const estimatedInputTokens = Math.ceil(prompt.length / 4);
if (estimatedInputTokens + maxOutputTokens > totalTokenBudget) {
  throw new Error("Kimi review would exceed the in-code total token budget before the API call");
}

if (selfTest) {
  const requiredMarkers = [
    "2026-07-19-beta.62",
    "200 个受控主题",
    "300-500 张授权图片",
    "/v1/analysis-jobs/{UUID}/image",
    "CURRENT SAFE REVIEW PACKET",
    "selected address is pinned into the TLS connection",
    "Beta gate 27 rejected bypasses",
    "全部 APP0-APP15/COM",
    "独立 ImportedCopyCleanupWorker",
    "73/73 基础测试",
    "17 个 JVM suite 共 61/61",
    "同时关闭普通重定向和 HTTPS 重定向",
    "设备删除级联逐表与上传会话清除",
    "39A6B991AC1757444F46226B2362949356D94AC6AA88997F3AAEFB65AFD7343F",
    "所有历史计数作废"
  ];
  if (!safeMode || files.length !== 0) throw new Error("Kimi review self-test did not force source-free safe mode");
  for (const marker of requiredMarkers) {
    if (!prompt.includes(marker)) throw new Error(`Kimi review safe packet is missing marker: ${marker}`);
  }
  if (prompt.includes(root) || /sk-kimi-[A-Za-z0-9]{12,}/.test(prompt)) {
    throw new Error("Kimi review safe packet contains a local path or credential");
  }
  if (prompt.includes("66 项基础测试") || prompt.includes("18 项 instrumentation") || prompt.includes("16 个 JVM suite 共 60/60")) {
    throw new Error("Kimi review safe packet contains superseded test counters");
  }
  if (maxReviewRound !== 20 || maxOutputTokens !== 32768 || totalTokenBudget !== 50000 || requestTimeoutMs !== 300000) {
    throw new Error("Kimi review self-test did not retain the bounded loop budget defaults");
  }
  let truncatedResponseRejected = false;
  try { completeReviewContent({ finish_reason: "length", message: { content: "partial" } }); } catch { truncatedResponseRejected = true; }
  if (!truncatedResponseRejected || completeReviewContent({ finish_reason: "stop", message: { content: "complete" } }) !== "complete") {
    throw new Error("Kimi review self-test did not reject a truncated model response");
  }
  process.stdout.write("KIMI_REVIEW_SELF_TEST=GO safeMode=1 sourceFiles=0 credentials=0 currentCatalog=1 uploadBoundary=1 maxRounds=20 outputTokenCap=32768 totalTokenBudget=50000 requestTimeoutMs=300000 truncatedResponseRejected=1 humanCheckpoint=1\n");
  process.exit(0);
}

const response = await fetch(endpoint, {
  method: "POST",
  signal: AbortSignal.timeout(requestTimeoutMs),
  headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    model,
    temperature: kimiCode ? 1 : 0.1,
    max_tokens: maxOutputTokens,
    messages: [
      { role: "system", content: "你是严格、证据驱动的软件与隐私审查员。" },
      { role: "user", content: prompt }
    ]
  })
});

if (!response.ok) {
  const message = await response.text();
  throw new Error(`Kimi API ${response.status}: ${message.slice(0, 500)}`);
}
const payload = await response.json();
const choice = payload.choices?.[0];
const content = completeReviewContent(choice);
await mkdir(path.dirname(reportPath), { recursive: true });
const rendered = `${content.trim()}\n\n---\n轮次：${round}\n模型：${model}\n平台：${kimiCode ? "KIMI_CODE" : "KIMI_PLATFORM"}\n模式：${safeMode ? "SAFE_PACKET" : "SOURCE_SNAPSHOT"}\n审查文件数：${files.length}\n审查字符数：${budget - remaining}\n估算输入 token：${estimatedInputTokens}\n输出 token 上限：${maxOutputTokens}\n总 token 硬上限：${totalTokenBudget}\n请求超时毫秒：${requestTimeoutMs}\n`;
await writeFile(roundReportPath, rendered, "utf8");
await writeFile(reportPath, rendered, "utf8");
console.log(roundReportPath);

function completeReviewContent(choice) {
  const content = choice?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("Kimi 未返回审查正文");
  if (choice.finish_reason !== "stop") {
    throw new Error(`Kimi 审查正文未完整结束（finish_reason=${String(choice.finish_reason ?? "missing")}）`);
  }
  return content;
}

async function collect(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (["node_modules", ".gradle", "build", "dist", ".git", "reports"].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await collect(absolute));
    else if (/\.(kt|kts|ts|mjs|json|sql|md|xml|toml|properties|yaml)$/.test(entry.name)) output.push(absolute);
  }
  return output.sort();
}
