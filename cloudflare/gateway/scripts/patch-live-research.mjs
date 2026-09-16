import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import ts from '../../../backend/node_modules/typescript/lib/typescript.js';
import { build } from '../node_modules/esbuild/lib/main.js';
import { fileURLToPath } from 'node:url';
const [input,output]=process.argv.slice(2);
const original=await readFile(input,'utf8');
assert.equal(createHash('sha256').update(original).digest('hex'),'afa90740787a360cfe8cbacc9c0fd9b9b71bac59c67058c19bff0aab0259fe89');
const adapter=(await readFile(new URL('live-research-adapter.mjs',import.meta.url),'utf8')).replace('export async function','async function');
const start=original.indexOf('async function callDashScopeSearch(');
const end=original.indexOf('__name(callDashScopeSearch, "callDashScopeSearch");',start);
assert.ok(start>0&&end>start);
let result=original.slice(0,start)+adapter+'\n'+original.slice(end);
// Ship the already tested source-reader fixes, without pulling in unrelated
// subscription/accounting modules from the current gateway checkout.
const canonical=await readFile(new URL('../src/index.ts',import.meta.url),'utf8');
const syntax=ts.createSourceFile('index.ts',canonical,ts.ScriptTarget.Latest,true);
const names=['mapSearchSources','fetchSourceEvidence','htmlToEvidenceText','isUsableSourceEvidence'];
const pieces=names.map(name=>{
  const declarations=syntax.statements.filter(x=>ts.isFunctionDeclaration(x)&&x.name?.text===name);
  assert.equal(declarations.length,1);
  return 'export '+declarations[0].getText(syntax).replace(/^export\s+/,'');
});
const compiled=await build({stdin:{contents:'import { Parser } from "htmlparser2";\n'+pieces.join('\n'),
  loader:'ts',resolveDir:fileURLToPath(new URL('..',import.meta.url))},bundle:true,write:false,format:'iife',globalName:'JianweiEvidenceReader',target:'es2022'});
result=compiled.outputFiles[0].text+'\n'+result;
for(const name of ['mapSearchSources','htmlToEvidenceText']) {
  const marker=(name==='mapSearchSources'?'async ':'')+`function ${name}(`;
  // The IIFE also contains a declaration: target the legacy live declaration
  // immediately before its __name marker, not the compiled module internals.
  const close=result.lastIndexOf(`__name(${name}, "${name}");`);
  const open=result.lastIndexOf(marker,close);
  assert.ok(open>compiled.outputFiles[0].text.length&&close>open);
  const args=name==='mapSearchSources'?'results, indexes':'html';
  result=result.slice(0,open)+`${marker}${args}) { return JianweiEvidenceReader.${name}(${args}); }\n`+result.slice(close);
}
result=result.replace('var MAX_SOURCE_EVIDENCE_BYTES = 256 * 1024;','var MAX_SOURCE_EVIDENCE_BYTES = 1024 * 1024;');
assert.equal(result.split('callDashScopeSearch(prompt, env);').length,2);
result=result.replace('callDashScopeSearch(prompt, env);','callDashScopeSearch(prompt, env, objectChoices);');
// Port only existing tested knowledge-history helpers; no schema or account
// changes. Old /v1 callers remain supported while /v2 accepts packed hashes.
const historyNames=['decodeKnowledgeHashes','loadOfferedKnowledge','noveltyContext','normalizedKnowledgeBody','knowledgeFactIdentity','hasContradictoryWaveTerminology'];
const history=historyNames.map(name=>{
  const matches=syntax.statements.filter(x=>ts.isFunctionDeclaration(x)&&x.name?.text===name);
  assert.equal(matches.length,1);return matches[0].getText(syntax).replace(/^export\s+/,'');
}).join('\n');
result=ts.transpile(history,{target:ts.ScriptTarget.ES2022})+'\n'+result;
const once=(before,after)=>{assert.equal(result.split(before).length,2,before);result=result.replace(before,after);};
once('path === "/v1/photo-insights"','(path === "/v1/photo-insights" || path === "/v2/photo-insights")');
once('return createPhotoInsight(request, env, device);','return createPhotoInsight(request, env, device, path === "/v2/photo-insights");');
once('async function createPhotoInsight(request, env, device) {','async function createPhotoInsight(request, env, device, supportsKnowledgeHistory = false) {');
once('validatePhotoInsightRequest(await readJsonObject(request, MAX_REQUEST_BYTES));','validatePhotoInsightRequest(await readJsonObject(request, MAX_REQUEST_BYTES), supportsKnowledgeHistory);');
once('function validatePhotoInsightRequest(body) {','function validatePhotoInsightRequest(body, supportsKnowledgeHistory = false) {');
once('const allowed = /* @__PURE__ */ new Set(["candidateId", "jpegBase64", "localLabels", "interests", "targetDay"]);','const allowed = new Set(["candidateId", "jpegBase64", "localLabels", "interests", "targetDay"]); if (supportsKnowledgeHistory) allowed.add("knownKnowledgeHashes");');
once('targetDay: validateTargetDay(body.targetDay)','targetDay: validateTargetDay(body.targetDay), ...(supportsKnowledgeHistory ? {knownKnowledgeIdentities:decodeKnowledgeHashes(body.knownKnowledgeHashes)} : {})');
once('const recognizedObjects = recognition.objects.slice(0, 3);',`const recognizedObjects = recognition.objects.slice(0, 3);
    const offeredKnowledge = await loadOfferedKnowledge(env, device.id);
    const offeredIdentities = new Set(await Promise.all(offeredKnowledge.map(fact=>knowledgeFactIdentity(fact.topicKey,fact.body))));
    for (const id of input.knownKnowledgeIdentities ?? []) offeredIdentities.add(id);
    const skippedCacheFacts = new Map();`);
once('const verified = await verifyFactAgainstPhoto(input.jpegBase64, object.displayName, cachedFact.fact, env);',`if (offeredIdentities.has(await knowledgeFactIdentity(topicKey,cachedFact.fact.body))) {
        skippedCacheFacts.set(topicKey,{topicKey,body:cachedFact.fact.body});
        return {candidate:null,usage,cacheFound:true,confidence:object.confidence,object,verificationReason:"already_offered"};
      }
      const verified = await verifyFactAgainstPhoto(input.jpegBase64, object.displayName, cachedFact.fact, env);`);
once('researchFacts(recognizedObjects, input.interests, env);','researchFacts(recognizedObjects, input.interests, env, [...skippedCacheFacts.values()]);');
once('async function researchFacts(objects, interests, env) {','async function researchFacts(objects, interests, env, previousFacts = []) {');
once('callDashScopeSearch(prompt, env, objectChoices);','callDashScopeSearch(prompt, env, objectChoices, previousFacts);');
once('for (const dynamic of research.candidates.sort((lhs, rhs) => factQuality(rhs.fact) - factQuality(lhs.fact))) {',`for (const dynamic of research.candidates.sort((lhs, rhs) => factQuality(rhs.fact) - factQuality(lhs.fact))) {
          if(offeredIdentities.has(await knowledgeFactIdentity(dynamic.fact.topicKey,dynamic.fact.body))) { rejectionReason="research_no_fact"; continue; }`);
once('async function verifyEvidenceSupport(fact, sources, env) {',`async function verifyEvidenceSupport(fact, sources, env) {
  if(hasContradictoryWaveTerminology(fact,sources)) return {accepted:false,reason:"contradictory_wave_terminology",usage:emptyUsage()};`);
once('return passesQualityThreshold(fact) ? { fact, sources, modelVersion: row.model_version } : null;',
  'return passesQualityThreshold(fact) && !hasContradictoryWaveTerminology(fact,sources) ? { fact, sources, modelVersion: row.model_version } : null;');
// Bound output on the existing fixed non-thinking models without changing the
// release's auth, database schema, card shape or validation thresholds.
result=result.replace('const payload = { model, messages, enable_thinking: false,','const payload = { model, messages, max_tokens: 2000, enable_thinking: false,');
result=result.replace('budgetPolicy: "actual-dispatch-day-v1"','budgetPolicy: "actual-dispatch-day-v1", researchPolicy: "evidence-first-v1", knowledgeHistory: "packed-v1"');
result=result.replace('`${env.QWEN_SEARCH_MODEL}+${env.QWEN_PLUS_MODEL}-verified`','`${env.QWEN_PLUS_MODEL}-evidence-first-v1-verified`');
await writeFile(output,result,{flag:'wx',mode:0o600});
console.log(JSON.stringify({sha256:createHash('sha256').update(result).digest('hex')}));
