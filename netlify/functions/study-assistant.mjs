const OPENAI_URL = 'https://api.openai.com/v1/responses';
const MODEL = process.env.PROJLEARN_TUTOR_MODEL || process.env.PROJLEARN_MODEL || 'gpt-5.6-luna';

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  },
  body: JSON.stringify(body),
});

function extractText(response) {
  if (typeof response?.output_text === 'string' && response.output_text.trim()) return response.output_text;
  for (const item of response?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === 'string' && content.text.trim()) return content.text;
    }
  }
  throw new Error('Model returned no text output.');
}

async function callOpenAI(body) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const error = new Error('OPENAI_API_KEY is not configured.');
    error.code = 'NO_API_KEY';
    throw error;
  }

  const response = await fetch(OPENAI_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(20000),
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `OpenAI request failed (${response.status}).`);
    error.code = payload?.error?.code || `OPENAI_${response.status}`;
    throw error;
  }
  return payload;
}

const remixSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    prompt: { type: 'string' },
    expectedAnswer: { type: 'string' },
    difficulty: { type: 'string', enum: ['recall', 'explain', 'apply', 'compare'] },
  },
  required: ['prompt', 'expectedAnswer', 'difficulty'],
};

const gradeSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['correct', 'partial', 'incorrect'] },
    feedback: { type: 'string' },
    missingPoint: { type: ['string', 'null'] },
  },
  required: ['verdict', 'feedback', 'missingPoint'],
};

async function gradeAnswer(body) {
  const question = String(body.question || '').slice(0, 3000);
  const expectedAnswer = String(body.expectedAnswer || '').slice(0, 5000);
  const userAnswer = String(body.userAnswer || '').slice(0, 5000);
  const evidence = String(body.evidence || '').slice(0, 5000);

  if (!question || !expectedAnswer || !userAnswer) {
    return json(400, { error: 'Question, expected answer, and user answer are required.', code: 'INVALID_INPUT' });
  }

  const response = await callOpenAI({
    model: MODEL,
    store: false,
    max_output_tokens: 500,
    reasoning: { effort: 'low' },
    instructions: `You are ProjLearn's semantic answer grader. Judge meaning, not wording. Accept mathematically, numerically, symbolically, or verbally equivalent answers (for example "0" and "zero") and harmless differences in notation, order, or phrasing. Use ONLY the question, expected answer, and source evidence supplied. Mark "correct" when the learner expresses the required idea even with different wording. Mark "partial" when the core idea is present but an important required part is missing. Mark "incorrect" when the answer conflicts with or fails to express the required idea. Keep feedback to at most two short sentences. Do not penalize spelling or grammar unless they change the meaning.`,
    input: `QUESTION:\n${question}\n\nEXPECTED SOURCE-BACKED ANSWER:\n${expectedAnswer}\n\nSOURCE EVIDENCE:\n${evidence || '(none supplied)'}\n\nLEARNER ANSWER:\n${userAnswer}`,
    text: {
      format: {
        type: 'json_schema',
        name: 'projlearn_answer_grade',
        strict: true,
        schema: gradeSchema,
      },
    },
  });

  return json(200, { grade: JSON.parse(extractText(response)), model: MODEL });
}

async function remix(body) {
  const conceptTitle = String(body.conceptTitle || '').slice(0, 500);
  const originalPrompt = String(body.originalPrompt || '').slice(0, 3000);
  const expectedAnswer = String(body.expectedAnswer || '').slice(0, 5000);
  const evidence = String(body.evidence || '').slice(0, 5000);
  const missCount = Math.max(1, Math.min(Number(body.missCount || 1), 20));

  if (!conceptTitle || !expectedAnswer) {
    return json(400, { error: 'Concept and expected answer are required.', code: 'INVALID_INPUT' });
  }

  const response = await callOpenAI({
    model: MODEL,
    store: false,
    max_output_tokens: 700,
    reasoning: { effort: 'low' },
    instructions: `You are ProjLearn's review-question remixer. The learner missed this concept before. Write ONE fresh retrieval question that tests the same underlying idea without copying the original wording. Stay strictly grounded in the supplied expected answer and source evidence. As miss count rises, you may move from recall toward explanation, application, or comparison, but do not introduce facts absent from the evidence. The expectedAnswer must remain concise and source-supported.`,
    input: `CONCEPT: ${conceptTitle}\nMISS COUNT: ${missCount}\n\nORIGINAL QUESTION:\n${originalPrompt}\n\nSOURCE-BACKED ANSWER:\n${expectedAnswer}\n\nSOURCE EVIDENCE:\n${evidence || '(none supplied)'}`,
    text: {
      format: {
        type: 'json_schema',
        name: 'projlearn_review_remix',
        strict: true,
        schema: remixSchema,
      },
    },
  });

  return json(200, { remix: JSON.parse(extractText(response)), model: MODEL });
}

async function chat(body) {
  const message = String(body.message || '').trim().slice(0, 5000);
  const context = String(body.context || '').slice(0, 30000);
  const history = Array.isArray(body.history) ? body.history.slice(-8) : [];
  if (!message) return json(400, { error: 'Message is required.', code: 'INVALID_INPUT' });

  const compactHistory = history.map((item) => {
    const role = item?.role === 'assistant' ? 'COACH' : 'LEARNER';
    return `${role}: ${String(item?.content || '').slice(0, 2500)}`;
  }).join('\n');

  const response = await callOpenAI({
    model: MODEL,
    store: false,
    max_output_tokens: 1200,
    reasoning: { effort: 'low' },
    instructions: `You are ProjLearn's course coach. Help the learner understand and practice the uploaded course. Ground answers in the supplied COURSE CONTEXT. If the context does not support a factual claim, say that the uploaded material does not cover it rather than inventing details. You may explain ideas more simply, compare concepts, generate a short practice question, or discuss why an answer is correct or incorrect. Be concise and tutoring-oriented; do not dump a full lecture unless asked.`,
    input: `COURSE CONTEXT:\n${context || '(no compiled course yet)'}\n\nRECENT CHAT:\n${compactHistory || '(none)'}\n\nLEARNER: ${message}\nCOACH:`,
  });

  return json(200, { reply: extractText(response), model: MODEL });
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' });

  try {
    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch { return json(400, { error: 'Invalid JSON request.', code: 'INVALID_INPUT' }); }

    if (body.mode === 'grade') return await gradeAnswer(body);
    if (body.mode === 'remix') return await remix(body);
    if (body.mode === 'chat') return await chat(body);
    return json(400, { error: 'Unknown study assistant mode.', code: 'INVALID_MODE' });
  } catch (error) {
    const known = new Set(['invalid_api_key', 'insufficient_quota', 'rate_limit_exceeded', 'model_not_found', 'NO_API_KEY']);
    const code = known.has(error?.code) ? error.code : 'ASSISTANT_FAILED';
    console.error('ProjLearn study assistant failure', { code, name: error?.name });
    return json(502, { error: 'The study assistant could not complete that request.', code });
  }
}
