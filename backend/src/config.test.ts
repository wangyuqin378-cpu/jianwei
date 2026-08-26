import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("configuration safety", () => {
  it("keeps unattested facts disabled by default", () => {
    expect(loadConfig({}).allowUnattestedFacts).toBe(false);
  });

  it("refuses the development content escape hatch with OSS storage", () => {
    expect(() => loadConfig({ OBJECT_STORE: "oss", ALLOW_UNATTESTED_FACTS: "true" })).toThrow(
      /cannot be enabled with OSS/
    );
  });

  it("loads finite global cost fuses and rejects invalid overrides", () => {
    const config = loadConfig({});
    expect(config.maxJobsGlobalPerDay).toBe(2000);
    expect(config.maxJobsGlobalPerMonth).toBe(50000);
    expect(() => loadConfig({ MAX_JOBS_GLOBAL_PER_DAY: "0" })).toThrow(/MAX_JOBS_GLOBAL_PER_DAY/);
    expect(() => loadConfig({ MAX_JOBS_GLOBAL_PER_MONTH: "Infinity" })).toThrow(/MAX_JOBS_GLOBAL_PER_MONTH/);
    expect(() => loadConfig({ WORST_CASE_COST_MICRO_CNY_PER_JOB: "0" })).toThrow(/WORST_CASE_COST/);
    expect(() => loadConfig({ MAX_GLOBAL_COST_MICRO_CNY_PER_DAY: "Infinity" })).toThrow(/MAX_GLOBAL_COST/);
  });

  it("requires explicit worst-case money reservations for Qwen", () => {
    expect(() => loadConfig({ VISION_PROVIDER: "qwen" })).toThrow(/WORST_CASE_COST_MICRO_CNY_PER_JOB/);
    const config = loadConfig({
      VISION_PROVIDER: "qwen",
      WORST_CASE_COST_MICRO_CNY_PER_JOB: "25000",
      MAX_GLOBAL_COST_MICRO_CNY_PER_DAY: "2500000",
      MAX_GLOBAL_COST_MICRO_CNY_PER_MONTH: "50000000"
    });
    expect(config.worstCaseCostMicroCnyPerJob).toBe(25000);
    expect(config.maxGlobalCostMicroCnyPerDay).toBe(2500000);
  });

  it("separates local Kimi Code validation from production Kimi Open Platform", () => {
    expect(loadConfig({}).kimiBaseUrl).toBe("https://api.moonshot.cn/v1");
    expect(loadConfig({ KIMI_BASE_URL: "https://api.kimi.com/coding/v1/" }).kimiBaseUrl)
      .toBe("https://api.kimi.com/coding/v1");
    for (const endpoint of [
      "http://api.moonshot.cn/v1",
      "https://attacker.example/v1",
      "https://user:password@api.moonshot.cn/v1",
      "https://api.moonshot.cn/v1?redirect=1",
      "https://api.kimi.com/arbitrary"
    ]) {
      expect(() => loadConfig({ KIMI_BASE_URL: endpoint })).toThrow(/KIMI_BASE_URL/);
    }
    const production = {
      ...productionEnv(),
      VISION_PROVIDER: "kimi",
      DASHSCOPE_API_KEY: "",
      KIMI_API_KEY: "test-kimi-key",
      KIMI_BASE_URL: "https://api.moonshot.cn/v1",
      KIMI_MODEL: "kimi-k3"
    };
    expect(loadConfig(production).visionProvider).toBe("kimi");
    expect(() => loadConfig({
      ...production,
      KIMI_BASE_URL: "https://api.kimi.com/coding/v1",
      KIMI_MODEL: "k3"
    })).toThrow(/China Kimi Open Platform/);
    expect(() => loadConfig({ ...production, KIMI_API_KEY: "" })).toThrow(/KIMI_API_KEY/);
  });

  it("allows only the Beijing Model Studio compatible endpoint", () => {
    expect(loadConfig({}).dashscopeBaseUrl).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1");
    expect(loadConfig({
      DASHSCOPE_BASE_URL: "https://workspace-123.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/"
    }).dashscopeBaseUrl).toBe("https://workspace-123.cn-beijing.maas.aliyuncs.com/compatible-mode/v1");
    for (const endpoint of [
      "http://dashscope.aliyuncs.com/compatible-mode/v1",
      "https://attacker.example/compatible-mode/v1",
      "https://dashscope-us.aliyuncs.com/compatible-mode/v1",
      "https://user:password@dashscope.aliyuncs.com/compatible-mode/v1",
      "https://dashscope.aliyuncs.com/compatible-mode/v1?redirect=1",
      "https://dashscope.aliyuncs.com/arbitrary"
    ]) {
      expect(() => loadConfig({ DASHSCOPE_BASE_URL: endpoint })).toThrow(/DASHSCOPE_BASE_URL/);
    }
  });

  it("rejects unknown provider values instead of silently falling back to local mode", () => {
    expect(() => loadConfig({ VISION_PROVIDER: "qwne" })).toThrow(/VISION_PROVIDER/);
    expect(() => loadConfig({ OBJECT_STORE: "s3" })).toThrow(/OBJECT_STORE/);
    expect(() => loadConfig({ NODE_ENV: "prod" })).toThrow(/NODE_ENV/);
  });

  it("fails closed unless production uses the durable private stack", () => {
    const production = productionEnv();
    const config = loadConfig(production);
    expect(config.environment).toBe("production");
    const aiOnly = { ...production };
    delete aiOnly.KNOWLEDGE_REVIEWER_IDS;
    expect(loadConfig(aiOnly).knowledgeReviewerIds).toEqual([]);
    expect(config.databaseUrl).toMatch(/^postgres/);
    expect(config.objectStore).toBe("oss");
    expect(config.visionProvider).toBe("qwen");
    expect(config.containerImageDigest).toBe(`sha256:${"b".repeat(64)}`);
    expect(config.deploymentArtifactKind).toBe("container");
    expect(config.deploymentArtifactDigest).toBe(`sha256:${"b".repeat(64)}`);
    expect(() => loadConfig({ ...production, DATABASE_URL: "" })).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ ...production, OBJECT_STORE: "local" })).toThrow(/OBJECT_STORE must be oss/);
    expect(() => loadConfig({ ...production, VISION_PROVIDER: "local" })).toThrow(/VISION_PROVIDER must be qwen/);
    expect(() => loadConfig({ ...production, PUBLIC_BASE_URL: "http://api.example.test" })).toThrow(/HTTPS/);
    expect(() => loadConfig({ ...production, DASHSCOPE_BASE_URL: "" })).toThrow(/DASHSCOPE_BASE_URL/);
    expect(() => loadConfig({ ...production, OBJECT_TTL_HOURS: "25" })).toThrow(/must not exceed 24/);
    expect(() => loadConfig({ ...production, CONTAINER_IMAGE_DIGEST: "sha256:not-a-digest" })).toThrow(
      /CONTAINER_IMAGE_DIGEST/
    );
    expect(() => loadConfig({ ...production, CONTAINER_IMAGE_DIGEST: "" })).toThrow(/CONTAINER_IMAGE_DIGEST/);
  });

  it("supports a production-hardened TestFlight backend deployed as an FC code package", () => {
    const beta = {
      ...productionEnv(),
      RELEASE_CHANNEL: "beta",
      APP_STORE_ENVIRONMENT: "sandbox",
      APP_STORE_APP_APPLE_ID: "",
      DEPLOYMENT_ARTIFACT_KIND: "code-package",
      DEPLOYMENT_ARTIFACT_DIGEST: `sha256:${"c".repeat(64)}`,
      CONTAINER_IMAGE_DIGEST: ""
    };
    const config = loadConfig(beta);
    expect(config.environment).toBe("production");
    expect(config.releaseChannel).toBe("beta");
    expect(config.appStoreEnvironment).toBe("sandbox");
    expect(config.appStoreAppAppleId).toBeNull();
    expect(config.deploymentArtifactKind).toBe("code-package");
    expect(config.deploymentArtifactDigest).toBe(`sha256:${"c".repeat(64)}`);
    expect(config.containerImageDigest).toBeNull();

    expect(() => loadConfig({ ...beta, APP_STORE_ENVIRONMENT: "production" })).toThrow(/sandbox/);
    expect(() => loadConfig({ ...beta, DEPLOYMENT_ARTIFACT_DIGEST: "" })).toThrow(/DEPLOYMENT_ARTIFACT_DIGEST/);
    expect(() => loadConfig({ ...productionEnv(), APP_STORE_ENVIRONMENT: "sandbox" })).toThrow(
      /production release channel/
    );
  });

  it("requires a complete temporary STS credential set in production", () => {
    const production = productionEnv();
    expect(() => loadConfig({ ...production, ALIBABA_CLOUD_SECURITY_TOKEN: "" })).toThrow(
      /role credentials must include access key ID, secret, and security token/
    );
    expect(() => loadConfig({
      ...production,
      ALIBABA_CLOUD_ACCESS_KEY_ID: "",
      ALIBABA_CLOUD_ACCESS_KEY_SECRET: "",
      ALIBABA_CLOUD_SECURITY_TOKEN: "",
      OSS_ACCESS_KEY_ID: "long-lived-id",
      OSS_ACCESS_KEY_SECRET: "long-lived-secret"
    })).toThrow(/Complete temporary OSS STS credentials/);

    const fallbackSts = loadConfig({
      ...production,
      ALIBABA_CLOUD_ACCESS_KEY_ID: "",
      ALIBABA_CLOUD_ACCESS_KEY_SECRET: "",
      ALIBABA_CLOUD_SECURITY_TOKEN: "",
      OSS_ACCESS_KEY_ID: "temporary-id",
      OSS_ACCESS_KEY_SECRET: "temporary-secret",
      OSS_SECURITY_TOKEN: "temporary-token"
    });
    expect(fallbackSts.ossSecurityToken).toBe("temporary-token");
  });

  it("prefers complete Function Compute role credentials and rejects partial STS injection", () => {
    const config = loadConfig({
      ALIBABA_CLOUD_ACCESS_KEY_ID: "role-id",
      ALIBABA_CLOUD_ACCESS_KEY_SECRET: "role-secret",
      ALIBABA_CLOUD_SECURITY_TOKEN: "role-token",
      OSS_ACCESS_KEY_ID: "fallback-id",
      OSS_ACCESS_KEY_SECRET: "fallback-secret"
    });
    expect(config.ossAccessKeyId).toBe("role-id");
    expect(config.ossAccessKeySecret).toBe("role-secret");
    expect(config.ossSecurityToken).toBe("role-token");
    expect(() => loadConfig({
      ALIBABA_CLOUD_ACCESS_KEY_ID: "partial-id",
      ALIBABA_CLOUD_ACCESS_KEY_SECRET: "partial-secret"
    })).toThrow(/role credentials/);
  });
});

function productionEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    PUBLIC_BASE_URL: "https://api.example.test",
    DATABASE_URL: "postgresql://app:password@db.example.test/jianwei",
    OBJECT_STORE: "oss",
    VISION_PROVIDER: "qwen",
    DASHSCOPE_API_KEY: "test-model-key",
    DASHSCOPE_BASE_URL: "https://workspace-123.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
    OSS_BUCKET: "test-bucket",
    ALIBABA_CLOUD_ACCESS_KEY_ID: "test-role-id",
    ALIBABA_CLOUD_ACCESS_KEY_SECRET: "test-role-secret",
    ALIBABA_CLOUD_SECURITY_TOKEN: "test-role-token",
    WORST_CASE_COST_MICRO_CNY_PER_JOB: "25000",
    MAX_GLOBAL_COST_MICRO_CNY_PER_DAY: "2500000",
    MAX_GLOBAL_COST_MICRO_CNY_PER_MONTH: "50000000",
    OBJECT_TTL_HOURS: "24",
    KNOWLEDGE_CATALOG_SHA256: "a".repeat(64),
    KNOWLEDGE_REVIEWER_IDS: "human-editor-01",
    CONTAINER_IMAGE_DIGEST: `sha256:${"b".repeat(64)}`,
    APP_STORE_BUNDLE_ID: "cn.jianwei.ios",
    APP_STORE_APP_APPLE_ID: "1234567890",
    APP_STORE_SUBSCRIPTION_PRODUCT_ID: "cn.jianwei.ios.pro.monthly",
    APP_STORE_ENVIRONMENT: "production",
    APP_STORE_ROOT_CERTIFICATE_PATHS: "/run/secrets/apple-root-ca-g3.cer"
  };
}
