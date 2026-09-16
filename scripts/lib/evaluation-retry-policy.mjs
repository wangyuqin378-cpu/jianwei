const PHOTO_INSIGHT_ROUTE = "/v1/photo-insights";

export function retryPolicyForHTTP(route, status, code) {
  // Waiting or starting a new run must not reset a monetary stop/configuration.
  if (["evaluation_budget_unavailable", "evaluation_budget_unconfigured", "evaluation_budget_reconciliation_required", "evaluation_research_unbounded"].includes(code)) {
    return { retry: false, maxAttempts: 1, kind: "budget" };
  }
  // A daily/monthly cap will not recover during this short retry window.
  if (status === 429 && ["daily_budget_exceeded", "global_daily_budget_exceeded", "monthly_budget_exceeded"].includes(code)) {
    return { retry: false, maxAttempts: 1, kind: "budget" };
  }
  if (route === PHOTO_INSIGHT_ROUTE && status === 409 && code === "request_in_progress") {
    return { retry: true, maxAttempts: 80, kind: "in_flight" };
  }
  if (status === 429) {
    return { retry: true, maxAttempts: route === PHOTO_INSIGHT_ROUTE ? 8 : 3, kind: "rate_limit" };
  }
  if (status >= 500) {
    const providerFailure = code === "vision_provider_error" || code === "provider_error";
    return {
      retry: true,
      maxAttempts: providerFailure ? 3 : route === PHOTO_INSIGHT_ROUTE ? 5 : 3,
      kind: providerFailure ? "provider" : "server"
    };
  }
  return { retry: false, maxAttempts: 1, kind: "permanent" };
}

export function retryPolicyForTransport(route) {
  return { retry: true, maxAttempts: route === PHOTO_INSIGHT_ROUTE ? 5 : 3, kind: "transport" };
}
