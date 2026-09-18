# ProjLearn v0.2 — live specialist-agent backend

ProjLearn is the TAPIA 2026 Course Study Companion built on the recovered L8 adaptive-learning engine.

## What changed in v0.2

- Preserves the L8 8-minute loop, confidence-aware mastery, persistent review state, and misconception signals.
- Adds a Netlify Function at `/.netlify/functions/compile-course`.
- Adds **four real specialist model stages** when an API key is configured:
  1. **Cartographer** — builds a dependency-aware concept map.
  2. **Scholar** — attaches source-only evidence and page-aware citations.
  3. **Examiner** — writes retrieval prompts and expected answers grounded in the source.
  4. **Critic** — independently approves, flags, corrects, or rejects generated claims/prompts.
- Keeps the fifth **Memory Engine** deterministic and local so learner state is not invented by a model.
- Uses Structured Outputs / JSON Schema so each specialist returns a predictable data contract.
- Defaults to `gpt-5.6-luna` for Cartographer/Scholar/Examiner and `gpt-5.6-terra` for Critic.
- If the API is unavailable or no key is configured, ProjLearn automatically falls back to the local v0.1 compiler so the demo still works.
- Every concept, claim, and prompt can carry a source citation and page number when page markers are available.
- Human correction now **propagates**: correcting a prompt marks related claims for the same concept as needing re-check.
- Missed retrieval prompts still persist across reloads and return first in the next session.

## Why the models are split

Language tasks use models; memory does not.

- `gpt-5.6-luna`: inexpensive generation/extraction stages.
- `gpt-5.6-terra`: stronger independent critic pass.
- Browser `localStorage`: attempt history and human verification state.

This gives the hackathon demo visible multi-agent behavior without paying for five expensive frontier calls on every interaction.

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
PROJLEARN_CRITIC_MODEL=gpt-5.6-terra
PROJLEARN_MAX_SOURCE_CHARS=180000
```

`OPENAI_API_KEY` must stay in Netlify environment variables. **Never put it in `app.js`, HTML, GitHub, or client-side localStorage.**

The included `netlify.toml` builds an allowlisted `dist/` directory and configures Functions separately. Environment files and server source are excluded from the static output. Set the API key for the Functions scope and Production context using Netlify’s dashboard, then redeploy. Do not paste the key into chat.

Local validation: `node --test tests/compile-course.test.mjs` and `node scripts/build.mjs`. Mocked tests do not prove live model access; verify the deployed UI says **LIVE AI**, not **LOCAL FALLBACK**, before presenting the live-agent demo.

The four sequential provider calls still need a live latency check against the target Netlify account’s function timeout.

## Source/privacy behavior

1. The browser extracts text from PDF/TXT/Markdown.
2. With live AI enabled, extracted text is POSTed to the same-origin Netlify Function.
3. The function calls the model API using the server-side key.
4. The original uploaded file is not stored by ProjLearn in this prototype.
5. Without live AI, compilation stays local in the browser.

## TAPIA demo path

1. Load a course source or choose **Load TAPIA demo**.
2. Show Cartographer → Scholar → Examiner → Critic → Memory Engine.
3. Open a retrieval prompt and reveal its source evidence.
4. Mark one prompt missed.
5. Reload the page: the missed prompt returns first.
6. Use **Agent/source mismatch?** on a genuinely weak item found during testing.
7. Enter the human correction; ProjLearn records the override and marks related claims for re-check.
8. Open the Agent Trace / Human Check area to show judges the model was not treated as authoritative.

## Current limitations / next milestone

- The agent pipeline currently returns after all four server-side calls complete; streaming per-stage progress is the next UX improvement.
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
- Generator `gpt-5.6-luna`, critic `gpt-5.6-terra`, source limit `180000`.
- Deployed fallback compilation and missed-prompt persistence passed. First live request returned sanitized `COMPILE_FAILED` after approximately 20 seconds; live AI has **not** passed end-to-end verification.
- Safe per-stage diagnostics were added after that failure. Inspect the function logs and retest a sample chapter before claiming a working live AI pipeline.
- Local DOM interaction checks passed for routing, notebook tabs, fallback compilation, missed-prompt memory, inline correction persistence and claim propagation, theme switching, and adaptive-session opening/closing. Updated visual layout still requires live browser review.
- The separate `l8-learning` project was not modified.
