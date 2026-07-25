export interface BailianCredentials {
  apiKey: string;
  openAiCompatible: string;
}

export function parseBailianCredentialsCsv(source: string): BailianCredentials {
  const rows = new Map<string, string>();
  for (const [index, rawLine] of source.split(/\r?\n/).entries()) {
    if (!rawLine.trim()) continue;
    const comma = rawLine.indexOf(",");
    if (comma <= 0) throw new Error(`Invalid credential CSV row ${index + 1}`);
    const key = unquote(rawLine.slice(0, comma).replace(/^\uFEFF/, "").trim());
    const value = unquote(rawLine.slice(comma + 1).trim());
    rows.set(key, value);
  }
  const apiKey = rows.get("apiKey")?.trim() ?? "";
  const openAiCompatible = rows.get("openAiCompatible")?.trim() ?? "";
  if (!apiKey.startsWith("sk-ws") || apiKey.length < 40) {
    throw new Error("Credential CSV does not contain a Model Studio pay-as-you-go API key");
  }
  if (!openAiCompatible) throw new Error("Credential CSV does not contain an OpenAI-compatible endpoint");
  return { apiKey, openAiCompatible };
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith("\"") && value.endsWith("\"")) {
    return value.slice(1, -1).replace(/""/g, "\"");
  }
  return value;
}
