import { isIP } from "node:net";

const PRIVATE_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".lan",
  ".home"
] as const;

/**
 * Sources are opened by the Android client, so the catalog must contain only
 * conventional public HTTPS web links. Direct IP addresses and local network
 * names are deliberately rejected to avoid turning a card into an SSRF/deep-link
 * bridge when the same catalog is consumed by other clients.
 */
export function isSafeKnowledgeSourceUrl(value: string): boolean {
  if (value.length < 1 || value.length > 2_048) return false;
  if (!/^https:\/\//i.test(value)) return false;
  if (/[\\\u0000-\u001f\u007f]/u.test(value)) return false;

  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname
      .toLowerCase()
      .replace(/^\[/u, "")
      .replace(/\]$/u, "")
      .replace(/\.$/u, "");

    if (parsed.protocol !== "https:") return false;
    if (parsed.username || parsed.password) return false;
    if (parsed.port && parsed.port !== "443") return false;
    if (!hostname.includes(".")) return false;
    if (hostname === "localhost" || PRIVATE_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
      return false;
    }
    if (isIP(hostname) !== 0 || /^\d+(?:\.\d+)*$/u.test(hostname)) return false;

    return true;
  } catch {
    return false;
  }
}
