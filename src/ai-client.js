export async function compileCourseWithAI({ text, sourceName, sources = [] }) {
  const response = await fetch('/.netlify/functions/compile-course', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, sourceName, sources }),
  });

  let payload = null;
  try { payload = await response.json(); }
  catch { payload = null; }

  if (!response.ok) {
    const error = new Error(payload?.error || `AI compiler unavailable (${response.status}).`);
    error.code = payload?.code || `HTTP_${response.status}`;
    error.fallbackAllowed = response.status === 404 || response.status === 501 || response.status === 503;
    throw error;
  }

  if (!payload?.course) throw new Error('AI compiler returned no course payload.');
  return payload.course;
}
