import { describe, expect, it } from "vitest";
import { installationBindingSha256, validateRegistrationResponse } from "./registration-binding.js";

const INSTALLATION_ID = "00000000-0000-4000-8000-000000000001";
const DEVICE_ID = "10000000-0000-4000-8000-000000000001";
const TOKEN = "A".repeat(43);
const EXPECTED_BINDING = "12ac0636afd3b4cd29a7a645eb2c234d52bf7e9f574c596c6e83fe37797a8c73";

describe("registration response binding", () => {
  it("matches the Android cross-language fixed vector", () => {
    expect(installationBindingSha256(INSTALLATION_ID)).toBe(EXPECTED_BINDING);
  });

  it("accepts only a canonical identity bound to the submitted installation", () => {
    const valid = {
      deviceId: DEVICE_ID,
      deviceToken: TOKEN,
      installationBindingSha256: EXPECTED_BINDING,
      created: true
    };
    expect(validateRegistrationResponse(INSTALLATION_ID, valid)).toEqual(valid);
    for (const body of [
      { ...valid, deviceId: "device" },
      { ...valid, deviceToken: "short" },
      { ...valid, installationBindingSha256: "f".repeat(64) },
      { ...valid, created: "true" }
    ]) {
      expect(() => validateRegistrationResponse(INSTALLATION_ID, body)).toThrow(/installation boundary/);
    }
  });
});
