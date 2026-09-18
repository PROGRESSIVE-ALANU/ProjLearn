const STOPWORDS = new Set(`a an and are as at be because been but by can could did do does for from had has have how i if in into is it its may more most not of on or our should so than that the their them then there these they this to was we were what when where which who will with would you your using use used`.split(/\s+/));

const sentenceSplit = /(?<=[.!?])\s+(?=[A-Z0-9])/g;

function cleanText(text = "") {
  return text
    .replace(/\u0000/g, " ")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function titleCase(value) {
  return value
    .split(/\s+/)
    .map((part) => part ? part[0].toUpperCase() + part.slice(1) : part)
    .join(" ");
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56) || `concept-${Math.random().toString(36).slice(2, 8)}`;
}

function extractHeadings(text) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const headings = [];
  for (const line of lines) {
    if (line.length < 4 || line.length > 90) continue;
    const markdown = /^#{1,6}\s+(.+)/.exec(line);
    const numbered = /^(?:chapter|section|unit|lecture|module|\d+(?:\.\d+){0,3})[:.\-\s]+(.+)/i.exec(line);
    const looksLikeTitle = /^[A-Z][A-Za-z0-9 '&()/:,\-]{3,70}$/.test(line) && !/[.!?]$/.test(line);
    const value = markdown?.[1] ?? numbered?.[1] ?? (looksLikeTitle ? line : null);
    if (value) headings.push(value.replace(/^\d+(?:\.\d+)*\s*/, "").trim());
  }
  return [...new Set(headings)].slice(0, 12);
}

function extractKeywords(text) {
  const counts = new Map();
  const words = text.match(/[A-Za-z][A-Za-z\-]{3,}/g) ?? [];
  for (const raw of words) {
    const word = raw.toLowerCase();
    if (STOPWORDS.has(word) || /^(figure|table|chapter|section|example|student|students|question|questions)$/.test(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 24)
    .map(([word]) => titleCase(word));
}

function findEvidence(text, term, sourceName = "Course material") {
  const pageParts = text.split(/(?=\[Page \d+\])/g);
  const lower = term.toLowerCase();
  for (const part of pageParts) {
    const pageMatch = /^\[Page (\d+)\]/.exec(part.trim());
    const sentences = part.split(sentenceSplit).map((s) => s.replace(/\s+/g, " ").replace(/^\[Page \d+\]\s*/, "").trim()).filter(Boolean);
    const match = sentences.find((sentence) => sentence.toLowerCase().includes(lower));
    if (match) return { evidence: match.slice(0, 360), citation: { source: sourceName, page: pageMatch ? Number(pageMatch[1]) : null, quote: match.slice(0, 180) } };
  }
  const sentences = text.split(sentenceSplit).map((s) => s.replace(/\s+/g, " ").replace(/\[Page \d+\]/g, "").trim()).filter(Boolean);
  const fallback = (sentences.find((sentence) => sentence.length > 60) ?? text.slice(0, 260)).slice(0, 360);
  return { evidence: fallback, citation: { source: sourceName, page: null, quote: fallback.slice(0, 180) } };
}

function buildClaims(text, concepts) {
  const sentences = text
    .split(sentenceSplit)
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter((sentence) => sentence.length >= 55 && sentence.length <= 320);

  const scored = sentences.map((sentence) => {
    const conceptHits = concepts.filter((concept) => sentence.toLowerCase().includes(concept.title.toLowerCase())).length;
    const cue = /\b(therefore|because|important|means|defined|requires|depends|results|causes|increases|decreases|however|must|only)\b/i.test(sentence) ? 2 : 0;
    return { sentence, score: conceptHits * 3 + cue + Math.min(sentence.length / 160, 1) };
  });

  const seen = new Set();
  return scored
    .sort((a, b) => b.score - a.score)
    .filter(({ sentence }) => {
      const key = sentence.toLowerCase().slice(0, 80);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 6)
    .map(({ sentence }, index) => ({ id: `claim-${index + 1}`, text: sentence }));
}

export function compileCourseFromText({ text, sourceName = "Course material" }) {
  const normalized = cleanText(text);
  if (!normalized) throw new Error("No readable text was found in the selected files.");

  const headingTerms = extractHeadings(normalized);
  const headingWords = new Set(headingTerms.flatMap((term) => term.toLowerCase().split(/\s+/).filter((word) => word.length > 3)));
  const keywordTerms = extractKeywords(normalized).filter((term) => !headingWords.has(term.toLowerCase()));
  const terms = [...new Set([...headingTerms, ...keywordTerms])].slice(0, 10);
  const fallbackTerms = ["Core ideas", "Definitions", "Methods", "Applications"];
  const finalTerms = terms.length >= 4 ? terms : [...terms, ...fallbackTerms].slice(0, 6);

  const concepts = finalTerms.map((title, index) => {
    const grounded = findEvidence(normalized, title, sourceName);
    return {
      id: slugify(title),
      title,
      order: index,
      importance: index < 4 ? "core" : "supporting",
      prerequisites: index ? [slugify(finalTerms[index - 1])] : [],
      evidence: grounded.evidence,
      citation: grounded.citation,
      sourceName,
    };
  });

  const edges = concepts.slice(1).map((concept, index) => ({
    from: concepts[index].id,
    to: concept.id,
    relation: "source-order prerequisite",
  }));

  const claims = buildClaims(normalized, concepts).map((claim, index) => {
    const concept = concepts[index % concepts.length];
    return { ...claim, conceptId: concept?.id ?? null, citation: concept?.citation ?? { source: sourceName, page: null, quote: claim.text.slice(0, 180) }, criticStatus: "needs-human-check", criticNote: "Local fallback has not been independently model-checked." };
  });
  const prompts = concepts.slice(0, 6).map((concept, index) => ({
    id: `prompt-${index + 1}`,
    conceptId: concept.id,
    prompt: `Without looking back, explain ${concept.title} and connect it to the surrounding ideas in the source.`,
    expectedAnswer: concept.evidence,
    evidence: concept.evidence,
    citation: concept.citation,
    difficulty: index % 2 ? "explain" : "recall",
    verification: "needs-human-check",
    criticStatus: "needs-human-check",
    criticNote: "Local fallback has not been independently model-checked.",
  }));

  const firstUsefulLine = normalized.split("\n").map((line) => line.trim()).find((line) => line.length >= 8 && line.length <= 100);
  return {
    title: firstUsefulLine ?? sourceName.replace(/\.[a-z0-9]+$/i, ""),
    sourceName,
    charCount: normalized.length,
    concepts,
    edges,
    claims,
    prompts,
    ai: { enabled: false, provider: "local", generatorModel: null, criticModel: null },
    trace: [
      { stage: "Cartographer", action: `Extracted ${concepts.length} candidate concepts from source headings and term frequency.`, status: "complete" },
      { stage: "Scholar", action: `Attached source evidence and selected ${claims.length} retrieval-worthy claims.`, status: "complete" },
      { stage: "Examiner", action: `Created ${prompts.length} source-checkable teach-back prompts.`, status: "complete" },
      { stage: "Critic", action: "Marked generated prompts for human source verification rather than auto-approving them.", status: "complete" },
      { stage: "Memory Engine", action: "Prepared persistent local state for future attempts and review scheduling.", status: "ready" },
    ],
  };
}

export async function readCourseFiles(files) {
  const parts = [];
  for (const file of files) {
    const ext = file.name.toLowerCase().split(".").pop();
    if (ext === "txt" || ext === "md" || file.type === "text/plain") {
      parts.push({ name: file.name, text: await file.text(), type: "text" });
      continue;
    }

    if (ext === "pdf" || file.type === "application/pdf") {
      const pdfjs = await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
      const buffer = await file.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: buffer }).promise;
      const pages = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        const pageText = content.items.map((item) => item.str).join(" ");
        pages.push(`[Page ${pageNumber}]\n${pageText}`);
      }
      parts.push({ name: file.name, text: pages.join("\n\n"), type: "pdf", pages: pdf.numPages });
      continue;
    }

    throw new Error(`${file.name} is not a supported file type yet.`);
  }
  return parts;
}
