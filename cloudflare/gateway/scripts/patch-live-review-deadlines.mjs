import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const BASE_SHA256 = 'd5685518ac69700fc731ec68474b44d52886720cc83a3a88c1cac51b587b48eb';

// Narrow schema-7 hotfix: leave model prompts, costs, quotas, credentials and
// unrelated local subscription/accounting changes out of the live artifact.
export function patchLiveReviewDeadlines(original) {
  assert.equal(createHash('sha256').update(original).digest('hex'), BASE_SHA256);
  let patched = original;
  function replaceOnce(before, after) {
    assert.equal(patched.split(before).length, 2, `Unexpected live anchor: ${before}`);
    patched = patched.replace(before, after);
  }
  for (const name of ['verifyInterestingness', 'verifyFactAgainstPhoto']) {
    const start = patched.indexOf(`async function ${name}(`);
    const end = patched.indexOf(`__name(${name}, "${name}");`, start);
    assert.ok(start > 0 && end > start);
    const previous = patched.slice(start, end);
    assert.equal(previous.split('], env, 0);').length, 2);
    patched = patched.slice(0, start) + previous.replace('], env, 0);', '], env, 0, undefined, 45000);') + patched.slice(end);
  }
  replaceOnce('async function callCompatibleQwen(model, messages, env, temperature, evidenceReview)',
    'async function callCompatibleQwen(model, messages, env, temperature, evidenceReview, timeoutMilliseconds = 18000)');
  replaceOnce('}, evidenceReview ? 45000 : 18000);', '}, evidenceReview ? 45000 : timeoutMilliseconds);');
  replaceOnce('const [evidence, verified, quality] = await Promise.all([', 'const reviewResults = await Promise.allSettled([');
  const endReviews = 'verifyInterestingness(dynamic.fact, dynamic.sources, env)\n            ]);';
  // A rejected review must not terminate the worker while other paid calls
  // are still running. This does not retrofit the unreleased usage journal.
  replaceOnce(endReviews, endReviews + '\n            const reviewFailure = reviewResults.find(result => result.status === "rejected");\n            if (reviewFailure) throw reviewFailure.reason;\n            const [evidence, verified, quality] = reviewResults.map(result => result.value);');
  replaceOnce('evidenceReviewPolicy: "clauses-thinking-schema-v1"',
    'evidenceReviewPolicy: "clauses-thinking-schema-v1", reviewDeadlinePolicy: "bounded-45s-settled-v1"');
  return patched;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, output] = process.argv.slice(2);
  assert.ok(input && output);
  const candidate = patchLiveReviewDeadlines(await readFile(input, 'utf8'));
  await writeFile(output, candidate, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ baseSHA: BASE_SHA256, candidateSHA: createHash('sha256').update(candidate).digest('hex'), extraModules: 0 }));
}
