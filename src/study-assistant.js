async function postAssistant(payload) {
  const endpoints = ['/api/study-assistant', '/.netlify/functions/study-assistant'];
  let lastResponse = null;
  let lastData = null;

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
    lastData = data;

    if (response.status !== 404 && response.status !== 405) break;
  }

  const error = new Error(lastData?.error || `Study assistant unavailable (${lastResponse?.status || 'network'}).`);
  error.code = lastData?.code || `HTTP_${lastResponse?.status || 0}`;
  throw error;
}

export async function gradeAnswerWithAI({ question, expectedAnswer, userAnswer, evidence }) {
  const data = await postAssistant({
    mode: 'grade',
    question,
    expectedAnswer,
    userAnswer,
    evidence,
  });
  return data.grade;
}

export async function remixMissedQuestion({ conceptTitle, originalPrompt, expectedAnswer, evidence, missCount }) {
  const data = await postAssistant({
    mode: 'remix',
    conceptTitle,
    originalPrompt,
    expectedAnswer,
    evidence,
    missCount,
  });
  return data.remix;
}

export async function askCourseCoach({ message, context, history = [] }) {
  const data = await postAssistant({
    mode: 'chat',
    message,
    context,
    history,
  });
  return data.reply;
}
