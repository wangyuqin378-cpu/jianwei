import { describe, expect, it } from "vitest";
import { parseExperienceArguments } from "./start-free-experience.js";

describe("free experience arguments", () => {
  it("uses loopback for a local-only experience", () => {
    expect(parseExperienceArguments(["--credentials-file", "/tmp/credentials.csv"])).toMatchObject({
      port: 8787,
      publicBaseUrl: "http://127.0.0.1:8787"
    });
  });

  it("accepts an origin-only HTTPS address for phone testing", () => {
    expect(parseExperienceArguments([
      "--credentials-file", "/tmp/credentials.csv",
      "--public-base-url", "https://beta.example.com"
    ]).publicBaseUrl).toBe("https://beta.example.com");
  });

  it.each([
    "http://beta.example.com",
    "https://beta.example.com/api",
    "https://user:password@beta.example.com"
  ])("rejects an unsafe public address: %s", (publicBaseUrl) => {
    expect(() => parseExperienceArguments([
      "--credentials-file", "/tmp/credentials.csv",
      "--public-base-url", publicBaseUrl
    ])).toThrow("--public-base-url");
  });
});
