import { useEffect, useState } from "react";

// Japanese speech recognition returns kanji-mixed text while reference
// passages may be written in kana (or the other way round), so surface-form
// comparison flags correctly pronounced words as wrong. This module converts
// text to phonetic readings (hiragana) with the kuromoji morphological
// analyzer so 話して, はなして, and ハナシテ all compare equal. The dictionary
// (~5 MB gzipped) is fetched lazily from a CDN only when Japanese is selected;
// until it loads, comparison falls back to katakana→hiragana folding.
const KUROMOJI_DICT_URL = "https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/";
const PHONETIC_KEY_CACHE_LIMIT = 1000;
const KANJI_PATTERN = /[\u3400-\u9FFF\uF900-\uFAFF]/;
// Particles and auxiliary verbs attach to the preceding content word so both
// spellings of a phrase chunk identically (話し+て and はなし+て → one chunk).
const CHUNK_SUFFIX_POS = new Set(["助詞", "助動詞"]);
const SKIPPED_POS = new Set(["記号"]);

let tokenizer = null;
let tokenizerPromise = null;
const phoneticKeyCache = new Map();

export function isJapaneseLanguage(languageCode) {
  return (languageCode ?? "").toLowerCase().startsWith("ja");
}

export function foldKatakanaToHiragana(text) {
  let folded = "";

  for (const character of text ?? "") {
    const codePoint = character.codePointAt(0);
    folded += codePoint >= 0x30a1 && codePoint <= 0x30f6 ? String.fromCodePoint(codePoint - 0x60) : character;
  }

  return folded;
}

function rememberPhoneticKey(input, key) {
  if (phoneticKeyCache.size >= PHONETIC_KEY_CACHE_LIMIT) {
    phoneticKeyCache.clear();
  }

  phoneticKeyCache.set(input, key);
}

function readTokenPhonetics(token) {
  const reading = token.reading && token.reading !== "*" ? token.reading : token.surface_form;
  return foldKatakanaToHiragana(reading);
}

export function setJapaneseTokenizer(nextTokenizer) {
  tokenizer = nextTokenizer;
  phoneticKeyCache.clear();
}

export function isJapanesePhoneticsReady() {
  return tokenizer !== null;
}

export function loadJapanesePhonetics() {
  if (tokenizer) {
    return Promise.resolve(tokenizer);
  }

  if (!tokenizerPromise) {
    // The prebuilt browser bundle ships the XHR-based dictionary loader;
    // importing the package root would pull in the Node loader (fs/path).
    tokenizerPromise = import("kuromoji/build/kuromoji.js")
      .then(
        (kuromojiModule) =>
          new Promise((resolve, reject) => {
            const kuromoji = kuromojiModule.default ?? kuromojiModule;

            kuromoji.builder({ dicPath: KUROMOJI_DICT_URL }).build((error, builtTokenizer) => {
              if (error) {
                reject(error);
                return;
              }

              setJapaneseTokenizer(builtTokenizer);
              resolve(builtTokenizer);
            });
          }),
      )
      .catch((error) => {
        // Allow a later retry, e.g. the CDN was temporarily unreachable.
        tokenizerPromise = null;
        throw error;
      });
  }

  return tokenizerPromise;
}

export function toJapanesePhoneticKey(text) {
  const input = (text ?? "").normalize("NFKC");

  if (!input) {
    return "";
  }

  if (!tokenizer || !KANJI_PATTERN.test(input)) {
    return foldKatakanaToHiragana(input);
  }

  const cached = phoneticKeyCache.get(input);

  if (cached !== undefined) {
    return cached;
  }

  const key = tokenizer
    .tokenize(input)
    .map((token) => readTokenPhonetics(token))
    .join("");

  rememberPhoneticKey(input, key);
  return key;
}

// Splits text into pronunciation chunks (content word + trailing particles).
// Both kanji and kana spellings of the same phrase produce parallel chunk
// streams, which keeps the word-level diff aligned. Returns null when the
// tokenizer has not loaded yet.
export function tokenizeJapaneseChunks(text) {
  if (!tokenizer) {
    return null;
  }

  const input = (text ?? "").normalize("NFKC");

  if (!input.trim()) {
    return [];
  }

  const chunks = [];
  let currentSurface = "";
  let currentKey = "";

  const flushChunk = () => {
    if (!currentSurface) {
      return;
    }

    // Prime the phonetic-key cache so the diff's word comparisons reuse the
    // readings computed here instead of re-tokenizing every chunk.
    rememberPhoneticKey(currentSurface, currentKey);
    chunks.push(currentSurface);
    currentSurface = "";
    currentKey = "";
  };

  for (const token of tokenizer.tokenize(input)) {
    const surface = token.surface_form;

    if (!surface.trim() || SKIPPED_POS.has(token.pos)) {
      flushChunk();
      continue;
    }

    if (currentSurface && CHUNK_SUFFIX_POS.has(token.pos)) {
      currentSurface += surface;
      currentKey += readTokenPhonetics(token);
      continue;
    }

    flushChunk();
    currentSurface = surface;
    currentKey = readTokenPhonetics(token);
  }

  flushChunk();
  return chunks;
}

// Reports phonetic-matching availability for the given language and triggers
// the lazy dictionary download: "ready" (also for non-Japanese languages),
// "loading" while the dictionary downloads, or "failed" when the download
// errored — comparison then falls back to kana folding.
export function useJapanesePhonetics(languageCode) {
  const isJapanese = isJapaneseLanguage(languageCode);
  const [status, setStatus] = useState(() => (isJapanesePhoneticsReady() ? "ready" : "loading"));

  useEffect(() => {
    if (!isJapanese) {
      return undefined;
    }

    if (isJapanesePhoneticsReady()) {
      setStatus("ready");
      return undefined;
    }

    let cancelled = false;
    setStatus("loading");

    loadJapanesePhonetics()
      .then(() => {
        if (!cancelled) {
          setStatus("ready");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("failed");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isJapanese]);

  return isJapanese ? status : "ready";
}
