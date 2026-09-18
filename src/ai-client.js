async function requestStage({ text, sourceName, sources, stage, previous }) {
  const response = await fetch('/.netlify/functions/compile-course', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, sourceName, sources, stage, previous }),
  });

  let payload = null;
  try { payload = await response.json(); }
  catch { payload = null; }

  if (!response.ok) {
    const error = new Error(payload?.error || `AI compiler unavailable (${response.status}).`);
    error.code = payload?.code || `HTTP_${response.status}`;
    error.stage = stage;
    error.fallbackAllowed = response.status === 404 || response.status === 501 || response.status === 503;
    throw error;
  }

  return payload;
}

export async function compileCourseWithAI({ text, sourceName, sources = [], onStage }) {
  const previous = {};
  const stages = ['cartographer', 'scholar', 'examiner', 'critic'];

  for (const stage of stages) {
    onStage?.(stage, 'started');
    const payload = await requestStage({ text, sourceName, sources, stage, previous });

    if (stage === 'critic') {
      if (!payload?.course) throw new Error('AI compiler returned no course payload.');
      onStage?.(stage, 'complete');
      return payload.course;
    }

    if (payload?.stage !== stage || !payload?.data) {
      const error = new Error(`AI compiler returned no ${stage} payload.`);
      error.stage = stage;
      throw error;
    }

    previous[stage] = payload.data;
    onStage?.(stage, 'complete');
  }

  throw new Error('AI compiler did not complete.');
}
