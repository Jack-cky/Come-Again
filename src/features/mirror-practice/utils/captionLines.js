// Roll-up caption helpers: text accumulates into greedily wrapped lines and
// only the last MAX_CAPTION_LINES are shown, so words fill left to right and
// finished lines scroll away like YouTube live captions. Greedy wrapping from
// a stable starting point never moves words that are already on screen.

export const DEFAULT_CAPTION_LINE_UNITS = 48;
export const MAX_CAPTION_LINES = 2;

// Fullwidth (CJK) characters take roughly twice the horizontal space of Latin
// characters, so they count as two units against the per-line budget.
function isFullWidthCharacter(codePoint) {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6)
  );
}

function measureTextUnits(text) {
  let units = 0;

  for (const character of text) {
    units += isFullWidthCharacter(character.codePointAt(0)) ? 2 : 1;
  }

  return units;
}

function splitLongToken(text, maxUnits) {
  const pieces = [];
  let piece = "";
  let pieceUnits = 0;

  for (const character of text) {
    const characterUnits = isFullWidthCharacter(character.codePointAt(0)) ? 2 : 1;

    if (piece && pieceUnits + characterUnits > maxUnits) {
      pieces.push(piece);
      piece = "";
      pieceUnits = 0;
    }

    piece += character;
    pieceUnits += characterUnits;
  }

  if (piece) {
    pieces.push(piece);
  }

  return pieces;
}

// CJK text has no spaces, so each fullwidth character becomes its own token
// that joins the previous one without a space ("glue"). Latin words keep
// normal space-separated wrapping.
function tokenizeForCaption(segmentText) {
  const tokens = [];

  for (const word of segmentText.split(" ")) {
    if (!word) {
      continue;
    }

    let pushedInWord = false;
    let pendingText = "";

    const flushPending = () => {
      if (pendingText) {
        tokens.push({ text: pendingText, glue: pushedInWord });
        pushedInWord = true;
        pendingText = "";
      }
    };

    for (const character of word) {
      if (isFullWidthCharacter(character.codePointAt(0))) {
        flushPending();
        tokens.push({ text: character, glue: pushedInWord });
        pushedInWord = true;
      } else {
        pendingText += character;
      }
    }

    flushPending();
  }

  return tokens;
}

export function wrapCaptionSegment(segmentText, maxUnits = DEFAULT_CAPTION_LINE_UNITS) {
  const tokens = [];

  for (const token of tokenizeForCaption(segmentText)) {
    if (measureTextUnits(token.text) > maxUnits) {
      splitLongToken(token.text, maxUnits).forEach((piece, pieceIndex) => {
        tokens.push({ text: piece, glue: pieceIndex > 0 ? true : token.glue });
      });
    } else {
      tokens.push(token);
    }
  }

  const lines = [];
  let line = "";

  for (const token of tokens) {
    const candidate = line ? `${line}${token.glue ? "" : " "}${token.text}` : token.text;

    if (line && measureTextUnits(candidate) > maxUnits) {
      lines.push(line);
      line = token.text;
    } else {
      line = candidate;
    }
  }

  if (line) {
    lines.push(line);
  }

  return lines;
}

// captionText may contain "\n" for line breaks that are already committed;
// each such segment wraps independently so committed lines never re-flow.
export function buildCaptionLines(
  captionText,
  maxLines = MAX_CAPTION_LINES,
  maxUnits = DEFAULT_CAPTION_LINE_UNITS,
) {
  const lines = [];

  for (const segment of (captionText ?? "").split("\n")) {
    const normalized = segment.replace(/\s+/g, " ").trim();

    if (normalized) {
      lines.push(...wrapCaptionSegment(normalized, maxUnits));
    }
  }

  return lines.slice(-maxLines);
}

export function appendCaptionText(baseText, additionText) {
  const addition = (additionText ?? "").replace(/\s+/g, " ").trim();

  if (!addition) {
    return baseText ?? "";
  }

  const base = baseText ?? "";

  if (!base) {
    return addition;
  }

  const lastCharacter = base[base.length - 1];
  const firstCharacter = addition[0];
  const needsSpace =
    !isFullWidthCharacter(lastCharacter.codePointAt(0)) &&
    !isFullWidthCharacter(firstCharacter.codePointAt(0));

  return `${base}${needsSpace ? " " : ""}${addition}`;
}
