import { concepts, questions, tracks } from "./data/questions.js";
import {
  buildSession,
  calculateMastery,
  formatDueTime,
  normalizeConceptState,
  rankConcepts,
  updateStateRecord,
} from "./src/engine.js";
import { compileCourseFromText, readCourseFiles } from "./src/course-engine.js";
import { compileCourseWithAI } from "./src/ai-client.js";

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
  revealSource: document.querySelector("#reveal-source"),
  sourceEvidence: document.querySelector("#source-evidence"),
  selfCheckActions: document.querySelector("#self-check-actions"),
  markKnew: document.querySelector("#mark-knew"),
  markMissed: document.querySelector("#mark-missed"),
  flagAgent: document.querySelector("#flag-agent"),
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
  const fallback = { course: null, sources: [], verifiedClaimIds: [], verificationLog: [], promptMemory: {} };
  try {
    const saved = JSON.parse(localStorage.getItem(COURSE_STORAGE_KEY) ?? localStorage.getItem(LEGACY_COURSE_STORAGE_KEY) ?? "null");
    if (!saved || typeof saved !== "object") return fallback;
    return {
      course: saved.course ?? null,
      sources: Array.isArray(saved.sources) ? saved.sources : [],
      verifiedClaimIds: Array.isArray(saved.verifiedClaimIds) ? saved.verifiedClaimIds : [],
      verificationLog: Array.isArray(saved.verificationLog) ? saved.verificationLog : [],
      promptMemory: saved.promptMemory && typeof saved.promptMemory === "object" ? saved.promptMemory : {},
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

function citationLabel(citation) {
  if (!citation) return "Source citation unavailable";
  const source = citation.source || courseState.course?.sourceName || "Course source";
  return citation.page ? `${source} · p. ${citation.page}` : source;
}

function courseModeLabel(course) {
  if (course?.ai?.enabled) return `AI · ${course.ai.generatorModel} + ${course.ai.criticModel}`;
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
  for (const stage of ["cartographer", "scholar", "examiner", "critic"]) setPipelineStage(stage, "waiting", "waiting");
  setPipelineStage("memory", "ready", "ready");
}

async function animateCompilation({ ai = false } = {}) {
  const stages = ["cartographer", "scholar", "examiner", "critic", "memory"];
  for (const stage of stages) {
    setPipelineStage(stage, "working", ai ? "agent" : "working");
    await new Promise((resolve) => window.setTimeout(resolve, ai ? 110 : 90));
    setPipelineStage(stage, "complete", stage === "memory" ? "persisted" : "complete");
  }
}

async function compileHybrid({ text, sourceName, sources }) {
  setPipelineStage("cartographer", "working", "calling model");
  if (elements.aiModePill) elements.aiModePill.textContent = "AI COMPILING…";
  try {
    const course = await compileCourseWithAI({ text, sourceName, sources });
    await animateCompilation({ ai: true });
    if (elements.aiModePill) elements.aiModePill.textContent = "LIVE AI";
    return { course, mode: "ai" };
  } catch (error) {
    console.warn("AI compiler unavailable; using local fallback.", error);
    const course = compileCourseFromText({ text, sourceName });
    course.ai = { ...(course.ai ?? {}), enabled: false, fallbackReason: error?.message ?? "AI compiler unavailable" };
    course.trace.unshift({ stage: "Fallback", action: `Hosted AI compiler unavailable: ${error?.message ?? "unknown error"}. Used deterministic local compiler instead.`, status: "fallback" });
    await animateCompilation({ ai: false });
    if (elements.aiModePill) elements.aiModePill.textContent = "LOCAL FALLBACK";
    return { course, mode: "local", error };
  }
}


function promptState(promptId) {
  return courseState.promptMemory?.[promptId] ?? { attempts: 0, misses: 0, needsReview: false, lastResult: null, lastSeenAt: 0 };
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

function renderSourceQuiz() {
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

  const prompt = nextCoursePrompt();
  const concept = course.concepts.find((item) => item.id === prompt.conceptId);
  const state = promptState(prompt.id);
  elements.sourceQuizEmpty.hidden = true;
  elements.sourceQuizBody.hidden = false;
  elements.sourceQuizConcept.textContent = (concept?.title ?? "Concept").toUpperCase();
  elements.sourceQuizPriority.textContent = state.needsReview ? "MISSED — REVIEW NOW" : state.attempts ? "RETURN" : "NEW";
  elements.sourceQuizPriority.classList.toggle("is-missed", state.needsReview);
  elements.sourceQuizQuestion.textContent = prompt.prompt;
  elements.sourceEvidence.textContent = `${prompt.expectedAnswer ? `Expected answer: ${prompt.expectedAnswer}\n\n` : ""}Source evidence: ${prompt.evidence || prompt.citation?.quote || "No excerpt available."}\n\n${citationLabel(prompt.citation)}${prompt.criticNote ? `\nCritic: ${prompt.criticNote}` : ""}`;
  elements.sourceEvidence.hidden = true;
  elements.selfCheckActions.hidden = true;
  elements.revealSource.hidden = false;
  elements.revealSource.dataset.promptId = prompt.id;
  elements.markKnew.dataset.promptId = prompt.id;
  elements.markMissed.dataset.promptId = prompt.id;
  elements.flagAgent.dataset.promptId = prompt.id;
}

function recordPromptResult(promptId, result) {
  const previous = promptState(promptId);
  courseState.promptMemory = {
    ...(courseState.promptMemory ?? {}),
    [promptId]: {
      attempts: previous.attempts + 1,
      misses: previous.misses + (result === "missed" ? 1 : 0),
      needsReview: result === "missed",
      lastResult: result,
      lastSeenAt: Date.now(),
    },
  };
  courseState.verificationLog.unshift({
    id: `attempt-${Date.now()}`,
    type: "verified",
    message: result === "missed" ? "Human self-check marked a retrieval prompt as missed; it is now first in the persistent review queue." : "Human self-check marked a retrieval prompt as recalled; it was removed from immediate review.",
    timestamp: Date.now(),
  });
  persistCourseState();
  renderCourseAgent();
  showToast(result === "missed" ? "Miss saved. Reload later and this prompt comes back first." : "Recall saved. Moving to the next weak prompt.");
}

function flagCurrentPrompt(promptId) {
  const prompt = courseState.course?.prompts?.find((item) => item.id === promptId);
  if (!prompt) return;
  const correction = window.prompt("What should the corrected answer/source note say? This will override the agent answer for this concept:");
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
    elements.graphStatus.textContent = "waiting";
    elements.conceptGraph.hidden = true;
    elements.conceptGraphEmpty.hidden = false;
    elements.reviewSheetCount.textContent = "0 claims";
    elements.reviewSheet.innerHTML = '<p class="empty-copy">Source-backed review claims will appear here.</p>';
    elements.traceCount.textContent = "0 events";
    elements.traceList.innerHTML = '<p class="empty-copy">The compilation trace will appear here.</p>';
    if (elements.aiModePill) elements.aiModePill.textContent = "AI-READY V0.2";
    renderVerificationLog();
    renderSourceQuiz();
    return;
  }

  elements.compiledCourseTitle.textContent = course.title;
  elements.compiledSourceCount.textContent = String(courseState.sources.length || 1);
  elements.compiledConceptCount.textContent = String(course.concepts.length);
  elements.courseSummaryCopy.textContent = `${course.concepts.length} concepts, ${course.claims.length} source-grounded review claims, and ${course.prompts.length} retrieval prompts are ready. ${course.ai?.enabled ? `The Critic independently checked generation with ${course.ai.criticModel}.` : "Local fallback items still need human verification."}`;
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
    courseState = { course, sources: sources.map(({ name, type, pages }) => ({ name, type, pages: pages ?? null })), verifiedClaimIds: [], verificationLog: [], promptMemory: {} };
    persistCourseState();
    renderCourseAgent();
    elements.compilerNote.textContent = mode === "ai"
      ? `AI-compiled ${course.concepts.length} concepts from ${sources.length} source${sources.length === 1 ? "" : "s"}. Critic filtering is active.`
      : `Compiled locally because the AI backend is unavailable${error?.message ? ` (${error.message})` : ""}. The demo still works, but items require human checks.`;
    showToast(mode === "ai" ? "Course Agent compiled by live specialist agents." : "Course Agent compiled with the local fallback.");
    document.querySelector("#course-agent")?.scrollIntoView({ behavior: "smooth", block: "start" });
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
  courseState = { course, sources: [{ name: "TAPIA E&M demo chapter", type: "demo", pages: null }], verifiedClaimIds: [], verificationLog: [], promptMemory: {} };
  persistCourseState();
  renderCourseAgent();
  elements.compilerNote.textContent = mode === "ai" ? "Demo compiled with live AI agents. Reload later: the course state still survives." : "Demo compiled locally. Add an API key later to activate live agents.";
  showToast(mode === "ai" ? "Live-agent TAPIA demo compiled." : "Local TAPIA demo compiled.");
  document.querySelector("#course-agent")?.scrollIntoView({ behavior: "smooth", block: "start" });
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
elements.revealSource.addEventListener("click", () => { elements.sourceEvidence.hidden = false; elements.selfCheckActions.hidden = false; elements.revealSource.hidden = true; });
elements.markKnew.addEventListener("click", () => recordPromptResult(elements.markKnew.dataset.promptId, "knew"));
elements.markMissed.addEventListener("click", () => recordPromptResult(elements.markMissed.dataset.promptId, "missed"));
elements.flagAgent.addEventListener("click", () => flagCurrentPrompt(elements.flagAgent.dataset.promptId));

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
