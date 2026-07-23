import { describe, expect, it } from "vitest";
import { isSafeKnowledgeSourceUrl } from "./source-url.js";

describe("knowledge source URL policy", () => {
  it.each([
    "https://example.com/fact",
    "https://www.who.int/news-room/fact-sheets/detail/test?lang=en#source",
    "https://example.com:443/reference"
  ])("accepts public HTTPS source %s", (url) => {
    expect(isSafeKnowledgeSourceUrl(url)).toBe(true);
  });

  it.each([
    "http://example.com/fact",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "intent://scan/#Intent;scheme=zxing;end",
    "https://user:password@example.com/fact",
    "https://localhost/fact",
    "https://api.internal/fact",
    "https://router.local/fact",
    "https://127.0.0.1/fact",
    "https://10.0.0.1/fact",
    "https://192.168.1.10/fact",
    "https://[::1]/fact",
    "https://example.com:8443/fact",
    "https://example/fact",
    "https:\\example.com\\fact"
  ])("rejects unsafe source %s", (url) => {
    expect(isSafeKnowledgeSourceUrl(url)).toBe(false);
  });
});
