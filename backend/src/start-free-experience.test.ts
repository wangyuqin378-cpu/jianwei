import { describe, expect, it } from "vitest";
import { freeExperienceEnvironment, parseExperienceArguments } from "./start-free-experience.js";

describe("free experience arguments", () => {
  it("uses loopback for a local-only experience", () => {
    expect(parseExperienceArguments(["--credentials-file", "/tmp/credentials.csv"])).toMatchObject({
      host: "127.0.0.1",
      port: 8787,
      publicBaseUrl: "http://127.0.0.1:8787"
    });
  });

  it("accepts an explicit LAN-only phone experience", () => {
    expect(parseExperienceArguments([
      "--credentials-file", "/tmp/credentials.csv",
      "--host", "0.0.0.0",
      "--public-base-url", "http://wyqdeMacBook-Air.local:8787"
    ])).toMatchObject({
      host: "0.0.0.0",
      publicBaseUrl: "http://wyqdemacbook-air.local:8787"
    });
  });

  it("accepts an RFC1918 address for a LAN-only phone experience", () => {
    expect(parseExperienceArguments([
      "--credentials-file", "/tmp/credentials.csv",
      "--host", "0.0.0.0",
      "--public-base-url", "http://192.168.1.3:8787"
    ])).toMatchObject({
      host: "0.0.0.0",
      publicBaseUrl: "http://192.168.1.3:8787"
    });
  });

  it("accepts an origin-only HTTPS address for phone testing", () => {
    expect(parseExperienceArguments([
      "--credentials-file", "/tmp/credentials.csv",
      "--public-base-url", "https://beta.example.com"
    ]).publicBaseUrl).toBe("https://beta.example.com");
  });

  it("keeps automatic selection at three in the app without capping manual Beta trials at three", () => {
    const environment = freeExperienceEnvironment({
      apiKey: `sk-ws${"a".repeat(80)}`,
      openAiCompatible: "https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"
    }, 8787, "/tmp/jianwei");

    expect(environment.MAX_JOBS_PER_DEVICE_PER_DAY).toBe("30");
    expect(environment.MAX_JOBS_GLOBAL_PER_DAY).toBe("30");
    expect(environment.MAX_GLOBAL_COST_MICRO_CNY_PER_DAY).toBe("600000");
    expect(environment.MAX_JOBS_PER_DEVICE_PER_MONTH).toBe("93");
    expect(environment.MAX_GLOBAL_COST_MICRO_CNY_PER_MONTH).toBe("10000000");
  });

  it.each([
    "http://beta.example.com",
    "http://8.8.8.8:8787",
    "http://172.32.0.8:8787",
    "https://beta.example.com/api",
    "https://user:password@beta.example.com"
  ])("rejects an unsafe public address: %s", (publicBaseUrl) => {
    expect(() => parseExperienceArguments([
      "--credentials-file", "/tmp/credentials.csv",
      "--public-base-url", publicBaseUrl
    ])).toThrow("--public-base-url");
  });
});
