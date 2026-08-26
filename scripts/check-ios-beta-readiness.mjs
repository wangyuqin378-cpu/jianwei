import { spawnSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule } from "./lib/main-module.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_XCRESULT = ".tooling/ios-beta/widget-tinted-final-full.xcresult";
const DEFAULT_RELEASE_APP = ".tooling/ios-beta/widget-tinted-final-release/Build/Products/Release-iphoneos/Jianwei.app";
const EXPECTED_APP_ID = "cn.jianwei.ios";
const EXPECTED_WIDGET_ID = "cn.jianwei.ios.widget";
const EXPECTED_APP_GROUP = "group.cn.jianwei.shared";

function validTeamId(value) {
  return /^[A-Z0-9]{10}$/.test(value ?? "");
}

function validPublicHttpsOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash &&
      (url.pathname === "" || url.pathname === "/") &&
      !["localhost", "127.0.0.1", "::1"].includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function assessIosBetaReadiness(input) {
  const blockers = [];
  const require = (condition, message) => {
    if (!condition) blockers.push(message);
  };

  require(input.tools.xcode, "Xcode command-line tools are unavailable");
  require(input.project.bundleIdsValid, "App or Widget bundle identifier does not match the release contract");
  require(input.project.appGroupsValid, "App and Widget must share group.cn.jianwei.shared");
  require(input.configuration.teamConfigured, "a 10-character Apple Development Team ID is required");
  require(input.configuration.apiOriginConfigured, "JIANWEI_API_BASE_URL must be a public HTTPS origin");
  require(input.signing.validIdentityCount > 0, "no valid Apple code-signing identity is installed");
  require(input.device.inspectionSucceeded, "connected Apple devices could not be inspected");
  require(input.device.physicalDeviceCount > 0, "at least one connected physical iPhone or iPad is required");
  require(input.tests.resultAvailable, "the final iOS test result bundle is missing or unreadable");
  require(
    input.tests.passed >= 9 && input.tests.failed === 0 && input.tests.skipped === 0,
    "the final iOS suite must pass at least 9 tests with no failures or skips"
  );
  require(input.tests.currentForSources, "the final iOS test result is older than current iOS source files");
  require(input.release.unsignedAppPresent, "the final generic iOS Release app is missing");
  require(input.release.currentForSources, "the final generic iOS Release app is older than current iOS source files");
  require(input.release.privacyManifestValid, "the final generic iOS Release app has a missing or invalid privacy manifest");
  require(input.release.exportComplianceDeclared, "the final generic iOS Release app does not declare exempt encryption use");
  require(input.archive.present, "a signed Jianwei.xcarchive is required");
  if (input.archive.present) {
    require(input.archive.appSigned, "the archived App is not code signed");
    require(input.archive.widgetSigned, "the archived Widget extension is not code signed");
    require(
      input.archive.appStoreDistributionProfiles,
      "the archived App and Widget must use App Store distribution provisioning profiles"
    );
    require(input.archive.privacyManifestValid, "the archived App has a missing or invalid privacy manifest");
    require(input.archive.exportComplianceDeclared, "the archived App does not declare exempt encryption use");
    require(input.archive.apiOriginConfigured, "the archived App does not contain the production HTTPS API origin");
  }

  return {
    schemaVersion: 1,
    evidenceKind: "ios_installable_beta_readiness",
    status: blockers.length === 0 ? "GO" : "NO_GO",
    releaseEvidence: blockers.length === 0,
    metrics: {
      xcodeAvailable: input.tools.xcode ? 1 : 0,
      bundleIdsValid: input.project.bundleIdsValid ? 1 : 0,
      appGroupsValid: input.project.appGroupsValid ? 1 : 0,
      developmentTeamConfigured: input.configuration.teamConfigured ? 1 : 0,
      productionApiOriginConfigured: input.configuration.apiOriginConfigured ? 1 : 0,
      validSigningIdentities: input.signing.validIdentityCount,
      connectedPhysicalAppleDevices: input.device.physicalDeviceCount,
      testsPassed: input.tests.passed,
      testsFailed: input.tests.failed,
      testsSkipped: input.tests.skipped,
      testsCurrentForSources: input.tests.currentForSources ? 1 : 0,
      unsignedReleasePresent: input.release.unsignedAppPresent ? 1 : 0,
      unsignedReleaseCurrentForSources: input.release.currentForSources ? 1 : 0,
      unsignedReleasePrivacyManifestValid: input.release.privacyManifestValid ? 1 : 0,
      unsignedReleaseExportComplianceDeclared: input.release.exportComplianceDeclared ? 1 : 0,
      signedArchivePresent: input.archive.present ? 1 : 0,
      archivedAppSigned: input.archive.appSigned ? 1 : 0,
      archivedWidgetSigned: input.archive.widgetSigned ? 1 : 0,
      archivedAppStoreDistributionProfiles: input.archive.appStoreDistributionProfiles ? 1 : 0,
      archivedPrivacyManifestValid: input.archive.privacyManifestValid ? 1 : 0,
      archivedExportComplianceDeclared: input.archive.exportComplianceDeclared ? 1 : 0,
      archivedProductionApiOriginConfigured: input.archive.apiOriginConfigured ? 1 : 0
    },
    blockers
  };
}

function parseArgs(argv) {
  const result = {
    selfTest: false,
    xcresult: DEFAULT_XCRESULT,
    releaseApp: DEFAULT_RELEASE_APP,
    archive: ""
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--self-test") result.selfTest = true;
    else if (argument === "--xcresult") result.xcresult = argv[++index] ?? "";
    else if (argument === "--release-app") result.releaseApp = argv[++index] ?? "";
    else if (argument === "--archive") result.archive = argv[++index] ?? "";
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return result;
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    timeout: options.timeout ?? 20_000,
    env: {
      ...process.env,
      DEVELOPER_DIR: process.env.DEVELOPER_DIR || "/Applications/Xcode.app/Contents/Developer"
    },
    input: options.input,
    stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"]
  });
}

function latestIosSourceMtime(directory = path.join(REPOSITORY_ROOT, "ios")) {
  const included = new Set([
    ".swift", ".plist", ".entitlements", ".yml", ".pbxproj", ".xcconfig",
    ".xcprivacy", ".storekit", ".json", ".png", ".xcscheme"
  ]);
  const excludedDirectories = new Set([".build", "xcuserdata"]);
  let latest = 0;
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (included.has(path.extname(entry.name))) latest = Math.max(latest, statSync(absolute).mtimeMs);
    }
  };
  visit(directory);
  return latest;
}

function projectContract() {
  const projectYml = readFileSync(path.join(REPOSITORY_ROOT, "ios/project.yml"), "utf8");
  const appEntitlements = readFileSync(path.join(REPOSITORY_ROOT, "ios/Jianwei/Jianwei.entitlements"), "utf8");
  const widgetEntitlements = readFileSync(path.join(REPOSITORY_ROOT, "ios/JianweiWidget/JianweiWidget.entitlements"), "utf8");
  const projectTeam = projectYml.match(/DEVELOPMENT_TEAM:\s*"([^"]*)"/)?.[1]?.trim() ?? "";
  const projectApiOrigin = projectYml.match(/JIANWEI_API_BASE_URL:\s*"([^"]*)"/)?.[1]?.trim() ?? "";
  const team = (process.env.JIANWEI_IOS_DEVELOPMENT_TEAM || process.env.DEVELOPMENT_TEAM || projectTeam).trim();
  const apiOrigin = (process.env.JIANWEI_API_BASE_URL || projectApiOrigin).trim();
  return {
    project: {
      bundleIdsValid: projectYml.includes(`PRODUCT_BUNDLE_IDENTIFIER: ${EXPECTED_APP_ID}`) &&
        projectYml.includes(`PRODUCT_BUNDLE_IDENTIFIER: ${EXPECTED_WIDGET_ID}`),
      appGroupsValid: appEntitlements.includes(EXPECTED_APP_GROUP) && widgetEntitlements.includes(EXPECTED_APP_GROUP)
    },
    configuration: {
      teamConfigured: validTeamId(team),
      apiOriginConfigured: validPublicHttpsOrigin(apiOrigin)
    }
  };
}

function collectTestResult(relativePath, sourceMtime) {
  const absolute = path.resolve(REPOSITORY_ROOT, relativePath);
  if (!existsSync(absolute)) {
    return { resultAvailable: false, passed: 0, failed: 0, skipped: 0, currentForSources: false };
  }
  const command = run("/usr/bin/xcrun", [
    "xcresulttool", "get", "test-results", "summary", "--path", absolute
  ]);
  try {
    const summary = JSON.parse(command.stdout || "{}");
    return {
      resultAvailable: command.status === 0 && summary.result === "Passed",
      passed: Number(summary.passedTests) || 0,
      failed: Number(summary.failedTests) || 0,
      skipped: Number(summary.skippedTests) || 0,
      currentForSources: statSync(absolute).mtimeMs >= sourceMtime
    };
  } catch {
    return { resultAvailable: false, passed: 0, failed: 0, skipped: 0, currentForSources: false };
  }
}

function collectSigning() {
  const command = run("/usr/bin/security", ["find-identity", "-v", "-p", "codesigning"]);
  const count = Number((command.stdout || "").match(/(\d+) valid identities found/)?.[1] ?? 0);
  return { validIdentityCount: count };
}

function collectDevice() {
  const command = run("/usr/bin/xcrun", ["devicectl", "list", "devices"]);
  const output = `${command.stdout || ""}\n${command.stderr || ""}`;
  const physicalDeviceCount = output
    .split("\n")
    .filter((line) => /\b(iPhone|iPad)\b/i.test(line) && /\b(connected|available)\b/i.test(line))
    .length;
  return {
    inspectionSucceeded: command.status === 0,
    physicalDeviceCount
  };
}

function collectRelease(relativePath, sourceMtime) {
  const app = path.resolve(REPOSITORY_ROOT, relativePath);
  const appBinary = path.join(app, "Jianwei");
  const widgetBinary = path.join(app, "PlugIns/JianweiWidget.appex/JianweiWidget");
  const present = existsSync(appBinary) && existsSync(widgetBinary);
  return {
    unsignedAppPresent: present,
    currentForSources: present && statSync(app).mtimeMs >= sourceMtime,
    privacyManifestValid: present && validPrivacyManifest(app),
    exportComplianceDeclared: present && plistValue(path.join(app, "Info.plist"), "ITSAppUsesNonExemptEncryption") === "false"
  };
}

function validPrivacyManifest(bundlePath) {
  const checker = path.join(REPOSITORY_ROOT, "scripts/check-ios-app-store-metadata.mjs");
  const metadata = path.join(REPOSITORY_ROOT, "ios/AppStore/metadata.zh-Hans.json");
  const manifest = path.join(bundlePath, "PrivacyInfo.xcprivacy");
  if (!existsSync(manifest)) return false;
  return run(process.execPath, [checker, metadata, manifest]).status === 0;
}

function plistValue(plistPath, key) {
  if (!existsSync(plistPath)) return "";
  const command = run("/usr/bin/plutil", ["-extract", key, "raw", "-o", "-", plistPath]);
  return command.status === 0 ? (command.stdout || "").trim() : "";
}

function codeSigned(bundlePath) {
  if (!existsSync(bundlePath)) return false;
  const command = run("/usr/bin/codesign", ["--verify", "--deep", "--strict", bundlePath]);
  return command.status === 0;
}

function decodeProvisioningProfile(profilePath) {
  if (!existsSync(profilePath)) return null;
  const decoded = run("/usr/bin/security", ["cms", "-D", "-i", profilePath]);
  if (decoded.status !== 0 || !decoded.stdout) return null;
  const extract = (key, type = "raw") => {
    const result = run(
      "/usr/bin/plutil",
      ["-extract", key, type, "-o", "-", "--", "-"],
      { input: decoded.stdout }
    );
    return result.status === 0 ? (result.stdout || "").trim() : null;
  };
  const boolean = (key) => {
    const value = extract(key);
    return value === "true" ? true : value === "false" ? false : undefined;
  };
  const provisionedDevices = extract("ProvisionedDevices", "json");
  let parsedDevices;
  try {
    const value = provisionedDevices === null ? undefined : JSON.parse(provisionedDevices);
    parsedDevices = Array.isArray(value) ? value : undefined;
  } catch {
    return null;
  }
  const teamID = extract("TeamIdentifier.0");
  const applicationIdentifier = extract("Entitlements.application-identifier");
  const getTaskAllow = boolean("Entitlements.get-task-allow");
  if (!teamID || !applicationIdentifier || getTaskAllow === undefined) return null;
  return {
    LocalProvision: boolean("LocalProvision"),
    ProvisionsAllDevices: boolean("ProvisionsAllDevices"),
    ProvisionedDevices: parsedDevices,
    TeamIdentifier: [teamID],
    Entitlements: {
      "application-identifier": applicationIdentifier,
      "get-task-allow": getTaskAllow
    }
  };
}

export function isAppStoreDistributionProfile(profile, expectedBundleID) {
  const entitlements = profile?.Entitlements;
  const teamID = Array.isArray(profile?.TeamIdentifier) ? profile.TeamIdentifier[0] : null;
  return Boolean(
    profile &&
    entitlements &&
    profile.LocalProvision !== true &&
    profile.ProvisionsAllDevices !== true &&
    !Array.isArray(profile.ProvisionedDevices) &&
    entitlements["get-task-allow"] === false &&
    typeof teamID === "string" &&
    entitlements["application-identifier"] === `${teamID}.${expectedBundleID}`
  );
}

function appStoreDistributionProfile(bundlePath, expectedBundleID) {
  return inspectProvisioningProfile(
    path.join(bundlePath, "embedded.mobileprovision"),
    expectedBundleID
  );
}

export function inspectProvisioningProfile(profilePath, expectedBundleID) {
  return isAppStoreDistributionProfile(decodeProvisioningProfile(profilePath), expectedBundleID);
}

function collectArchive(relativePath) {
  if (!relativePath) {
    return {
      present: false,
      appSigned: false,
      widgetSigned: false,
      appStoreDistributionProfiles: false,
      privacyManifestValid: false,
      exportComplianceDeclared: false,
      apiOriginConfigured: false
    };
  }
  const archive = path.resolve(REPOSITORY_ROOT, relativePath);
  const app = path.join(archive, "Products/Applications/Jianwei.app");
  const widget = path.join(app, "PlugIns/JianweiWidget.appex");
  const present = existsSync(app) && existsSync(widget);
  return {
    present,
    appSigned: present && codeSigned(app),
    widgetSigned: present && codeSigned(widget),
    appStoreDistributionProfiles: present &&
      appStoreDistributionProfile(app, EXPECTED_APP_ID) &&
      appStoreDistributionProfile(widget, EXPECTED_WIDGET_ID),
    privacyManifestValid: present && validPrivacyManifest(app),
    exportComplianceDeclared: present && plistValue(path.join(app, "Info.plist"), "ITSAppUsesNonExemptEncryption") === "false",
    apiOriginConfigured: present && validPublicHttpsOrigin(plistValue(path.join(app, "Info.plist"), "JianweiAPIBaseURL"))
  };
}

function validSyntheticInput() {
  return {
    tools: { xcode: true },
    project: { bundleIdsValid: true, appGroupsValid: true },
    configuration: { teamConfigured: true, apiOriginConfigured: true },
    signing: { validIdentityCount: 1 },
    device: { inspectionSucceeded: true, physicalDeviceCount: 1 },
    tests: { resultAvailable: true, passed: 9, failed: 0, skipped: 0, currentForSources: true },
    release: {
      unsignedAppPresent: true,
      currentForSources: true,
      privacyManifestValid: true,
      exportComplianceDeclared: true
    },
    archive: {
      present: true,
      appSigned: true,
      widgetSigned: true,
      appStoreDistributionProfiles: true,
      privacyManifestValid: true,
      exportComplianceDeclared: true,
      apiOriginConfigured: true
    }
  };
}

function runSelfTest() {
  const valid = validSyntheticInput();
  if (assessIosBetaReadiness(valid).status !== "GO") throw new Error("valid iOS Beta evidence was rejected");
  const distributionProfile = {
    TeamIdentifier: ["69M7GUC67V"],
    Entitlements: {
      "application-identifier": "69M7GUC67V.cn.jianwei.ios",
      "get-task-allow": false
    }
  };
  if (!isAppStoreDistributionProfile(distributionProfile, EXPECTED_APP_ID)) {
    throw new Error("valid App Store distribution profile was rejected");
  }
  for (const profile of [
    { ...distributionProfile, LocalProvision: true },
    { ...distributionProfile, ProvisionedDevices: ["synthetic-device"] },
    { ...distributionProfile, ProvisionsAllDevices: true },
    {
      ...distributionProfile,
      Entitlements: { ...distributionProfile.Entitlements, "get-task-allow": true }
    },
    {
      ...distributionProfile,
      Entitlements: {
        ...distributionProfile.Entitlements,
        "application-identifier": "69M7GUC67V.cn.attacker.app"
      }
    }
  ]) {
    if (isAppStoreDistributionProfile(profile, EXPECTED_APP_ID)) {
      throw new Error("non-App-Store provisioning profile bypassed the release gate");
    }
  }
  const cases = [
    ["team", { configuration: { ...valid.configuration, teamConfigured: false } }],
    ["origin", { configuration: { ...valid.configuration, apiOriginConfigured: false } }],
    ["identity", { signing: { validIdentityCount: 0 } }],
    ["device", { device: { inspectionSucceeded: true, physicalDeviceCount: 0 } }],
    ["tests", { tests: { ...valid.tests, failed: 1 } }],
    ["stale tests", { tests: { ...valid.tests, currentForSources: false } }],
    ["release", { release: { unsignedAppPresent: false, currentForSources: false } }],
    ["release privacy manifest", { release: { ...valid.release, privacyManifestValid: false } }],
    ["release export compliance", { release: { ...valid.release, exportComplianceDeclared: false } }],
    ["archive", {
      archive: {
        present: false,
        appSigned: false,
        widgetSigned: false,
        appStoreDistributionProfiles: false,
        privacyManifestValid: false,
        exportComplianceDeclared: false,
        apiOriginConfigured: false
      }
    }],
    ["development profile", {
      archive: { ...valid.archive, appStoreDistributionProfiles: false }
    }],
    ["archive privacy manifest", {
      archive: { ...valid.archive, privacyManifestValid: false }
    }],
    ["archive export compliance", {
      archive: { ...valid.archive, exportComplianceDeclared: false }
    }]
  ];
  for (const [name, patch] of cases) {
    const assessed = assessIosBetaReadiness({ ...valid, ...patch });
    if (assessed.status !== "NO_GO") throw new Error(`self-test expected rejection: ${name}`);
  }
  console.log(`IOS_BETA_READINESS_SELF_TEST=GO bypassesRejected=${cases.length + 5} secretValuesPrinted=0`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.selfTest) {
    runSelfTest();
    return;
  }
  const sourceMtime = latestIosSourceMtime();
  const xcode = run("/usr/bin/xcrun", ["xcodebuild", "-version"]);
  const contract = projectContract();
  const result = assessIosBetaReadiness({
    tools: { xcode: xcode.status === 0 },
    ...contract,
    signing: collectSigning(),
    device: collectDevice(),
    tests: collectTestResult(options.xcresult, sourceMtime),
    release: collectRelease(options.releaseApp, sourceMtime),
    archive: collectArchive(options.archive)
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "GO") process.exitCode = 1;
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    console.error(`IOS_BETA_READINESS=ERROR reason=${error instanceof Error ? error.message : "unknown"}`);
    process.exitCode = 1;
  });
}
