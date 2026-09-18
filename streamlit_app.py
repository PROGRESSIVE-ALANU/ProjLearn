import json
import os
import re
from io import BytesIO

import requests
import streamlit as st
from pypdf import PdfReader

st.set_page_config(page_title="ProjLearn", page_icon="📘", layout="wide")

MODEL = os.getenv("PROJLEARN_MODEL", "gpt-5.6-luna")
OPENAI_URL = "https://api.openai.com/v1/responses"
MAX_SOURCE_CHARS = 60000

st.markdown(
    """
    <style>
      .block-container {max-width: 1180px; padding-top: 2rem;}
      [data-testid="stAppViewContainer"] {background:#f7f8fb;}
      .pl-kicker {font-size:.72rem; letter-spacing:.16em; font-weight:700; color:#60708c;}
      .pl-title {font-family:Georgia,serif; font-size:3.2rem; line-height:1.05; color:#17243d; margin:.25rem 0 .8rem;}
      .pl-card {background:white; border:1px solid #dfe4ed; border-top:3px solid #315bcb; border-radius:8px; padding:1.2rem 1.35rem; margin:.5rem 0 1rem;}
      .pl-chip {display:inline-block; background:#eaf0fb; color:#35517e; padding:.25rem .5rem; border-radius:4px; font-size:.72rem; font-weight:700;}
      .pl-good {border-left:4px solid #83b3a8; padding:.7rem .9rem; background:#fff;}
      .pl-close {border-left:4px solid #c99b43; padding:.7rem .9rem; background:#fff;}
      .pl-review {border-left:4px solid #dc7761; padding:.7rem .9rem; background:#fff;}
    </style>
    """,
    unsafe_allow_html=True,
)

def api_key():
    try:
        key = st.secrets.get("OPENAI_API_KEY")
        if key:
            return key
    except Exception:
        pass
    return os.getenv("OPENAI_API_KEY")

def extract_upload(uploaded):
    name = uploaded.name
    lower = name.lower()
    data = uploaded.getvalue()
    if lower.endswith(".pdf"):
        reader = PdfReader(BytesIO(data))
        pages = []
        for i, page in enumerate(reader.pages, 1):
            text = page.extract_text() or ""
            pages.append(f"[Page {i}]\n{text}")
        return "\n\n".join(pages)
    return data.decode("utf-8", errors="replace")

def normalize(value):
    return re.sub(r"\s+", " ", str(value or "")).strip().lower()

def quote_grounded(quote, source):
    q = normalize(quote)
    return len(q) >= 8 and q in normalize(source)

def normalize_answer(value):
    value = str(value or "").lower()
    value = re.sub(r"ε₀|epsilon[_\s-]?0|epsilon\s*naught", "epsilon0", value)
    value = value.replace("∮", " integral ").replace("Φ", " flux ")
    return re.sub(r"[^a-z0-9]+", " ", value).strip()

def grade_answer(answer, expected):
    typed = normalize_answer(answer)
    target = normalize_answer(expected)
    if not typed:
        return "empty", "Type an answer first."
    stop = {"the","and","that","this","with","from","into","your","what","when","where","which","then","than","have","has","had","for","are","was","were","its","you","can","will","law","given","summary","state","equals","equal"}
    expected_tokens = {t for t in target.split() if len(t) >= 3 and t not in stop}
    typed_tokens = set(typed.split())
    if not expected_tokens:
        return "manual", "Reveal the source and self-check this one."
    score = len(expected_tokens & typed_tokens) / len(expected_tokens)
    if score >= .70:
        return "strong", "Looks right — your answer covers most of the source-backed answer."
    if score >= .40:
        return "close", "Close — you have part of it. Compare with the source."
    return "review", "Needs another look. Compare with the source evidence."

citation_schema = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "source": {"type": "string"},
        "page": {"type": ["integer", "null"]},
        "quote": {"type": "string"},
    },
    "required": ["source", "page", "quote"],
}

compiler_schema = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "title": {"type": "string"},
        "summary": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "overview": {"type": "string"},
                "keyPoints": {"type": "array", "minItems": 3, "maxItems": 7, "items": {"type": "string"}},
                "studyFocus": {"type": "array", "minItems": 2, "maxItems": 5, "items": {"type": "string"}},
            },
            "required": ["overview", "keyPoints", "studyFocus"],
        },
        "concepts": {
            "type": "array", "minItems": 4, "maxItems": 12,
            "items": {
                "type": "object", "additionalProperties": False,
                "properties": {
                    "title": {"type": "string"},
                    "importance": {"type": "string", "enum": ["core", "supporting", "extension"]},
                    "prerequisiteTitles": {"type": "array", "items": {"type": "string"}, "maxItems": 4},
                    "whyItMatters": {"type": "string"},
                    "evidence": {"type": "string"},
                    "citation": citation_schema,
                },
                "required": ["title","importance","prerequisiteTitles","whyItMatters","evidence","citation"],
            },
        },
        "claims": {
            "type": "array", "minItems": 4, "maxItems": 10,
            "items": {
                "type": "object", "additionalProperties": False,
                "properties": {
                    "text": {"type": "string"},
                    "conceptTitle": {"type": "string"},
                    "citation": citation_schema,
                },
                "required": ["text","conceptTitle","citation"],
            },
        },
        "prompts": {
            "type": "array", "minItems": 4, "maxItems": 10,
            "items": {
                "type": "object", "additionalProperties": False,
                "properties": {
                    "conceptTitle": {"type": "string"},
                    "prompt": {"type": "string"},
                    "expectedAnswer": {"type": "string"},
                    "citation": citation_schema,
                    "difficulty": {"type": "string", "enum": ["recall","explain","apply","compare"]},
                },
                "required": ["conceptTitle","prompt","expectedAnswer","citation","difficulty"],
            },
        },
    },
    "required": ["title","summary","concepts","claims","prompts"],
}

def extract_response_text(payload):
    if isinstance(payload.get("output_text"), str) and payload["output_text"].strip():
        return payload["output_text"]
    for item in payload.get("output", []):
        for content in item.get("content", []):
            if isinstance(content.get("text"), str) and content["text"].strip():
                return content["text"]
    raise RuntimeError("The model returned no structured text.")

def semantic_grade_answer(question, expected, user_answer, evidence):
    key = api_key()
    if not key:
        raise RuntimeError("OPENAI_API_KEY is not configured in Streamlit secrets.")

    schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "verdict": {"type": "string", "enum": ["correct", "partial", "incorrect"]},
            "feedback": {"type": "string"},
            "missingPoint": {"type": ["string", "null"]},
        },
        "required": ["verdict", "feedback", "missingPoint"],
    }
    payload = {
        "model": MODEL,
        "store": False,
        "max_output_tokens": 500,
        "reasoning": {"effort": "low"},
        "instructions": (
            "You are ProjLearn's semantic answer grader. Judge meaning, not wording. "
            "Accept mathematically, numerically, symbolically, or verbally equivalent answers "
            '(for example "0" and "zero") and harmless differences in notation or phrasing. '
            "Use only the supplied question, expected answer, and source evidence. "
            'Return correct when the required idea is expressed, partial when an important part is missing, '
            "and incorrect when the answer conflicts with or fails to express the required idea."
        ),
        "input": (
            f"QUESTION:\n{question}\n\nEXPECTED SOURCE-BACKED ANSWER:\n{expected}\n\n"
            f"SOURCE EVIDENCE:\n{evidence}\n\nLEARNER ANSWER:\n{user_answer}"
        ),
        "text": {
            "format": {
                "type": "json_schema",
                "name": "projlearn_answer_grade",
                "strict": True,
                "schema": schema,
            }
        },
    }
    response = requests.post(
        OPENAI_URL,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json=payload,
        timeout=25,
    )
    data = response.json()
    if not response.ok:
        code = ((data.get("error") or {}).get("code") or f"HTTP_{response.status_code}")
        raise RuntimeError(f"AI grading failed: {code}")
    return json.loads(extract_response_text(data))

def course_context(course):
    concepts = "\n".join(
        f"- {item['title']}: {item.get('evidence') or item.get('whyItMatters','')}"
        for item in course.get("concepts", [])
    )
    claims = "\n".join(f"- {item['text']}" for item in course.get("claims", []))
    prompts = "\n".join(
        f"- Q: {item['prompt']}\n  A: {item['expectedAnswer']}\n  Evidence: {item.get('citation',{}).get('quote','')}"
        for item in course.get("prompts", [])
    )
    return (
        f"COURSE: {course.get('title','Course')}\nSOURCE: {course.get('sourceName','Course material')}\n\n"
        f"CONCEPTS:\n{concepts}\n\nSOURCE-BACKED CLAIMS:\n{claims}\n\nPRACTICE SET:\n{prompts}"
    )

def ask_course_coach(course, message, history):
    key = api_key()
    if not key:
        raise RuntimeError("OPENAI_API_KEY is not configured in Streamlit secrets.")
    recent = "\n".join(
        f"{'COACH' if item.get('role') == 'assistant' else 'LEARNER'}: {item.get('content','')}"
        for item in history[-8:]
    )
    payload = {
        "model": MODEL,
        "store": False,
        "max_output_tokens": 1200,
        "reasoning": {"effort": "low"},
        "instructions": (
            "You are ProjLearn's course coach. Ground answers in the supplied course context. "
            "If the context does not support a factual claim, say the uploaded material does not cover it. "
            "Explain simply, compare concepts, generate short practice questions, and discuss why answers are right or wrong."
        ),
        "input": (
            f"COURSE CONTEXT:\n{course_context(course)[:30000]}\n\nRECENT CHAT:\n{recent or '(none)'}\n\n"
            f"LEARNER: {message}\nCOACH:"
        ),
    }
    response = requests.post(
        OPENAI_URL,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json=payload,
        timeout=25,
    )
    data = response.json()
    if not response.ok:
        code = ((data.get("error") or {}).get("code") or f"HTTP_{response.status_code}")
        raise RuntimeError(f"Course coach failed: {code}")
    return extract_response_text(data)

def compile_course(source_text, source_name):
    key = api_key()
    if not key:
        raise RuntimeError("OPENAI_API_KEY is not configured in Streamlit secrets.")

    source = source_text.strip()
    if len(source) > MAX_SOURCE_CHARS:
        head = source[: int(MAX_SOURCE_CHARS * .72)]
        tail = source[-int(MAX_SOURCE_CHARS * .28):]
        source = head + "\n\n[... middle omitted for latency ...]\n\n" + tail

    payload = {
        "model": MODEL,
        "store": False,
        "max_output_tokens": 7000,
        "reasoning": {"effort": "low"},
        "instructions": (
            "You are ProjLearn's single source-grounded course compiler. Read ONLY the supplied "
            "course material. In one pass first create a concise learner-facing summary, then identify teachable concepts and prerequisite relationships, "
            "attach concise evidence, produce review claims, and write retrieval-practice prompts. "
            "Do not use outside knowledge. Every citation quote must be a short exact excerpt copied "
            "from the supplied source. Use [Page N] markers when present. Keep expected answers concise."
        ),
        "input": f"SOURCE NAME: {source_name}\n\nSOURCE:\n{source}",
        "text": {
            "format": {
                "type": "json_schema",
                "name": "projlearn_course_compiler",
                "strict": True,
                "schema": compiler_schema,
            }
        },
    }

    response = requests.post(
        OPENAI_URL,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json=payload,
        timeout=35,
    )
    data = response.json()
    if not response.ok:
        code = ((data.get("error") or {}).get("code") or f"HTTP_{response.status_code}")
        raise RuntimeError(f"OpenAI compilation failed: {code}")

    course = json.loads(extract_response_text(data))
    for concept in course["concepts"]:
        concept["sourceVerified"] = quote_grounded(concept["citation"]["quote"], source)
    for claim in course["claims"]:
        claim["sourceVerified"] = quote_grounded(claim["citation"]["quote"], source)
    for prompt in course["prompts"]:
        prompt["sourceVerified"] = quote_grounded(prompt["citation"]["quote"], source)
    course["sourceName"] = source_name
    return course

SAMPLE = """Physics II — Electric Fields, Flux, and Potential

[Page 1]
Electric flux measures how much electric field passes through a surface. For a uniform field through a flat surface, flux is Φ = EA cos θ.

[Page 2]
Gauss's law states that the net electric flux through any closed surface equals the enclosed charge divided by epsilon zero: Φ = Q_enclosed / ε₀. Charges outside the surface can affect the field at points on the surface but contribute zero net flux through the closed surface.

[Page 3]
Electric potential is potential energy per unit charge. The electric potential difference between two points is related to the work done per unit charge moving between those points.
"""

if "course" not in st.session_state:
    st.session_state.course = None
if "source_text" not in st.session_state:
    st.session_state.source_text = ""
if "source_name" not in st.session_state:
    st.session_state.source_name = ""
if "coach_history" not in st.session_state:
    st.session_state.coach_history = []
if "review_memory" not in st.session_state:
    st.session_state.review_memory = {}

st.markdown('<div class="pl-kicker">PROJLEARN · THE STUDY ROOM</div>', unsafe_allow_html=True)
st.markdown('<div class="pl-title">Turn a source into practice.</div>', unsafe_allow_html=True)
st.caption("Upload course material, compile it once with AI, then practice against source-backed answers.")

left, right = st.columns([1.35, 1], gap="large")
with left:
    uploads = st.file_uploader("Course source", type=["pdf","txt","md"], accept_multiple_files=True)
    c1, c2 = st.columns(2)
    use_sample = c1.button("Use sample chapter", use_container_width=True)
    compile_clicked = c2.button("Build study workspace", type="primary", use_container_width=True)

    if use_sample:
        st.session_state.source_text = SAMPLE
        st.session_state.source_name = "ProjLearn Physics sample"
        st.success("Sample chapter loaded.")

    if uploads:
        chunks = []
        for upload in uploads:
            chunks.append(f"\n\n===== {upload.name} =====\n\n{extract_upload(upload)}")
        st.session_state.source_text = "".join(chunks).strip()
        st.session_state.source_name = ", ".join(u.name for u in uploads)

    if compile_clicked:
        if len(st.session_state.source_text.strip()) < 200:
            st.warning("Upload a source or load the sample chapter first.")
        else:
            try:
                with st.spinner("Course AI is building concepts, evidence, and practice…"):
                    st.session_state.course = compile_course(
                        st.session_state.source_text,
                        st.session_state.source_name or "Course material",
                    )
                    st.session_state.coach_history = []
                    st.session_state.review_memory = {}
                st.success("LIVE AI compilation complete.")
            except Exception as exc:
                st.error(str(exc))

with right:
    st.markdown('<div class="pl-card"><span class="pl-chip">01 · COURSE AI</span><h3>One pass.</h3><p>Concepts, evidence, and practice questions are generated together.</p><span class="pl-chip">02 · SOURCE VALIDATOR</span><p>Quoted evidence is matched back to the uploaded text.</p><span class="pl-chip">03 · MEMORY</span><p>Your answers stay in the Streamlit session.</p></div>', unsafe_allow_html=True)

course = st.session_state.course
if course:
    st.divider()
    st.subheader(course["title"])
    st.caption(course.get("sourceName", "Course material"))

    summary = course.get("summary") or {}
    st.markdown("### AI summary")
    st.write(summary.get("overview") or "ProjLearn extracted the main ideas from this source.")
    sc1, sc2 = st.columns([1.35, 1])
    with sc1:
        st.markdown("**Key points**")
        for point in summary.get("keyPoints", []):
            st.markdown(f"- {point}")
    with sc2:
        st.markdown("**What to focus on**")
        for point in summary.get("studyFocus", []):
            st.markdown(f"- {point}")

    st.divider()
    concepts_tab, practice_tab, coach_tab, evidence_tab = st.tabs(["Concepts", "Practice", "Course coach", "Source evidence"])

    with concepts_tab:
        cols = st.columns(2)
        for idx, concept in enumerate(course["concepts"]):
            with cols[idx % 2]:
                status = "source matched" if concept.get("sourceVerified") else "check citation"
                st.markdown(f"**{concept['title']}** · {concept['importance']} · {status}")
                st.write(concept["whyItMatters"])
                if concept["prerequisiteTitles"]:
                    st.caption("Needs: " + ", ".join(concept["prerequisiteTitles"]))

    with practice_tab:
        if st.session_state.review_memory:
            st.markdown("### Review these first")
            st.caption("Concepts you missed stay at the top of your review queue.")
            for key, review in st.session_state.review_memory.items():
                st.markdown(f"**{review['conceptTitle']}** — {review['prompt']}")
            st.divider()

        for i, prompt in enumerate(course["prompts"]):
            st.markdown(f"#### {i+1}. {prompt['prompt']}")
            st.caption(f"{prompt['conceptTitle']} · {prompt['difficulty']}")
            answer = st.text_area("Your answer", key=f"answer_{i}", placeholder="Type what you remember…")
            if st.button("Check answer", key=f"check_{i}"):
                if not answer.strip():
                    st.session_state[f"feedback_{i}"] = ("pl-close", "Type an answer first.")
                else:
                    try:
                        with st.spinner("Checking meaning…"):
                            grade = semantic_grade_answer(
                                prompt["prompt"],
                                prompt["expectedAnswer"],
                                answer,
                                prompt.get("citation", {}).get("quote", ""),
                            )
                        css = {"correct":"pl-good","partial":"pl-close","incorrect":"pl-review"}.get(grade["verdict"], "pl-close")
                        message = grade["feedback"]
                        if grade.get("missingPoint"):
                            message += f" Missing: {grade['missingPoint']}"
                        st.session_state[f"feedback_{i}"] = (css, message)
                    except Exception:
                        verdict, message = grade_answer(answer, prompt["expectedAnswer"])
                        css = {"strong":"pl-good","close":"pl-close","review":"pl-review"}.get(verdict, "pl-close")
                        st.session_state[f"feedback_{i}"] = (css, "AI grading was unavailable. Fast local check: " + message)
            feedback = st.session_state.get(f"feedback_{i}")
            if feedback:
                st.markdown(f'<div class="{feedback[0]}">{feedback[1]}</div>', unsafe_allow_html=True)
            with st.expander("Reveal source evidence"):
                st.write("**Expected answer:**", prompt["expectedAnswer"])
                st.write("**Source:**", prompt["citation"]["quote"])
                page = prompt["citation"].get("page")
                st.caption(f"{prompt['citation'].get('source','Course source')}" + (f" · p. {page}" if page else ""))

            r1, r2 = st.columns(2)
            if r1.button("I had it", key=f"knew_{i}", use_container_width=True):
                st.session_state.review_memory.pop(str(i), None)
                st.success("Removed from immediate review.")
            if r2.button("I missed it", key=f"missed_{i}", use_container_width=True):
                st.session_state.review_memory[str(i)] = {
                    "conceptTitle": prompt["conceptTitle"],
                    "prompt": f"Try this again from another angle: explain {prompt['conceptTitle']} in your own words and connect it to the source.",
                    "expectedAnswer": prompt["expectedAnswer"],
                    "evidence": prompt["citation"]["quote"],
                    "misses": st.session_state.review_memory.get(str(i), {}).get("misses", 0) + 1,
                }
                st.warning("Saved as a review priority for this session.")
            st.divider()

    with coach_tab:
        st.caption("Source-grounded course chat. Ask for explanations, comparisons, or another quiz question.")
        for item in st.session_state.coach_history:
            with st.chat_message("assistant" if item["role"] == "assistant" else "user"):
                st.write(item["content"])

        coach_message = st.text_input("Ask the course coach", key="coach_message", placeholder="Explain Gauss's law another way…")
        if st.button("Ask coach", type="primary", key="ask_course_coach") and coach_message.strip():
            history_before = list(st.session_state.coach_history)
            st.session_state.coach_history.append({"role": "user", "content": coach_message.strip()})
            try:
                with st.spinner("Coach is thinking…"):
                    reply = ask_course_coach(course, coach_message.strip(), history_before)
                st.session_state.coach_history.append({"role": "assistant", "content": reply})
                st.rerun()
            except Exception as exc:
                st.error(str(exc))

    with evidence_tab:
        for claim in course["claims"]:
            mark = "✓" if claim.get("sourceVerified") else "!"
            st.markdown(f"**{mark} {claim['conceptTitle']}**")
            st.write(claim["text"])
            st.caption(claim["citation"]["quote"])
