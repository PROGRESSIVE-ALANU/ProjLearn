import { handler as netlifyHandler } from '../netlify/functions/compile-course.mjs';

export default async function handler(req, res) {
  const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
  const result = await netlifyHandler({
    httpMethod: req.method || 'GET',
    body,
  });

  for (const [key, value] of Object.entries(result.headers || {})) {
    if (value != null) res.setHeader(key, value);
  }

  res.status(result.statusCode || 200).send(result.body ?? '');
}
