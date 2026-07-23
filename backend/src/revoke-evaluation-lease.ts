import { PostgresRepositories } from "./infrastructure/postgres-repositories.js";

const index = process.argv.indexOf("--lease-id");
const leaseId = index >= 0 ? process.argv[index + 1] : null;
if (!leaseId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(leaseId)) {
  throw new Error("A valid --lease-id is required");
}
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl || !/^postgres(?:ql)?:\/\//i.test(databaseUrl)) throw new Error("DATABASE_URL must be a PostgreSQL URL");
const repositories = new PostgresRepositories(databaseUrl);
try {
  const revoked = await repositories.jobsRepository.revokeEvaluationLease(leaseId, new Date().toISOString());
  if (!revoked) throw new Error("Evaluation lease was not found");
  process.stdout.write(`EVALUATION_LEASE=REVOKED leaseId=${leaseId}\n`);
} finally {
  await repositories.close();
}
