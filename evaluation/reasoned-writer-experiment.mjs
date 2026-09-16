import assert from 'node:assert/strict';

// Evaluation-only. Preserve messages, source data, model, and temperature.
export function withReasonedWriterV1(payload) {
  assert.ok(payload.messages?.[0]?.content?.startsWith('你为照片写每日知识卡。'));
  assert.equal(payload.response_format?.type,'json_object');
  assert.equal(payload.enable_thinking,false);
  const properties=Object.fromEntries(['topicKey','objectName','evidenceSummary','title','body'].map(key=>[key,{type:'string'}]));
  properties.citedSourceIndexes={type:'array',items:{type:'integer'}};
  for(const key of ['surprise','aha','retellability','imageConnection'])properties[key]={type:'integer',minimum:1,maximum:5};
  return {...payload,enable_thinking:true,thinking_budget:1024,max_tokens:3072,
    response_format:{type:'json_schema',json_schema:{name:'photo_knowledge_candidates_v1',strict:true,
      schema:{type:'object',additionalProperties:false,properties:{candidates:{type:'array',maxItems:3,
        items:{type:'object',additionalProperties:false,properties,required:Object.keys(properties)}}},required:['candidates']}}}};
}
