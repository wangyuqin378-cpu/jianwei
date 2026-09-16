import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { additionalInspectionHeader, buildRecognitionPrompt, normalizeSensitiveFlags, parseRecognizedObjects } from '../cloudflare/gateway/src/index.ts';
import { acquireCalibrationBudgetLock } from './lib/calibration-budget-lock.mjs';
import { BlindReviewAttempts } from './lib/blind-review-attempts.mjs';

// A paired diagnostic, NOT a release/accuracy gate. Only the model changes.
// The six already-authorized public fixtures are deliberately fixed. No key,
// photo bytes, local asset IDs or provider reasoning are saved in the ledger.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const round = Number(args.find(arg => /^--round=[12]$/.test(arg))?.split('=')[1]);
if (![1, 2].includes(round)) throw new Error('Expected --round=1 or --round=2');
const dryRun = args.includes('--dry-run');
if (!dryRun && !args.includes('--allow-public-fixture-model-calls')) throw new Error('Explicit public-image model opt-in required');
const directory = path.join(root, '.tooling/recognition-review-v330');
const ledgerPath = path.join(directory, 'recognition.json');
const source = readFileSync(path.join(root, 'cloudflare/gateway/src/index.ts'));
const vars = JSON.parse(readFileSync(path.join(root, 'cloudflare/gateway/wrangler.jsonc'), 'utf8')).vars;
const models = [vars.QWEN_FLASH_MODEL, vars.QWEN_VERIFICATION_MODEL];
if (models.some(model => typeof model !== 'string') || new Set(models).size !== 2) throw new Error('Distinct configured recognition models required');
const files = ['web-009.jpg', 'web-021.jpg', 'web-049.jpg', 'web-014.jpg', 'web-033.jpg', 'web-058.jpg'];
const preflight = JSON.parse(readFileSync(path.join(root, '.tooling/release-eval/v211-final-public-60-preflight.json'), 'utf8'));
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const fixtures = files.map(fileName => {
  const photo = preflight.photos.find((photo: any) => photo.fileName === fileName && photo.currentAppEligible);
  if (!photo || photo.faceCount !== 0 || photo.sensitiveFlags.length !== 0) throw new Error('Public fixture preflight failed');
  const expectedPath = path.join(root, '.tooling/release-eval/v211-final-public-60/sanitized', fileName);
  if (path.resolve(photo.sanitizedFile) !== expectedPath) throw new Error('Unexpected fixture path');
  const bytes = readFileSync(expectedPath);
  if (bytes.length !== photo.sanitizedBytes || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('Fixture bytes changed');
  return { fileName, bytes, sha256: sha(bytes), prompt: buildRecognitionPrompt(photo.labels ?? [], ['科学原理', '生活设计', '物件历史']) };
});
const limits = { calls: 24, accountedTokens: 200_000, maxOutputTokensPerCall: 2048, timeoutMs: 18_000, rounds: 2 };
const policy = {
  sourceSha256: sha(source), runnerSha256: sha(readFileSync(fileURLToPath(import.meta.url))), models, limits,
  fixtures: fixtures.map(({ fileName, sha256, prompt }) => ({ fileName, sha256, prompt })),
  parameters: { enable_thinking: false, temperature: 0, response_format: { type: 'json_object' } },
  scope: 'paired-public-recognition-only-no-search-no-product-card-no-deployment'
};
const policySha256 = sha(JSON.stringify(policy));
if (dryRun) {
  console.log(JSON.stringify({ policySha256, models, limits, files, callsThisRound: 12, networkCalls: 0 }));
  process.exit(0);
}
mkdirSync(directory, { recursive: true, mode: 0o700 });
process.once('exit', acquireCalibrationBudgetLock(`${ledgerPath}.lock`));
const checkpoint: any = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, 'utf8')) : {
  policySha256, policy, usage: { calls: 0 }, results: [], pairs: []
};
if (checkpoint.policySha256 !== policySha256) throw new Error('Policy/input changed; cannot resume this ledger');
if (round === 2 && checkpoint.results.filter((r: any) => r.round === 1).length !== 12) throw new Error('First round must finish before replay');
const persist = async () => {
  // The generic ledger saves once before entering our callback. If interrupted
  // in that tiny window, retain conservative billing headroom on resume.
  const fallbackReservation = Math.max(...fixtures.map(f => Buffer.byteLength(f.prompt, 'utf8'))) + 8192 + limits.maxOutputTokensPerCall;
  checkpoint.accountedTokens = (checkpoint.attempts ?? []).reduce((sum: number, a: any) => sum + (a.usage ? a.usage.inputTokens + a.usage.outputTokens : a.reservedTokens ?? fallbackReservation), 0);
  writeFileSync(`${ledgerPath}.tmp`, JSON.stringify(checkpoint, null, 2), { mode: 0o600 });
  renameSync(`${ledgerPath}.tmp`, ledgerPath);
};
const ledger = new BlindReviewAttempts(checkpoint, limits.calls, persist);
const csv = readFileSync('/Users/wyq/Downloads/默认业务空间-apiKey-6301416.csv', 'utf8');
const credentials = Object.fromEntries(csv.replace(/^\uFEFF/, '').split(/\r?\n/).flatMap(line => {
  const comma = line.indexOf(',');
  return comma > 0 ? [[line.slice(0, comma).trim(), line.slice(comma + 1).trim()]] : [];
}));
if (!credentials.apiKey) throw new Error('Configured Aliyun credential unavailable');
const endpoint = new URL(`https://${vars.DASHSCOPE_HOST}/compatible-mode/v1/chat/completions`);
if (!(endpoint.hostname === 'dashscope.aliyuncs.com' || endpoint.hostname.endsWith('.maas.aliyuncs.com'))) throw new Error('Only Aliyun endpoints permitted');

for (const [index, fixture] of fixtures.entries()) {
  // Counterbalance call order, then reverse it on replay.
  const ordered = (index + round) % 2 ? models : [...models].reverse();
  for (const model of ordered) {
    const pair = `${round}:${fixture.fileName}:${model}`;
    if (checkpoint.pairs.includes(pair)) continue; // A lost response stays spent.
    const reservation = Buffer.byteLength(fixture.prompt, 'utf8') + 8192 + limits.maxOutputTokensPerCall;
    if ((checkpoint.accountedTokens ?? 0) + reservation > limits.accountedTokens) throw new Error('Recognition token ceiling reached');
    checkpoint.pairs.push(pair);
    const started = Date.now();
    const row: any = { round, fileName: fixture.fileName, model, imageSha256: fixture.sha256 };
    try {
      const raw = await ledger.run(async (record: any) => {
        checkpoint.attempts.at(-1).reservedTokens = reservation;
        checkpoint.attempts.at(-1).pair = pair;
        await persist();
        const headers: Record<string, string> = { Authorization: `Bearer ${credentials.apiKey}`, 'Content-Type': 'application/json' };
        const inspection = additionalInspectionHeader(model, vars.QWEN_FLASH_MODEL);
        if (inspection) headers['X-DashScope-DataInspection'] = inspection;
        const response = await fetch(endpoint, {
          method: 'POST', headers, redirect: 'error', signal: AbortSignal.timeout(limits.timeoutMs),
          body: JSON.stringify({ model, ...policy.parameters, max_tokens: limits.maxOutputTokensPerCall, messages: [{ role: 'user', content: [
            { type: 'text', text: fixture.prompt }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${fixture.bytes.toString('base64')}` } }
          ] }] })
        });
        const envelope: any = await response.json().catch(() => ({}));
        await record(envelope, response.status);
        if (!response.ok) throw new Error(`ModelHTTP${response.status}`);
        if (envelope.choices?.[0]?.finish_reason !== 'stop') throw new Error('IncompleteModelOutput');
        return JSON.parse(envelope.choices[0].message.content);
      });
      row.raw = raw;
      row.sensitiveFlags = normalizeSensitiveFlags(raw.sensitiveFlags);
      // Deliberately no DB alias mapping: isolate what the visual model saw.
      row.objects = parseRecognizedObjects(raw, []);
      row.status = 'completed';
    } catch (error: any) {
      row.status = 'failed';
      row.errorKind = error.name;
      row.errorCode = /^ModelHTTP\d+$|^IncompleteModelOutput$/.test(error.message) ? error.message : 'transport_or_schema_error';
    }
    row.elapsedMs = Date.now() - started;
    checkpoint.results.push(row);
    await persist();
    console.log(JSON.stringify(row));
    const httpStatus = checkpoint.attempts.at(-1)?.httpStatus;
    if (httpStatus >= 400 && httpStatus < 500) throw new Error('Provider rejected request; stop instead of repeating across photos');
  }
}
console.log(JSON.stringify({ usage: checkpoint.usage, accountedTokens: checkpoint.accountedTokens, results: checkpoint.results.length }));
