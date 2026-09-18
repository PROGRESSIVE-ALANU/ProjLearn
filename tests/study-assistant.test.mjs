import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler } from '../netlify/functions/study-assistant.mjs';

const event = (body) => ({ httpMethod: 'POST', body: JSON.stringify(body) });

test('semantic grader uses structured meaning-based grading', async () => {
  process.env.OPENAI_API_KEY = 'test-placeholder';
  const original = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    request = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        output: [{
          content: [{
            text: JSON.stringify({
              verdict: 'correct',
              feedback: 'Equivalent meaning.',
              missingPoint: null,
            }),
          }],
        }],
      }),
    };
  };

  try {
    const response = await handler(event({
      mode: 'grade',
      question: 'What is the net value?',
      expectedAnswer: 'zero',
      userAnswer: '0',
      evidence: 'The net value is zero.',
    }));
    assert.equal(response.statusCode, 200);
    assert.equal(JSON.parse(response.body).grade.verdict, 'correct');
    assert.equal(request.text.format.name, 'projlearn_answer_grade');
    assert.match(request.instructions, /Judge meaning, not wording/);
    assert.match(request.instructions, /"0" and "zero"/);
  } finally {
    globalThis.fetch = original;
    delete process.env.OPENAI_API_KEY;
  }
});

test('course coach receives grounded context and recent chat', async () => {
  process.env.OPENAI_API_KEY = 'test-placeholder';
  const original = globalThis.fetch;
  let request;
  globalThis.fetch = async (_url, options) => {
    request = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        output: [{ content: [{ text: 'Gauss\'s law connects net flux with enclosed charge.' }] }],
      }),
    };
  };

  try {
    const response = await handler(event({
      mode: 'chat',
      message: 'Explain this simply.',
      context: 'COURSE: E&M\nGauss law: flux equals enclosed charge divided by epsilon zero.',
      history: [{ role: 'user', content: 'What is flux?' }],
    }));
    assert.equal(response.statusCode, 200);
    assert.match(JSON.parse(response.body).reply, /Gauss/);
    assert.match(request.input, /COURSE CONTEXT/);
    assert.match(request.input, /RECENT CHAT/);
  } finally {
    globalThis.fetch = original;
    delete process.env.OPENAI_API_KEY;
  }
});

test('rejects unknown mode without calling provider', async () => {
  process.env.OPENAI_API_KEY = 'test-placeholder';
  const response = await handler(event({ mode: 'other' }));
  assert.equal(response.statusCode, 400);
  assert.equal(JSON.parse(response.body).code, 'INVALID_MODE');
  delete process.env.OPENAI_API_KEY;
});
