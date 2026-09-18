import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler } from '../netlify/functions/compile-course.mjs';

const event = (body) => ({ httpMethod: 'POST', body: JSON.stringify(body) });
const source = '[Page 1] A stack stores local variables. A heap stores dynamically allocated objects. A pointer holds an address. A program must free allocated memory when it is no longer needed. Allocation can fail and return NULL. '.repeat(2);
const citation = { source: 'Memory notes', page: 1, quote: 'A pointer holds an address.' };

test('validates requests and keeps provider errors private', async () => {
  delete process.env.OPENAI_API_KEY;
  assert.equal((await handler(event({ text: source }))).statusCode, 501);
  process.env.OPENAI_API_KEY = 'test-placeholder';
  assert.equal((await handler({ httpMethod: 'GET' })).statusCode, 405);
  assert.equal((await handler({ httpMethod: 'POST', body: '{' })).statusCode, 400);
  assert.equal((await handler(event({ text: {} }))).statusCode, 400);
  assert.equal((await handler(event({ text: 'short' }))).statusCode, 400);
  assert.equal((await handler(event({ text: 'x'.repeat(1000001) }))).statusCode, 413);
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: { code: 'invalid_api_key', message: 'Do not expose secret-fragment' } }) });
  try {
    const response = await handler(event({ text: source }));
    assert.equal(response.statusCode, 502);
    assert.equal(JSON.parse(response.body).code, 'invalid_api_key');
    assert.ok(!response.body.includes('secret-fragment'));
  } finally { globalThis.fetch = original; delete process.env.OPENAI_API_KEY; }
});

test('four specialist stages pass context, apply critic corrections and reject unsupported output', async () => {
  process.env.OPENAI_API_KEY = 'test-placeholder';
  const names = ['Stack', 'Heap', 'Pointers', 'Free'];
  const results = [
    { title: 'Memory', concepts: names.map(title => ({ title, importance: 'core', prerequisiteTitles: title === 'Free' ? ['Heap'] : [], whyItMatters: 'Memory safety' })) },
    { conceptEvidence: names.map(conceptTitle => ({ conceptTitle, evidence: 'Source evidence', citation })), claims: names.map(conceptTitle => ({ conceptTitle, text: 'Claim', citation })) },
    { prompts: names.map(conceptTitle => ({ conceptTitle, prompt: 'Explain this concept', expectedAnswer: 'Original answer', citation, difficulty: 'explain' })) },
    { promptReviews: names.map((_, promptIndex) => ({ promptIndex, verdict: promptIndex === 0 ? 'rejected' : 'approved', note: 'Checked source', correctedExpectedAnswer: promptIndex === 1 ? 'Corrected answer' : null })), claimReviews: names.map((_, claimIndex) => ({ claimIndex, verdict: claimIndex === 0 ? 'rejected' : 'approved', note: 'Checked source' })) },
  ];
  const requests = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const request = JSON.parse(options.body);
    requests.push(request);
    assert.equal(request.store, false);
    assert.equal(request.text.format.strict, true);
    return { ok: true, json: async () => ({ output: [{ content: [{ text: JSON.stringify(results[requests.length - 1]) }] }] }) };
  };
  try {
    const response = await handler(event({ text: source, sourceName: 'Memory notes' }));
    assert.equal(response.statusCode, 200);
    const { course } = JSON.parse(response.body);
    assert.deepEqual(requests.map(r => r.text.format.name), ['projlearn_cartographer', 'projlearn_scholar', 'projlearn_examiner', 'projlearn_critic']);
    assert.match(requests[1].input, /CONCEPT MAP/);
    assert.match(requests[2].input, /SCHOLAR NOTES/);
    assert.match(requests[3].input, /PROMPTS/);
    assert.equal(course.prompts.length, 3);
    assert.equal(course.claims.length, 3);
    assert.equal(course.prompts[0].expectedAnswer, 'Corrected answer');
    assert.equal(course.prompts[0].citation.page, 1);
    assert.deepEqual(course.edges, [{ from: 'heap', to: 'free', relation: 'prerequisite' }]);
    assert.equal(course.ai.enabled, true);
    assert.equal(course.trace.length, 5);
  } finally { globalThis.fetch = original; delete process.env.OPENAI_API_KEY; }
});
