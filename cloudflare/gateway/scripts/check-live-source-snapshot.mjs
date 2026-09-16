import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';

const [bundlePath, configPath, receiptPath] = process.argv.slice(2);
assert.ok(bundlePath && configPath && receiptPath);
const script = await readFile(bundlePath, 'utf8');
const config = JSON.parse(await readFile(configPath, 'utf8'));
const hash = value => createHash('sha256').update(value).digest('hex');
const bindings = {...config.vars, DASHSCOPE_HOST: 'model.example.org', DASHSCOPE_API_KEY: 'synthetic-not-a-key'};
const text = 'Synthetic article: the offset test rotor transfers a periodic test force to the casing. This is isolated transport data, not publishable knowledge.';
const sourceURL = 'https://example.edu/verified-article';
const gapURL = 'https://example.edu/unavailable-article';
const topicKey = 'synthetic_snapshot', objectName = '合成测试物件';
const fact = {topicKey, objectName, title: '这是只用于回归的合成知识标题',
  body: '这条合成知识只验证写作与审核使用相同来源原文，不是真实事实也绝不发布给用户。[ref_1]',
  evidenceSummary: 'Synthetic transport evidence. [ref_1]', citedSourceIndexes: [1],
  surprise: 4, aha: 4, retellability: 4, imageConnection: 4};
let scenario, sourceReads = 0, gapReads = 0, modelCalls = 0, searches = 0, writerCalls = 0, evidenceCalls = 0;
let writerSources;
const mf = new Miniflare(convertV4MiniflareOptions({modules: true, script,
  compatibilityDate: config.compatibility_date, bindings, d1Databases: ['DB'], outboundService: async request => {
    if (request.url === gapURL) { gapReads++; return new Response('Temporarily unavailable', {status: 503}); }
    if (request.url === sourceURL) {
      sourceReads++;
      if (scenario === 'initial-unavailable' || sourceReads > 1) return new Response('Temporarily unavailable', {status: 503});
      return new Response(`<article>${text}</article>`, {headers: {'Content-Type': 'text/html'}});
    }
    assert.equal(new URL(request.url).hostname, 'model.example.org', 'No real outbound access');
    modelCalls++;
    const p = await request.json();
    if (request.url.endsWith('/responses')) {
      searches++;
      return Response.json({status: 'completed', output: [{type: 'web_search_call', status: 'completed',
        action: {sources: [{url: gapURL, title: 'Unavailable result'}, {url: sourceURL, title: 'Synthetic verified source'}]}}],
        usage: {input_tokens: 1, output_tokens: 1}});
    }
    const c = p.messages[0].content, prompt = typeof c === 'string' ? c : c[0].text;
    let raw;
    if (p.model === bindings.QWEN_FLASH_MODEL) {
      raw = {primaryObject: {topicKey, displayName: objectName, confidence: .98}, secondaryObjects: [], sensitiveFlags: []};
    } else if (p.model === bindings.QWEN_VERIFICATION_MODEL) {
      raw = {accepted: true, objectMatches: true, scopeGrounded: true, requiredVisualFeaturesVisible: true, reason: 'synthetic match'};
    } else if (prompt.startsWith('你为照片写每日知识卡')) {
      writerCalls++;
      writerSources = JSON.parse(prompt.split('\n').at(-1));
      assert.equal(writerSources.length, 1);
      assert.equal(writerSources[0].ref, '[ref_1]', 'A failed first result must not leave sparse writer IDs');
      assert.equal(writerSources[0].text, text);
      raw = {candidates: scenario === 'missing-citation'
        ? [{...fact, body: fact.body + '[ref_3]', citedSourceIndexes: [1, 3]}]
        : scenario === 'sibling-candidate' ? [{...fact, title: '应被拒绝的第一条合成知识'}, fact] : [fact]};
    } else if (prompt.startsWith('你是独立证据审核器')) {
      evidenceCalls++;
      const claims = JSON.parse(prompt.match(/^CLAIMS_JSON:(.+)$/m)[1]);
      const sources = JSON.parse(prompt.match(/^证据：(.+)$/m)[1]);
      assert.equal(sources.length, 1);
      assert.equal(sources[0].sourceId, 'search-1');
      assert.equal(sources[0].text, writerSources[0].text, 'Writer and reviewer must see identical evidence');
      const accepted = scenario !== 'unsupported' && !prompt.includes('应被拒绝的第一条合成知识');
      raw = {checks: Object.fromEntries(claims.map(claim => [claim.id,
        {sourceId: 'search-1', quote: text.slice(0, 95), reason: 'synthetic evidence control', supported: accepted}]))};
    } else {
      raw = {accepted: true, surprise: 4, aha: 4, retellability: 4, imageConnection: 4, reason: 'synthetic quality control'};
    }
    return Response.json({choices: [{finish_reason: 'stop', message: {content: JSON.stringify(raw)}}],
      usage: {prompt_tokens: 1, completion_tokens: 1}});
  }
}));
const results = [];
try {
  const db = await mf.getD1Database('DB');
  for (const name of ['0001_initial.sql', '0002_product_endpoints.sql', '0003_knowledge_topic_aliases.sql',
    '0004_photo_requirements.sql', '0005_usage_reservations.sql', '0006_target_day_usage.sql', '0007_natural_scene_anchors.sql']) {
    for (const statement of unstable_splitSqlQuery(await readFile(new URL('../migrations/' + name, import.meta.url), 'utf8'))) {
      await db.prepare(statement).run();
    }
  }
  for (scenario of ['second-read-fails', 'unsupported', 'missing-citation', 'sibling-candidate', 'initial-unavailable']) {
    // Only the isolated in-memory fixture is reset; no remote DB or quota change.
    await db.prepare('DELETE FROM knowledge_facts').run();
    sourceReads = 0; gapReads = 0; writerCalls = 0; evidenceCalls = 0; writerSources = undefined;
    const beforeModels = modelCalls, index = results.length;
    const token = `synthetic-snapshot-${index}`.padEnd(43, 't'), now = new Date().toISOString();
    await db.prepare('INSERT INTO devices VALUES (?,?,?,?,?)').bind(`snapshot-${index}`, `install-${index}`, hash(token), now, now).run();
    const body = {candidateId: `550e8400-e29b-41d4-a716-${String(index).padStart(12, '0')}`,
      jpegBase64: Buffer.concat([Buffer.from([255,216,255]), Buffer.alloc(40)]).toString('base64'),
      localLabels: [], interests: [], knownKnowledgeHashes: ''};
    const dispatch = () => mf.dispatchFetch('https://local.invalid/v2/photo-insights', {method: 'POST',
      headers: {Authorization: `Bearer ${token}`, 'Idempotency-Key': `synthetic-snapshot-${index}`, 'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    const response = await dispatch(), result = await response.json();
    assert.equal(response.status, scenario === 'initial-unavailable' ? 503 : 200, JSON.stringify({scenario, result}));
    assert.equal(sourceReads, 1, 'A verified article must be read once per analysis, not once per candidate');
    assert.equal(gapReads, 1);
    if (scenario === 'initial-unavailable') {
      assert.equal(writerCalls, 0);
      assert.equal(result.error.code, 'source_temporarily_unavailable');
      assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM idempotency_results WHERE device_id=?').bind(`snapshot-${index}`).first()).n, 0);
    } else {
      const ready = ['second-read-fails', 'sibling-candidate'].includes(scenario);
      assert.equal(result.status, ready ? 'ready' : 'no_insight');
      if (ready) {
        assert.equal(result.card.title, fact.title);
        assert.equal(result.card.sources[0].url, sourceURL);
        assert.equal(result.card.sources[0].evidenceSnippet, text);
      }
      if (scenario === 'missing-citation') assert.equal(evidenceCalls, 0);
      if (scenario === 'sibling-candidate') assert.equal(evidenceCalls, 2);
      const count = modelCalls;
      assert.deepEqual(await (await dispatch()).json(), result);
      assert.equal(modelCalls, count, 'Idempotent replay must not call models');
      assert.equal(sourceReads, 1, 'Idempotent replay must not refetch sources');
    }
    results.push({scenario, http: response.status, status: result.status, modelCalls: modelCalls - beforeModels,
      sourceReads, gapReads, writerCalls, evidenceCalls});
  }
  const receipt = {passed: true, actualRuntime: 'workerd', moduleSHA: hash(script), existingSchema7: true,
    realExternalCalls: 0, modelCalls, searches, results};
  await writeFile(receiptPath, JSON.stringify(receipt), {flag: 'wx', mode: 0o600});
  console.log(JSON.stringify(receipt));
} finally { await mf.dispose(); }
