import { readFile } from "node:fs/promises";

export function assessDeploymentFiles({ dockerfile, manifest, dockerignore, gitignore }) {
  const failures = [];
  const requireMarker = (content, marker, label) => {
    if (!content.includes(marker)) failures.push(`${label} is missing: ${marker}`);
  };

  const dockerRequirements = [
    "ARG NODE_IMAGE",
    "FROM ${NODE_IMAGE} AS build",
    "FROM ${NODE_IMAGE} AS runtime",
    "pnpm install --frozen-lockfile",
    "COPY deploy/Dockerfile /workspace/deploy/Dockerfile",
    "pnpm release:identity -- --write release-identity.json",
    "pnpm build && pnpm prune --prod",
    "COPY --from=build --chown=node:node /workspace/backend/release-identity.json ./release-identity.json",
    "COPY --from=build --chown=node:node /workspace/knowledge /app/knowledge",
    "USER node",
    "EXPOSE 9000",
    'CMD ["node", "dist/index.js"]'
  ];
  const manifestRequirements = [
    "runtime: custom-container",
    "timeout: 180",
    "image: ${env('JIANWEI_IMAGE')}",
    "port: 9000",
    "httpGetUrl: /health/live",
    "NODE_ENV: production",
    "OBJECT_STORE: oss",
    "VISION_PROVIDER: qwen",
    'OBJECT_TTL_HOURS: "24"',
    'ALLOW_UNATTESTED_FACTS: "false"',
    "role: ${env('JIANWEI_FC_ROLE_ARN')}",
    "vpcId: ${env('JIANWEI_VPC_ID')}",
    "securityGroupId: ${env('JIANWEI_SECURITY_GROUP_ID')}",
    "PUBLIC_BASE_URL: ${env('JIANWEI_PUBLIC_BASE_URL')}",
    "DATABASE_URL: ${env('JIANWEI_DATABASE_URL')}",
    "DASHSCOPE_API_KEY: ${env('JIANWEI_DASHSCOPE_API_KEY')}",
    "DASHSCOPE_BASE_URL: ${env('JIANWEI_DASHSCOPE_BASE_URL')}",
    "OSS_BUCKET: ${env('JIANWEI_OSS_BUCKET')}",
    "KNOWLEDGE_CATALOG_SHA256: ${env('JIANWEI_KNOWLEDGE_CATALOG_SHA256')}",
    "KNOWLEDGE_REVIEWER_IDS: ${env('JIANWEI_KNOWLEDGE_REVIEWER_IDS')}",
    "CONTAINER_IMAGE_DIGEST: ${env('JIANWEI_CONTAINER_IMAGE_DIGEST')}"
  ];
  for (const marker of dockerRequirements) requireMarker(dockerfile, marker, "Dockerfile");
  for (const marker of manifestRequirements) requireMarker(manifest, marker, "deployment manifest");

  const fromLines = dockerfile.match(/^FROM\s+.+$/gm) ?? [];
  if (fromLines.length !== 2 || fromLines.some((line) => !line.startsWith("FROM ${NODE_IMAGE} AS "))) {
    failures.push("all Docker stages must use the operator-supplied digest-pinned NODE_IMAGE");
  }
  if (/^\s*USER\s+root\s*$/mi.test(dockerfile)) failures.push("runtime image must not switch back to root");
  if (/^\s*ADD\s+/mi.test(dockerfile)) failures.push("Dockerfile must not use ADD");
  if (/BACKEND_RELEASE_SHA256/.test(dockerfile) || /BACKEND_RELEASE_SHA256/.test(manifest)) {
    failures.push("backend Release identity must come from the generated immutable file, not an environment override");
  }

  const sensitiveBindings = {
    PUBLIC_BASE_URL: "JIANWEI_PUBLIC_BASE_URL",
    DATABASE_URL: "JIANWEI_DATABASE_URL",
    DASHSCOPE_API_KEY: "JIANWEI_DASHSCOPE_API_KEY",
    DASHSCOPE_BASE_URL: "JIANWEI_DASHSCOPE_BASE_URL",
    OSS_BUCKET: "JIANWEI_OSS_BUCKET",
    KNOWLEDGE_CATALOG_SHA256: "JIANWEI_KNOWLEDGE_CATALOG_SHA256",
    KNOWLEDGE_REVIEWER_IDS: "JIANWEI_KNOWLEDGE_REVIEWER_IDS",
    CONTAINER_IMAGE_DIGEST: "JIANWEI_CONTAINER_IMAGE_DIGEST"
  };
  for (const [name, environmentName] of Object.entries(sensitiveBindings)) {
    const match = new RegExp(`^\\s*${name}:\\s*(.+)$`, "m").exec(manifest);
    if (!match || match[1].trim() !== `\${env('${environmentName}')}`) {
      failures.push(`${name} must be a required deployment-environment reference without a default`);
    }
  }

  for (const modelName of ["QWEN_FLASH_MODEL", "QWEN_PLUS_MODEL"]) {
    const match = new RegExp(`^\\s*${modelName}:\\s*(.+)$`, "m").exec(manifest);
    if (!match || !match[1].includes("${env(")) failures.push(`${modelName} must come from the deployment environment`);
    if (/latest/i.test(match?.[1] ?? "")) failures.push(`${modelName} must not use a floating latest version`);
  }

  const forbidden = [
    { label: "API credential", pattern: /sk-[A-Za-z0-9_-]{16,}/ },
    { label: "inline database credential", pattern: /postgres(?:ql)?:\/\/[^$\s{]+:[^$\s{]+@/i },
    { label: "long-lived OSS credential variable", pattern: /OSS_ACCESS_KEY_(?:ID|SECRET)/ },
    { label: "floating container tag", pattern: /^FROM\s+[^\s]+:(?:latest|\d+)(?:\s|$)/mi }
  ];
  for (const rule of forbidden) {
    if (rule.pattern.test(manifest) || rule.pattern.test(dockerfile)) {
      failures.push(`deployment files contain a forbidden ${rule.label}`);
    }
  }

  for (const marker of ["**/.env", "**/.env.*", "**/*.jks", "**/*.keystore", "**/keystore.properties"]) {
    requireMarker(dockerignore, marker, ".dockerignore");
  }
  for (const marker of ["s.yaml", ".env", "*.jks", "*.keystore", ".secrets/"]) {
    requireMarker(gitignore, marker, ".gitignore");
  }

  return {
    status: failures.length === 0 ? "GO" : "NO_GO",
    scope: "checked_in_template",
    releaseEvidence: false,
    metrics: {
      dockerMarkers: dockerRequirements.length,
      manifestMarkers: manifestRequirements.length,
      environmentOnlyBindings: Object.keys(sensitiveBindings).length,
      inlineSecrets: failures.some((item) => /credential|API credential/.test(item)) ? 1 : 0
    },
    blockers: [...new Set(failures)]
  };
}

const files = {
  dockerfile: await readFile("deploy/Dockerfile", "utf8"),
  manifest: await readFile("deploy/s.yaml.example", "utf8"),
  dockerignore: await readFile(".dockerignore", "utf8"),
  gitignore: await readFile(".gitignore", "utf8")
};

if (process.argv.includes("--self-test")) {
  const passing = assessDeploymentFiles(files);
  if (passing.status !== "GO") throw new Error(`Checked-in deployment fixture failed: ${passing.blockers.join("; ")}`);
  const cases = [
    ["inline API key", (value) => { value.manifest = value.manifest.replace("${env('JIANWEI_DASHSCOPE_API_KEY')}", "sk-synthetic_key_12"); }],
    ["floating model", (value) => { value.manifest = value.manifest.replace("qwen3.6-flash-2026-04-16", "qwen-latest"); }],
    ["root runtime", (value) => { value.dockerfile = value.dockerfile.replace("USER node", "USER root"); }],
    ["mutable base", (value) => { value.dockerfile = value.dockerfile.replaceAll("${NODE_IMAGE}", "node:22"); }],
    ["missing generated identity", (value) => { value.dockerfile = value.dockerfile.replace("pnpm release:identity -- --write release-identity.json", "pnpm release:identity-disabled"); }]
  ];
  for (const [name, mutate] of cases) {
    const value = structuredClone(files);
    mutate(value);
    if (assessDeploymentFiles(value).status !== "NO_GO") throw new Error(`Deployment self-test expected rejection: ${name}`);
  }
  process.stdout.write(`DEPLOYMENT_MANIFEST_SELF_TEST=GO synthetic=1 releaseEvidence=0 bypassesRejected=${cases.length}\n`);
} else {
  const result = assessDeploymentFiles(files);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== "GO") process.exitCode = 1;
}
