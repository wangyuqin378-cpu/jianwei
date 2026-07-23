import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  parsePublicHttpsUrl,
  requestPublicHttpsMetadata,
  resolveHostWithGoogleDoh
} from "./lib/safe-source-request.mjs";

export function assessSourceCatalog(catalog) {
  const failures = [];
  if (!Array.isArray(catalog.sources) || catalog.sources.length === 0) failures.push("catalog has no sources");
  if (!Array.isArray(catalog.topics) || catalog.topics.length === 0) failures.push("catalog has no topics");
  const sourceIds = new Set();
  const normalizedUrls = new Set();
  const referenced = new Set();
  for (const source of catalog.sources ?? []) {
    if (!source.sourceId || sourceIds.has(source.sourceId)) failures.push(`duplicate or missing sourceId: ${source.sourceId ?? "<missing>"}`);
    sourceIds.add(source.sourceId);
    if (!source.title?.trim() || !source.publisher?.trim() || !source.authority?.trim()) {
      failures.push(`source metadata is incomplete: ${source.sourceId}`);
    }
    const safety = assessPublicHttpsUrl(source.url);
    if (!safety.ok) failures.push(`${source.sourceId}: ${safety.reason}`);
    else if (normalizedUrls.has(safety.normalized)) failures.push(`duplicate source URL: ${source.sourceId}`);
    else normalizedUrls.add(safety.normalized);
  }
  for (const topic of catalog.topics ?? []) {
    for (const fact of topic.facts ?? []) {
      if (!Array.isArray(fact.sourceIds) || fact.sourceIds.length === 0) failures.push(`fact has no source: ${fact.factId}`);
      for (const sourceId of fact.sourceIds ?? []) {
        referenced.add(sourceId);
        if (!sourceIds.has(sourceId)) failures.push(`fact references unknown source: ${fact.factId}/${sourceId}`);
      }
    }
  }
  for (const sourceId of sourceIds) if (!referenced.has(sourceId)) failures.push(`source is not referenced by any fact: ${sourceId}`);
  return {
    status: failures.length === 0 ? "GO" : "NO_GO",
    metrics: { sources: sourceIds.size, referencedSources: referenced.size, urls: normalizedUrls.size },
    blockers: [...new Set(failures)]
  };
}

export function assessPublicHttpsUrl(value) {
  try {
    return { ok: true, normalized: parsePublicHttpsUrl(value).toString() };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "source URL is invalid" };
  }
}

export function assessLiveResponse({ status, contentType, finalUrl }) {
  if (status < 200 || status >= 300) return { ok: false, reason: `HTTP ${status}` };
  const safety = assessPublicHttpsUrl(finalUrl);
  if (!safety.ok) return { ok: false, reason: `unsafe redirect: ${safety.reason}` };
  if (!/^(?:text\/html|text\/plain|application\/pdf|application\/xhtml\+xml)(?:;|$)/i.test(contentType ?? "")) {
    return { ok: false, reason: `unexpected content type: ${contentType || "<missing>"}` };
  }
  return { ok: true };
}

export function selectLiveSources(catalog, includeDraftSources = false) {
  if (includeDraftSources) return [...(catalog.sources ?? [])];
  const candidateSourceIds = new Set();
  for (const topic of catalog.topics ?? []) {
    for (const fact of topic.facts ?? []) {
      if (fact.reviewStatus !== "approved") continue;
      for (const sourceId of fact.sourceIds ?? []) candidateSourceIds.add(sourceId);
    }
  }
  return (catalog.sources ?? []).filter((source) => candidateSourceIds.has(source.sourceId));
}

export function parseLiveConcurrency(args) {
  const flags = args.filter((arg) => arg.startsWith("--concurrency"));
  if (flags.length === 0) return 6;
  if (flags.length !== 1 || !/^--concurrency=\d+$/.test(flags[0])) {
    throw new Error("--concurrency must be provided once as --concurrency=N");
  }
  const value = Number(flags[0].slice("--concurrency=".length));
  if (!Number.isSafeInteger(value) || value < 1 || value > 12) {
    throw new Error("--concurrency must be an integer from 1 to 12");
  }
  return value;
}

export function selectResumableSuccesses(evidence, { catalogVersion, sourceScope, nowMs = Date.now() }) {
  if (!evidence || evidence.schemaVersion !== 1 || evidence.evidenceKind !== "live_knowledge_source_reachability") return new Map();
  if (evidence.catalogVersion !== catalogVersion || evidence.sourceScope !== sourceScope || !Array.isArray(evidence.results)) return new Map();
  const checkedAtMs = Date.parse(evidence.checkedAt);
  const ageMs = nowMs - checkedAtMs;
  if (!Number.isFinite(checkedAtMs) || ageMs < -300_000 || ageMs > 86_400_000) return new Map();
  return new Map(evidence.results
    .filter((result) => result?.ok === true && typeof result.sourceId === "string")
    .map((result) => [result.sourceId, { ...result, checkedAt: result.checkedAt ?? evidence.checkedAt, reused: true }]));
}

const catalog = JSON.parse(await readFile("knowledge/catalog.json", "utf8"));
if (process.argv.includes("--self-test")) {
  const passing = assessSourceCatalog(catalog);
  if (passing.status !== "GO") throw new Error(`Knowledge source fixture failed: ${passing.blockers.join("; ")}`);
  const cases = [
    ["HTTP source", (value) => { value.sources[0].url = value.sources[0].url.replace("https://", "http://"); }],
    ["private source", (value) => { value.sources[0].url = "https://127.0.0.1/source"; }],
    ["private IPv6 source", (value) => { value.sources[0].url = "https://[::1]/source"; }],
    ["duplicate URL", (value) => { value.sources[1].url = value.sources[0].url; }],
    ["unknown fact source", (value) => { value.topics[0].facts[0].sourceIds = ["src-missing"]; }]
  ];
  for (const [name, mutate] of cases) {
    const value = structuredClone(catalog);
    mutate(value);
    if (assessSourceCatalog(value).status !== "NO_GO") throw new Error(`Knowledge source self-test expected rejection: ${name}`);
  }
  if (assessLiveResponse({ status: 404, contentType: "text/html", finalUrl: "https://example.com" }).ok) {
    throw new Error("Knowledge source self-test accepted HTTP 404");
  }
  const releaseCandidateSources = selectLiveSources(catalog);
  if (releaseCandidateSources.length === 0 || releaseCandidateSources.some((source) => source.sourceId === "src-tableware")) {
    throw new Error("Knowledge source self-test did not isolate approved release candidates");
  }
  if (selectLiveSources(catalog, true).length !== catalog.sources.length) {
    throw new Error("Knowledge source self-test did not retain all editorial sources");
  }
  if (parseLiveConcurrency([]) !== 6 || parseLiveConcurrency(["--concurrency=1"]) !== 1) {
    throw new Error("Knowledge source self-test did not parse live-check concurrency");
  }
  for (const invalid of ["--concurrency=0", "--concurrency=13", "--concurrency=x", "--concurrency"]) {
    try {
      parseLiveConcurrency([invalid]);
      throw new Error(`Knowledge source self-test accepted invalid concurrency: ${invalid}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Knowledge source self-test")) throw error;
    }
  }
  const resumableFixture = {
    schemaVersion: 1,
    evidenceKind: "live_knowledge_source_reachability",
    catalogVersion: catalog.version,
    sourceScope: "all_editorial_sources",
    checkedAt: new Date().toISOString(),
    results: [{ sourceId: catalog.sources[0].sourceId, ok: true }]
  };
  if (selectResumableSuccesses(resumableFixture, {
    catalogVersion: catalog.version,
    sourceScope: "all_editorial_sources"
  }).size !== 1 || selectResumableSuccesses(resumableFixture, {
    catalogVersion: `${catalog.version}-stale`,
    sourceScope: "all_editorial_sources"
  }).size !== 0) {
    throw new Error("Knowledge source self-test did not bind resumed evidence to the catalog version");
  }
  const infrastructureReason = "Source hostname did not resolve exclusively to public IP addresses";
  const infrastructureSources = [
    { sourceId: "one", url: "https://one.example.org/a" },
    { sourceId: "two", url: "https://two.example.net/b" },
    { sourceId: "three", url: "https://three.example.com/c" }
  ];
  const infrastructureResults = infrastructureSources.map((source) => ({
    sourceId: source.sourceId,
    ok: false,
    reason: infrastructureReason
  }));
  if (!isSystemicNetworkFailure(infrastructureSources, infrastructureResults) ||
      isSystemicNetworkFailure(infrastructureSources, [
        infrastructureResults[0],
        { sourceId: "two", ok: true, status: 200 },
        infrastructureResults[2]
      ]) ||
      !isSystemicNetworkFailure(infrastructureSources, infrastructureSources.map((source) => ({
        sourceId: source.sourceId,
        ok: false,
        reason: "Google DoH resolver failed: fetch failed"
      }))) ||
      isSystemicNetworkFailure([infrastructureSources[0]], [infrastructureResults[0]])) {
    throw new Error("Knowledge source self-test did not isolate a correlated infrastructure failure");
  }
  const failedPlan = liveEvidenceOutputPlan(".tooling/results", "all-sources.json", true);
  const passingPlan = liveEvidenceOutputPlan(".tooling/results", "all-sources.json", false);
  if (failedPlan.canonicalPath !== null || !failedPlan.attemptPath.endsWith("all-sources-latest-attempt.json") ||
      passingPlan.canonicalPath !== ".tooling/results/all-sources.json") {
    throw new Error("Knowledge source self-test did not preserve canonical evidence on infrastructure failure");
  }
  let privateDnsRejected = false;
  try {
    await requestPublicHttpsMetadata("https://example.org/source", {
      resolveHost: async () => [{ address: "127.0.0.1", family: 4 }],
      requestOnce: async () => { throw new Error("request must not start"); }
    });
  } catch { privateDnsRejected = true; }
  let privateRedirectRejected = false;
  try {
    await requestPublicHttpsMetadata("https://example.org/source", {
      resolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
      requestOnce: async () => ({ status: 302, contentType: "text/html", location: "https://127.0.0.1/private" })
    });
  } catch { privateRedirectRejected = true; }
  if (!privateDnsRejected || !privateRedirectRejected) {
    throw new Error("Knowledge source self-test accepted private DNS or redirect targets");
  }
  const dohQueries = [];
  const dohAddresses = await resolveHostWithGoogleDoh("source.example.org", {
    fetchImpl: async (url, options) => {
      dohQueries.push({ url: url.toString(), options });
      const type = url.searchParams.get("type");
      const code = type === "A" ? 1 : 28;
      return {
        ok: true,
        status: 200,
        headers: { get: () => "application/json; charset=UTF-8" },
        json: async () => ({
          Status: 0,
          Question: [{ name: "source.example.org.", type: code }],
          Answer: type === "A"
            ? [{ name: "source.example.org.", type: 5, data: "edge.example.org." }, { name: "edge.example.org.", type: 1, data: "93.184.216.34" }]
            : [{ name: "source.example.org.", type: 28, data: "2606:2800:220:1:248:1893:25c8:1946" }]
        })
      };
    }
  });
  if (dohAddresses.length !== 2 ||
      !dohAddresses.some((entry) => entry.address === "93.184.216.34" && entry.family === 4) ||
      !dohAddresses.some((entry) => entry.address === "2606:2800:220:1:248:1893:25c8:1946" && entry.family === 6) ||
      dohQueries.length !== 2 ||
      dohQueries.some((query) => query.options.redirect !== "error" ||
        query.options.headers.accept !== "application/dns-json" ||
        !query.url.startsWith("https://dns.google/resolve?"))) {
    throw new Error("Knowledge source self-test did not resolve through the fixed Google DoH endpoint");
  }
  let privateDohRejected = false;
  try {
    await requestPublicHttpsMetadata("https://source.example.org/source", {
      resolveHost: (hostname) => resolveHostWithGoogleDoh(hostname, {
        fetchImpl: async (url) => {
          const type = url.searchParams.get("type");
          const code = type === "A" ? 1 : 28;
          return {
            ok: true,
            status: 200,
            headers: { get: () => "application/json" },
            json: async () => ({
              Status: type === "A" ? 0 : 3,
              Question: [{ name: "source.example.org.", type: code }],
              Answer: type === "A"
                ? [{ name: "source.example.org.", type: 1, data: "127.0.0.1" }]
                : []
            })
          };
        }
      }),
      requestOnce: async () => { throw new Error("request must not start"); }
    });
  } catch { privateDohRejected = true; }
  if (!privateDohRejected) throw new Error("Knowledge source self-test trusted a private DoH answer");
  process.stdout.write(`KNOWLEDGE_SOURCE_SELF_TEST=GO synthetic=1 releaseEvidence=0 bypassesRejected=${cases.length + 12} dnsPinning=1 manualRedirect=1 googleDoh=1 privateDohRejected=1\n`);
} else if (process.argv.includes("--live") || process.argv.includes("--all-live")) {
  const staticResult = assessSourceCatalog(catalog);
  if (staticResult.status !== "GO") {
    process.stdout.write(`${JSON.stringify(staticResult, null, 2)}\n`);
    process.exitCode = 1;
  } else {
    const includeDraftSources = process.argv.includes("--all-live");
    const sourceScope = includeDraftSources ? "all_editorial_sources" : "approved_release_candidates";
    const sources = selectLiveSources(catalog, includeDraftSources);
    if (sources.length === 0) throw new Error(`No sources found for live-check scope: ${sourceScope}`);
    const checkedAt = new Date().toISOString();
    const useGoogleDoh = process.argv.includes("--google-doh");
    const resolveHost = useGoogleDoh ? resolveHostWithGoogleDoh : undefined;
    const concurrency = parseLiveConcurrency(process.argv.slice(2));
    const directory = ".tooling/knowledge-source-results";
    const fileName = includeDraftSources ? "all-sources.json" : "release-candidates.json";
    let resumable = new Map();
    if (process.argv.includes("--resume-successes")) {
      const prior = await readFile(`${directory}/${fileName}`, "utf8")
        .then((value) => JSON.parse(value))
        .catch(() => null);
      resumable = selectResumableSuccesses(prior, {
        catalogVersion: catalog.version,
        sourceScope,
        nowMs: Date.parse(checkedAt)
      });
    }
    const sourcesToCheck = sources.filter((source) => !resumable.has(source.sourceId));
    const checkedResults = await mapConcurrent(sourcesToCheck, concurrency, (source) => checkSourceLive(source, resolveHost));
    const checkedBySource = new Map(checkedResults.map((result) => [result.sourceId, result]));
    const results = sources.map((source) => resumable.get(source.sourceId) ?? checkedBySource.get(source.sourceId));
    const failures = results.filter((item) => !item.ok);
    const infrastructureFailure = isSystemicNetworkFailure(sourcesToCheck, checkedResults);
    const evidence = {
      schemaVersion: 1,
      evidenceKind: "live_knowledge_source_reachability",
      sourceScope,
      concurrency,
      resolver: useGoogleDoh ? "google_doh" : "system",
      checkedAt,
      catalogVersion: catalog.version,
      total: results.length,
      reachable: results.length - failures.length,
      resumedSuccesses: resumable.size,
      checkedNow: sourcesToCheck.length,
      infrastructureFailure,
      results
    };
    await mkdir(directory, { recursive: true });
    const outputPlan = liveEvidenceOutputPlan(directory, fileName, infrastructureFailure);
    await writeFile(outputPlan.attemptPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    if (outputPlan.canonicalPath) await writeFile(outputPlan.canonicalPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    const status = failures.length === 0 ? "GO" : "NO_GO";
    process.stdout.write(`KNOWLEDGE_SOURCE_LIVE_GATE=${status} scope=${sourceScope} resolver=${evidence.resolver} sources=${results.length} reachable=${results.length - failures.length} failed=${failures.length} resumed=${resumable.size} checkedNow=${sourcesToCheck.length} infrastructureFailure=${infrastructureFailure ? 1 : 0} canonicalUpdated=${infrastructureFailure ? 0 : 1}\n`);
    if (infrastructureFailure) {
      process.stdout.write(`SOURCE_INFRASTRUCTURE_FAILURE hosts=${new Set(sourcesToCheck.map((source) => new URL(source.url).hostname)).size} reason=${checkedResults[0]?.reason ?? "network failure"}\n`);
    } else {
      for (const failure of failures) process.stdout.write(`SOURCE_FAILURE sourceId=${failure.sourceId} reason=${failure.reason}\n`);
    }
    process.stdout.write(`ATTEMPT_RESULTS=${outputPlan.attemptPath}\n`);
    if (outputPlan.canonicalPath) process.stdout.write(`RESULTS=${outputPlan.canonicalPath}\n`);
    if (failures.length > 0) process.exitCode = 1;
  }
} else {
  const result = assessSourceCatalog(catalog);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== "GO") process.exitCode = 1;
}

async function checkSourceLive(source, resolveHost) {
  let lastReason = "request failed";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await requestPublicHttpsMetadata(source.url, {
        timeoutMs: 15_000,
        ...(resolveHost ? { resolveHost } : {}),
        headers: {
          accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,text/plain;q=0.8",
          "accept-language": "en-US,en;q=0.8",
          range: "bytes=0-4095",
          "user-agent": "JianweiSourceVerifier/1.0 (+https://example.invalid/security)"
        }
      });
      const result = assessLiveResponse({
        status: response.status,
        contentType: response.contentType,
        finalUrl: response.finalUrl
      });
      if (result.ok) return { sourceId: source.sourceId, ok: true, status: response.status, finalUrl: response.finalUrl, checkedAt: new Date().toISOString(), reused: false };
      lastReason = result.reason;
      if (response.status < 429 && response.status !== 408) break;
    } catch (error) {
      lastReason = error instanceof Error ? error.message : "request failed";
    }
    if (attempt === 1) await new Promise((resolve) => setTimeout(resolve, 750));
  }
  return { sourceId: source.sourceId, ok: false, reason: lastReason, checkedAt: new Date().toISOString(), reused: false };
}

export function isSystemicNetworkFailure(sources, checkedResults) {
  if (!Array.isArray(sources) || !Array.isArray(checkedResults) ||
      sources.length < 3 || checkedResults.length !== sources.length ||
      checkedResults.some((result) => result?.ok === true)) {
    return false;
  }
  const hostnames = new Set(sources.map((source) => {
    try {
      return new URL(source.url).hostname;
    } catch {
      return "";
    }
  }).filter(Boolean));
  const reasons = new Set(checkedResults.map((result) => result?.reason));
  if (hostnames.size < 3 || reasons.size !== 1) return false;
  const reason = String(checkedResults[0]?.reason ?? "");
  return reason === "Source hostname did not resolve exclusively to public IP addresses" ||
    /\b(?:ENOTFOUND|EAI_AGAIN|ENETUNREACH|network is unreachable)\b/i.test(reason) ||
    /^Google DoH (?:returned|response|resolver)/.test(reason);
}

export function liveEvidenceOutputPlan(directory, fileName, infrastructureFailure) {
  const attemptFileName = fileName.replace(/\.json$/, "-latest-attempt.json");
  return {
    attemptPath: `${directory}/${attemptFileName}`,
    canonicalPath: infrastructureFailure ? null : `${directory}/${fileName}`
  };
}

async function mapConcurrent(values, concurrency, operation) {
  const output = new Array(values.length);
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (index < values.length) {
      const current = index;
      index += 1;
      output[current] = await operation(values[current]);
    }
  }));
  return output;
}
