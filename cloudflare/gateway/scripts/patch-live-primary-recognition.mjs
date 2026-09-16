import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import ts from '../../../backend/node_modules/typescript/lib/typescript.js';

export const BASE_SHA256 = '90b300e1f31b8cd95e3a80236f5e41f27e3e85dcdde07f85371403999a84c12d';

// Build an isolated schema-7 candidate. No deploy or database operation here.
// Port the existing primary-object contract and malformed-safety handling, not
// the dirty subscription/accounting/source/writer changes in the checkout.
export async function patchLivePrimaryRecognition(original) {
  assert.equal(createHash('sha256').update(original).digest('hex'), BASE_SHA256, 'Unexpected live baseline');
  const canonical = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
  const syntax = ts.createSourceFile('index.ts', canonical, ts.ScriptTarget.Latest, true);
  const names = ['normalizeSensitiveFlags', 'parseRecognizedObjects', 'recognizePhoto', 'buildRecognitionPrompt'];
  const compiled = Object.fromEntries(names.map(name => {
    const matches = syntax.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.equal(matches.length, 1, `Expected one ${name}`);
    return [name, ts.transpileModule(matches[0].getText(syntax).replace(/^export\s+/, ''), {
      compilerOptions: { target: ts.ScriptTarget.ES2022 }
    }).outputText];
  }));
  let candidate = original;
  for (const name of names.filter(name => name !== 'parseRecognizedObjects')) {
    const marker = `${name === 'recognizePhoto' ? 'async ' : ''}function ${name}(`;
    assert.equal(candidate.split(marker).length, 2, `Expected single live ${name}`);
    const start = candidate.indexOf(marker), end = candidate.indexOf(`__name(${name}, "${name}");`, start);
    assert.ok(start > 0 && end > start);
    candidate = candidate.slice(0, start) + compiled[name] + candidate.slice(end);
  }
  assert.equal(candidate.includes('function parseRecognizedObjects('), false);
  const anchor = 'async function recognizePhoto(';
  candidate = candidate.replace(anchor, compiled.parseRecognizedObjects + '\n' + anchor);
  const health = 'reviewDeadlinePolicy: "bounded-45s-settled-v1"';
  assert.equal(candidate.split(health).length, 2);
  candidate = candidate.replace(health, health + ', recognitionPolicy: "primary-object-v1"');
  return candidate;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, output] = process.argv.slice(2);
  assert.ok(input && output, 'Usage: patch-live-primary-recognition.mjs baseline.js candidate.js');
  const candidate = await patchLivePrimaryRecognition(await readFile(input, 'utf8'));
  await writeFile(output, candidate, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ baseSHA: BASE_SHA256, candidateSHA: createHash('sha256').update(candidate).digest('hex'), deployed: false }));
}
