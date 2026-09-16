// Local test entrypoint only. The production entrypoint remains src/index.ts.
import gateway, { type Env } from "../src/index.js";
import { appleConfiguration, makeAppleServices, ManagedEntitlementError } from "../src/managed-entitlement.js";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname === "/synthetic-apple-status") {
      try {
        const apple = await makeAppleServices(appleConfiguration(env));
        const result = await apple.subscriptionStatus("10000001");
        return Response.json({ bundleId: result.bundleId });
      } catch (error) {
        if (error instanceof ManagedEntitlementError) return Response.json({ code: error.code }, { status: error.status });
        throw error;
      }
    }
    return gateway.fetch(request, env);
  }
};
