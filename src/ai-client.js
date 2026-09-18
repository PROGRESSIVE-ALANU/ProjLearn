async function postCompiler(payload) {
  const endpoints = ['/api/compile-course', '/.netlify/functions/compile-course'];
  let lastResponse = null;
  let lastPayload = null;

  for (const endpoint of endpoints) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    let data = null;
    try { data = await response.json(); }
    catch { data = null; }

    if (response.ok) return data;
    lastResponse = response;
    lastPayload = data;

    if (response.status !== 404 && response.status !== 405) break;
  }

  const error = new Error(lastPayload?.error || `AI compiler unavailable (${lastResponse?.status || 'network'}).`);
  error.code = lastPayload?.code || `HTTP_${lastResponse?.status || 0}`;
  error.fallbackAllowed = [404, 501, 503].includes(lastResponse?.status);
  throw error;
}

export async function compileCourseWithAI({ text, sourceName, sources = [] }) {
  const payload = await postCompiler({ text, sourceName, sources });
  if (!payload?.course) throw new Error('AI compiler returned no course payload.');
  return payload.course;
}
