# ProjLearn v0.3 — single-pass source-grounded compiler

ProjLearn is the TAPIA 2026 Course Study Companion built on the recovered L8 adaptive-learning engine.

## What changed in v0.2

- Preserves the L8 8-minute loop, confidence-aware mastery, persistent review state, and misconception signals.
- Adds a Netlify Function at `/.netlify/functions/compile-course`.
- Uses **one live AI compilation pass** to extract concepts, source evidence, review claims, and retrieval prompts from the uploaded material.
- Runs a deterministic **Source Validator** afterward: generated citation quotes are matched directly against the uploaded source text.
- Keeps the **Memory Engine** deterministic and local so learner state is not invented by a model.
- Uses Structured Outputs / JSON Schema so each specialist returns a predictable data contract.
- Defaults to `gpt-5.6-luna` for the single structured compilation call.
- If the API is unavailable or no key is configured, ProjLearn automatically falls back to the local v0.1 compiler so the demo still works.
- Every concept, claim, and prompt can carry a source citation and page number when page markers are available.
- Human correction now **propagates**: correcting a prompt marks related claims for the same concept as needing re-check.
- Missed retrieval prompts still persist across reloads and return first in the next session.

## Why the pipeline is now single-pass

The hackathon build favors reliability over orchestration theater. One structured model call builds the study set; deterministic code verifies quoted evidence and stores learner state. This reduces latency, timeout risk, and cost while keeping the source-grounding story easy to explain to judges.


## Run without spending money

You can serve the folder locally and the entire UI works using the deterministic fallback:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

The Netlify Function will not exist under a plain static server, so ProjLearn detects the failure and falls back automatically.

## Enable the live AI pipeline on Netlify

Deploy the repository to Netlify and add these environment variables in the Netlify project settings:

```text
OPENAI_API_KEY=<your server-side API key>
PROJLEARN_MODEL=gpt-5.6-luna
PROJLEARN_MAX_SOURCE_CHARS=180000
```

`OPENAI_API_KEY` must stay in Netlify environment variables. **Never put it in `app.js`, HTML, GitHub, or client-side localStorage.**

The included `netlify.toml` builds an allowlisted `dist/` directory and configures Functions separately. Environment files and server source are excluded from the static output. Set the API key for the Functions scope and Production context using Netlify’s dashboard, then redeploy. Do not paste the key into chat.

Local validation: `node --test tests/compile-course.test.mjs tests/study-assistant.test.mjs` and `node scripts/build.mjs`. Mocked tests do not prove live model access; verify the deployed UI says **LIVE AI**, not **LOCAL FALLBACK**, before presenting the live AI demo.

The live path now uses one provider call per compilation to reduce latency and timeout risk.

## Source/privacy behavior

1. The browser extracts text from PDF/TXT/Markdown.
2. With live AI enabled, extracted text is POSTed to the same-origin Netlify Function.
3. The function calls the model API using the server-side key.
4. The original uploaded file is not stored by ProjLearn in this prototype.
5. Without live AI, compilation stays local in the browser.


## Accessibility

ProjLearn includes an accessibility baseline across the main study workflow:

- Keyboard-accessible native buttons, links, forms, quiz controls, and notebook tabs.
- Visible focus states and a skip-to-content link.
- Semantic landmarks, labels, ARIA attributes, and live regions for changing feedback.
- Responsive layouts, light/dark themes, and operating-system reduced-motion support.
- Mixed typed and clickable A-D practice so every question does not require long-form typing.
- Source evidence can be revealed after grading instead of relying on color alone.

The Study Room also includes an **Accessibility** panel with device-persistent preferences:

- **Read aloud** for the AI summary and current quiz question (including A-D choices) using browser speech synthesis.
- **Text-size controls** with decrease, reset, and increase actions.
- **High-contrast mode**.
- **Reduce-motion override**.
- **Readable-font mode** using a simpler sans-serif stack.
- **Read-aloud speed control** and a global Stop reading action.

These features improve access, but the project has not completed a formal WCAG conformance audit and should not claim certified WCAG compliance.

## Core product loop

This is the main ProjLearn experience:

1. **Bring a source** — a paper, chapter, notes, or extracted webpage/article text.
2. **Read the AI summary first** — ProjLearn produces a concise overview, key points, and study-focus items before practice.
3. **Retrieve from memory** — practice with a mix of typed free-response and clickable A–D questions, all grounded in the source.
4. **Grade the right way** — free-response uses semantic grading that accepts equivalent phrasing, notation, and numerical/verbal forms; A–D questions grade instantly on click.
5. **Remember weakness** — a partial or incorrect answer automatically marks that concept for review in browser-local memory.
6. **Remix the review** — ProjLearn prepares a fresh question on the same weak concept rather than endlessly repeating the exact old prompt.
7. **Return where you struggled** — after a reload or later visit, remembered weak concepts are prioritized before unseen/easier prompts.
8. **Clear the weakness by recalling it** — a correct answer removes the concept from immediate review; another miss creates another remix.

The Course Coach supports this loop, but it is secondary to summary → retrieval → memory → remixed review.

## Semantic answer grading and course coach

Retrieval answers are no longer judged by exact string matching. The browser sends the learner's answer, the source-backed expected answer, the question, and its evidence to a small server-side semantic grader. It evaluates **meaning rather than wording**, so equivalent forms such as `0` and `zero`, notation differences, or paraphrases can still be marked correct. The grader returns `correct`, `partial`, or `incorrect` with a short explanation. If the grader is unavailable, ProjLearn falls back to the local lexical check rather than blocking practice.

The Study Room also includes a persistent **Course Coach** beside retrieval practice. It receives only compiled course context and recent local chat history, so it can explain concepts, discuss an answer, compare ideas, or generate another practice question while staying anchored to the uploaded material. Chat history is stored with the rest of the browser-local course state and resets when a new course is compiled.

## Vercel deployment

ProjLearn is prepared for Vercel as well as Netlify.

- Import GitHub repository: `PROGRESSIVE-ALANU/ProjLearn`
- Branch: `main`
- Framework preset: **Other**
- Root directory: repository root
- Build command: leave empty
- Output directory: leave empty
- Add `OPENAI_API_KEY` as a Vercel environment variable for Production, Preview, and Development as appropriate.
- Optional: add `PROJLEARN_MODEL`; otherwise the server functions use the configured default.
- Vercel API routes:
  - `/api/compile-course`
  - `/api/study-assistant`

The browser clients try Vercel `/api` routes first and fall back to the existing Netlify Function routes when those Vercel routes do not exist, so the repository remains portable between both hosts.

## Streamlit deployment

ProjLearn can also run as a native Streamlit app from this same repository.

- Entry point: `streamlit_app.py`
- Dependencies: `requirements.txt`
- Theme: `.streamlit/config.toml`
- In Streamlit Community Cloud, create an app from `PROGRESSIVE-ALANU/ProjLearn`, branch `main`, and set the main file path to `streamlit_app.py`.
- Add `OPENAI_API_KEY` under the Streamlit app's **Secrets**. Do not commit the key to GitHub.
- Optional: set `PROJLEARN_MODEL` as an environment variable; otherwise the Streamlit app uses `gpt-5.6-luna`.

The Streamlit version supports PDF/TXT/Markdown upload, the same summary-first single-pass course compiler, deterministic source-quote validation, concepts/evidence views, semantic AI answer grading with local fallback, a missed-review queue for the active session, and a source-grounded course coach. The Netlify build remains the fuller browser-persistent Memory Engine demo.

## TAPIA demo path

1. Load a course source or choose **Load TAPIA demo**.
2. Show Course AI → Source Validator → Memory Engine.
3. Open a retrieval prompt and reveal its source evidence.
4. Mark one prompt missed.
5. Reload the page: the missed prompt returns first.
6. Use **Agent/source mismatch?** on a genuinely weak item found during testing.
7. Enter the human correction; ProjLearn records the override and marks related claims for re-check.
8. Open the Agent Trace / Human Check area to show judges the model was not treated as authoritative.

## Current limitations / next milestone

- The compiler now uses a single structured AI call; future work can add chunking for very large course packs.
- Course prompt memory is persistent but not yet full FSRS. Next version adds stability/difficulty/retrievability fields.
- Browser-local state is enough for the hackathon restart demo; Supabase sync can come later if cross-device persistence is needed.
- We still need a real human-caught error from testing; do not fabricate one for the judges.

## Study-room interface update

The interface now uses Source desk, Study room, and Daily review views, a persistent sidebar, a practice-first layout, and keyboard-accessible Concepts / Source evidence tabs. Corrections use an inline form instead of a browser-native prompt. The learning data and missed-prompt queue remain compatible with v0.2.

Design references: [Readwise Reader](https://readwise.io/read) for a reading-focused workspace and [RemNote](https://www.remnote.com/) for keeping practice close to source material. No third-party assets were copied.

### Deployment checkpoint — 2026-09-18

- GitHub: `PROGRESSIVE-ALANU/ProjLearn`, production branch `main`.
- Netlify project: `projlearn-tapia`, site ID `5f2eb4eb-085d-4715-8562-7d37ebb57b48`.
- URL: https://projlearn-tapia.netlify.app (last verified visibility: private).
- Build: `node scripts/build.mjs`, publish directory `dist`, functions directory `netlify/functions`.
- API key is a Netlify secret in Production only; it is never written to this repository.
- Single compiler model `gpt-5.6-luna`; server-side source cap is 90,000 characters for the live call.
- Deployed fallback compilation and missed-prompt persistence passed. First live request returned sanitized `COMPILE_FAILED` after approximately 20 seconds; live AI has **not** passed end-to-end verification.
- Safe per-stage diagnostics were added after that failure. Inspect the function logs and retest a sample chapter before claiming a working live AI pipeline.
- Local DOM interaction checks passed for routing, notebook tabs, fallback compilation, missed-prompt memory, inline correction persistence and claim propagation, theme switching, and adaptive-session opening/closing. Updated visual layout still requires live browser review.
- The separate `l8-learning` project was not modified.
