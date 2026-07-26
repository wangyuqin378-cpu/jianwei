import { createHash } from "node:crypto";

const INSTALLATION_BINDING_DOMAIN = "jianwei-installation-binding-v1\0";
const DEVICE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DEVICE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export interface ValidatedRegistrationResponse {
  deviceId: string;
  deviceToken: string;
  installationBindingSha256: string;
  created: boolean;
}

export function installationBindingSha256(installationId: string): string {
  return createHash("sha256")
    .update(INSTALLATION_BINDING_DOMAIN, "utf8")
    .update(installationId, "utf8")
    .digest("hex");
}

export function validateRegistrationResponse(
  installationId: string,
  body: Record<string, unknown>
): ValidatedRegistrationResponse {
  const expectedBinding = installationBindingSha256(installationId);
  if (
    typeof body.deviceId !== "string" ||
    !DEVICE_ID_PATTERN.test(body.deviceId) ||
    typeof body.deviceToken !== "string" ||
    !DEVICE_TOKEN_PATTERN.test(body.deviceToken) ||
    typeof body.installationBindingSha256 !== "string" ||
    !SHA256_PATTERN.test(body.installationBindingSha256) ||
    body.installationBindingSha256 !== expectedBinding ||
    typeof body.created !== "boolean"
  ) {
    throw new Error("Cloud registration response is invalid or crossed the installation boundary");
  }
  return {
    deviceId: body.deviceId,
    deviceToken: body.deviceToken,
    installationBindingSha256: body.installationBindingSha256,
    created: body.created
  };
}
