const OPENAI_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_MODEL = process.env.PROJLEARN_MODEL || 'gpt-5.6-luna';
const configuredLimit = Number(process.env.PROJLEARN_MAX_SOURCE_CHARS || 90000);
const MAX_SOURCE_CHARS = Number.isFinite(configuredLimit) && configuredLimit >= 200
  ? Math.min(Math.floor(configuredLimit), 90000) : 90000;

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  },
  body: JSON.stringify(body),
});

const slugify = (value = '') => value
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 64) || `concept-${Date.now()}`;

function sourceForModel(text = '') {
  const cleaned = text.replace(/\u0000/g, ' ').trim();
  if (cleaned.length <= MAX_SOURCE_CHARS) return cleaned;
  const head = cleaned.slice(0, Math.floor(MAX_SOURCE_CHARS * 0.72));
  const tail = cleaned.slice(-Math.floor(MAX_SOURCE_CHARS * 0.28));
  return `${head}\n\n[... middle of source omitted by ProjLearn for latency ...]\n\n${tail}`;
}

function extractText(response) {
  if (typeof response?.output_text === 'string' && response.output_text.trim()) return response.output_text;
  for (const item of response?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === 'string' && content.text.trim()) return content.text;
    }
  }
  throw new Error('Model returned no structured text output.');
}

async function callStructured({ instructions, input, schema }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const error = new Error('OPENAI_API_KEY is not configured.');
    error.code = 'NO_API_KEY';
    throw error;
  }

  const started = Date.now();
  console.info('ProjLearn compiler started', { model: DEFAULT_MODEL });

  const response = await fetch(OPENAI_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(25000),
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      store: false,
      max_output_tokens: 7000,
      reasoning: { effort: 'low' },
      instructions,
      input,
      text: {
        format: {
          type: 'json_schema',
          name: 'projlearn_course_compiler',
          strict: true,
          schema,
        },
      },
    }),
  });

  const body = await response.json();
  if (!response.ok) {
    const message = body?.error?.message || `OpenAI request failed (${response.status}).`;
    const error = new Error(message);
    error.code = body?.error?.code || `OPENAI_${response.status}`;
    console.error('ProjLearn provider failure', {
      status: response.status,
      type: String(body?.error?.type || '').slice(0, 80),
      param: String(body?.error?.param || '').slice(0, 80),
    });
    throw error;
  }

  console.info('ProjLearn compiler returned', {
    elapsedMs: Date.now() - started,
    status: body.status,
    incompleteReason: body.incomplete_details?.reason,
  });

  return JSON.parse(extractText(body));
}

const citationSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    source: { type: 'string' },
    page: { type: ['integer', 'null'] },
    quote: { type: 'string' },
  },
  required: ['source', 'page', 'quote'],
};

const compilerSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    summary: {
      type: 'object',
      additionalProperties: false,
      properties: {
        overview: { type: 'string' },
        keyPoints: { type: 'array', minItems: 3, maxItems: 7, items: { type: 'string' } },
        studyFocus: { type: 'array', minItems: 2, maxItems: 5, items: { type: 'string' } },
      },
      required: ['overview', 'keyPoints', 'studyFocus'],
    },
    concepts: {
      type: 'array',
      minItems: 4,
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          importance: { type: 'string', enum: ['core', 'supporting', 'extension'] },
          prerequisiteTitles: { type: 'array', items: { type: 'string' }, maxItems: 4 },
          whyItMatters: { type: 'string' },
          evidence: { type: 'string' },
          citation: citationSchema,
        },
        required: ['title', 'importance', 'prerequisiteTitles', 'whyItMatters', 'evidence', 'citation'],
      },
    },
    claims: {
      type: 'array',
      minItems: 4,
      maxItems: 10,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string' },
          conceptTitle: { type: 'string' },
          citation: citationSchema,
        },
        required: ['text', 'conceptTitle', 'citation'],
      },
    },
    prompts: {
      type: 'array',
      minItems: 4,
      maxItems: 10,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          conceptTitle: { type: 'string' },
          prompt: { type: 'string' },
          expectedAnswer: { type: 'string' },
          citation: citationSchema,
          difficulty: { type: 'string', enum: ['recall', 'explain', 'apply', 'compare'] },
        },
        required: ['conceptTitle', 'prompt', 'expectedAnswer', 'citation', 'difficulty'],
      },
    },
  },
  required: ['title', 'summary', 'concepts', 'claims', 'prompts'],
};

function normalized(value = '') {
  return String(value).replace(/\s+/g, ' ').trim().toLowerCase();
}

function citationIsGrounded(citation, sourceText) {
  const quote = normalized(citation?.quote);
  if (quote.length < 8) return false;
  return normalized(sourceText).includes(quote);
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' });
  if (!process.env.OPENAI_API_KEY) return json(501, { error: 'AI compiler is not configured yet.', code: 'NO_API_KEY' });

  try {
    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch { return json(400, { error: 'Invalid JSON request.', code: 'INVALID_INPUT' }); }

    if (!body || typeof body.text !== 'string') {
      return json(400, { error: 'Source text must be a string.', code: 'INVALID_INPUT' });
    }
    if (body.text.length > 1000000) {
      return json(413, { error: 'Source is too large. Upload a shorter excerpt.', code: 'SOURCE_TOO_LARGE' });
    }

    const text = sourceForModel(body.text);
    const sourceName = String(body.sourceName || 'Course material').slice(0, 180);
    if (text.length < 200) return json(400, { error: 'Not enough readable source text to compile.' });

    const compiled = await callStructured({
      schema: compilerSchema,
      instructions: `You are ProjLearn's single source-grounded course compiler. Read ONLY the supplied course material. In one pass: first create a concise learner-facing summary with an overview, key points, and study-focus items; then identify the most teachable concepts and prerequisite relationships, attach concise evidence to each concept, produce review claims, and write retrieval-practice prompts. Do not use outside knowledge. Every citation quote must be a short exact excerpt copied from the supplied source. Use [Page N] markers for page when available, otherwise null. prerequisiteTitles may name only concepts you return. Keep expected answers concise and directly supported by the source. Do not invent facts to make the source seem complete.`,
      input: `SOURCE NAME: ${sourceName}\n\nSOURCE:\n${text}`,
    });

    const concepts = compiled.concepts.map((concept, index) => ({
      id: slugify(concept.title),
      title: concept.title,
      order: index,
      importance: concept.importance,
      whyItMatters: concept.whyItMatters,
      prerequisites: concept.prerequisiteTitles.map(slugify),
      evidence: concept.evidence,
      citation: concept.citation,
      sourceName,
      sourceVerified: citationIsGrounded(concept.citation, text),
    }));

    const validIds = new Set(concepts.map((concept) => concept.id));
    const edges = [];
    for (const concept of concepts) {
      concept.prerequisites = concept.prerequisites.filter((id) => validIds.has(id) && id !== concept.id);
      for (const prerequisite of concept.prerequisites) {
        edges.push({ from: prerequisite, to: concept.id, relation: 'prerequisite' });
      }
    }

    const claims = compiled.claims.map((claim, index) => {
      const grounded = citationIsGrounded(claim.citation, text);
      return {
        id: `claim-${index + 1}`,
        text: claim.text,
        conceptId: slugify(claim.conceptTitle),
        citation: claim.citation,
        criticStatus: grounded ? 'approved' : 'needs-human-check',
        criticNote: grounded
          ? 'ProjLearn verified that the quoted evidence appears in the uploaded source.'
          : 'The quoted evidence could not be matched exactly in the uploaded source.',
      };
    });

    const prompts = compiled.prompts.map((prompt, index) => {
      const grounded = citationIsGrounded(prompt.citation, text);
      return {
        id: `prompt-${index + 1}`,
        conceptId: slugify(prompt.conceptTitle),
        prompt: prompt.prompt,
        expectedAnswer: prompt.expectedAnswer,
        evidence: prompt.citation.quote,
        citation: prompt.citation,
        difficulty: prompt.difficulty,
        verification: grounded ? 'source-verified' : 'needs-human-check',
        criticNote: grounded
          ? 'Quoted evidence matched the uploaded source.'
          : 'Quoted evidence did not exactly match the uploaded source.',
        criticStatus: grounded ? 'approved' : 'needs-human-check',
      };
    });

    const verifiedCitations = [
      ...concepts.map((item) => item.sourceVerified),
      ...claims.map((item) => item.criticStatus === 'approved'),
      ...prompts.map((item) => item.criticStatus === 'approved'),
    ];
    const verifiedCount = verifiedCitations.filter(Boolean).length;

    const course = {
      title: compiled.title || sourceName,
      summary: compiled.summary,
      sourceName,
      charCount: text.length,
      concepts,
      edges,
      claims,
      prompts,
      trace: [
        {
          stage: 'Course AI',
          action: `One ${DEFAULT_MODEL} call summarized the source, extracted ${concepts.length} concepts, ${claims.length} review claims, and ${prompts.length} practice prompts.`,
          status: 'complete',
        },
        {
          stage: 'Source Validator',
          action: `Matched ${verifiedCount} of ${verifiedCitations.length} generated citations directly against the uploaded source text.`,
          status: verifiedCount === verifiedCitations.length ? 'complete' : 'needs-human-check',
        },
        {
          stage: 'Memory Engine',
          action: 'Prepared persistent local attempt state; misses and human corrections survive reloads.',
          status: 'ready',
        },
      ],
      ai: {
        enabled: true,
        provider: 'OpenAI',
        generatorModel: DEFAULT_MODEL,
        architecture: 'single-pass',
        sourceWasTruncated: String(body.text || '').replace(/\u0000/g, ' ').trim().length > MAX_SOURCE_CHARS,
      },
    };

    return json(200, { course });
  } catch (error) {
    const knownCodes = new Set(['invalid_api_key', 'insufficient_quota', 'rate_limit_exceeded', 'model_not_found', 'NO_API_KEY']);
    const code = knownCodes.has(error?.code) ? error.code : 'COMPILE_FAILED';
    console.error('ProjLearn compile failure', {
      code,
      name: error?.name,
      causeCode: ['UND_ERR_CONNECT_TIMEOUT', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT'].includes(error?.cause?.code)
        ? error.cause.code : undefined,
    });
    return json(502, {
      error: 'Live AI compilation failed. Check the server configuration or try again.',
      code,
    });
  }
}
