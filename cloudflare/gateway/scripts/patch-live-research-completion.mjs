import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

export const BASE_SHA256 = 'a5316407ea6ce60c7d2decef482c31c469bda7b6fa88565154348e9ccd22433a';
export async function patchLiveResearchCompletion(original) {
  assert.equal(createHash('sha256').update(original).digest('hex'), BASE_SHA256, 'Unexpected live baseline');
  const helper = (await readFile(new URL('live-research-shape.mjs', import.meta.url), 'utf8'))
    .replace('export function hasLegacyGeneratedFactStructure', 'function hasLegacyGeneratedFactStructure');
  let result = original;
  const replace = (before, after) => {
    assert.equal(result.split(before).length, 2, `Expected one patch site: ${before.slice(0, 80)}`);
    result = result.replace(before, after);
  };
  replace('    let incompleteReview = null;', '    let incompleteReview = null;\n    let incompleteResearch = false;');
  replace('      const research = await researchFacts(recognizedObjects, input.interests, env, [...skippedCacheFacts.values()]);',
    '      const research = await researchFacts(recognizedObjects, input.interests, env, [...skippedCacheFacts.values()]);\n      incompleteResearch = (research.incompleteCandidateCount ?? 0) > 0;');
  replace('    if (!selected && incompleteReview) throw incompleteReview;',
    '    if (!selected && incompleteReview) throw incompleteReview;\n    if (!selected && incompleteResearch) throw new GatewayError(502, "invalid_research_response", "知识候选暂时无法确认");');
  replace('  const rawCandidates = Array.isArray(raw.candidates) ? raw.candidates.slice(0, 3) : [];',
    '  if (!Array.isArray(raw.candidates) || raw.candidates.length > 3) {\n    throw new GatewayError(502, "invalid_research_response", "知识候选暂时无法确认");\n  }\n  const rawCandidates = raw.candidates;\n  let incompleteCandidateCount = 0;');
  replace('      diagnostics.push({ stage: "research_candidate", reason: "not_object" });',
    '      incompleteCandidateCount++;\n      diagnostics.push({ stage: "research_candidate", reason: "not_object" });');
  replace('    const selectedObject = objectChoices.find((object) => item.topicKey === object.topicKey && item.objectName === object.objectName);',
    '    if (!hasLegacyGeneratedFactStructure(item)) {\n      incompleteCandidateCount++;\n      diagnostics.push({ stage: "research_candidate", reason: "incomplete_structure" });\n      continue;\n    }\n    const selectedObject = objectChoices.find((object) => item.topicKey === object.topicKey && item.objectName === object.objectName);');
  replace('  return { candidates, usage: response.usage, diagnostics };',
    '  return { candidates, usage: response.usage, diagnostics, incompleteCandidateCount };');
  replace('async function researchFacts(', helper + '\nasync function researchFacts(');
  replace('evidenceSnapshotPolicy: "request-local-verified-source-v1"',
    'evidenceSnapshotPolicy: "request-local-verified-source-v1", researchCompletionPolicy: "explicit-result-or-retry-v1"');
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, output] = process.argv.slice(2); assert.ok(input && output);
  const candidate = await patchLiveResearchCompletion(await readFile(input, 'utf8'));
  await writeFile(output, candidate, {flag:'wx', mode:0o600});
  console.log(JSON.stringify({baseSHA:BASE_SHA256, candidateSHA:createHash('sha256').update(candidate).digest('hex'), deployed:false}));
}
