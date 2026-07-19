import fetchWithTimeout from "../../../shared/fetchWithTimeout.js";

// Sends the take's transcript to Gemini and returns a corrected, more
// colloquial version plus an itemised change list. Requests go through the
// Cloudflare Worker proxy when VITE_GEMINI_PROXY_URL is set (key stays
// server-side), or directly with VITE_GEMINI_API_KEY for local development.
// The feature is hidden when neither was present at build time.
const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const REQUEST_TIMEOUT_MS = 30000;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    revisedScript: { type: "STRING" },
    summary: { type: "STRING" },
    changes: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          original: { type: "STRING" },
          suggestion: { type: "STRING" },
          reason: { type: "STRING" },
        },
        required: ["original", "suggestion", "reason"],
      },
    },
  },
  required: ["revisedScript", "summary", "changes"],
};

// Preferred setup: VITE_GEMINI_PROXY_URL points at the Cloudflare Worker in
// worker/, which holds the key server-side. A direct VITE_GEMINI_API_KEY
// still works for local development but ships the key in the bundle (see
// KNOWN_ISSUES.md). Optional chaining keeps these node-safe for the checks.
function getProxyUrl() {
  return import.meta.env?.VITE_GEMINI_PROXY_URL ?? "";
}

function getApiKey() {
  return import.meta.env?.VITE_GEMINI_API_KEY ?? "";
}

export function isTranscriptCoachAvailable() {
  return Boolean(getProxyUrl() || getApiKey());
}

function buildPrompt(transcript, languageCode) {
  return [
    "You are a supportive speaking coach helping a language learner improve how they speak.",
    `Below is a speech-recognition transcript of the learner speaking the language with locale code "${languageCode}".`,
    "",
    "Produce revisedScript: the same speech, corrected and phrased the way a fluent speaker would naturally SAY it.",
    "Rules for revisedScript:",
    "- Fix grammar (tense, agreement, articles, word order) and unnatural word choice.",
    "- Prefer casual, colloquial spoken phrasing. Short sentences are good. Never make it more formal or bookish.",
    "- Keep the learner's meaning, content, and order of ideas. Do not add new material.",
    "- Silently drop filler words (um, uh, you know). Do not report them as changes.",
    "- Ignore punctuation and casing artefacts from speech recognition unless they change the meaning.",
    "- Write revisedScript in the same language as the transcript.",
    "",
    "Report the corrections in changes, most important first, at most 8. Skip trivial nitpicks.",
    "Rules for each change:",
    "- original must be copied verbatim from the transcript, without crossing sentence boundaries.",
    "- suggestion is the natural replacement for exactly that fragment.",
    "- Keep each original/suggestion pair as short as possible: a word or short phrase, never a whole sentence.",
    "- reason: under 15 words, in English, naming the point (e.g. \"past simple after 'yesterday'\") so the learner can study it.",
    "",
    "Write summary: one or two sentences in English of overall advice, naming the main recurring pattern the learner should practise in their next take.",
    "",
    "If the transcript already sounds natural, return it unchanged with an empty changes list and say so in summary.",
    "If the transcript is too short or unintelligible to review, return it unchanged with an empty changes list and a summary saying there was not enough speech to review.",
    "",
    "Transcript:",
    transcript,
  ].join("\n");
}

// Exported for the scratch self-check: turns a raw generateContent response
// body into { revisedScript, changes } or throws.
export function parseSuggestionResponse(responseBody) {
  const rawText = responseBody?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (typeof rawText !== "string" || !rawText.trim()) {
    throw new Error("empty-response");
  }

  // responseSchema should give clean JSON, but strip a markdown fence if the
  // model wraps one anyway.
  const jsonText = rawText.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(jsonText);

  if (typeof parsed?.revisedScript !== "string" || !Array.isArray(parsed?.changes)) {
    throw new Error("malformed-response");
  }

  return {
    revisedScript: parsed.revisedScript,
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    changes: parsed.changes.filter(
      (change) =>
        typeof change?.original === "string" &&
        typeof change?.suggestion === "string" &&
        typeof change?.reason === "string",
    ),
  };
}

// Maps the corrections back onto the original timestamped entries so the
// transcript keeps its exact format with corrections applied in place.
// Returns one segment array per entry; segments carrying a change display
// change.suggestion instead of what was said. Each change is matched
// case-insensitively, consumed at most once across all entries, and
// non-overlapping matches win by position. Changes whose original never
// matches (e.g. it spans two entries) stay unhighlighted but still appear in
// the change list.
export function annotateTranscriptEntries(entries, changes) {
  const remaining = (changes ?? []).filter((change) => change.original);

  return (entries ?? []).map((entry) => {
    const text = entry.text ?? "";
    const lowerText = text.toLowerCase();
    const matches = [];

    for (const change of remaining) {
      const index = lowerText.indexOf(change.original.toLowerCase());

      if (index !== -1) {
        matches.push({ start: index, end: index + change.original.length, change });
      }
    }

    matches.sort((a, b) => a.start - b.start);

    const segments = [];
    let lastIndex = 0;

    for (const match of matches) {
      if (match.start < lastIndex) {
        continue;
      }

      if (match.start > lastIndex) {
        segments.push({ text: text.slice(lastIndex, match.start), change: null });
      }

      segments.push({
        text: match.change.suggestion,
        change: match.change,
        // What the learner actually said, with the entry's own casing, for
        // the hover tooltip.
        saidText: text.slice(match.start, match.end),
      });
      remaining.splice(remaining.indexOf(match.change), 1);
      lastIndex = match.end;
    }

    if (lastIndex < text.length) {
      segments.push({ text: text.slice(lastIndex), change: null });
    }

    return segments;
  });
}

export async function fetchTranscriptSuggestions({ transcript, languageCode }) {
  const proxyUrl = getProxyUrl();
  let response;

  try {
    response = await fetchWithTimeout(proxyUrl || GEMINI_URL, {
      method: "POST",
      timeoutMs: REQUEST_TIMEOUT_MS,
      headers: {
        "Content-Type": "application/json",
        // Only the direct (dev) path carries a key; the proxy holds its own.
        ...(proxyUrl ? {} : { "x-goog-api-key": getApiKey() }),
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(transcript, languageCode) }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
    });
  } catch {
    throw new Error("Could not reach Gemini. Check your connection and try again.");
  }

  if (response.status === 429) {
    throw new Error("Gemini quota reached for now. Try again later.");
  }

  if (!response.ok) {
    throw new Error("Could not fetch suggestions. Check your connection and try again.");
  }

  try {
    return parseSuggestionResponse(await response.json());
  } catch {
    throw new Error("Gemini returned an unexpected answer. Try again.");
  }
}
