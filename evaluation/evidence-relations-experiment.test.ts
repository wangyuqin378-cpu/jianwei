import assert from "node:assert/strict";
import test from "node:test";
import {evidenceClaims, evidenceReviewResponseFormat, interpretStructuredEvidenceReview} from "./evidence-relations-experiment.js";

const fact = {objectName:"合成设备", title:"如果合成设备离线，就使用缓存。", body:"设备离线时显示缓存，联网验证失败时显示错误。"};
const sources = [
  {sourceId:"search-1",title:"A",evidenceSnippet:"Synthetic device shows cached content while offline."},
  {sourceId:"search-2",title:"B",evidenceSnippet:"Synthetic device shows an error on authentication failure while online."}
];
const sample = () => ({checks:{
  "title:0":{evidence:[{sourceId:"search-1",quote:sources[0]!.evidenceSnippet}],reason:"Fixture mapping only",supported:true},
  "body:0":{evidence:sources.map(source => ({sourceId:source.sourceId,quote:source.evidenceSnippet})),reason:"Fixture mapping only",supported:true}
}});

test("condition and consequence stay in the same required check", () => {
  assert.deepEqual(evidenceClaims(fact).map(claim => claim.text), ["如果合成设备离线，就使用缓存", "设备离线时显示缓存，联网验证失败时显示错误"]);
  assert.deepEqual(evidenceReviewResponseFormat(fact).json_schema.schema.properties.checks.required,["title:0","body:0"]);
});

test("a relation may use two sources without inventing a combined quotation", () => {
  assert.equal(interpretStructuredEvidenceReview(sample(),fact,sources)?.accepted,true);
  const raw = sample(); raw.checks["body:0"].evidence[1]!.quote += " Invented ending.";
  assert.equal(interpretStructuredEvidenceReview(raw,fact,sources),null);
});

test("missing slots, empty support, unknown source and extra fields are invalid, not successful rejection", () => {
  for (const mutate of [
    (raw:any) => {delete raw.checks["body:0"];},
    (raw:any) => {raw.checks["body:0"].evidence=[];},
    (raw:any) => {raw.checks["body:0"].evidence[0].sourceId="missing";},
    (raw:any) => {raw.accepted=true;},
    (raw:any) => {raw.checks["body:0"].extra=true;}
  ]) {const raw=sample();mutate(raw);assert.equal(interpretStructuredEvidenceReview(raw,fact,sources),null);}
});

test("an explicit unsupported relation cannot be rescued by another sentence", () => {
  const raw=sample(); raw.checks["body:0"].supported=false; raw.checks["body:0"].evidence=[];
  assert.equal(interpretStructuredEvidenceReview(raw,fact,sources)?.accepted,false);
});
