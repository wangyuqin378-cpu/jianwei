import { describe, expect, it, vi } from "vitest";
import {
  parseGuardrailAccessArguments,
  probeQwenGuardrailAccess
} from "./verify-qwen-guardrail-access.js";

describe("Qwen AI Safety Guardrails access preflight", () => {
  it("accepts pnpm separators and requires only the downloaded credential CSV", () => {
    expect(parseGuardrailAccessArguments([
      "--", "--credentials-file", "/private/workspace.csv"
    ])).toEqual({ credentialsFile: "/private/workspace.csv" });
    expect(() => parseGuardrailAccessArguments([])).toThrow(/credentials-file/);
    expect(() => parseGuardrailAccessArguments(["--image", "private.jpg"]))
      .toThrow(/Unknown argument/);
  });

  it("uses the production inspection header without sending image bytes", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
      expect(new Headers(init?.headers).get("X-DashScope-DataInspection"))
        .toBe('{"input":"cip","output":"cip"}');
      expect(body.messages[0]?.content).toContain("ok");
      expect(String(init?.body)).not.toContain("image_url");
      return new Response(JSON.stringify({ choices: [] }), { status: 200 });
    });

    await expect(probeQwenGuardrailAccess({
      apiKey: `sk-ws${"a".repeat(80)}`,
      baseUrl: "https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
      model: "fixed-qwen",
      fetchImpl: fetchImpl as typeof fetch
    })).resolves.toEqual({ guardrailAccess: "GO", status: 200, code: null });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("reports missing workspace authorization without leaking upstream messages", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      error: {
        code: "access_denied",
        message: "sensitive upstream detail"
      }
    }), { status: 403 }));

    await expect(probeQwenGuardrailAccess({
      apiKey: `sk-ws${"b".repeat(80)}`,
      baseUrl: "https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
      model: "fixed-qwen",
      fetchImpl: fetchImpl as typeof fetch
    })).resolves.toEqual({
      guardrailAccess: "NO_GO",
      status: 403,
      code: "access_denied"
    });
  });

  it("redacts transport failures that may contain the private workspace URL", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("connect failed: https://private-workspace.example/compatible-mode/v1");
    });

    await expect(probeQwenGuardrailAccess({
      apiKey: `sk-ws${"c".repeat(80)}`,
      baseUrl: "https://private-workspace.example/compatible-mode/v1",
      model: "fixed-qwen",
      fetchImpl: fetchImpl as typeof fetch
    })).resolves.toEqual({
      guardrailAccess: "NO_GO",
      status: 0,
      code: "transport_error"
    });
  });
});
