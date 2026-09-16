import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import ts from '../../../backend/node_modules/typescript/lib/typescript.js';

export const BASE_SHA256='1da37fc6a12c98d88d7e8669ad701e63316973fd04b8c14347f6a3f879d6943a';

// Narrow schema-7 release: port only the existing source URL admission policy.
// No model/prompt, reviewer, authority, database, identity or quota changes.
export async function patchLiveSourceSlots(original){
  assert.equal(createHash('sha256').update(original).digest('hex'),BASE_SHA256,'Unexpected live baseline');
  const canonical=await readFile(new URL('../src/index.ts',import.meta.url),'utf8');
  const syntax=ts.createSourceFile('index.ts',canonical,ts.ScriptTarget.Latest,true);
  const named=name=>{
    const matches=syntax.statements.filter(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);
    assert.equal(matches.length,1);return matches[0].getText(syntax).replace(/^export\s+/,'');
  };
  const constants=syntax.statements.filter(node=>ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>d.name.getText(syntax)==='WEAK_RESEARCH_HOSTS'));
  assert.equal(constants.length,1);
  const selected=[constants[0].getText(syntax),named('isAcceptableResearchSourceURL'),named('isWithdrawnResearchPage')].join('\n');
  const compiled=ts.transpileModule(selected,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const begin=original.indexOf('var WEAK_RESEARCH_HOSTS = [');
  const marker='__name(isAcceptableResearchSourceURL, "isAcceptableResearchSourceURL");';
  const end=original.indexOf(marker,begin);
  assert.ok(begin>0&&end>begin);assert.equal(original.split(marker).length,2);
  let result=original.slice(0,begin)+compiled+original.slice(end+marker.length);
  const policy='candidateRecoveryPolicy: "bounded-sibling-review-v1"';
  assert.equal(result.split(policy).length,2);
  result=result.replace(policy,policy+', sourceSelectionPolicy: "readable-article-slots-v1"');
  return result;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const[input,output]=process.argv.slice(2);assert.ok(input&&output);
  const result=await patchLiveSourceSlots(await readFile(input,'utf8'));
  await writeFile(output,result,{flag:'wx',mode:0o600});
  console.log(JSON.stringify({baseSHA:BASE_SHA256,candidateSHA:createHash('sha256').update(result).digest('hex'),deployed:false}));
}
