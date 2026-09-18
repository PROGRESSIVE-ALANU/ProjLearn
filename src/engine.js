const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const DEFAULT_CONCEPT_STATE = Object.freeze({
  attempts: 0,
  correct: 0,
  mastery: 22,
  streak: 0,
  intervalHours: 0,
  dueAt: 0,
  lastSeenAt: 0,
  lastConfidence: "medium",
});

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function normalizeConceptState(value = {}) {
  return {
    ...DEFAULT_CONCEPT_STATE,
    ...value,
    attempts: Number.isFinite(value.attempts) ? value.attempts : DEFAULT_CONCEPT_STATE.attempts,
    correct: Number.isFinite(value.correct) ? value.correct : DEFAULT_CONCEPT_STATE.correct,
    mastery: clamp(
      Number.isFinite(value.mastery) ? value.mastery : DEFAULT_CONCEPT_STATE.mastery,
      0,
      100,
    ),
    streak: Number.isFinite(value.streak) ? value.streak : DEFAULT_CONCEPT_STATE.streak,
    intervalHours: Number.isFinite(value.intervalHours)
      ? value.intervalHours
      : DEFAULT_CONCEPT_STATE.intervalHours,
    dueAt: Number.isFinite(value.dueAt) ? value.dueAt : DEFAULT_CONCEPT_STATE.dueAt,
    lastSeenAt: Number.isFinite(value.lastSeenAt) ? value.lastSeenAt : DEFAULT_CONCEPT_STATE.lastSeenAt,
    lastConfidence: ["low", "medium", "high"].includes(value.lastConfidence)
      ? value.lastConfidence
      : DEFAULT_CONCEPT_STATE.lastConfidence,
  };
}

export function scoreResponse({ correct, confidence = "medium" }) {
  const confidenceWeight = {
    low: 0,
    medium: 1,
    high: 2,
  }[confidence] ?? 1;

  if (!correct) {
    return confidence === "high" ? 0 : 1;
  }

  return 2 + confidenceWeight;
}

export function scheduleReview(previous, response, now = Date.now()) {
  const state = normalizeConceptState(previous);
  const quality = scoreResponse(response);
  const correct = Boolean(response.correct);
  const confidence = response.confidence ?? "medium";

  let streak = correct ? state.streak + 1 : 0;
  let intervalHours;

  if (!correct) {
    intervalHours = confidence === "high" ? 0.17 : 1;
  } else if (confidence === "low") {
    intervalHours = 12;
  } else if (streak === 1) {
    intervalHours = 24;
  } else if (streak === 2) {
    intervalHours = 72;
  } else {
    intervalHours = Math.min(Math.round(Math.max(state.intervalHours, 72) * 2.2), 24 * 45);
  }

  const gain = correct
    ? { low: 7, medium: 12, high: 16 }[confidence]
    : { low: -7, medium: -11, high: -16 }[confidence];

  return {
    attempts: state.attempts + 1,
    correct: state.correct + (correct ? 1 : 0),
    mastery: clamp(state.mastery + gain, 4, 98),
    streak,
    intervalHours,
    dueAt: now + intervalHours * HOUR,
    lastSeenAt: now,
    lastConfidence: confidence,
    quality,
  };
}

export function conceptPriority(state, now = Date.now()) {
  const concept = normalizeConceptState(state);
  const dueBoost = concept.dueAt <= now ? 45 : 0;
  const overdueHours = concept.dueAt > 0 ? Math.max(0, (now - concept.dueAt) / HOUR) : 24;
  const uncertainty = 100 - concept.mastery;
  const confidenceBoost = concept.lastConfidence === "low" ? 10 : 0;
  const unseenBoost = concept.attempts === 0 ? 12 : 0;

  return uncertainty + dueBoost + Math.min(overdueHours / 3, 18) + confidenceBoost + unseenBoost;
}

export function rankConcepts(concepts, states = {}, now = Date.now()) {
  return [...concepts]
    .map((concept) => ({
      ...concept,
      state: normalizeConceptState(states[concept.id]),
      priority: conceptPriority(states[concept.id], now),
    }))
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.title.localeCompare(b.title);
    });
}

export function calculateMastery(concepts, states = {}) {
  if (!concepts.length) return 0;
  const total = concepts.reduce(
    (sum, concept) => sum + normalizeConceptState(states[concept.id]).mastery,
    0,
  );
  return Math.round(total / concepts.length);
}

export function buildSession(questions, concepts, states = {}, options = {}) {
  const count = options.count ?? 3;
  const trackId = options.trackId;
  const now = options.now ?? Date.now();
  const eligibleConcepts = trackId
    ? concepts.filter((concept) => concept.trackId === trackId)
    : concepts;
  const ranked = rankConcepts(eligibleConcepts, states, now);
  const conceptOrder = new Map(ranked.map((concept, index) => [concept.id, index]));

  return [...questions]
    .filter((question) => !trackId || question.trackId === trackId)
    .sort((a, b) => {
      const aRank = conceptOrder.get(a.conceptId) ?? Number.MAX_SAFE_INTEGER;
      const bRank = conceptOrder.get(b.conceptId) ?? Number.MAX_SAFE_INTEGER;
      if (aRank !== bRank) return aRank - bRank;
      return a.id.localeCompare(b.id);
    })
    .slice(0, count);
}

export function formatDueTime(dueAt, now = Date.now()) {
  if (!dueAt || dueAt <= now) return "Due now";

  const difference = dueAt - now;
  if (difference < HOUR) {
    const minutes = Math.max(1, Math.round(difference / MINUTE));
    return `In ${minutes} min`;
  }
  if (difference < DAY) {
    const hours = Math.max(1, Math.round(difference / HOUR));
    return `In ${hours} hr`;
  }

  const days = Math.max(1, Math.round(difference / DAY));
  return `In ${days} day${days === 1 ? "" : "s"}`;
}

export function updateStateRecord(states, conceptId, response, now = Date.now()) {
  return {
    ...states,
    [conceptId]: scheduleReview(states[conceptId], response, now),
  };
}
