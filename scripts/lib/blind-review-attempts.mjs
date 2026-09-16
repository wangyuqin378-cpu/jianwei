// Reserve before transport: timeouts, truncation and invalid JSON may all be
// billable. A resumed or interrupted attempt must never disappear from budget.
export class BlindReviewAttempts {
  constructor(checkpoint, limit, save) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("Invalid attempt limit");
    if (checkpoint.attemptLimit !== undefined && checkpoint.attemptLimit !== limit) throw new Error("Attempt limit changed; refusing budget reset");
    if (!checkpoint.attempts && checkpoint.usage?.calls) throw new Error("Old checkpoint lacks a complete attempt ledger");
    checkpoint.attempts ??= [];
    if (!Array.isArray(checkpoint.attempts) || checkpoint.attempts.some((a, i) => a.ordinal !== i + 1)) throw new Error("Invalid attempt ledger");
    checkpoint.attemptLimit = limit;
    this.checkpoint = checkpoint;
    this.save = save;
  }

  async run(work) {
    const c = this.checkpoint;
    if (c.attempts.length >= c.attemptLimit) throw Object.assign(new Error("Blind review attempt budget reached"), { retryable: false });
    const attempt = { ordinal: c.attempts.length + 1, startedAt: new Date().toISOString(), state: "reserved", usage: null };
    c.attempts.push(attempt);
    await this.persist();
    try {
      const value = await work(async (envelope, httpStatus) => {
        attempt.httpStatus = httpStatus;
        attempt.responseModel = envelope.model ?? null;
        attempt.finishReason = envelope.choices?.[0]?.finish_reason ?? null;
        // Save only the final answer, not provider thinking or echoed auth.
        // Otherwise a valid JSON with invalid fields vanishes on retry.
        if (typeof envelope.choices?.[0]?.message?.content === "string") attempt.responseText = envelope.choices[0].message.content;
        const input = envelope.usage?.prompt_tokens ?? envelope.prompt_eval_count;
        const output = envelope.usage?.completion_tokens ?? envelope.eval_count;
        if (Number.isFinite(input) && input >= 0 && Number.isFinite(output) && output >= 0) attempt.usage = { inputTokens: input, outputTokens: output };
        attempt.state = "received";
        await this.persist();
      });
      attempt.state = "returned"; // Schema validation still happens at caller.
      attempt.response = value;
      return value;
    } catch (error) {
      attempt.state = "failed";
      // Do not save provider messages: they can contain credentials or echoes.
      attempt.errorKind = error.name ?? "Error";
      attempt.retryable = error.retryable !== false;
      throw error;
    } finally {
      attempt.finishedAt = new Date().toISOString();
      await this.persist();
    }
  }

  async persist() {
    const c = this.checkpoint;
    c.usage = {
      calls: c.attempts.length,
      inputTokens: c.attempts.reduce((n, a) => n + (a.usage?.inputTokens ?? 0), 0),
      outputTokens: c.attempts.reduce((n, a) => n + (a.usage?.outputTokens ?? 0), 0),
      unknownUsageCalls: c.attempts.filter(a => a.usage === null).length
    };
    await this.save();
  }
}

export function reviewHTTPError(provider, status) {
  return Object.assign(new Error(`${provider} HTTP ${status}`), { retryable: status === 429 || status >= 500 });
}
