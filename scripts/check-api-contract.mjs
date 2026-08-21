import { readFile } from "node:fs/promises";

const methods = new Set(["get", "post", "put", "delete"]);

export function assessApiContract(input) {
  const failures = [];
  let contract;
  try {
    contract = JSON.parse(input.openapi);
  } catch {
    return { status: "NO_GO", metrics: {}, blockers: ["OpenAPI document is not valid JSON"] };
  }
  if (contract.openapi !== "3.1.0") failures.push("OpenAPI version must be 3.1.0");
  const operations = contractOperations(contract);
  const server = serverOperations(input.server);
  compareSets("server route", server, new Set(operations.keys()), failures);

  const expectedRetrofit = new Set([...operations].filter(([, value]) => value["x-android-client"] === "retrofit").map(([key]) => key));
  const retrofit = retrofitOperations(input.androidApi);
  compareSets("Retrofit route", retrofit, expectedRetrofit, failures);

  const rawOperations = [...operations].filter(([, value]) => value["x-android-client"] === "raw");
  if (rawOperations.length !== 1 || rawOperations[0][0] !== "PUT /v1/analysis-jobs/{id}/image") {
    failures.push("OpenAPI must declare exactly one Android raw upload operation");
  }
  const rawUpload = operations.get("PUT /v1/analysis-jobs/{id}/image");
  const rawUploadResponseRef = rawUpload?.responses?.["200"]?.content?.["application/json"]?.schema?.$ref;
  if (rawUploadResponseRef !== "#/components/schemas/UploadJobResponse") {
    failures.push("raw upload success response must use UploadJobResponse");
  }
  const rawUploadSchema = contract.components?.schemas?.UploadJobResponse;
  if (!rawUploadSchema || rawUploadSchema.additionalProperties !== false) {
    failures.push("UploadJobResponse must be a strict object");
  } else {
    compareSets(
      "UploadJobResponse required field",
      new Set(rawUploadSchema.required ?? []),
      new Set(["jobId", "candidateToken", "uploadSessionId", "status"]),
      failures
    );
    if (rawUploadSchema.properties?.status?.const !== "uploaded") {
      failures.push("UploadJobResponse status must be uploaded");
    }
  }
  const registerResponseSchema = contract.components?.schemas?.RegisterResponse;
  const registerToken = registerResponseSchema?.properties?.deviceToken;
  const registerBinding = registerResponseSchema?.properties?.installationBindingSha256;
  if (
    !registerResponseSchema || registerResponseSchema.additionalProperties !== false ||
    !new Set(registerResponseSchema.required ?? []).has("installationBindingSha256") ||
    registerToken?.minLength !== 43 || registerToken?.maxLength !== 43 ||
    registerToken?.pattern !== "^[A-Za-z0-9_-]{43}$" ||
    registerBinding?.pattern !== "^[a-f0-9]{64}$"
  ) {
    failures.push("RegisterResponse must bind a strict bearer identity to the submitted installation");
  }
  const jobStatusOperation = operations.get("GET /v1/analysis-jobs/{id}");
  const jobStatusRef = jobStatusOperation?.responses?.["200"]?.content?.["application/json"]?.schema?.$ref;
  const jobStatusSchema = contract.components?.schemas?.JobStatusResponse;
  if (jobStatusRef !== "#/components/schemas/JobStatusResponse") {
    failures.push("GET analysis job success response must use JobStatusResponse");
  }
  if (!jobStatusSchema || jobStatusSchema.additionalProperties !== false) {
    failures.push("JobStatusResponse must be a strict object");
  } else {
    compareSets(
      "JobStatusResponse required field",
      new Set(jobStatusSchema.required ?? []),
      new Set(["jobId", "candidateToken", "status", "errorCode", "createdAt", "updatedAt"]),
      failures
    );
    compareSets(
      "JobStatusResponse status",
      new Set(jobStatusSchema.properties?.status?.enum ?? []),
      new Set(["awaiting_upload", "uploading", "uploaded", "processing", "completed", "needs_content", "rejected", "failed"]),
      failures
    );
  }
  const trackOperation = operations.get("POST /v1/items/{cardId}/track");
  const untrackOperation = operations.get("DELETE /v1/items/{cardId}/track");
  const deleteDeviceOperation = operations.get("DELETE /v1/device-data");
  const trackSchema = contract.components?.schemas?.TrackItemResponse;
  const untrackSchema = contract.components?.schemas?.UntrackItemResponse;
  const deleteDeviceSchema = contract.components?.schemas?.DeleteDeviceDataResponse;
  if (
    trackOperation?.responses?.["201"]?.content?.["application/json"]?.schema?.$ref !==
      "#/components/schemas/TrackItemResponse" ||
    !trackSchema || trackSchema.additionalProperties !== false ||
    Object.hasOwn(trackSchema.properties ?? {}, "deviceId")
  ) {
    failures.push("track success must return a strict minimal TrackItemResponse");
  }
  if (
    untrackOperation?.responses?.["200"]?.content?.["application/json"]?.schema?.$ref !==
      "#/components/schemas/UntrackItemResponse" ||
    !untrackSchema || untrackSchema.additionalProperties !== false ||
    untrackSchema.properties?.status?.const !== "untracked"
  ) {
    failures.push("untrack success must return a strict bound UntrackItemResponse");
  }
  if (
    deleteDeviceOperation?.responses?.["200"]?.content?.["application/json"]?.schema?.$ref !==
      "#/components/schemas/DeleteDeviceDataResponse" ||
    !deleteDeviceSchema || deleteDeviceSchema.additionalProperties !== false ||
    deleteDeviceSchema.properties?.deviceId?.format !== "uuid" ||
    deleteDeviceSchema.properties?.status?.const !== "deleted"
  ) {
    failures.push("device deletion success must return a strict bound DeleteDeviceDataResponse");
  } else {
    compareSets(
      "DeleteDeviceDataResponse required field",
      new Set(deleteDeviceSchema.required ?? []),
      new Set(["deviceId", "status"]),
      failures
    );
  }
  const cardsSchema = contract.components?.schemas?.CardsResponse;
  if (!cardsSchema || cardsSchema.additionalProperties !== false) {
    failures.push("CardsResponse must be a strict object");
  } else {
    compareSets(
      "CardsResponse required field",
      new Set(cardsSchema.required ?? []),
      new Set(["items", "nextCursor"]),
      failures
    );
    if (
      cardsSchema.properties?.items?.type !== "array" ||
      cardsSchema.properties?.items?.maxItems !== 50 ||
      cardsSchema.properties?.nextCursor?.format !== "uuid"
    ) {
      failures.push("CardsResponse must bind a bounded page to a UUID cursor");
    }
  }
  const cardSchema = contract.components?.schemas?.Card;
  const boundingBoxSchema = contract.components?.schemas?.BoundingBox;
  const cardBoundingBox = cardSchema?.properties?.boundingBox;
  if (
    !cardSchema || cardSchema.additionalProperties !== false ||
    Object.hasOwn(cardSchema.properties ?? {}, "deviceId") ||
    cardSchema.properties?.status?.enum?.length !== 3 ||
    cardSchema.properties?.body?.maxLength !== 240 ||
    !new Set(cardSchema.required ?? []).has("boundingBox") ||
    !Array.isArray(cardBoundingBox?.oneOf) ||
    cardBoundingBox.oneOf[0]?.$ref !== "#/components/schemas/BoundingBox" ||
    cardBoundingBox.oneOf[1]?.type !== "null"
  ) {
    failures.push("Card must be a strict bounded public response without internal device identity");
  }
  if (
    !boundingBoxSchema || boundingBoxSchema.additionalProperties !== false ||
    !["x", "y", "width", "height"].every((field) =>
      new Set(boundingBoxSchema.required ?? []).has(field) &&
      boundingBoxSchema.properties?.[field]?.type === "number"
    ) ||
    boundingBoxSchema.properties?.x?.minimum !== 0 ||
    boundingBoxSchema.properties?.y?.minimum !== 0 ||
    boundingBoxSchema.properties?.width?.exclusiveMinimum !== 0 ||
    boundingBoxSchema.properties?.height?.exclusiveMinimum !== 0
  ) {
    failures.push("BoundingBox must be a strict normalized object");
  }
  for (const marker of [".put(", "isAllowedUploadUrl", "isExpectedApiUploadPath", "PermissionCheckedRequestBody"]) {
    if (!input.remoteAnalysis.includes(marker)) failures.push(`raw upload client is missing: ${marker}`);
  }

  const kotlinModels = parseKotlinModels(input.androidApi);
  const zodModels = parseZodModels(input.schemas);
  let comparedModels = 0;
  for (const operation of operations.values()) {
    for (const extension of ["x-android-request-model", "x-android-response-model"]) {
      const model = operation[extension];
      if (!model) continue;
      const schema = contract.components?.schemas?.[model];
      const fields = kotlinModels.get(model);
      if (!schema || !fields) {
        failures.push(`missing Android/OpenAPI model: ${model}`);
        continue;
      }
      compareSets(`${model} field`, fields, new Set(Object.keys(schema.properties ?? {})), failures);
      comparedModels += 1;
    }
    const zodName = operation["x-backend-zod-schema"];
    const requestModel = operation["x-android-request-model"];
    if (zodName && requestModel) {
      const schemaFields = new Set(Object.keys(contract.components?.schemas?.[requestModel]?.properties ?? {}));
      const zodFields = zodModels.get(zodName);
      if (!zodFields) failures.push(`missing backend Zod schema: ${zodName}`);
      else compareSets(`${zodName} field`, zodFields, schemaFields, failures);
    }
  }
  for (const operation of operations.values()) {
    if (!operation.operationId) failures.push("every OpenAPI operation must have operationId");
    if (!operation.responses || Object.keys(operation.responses).length === 0) failures.push(`operation has no responses: ${operation.operationId}`);
  }

  return {
    status: failures.length === 0 ? "GO" : "NO_GO",
    metrics: {
      serverOperations: server.size,
      retrofitOperations: retrofit.size,
      rawAndroidOperations: rawOperations.length,
      comparedModels
    },
    blockers: [...new Set(failures)]
  };
}

const files = {
  openapi: await readFile("api/openapi.json", "utf8"),
  server: await readFile("backend/src/server.ts", "utf8"),
  schemas: await readFile("backend/src/domain/schemas.ts", "utf8"),
  androidApi: await readFile("android/data/src/main/kotlin/cn/jianwei/data/network/JianweiApi.kt", "utf8"),
  remoteAnalysis: await readFile("android/data/src/main/kotlin/cn/jianwei/data/network/RemoteAnalysisClient.kt", "utf8")
};

if (process.argv.includes("--self-test")) {
  const passing = assessApiContract(files);
  if (passing.status !== "GO") throw new Error(`API contract fixture failed: ${passing.blockers.join("; ")}`);
  const cases = [
    ["missing server route", (value) => { value.server = value.server.replace('app.get("/health/live"', 'app.get("/health/live-broken"'); }],
    ["drifted Retrofit route", (value) => { value.androidApi = value.androidApi.replace('@GET("v1/cards")', '@GET("v2/cards")'); }],
    ["removed raw upload guard", (value) => { value.remoteAnalysis = value.remoteAnalysis.replaceAll("isExpectedApiUploadPath", "removedUploadPathGuard"); }],
    ["removed raw upload acknowledgement", (value) => { value.openapi = value.openapi.replace("#/components/schemas/UploadJobResponse", "#/components/schemas/ErrorResponse"); }],
    ["removed registration binding", (value) => { value.openapi = value.openapi.replace('"installationBindingSha256", ', ""); }],
    ["removed job status binding", (value) => { value.openapi = value.openapi.replace("#/components/schemas/JobStatusResponse", "#/components/schemas/ErrorResponse"); }],
    ["removed reminder acknowledgement", (value) => { value.openapi = value.openapi.replace("#/components/schemas/UntrackItemResponse", "#/components/schemas/ErrorResponse"); }],
    ["removed device deletion acknowledgement", (value) => { value.openapi = value.openapi.replace("#/components/schemas/DeleteDeviceDataResponse", "#/components/schemas/ErrorResponse"); }],
    ["loosened card page", (value) => { value.openapi = value.openapi.replace('"CardsResponse": { "type": "object", "additionalProperties": false', '"CardsResponse": { "type": "object"'); }],
    ["loosened public card", (value) => { value.openapi = value.openapi.replace('"Card": {\n        "type": "object",\n        "additionalProperties": false', '"Card": {\n        "type": "object"'); }],
    ["removed card bounds", (value) => { value.openapi = value.openapi.replace('"boundingBox", ', ""); }],
    ["request field drift", (value) => { value.androidApi = value.androidApi.replace("val qualityScore: Double", "val quality: Double"); }],
    ["invalid OpenAPI", (value) => { value.openapi = "{"; }]
  ];
  for (const [name, mutate] of cases) {
    const value = structuredClone(files);
    mutate(value);
    if (assessApiContract(value).status !== "NO_GO") throw new Error(`API contract self-test expected rejection: ${name}`);
  }
  process.stdout.write(`API_CONTRACT_SELF_TEST=GO synthetic=1 releaseEvidence=0 bypassesRejected=${cases.length}\n`);
} else {
  const result = assessApiContract(files);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== "GO") process.exitCode = 1;
}

function contractOperations(contract) {
  const output = new Map();
  for (const [path, pathItem] of Object.entries(contract.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (methods.has(method)) output.set(`${method.toUpperCase()} ${path}`, operation);
    }
  }
  return output;
}

function serverOperations(source) {
  const output = new Set();
  for (const match of source.matchAll(/app\.(get|post|put|delete)\(\s*"([^"]+)"/g)) {
    const path = match[2].replace(/:([A-Za-z][A-Za-z0-9_]*)/g, "{$1}");
    output.add(`${match[1].toUpperCase()} ${path}`);
  }
  return output;
}

function retrofitOperations(source) {
  const output = new Set();
  for (const match of source.matchAll(/@(GET|POST|PUT|DELETE)\("([^"]+)"\)/g)) {
    output.add(`${match[1]} /${match[2].replace(/^\//, "")}`);
  }
  return output;
}

function parseKotlinModels(source) {
  const output = new Map();
  for (const match of source.matchAll(/data class\s+(\w+)\s*\(([\s\S]*?)\)\s*(?=\n|$)/g)) {
    output.set(match[1], new Set([...match[2].matchAll(/\bval\s+(\w+)\s*:/g)].map((field) => field[1])));
  }
  return output;
}

function parseZodModels(source) {
  const output = new Map();
  for (const match of source.matchAll(/export const\s+(\w+)\s*=\s*z\.object\(\{([\s\S]*?)\}\)\.strict\(\);/g)) {
    output.set(match[1], new Set([...match[2].matchAll(/^\s{2}([A-Za-z][A-Za-z0-9_]*)\s*:/gm)].map((field) => field[1])));
  }
  return output;
}

function compareSets(label, actual, expected, failures) {
  for (const value of expected) if (!actual.has(value)) failures.push(`${label} missing: ${value}`);
  for (const value of actual) if (!expected.has(value)) failures.push(`${label} is undocumented: ${value}`);
}
