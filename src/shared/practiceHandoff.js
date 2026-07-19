// One-shot handoff from Mirror Practice's AI-corrected script to Sentence
// Practice, where the parts become a sentence-by-sentence practice queue.
// sessionStorage so it never outlives the browsing session.
const HANDOFF_KEY = "come-again.practice-handoff";

export function storePracticeHandoff(parts, languageCode) {
  try {
    sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({ parts, languageCode }));
  } catch {
    // Storage blocked; the learner can still copy the text manually.
  }
}

export function consumePracticeHandoff() {
  try {
    const raw = sessionStorage.getItem(HANDOFF_KEY);

    if (!raw) {
      return null;
    }

    sessionStorage.removeItem(HANDOFF_KEY);
    const parsed = JSON.parse(raw);
    const parts = Array.isArray(parsed?.parts)
      ? parsed.parts.filter((part) => typeof part === "string" && part.trim())
      : [];

    return parts.length ? { parts, languageCode: parsed.languageCode } : null;
  } catch {
    return null;
  }
}
