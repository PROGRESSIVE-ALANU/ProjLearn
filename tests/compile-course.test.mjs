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
    summary: {
      overview: 'Memory management covers stack, heap, pointers, and freeing allocations.',
      keyPoints: ['Stack stores locals.', 'Heap stores dynamic objects.', 'Pointers hold addresses.'],
      studyFocus: ['Pointers', 'Freeing allocations'],
    },
    concepts: names.map(title => ({
      title,
      importance: 'core',
      prerequisiteTitles: title === 'Free' ? ['Heap'] : [],
      whyItMatters: 'Memory safety',
      evidence: 'Source evidence',
      citation,
    })),
    claims: names.map(conceptTitle => ({ conceptTitle, text: 'Claim', citation })),
    prompts: names.map((conceptTitle, index) => ({
      conceptTitle,
      prompt: index % 2 ? 'Which statement is correct?' : 'Explain this concept',
      expectedAnswer: 'A pointer holds an address.',
      questionType: index % 2 ? 'multiple_choice' : 'free_response',
      choices: index % 2 ? ['A pointer holds an address.', 'A pointer stores the object itself.', 'A pointer is always NULL.', 'A pointer lives only on the heap.'] : [],
      correctChoiceIndex: index % 2 ? 0 : null,
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
    assert.equal(course.summary.keyPoints.length, 3);
    assert.equal(course.prompts[0].verification, 'source-verified');
    assert.equal(course.prompts[1].questionType, 'multiple_choice');
    assert.equal(course.prompts[1].choices.length, 4);
    assert.equal(course.prompts[1].correctChoiceIndex, 0);
    assert.deepEqual(course.edges, [{ from: 'heap', to: 'free', relation: 'prerequisite' }]);
    assert.equal(course.ai.enabled, true);
    assert.equal(course.ai.architecture, 'single-pass');
    assert.equal(course.trace.length, 3);
  } finally { globalThis.fetch = original; delete process.env.OPENAI_API_KEY; }
});
