const ENGLISH_PREFIX = "en";
const UNICODE_WORD_CHARACTER_CLASS =
  "\\p{L}\\p{N}\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}";
const FALLBACK_WORD_CHARACTER_CLASS = "A-Za-z0-9\\u00C0-\\u024F\\u0300-\\u036F\\u3040-\\u30FF\\u3400-\\u9FFF\\uAC00-\\uD7AF";

function buildSafeRegExp(unicodePattern, fallbackPattern) {
  try {
    return new RegExp(unicodePattern, "gu");
  } catch (error) {
    return new RegExp(fallbackPattern, "g");
  }
}

const WORD_BOUNDARY_PATTERN = buildSafeRegExp(
  `[^${UNICODE_WORD_CHARACTER_CLASS}'’]+`,
  `[^${FALLBACK_WORD_CHARACTER_CLASS}'’]+`
);
const COMPARISON_CHARACTER_PATTERN = buildSafeRegExp(
  `[^${UNICODE_WORD_CHARACTER_CLASS}]`,
  `[^${FALLBACK_WORD_CHARACTER_CLASS}]`
);

function stripWhitespace(value) {
  return (value ?? "").replace(/\s+/g, "").trim();
}

function normalizeForComparison(value, languageCode) {
  const normalized = (value ?? "").normalize("NFKD").replace(COMPARISON_CHARACTER_PATTERN, "");

  if ((languageCode ?? "").startsWith(ENGLISH_PREFIX)) {
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
        previousRow[j - 1] + substitutionCost
      );
    }

    previousRow = currentRow;
  }

  return previousRow[right.length];
}

export function computeAccuracy(referenceText, hypothesisText) {
  const reference = normalizeForComparison(referenceText, ENGLISH_PREFIX);
  const hypothesis = normalizeForComparison(hypothesisText, ENGLISH_PREFIX);

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

  if ((languageCode ?? "").startsWith(ENGLISH_PREFIX)) {
    return left.toLowerCase() === right.toLowerCase();
  }

  return left === right;
}

function isEastAsianLanguage(languageCode) {
  const code = (languageCode ?? "").toLowerCase();
  return (
    code.startsWith("zh") ||
    code.startsWith("yue") ||
    code.startsWith("ja") ||
    code.startsWith("ko")
  );
}

function normalizeWordForComparison(word, languageCode) {
  const original = (word ?? "").trim();
  return normalizeForComparison(original, languageCode) || original;
}

function tokenizeByWords(value) {
  return (value ?? "")
    .normalize("NFKD")
    .replace(WORD_BOUNDARY_PATTERN, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
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
        createWordSegment("incorrect", incorrect[index].text, incorrect[index].text, missed[index].text)
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
  const hasWhitespace = /\s/.test(referenceText ?? "") || /\s/.test(hypothesisText ?? "");

  if (hasWhitespace || !isEastAsianLanguage(languageCode)) {
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
  const referenceWords = tokenizeByWords(referenceText);
  const hypothesisWords = tokenizeByWords(hypothesisText);

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
    const hasAnyWhitespace = /\s/.test(reference) || /\s/.test(hypothesis);

    if (hasAnyWhitespace || !isEastAsianLanguage(languageCode)) {
      return buildWordSegments(reference, hypothesis, languageCode, includeMissed);
    }
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
