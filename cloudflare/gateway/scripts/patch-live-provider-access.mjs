import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import ts from '../../../backend/node_modules/typescript/lib/typescript.js';

export const BASE_SHA256='f2b18415e764b1a70c37954dee53753e792fe54f8367eb1886de4746a3b11431';

// Schema-7 compatibility patch only. Do not ship the unfinished entitlement /
// accounting migrations in the working tree together with this error fix.
export async function patchLiveProviderAccess(original){
  assert.equal(createHash('sha256').update(original).digest('hex'),BASE_SHA256,'Unexpected live baseline');
  const canonical=await readFile(new URL('../src/index.ts',import.meta.url),'utf8');
  const syntax=ts.createSourceFile('index.ts',canonical,ts.ScriptTarget.Latest,true);
  const selected=['managedProviderAccessError','managedProviderAccessErrorFromBytes'].map(name=>{
    const matches=syntax.statements.filter(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);
    assert.equal(matches.length,1);return matches[0].getText(syntax);
  }).join('\n');
  const compiled=ts.transpileModule(selected,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  let result=original;
  const replace=(from,to)=>{assert.equal(result.split(from).length,2,`Expected unique patch anchor: ${from}`);result=result.replace(from,to);};
  replace('async function callCompatibleQwen(',compiled+'\nasync function callCompatibleQwen(');
  replace('if (!response.ok) throw new GatewayError(502, "vision_provider_error",',
    'if (!response.ok) throw managedProviderAccessErrorFromBytes(response.status, body) ?? new GatewayError(502, "vision_provider_error",');
  replace('if (!response.ok) throw new GatewayError(502, "research_provider_error",',
    'if (!response.ok) throw managedProviderAccessErrorFromBytes(response.status, bytes) ?? new GatewayError(502, "research_provider_error",');
  replace('return jsonError(502, "vision_provider_error",',
    'const accessError = managedProviderAccessErrorFromBytes(upstream.status, responseBody);\n    if (accessError) throw accessError;\n    return jsonError(502, "vision_provider_error",');
  const policy='sourceSelectionPolicy: "readable-article-slots-v1"';
  replace(policy,policy+', providerFailurePolicy: "typed-dependency-access-v1"');
  return result;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const[input,output]=process.argv.slice(2);assert.ok(input&&output);
  const result=await patchLiveProviderAccess(await readFile(input,'utf8'));
  await writeFile(output,result,{flag:'wx',mode:0o600});
  console.log(JSON.stringify({baseSHA:BASE_SHA256,candidateSHA:createHash('sha256').update(result).digest('hex'),deployed:false}));
}
