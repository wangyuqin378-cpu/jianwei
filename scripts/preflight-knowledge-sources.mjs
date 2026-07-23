import {
  isPublicIpAddress,
  parsePublicHttpsUrl,
  requestPublicHttpsMetadata
} from "./lib/safe-source-request.mjs";

if (process.argv.includes("--self-test")) {
  if (!assessResponse({ status: 200, contentType: "text/html; charset=utf-8", finalUrl: "https://example.org/source" }).ok ||
      assessResponse({ status: 404, contentType: "text/html", finalUrl: "https://example.org/source" }).ok ||
      assessResponse({ status: 200, contentType: "application/json", finalUrl: "https://example.org/source" }).ok ||
      assessResponse({ status: 200, contentType: "application/pdf", finalUrl: "http://example.org/source" }).ok ||
      assessResponse({ status: 200, contentType: "application/pdf", finalUrl: "https://[::1]/source" }).ok) {
    throw new Error("Knowledge source preflight self-test did not fail closed");
  }
  if (!isPublicIpAddress("8.8.8.8") || !isPublicIpAddress("2001:4860:4860::8888") ||
      isPublicIpAddress("127.0.0.1") || isPublicIpAddress("::1") || isPublicIpAddress("2001:db8::1")) {
    throw new Error("Knowledge source preflight self-test did not classify public/private IP addresses");
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
    throw new Error("Knowledge source preflight self-test accepted private DNS or redirect targets");
  }
  let pinnedAddress = null;
  const pinnedResponse = await requestPublicHttpsMetadata("https://example.org/source", {
    resolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
    requestOnce: async (_url, address) => {
      pinnedAddress = address;
      return { status: 200, contentType: "text/html", location: null };
    }
  });
  if (pinnedAddress?.address !== "93.184.216.34" || pinnedResponse.finalUrl !== "https://example.org/source") {
    throw new Error("Knowledge source preflight self-test did not pin the vetted DNS address");
  }
  process.stdout.write("KNOWLEDGE_SOURCE_PREFLIGHT_SELF_TEST=GO synthetic=1 network=0 failClosed=1 productionRequestContract=1 dnsPinning=1 manualRedirect=1\n");
  process.exit(0);
}

const urls = process.argv.slice(2);

if (urls.length === 0) {
  throw new Error("Usage: node scripts/preflight-knowledge-sources.mjs <https-url> [...]");
}

let failed = false;
for (const url of urls) {
  const result = await checkSource(url);
  process.stdout.write(`${result.ok ? "GO" : "NO_GO"}\t${url}\t${result.detail}\n`);
  if (!result.ok) failed = true;
}

if (failed) process.exitCode = 1;

async function checkSource(url) {
  let detail = "request failed";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await requestPublicHttpsMetadata(url, {
        timeoutMs: 15_000,
        headers: {
          accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,text/plain;q=0.8",
          "accept-language": "en-US,en;q=0.8",
          range: "bytes=0-4095",
          "user-agent": "JianweiSourceVerifier/1.0 (+https://example.invalid/security)"
        }
      });
      const contentType = response.contentType;
      const finalUrl = response.finalUrl;
      detail = `HTTP ${response.status} ${contentType || "<missing>"} ${finalUrl}`;
      const assessment = assessResponse({ status: response.status, contentType, finalUrl });
      if (assessment.ok) return { ok: true, detail };
      if (response.status < 429 && response.status !== 408) break;
    } catch (error) {
      detail = error instanceof Error ? error.message : "request failed";
    }
    if (attempt === 1) await new Promise((resolve) => setTimeout(resolve, 750));
  }
  return { ok: false, detail };
}

function assessResponse({ status, contentType, finalUrl }) {
  if (status < 200 || status >= 300) return { ok: false };
  try { parsePublicHttpsUrl(finalUrl); } catch { return { ok: false }; }
  if (!/^(?:text\/html|text\/plain|application\/pdf|application\/xhtml\+xml)(?:;|$)/i.test(contentType)) {
    return { ok: false };
  }
  return { ok: true };
}
