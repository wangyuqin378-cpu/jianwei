import { lookup as dnsLookup } from "node:dns/promises";
import https from "node:https";
import { isIP } from "node:net";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export async function requestPublicHttpsMetadata(value, {
  headers = {},
  timeoutMs = 15_000,
  maxRedirects = 5,
  resolveHost = defaultResolveHost,
  requestOnce = defaultRequestOnce
} = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000 ||
      !Number.isInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 8) {
    throw new Error("Safe source request limits are invalid");
  }
  let current = parsePublicHttpsUrl(value);
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const hostname = hostnameWithoutIpv6Brackets(current.hostname);
    const addresses = await resolveHost(hostname);
    if (!Array.isArray(addresses) || addresses.length === 0 ||
        addresses.some((entry) => !entry || !isPublicIpAddress(entry.address) ||
          (entry.family !== 4 && entry.family !== 6) || entry.family !== isIP(entry.address))) {
      throw new Error("Source hostname did not resolve exclusively to public IP addresses");
    }
    const response = await requestOnce(current, addresses[0], { headers, timeoutMs, hostname });
    if (!REDIRECT_STATUSES.has(response.status)) {
      return {
        status: response.status,
        contentType: response.contentType ?? "",
        finalUrl: current.toString()
      };
    }
    if (redirectCount === maxRedirects || typeof response.location !== "string" || !response.location.trim()) {
      throw new Error("Source redirect chain is missing a location or exceeds the limit");
    }
    current = parsePublicHttpsUrl(new URL(response.location, current).toString());
  }
  throw new Error("Source redirect chain exceeds the limit");
}

export function parsePublicHttpsUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("Source URL is invalid"); }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) {
    throw new Error("Source URL must be credential-free HTTPS on port 443");
  }
  const parsedHostname = url.hostname.toLowerCase().replace(/\.$/, "");
  const hostname = hostnameWithoutIpv6Brackets(parsedHostname);
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") ||
      (isIP(hostname) && !isPublicIpAddress(hostname))) {
    throw new Error("Source URL must not target a private, local, or reserved address");
  }
  url.hostname = isIP(hostname) === 6 ? `[${hostname}]` : hostname;
  url.hash = "";
  return url;
}

export function isPublicIpAddress(address) {
  const version = isIP(address);
  if (version === 4) {
    const [a, b, c] = address.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
        (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
        (a === 203 && b === 0 && c === 113)) return false;
    return true;
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    const first = Number.parseInt(normalized.split(":", 1)[0], 16);
    return Number.isInteger(first) && first >= 0x2000 && first <= 0x3fff &&
      !normalized.startsWith("2001:db8:");
  }
  return false;
}

async function defaultResolveHost(hostname) {
  return dnsLookup(hostname, { all: true, verbatim: true });
}

function defaultRequestOnce(url, address, { headers, timeoutMs, hostname }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = https.request({
      protocol: "https:",
      hostname,
      port: 443,
      method: "GET",
      path: `${url.pathname}${url.search}`,
      headers,
      servername: isIP(hostname) ? undefined : hostname,
      timeout: timeoutMs,
      lookup(_hostname, options, callback) {
        if (options && typeof options === "object" && options.all === true) {
          callback(null, [{ address: address.address, family: address.family }]);
        } else {
          callback(null, address.address, address.family);
        }
      }
    }, (response) => {
      if (settled) return;
      settled = true;
      const result = {
        status: response.statusCode ?? 0,
        contentType: String(response.headers["content-type"] ?? ""),
        location: typeof response.headers.location === "string" ? response.headers.location : null
      };
      response.destroy();
      resolve(result);
    });
    request.once("timeout", () => request.destroy(new Error("Source request timed out")));
    request.once("error", (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    request.end();
  });
}

function hostnameWithoutIpv6Brackets(hostname) {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}
