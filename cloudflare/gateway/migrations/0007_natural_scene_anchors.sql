INSERT INTO knowledge_facts (
  topic_key,
  fact_id,
  object_name,
  photo_requirement,
  title,
  body,
  source_json,
  scores_json,
  model_version,
  evidence_summary,
  created_at,
  last_used_at
) VALUES (
  'water_caustics',
  'water-caustics-reviewed-001',
  '水面焦散光纹',
  NULL,
  '水面亮纹会给猎物打掩护',
  '它不只好看：野外礁鱼实验发现，动态水面焦散会拖慢鱼锁定移动猎物；浅水常见的细而锐光纹，造成的攻击延迟最长。',
  '[{"sourceId":"src-bristol-water-caustics","title":"Natural light flicker can help prevent detection","url":"https://www.bristol.ac.uk/news/2020/april/water-caustics.html","publisher":"University of Bristol","authority":"professional","evidenceSnippet":"Dynamic water caustics significantly increased triggerfish attack latency; fine, sharp caustics produced the longest delays."},{"sourceId":"src-pubmed-water-caustics","title":"Underwater caustics disrupt prey detection by a reef fish","url":"https://pubmed.ncbi.nlm.nih.gov/32228405/","publisher":"PubMed","authority":"official","evidenceSnippet":"The study reports that dynamic water caustics impaired detection of moving prey, with fine and sharp patterns producing the longest attack latencies."}]',
  '{"surprise":4,"aha":4,"retellability":5,"imageConnection":4}',
  'reviewed-catalog-v325',
  '布里斯托大学新闻稿与 PubMed 论文摘要都直接报告：动态水面焦散延长礁鱼攻击移动猎物的时间，细而锐的光纹造成最长延迟。',
  '2026-09-05T00:00:00.000Z',
  '2026-09-05T00:00:00.000Z'
) ON CONFLICT(topic_key) DO UPDATE SET
  fact_id = excluded.fact_id,
  object_name = excluded.object_name,
  photo_requirement = excluded.photo_requirement,
  title = excluded.title,
  body = excluded.body,
  source_json = excluded.source_json,
  scores_json = excluded.scores_json,
  model_version = excluded.model_version,
  evidence_summary = excluded.evidence_summary,
  last_used_at = excluded.last_used_at;

INSERT INTO knowledge_topic_aliases (alias, topic_key) VALUES
  ('water_caustics', 'water_caustics'),
  ('caustics', 'water_caustics'),
  ('water surface caustics', 'water_caustics'),
  ('水面焦散光纹', 'water_caustics'),
  ('焦散光纹', 'water_caustics'),
  ('焦散', 'water_caustics')
ON CONFLICT(alias, topic_key) DO NOTHING;
