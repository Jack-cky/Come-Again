// Filler-word tagging for the transcript review tab. A small per-language
// lexicon is matched against the recognised text; longer phrases are tried
// first so "you know" never splits into two misses.
// ponytail: naive lexicon — it flags every "like" and "actually" even when
// used legitimately, and the recogniser often strips "um"/"uh" before we see
// them. It is a self-review aid, not a verdict; upgrade to POS-aware tagging
// only if this proves too noisy.
const FILLER_LEXICONS = [
  {
    prefixes: ["en"],
    wordBoundaries: true,
    fillers: [
      "you know",
      "i mean",
      "kind of",
      "sort of",
      "umm",
      "uhh",
      "um",
      "uh",
      "erm",
      "er",
      "hmm",
      "basically",
      "literally",
      "actually",
      "like",
    ],
  },
  {
    prefixes: ["ja"],
    wordBoundaries: false,
    fillers: ["えーと", "えっと", "ええと", "あのー", "そのー", "なんか", "まあ"],
  },
];

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildPattern(lexicon) {
  const alternatives = [...lexicon.fillers]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|");

  return lexicon.wordBoundaries
    ? new RegExp(`\\b(?:${alternatives})\\b`, "giu")
    : new RegExp(`(?:${alternatives})`, "giu");
}

const patternByLexicon = new Map();

function getFillerPattern(languageCode) {
  const code = (languageCode ?? "").toLowerCase();
  const lexicon = FILLER_LEXICONS.find((entry) => entry.prefixes.some((prefix) => code.startsWith(prefix)));

  if (!lexicon) {
    return null;
  }

  if (!patternByLexicon.has(lexicon)) {
    patternByLexicon.set(lexicon, buildPattern(lexicon));
  }

  return patternByLexicon.get(lexicon);
}

// Splits text into ordered segments for rendering, marking filler matches.
export function segmentFillers(text, languageCode) {
  const input = text ?? "";
  const pattern = getFillerPattern(languageCode);

  if (!input || !pattern) {
    return input ? [{ text: input, isFiller: false }] : [];
  }

  const segments = [];
  let lastIndex = 0;

  for (const match of input.matchAll(pattern)) {
    if (match.index > lastIndex) {
      segments.push({ text: input.slice(lastIndex, match.index), isFiller: false });
    }

    segments.push({ text: match[0], isFiller: true });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < input.length) {
    segments.push({ text: input.slice(lastIndex), isFiller: false });
  }

  return segments;
}

// Number of filler matches, or null when the language has no lexicon yet —
// the metric then shows as "not measured" rather than a misleading zero.
export function countFillers(text, languageCode) {
  const pattern = getFillerPattern(languageCode);

  if (!pattern) {
    return null;
  }

  return [...(text ?? "").matchAll(pattern)].length;
}
