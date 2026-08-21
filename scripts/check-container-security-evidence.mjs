import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const HIGH_SEVERITIES = new Set(["HIGH", "CRITICAL"]);
const IMAGE_ID_PATTERN = /^sha256:[a-f0-9]{64}$/;

export function assessContainerSecurityEvidence(report, sbom, expectedImageId) {
  const blockers = [];
  const vulnerabilities = Array.isArray(report?.Results)
    ? report.Results.flatMap((result) => Array.isArray(result?.Vulnerabilities) ? result.Vulnerabilities : [])
    : [];
  const highCritical = vulnerabilities.filter((item) => HIGH_SEVERITIES.has(item?.Severity));
  const fixableHighCritical = highCritical.filter((item) => String(item?.FixedVersion ?? "").trim().length > 0);
  const imageId = String(report?.Metadata?.ImageID ?? "").toLowerCase();
  const sbomProperties = Array.isArray(sbom?.metadata?.component?.properties)
    ? sbom.metadata.component.properties
    : [];
  const sbomImageIds = sbomProperties
    .filter((item) => item?.name === "aquasecurity:trivy:ImageID")
    .map((item) => String(item?.value ?? "").toLowerCase());
  const sbomPurl = String(sbom?.metadata?.component?.purl ?? "").toLowerCase();
  const scanner = sbom?.metadata?.tools?.components?.find((item) => item?.name === "trivy");

  if (!IMAGE_ID_PATTERN.test(expectedImageId ?? "")) blockers.push("expected image ID must be an OCI SHA-256 digest");
  if (report?.SchemaVersion !== 2 || report?.ArtifactType !== "container_image") {
    blockers.push("vulnerability report is not a supported Trivy container report");
  }
  if (imageId !== expectedImageId) blockers.push("vulnerability report is not bound to the expected image ID");
  if (!String(report?.ArtifactName ?? "").trim()) blockers.push("vulnerability report is missing the image reference");
  if (!Array.isArray(report?.Results) || report.Results.length === 0) blockers.push("vulnerability report has no scan results");
  if (fixableHighCritical.length > 0) blockers.push("container has fixable HIGH or CRITICAL vulnerabilities");
  if (sbom?.bomFormat !== "CycloneDX" || !/^1\.[4-9]$/.test(String(sbom?.specVersion ?? ""))) {
    blockers.push("SBOM is not a supported CycloneDX document");
  }
  if (!Array.isArray(sbom?.components) || sbom.components.length === 0) blockers.push("SBOM has no components");
  if (sbomImageIds.length !== 1 || sbomImageIds[0] !== expectedImageId || !sbomPurl.includes(expectedImageId)) {
    blockers.push("SBOM is not bound to the expected image ID");
  }
  if (!scanner?.version) blockers.push("SBOM is missing the Trivy scanner version");

  const countsBySeverity = {};
  for (const item of vulnerabilities) {
    const severity = String(item?.Severity ?? "UNKNOWN");
    countsBySeverity[severity] = (countsBySeverity[severity] ?? 0) + 1;
  }

  return {
    status: blockers.length === 0 ? "GO" : "NO_GO",
    releaseEvidence: false,
    imageId,
    imageReference: String(report?.ArtifactName ?? ""),
    scanArtifactId: String(report?.ArtifactID ?? ""),
    scannerVersion: String(scanner?.version ?? ""),
    metrics: {
      components: Array.isArray(sbom?.components) ? sbom.components.length : 0,
      vulnerabilities: vulnerabilities.length,
      highCritical: highCritical.length,
      fixableHighCritical: fixableHighCritical.length,
      countsBySeverity
    },
    blockers: [...new Set(blockers)]
  };
}

export function validateContainerSecurityEvidenceArtifact(evidence, reportBytes, sbomBytes) {
  const blockers = [];
  let report;
  let sbom;
  try {
    report = JSON.parse(reportBytes.toString("utf8"));
    sbom = JSON.parse(sbomBytes.toString("utf8"));
  } catch {
    return { status: "NO_GO", assessment: null, blockers: ["container security source artifacts are not valid JSON"] };
  }
  const assessment = assessContainerSecurityEvidence(report, sbom, String(evidence?.imageId ?? "").toLowerCase());
  const expectedKeys = [
    "blockers", "evidenceKind", "generatedAt", "imageId", "imageReference", "metrics",
    "releaseEvidence", "reportSha256", "sbomSha256", "scanArtifactId", "scannerVersion",
    "schemaVersion", "status"
  ];
  if (Object.keys(evidence ?? {}).sort().join(",") !== expectedKeys.sort().join(",")) {
    blockers.push("container security evidence has an unexpected schema");
  }
  if (evidence?.schemaVersion !== 1 || evidence?.evidenceKind !== "local_container_security_scan" ||
      evidence?.status !== "GO" || evidence?.releaseEvidence !== false) {
    blockers.push("container security evidence identity or status is invalid");
  }
  if (!Number.isFinite(Date.parse(evidence?.generatedAt ?? ""))) blockers.push("container security evidence timestamp is invalid");
  if (evidence?.reportSha256 !== sha256(reportBytes)) blockers.push("vulnerability report SHA-256 does not match the evidence");
  if (evidence?.sbomSha256 !== sha256(sbomBytes)) blockers.push("SBOM SHA-256 does not match the evidence");
  for (const key of ["imageId", "imageReference", "scanArtifactId", "scannerVersion"]) {
    if (evidence?.[key] !== assessment[key]) blockers.push(`container security evidence ${key} does not match its source artifacts`);
  }
  if (JSON.stringify(evidence?.metrics) !== JSON.stringify(assessment.metrics) ||
      !Array.isArray(evidence?.blockers) || evidence.blockers.length !== 0) {
    blockers.push("container security evidence metrics or blockers do not match its source artifacts");
  }
  if (assessment.status !== "GO") blockers.push(...assessment.blockers);
  return {
    status: blockers.length === 0 ? "GO" : "NO_GO",
    assessment,
    blockers: [...new Set(blockers)]
  };
}

async function main() {
  if (process.argv.includes("--self-test")) return selfTest();
  const args = parseArgs(process.argv.slice(2));
  for (const name of ["report", "sbom", "image-id", "output"]) {
    if (!args[name]) throw new Error(`--${name} is required`);
  }
  const reportBytes = await readFile(args.report);
  const sbomBytes = await readFile(args.sbom);
  const result = assessContainerSecurityEvidence(
    JSON.parse(reportBytes.toString("utf8")),
    JSON.parse(sbomBytes.toString("utf8")),
    args["image-id"].toLowerCase()
  );
  const evidence = {
    schemaVersion: 1,
    evidenceKind: "local_container_security_scan",
    generatedAt: new Date().toISOString(),
    ...result,
    reportSha256: sha256(reportBytes),
    sbomSha256: sha256(sbomBytes)
  };
  await mkdir(path.dirname(args.output), { recursive: true });
  await writeFile(args.output, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(`CONTAINER_SECURITY_EVIDENCE=${result.status} imageId=${result.imageId} components=${result.metrics.components} highCritical=${result.metrics.highCritical} fixableHighCritical=${result.metrics.fixableHighCritical} releaseEvidence=0 output=${args.output}\n`);
  if (result.status !== "GO") process.exitCode = 1;
}

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) throw new Error("Arguments must be --name value pairs");
    result[key.slice(2)] = value;
  }
  return result;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fixture() {
  const imageId = `sha256:${"a".repeat(64)}`;
  return {
    imageId,
    report: {
      SchemaVersion: 2,
      ArtifactType: "container_image",
      ArtifactName: "jianwei-api:test",
      ArtifactID: `sha256:${"b".repeat(64)}`,
      Metadata: { ImageID: imageId },
      Results: [{ Vulnerabilities: [{ VulnerabilityID: "CVE-TEST", Severity: "HIGH", FixedVersion: "" }] }]
    },
    sbom: {
      bomFormat: "CycloneDX",
      specVersion: "1.7",
      metadata: {
        tools: { components: [{ name: "trivy", version: "0.72.0" }] },
        component: {
          purl: `pkg:oci/jianwei-api@${imageId}?arch=amd64`,
          properties: [{ name: "aquasecurity:trivy:ImageID", value: imageId }]
        }
      },
      components: [{ type: "library", name: "fixture", version: "1.0.0" }]
    }
  };
}

function fixtureEvidence(item) {
  const reportBytes = Buffer.from(JSON.stringify(item.report));
  const sbomBytes = Buffer.from(JSON.stringify(item.sbom));
  const assessment = assessContainerSecurityEvidence(item.report, item.sbom, item.imageId);
  return {
    reportBytes,
    sbomBytes,
    evidence: {
      schemaVersion: 1,
      evidenceKind: "local_container_security_scan",
      generatedAt: "2026-01-01T00:00:00.000Z",
      ...assessment,
      reportSha256: sha256(reportBytes),
      sbomSha256: sha256(sbomBytes)
    }
  };
}

function selfTest() {
  const passing = fixture();
  if (assessContainerSecurityEvidence(passing.report, passing.sbom, passing.imageId).status !== "GO") {
    throw new Error("Valid container security evidence was rejected");
  }
  const cases = [
    (item) => { item.report.Metadata.ImageID = `sha256:${"c".repeat(64)}`; },
    (item) => { item.sbom.metadata.component.properties[0].value = `sha256:${"c".repeat(64)}`; },
    (item) => { item.sbom.metadata.component.purl = "pkg:oci/jianwei-api@sha256:bad"; },
    (item) => { item.report.Results[0].Vulnerabilities[0].FixedVersion = "1.0.1"; },
    (item) => { item.report.Results = []; },
    (item) => { item.sbom.components = []; },
    (item) => { item.sbom.bomFormat = "SPDX"; }
  ];
  for (const mutate of cases) {
    const item = structuredClone(passing);
    mutate(item);
    if (assessContainerSecurityEvidence(item.report, item.sbom, item.imageId).status !== "NO_GO") {
      throw new Error("Container security mutation bypassed the gate");
    }
  }
  const validArtifact = fixtureEvidence(passing);
  if (validateContainerSecurityEvidenceArtifact(validArtifact.evidence, validArtifact.reportBytes, validArtifact.sbomBytes).status !== "GO") {
    throw new Error("Valid container security evidence artifact was rejected");
  }
  const artifactCases = [
    (item) => { item.evidence.reportSha256 = "c".repeat(64); },
    (item) => { item.evidence.sbomSha256 = "c".repeat(64); },
    (item) => { item.evidence.metrics.highCritical += 1; },
    (item) => { item.evidence.imageId = `sha256:${"c".repeat(64)}`; },
    (item) => { item.reportBytes = Buffer.from("{}"); },
    (item) => { item.sbomBytes = Buffer.from("{}"); },
    (item) => { item.evidence.releaseEvidence = true; },
    (item) => { item.evidence.unexpected = "field"; }
  ];
  for (const mutate of artifactCases) {
    const item = {
      evidence: structuredClone(validArtifact.evidence),
      reportBytes: Buffer.from(validArtifact.reportBytes),
      sbomBytes: Buffer.from(validArtifact.sbomBytes)
    };
    mutate(item);
    if (validateContainerSecurityEvidenceArtifact(item.evidence, item.reportBytes, item.sbomBytes).status !== "NO_GO") {
      throw new Error("Container security evidence artifact mutation bypassed the gate");
    }
  }
  const bypassesRejected = cases.length + artifactCases.length;
  process.stdout.write(`CONTAINER_SECURITY_EVIDENCE_SELF_TEST=GO synthetic=1 releaseEvidence=0 bypassesRejected=${bypassesRejected} imageDigestBinding=1 reportShaBinding=1 sbomBinding=1 fixableHighCriticalGate=1 artifactRevalidation=1\n`);
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMainModule) await main();
