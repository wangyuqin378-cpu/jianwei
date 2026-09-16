import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const BASE_SHA256 = '4a2597c1e87d2911b22af349f762b97bef4c2cfc307dc0240bec5961e6273836';

// Port the canonical request-local source snapshot into the schema-7 adapter.
// Never deploy the unrelated canonical database, subscription or prompt edits.
export function patchLiveSourceSnapshot(original) {
  assert.equal(createHash('sha256').update(original).digest('hex'), BASE_SHA256, 'Unexpected live baseline');
  const replacements = [
    ['const sources=await mapSearchSources(unique,unique.map(x=>x.index));',
      'const fetched=await mapSearchSources(unique,unique.map(x=>x.index));\n  const sources=fetched.map((source,index)=>({...source,sourceId:`search-${index+1}`}));'],
    ['return {content:writing.content,searchResults,usage};',
      'return {content:writing.content,searchResults,verifiedSources:sources,usage};'],
    ['const sources = await mapSearchSources(response.searchResults, fact.citedSourceIndexes);',
      `const sources = response.verifiedSources.filter((source) => fact.citedSourceIndexes.includes(Number(source.sourceId.replace("search-", ""))));
    if (sources.length !== fact.citedSourceIndexes.length) {
      diagnostics.push({ stage: "research_candidate", reason: "unavailable_citation", topicKey: fact.topicKey });
      continue;
    }`],
    ['providerFailurePolicy: "typed-dependency-access-v1"',
      'providerFailurePolicy: "typed-dependency-access-v1", evidenceSnapshotPolicy: "request-local-verified-source-v1"']
  ];
  let result = original;
  for (const [before, after] of replacements) {
    assert.equal(result.split(before).length, 2, `Patch anchor must be unique: ${before}`);
    result = result.replace(before, after);
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, output] = process.argv.slice(2);
  assert.ok(input && output);
  const result = patchLiveSourceSnapshot(await readFile(input, 'utf8'));
  await writeFile(output, result, {flag: 'wx', mode: 0o600});
  console.log(JSON.stringify({baseSHA: BASE_SHA256, candidateSHA: createHash('sha256').update(result).digest('hex'), deployed: false}));
}
