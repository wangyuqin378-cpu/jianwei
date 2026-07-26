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
