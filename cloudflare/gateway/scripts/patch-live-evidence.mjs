import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from '../../../backend/node_modules/typescript/lib/typescript.js';
import { build } from '../node_modules/esbuild/lib/main.js';

export const BASE_SHA256 = '2946931cc212a8de116ea553fba31d83233b06ae7fdfab5b08f251bf3c9d6d05';

// Port only the evidence reviewer, not the unrelated dirty subscription/schema
// work. Local candidate builder only, not a deployment or a quality certificate.
// Retain accounting, search and photo checks; only the evidence-review call gets
// bounded reasoning and the separately tested 45-second deadline.
export async function patchLiveEvidence(original) {
  assert.equal(createHash('sha256').update(original).digest('hex'), BASE_SHA256, 'Unexpected live baseline');
  const canonical = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
  const syntax = ts.createSourceFile('index.ts', canonical, ts.ScriptTarget.Latest, true);
  const declarations = syntax.statements.filter(x => ts.isFunctionDeclaration(x) && x.name?.text === 'verifyEvidenceSupport');
  assert.equal(declarations.length, 1);
  const reviewer = ts.transpileModule(declarations[0].getText(syntax).replace(/^export\s+/, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText.replace('buildEvidenceReviewPrompt(', 'JianweiClauseEvidence.buildEvidenceReviewPrompt(')
    .replace('evidenceReviewResponseFormat(', 'JianweiClauseEvidence.evidenceReviewResponseFormat(')
    .replace('interpretStructuredEvidenceReview(', 'JianweiClauseEvidence.interpretStructuredEvidenceReview(');
  const helper = await build({ entryPoints: [fileURLToPath(new URL('../src/evidence-review.ts', import.meta.url))],
    bundle: true, write: false, format: 'iife', globalName: 'JianweiClauseEvidence', target: 'es2022' });
  const start = original.indexOf('async function verifyEvidenceSupport(');
  const end = original.indexOf('__name(verifyEvidenceSupport, "verifyEvidenceSupport");', start);
  assert.ok(start > 0 && end > start);
  let patched = original.slice(0, start) + reviewer + original.slice(end);
  const transportStart = patched.indexOf('async function callCompatibleQwen(');
  const transportEnd = patched.indexOf('__name(callCompatibleQwen, "callCompatibleQwen");', transportStart);
  assert.ok(transportStart > 0 && transportEnd > transportStart);
  let transport = patched.slice(transportStart, transportEnd);
  for (const [before, after] of [
    ['async function callCompatibleQwen(model, messages, env, temperature)', 'async function callCompatibleQwen(model, messages, env, temperature, evidenceReview)'],
    ['max_tokens: 2000, enable_thinking: false, response_format: { type: "json_object" }', 'max_tokens: evidenceReview ? 2048 : 2000, enable_thinking: Boolean(evidenceReview), ...(evidenceReview ? { thinking_budget: 1024 } : {}), response_format: evidenceReview ?? { type: "json_object" }'],
    ['}, 18e3);', '}, evidenceReview ? 45000 : 18000);']
  ]) {
    assert.equal(transport.split(before).length, 2, 'Expected exact live transport anchor');
    transport = transport.replace(before, after);
  }
  patched = patched.slice(0, transportStart) + transport + patched.slice(transportEnd);
  // Live transport predates the locally tested finish_reason guard. Preserve its
  // usage extraction; disallow unfinished review/model output.
  const before = '!Array.isArray(parsed.choices) || !isRecord(parsed.choices[0]) || !isRecord(parsed.choices[0].message)';
  assert.equal(patched.split(before).length, 2);
  patched = patched.replace(before, '!Array.isArray(parsed.choices) || parsed.choices.length !== 1 || !isRecord(parsed.choices[0]) || parsed.choices[0].finish_reason !== "stop" || !isRecord(parsed.choices[0].message)');
  const health = 'knowledgeHistory: "packed-v1"';
  assert.equal(patched.split(health).length, 2);
  patched = patched.replace(health, health + ', evidenceReviewPolicy: "clauses-thinking-schema-v1"');
  const version = '`${dynamic.modelVersion}+quality-v2`';
  assert.equal(patched.split(version).length, 2);
  patched = patched.replace(version, '`${dynamic.modelVersion}+evidence-clauses-thinking-schema-v1+quality-v2`');
  return helper.outputFiles[0].text + '\n' + patched;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, output] = process.argv.slice(2);
  assert.ok(input && output, 'Usage: patch-live-evidence.mjs current-live.js candidate.js');
  const candidate = await patchLiveEvidence(await readFile(input, 'utf8'));
  await writeFile(output, candidate, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ baseSHA: BASE_SHA256, candidateSHA: createHash('sha256').update(candidate).digest('hex'), extraModules: 0 }));
}
