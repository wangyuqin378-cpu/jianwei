export function assessContainerDeploymentInputs(env) {
  const image = env.JIANWEI_IMAGE?.trim() ?? "";
  const declaredDigest = env.JIANWEI_CONTAINER_IMAGE_DIGEST?.trim().toLowerCase() ?? "";
  const baseImage = env.JIANWEI_NODE_IMAGE?.trim() ?? "";
  const blockers = [];
  const digestMatch = /@(?<digest>sha256:[a-f0-9]{64})$/.exec(image);

  if (!digestMatch || /\s/.test(image)) blockers.push("JIANWEI_IMAGE must be an immutable registry reference ending in @sha256:<64-hex>");
  if (!/^sha256:[a-f0-9]{64}$/.test(declaredDigest)) blockers.push("JIANWEI_CONTAINER_IMAGE_DIGEST must be an OCI sha256 digest");
  if (digestMatch?.groups?.digest !== declaredDigest) blockers.push("declared container digest must exactly match the deployed image reference");
  if (!/@sha256:[a-f0-9]{64}$/.test(baseImage) || /\s/.test(baseImage)) {
    blockers.push("JIANWEI_NODE_IMAGE must be an immutable base-image reference ending in @sha256:<64-hex>");
  }

  return {
    status: blockers.length === 0 ? "GO" : "NO_GO",
    releaseEvidence: false,
    metrics: {
      deploymentImagePinned: digestMatch ? 1 : 0,
      declaredDigestMatches: digestMatch?.groups?.digest === declaredDigest ? 1 : 0,
      baseImagePinned: /@sha256:[a-f0-9]{64}$/.test(baseImage) ? 1 : 0
    },
    blockers: [...new Set(blockers)]
  };
}

if (process.argv.includes("--self-test")) {
  const digest = `sha256:${"a".repeat(64)}`;
  const valid = {
    JIANWEI_IMAGE: `registry.cn-beijing.aliyuncs.com/jianwei/api@${digest}`,
    JIANWEI_CONTAINER_IMAGE_DIGEST: digest,
    JIANWEI_NODE_IMAGE: `node:22.17.0-bookworm-slim@sha256:${"b".repeat(64)}`
  };
  if (assessContainerDeploymentInputs(valid).status !== "GO") throw new Error("Valid pinned deployment inputs were rejected");
  const mutations = [
    { ...valid, JIANWEI_IMAGE: "registry.cn-beijing.aliyuncs.com/jianwei/api:latest" },
    { ...valid, JIANWEI_CONTAINER_IMAGE_DIGEST: `sha256:${"c".repeat(64)}` },
    { ...valid, JIANWEI_NODE_IMAGE: "node:22.17.0-bookworm-slim" },
    { ...valid, JIANWEI_IMAGE: `${valid.JIANWEI_IMAGE} whitespace` }
  ];
  if (mutations.some((env) => assessContainerDeploymentInputs(env).status !== "NO_GO")) {
    throw new Error("A mutable or mismatched deployment input bypassed the gate");
  }
  process.stdout.write(`CONTAINER_DEPLOYMENT_INPUT_SELF_TEST=GO synthetic=1 releaseEvidence=0 bypassesRejected=${mutations.length} imageDigestBinding=1 baseImagePin=1\n`);
} else {
  const result = assessContainerDeploymentInputs(process.env);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== "GO") process.exitCode = 1;
}
