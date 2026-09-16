import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import ts from '../../../backend/node_modules/typescript/lib/typescript.js';

export const BASE_SHA256='7e3c7e191e790db13bd6df547bc0de742033c97b2b381af19e55120b669d843a';

// Port only candidate-local review recovery into the existing schema-7 release.
// No deployment, subscription, model, source, threshold or budget changes here.
export async function patchLiveCandidateRecovery(original){
  assert.equal(createHash('sha256').update(original).digest('hex'),BASE_SHA256,'Unexpected live baseline');
  const canonical=await readFile(new URL('../src/index.ts',import.meta.url),'utf8');
  const syntax=ts.createSourceFile('index.ts',canonical,ts.ScriptTarget.Latest,true);
  const helpers=syntax.statements.filter(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='isCandidateReviewError');
  assert.equal(helpers.length,1);
  const helper=ts.transpileModule(helpers[0].getText(syntax),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  let result=original;
  const replace=(before,after)=>{assert.equal(result.split(before).length,2,`Expected single patch site: ${before.slice(0,80)}`);result=result.replace(before,after);};
  replace('    let rejectionReason = cachedAttempts.some(', '    let incompleteReview = null;\n    let rejectionReason = cachedAttempts.some(');
  replace(`            const reviewFailure = reviewResults.find(result => result.status === "rejected");
            if (reviewFailure) throw reviewFailure.reason;
            const [evidence, verified, quality] = reviewResults.map(result => result.value);
            addUsage(recognition.usage, evidence.usage);
            addUsage(recognition.usage, verified.usage);
            addUsage(recognition.usage, quality.usage);`, `            for (const review of reviewResults) {
              if (review.status === "fulfilled") addUsage(recognition.usage, review.value.usage);
            }
            const reviewFailures = reviewResults.filter(review => review.status === "rejected");
            const serviceFailure = reviewFailures.find(review => !isCandidateReviewError(review.reason));
            if (serviceFailure) throw serviceFailure.reason;
            if (reviewFailures.length) {
              incompleteReview ??= reviewFailures[0].reason;
              evaluationDiagnostics?.push({ stage: "dynamic_review_incomplete", topicKey: dynamic.fact.topicKey });
              continue;
            }
            const [evidence, verified, quality] = reviewResults.map(result => result.value);`);
  replace('    if (!selected && cacheFailure) throw cacheFailure.reason;', '    if (!selected && cacheFailure) throw cacheFailure.reason;\n    if (!selected && incompleteReview) throw incompleteReview;');
  replace('async function verifyEvidenceSupport(',helper+'\nasync function verifyEvidenceSupport(');
  replace('recognitionPolicy: "primary-object-v1"','recognitionPolicy: "primary-object-v1", candidateRecoveryPolicy: "bounded-sibling-review-v1"');
  return result;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const[input,output]=process.argv.slice(2);assert.ok(input&&output);
  const result=await patchLiveCandidateRecovery(await readFile(input,'utf8'));
  await writeFile(output,result,{flag:'wx',mode:0o600});
  console.log(JSON.stringify({baseSHA:BASE_SHA256,candidateSHA:createHash('sha256').update(result).digest('hex'),deployed:false}));
}
