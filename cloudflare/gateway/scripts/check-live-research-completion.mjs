import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';
import {unstable_splitSqlQuery} from 'wrangler';

const [bundlePath, configPath, receiptPath, observedPath] = process.argv.slice(2);
assert.ok(bundlePath && configPath && receiptPath);
const script = await readFile(bundlePath,'utf8');
const config = JSON.parse(await readFile(configPath,'utf8'));
const hash = x=>createHash('sha256').update(x).digest('hex');
const bindings = {...config.vars,DASHSCOPE_HOST:'model.example.org',DASHSCOPE_API_KEY:'synthetic-key'};
const text = 'Synthetic evidence solely for malformed-response and idempotency checks. The test object has a synthetic mechanism. Never publish this fixture.';
const sourceURL = 'https://example.edu/completion-fixture';
const fact = {topicKey:'test_object',objectName:'合成测试物件',title:'这一条是合成测试知识的标题',
  body:'这一段文字只用于验证不完整输出和重试逻辑，不是真实知识，也不会展示给产品用户。[ref_1]',
  evidenceSummary:'Synthetic fixture. [ref_1]',citedSourceIndexes:[1],surprise:4,aha:4,retellability:4,imageConnection:4};
const noScores = {...fact}; for (const key of ['surprise','aha','retellability','imageConnection']) delete noScores[key];
const scenarios = [
  {name:'missing-all-scores',raw:{candidates:[noScores]},error:true},
  ...[{}, {candidates:null}, {candidates:{}}, {candidates:[fact,fact,fact,fact]}].map((raw,i)=>({name:`invalid-envelope-${i}`,raw,error:true})),
  ...[null, [], {...fact,aha:'4'}, {...fact,body:['not text']}, {...fact,citedSourceIndexes:undefined}, {...fact,photoRequirement:42}]
    .map((raw,i)=>({name:`invalid-candidate-${i}`,raw:{candidates:[raw]},error:true})),
  {name:'valid-sibling-survives',raw:{candidates:[noScores,fact]},ready:true},
  {name:'low-score-sibling-not-terminal',raw:{candidates:[noScores,{...fact,aha:3}]},error:true},
  {name:'rejected-review-sibling-not-terminal',raw:{candidates:[fact,noScores]},rejectEvidence:true,error:true},
  {name:'explicit-empty',raw:{candidates:[]}},
  {name:'complete-zero-score',raw:{candidates:[{...fact,aha:0}]}},
  {name:'complete-no-sources',raw:{candidates:[{...fact,citedSourceIndexes:[]}]}},
  {name:'complete-low-interest',raw:{candidates:[{...fact,aha:3}]}},
  {name:'complete-evidence-rejection',raw:{candidates:[fact]},rejectEvidence:true}
];
if(observedPath) {
  const reply=JSON.parse(await readFile(observedPath,'utf8'));
  scenarios.push({name:'observed-live-writer-missing-scores',raw:JSON.parse(reply.choices[0].message.content),error:true});
}
let current, inject=true, modelCalls=0, searches=0, sourceReads=0;
const mf = new Miniflare(convertV4MiniflareOptions({modules:true,script,compatibilityDate:config.compatibility_date,
  bindings,d1Databases:['DB'],outboundService:async request=>{
    if(request.url===sourceURL){sourceReads++;return new Response(`<article>${text}</article>`,{headers:{'Content-Type':'text/html'}});}
    assert.equal(new URL(request.url).hostname,'model.example.org','No real external access');
    modelCalls++; const p=await request.json();
    if(request.url.endsWith('/responses')){
      searches++;return Response.json({status:'completed',output:[{type:'web_search_call',status:'completed',action:{sources:[{url:sourceURL,title:'Synthetic article'}]}}],usage:{input_tokens:1,output_tokens:1}});
    }
    const c=p.messages[0].content,prompt=typeof c==='string'?c:c[0].text;let raw;
    if(p.model===bindings.QWEN_FLASH_MODEL)raw={primaryObject:{topicKey:fact.topicKey,displayName:fact.objectName,confidence:.98},secondaryObjects:[],sensitiveFlags:[]};
    else if(p.model===bindings.QWEN_VERIFICATION_MODEL)raw={accepted:true,objectMatches:true,scopeGrounded:true,requiredVisualFeaturesVisible:true,visibleEvidence:['synthetic'],reason:'synthetic'};
    else if(prompt.startsWith('你为照片写每日知识卡'))raw=inject?current.raw:{candidates:[fact]};
    else if(prompt.startsWith('你是独立证据审核器')){
      const claims=JSON.parse(prompt.match(/^CLAIMS_JSON:(.+)$/m)[1]);
      raw={checks:Object.fromEntries(claims.map(claim=>[claim.id,{sourceId:'search-1',quote:text.slice(0,90),reason:'synthetic',supported:!(inject&&current.rejectEvidence)}]))};
    }else raw={accepted:true,surprise:4,aha:4,retellability:4,imageConnection:4,reason:'synthetic'};
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(raw)}}],usage:{prompt_tokens:1,completion_tokens:1}});
  }}));
const results=[];
try{
  const db=await mf.getD1Database('DB');
  for(const name of ['0001_initial.sql','0002_product_endpoints.sql','0003_knowledge_topic_aliases.sql','0004_photo_requirements.sql','0005_usage_reservations.sql','0006_target_day_usage.sql','0007_natural_scene_anchors.sql'])
    for(const statement of unstable_splitSqlQuery(await readFile(new URL('../migrations/'+name,import.meta.url),'utf8')))await db.prepare(statement).run();
  for(current of scenarios){
    // Isolated fixture only. Never touches production data or counters.
    await db.prepare('DELETE FROM knowledge_facts').run();inject=true;
    const index=results.length,id=`completion-${index}`,token=id.padEnd(43,'t'),now=new Date().toISOString(),before=modelCalls;
    await db.prepare('INSERT INTO devices VALUES (?,?,?,?,?)').bind(id,`install-${index}`,hash(token),now,now).run();
    const body={candidateId:`550e8400-e29b-41d4-a716-${String(index).padStart(12,'0')}`,jpegBase64:Buffer.concat([Buffer.from([255,216,255]),Buffer.alloc(40)]).toString('base64'),localLabels:[],interests:[],knownKnowledgeHashes:''};
    const dispatch=()=>mf.dispatchFetch('https://local.invalid/v2/photo-insights',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Idempotency-Key':`synthetic-completion-${index}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
    const first=await dispatch(),result=await first.json();
    assert.equal(first.status,current.error?502:200,JSON.stringify({scenario:current.name,result}));
    const firstCalls=modelCalls-before;
    if(current.error){
      assert.equal(result.error.code,'invalid_research_response');
      assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM idempotency_results WHERE device_id=?').bind(id).first()).n,0);
      assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM knowledge_facts').first()).n,0);
      inject=false;const retried=await dispatch(),ready=await retried.json();assert.equal(retried.status,200);assert.equal(ready.status,'ready');
      assert.equal(ready.card.title,fact.title);
      const count=modelCalls;assert.deepEqual(await(await dispatch()).json(),ready);assert.equal(modelCalls,count,'No model calls for completed same-key replay');
    }else{
      assert.equal(result.status,current.ready?'ready':'no_insight');const count=modelCalls;
      assert.deepEqual(await(await dispatch()).json(),result);assert.equal(modelCalls,count,'Explicit no-insight and ready remain terminal');
    }
    const usage=await db.prepare('SELECT COUNT(*) AS n FROM usage_events WHERE device_id=?').bind(id).first();
    assert.equal(usage.n,1,'Exactly one successful analysis usage record, not a free-upstream-call claim');
    results.push({scenario:current.name,http:first.status,status:result.status,firstCalls,totalCalls:modelCalls-before,retryRecovered:Boolean(current.error)});
  }
  const receipt={passed:true,actualRuntime:'workerd',moduleSHA:hash(script),existingSchema7:true,realExternalCalls:0,modelCalls,searches,sourceReads,results};
  await writeFile(receiptPath,JSON.stringify(receipt),{flag:'wx',mode:0o600});console.log(JSON.stringify(receipt));
}finally{await mf.dispose();}
