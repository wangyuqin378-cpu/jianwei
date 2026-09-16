import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import ts from '../node_modules/typescript/lib/typescript.js';

export const BASE_SHA256 = 'f502e03bb1437d31b76a40d12815bc494d27eb939a6361b6d35033685f0587a5';

// Replace only the existing source-reader function inside its bundled scope.
// Its Parser binding/dependency, fetch limits, request accounting, original
// prompts and schema-7 storage contract remain the live implementation.
export function patchLiveAuthorEvidence(original, canonical) {
  assert.equal(createHash('sha256').update(original).digest('hex'), BASE_SHA256, 'Unexpected live baseline');
  const syntax = ts.createSourceFile('index.ts', canonical, ts.ScriptTarget.Latest, true);
  const declarations = syntax.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === 'htmlToEvidenceText');
  assert.equal(declarations.length, 1);
  const replacement = ts.transpileModule(declarations[0].getText(syntax).replace(/^export\s+/, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
  }).outputText.trim();
  const liveSyntax = ts.createSourceFile('live.js', original, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const matches = [];
  const visit = node => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'htmlToEvidenceText' && node.body.statements.length > 1) matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(liveSyntax);
  assert.equal(matches.length, 1, 'One reader implementation and an unchanged public wrapper');
  const fn = matches[0];
  assert.ok(fn.getText(liveSyntax).includes('new Parser('));
  let result = original.slice(0, fn.getStart(liveSyntax)) + replacement + original.slice(fn.end);
  const once = (before, after) => {
    assert.equal(result.split(before).length, 2, `Patch anchor must be unique: ${before}`);
    result = result.replace(before, after);
  };
  once('`${dynamic.modelVersion}+evidence-clauses-thinking-schema-v1+quality-v2`',
    '`${dynamic.modelVersion}+evidence-clauses-thinking-schema-v1+quality-v2+author-only-sources-v1`');
  once('return modelVersion.startsWith("reviewed-catalog-") || modelVersion.includes("+quality-v2");',
    'return modelVersion.startsWith("reviewed-catalog-") || modelVersion.endsWith("+quality-v2+author-only-sources-v1");');
  once('researchCompletionPolicy: "explicit-result-or-retry-v1"',
    'researchCompletionPolicy: "explicit-result-or-retry-v1", sourceTextPolicy: "author-only-sources-v1"');
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, output] = process.argv.slice(2);
  assert.ok(input && output);
  const canonical = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
  const result = patchLiveAuthorEvidence(await readFile(input, 'utf8'), canonical);
  await writeFile(output, result, {flag:'wx', mode:0o600});
  console.log(JSON.stringify({baseSHA:BASE_SHA256, candidateSHA:createHash('sha256').update(result).digest('hex'), deployed:false}));
}
