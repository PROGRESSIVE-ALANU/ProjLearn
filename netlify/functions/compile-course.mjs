const OPENAI_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_MODEL = process.env.PROJLEARN_MODEL || 'gpt-5.6-luna';
const CRITIC_MODEL = process.env.PROJLEARN_CRITIC_MODEL || 'gpt-5.6-terra';
const configuredLimit = Number(process.env.PROJLEARN_MAX_SOURCE_CHARS || 180000);
const MAX_SOURCE_CHARS = Number.isFinite(configuredLimit) && configuredLimit >= 200
  ? Math.min(Math.floor(configuredLimit), 180000) : 180000;

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
  return `${head}\n\n[... middle of source omitted by ProjLearn for cost/latency ...]\n\n${tail}`;
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

async function callStructured({ model, instructions, input, schema, schemaName, effort = 'low' }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const error = new Error('OPENAI_API_KEY is not configured.');
    error.code = 'NO_API_KEY';
    throw error;
  }

  const response = await fetch(OPENAI_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(45000),
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      store: false,
      max_output_tokens: 10000,
      reasoning: { effort },
      instructions,
      input,
      text: {
        format: {
          type: 'json_schema',
          name: schemaName,
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
    throw error;
  }
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

const cartographerSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    concepts: {
      type: 'array', minItems: 4, maxItems: 14,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          title: { type: 'string' },
          importance: { type: 'string', enum: ['core', 'supporting', 'extension'] },
          prerequisiteTitles: { type: 'array', items: { type: 'string' }, maxItems: 4 },
          whyItMatters: { type: 'string' },
        },
        required: ['title', 'importance', 'prerequisiteTitles', 'whyItMatters'],
      },
    },
  },
  required: ['title', 'concepts'],
};

const scholarSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    conceptEvidence: {
      type: 'array', minItems: 4, maxItems: 14,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          conceptTitle: { type: 'string' },
          evidence: { type: 'string' },
          citation: citationSchema,
        },
        required: ['conceptTitle', 'evidence', 'citation'],
      },
    },
    claims: {
      type: 'array', minItems: 4, maxItems: 10,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          text: { type: 'string' },
          conceptTitle: { type: 'string' },
          citation: citationSchema,
        },
        required: ['text', 'conceptTitle', 'citation'],
      },
    },
  },
  required: ['conceptEvidence', 'claims'],
};

const examinerSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    prompts: {
      type: 'array', minItems: 4, maxItems: 10,
      items: {
        type: 'object', additionalProperties: false,
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
  required: ['prompts'],
};

const criticSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    promptReviews: {
      type: 'array', minItems: 4, maxItems: 10,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          promptIndex: { type: 'integer', minimum: 0 },
          verdict: { type: 'string', enum: ['approved', 'needs-human-check', 'rejected'] },
          note: { type: 'string' },
          correctedExpectedAnswer: { type: ['string', 'null'] },
        },
        required: ['promptIndex', 'verdict', 'note', 'correctedExpectedAnswer'],
      },
    },
    claimReviews: {
      type: 'array', minItems: 4, maxItems: 10,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          claimIndex: { type: 'integer', minimum: 0 },
          verdict: { type: 'string', enum: ['approved', 'needs-human-check', 'rejected'] },
          note: { type: 'string' },
        },
        required: ['claimIndex', 'verdict', 'note'],
      },
    },
  },
  required: ['promptReviews', 'claimReviews'],
};

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
    const text = sourceForModel(body.text || '');
    const sourceName = String(body.sourceName || 'Course material').slice(0, 180);
    if (text.length < 200) return json(400, { error: 'Not enough readable source text to compile.' });

    const cartographer = await callStructured({
      model: DEFAULT_MODEL,
      schema: cartographerSchema,
      schemaName: 'projlearn_cartographer',
      effort: 'low',
      instructions: `You are ProjLearn's Cartographer. Build a compact dependency-aware map ONLY from the supplied course source. Do not add outside facts. Prefer teachable concepts over generic words. prerequisiteTitles must name only concepts you also return.`,
      input: `SOURCE NAME: ${sourceName}\n\nSOURCE:\n${text}`,
    });

    const scholar = await callStructured({
      model: DEFAULT_MODEL,
      schema: scholarSchema,
      schemaName: 'projlearn_scholar',
      effort: 'low',
      instructions: `You are ProjLearn's Scholar. Ground every concept and review claim in the supplied source. Do not repair or supplement the source with outside knowledge. Citation quote must be a short exact source excerpt, source must name the supplied source, and page should use [Page N] markers when present; otherwise null.`,
      input: `SOURCE NAME: ${sourceName}\n\nCONCEPT MAP:\n${JSON.stringify(cartographer)}\n\nSOURCE:\n${text}`,
    });

    const examiner = await callStructured({
      model: DEFAULT_MODEL,
      schema: examinerSchema,
      schemaName: 'projlearn_examiner',
      effort: 'low',
      instructions: `You are ProjLearn's Examiner. Create retrieval-practice prompts answerable ONLY from the supplied source. Mix recall, explanation, application, and comparison when the source supports them. Do not write trick questions. expectedAnswer must be concise and source-grounded.`,
      input: `SOURCE NAME: ${sourceName}\n\nCONCEPT MAP:\n${JSON.stringify(cartographer)}\n\nSCHOLAR NOTES:\n${JSON.stringify(scholar)}\n\nSOURCE:\n${text}`,
    });

    const critic = await callStructured({
      model: CRITIC_MODEL,
      schema: criticSchema,
      schemaName: 'projlearn_critic',
      effort: 'medium',
      instructions: `You are ProjLearn's independent Critic. Verify the Examiner prompts and Scholar claims against the supplied source. Be conservative. Mark rejected when unsupported or contradicted, needs-human-check when ambiguous, and approved only when clearly supported. Do not use outside knowledge. If an expected answer is materially wrong but fixable from the source, provide correctedExpectedAnswer.`,
      input: `SOURCE NAME: ${sourceName}\n\nCLAIMS:\n${JSON.stringify(scholar.claims)}\n\nPROMPTS:\n${JSON.stringify(examiner.prompts)}\n\nSOURCE:\n${text}`,
    });

    const conceptEvidenceByTitle = new Map(scholar.conceptEvidence.map((item) => [item.conceptTitle.toLowerCase(), item]));
    const concepts = cartographer.concepts.map((concept, index) => {
      const id = slugify(concept.title);
      const evidence = conceptEvidenceByTitle.get(concept.title.toLowerCase());
      return {
        id,
        title: concept.title,
        order: index,
        importance: concept.importance,
        whyItMatters: concept.whyItMatters,
        prerequisites: concept.prerequisiteTitles.map(slugify),
        evidence: evidence?.evidence || '',
        citation: evidence?.citation || { source: sourceName, page: null, quote: '' },
        sourceName,
      };
    });

    const validIds = new Set(concepts.map((concept) => concept.id));
    const edges = [];
    for (const concept of concepts) {
      for (const prerequisite of concept.prerequisites) {
        if (validIds.has(prerequisite) && prerequisite !== concept.id) edges.push({ from: prerequisite, to: concept.id, relation: 'prerequisite' });
      }
    }

    const claimReviewByIndex = new Map(critic.claimReviews.map((item) => [item.claimIndex, item]));
    const claims = scholar.claims.map((claim, index) => {
      const review = claimReviewByIndex.get(index) || { verdict: 'needs-human-check', note: 'Critic returned no review.' };
      return {
        id: `claim-${index + 1}`,
        text: claim.text,
        conceptId: slugify(claim.conceptTitle),
        citation: claim.citation,
        criticStatus: review.verdict,
        criticNote: review.note,
      };
    }).filter((claim) => claim.criticStatus !== 'rejected');

    const promptReviewByIndex = new Map(critic.promptReviews.map((item) => [item.promptIndex, item]));
    const prompts = examiner.prompts.map((prompt, index) => {
      const review = promptReviewByIndex.get(index) || { verdict: 'needs-human-check', note: 'Critic returned no review.', correctedExpectedAnswer: null };
      return {
        id: `prompt-${index + 1}`,
        conceptId: slugify(prompt.conceptTitle),
        prompt: prompt.prompt,
        expectedAnswer: review.correctedExpectedAnswer || prompt.expectedAnswer,
        evidence: prompt.citation.quote,
        citation: prompt.citation,
        difficulty: prompt.difficulty,
        verification: review.verdict === 'approved' ? 'critic-approved' : 'needs-human-check',
        criticNote: review.note,
        criticStatus: review.verdict,
      };
    }).filter((prompt) => prompt.criticStatus !== 'rejected');

    const rejectedPrompts = critic.promptReviews.filter((item) => item.verdict === 'rejected').length;
    const humanCheckPrompts = critic.promptReviews.filter((item) => item.verdict === 'needs-human-check').length;
    const rejectedClaims = critic.claimReviews.filter((item) => item.verdict === 'rejected').length;

    const course = {
      title: cartographer.title || sourceName,
      sourceName,
      charCount: text.length,
      concepts,
      edges,
      claims,
      prompts,
      trace: [
        { stage: 'Cartographer', action: `Mapped ${concepts.length} concepts and ${edges.length} prerequisite links with ${DEFAULT_MODEL}.`, status: 'complete' },
        { stage: 'Scholar', action: `Grounded ${scholar.claims.length} candidate claims and concept evidence in the uploaded source.`, status: 'complete' },
        { stage: 'Examiner', action: `Generated ${examiner.prompts.length} retrieval prompts across multiple difficulty types.`, status: 'complete' },
        { stage: 'Critic', action: `Rejected ${rejectedPrompts} prompt(s) and ${rejectedClaims} claim(s); ${humanCheckPrompts} prompt(s) still require a human check.`, status: 'complete' },
        { stage: 'Memory Engine', action: 'Prepared persistent local attempt state; human overrides and misses survive reloads.', status: 'ready' },
      ],
      ai: {
        enabled: true,
        provider: 'OpenAI',
        generatorModel: DEFAULT_MODEL,
        criticModel: CRITIC_MODEL,
        sourceWasTruncated: String(body.text || '').replace(/\u0000/g, ' ').trim().length > MAX_SOURCE_CHARS,
      },
    };

    return json(200, { course });
  } catch (error) {
    // Provider errors can contain credential fragments: never return or log raw messages.
    const knownCodes = new Set(['invalid_api_key', 'insufficient_quota', 'rate_limit_exceeded', 'model_not_found', 'NO_API_KEY']);
    const code = knownCodes.has(error?.code) ? error.code : 'COMPILE_FAILED';
    console.error('ProjLearn compile failure', { code });
    return json(502, { error: 'Live AI compilation failed. Check the server configuration or try again.', code });
  }
}
