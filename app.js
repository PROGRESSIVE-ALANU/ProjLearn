import { concepts, questions, tracks } from "./data/questions.js?v=20260918g";
import {
  buildSession,
  calculateMastery,
  formatDueTime,
  normalizeConceptState,
  rankConcepts,
  updateStateRecord,
} from "./src/engine.js?v=20260918g";
import { compileCourseFromText, readCourseFiles } from "./src/course-engine.js?v=20260918g";
import { compileCourseWithAI } from "./src/ai-client.js?v=20260918g";
import { askCourseCoach, gradeAnswerWithAI, remixMissedQuestion } from "./src/study-assistant.js?v=20260918g";

const STORAGE_KEY = "projlearn-adaptive-state-v1";
const LEGACY_STORAGE_KEY = "l8-learning-state-v1";
const COURSE_STORAGE_KEY = "projlearn-course-agent-v2";
const LEGACY_COURSE_STORAGE_KEY = "projlearn-course-agent-v1";
const THEME_KEY = "projlearn-theme";

const DEMO_COURSE_TEXT = `
Physics II — Electric Fields, Flux, and Potential

1. Electric Field Direction
The electric field at a point is defined as the force per unit positive test charge. A positive source charge creates a field directed away from the source, while a negative source charge creates a field directed toward the source. A negatively charged particle experiences a force opposite the field direction.

2. Electric Flux
Electric flux measures how much electric field passes through a surface. The sign depends on the orientation of the electric field relative to the outward area vector. For a closed surface, inward contributions are negative and outward contributions are positive.

3. Gauss's Law
Gauss's law states that the net electric flux through any closed surface equals the enclosed charge divided by epsilon zero. The law depends on enclosed charge, not the shape or size of the closed surface. Symmetry determines whether Gauss's law is useful for calculating the electric field easily.

4. Conductors in Electrostatic Equilibrium
Inside the conducting material, the electric field is zero in electrostatic equilibrium. Excess charge resides on the surface of a conductor. Just outside the surface, the electric field is perpendicular to the conductor.

5. Electric Potential
Electric potential is electric potential energy per unit charge. Potential is a scalar, so contributions from multiple point charges add algebraically. For a point charge, V = kQ/r. The potential energy of a charge q at potential V is U = qV, so a negative charge moving to higher potential can lose potential energy.

6. Relationship Between Field and Potential
The electric field points in the direction of decreasing electric potential. Along a path where the potential does not change, the electric field has no component tangent to that path. Equipotential surfaces are therefore perpendicular to electric field lines.
`;

const elements = {
  trackGrid: document.querySelector("#track-grid"),
  masteryList: document.querySelector("#mastery-list"),
  masteryScore: document.querySelector("#mastery-score"),
  reviewQueue: document.querySelector("#review-queue"),
  queueCount: document.querySelector("#queue-count"),
  previewFocusTitle: document.querySelector("#preview-focus-title"),
  previewDate: document.querySelector("#preview-date"),
  startLoop: document.querySelector("#start-loop"),
  reviewNow: document.querySelector("#review-now"),
  themeToggle: document.querySelector("#theme-toggle"),
  overlay: document.querySelector("#session-overlay"),
  closeSession: document.querySelector("#close-session"),
  sessionStep: document.querySelector("#session-step"),
  progressDots: document.querySelector("#progress-dots"),
  sessionClock: document.querySelector("#session-clock"),
  sessionTitle: document.querySelector("#session-title"),
  sessionContextCopy: document.querySelector("#session-context-copy"),
  conceptScore: document.querySelector("#concept-score"),
  contextTrackFill: document.querySelector("#context-track-fill"),
  contextNote: document.querySelector("#context-note"),
  questionView: document.querySelector("#question-view"),
  feedbackView: document.querySelector("#feedback-view"),
  completionView: document.querySelector("#completion-view"),
  questionKicker: document.querySelector("#question-kicker"),
  questionText: document.querySelector("#question-text"),
  answerGrid: document.querySelector("#answer-grid"),
  submitAnswer: document.querySelector("#submit-answer"),
  feedbackStatus: document.querySelector("#feedback-status"),
  feedbackTitle: document.querySelector("#feedback-title"),
  feedbackCopy: document.querySelector("#feedback-copy"),
  feedbackRule: document.querySelector("#feedback-rule"),
  scheduleNote: document.querySelector("#schedule-note"),
  nextQuestion: document.querySelector("#next-question"),
  completionScore: document.querySelector("#completion-score"),
  completionCopy: document.querySelector("#completion-copy"),
  completionStats: document.querySelector("#completion-stats"),
  finishSession: document.querySelector("#finish-session"),
  toast: document.querySelector("#toast"),
  courseFiles: document.querySelector("#course-files"),
  uploadZone: document.querySelector("#upload-zone"),
  sourceList: document.querySelector("#source-list"),
  compileCourse: document.querySelector("#compile-course"),
  loadDemoCourse: document.querySelector("#load-demo-course"),
  compilerNote: document.querySelector("#compiler-note"),
  pipelineList: document.querySelector("#pipeline-list"),
  compiledCourseTitle: document.querySelector("#compiled-course-title"),
  compiledSourceCount: document.querySelector("#compiled-source-count"),
  compiledConceptCount: document.querySelector("#compiled-concept-count"),
  humanCheckCount: document.querySelector("#human-check-count"),
  courseSummaryCopy: document.querySelector("#course-summary-copy"),
  summaryOverview: document.querySelector("#summary-overview"),
  summaryKeyPoints: document.querySelector("#summary-key-points"),
  summaryStudyFocus: document.querySelector("#summary-study-focus"),
  graphStatus: document.querySelector("#graph-status"),
  conceptGraphEmpty: document.querySelector("#concept-graph-empty"),
  conceptGraph: document.querySelector("#concept-graph"),
  reviewSheetCount: document.querySelector("#review-sheet-count"),
  reviewSheet: document.querySelector("#review-sheet"),
  verificationEmpty: document.querySelector("#verification-empty"),
  verificationLog: document.querySelector("#verification-log"),
  verificationPill: document.querySelector(".verification-pill"),
  traceCount: document.querySelector("#trace-count"),
  traceList: document.querySelector("#trace-list"),
  sourceQuizStatus: document.querySelector("#source-quiz-status"),
  sourceQuizEmpty: document.querySelector("#source-quiz-empty"),
  sourceQuizBody: document.querySelector("#source-quiz-body"),
  sourceQuizConcept: document.querySelector("#source-quiz-concept"),
  sourceQuizPriority: document.querySelector("#source-quiz-priority"),
  sourceQuizQuestion: document.querySelector("#source-quiz-question"),
  typedAnswer: document.querySelector("#typed-answer"),
  checkTypedAnswer: document.querySelector("#check-typed-answer"),
  answerFeedback: document.querySelector("#answer-feedback"),
  revealSource: document.querySelector("#reveal-source"),
  sourceEvidence: document.querySelector("#source-evidence"),
  selfCheckActions: document.querySelector("#self-check-actions"),
  markKnew: document.querySelector("#mark-knew"),
  markMissed: document.querySelector("#mark-missed"),
  flagAgent: document.querySelector("#flag-agent"),
  coachStatus: document.querySelector("#coach-status"),
  coachMessages: document.querySelector("#coach-messages"),
  coachForm: document.querySelector("#coach-form"),
  coachInput: document.querySelector("#coach-input"),
  coachSend: document.querySelector("#coach-send"),
  aiModePill: document.querySelector("#ai-mode-pill"),
};

function createInitialStates() {
  return Object.fromEntries(
    concepts.map((concept, index) => [
      concept.id,
      { ...normalizeConceptState(), mastery: 18 + (index % 3) * 6, dueAt: 0 },
    ]),
  );
}

function loadState() {
  const fallback = { selectedTrackId: "cs", conceptStates: createInitialStates(), completedLoops: 0 };
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    const saved = JSON.parse(raw ?? "null");
    if (!saved || typeof saved !== "object") return fallback;
    const normalizedStates = {};
    for (const concept of concepts) normalizedStates[concept.id] = normalizeConceptState(saved.conceptStates?.[concept.id]);
    return {
      selectedTrackId: tracks.some((track) => track.id === saved.selectedTrackId) ? saved.selectedTrackId : fallback.selectedTrackId,
      conceptStates: normalizedStates,
      completedLoops: Number.isFinite(saved.completedLoops) ? saved.completedLoops : 0,
    };
  } catch {
    return fallback;
  }
}

function loadCourseState() {
  const fallback = { course: null, sources: [], verifiedClaimIds: [], verificationLog: [], promptMemory: {}, chatHistory: [] };
  try {
    const saved = JSON.parse(localStorage.getItem(COURSE_STORAGE_KEY) ?? localStorage.getItem(LEGACY_COURSE_STORAGE_KEY) ?? "null");
    if (!saved || typeof saved !== "object") return fallback;
    return {
      course: saved.course ?? null,
      sources: Array.isArray(saved.sources) ? saved.sources : [],
      verifiedClaimIds: Array.isArray(saved.verifiedClaimIds) ? saved.verifiedClaimIds : [],
      verificationLog: Array.isArray(saved.verificationLog) ? saved.verificationLog : [],
      promptMemory: saved.promptMemory && typeof saved.promptMemory === "object" ? saved.promptMemory : {},
      chatHistory: Array.isArray(saved.chatHistory) ? saved.chatHistory.slice(-20) : [],
    };
  } catch {
    return fallback;
  }
}

let appState = loadState();
let courseState = loadCourseState();
let pendingFiles = [];
let session = null;
let toastTimer = null;

function persistState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(appState)); }
  catch { showToast("Adaptive progress could not be saved in this browser."); }
}

function persistCourseState() {
  try { localStorage.setItem(COURSE_STORAGE_KEY, JSON.stringify(courseState)); }
  catch { showToast("The compiled course could not be saved in this browser."); }
}

function selectedTrack() {
  return tracks.find((track) => track.id === appState.selectedTrackId) ?? tracks[0];
}

function trackConcepts(trackId) { return concepts.filter((concept) => concept.trackId === trackId); }
function trackMastery(trackId) { return calculateMastery(trackConcepts(trackId), appState.conceptStates); }

function showToast(message) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => elements.toast.classList.remove("is-visible"), 2800);
}

function escapeHtml(value = "") {
  return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function normalizeAnswerForCheck(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/ε₀|epsilon[_\s-]?0|epsilon\s*naught/g, "epsilon0")
    .replace(/∮|oint/g, "integral")
    .replace(/Φ|phi/g, "flux")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function gradeTypedAnswer(answer, expectedAnswer) {
  const typed = normalizeAnswerForCheck(answer);
  const expected = normalizeAnswerForCheck(expectedAnswer);
  if (!typed) return { verdict: "empty", score: 0, message: "Type an answer first." };
  if (!expected) return { verdict: "manual", score: 0, message: "Answer saved. Reveal the source and self-check this one." };

  const stop = new Set(["the","and","that","this","with","from","into","your","what","when","where","which","then","than","have","has","had","for","are","was","were","its","you","can","will","law","given","summary","state","equals","equal"]);
  const expectedTokens = [...new Set(expected.split(/\s+/).filter((token) => token.length >= 3 && !stop.has(token)))];
  if (!expectedTokens.length) return { verdict: "manual", score: 0, message: "Answer saved. Reveal the source and self-check this one." };

  const typedTokens = new Set(typed.split(/\s+/));
  const matched = expectedTokens.filter((token) => typedTokens.has(token)).length;
  const score = matched / expectedTokens.length;

  if (score >= 0.7) return { verdict: "strong", score, message: "Looks right. Your answer covers most of the source-backed answer." };
  if (score >= 0.4) return { verdict: "close", score, message: "Close. You have part of it — compare with the source before deciding." };
  return { verdict: "review", score, message: "Needs another look. Compare your answer with the source evidence." };
}

function citationLabel(citation) {
  if (!citation) return "Source citation unavailable";
  const source = citation.source || courseState.course?.sourceName || "Course source";
  return citation.page ? `${source} · p. ${citation.page}` : source;
}

function courseModeLabel(course) {
  if (course?.ai?.enabled) return `LIVE AI · ${course.ai.generatorModel}`;
  return "LOCAL FALLBACK";
}

function renderTracks() {
  elements.trackGrid.innerHTML = tracks.map((track) => {
    const active = track.id === appState.selectedTrackId;
    const mastery = trackMastery(track.id);
    return `<button class="track-card ${active ? "is-active" : ""}" type="button" data-track-id="${track.id}" aria-pressed="${active}" style="--track-color:${track.color};--track-accent:${track.accent}">
      <span class="track-code">${track.code}</span><span class="track-text"><strong>${track.title}</strong><small>${track.subtitle}</small></span><span class="track-score">${mastery}%</span>
    </button>`;
  }).join("");

  for (const button of elements.trackGrid.querySelectorAll("[data-track-id]")) {
    button.addEventListener("click", () => {
      appState.selectedTrackId = button.dataset.trackId;
      persistState();
      renderDashboard();
      showToast(`${selectedTrack().title} is now your focus track.`);
    });
  }
}

function renderMastery() {
  const activeConcepts = trackConcepts(appState.selectedTrackId);
  const ranked = rankConcepts(activeConcepts, appState.conceptStates);
  const mastery = calculateMastery(activeConcepts, appState.conceptStates);
  elements.masteryScore.textContent = `${mastery}% READY`;
  elements.masteryList.innerHTML = ranked.map((concept, index) => {
    const status = concept.state.mastery < 35 ? "Needs focus" : concept.state.mastery < 65 ? "Building" : "Strong";
    const misconception = concept.state.attempts > 0 && concept.state.lastConfidence === "high" && concept.state.mastery < 35;
    return `<div class="mastery-row ${misconception ? "has-misconception" : ""}">
      <span class="mastery-rank">${String(index + 1).padStart(2, "0")}</span>
      <div class="mastery-name"><strong>${concept.title}</strong><span>${misconception ? "Possible misconception" : status}</span></div>
      <div class="mastery-bar" aria-label="${concept.state.mastery}% mastery"><span style="width:${concept.state.mastery}%"></span></div>
      <strong class="mastery-value">${concept.state.mastery}%</strong>
    </div>`;
  }).join("");
}

function renderQueue() {
  const now = Date.now();
  const ranked = rankConcepts(concepts, appState.conceptStates, now).slice(0, 4);
  const dueCount = concepts.filter((concept) => normalizeConceptState(appState.conceptStates[concept.id]).dueAt <= now).length;
  elements.queueCount.textContent = `${dueCount} due`;
  elements.reviewQueue.innerHTML = ranked.map((concept) => {
    const track = tracks.find((item) => item.id === concept.trackId);
    return `<div class="queue-item"><span class="queue-track" style="--queue-color:${track.color}">${track.code}</span><div><strong>${concept.title}</strong><span>${concept.state.attempts ? "Based on your last answer" : "Not assessed yet"}</span></div><time>${formatDueTime(concept.state.dueAt, now)}</time></div>`;
  }).join("");
  elements.reviewNow.disabled = ranked.length === 0;
}

function renderPreview() {
  const ranked = rankConcepts(trackConcepts(appState.selectedTrackId), appState.conceptStates);
  const focus = ranked[0];
  elements.previewFocusTitle.textContent = focus?.title ?? "Choose a track";
  elements.previewDate.textContent = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date()).toUpperCase();
  const previewFill = document.querySelector(".preview-meter span");
  if (previewFill) previewFill.style.setProperty("--fill", `${focus?.state.mastery ?? 0}%`);
}

function renderDashboard() { renderTracks(); renderMastery(); renderQueue(); renderPreview(); }

function renderPendingSources() {
  if (!pendingFiles.length) {
    elements.sourceList.innerHTML = "";
    elements.compileCourse.disabled = true;
    elements.compilerNote.textContent = "Nothing has been uploaded yet.";
    return;
  }
  elements.sourceList.innerHTML = pendingFiles.map((file) => `<div class="source-chip"><span>${file.name.toLowerCase().endsWith(".pdf") ? "PDF" : "TXT"}</span><strong>${escapeHtml(file.name)}</strong><small>${Math.max(1, Math.round(file.size / 1024))} KB</small></div>`).join("");
  elements.compileCourse.disabled = false;
  elements.compilerNote.textContent = `${pendingFiles.length} source${pendingFiles.length === 1 ? "" : "s"} ready to compile.`;
}

function setPipelineStage(stage, status, label = status) {
  const item = elements.pipelineList.querySelector(`[data-stage="${stage}"]`);
  if (!item) return;
  item.dataset.status = status;
  const badge = item.querySelector("b");
  if (badge) badge.textContent = label;
}

function resetPipeline() {
  setPipelineStage("course-ai", "waiting", "waiting");
  setPipelineStage("validator", "waiting", "waiting");
  setPipelineStage("memory", "ready", "ready");
}

async function compileHybrid({ text, sourceName, sources }) {
  resetPipeline();
  setPipelineStage("course-ai", "working", "calling model");
  if (elements.aiModePill) elements.aiModePill.textContent = "AI COMPILING…";

  try {
    const course = await compileCourseWithAI({ text, sourceName, sources });
    setPipelineStage("course-ai", "complete", "complete");
    setPipelineStage("validator", "complete", "checked");
    setPipelineStage("memory", "complete", "persisted");
    if (elements.aiModePill) elements.aiModePill.textContent = "LIVE AI";
    return { course, mode: "ai" };
  } catch (error) {
    const code = error?.code || "COMPILE_FAILED";
    console.warn(`AI compiler failed (${code}); using local fallback.`, error);
    setPipelineStage("course-ai", "error", `failed · ${code}`);
    const course = compileCourseFromText({ text, sourceName });
    course.ai = { ...(course.ai ?? {}), enabled: false, fallbackReason: code };
    course.trace.unshift({
      stage: "Fallback",
      action: `Live AI failed (${code}). Used deterministic local compiler instead.`,
      status: "fallback",
    });
    if (elements.aiModePill) elements.aiModePill.textContent = "LOCAL FALLBACK";
    return { course, mode: "local", error };
  }
}


function promptState(promptId) {
  return courseState.promptMemory?.[promptId] ?? {
    attempts: 0,
    misses: 0,
    needsReview: false,
    lastResult: null,
    lastSeenAt: 0,
    reviewVariant: null,
  };
}

function activeCoursePrompt(prompt) {
  if (!prompt) return null;
  const state = promptState(prompt.id);
  if (!state.needsReview || !state.reviewVariant) return prompt;
  return {
    ...prompt,
    prompt: state.reviewVariant.prompt || prompt.prompt,
    expectedAnswer: state.reviewVariant.expectedAnswer || prompt.expectedAnswer,
    difficulty: state.reviewVariant.difficulty || prompt.difficulty,
    evidence: state.reviewVariant.evidence || prompt.evidence,
    citation: state.reviewVariant.citation || prompt.citation,
    isRemix: true,
  };
}

function nextCoursePrompt() {
  const prompts = courseState.course?.prompts ?? [];
  if (!prompts.length) return null;
  return [...prompts].sort((a, b) => {
    const sa = promptState(a.id);
    const sb = promptState(b.id);
    if (sa.needsReview !== sb.needsReview) return sa.needsReview ? -1 : 1;
    if (sa.attempts !== sb.attempts) return sa.attempts - sb.attempts;
    return sa.lastSeenAt - sb.lastSeenAt;
  })[0];
}


function courseCoachContext() {
  const course = courseState.course;
  if (!course) return "";
  const conceptsText = (course.concepts ?? []).map((item) =>
    `- ${item.title}: ${item.evidence || item.whyItMatters || ""} [${citationLabel(item.citation)}]`
  ).join("\n");
  const claimsText = (course.claims ?? []).map((item) =>
    `- ${item.text} [${citationLabel(item.citation)}]`
  ).join("\n");
  const promptsText = (course.prompts ?? []).map((item) =>
    `- Q: ${item.prompt}\n  A: ${item.expectedAnswer}\n  Evidence: ${item.evidence || item.citation?.quote || ""}`
  ).join("\n");

  return `COURSE: ${course.title}\nSOURCE: ${course.sourceName || "Course material"}\n\nCONCEPTS:\n${conceptsText}\n\nSOURCE-BACKED CLAIMS:\n${claimsText}\n\nPRACTICE SET:\n${promptsText}`;
}

function renderCourseCoach() {
  const history = Array.isArray(courseState.chatHistory) ? courseState.chatHistory : [];
  if (!courseState.course) {
    elements.coachStatus.textContent = "WAITING FOR SOURCE";
    elements.coachMessages.innerHTML = '<div class="coach-empty"><strong>Your course coach will appear here.</strong><span>Compile a source first, then ask anything about it.</span></div>';
    elements.coachInput.disabled = true;
    elements.coachSend.disabled = true;
    return;
  }

  elements.coachInput.disabled = false;
  elements.coachSend.disabled = false;
  if (elements.coachStatus.textContent !== "THINKING…") elements.coachStatus.textContent = "SOURCE-GROUNDED";

  if (!history.length) {
    elements.coachMessages.innerHTML = '<div class="coach-empty"><strong>Course loaded.</strong><span>Try “Explain the first concept simply” or “Quiz me on the weakest idea.”</span></div>';
    return;
  }

  elements.coachMessages.innerHTML = history.map((item) =>
    `<div class="coach-message ${item.role === "assistant" ? "is-assistant" : "is-user"}"><span>${item.role === "assistant" ? "COACH" : "YOU"}</span><p>${escapeHtml(item.content)}</p></div>`
  ).join("");
  elements.coachMessages.scrollTop = elements.coachMessages.scrollHeight;
}

async function submitCoachMessage(message) {
  const clean = String(message || "").trim();
  if (!clean || !courseState.course) return;

  const historyBefore = [...(courseState.chatHistory ?? [])].slice(-8);
  courseState.chatHistory = [...(courseState.chatHistory ?? []), { role: "user", content: clean }].slice(-20);
  persistCourseState();
  elements.coachInput.value = "";
  elements.coachStatus.textContent = "THINKING…";
  elements.coachSend.disabled = true;
  renderCourseCoach();
  elements.coachStatus.textContent = "THINKING…";
  elements.coachSend.disabled = true;

  try {
    const reply = await askCourseCoach({
      message: clean,
      context: courseCoachContext(),
      history: historyBefore,
    });
    courseState.chatHistory = [...courseState.chatHistory, { role: "assistant", content: reply }].slice(-20);
    persistCourseState();
    elements.coachStatus.textContent = "SOURCE-GROUNDED";
  } catch (error) {
    courseState.chatHistory = [...courseState.chatHistory, {
      role: "assistant",
      content: `I couldn't reach the course coach right now (${error?.code || "ASSISTANT_FAILED"}). Your course and progress are still saved.`,
    }].slice(-20);
    persistCourseState();
    elements.coachStatus.textContent = "OFFLINE";
  } finally {
    elements.coachSend.disabled = false;
    renderCourseCoach();
  }
}

function renderSourceQuiz() {
  document.querySelector('#correction-form').hidden = true;
  const course = courseState.course;
  const prompts = course?.prompts ?? [];
  const attempted = prompts.filter((prompt) => promptState(prompt.id).attempts > 0).length;
  const missed = prompts.filter((prompt) => promptState(prompt.id).needsReview).length;
  elements.sourceQuizStatus.textContent = missed ? `${missed} missed · ${attempted} attempted` : `${attempted} attempted`;
  if (!prompts.length) {
    elements.sourceQuizEmpty.hidden = false;
    elements.sourceQuizBody.hidden = true;
    return;
  }

  const basePrompt = nextCoursePrompt();
  const prompt = activeCoursePrompt(basePrompt);
  const concept = course.concepts.find((item) => item.id === basePrompt.conceptId);
  const state = promptState(basePrompt.id);
  elements.sourceQuizEmpty.hidden = true;
  elements.sourceQuizBody.hidden = false;
  elements.sourceQuizConcept.textContent = (concept?.title ?? "Concept").toUpperCase();
  elements.sourceQuizPriority.textContent = state.needsReview ? (prompt.isRemix ? "REMIXED REVIEW" : "MISSED — REVIEW NOW") : state.attempts ? "RETURN" : "NEW";
  elements.sourceQuizPriority.classList.toggle("is-missed", state.needsReview);
  elements.sourceQuizQuestion.textContent = prompt.prompt;
  elements.typedAnswer.value = "";
  elements.answerFeedback.hidden = true;
  elements.answerFeedback.textContent = "";
  elements.answerFeedback.dataset.verdict = "";
  elements.checkTypedAnswer.dataset.promptId = basePrompt.id;
  elements.sourceEvidence.textContent = `${prompt.expectedAnswer ? `Expected answer: ${prompt.expectedAnswer}\n\n` : ""}Source evidence: ${prompt.evidence || prompt.citation?.quote || "No excerpt available."}\n\n${citationLabel(prompt.citation)}${prompt.criticNote ? `\nCritic: ${prompt.criticNote}` : ""}`;
  elements.sourceEvidence.hidden = true;
  elements.selfCheckActions.hidden = true;
  elements.revealSource.hidden = false;
  elements.revealSource.dataset.promptId = basePrompt.id;
  elements.markKnew.dataset.promptId = basePrompt.id;
  elements.markMissed.dataset.promptId = basePrompt.id;
  elements.flagAgent.dataset.promptId = basePrompt.id;
}

async function recordPromptResult(promptId, result) {
  const basePrompt = courseState.course?.prompts?.find((item) => item.id === promptId);
  if (!basePrompt) return;

  const previous = promptState(promptId);
  const nextMisses = previous.misses + (result === "missed" ? 1 : 0);
  courseState.promptMemory = {
    ...(courseState.promptMemory ?? {}),
    [promptId]: {
      ...previous,
      attempts: previous.attempts + 1,
      misses: nextMisses,
      needsReview: result === "missed",
      lastResult: result,
      lastSeenAt: Date.now(),
      reviewVariant: result === "missed" ? previous.reviewVariant : null,
    },
  };

  courseState.verificationLog.unshift({
    id: `attempt-${Date.now()}`,
    type: "verified",
    message: result === "missed"
      ? "Miss saved. This concept is now persistent review priority and ProjLearn is preparing a fresh question for the next encounter."
      : "Recall saved. This concept left the immediate review queue.",
    timestamp: Date.now(),
  });
  persistCourseState();

  if (result === "missed") {
    const concept = courseState.course?.concepts?.find((item) => item.id === basePrompt.conceptId);
    const immediateFallback = {
      prompt: `Try this again from a different angle: explain ${concept?.title || "this concept"} in your own words and connect it to the source.`,
      expectedAnswer: basePrompt.expectedAnswer,
      difficulty: "explain",
      evidence: basePrompt.evidence || basePrompt.citation?.quote || "",
      citation: basePrompt.citation,
      generatedAt: Date.now(),
      generation: nextMisses,
      fallback: true,
    };
    courseState.promptMemory[promptId] = {
      ...promptState(promptId),
      needsReview: true,
      reviewVariant: immediateFallback,
    };
    persistCourseState();
    showToast("Miss saved. Preparing a fresh review question…");

    try {
      const remix = await remixMissedQuestion({
        conceptTitle: concept?.title || "Course concept",
        originalPrompt: basePrompt.prompt,
        expectedAnswer: basePrompt.expectedAnswer,
        evidence: basePrompt.evidence || basePrompt.citation?.quote || "",
        missCount: nextMisses,
      });
      const latest = promptState(promptId);
      courseState.promptMemory[promptId] = {
        ...latest,
        needsReview: true,
        reviewVariant: {
          prompt: remix.prompt,
          expectedAnswer: remix.expectedAnswer,
          difficulty: remix.difficulty,
          evidence: basePrompt.evidence || basePrompt.citation?.quote || "",
          citation: basePrompt.citation,
          generatedAt: Date.now(),
          generation: nextMisses,
        },
      };
    } catch (error) {
      const latest = promptState(promptId);
      courseState.promptMemory[promptId] = {
        ...latest,
        needsReview: true,
        reviewVariant: {
          prompt: `Try this again from a different angle: explain ${concept?.title || "this concept"} in your own words and connect it to the source.`,
          expectedAnswer: basePrompt.expectedAnswer,
          difficulty: "explain",
          evidence: basePrompt.evidence || basePrompt.citation?.quote || "",
          citation: basePrompt.citation,
          generatedAt: Date.now(),
          generation: nextMisses,
          fallback: true,
        },
      };
    }

    persistCourseState();
    renderCourseAgent();
    showToast("Fresh review saved. It will come back first next time.");
    return;
  }

  persistCourseState();
  renderCourseAgent();
  showToast("Recall saved. Moving to the next weak prompt.");
}

function savePromptCorrection(promptId, correction) {
  const prompt = courseState.course?.prompts?.find((item) => item.id === promptId);
  if (!prompt) return;
  if (!correction?.trim()) return;
  const cleanCorrection = correction.trim();
  prompt.expectedAnswer = cleanCorrection;
  prompt.verification = "human-corrected";
  prompt.criticStatus = "human-override";
  prompt.criticNote = "A human reviewer overrode the generated answer after checking the source.";
  for (const claim of courseState.course?.claims ?? []) {
    if (claim.conceptId === prompt.conceptId && claim.criticStatus !== "human-override") {
      claim.criticStatus = "needs-human-check";
      claim.criticNote = "Re-check this claim because a human corrected another generated item for the same concept.";
    }
  }
  courseState.verificationLog.unshift({
    id: `override-${Date.now()}`,
    type: "override",
    message: `Human corrected ${prompt.id}; dependent claims for this concept were returned to the verification queue.`,
    timestamp: Date.now(),
  });
  persistCourseState();
  renderCourseAgent();
  showToast("Human correction propagated to this concept's verification state.");
}

function renderCourseAgent() {
  const course = courseState.course;
  const humanCount = courseState.verifiedClaimIds.length + courseState.verificationLog.filter((entry) => entry.type === "override").length;
  elements.humanCheckCount.textContent = String(humanCount);
  elements.verificationPill.textContent = `${courseState.verificationLog.filter((entry) => entry.type === "override").length} overrides`;
  if (elements.aiModePill && course) elements.aiModePill.textContent = courseModeLabel(course);

  if (!course) {
    elements.compiledCourseTitle.textContent = "No course compiled";
    elements.compiledSourceCount.textContent = "0";
    elements.compiledConceptCount.textContent = "0";
    elements.courseSummaryCopy.textContent = "Compile a source above to populate this workspace.";
    elements.summaryOverview.textContent = "Compile a source to generate its summary.";
    elements.summaryKeyPoints.innerHTML = '<li>Your key ideas will appear here.</li>';
    elements.summaryStudyFocus.innerHTML = '<li>Your study priorities will appear here.</li>';
    elements.graphStatus.textContent = "waiting";
    elements.conceptGraph.hidden = true;
    elements.conceptGraphEmpty.hidden = false;
    elements.reviewSheetCount.textContent = "0 claims";
    elements.reviewSheet.innerHTML = '<p class="empty-copy">Source-backed review claims will appear here.</p>';
    elements.traceCount.textContent = "0 events";
    elements.traceList.innerHTML = '<p class="empty-copy">The compilation trace will appear here.</p>';
    if (elements.aiModePill) elements.aiModePill.textContent = "AI-READY V0.3";
    renderVerificationLog();
    renderSourceQuiz();
    renderCourseCoach();
    return;
  }

  elements.compiledCourseTitle.textContent = course.title;
  elements.compiledSourceCount.textContent = String(courseState.sources.length || 1);
  elements.compiledConceptCount.textContent = String(course.concepts.length);
  elements.courseSummaryCopy.textContent = `${course.concepts.length} concepts, ${course.claims.length} source-grounded review claims, and ${course.prompts.length} retrieval prompts are ready. ${course.ai?.enabled ? `One ${course.ai.generatorModel} pass built the study set, then ProjLearn checked the quoted evidence against your source.` : "Local fallback items still need human verification."}`;
  const summary = course.summary ?? {};
  elements.summaryOverview.textContent = summary.overview || "ProjLearn extracted the main ideas from this source.";
  elements.summaryKeyPoints.innerHTML = (summary.keyPoints ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>Review the source-backed concepts below.</li>";
  elements.summaryStudyFocus.innerHTML = (summary.studyFocus ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>Start with the highest-priority concepts.</li>";
  elements.graphStatus.textContent = `${course.edges.length} links`;
  elements.conceptGraphEmpty.hidden = true;
  elements.conceptGraph.hidden = false;
  elements.conceptGraph.innerHTML = course.concepts.map((concept, index) => {
    const checked = courseState.verifiedClaimIds.includes(`concept:${concept.id}`);
    const prereqTitles = (concept.prerequisites ?? []).map((id) => course.concepts.find((item) => item.id === id)?.title).filter(Boolean);
    const relation = prereqTitles.length ? `needs ${prereqTitles.join(", ")}` : "entry concept";
    return `<article class="concept-node ${checked ? "is-human-checked" : ""}"><span>${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(concept.title)}</strong><small>${escapeHtml(relation)} · ${escapeHtml(concept.importance ?? "concept")}</small><em>${escapeHtml(citationLabel(concept.citation))}</em><button type="button" data-verify-concept="${concept.id}">${checked ? "Human checked ✓" : "Check source"}</button></article>`;
  }).join('<span class="graph-arrow" aria-hidden="true">→</span>');

  elements.reviewSheetCount.textContent = `${course.claims.length} claims`;
  elements.reviewSheet.innerHTML = course.claims.map((claim, index) => {
    const checked = courseState.verifiedClaimIds.includes(claim.id);
    const status = claim.criticStatus ?? "needs-human-check";
    return `<article class="review-claim ${checked ? "is-verified" : ""}"><span>${String(index + 1).padStart(2, "0")}</span><div><p>${escapeHtml(claim.text)}</p><small>${escapeHtml(citationLabel(claim.citation))} · Critic: ${escapeHtml(status)}</small>${claim.criticNote ? `<em>${escapeHtml(claim.criticNote)}</em>` : ""}</div><button type="button" data-verify-claim="${claim.id}">${checked ? "Verified by human ✓" : "Mark checked"}</button></article>`;
  }).join("");

  elements.traceCount.textContent = `${course.trace.length} events`;
  elements.traceList.innerHTML = course.trace.map((entry, index) => `<div class="trace-event"><span>${String(index + 1).padStart(2, "0")}</span><div><strong>${escapeHtml(entry.stage)}</strong><p>${escapeHtml(entry.action)}</p></div><b>${escapeHtml(entry.status)}</b></div>`).join("");

  for (const button of elements.conceptGraph.querySelectorAll("[data-verify-concept]")) {
    button.addEventListener("click", () => verifyItem(`concept:${button.dataset.verifyConcept}`, `Concept “${course.concepts.find((c) => c.id === button.dataset.verifyConcept)?.title ?? ""}” checked against source.`));
  }
  for (const button of elements.reviewSheet.querySelectorAll("[data-verify-claim]")) {
    button.addEventListener("click", () => verifyItem(button.dataset.verifyClaim, `Review claim ${button.dataset.verifyClaim.replace("claim-", "#")} checked against source.`));
  }
  renderVerificationLog();
  renderSourceQuiz();
  renderCourseCoach();
}

function verifyItem(id, message) {
  if (!courseState.verifiedClaimIds.includes(id)) {
    courseState.verifiedClaimIds.push(id);
    courseState.verificationLog.unshift({ id: `verify-${Date.now()}`, type: "verified", message, timestamp: Date.now() });
    persistCourseState();
    renderCourseAgent();
    showToast("Human verification saved.");
  }
}

function renderVerificationLog() {
  const entries = courseState.verificationLog.slice(0, 5);
  elements.verificationEmpty.hidden = entries.length > 0;
  elements.verificationLog.innerHTML = entries.map((entry) => `<div class="verification-entry ${entry.type === "override" ? "is-override" : ""}"><span>${entry.type === "override" ? "!" : "✓"}</span><div><strong>${entry.type === "override" ? "Human override" : "Human verified"}</strong><p>${escapeHtml(entry.message)}</p></div><time>${new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></div>`).join("");
}

async function compilePendingFiles() {
  if (!pendingFiles.length) return;
  elements.compileCourse.disabled = true;
  elements.compilerNote.textContent = "Reading source files…";
  resetPipeline();
  try {
    const sources = await readCourseFiles(pendingFiles);
    const combinedText = sources.map((source) => `\n\n--- ${source.name} ---\n${source.text}`).join("\n");
    const sourceName = sources.length === 1 ? sources[0].name : `${sources.length} course sources`;
    elements.compilerNote.textContent = "Source parsed. Running Cartographer → Scholar → Examiner → Critic…";
    const { course, mode, error } = await compileHybrid({
      text: combinedText,
      sourceName,
      sources: sources.map(({ name, type, pages }) => ({ name, type, pages: pages ?? null })),
    });
    courseState = { course, sources: sources.map(({ name, type, pages }) => ({ name, type, pages: pages ?? null })), verifiedClaimIds: [], verificationLog: [], promptMemory: {}, chatHistory: [] };
    persistCourseState();
    renderCourseAgent();
    elements.compilerNote.textContent = mode === "ai"
      ? `AI-compiled ${course.concepts.length} concepts from ${sources.length} source${sources.length === 1 ? "" : "s"}. Source validation and semantic answer grading are ready.`
      : `Compiled locally because the AI backend is unavailable${error?.message ? ` (${error.message})` : ""}. The demo still works, but items require human checks.`;
    showToast(mode === "ai" ? "Course AI compiled the workspace." : "Course workspace compiled with the local fallback.");
    showWorkspace("course-agent");
  } catch (error) {
    console.error(error);
    elements.compilerNote.textContent = error?.message ?? "Compilation failed.";
    showToast("Could not compile that source yet.");
    resetPipeline();
  } finally {
    elements.compileCourse.disabled = pendingFiles.length === 0;
  }
}

async function loadDemoCourse() {
  pendingFiles = [];
  renderPendingSources();
  elements.compilerNote.textContent = "Loading the built-in E&M TAPIA demo…";
  resetPipeline();
  const { course, mode } = await compileHybrid({ text: DEMO_COURSE_TEXT, sourceName: "Physics II demo chapter", sources: [{ name: "TAPIA E&M demo chapter", type: "demo", pages: null }] });
  if (!course.ai?.enabled) course.title = "Physics II — Electric Fields, Flux, and Potential";
  courseState = { course, sources: [{ name: "TAPIA E&M demo chapter", type: "demo", pages: null }], verifiedClaimIds: [], verificationLog: [], promptMemory: {}, chatHistory: [] };
  persistCourseState();
  renderCourseAgent();
  elements.compilerNote.textContent = mode === "ai" ? "Demo compiled with live AI. Semantic answer grading and the course coach are ready." : "Demo compiled locally. Add an API key later to activate live AI.";
  showToast(mode === "ai" ? "Live AI TAPIA demo compiled." : "Local TAPIA demo compiled.");
  showWorkspace("course-agent");
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  elements.themeToggle.setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* optional */ }
}

function initializeTheme() {
  let savedTheme = null;
  try { savedTheme = localStorage.getItem(THEME_KEY); } catch { /* system fallback */ }
  const theme = savedTheme === "dark" || savedTheme === "light" ? savedTheme : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  setTheme(theme);
}

function currentQuestion() { return session?.questions[session.index] ?? null; }
function currentConcept() { const question = currentQuestion(); return concepts.find((concept) => concept.id === question?.conceptId) ?? null; }

function resetQuestionControls() {
  session.selectedAnswer = null;
  session.confidence = "medium";
  elements.submitAnswer.disabled = true;
  elements.questionView.hidden = false;
  elements.feedbackView.hidden = true;
  elements.completionView.hidden = true;
  for (const button of document.querySelectorAll("[data-confidence]")) {
    const selected = button.dataset.confidence === "medium";
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
}

function renderQuestion() {
  const question = currentQuestion();
  const concept = currentConcept();
  const track = tracks.find((item) => item.id === question.trackId);
  const state = normalizeConceptState(appState.conceptStates[concept.id]);
  resetQuestionControls();
  elements.sessionStep.textContent = `PROMPT ${session.index + 1} OF ${session.questions.length}`;
  elements.progressDots.innerHTML = session.questions.map((_, index) => `<span class="${index < session.index ? "is-done" : index === session.index ? "is-current" : ""}"></span>`).join("");
  elements.sessionTitle.textContent = concept.title;
  elements.sessionContextCopy.textContent = `${track.title} · ${track.subtitle}`;
  elements.conceptScore.textContent = `${state.mastery}%`;
  elements.contextTrackFill.style.width = `${state.mastery}%`;
  elements.contextNote.textContent = state.attempts === 0 ? "ProjLearn chose this concept because it has not been assessed yet." : "ProjLearn chose this because mastery, confidence, and review timing make it the highest-priority gap.";
  elements.questionKicker.textContent = question.kicker;
  elements.questionText.textContent = question.prompt;
  elements.answerGrid.innerHTML = question.answers.map((answer, index) => `<button class="answer-option" type="button" role="radio" aria-checked="false" data-answer-index="${index}"><span>${String.fromCharCode(65 + index)}</span><strong>${answer}</strong></button>`).join("");
  for (const button of elements.answerGrid.querySelectorAll("[data-answer-index]")) {
    button.addEventListener("click", () => {
      session.selectedAnswer = Number(button.dataset.answerIndex);
      elements.submitAnswer.disabled = false;
      for (const option of elements.answerGrid.querySelectorAll("[data-answer-index]")) {
        const selected = option === button;
        option.classList.toggle("is-selected", selected);
        option.setAttribute("aria-checked", String(selected));
      }
    });
  }
}

function startTimer() {
  window.clearInterval(session.timer);
  session.remainingSeconds = 8 * 60;
  elements.sessionClock.textContent = "08:00";
  session.timer = window.setInterval(() => {
    session.remainingSeconds = Math.max(0, session.remainingSeconds - 1);
    const minutes = Math.floor(session.remainingSeconds / 60);
    const seconds = session.remainingSeconds % 60;
    elements.sessionClock.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    if (session.remainingSeconds === 0) window.clearInterval(session.timer);
  }, 1000);
}

function openSession(trackId = appState.selectedTrackId) {
  const sessionQuestions = buildSession(questions, concepts, appState.conceptStates, { trackId, count: 3 });
  if (!sessionQuestions.length) return showToast("No prompts are available for this track yet.");
  session = { trackId, questions: sessionQuestions, index: 0, correctCount: 0, reviewedConceptIds: new Set(), selectedAnswer: null, confidence: "medium", timer: null, remainingSeconds: 8 * 60 };
  elements.overlay.hidden = false;
  document.body.classList.add("session-open");
  renderQuestion();
  startTimer();
  window.setTimeout(() => elements.closeSession.focus(), 0);
}

function closeSession({ completed = false } = {}) {
  if (!session) return;
  window.clearInterval(session.timer);
  elements.overlay.hidden = true;
  document.body.classList.remove("session-open");
  session = null;
  renderDashboard();
  if (!completed) showToast("Loop paused. Completed answers were saved.");
}

function submitCurrentAnswer() {
  const question = currentQuestion();
  if (!question || session.selectedAnswer === null) return;
  const correct = session.selectedAnswer === question.correctIndex;
  const now = Date.now();
  appState.conceptStates = updateStateRecord(appState.conceptStates, question.conceptId, { correct, confidence: session.confidence }, now);
  persistState();
  if (correct) session.correctCount += 1;
  session.reviewedConceptIds.add(question.conceptId);
  const updated = normalizeConceptState(appState.conceptStates[question.conceptId]);
  const chosenAnswer = question.answers[session.selectedAnswer];
  const correctAnswer = question.answers[question.correctIndex];
  const highConfidenceMiss = !correct && session.confidence === "high";
  elements.questionView.hidden = true;
  elements.feedbackView.hidden = false;
  elements.feedbackStatus.textContent = correct ? "LOCKED IN" : highConfidenceMiss ? "POSSIBLE MISCONCEPTION" : "NEEDS REVIEW";
  elements.feedbackStatus.classList.toggle("is-correct", correct);
  elements.feedbackTitle.textContent = correct ? "That connection is holding." : `Your answer: “${chosenAnswer}”`;
  elements.feedbackCopy.textContent = correct ? question.explanation : `The correct answer is “${correctAnswer}.” ${question.explanation}`;
  elements.feedbackRule.textContent = question.rule;
  elements.scheduleNote.innerHTML = `<span>↻</span><p><strong>${correct ? "Scheduled forward" : highConfidenceMiss ? "High-confidence miss detected" : "Added to Needs Review"}</strong>This concept returns ${formatDueTime(updated.dueAt, now).toLowerCase()}.</p>`;
  elements.nextQuestion.textContent = session.index === session.questions.length - 1 ? "See loop result →" : "Next prompt →";
  elements.nextQuestion.focus();
}

function showCompletion() {
  window.clearInterval(session.timer);
  elements.feedbackView.hidden = true;
  elements.questionView.hidden = true;
  elements.completionView.hidden = false;
  appState.completedLoops += 1;
  persistState();
  const total = session.questions.length;
  const mastery = trackMastery(session.trackId);
  const secondsUsed = 8 * 60 - session.remainingSeconds;
  const minutes = Math.floor(secondsUsed / 60);
  const seconds = secondsUsed % 60;
  elements.completionScore.textContent = `${session.correctCount}/${total}`;
  elements.completionCopy.textContent = session.correctCount === total ? "Every answer landed. ProjLearn expanded the review intervals for this track." : "Your misses are now specific, explained, and scheduled—the useful kind of unfinished.";
  elements.completionStats.innerHTML = `<div><span>TRACK MASTERY</span><strong>${mastery}%</strong></div><div><span>CONCEPTS TOUCHED</span><strong>${session.reviewedConceptIds.size}</strong></div><div><span>FOCUS TIME</span><strong>${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}</strong></div>`;
  elements.finishSession.focus();
}

function advanceQuestion() {
  if (session.index >= session.questions.length - 1) return showCompletion();
  session.index += 1;
  renderQuestion();
}

function applyFiles(fileList) {
  pendingFiles = [...fileList].filter((file) => /\.(pdf|txt|md)$/i.test(file.name) || ["application/pdf", "text/plain"].includes(file.type));
  renderPendingSources();
}

elements.courseFiles.addEventListener("change", () => applyFiles(elements.courseFiles.files));
elements.uploadZone.addEventListener("dragover", (event) => { event.preventDefault(); elements.uploadZone.classList.add("is-dragging"); });
elements.uploadZone.addEventListener("dragleave", () => elements.uploadZone.classList.remove("is-dragging"));
elements.uploadZone.addEventListener("drop", (event) => { event.preventDefault(); elements.uploadZone.classList.remove("is-dragging"); applyFiles(event.dataTransfer.files); });
elements.compileCourse.addEventListener("click", compilePendingFiles);
elements.loadDemoCourse.addEventListener("click", loadDemoCourse);
elements.startLoop.addEventListener("click", () => openSession());
elements.reviewNow.addEventListener("click", () => { const next = rankConcepts(concepts, appState.conceptStates)[0]; openSession(next?.trackId ?? appState.selectedTrackId); });
elements.closeSession.addEventListener("click", () => closeSession());
elements.submitAnswer.addEventListener("click", submitCurrentAnswer);
elements.nextQuestion.addEventListener("click", advanceQuestion);
elements.finishSession.addEventListener("click", () => closeSession({ completed: true }));
elements.themeToggle.addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
elements.checkTypedAnswer.addEventListener("click", async () => {
  const promptId = elements.checkTypedAnswer.dataset.promptId;
  const basePrompt = courseState.course?.prompts?.find((item) => item.id === promptId);
  const prompt = activeCoursePrompt(basePrompt);
  if (!prompt) return;

  const userAnswer = elements.typedAnswer.value.trim();
  if (!userAnswer) {
    elements.answerFeedback.hidden = false;
    elements.answerFeedback.dataset.verdict = "empty";
    elements.answerFeedback.textContent = "Type an answer first.";
    return;
  }

  elements.checkTypedAnswer.disabled = true;
  elements.checkTypedAnswer.textContent = "Checking meaning…";
  elements.answerFeedback.hidden = false;
  elements.answerFeedback.dataset.verdict = "thinking";
  elements.answerFeedback.textContent = "Comparing your meaning with the source-backed answer…";

  try {
    const grade = await gradeAnswerWithAI({
      question: prompt.prompt,
      expectedAnswer: prompt.expectedAnswer,
      userAnswer,
      evidence: prompt.evidence || prompt.citation?.quote || "",
    });
    elements.answerFeedback.dataset.verdict = grade.verdict;
    elements.answerFeedback.textContent = grade.feedback + (grade.missingPoint ? ` Missing: ${grade.missingPoint}` : "");
    elements.selfCheckActions.hidden = false;
  } catch (error) {
    const fallback = gradeTypedAnswer(userAnswer, prompt.expectedAnswer);
    elements.answerFeedback.dataset.verdict = fallback.verdict;
    elements.answerFeedback.textContent = `AI grading was unavailable (${error?.code || "ASSISTANT_FAILED"}). Fast local check: ${fallback.message}`;
    elements.selfCheckActions.hidden = false;
  } finally {
    elements.checkTypedAnswer.disabled = false;
    elements.checkTypedAnswer.textContent = "Check answer";
  }
});


elements.coachForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitCoachMessage(elements.coachInput.value);
});

elements.typedAnswer.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    elements.checkTypedAnswer.click();
  }
});

elements.revealSource.addEventListener("click", () => { elements.sourceEvidence.hidden = false; elements.selfCheckActions.hidden = false; elements.revealSource.hidden = true; });
elements.markKnew.addEventListener("click", async () => { await recordPromptResult(elements.markKnew.dataset.promptId, "knew"); });
elements.markMissed.addEventListener("click", async () => { await recordPromptResult(elements.markMissed.dataset.promptId, "missed"); });
elements.flagAgent.addEventListener("click", () => {
  const form = document.querySelector('#correction-form');
  form.dataset.promptId = elements.flagAgent.dataset.promptId;
  form.hidden = false;
  document.querySelector('#correction-text').focus();
});
document.querySelector('#correction-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  savePromptCorrection(form.dataset.promptId, document.querySelector('#correction-text').value);
  form.reset();
  form.hidden = true;
  elements.revealSource.focus();
});
document.querySelector('#cancel-correction').addEventListener('click', () => {
  document.querySelector('#correction-form').hidden = true;
  elements.flagAgent.focus();
});

for (const button of document.querySelectorAll("[data-confidence]")) {
  button.addEventListener("click", () => {
    if (!session) return;
    session.confidence = button.dataset.confidence;
    for (const option of document.querySelectorAll("[data-confidence]")) {
      const selected = option === button;
      option.classList.toggle("is-selected", selected);
      option.setAttribute("aria-pressed", String(selected));
    }
  });
}

document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !elements.overlay.hidden) closeSession(); });

initializeTheme();
renderPendingSources();
renderCourseAgent();
renderDashboard();


function showWorkspace(view) {
  const names = { compiler: 'Source desk', 'course-agent': 'Study room', adaptive: 'Daily review' };
  if (!names[view]) view = 'compiler';
  document.querySelectorAll('[data-workspace-panel]').forEach(panel => { panel.hidden = panel.dataset.workspacePanel !== view; });
  document.querySelectorAll('[data-view]').forEach(link => {
    if (link.dataset.view === view) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  document.querySelector('#workspace-location').textContent = names[view];
  history.replaceState(null, '', `#${view}`);
  window.scrollTo({ top: 0, behavior: 'instant' });
}
document.querySelectorAll('a[href^="#"]').forEach(link => {
  const target = link.getAttribute('href').slice(1);
  if (['compiler', 'course-agent', 'adaptive', 'top'].includes(target)) link.addEventListener('click', event => {
    event.preventDefault(); showWorkspace(target === 'top' ? 'compiler' : target);
  });
});
window.addEventListener('hashchange', () => showWorkspace(location.hash.slice(1)));
showWorkspace(location.hash.slice(1) || (courseState.course ? 'course-agent' : 'compiler'));
const notebookTabs = [...document.querySelectorAll('[data-notebook]')];
function selectNotebook(tab) {
  notebookTabs.forEach(item => {
    const active = item === tab;
    item.setAttribute('aria-selected', String(active)); item.tabIndex = active ? 0 : -1;
    document.querySelector(`#${item.getAttribute('aria-controls')}`).hidden = !active;
  });
}
notebookTabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectNotebook(tab));
  tab.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? notebookTabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + notebookTabs.length) % notebookTabs.length;
    selectNotebook(notebookTabs[next]); notebookTabs[next].focus();
  });
});
