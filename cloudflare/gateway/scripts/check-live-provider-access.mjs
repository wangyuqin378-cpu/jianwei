import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {unstable_splitSqlQuery} from 'wrangler';

// Isolated workerd + in-memory D1, no real outbound access or provider key.
const [bundlePath,configPath,receiptPath]=process.argv.slice(2);
assert.ok(bundlePath&&configPath&&receiptPath);
const script=await readFile(bundlePath,'utf8'),config=JSON.parse(await readFile(configPath,'utf8'));
const sha=x=>createHash('sha256').update(x).digest('hex');
const baseline=process.argv[5]==='--baseline';
if(baseline)assert.equal(sha(script),'f2b18415e764b1a70c37954dee53753e792fe54f8367eb1886de4746a3b11431');
const bindings={...config.vars,DASHSCOPE_HOST:'model.example.org',DASHSCOPE_API_KEY:'synthetic-not-a-key'};
let modelCalls=0,searches=0,scenario,unavailable;
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script,compatibilityDate:config.compatibility_date,bindings,d1Databases:['DB'],outboundService:async request=>{
  assert.equal(new URL(request.url).hostname,'model.example.org','All outbound must stay within the synthetic model transport');
  modelCalls++;
  const search=request.url.endsWith('/responses');if(search)searches++;
  const payload=await request.json();
  if(unavailable&&(scenario.stage!=='search'||search))return new Response(
    typeof scenario.body==='string'?scenario.body:JSON.stringify(scenario.body),{status:scenario.status});
  const primary=unavailable?{topicKey:'synthetic_object',displayName:'合成测试物件',confidence:0.98}:null;
  assert.equal(search,false,'Recovery may return completed no-object recognition, never perform live research');
  return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({primaryObject:primary,secondaryObjects:[],sensitiveFlags:[]})}}],usage:{prompt_tokens:1,completion_tokens:1}});
}}));
let cases=0;const failedDispatchCounts=[];
try{
  const db=await mf.getD1Database('DB');
  for(const name of ['0001_initial.sql','0002_product_endpoints.sql','0003_knowledge_topic_aliases.sql','0004_photo_requirements.sql','0005_usage_reservations.sql','0006_target_day_usage.sql','0007_natural_scene_anchors.sql']){
    const sql=await readFile(new URL('../migrations/'+name,import.meta.url),'utf8');
    for(const statement of unstable_splitSqlQuery(sql))await db.prepare(statement).run();
  }
  const initialFacts=(await db.prepare('SELECT * FROM knowledge_facts ORDER BY topic_key').all()).results;
  const scenarios=[
    {stage:'flash',status:401,body:'not JSON',expected:424},
    {stage:'flash',status:403,body:{code:'Arrearage'},expected:424},
    {stage:'flash',status:403,body:{error:{code:'AccessDenied.Unpurchased'}},expected:424},
    {stage:'flash',status:403,body:{error:{code:'AllocationQuota.FreeTierOnly'}},expected:424},
    {stage:'flash',status:403,body:{error:{code:'DataInspectionFailed',message:'Arrearage'}},expected:502},
    {stage:'flash',status:429,body:{code:'Arrearage'},expected:502},
    {stage:'search',status:401,body:{error:{code:'invalid_api_key'}},expected:424},
    {stage:'search',status:403,body:{error:{code:'Arrearage'}},expected:424},
    {stage:'legacy',status:401,body:'not JSON',expected:424},
    {stage:'legacy',status:403,body:{code:'AccessDenied.Unpurchased'},expected:424}
  ];
  for(scenario of scenarios){
    // Per-case synthetic identities are inserted only in this local in-memory DB.
    const device=`synthetic-access-${cases}`,token=`synthetic-token-${cases}`.padEnd(43,'t'),now=new Date().toISOString();
    await db.prepare('INSERT INTO devices VALUES (?,?,?,?,?)').bind(device,device,sha(token),now,now).run();
    const headers={Authorization:`Bearer ${token}`,'Idempotency-Key':`synthetic-access-${cases}`,'Content-Type':'application/json'};
    const body=scenario.stage==='legacy'?{model:bindings.QWEN_FLASH_MODEL,enable_thinking:false,response_format:{type:'json_object'},temperature:0,messages:[{role:'user',content:'Synthetic transport check'}]}:
      {candidateId:`550e8400-e29b-41d4-a716-${String(cases).padStart(12,'0')}`,jpegBase64:Buffer.concat([Buffer.from([255,216,255]),Buffer.alloc(40)]).toString('base64'),localLabels:[],interests:[]};
    const route=scenario.stage==='legacy'?'/v1/qwen/chat/completions':'/v1/photo-insights';
    const request=()=>mf.dispatchFetch('https://local.invalid'+route,{method:'POST',headers,body:JSON.stringify(body)});
    unavailable=true;const before=modelCalls;
    const response=await request(),error=await response.json();
    const expected=baseline?502:scenario.expected;
    assert.equal(response.status,expected,JSON.stringify({scenario,error}));
    assert.equal(error.error.code,expected===424?'managed_provider_access_unavailable':scenario.stage==='search'?'research_provider_error':'vision_provider_error');
    assert.equal(modelCalls-before,scenario.stage==='search'?2:1);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM idempotency_results WHERE device_id=?').bind(device).first()).n,0);
    assert.deepEqual((await db.prepare('SELECT * FROM knowledge_facts ORDER BY topic_key').all()).results,initialFacts,'No generated fact is inserted or changed after failure');
    const charged=(await db.prepare('SELECT * FROM usage_counters ORDER BY scope,period').all()).results;
    // Schema 7 releases reservations after failures and has success-only usage
    // summaries. Record the actual counters for a baseline comparison; do not
    // mistake them for a complete failed-call cost journal or zero AI cost.
    failedDispatchCounts.push(charged.map(({scope,period,request_count})=>({scope,period,request_count})));
    unavailable=false;
    const recovered=await request(),result=await recovered.json();assert.equal(recovered.status,200,JSON.stringify(result));
    if(scenario.stage!=='legacy'){
      assert.equal(result.status,'no_insight');
      const count=modelCalls,counters=(await db.prepare('SELECT * FROM usage_counters ORDER BY scope,period').all()).results;
      assert.deepEqual(await(await request()).json(),result);assert.equal(modelCalls,count);
      assert.deepEqual((await db.prepare('SELECT * FROM usage_counters ORDER BY scope,period').all()).results,counters);
    }
    cases++;
  }
  const health=await(await mf.dispatchFetch('https://local.invalid/health')).json();assert.equal(health.providerFailurePolicy,baseline?undefined:'typed-dependency-access-v1');
  const receipt={passed:true,actualRuntime:'workerd',existingSchema7:true,moduleSHA:sha(script),baseline,cases,modelCalls,searches,realExternalCalls:0,recoverablePhoto:true,failedCallCostJournalPresent:false,failedDispatchCounts};
  await writeFile(receiptPath,JSON.stringify(receipt),{flag:'wx',mode:0o600});
  console.log(JSON.stringify({...receipt,failedDispatchCounts:undefined}));
}finally{await mf.dispose();}
