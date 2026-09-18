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

test('single AI pass compiles concepts, claims and prompts with deterministic source checks', async () => {
  process.env.OPENAI_API_KEY = 'test-placeholder';
  const names = ['Stack', 'Heap', 'Pointers', 'Free'];
  const result = {
    title: 'Memory',
    concepts: names.map(title => ({
      title,
      importance: 'core',
      prerequisiteTitles: title === 'Free' ? ['Heap'] : [],
      whyItMatters: 'Memory safety',
      evidence: 'Source evidence',
      citation,
    })),
    claims: names.map(conceptTitle => ({ conceptTitle, text: 'Claim', citation })),
    prompts: names.map(conceptTitle => ({
      conceptTitle,
      prompt: 'Explain this concept',
      expectedAnswer: 'A pointer holds an address.',
      citation,
      difficulty: 'explain',
    })),
  };

  const requests = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const request = JSON.parse(options.body);
    requests.push(request);
    assert.equal(request.store, false);
    assert.equal(request.text.format.strict, true);
    return { ok: true, json: async () => ({ output: [{ content: [{ text: JSON.stringify(result) }] }] }) };
  };

  try {
    const response = await handler(event({ text: source, sourceName: 'Memory notes' }));
    assert.equal(response.statusCode, 200);
    const { course } = JSON.parse(response.body);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].text.format.name, 'projlearn_course_compiler');
    assert.equal(course.prompts.length, 4);
    assert.equal(course.claims.length, 4);
    assert.equal(course.prompts[0].verification, 'source-verified');
    assert.deepEqual(course.edges, [{ from: 'heap', to: 'free', relation: 'prerequisite' }]);
    assert.equal(course.ai.enabled, true);
    assert.equal(course.ai.architecture, 'single-pass');
    assert.equal(course.trace.length, 3);
  } finally { globalThis.fetch = original; delete process.env.OPENAI_API_KEY; }
});
