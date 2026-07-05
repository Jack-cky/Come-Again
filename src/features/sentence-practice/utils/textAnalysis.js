import {
  foldKatakanaToHiragana,
  isJapaneseLanguage,
  isJapanesePhoneticsReady,
  toJapanesePhoneticKey,
  tokenizeJapaneseChunks,
} from "../services/japanesePhonetics";
import { ENGLISH_LANGUAGE_PREFIX, isEnglishLanguage } from "../constants/languages";
const UNICODE_WORD_CHARACTER_CLASS =
  "\\p{L}\\p{N}\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}";
const FALLBACK_WORD_CHARACTER_CLASS =
  "A-Za-z0-9\\u00C0-\\u024F\\u0300-\\u036F\\u3040-\\u30FF\\u3400-\\u9FFF\\uAC00-\\uD7AF";

function buildSafeRegExp(unicodePattern, fallbackPattern) {
  try {
    return new RegExp(unicodePattern, "gu");
  } catch {
    return new RegExp(fallbackPattern, "g");
  }
}

const WORD_BOUNDARY_PATTERN = buildSafeRegExp(
  `[^${UNICODE_WORD_CHARACTER_CLASS}'’]+`,
  `[^${FALLBACK_WORD_CHARACTER_CLASS}'’]+`,
);
const COMPARISON_CHARACTER_PATTERN = buildSafeRegExp(
  `[^${UNICODE_WORD_CHARACTER_CLASS}]`,
  `[^${FALLBACK_WORD_CHARACTER_CLASS}]`,
);

function stripWhitespace(value) {
  return (value ?? "").replace(/\s+/g, "").trim();
}

function normalizeForComparison(value, languageCode) {
  if (isJapaneseLanguage(languageCode)) {
    // Compare Japanese by phonetic reading so kanji and kana spellings of the
    // same phrase match (話して vs はなして vs ハナシテ).
    return toJapanesePhoneticKey(value ?? "").replace(COMPARISON_CHARACTER_PATTERN, "");
  }

  const normalized = (value ?? "").normalize("NFKD").replace(COMPARISON_CHARACTER_PATTERN, "");

  if (isEnglishLanguage(languageCode)) {
    return normalized.toLowerCase();
  }

  return normalized;
}

function levenshteinDistance(a, b) {
  const left = a ?? "";
  const right = b ?? "";

  if (!left.length) {
    return right.length;
  }

  if (!right.length) {
    return left.length;
  }

  let previousRow = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let i = 1; i <= left.length; i += 1) {
    const currentRow = [i];

    for (let j = 1; j <= right.length; j += 1) {
      const substitutionCost = left[i - 1] === right[j - 1] ? 0 : 1;
      currentRow[j] = Math.min(
        previousRow[j] + 1,
        currentRow[j - 1] + 1,
        previousRow[j - 1] + substitutionCost,
      );
    }

    previousRow = currentRow;
  }

  return previousRow[right.length];
}

export function computeAccuracy(referenceText, hypothesisText, languageCode = ENGLISH_LANGUAGE_PREFIX) {
  const reference = normalizeForComparison(referenceText, languageCode);
  const hypothesis = normalizeForComparison(hypothesisText, languageCode);

  if (!reference) {
    return null;
  }

  if (!hypothesis) {
    return null;
  }

  const distance = levenshteinDistance(reference, hypothesis);
  const maxLength = Math.max(reference.length, hypothesis.length) || 1;
  const score = Math.round((1 - distance / maxLength) * 100);
  return Math.max(0, Math.min(100, score));
}

function charsEqual(left, right, languageCode) {
  if (!left || !right) {
    return false;
  }

  if (isJapaneseLanguage(languageCode)) {
    return foldKatakanaToHiragana(left) === foldKatakanaToHiragana(right);
  }

  if (isEnglishLanguage(languageCode)) {
    return left.toLowerCase() === right.toLowerCase();
  }

  return left === right;
}

function isEastAsianLanguage(languageCode) {
  const code = (languageCode ?? "").toLowerCase();
  return code.startsWith("zh") || code.startsWith("yue") || code.startsWith("ja") || code.startsWith("ko");
}

// Japanese and Chinese do not delimit words with whitespace, so the naive
// regex tokenizer below cannot find real word boundaries for them. Where
// available, Intl.Segmenter's dictionary-based word segmentation gives real
// words instead, which is what lets these languages share the same
// word-level diff/highlight logic as whitespace-delimited languages.
const wordSegmenterCache = new Map();

function getWordSegmenter(languageCode) {
  if (typeof Intl === "undefined" || typeof Intl.Segmenter !== "function") {
    return null;
  }

  const cacheKey = languageCode ?? "";

  if (wordSegmenterCache.has(cacheKey)) {
    return wordSegmenterCache.get(cacheKey);
  }

  let segmenter = null;

  try {
    segmenter = new Intl.Segmenter(languageCode || undefined, { granularity: "word" });
  } catch {
    segmenter = null;
  }

  wordSegmenterCache.set(cacheKey, segmenter);
  return segmenter;
}

function tokenizeWithWordSegmenter(text, languageCode) {
  const segmenter = getWordSegmenter(languageCode);

  if (!segmenter) {
    return null;
  }

  const words = [];

  for (const { segment, isWordLike } of segmenter.segment(text)) {
    if (isWordLike) {
      words.push(segment);
    }
  }

  return words;
}

function normalizeWordForComparison(word, languageCode) {
  const original = (word ?? "").trim();
  return normalizeForComparison(original, languageCode) || original;
}

export function tokenizeByWords(value, languageCode) {
  const rawText = value ?? "";

  if (isJapaneseLanguage(languageCode) && isJapanesePhoneticsReady()) {
    // Kuromoji chunks both spellings of a phrase identically (話して and
    // はなして), which keeps the word-level diff aligned across kanji vs kana
    // and drops punctuation the same way the regex tokenizer does.
    const chunks = tokenizeJapaneseChunks(rawText);

    if (chunks && chunks.length) {
      return chunks;
    }
  }

  if (isEastAsianLanguage(languageCode)) {
    // Segment the raw text: NFKD decomposition changes the underlying code
    // points enough that the segmenter's dictionary matching silently stops
    // recognising multi-character words (e.g. verb conjugations), even
    // though the decomposed string still looks identical when rendered.
    const segmentedWords = tokenizeWithWordSegmenter(rawText, languageCode);

    if (segmentedWords && segmentedWords.length) {
      return segmentedWords;
    }
  }

  return rawText.normalize("NFKD").replace(WORD_BOUNDARY_PATTERN, " ").trim().split(/\s+/).filter(Boolean);
}

function wordsEqual(left, right, languageCode) {
  return normalizeWordForComparison(left, languageCode) === normalizeWordForComparison(right, languageCode);
}

function buildWordLcsMatrix(referenceWords, hypothesisWords, languageCode) {
  const rows = referenceWords.length + 1;
  const columns = hypothesisWords.length + 1;
  const matrix = Array.from({ length: rows }, () => new Array(columns).fill(0));

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < columns; j += 1) {
      if (wordsEqual(referenceWords[i - 1], hypothesisWords[j - 1], languageCode)) {
        matrix[i][j] = matrix[i - 1][j - 1] + 1;
      } else {
        matrix[i][j] = Math.max(matrix[i - 1][j], matrix[i][j - 1]);
      }
    }
  }

  return matrix;
}

function createWordSegment(kind, text, spokenWord, correctWord) {
  return {
    kind,
    text,
    spokenWord: spokenWord?.trim() ?? "",
    correctWord: correctWord?.trim() ?? "",
  };
}

function reconcileWordOperations(operations) {
  const reconciled = [];
  let block = [];

  const flushBlock = () => {
    if (!block.length) {
      return;
    }

    const missed = block.filter((operation) => operation.kind === "missed");
    const incorrect = block.filter((operation) => operation.kind === "incorrect");
    const pairCount = Math.min(missed.length, incorrect.length);

    for (let index = 0; index < pairCount; index += 1) {
      reconciled.push(
        createWordSegment("incorrect", incorrect[index].text, incorrect[index].text, missed[index].text),
      );
    }

    for (let index = pairCount; index < missed.length; index += 1) {
      reconciled.push(missed[index]);
    }

    for (let index = pairCount; index < incorrect.length; index += 1) {
      reconciled.push(incorrect[index]);
    }

    block = [];
  };

  for (const operation of operations) {
    if (operation.kind === "normal") {
      flushBlock();
      reconciled.push(operation);
      continue;
    }

    block.push(operation);
  }

  flushBlock();
  return reconciled;
}

export function resolveTranscriptMode(referenceText, hypothesisText, languageCode) {
  if (!isEastAsianLanguage(languageCode)) {
    return "word";
  }

  const hasWhitespace = /\s/.test(referenceText ?? "") || /\s/.test(hypothesisText ?? "");

  if (
    hasWhitespace ||
    getWordSegmenter(languageCode) ||
    (isJapaneseLanguage(languageCode) && isJapanesePhoneticsReady())
  ) {
    return "word";
  }

  return "character";
}

function buildWordOperations(referenceWords, hypothesisWords, languageCode, includeMissed) {
  const matrix = buildWordLcsMatrix(referenceWords, hypothesisWords, languageCode);
  const operations = [];
  let i = referenceWords.length;
  let j = hypothesisWords.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && wordsEqual(referenceWords[i - 1], hypothesisWords[j - 1], languageCode)) {
      operations.push({ kind: "normal", text: hypothesisWords[j - 1] });
      i -= 1;
      j -= 1;
      continue;
    }

    if (i > 0 && (j === 0 || matrix[i - 1][j] >= matrix[i][j - 1])) {
      if (includeMissed) {
        operations.push(createWordSegment("missed", referenceWords[i - 1], "", referenceWords[i - 1]));
      }
      i -= 1;
      continue;
    }

    if (j > 0) {
      operations.push(createWordSegment("incorrect", hypothesisWords[j - 1], hypothesisWords[j - 1], ""));
      j -= 1;
    }
  }

  operations.reverse();
  return reconcileWordOperations(operations);
}

function mergeWordSegments(operations) {
  const segments = [];

  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index];
    const textWithSpace = `${operation.text}${index === operations.length - 1 ? "" : " "}`;
    const previous = segments[segments.length - 1];

    if (
      previous &&
      previous.kind === operation.kind &&
      previous.spokenWord === operation.spokenWord &&
      previous.correctWord === operation.correctWord
    ) {
      previous.text += textWithSpace;
      continue;
    }

    segments.push({
      kind: operation.kind,
      text: textWithSpace,
      spokenWord: operation.spokenWord,
      correctWord: operation.correctWord,
    });
  }

  return segments;
}

function buildWordSegments(referenceText, hypothesisText, languageCode, includeMissed) {
  const referenceWords = tokenizeByWords(referenceText, languageCode);
  const hypothesisWords = tokenizeByWords(hypothesisText, languageCode);

  if (!referenceWords.length) {
    return hypothesisText ? [{ text: hypothesisText, kind: "normal" }] : [];
  }

  const operations = buildWordOperations(referenceWords, hypothesisWords, languageCode, includeMissed);
  return mergeWordSegments(operations);
}

function buildLcsMatrix(reference, hypothesis, languageCode) {
  const rows = reference.length + 1;
  const columns = hypothesis.length + 1;
  const matrix = Array.from({ length: rows }, () => new Array(columns).fill(0));

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < columns; j += 1) {
      if (charsEqual(reference[i - 1], hypothesis[j - 1], languageCode)) {
        matrix[i][j] = matrix[i - 1][j - 1] + 1;
      } else {
        matrix[i][j] = Math.max(matrix[i - 1][j], matrix[i][j - 1]);
      }
    }
  }

  return matrix;
}

function toSegmentKind(kind, character) {
  if (/\s/.test(character)) {
    return "normal";
  }

  return kind;
}

function buildAlignedOperations(reference, hypothesis, languageCode, includeMissed) {
  const matrix = buildLcsMatrix(reference, hypothesis, languageCode);
  const operations = [];
  let i = reference.length;
  let j = hypothesis.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && charsEqual(reference[i - 1], hypothesis[j - 1], languageCode)) {
      operations.push({ kind: "normal", character: hypothesis[j - 1] });
      i -= 1;
      j -= 1;
      continue;
    }

    if (i > 0 && j > 0) {
      if (matrix[i - 1][j] >= matrix[i][j - 1]) {
        if (includeMissed) {
          const character = reference[i - 1];
          operations.push({ kind: toSegmentKind("missed", character), character });
        }
        i -= 1;
      } else {
        const character = hypothesis[j - 1];
        operations.push({ kind: toSegmentKind("incorrect", character), character });
        j -= 1;
      }
      continue;
    }

    if (i > 0) {
      if (includeMissed) {
        const character = reference[i - 1];
        operations.push({ kind: toSegmentKind("missed", character), character });
      }
      i -= 1;
    } else {
      const character = hypothesis[j - 1];
      operations.push({ kind: toSegmentKind("incorrect", character), character });
      j -= 1;
    }
  }

  operations.reverse();
  return operations;
}

export function buildTranscriptSegments(referenceText, hypothesisText, languageCode, options = {}) {
  const reference = referenceText ?? "";
  const hypothesis = hypothesisText ?? "";
  const includeMissed = options.includeMissed !== false;
  const mode = options.mode ?? "character";

  if (!stripWhitespace(referenceText)) {
    return hypothesis ? [{ text: hypothesis, kind: "normal" }] : [];
  }

  if (mode === "word") {
    return buildWordSegments(reference, hypothesis, languageCode, includeMissed);
  }

  const operations = buildAlignedOperations(reference, hypothesis, languageCode, includeMissed);
  const segments = [];
  let currentText = "";
  let currentKind = "normal";

  const pushCurrent = () => {
    if (!currentText) {
      return;
    }

    segments.push({
      text: currentText,
      kind: currentKind,
    });
    currentText = "";
  };

  for (let index = 0; index < operations.length; index += 1) {
    const { character, kind } = operations[index];

    if (currentText && kind !== currentKind) {
      pushCurrent();
    }

    currentText += character;
    currentKind = kind;
  }

  pushCurrent();
  return segments;
}
