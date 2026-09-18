async function postAssistant(payload) {
  const response = await fetch('/.netlify/functions/study-assistant', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  let data = null;
  try { data = await response.json(); }
  catch { data = null; }

  if (!response.ok) {
    const error = new Error(data?.error || `Study assistant unavailable (${response.status}).`);
    error.code = data?.code || `HTTP_${response.status}`;
    throw error;
  }
  return data;
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
