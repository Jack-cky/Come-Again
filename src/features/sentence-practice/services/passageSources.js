import fetchWithTimeout from "../../../shared/fetchWithTimeout";

const WIKIPEDIA_HOME_URL = "https://en.wikipedia.org/";
const ADVICE_SLIP_HOME_URL = "https://api.adviceslip.com/";
const TATOEBA_HOME_URL = "https://tatoeba.org/en/sentences_lists/search?lang=jpn";
const WIKIPEDIA_RANDOM_SUMMARY_URL = "https://en.wikipedia.org/api/rest_v1/page/random/summary";
const ADVICE_SLIP_URL = "https://api.adviceslip.com/advice";
const TATOEBA_URL = "https://api.tatoeba.org/unstable/sentences?lang=jpn&sort=random&limit=5";
const REQUEST_TIMEOUT_MS = 8000;
const PASSAGE_FETCH_RETRY_COUNT = 1;
const TATOEBA_MIN_LENGTH = 6;
const FALLBACK_PRACTICE_PASSAGES = [
  {
    title: "Built-in practice passage",
    passage:
      "Clear communication improves with steady pacing, careful listening, and frequent practice. Read this passage aloud and focus on finishing each sentence cleanly.",
  },
  {
    title: "Offline speaking drill",
    passage:
      "Confidence grows when you slow down, pronounce each word fully, and pause at natural breaks. Short daily speaking drills often improve clarity more than occasional long sessions.",
  },
  {
    title: "Pronunciation warm-up",
    passage:
      "Strong pronunciation comes from repetition, rhythm, and attention to difficult sounds. Speak this paragraph twice and notice which words require extra control.",
  },
];
const FALLBACK_JAPANESE_PASSAGES = [
  {
    title: "Built-in practice passage",
    passage: "毎日少しずつ練習すれば、発音は必ず上手になります。",
  },
  {
    title: "Offline speaking drill",
    passage: "ゆっくり話して、一つ一つの音をはっきり発音しましょう。",
  },
  {
    title: "Pronunciation warm-up",
    passage: "この文章を声に出して読んで、リズムに注意してください。",
  },
];

function normalizeReferenceText(text) {
  return text.replace(/\s+/g, " ").trim();
}

function getRandomFallbackPassage(passages = FALLBACK_PRACTICE_PASSAGES) {
  const index = Math.floor(Math.random() * passages.length);
  return passages[index];
}

async function retryPassageRequest(loadPassage) {
  let lastError;

  for (let attempt = 0; attempt <= PASSAGE_FETCH_RETRY_COUNT; attempt += 1) {
    try {
      return await loadPassage();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

function fetchResponseWithTimeout(url, options = {}) {
  return fetchWithTimeout(url, { ...options, timeoutMs: REQUEST_TIMEOUT_MS });
}

function buildFallbackPassage(provider, sourceUrl, passages = FALLBACK_PRACTICE_PASSAGES) {
  const fallback = getRandomFallbackPassage(passages);
  return {
    provider: `${provider} fallback`,
    passage: fallback.passage,
    title: fallback.title,
    url: sourceUrl,
    notice: `${provider} is unavailable right now, so a built-in practice passage was loaded instead.`,
  };
}

export async function fetchWikipediaPassage() {
  try {
    return await retryPassageRequest(async () => {
      const response = await fetchResponseWithTimeout(WIKIPEDIA_RANDOM_SUMMARY_URL);

      if (!response.ok) {
        throw new Error(`Wikipedia request failed with ${response.status}.`);
      }

      const payload = await response.json();
      const passage = normalizeReferenceText(payload.extract ?? "");

      if (!passage) {
        throw new Error("Wikipedia returned an empty summary.");
      }

      return {
        provider: "Wikipedia",
        passage,
        title: payload.title ?? "Wikipedia",
        url: payload.content_urls?.desktop?.page ?? WIKIPEDIA_HOME_URL,
      };
    });
  } catch {
    return buildFallbackPassage("Wikipedia", WIKIPEDIA_HOME_URL);
  }
}

export async function fetchAdviceSlipPassage() {
  try {
    return await retryPassageRequest(async () => {
      const response = await fetchResponseWithTimeout(ADVICE_SLIP_URL, {
        cache: "no-store",
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Advice Slip request failed with ${response.status}.`);
      }

      const payload = await response.json();
      const passage = normalizeReferenceText(payload.slip?.advice ?? "");

      if (!passage) {
        throw new Error("Advice Slip returned an empty passage.");
      }

      return {
        provider: "Advice Slip",
        passage,
        title: `Advice Slip #${payload.slip?.id ?? ""}`.trim(),
        url: ADVICE_SLIP_HOME_URL,
      };
    });
  } catch {
    return buildFallbackPassage("Advice Slip", ADVICE_SLIP_HOME_URL);
  }
}

export async function fetchTatoebaPassage() {
  try {
    return await retryPassageRequest(async () => {
      const response = await fetchResponseWithTimeout(TATOEBA_URL);

      if (!response.ok) {
        throw new Error(`Tatoeba request failed with ${response.status}.`);
      }

      const payload = await response.json();
      const candidates = Array.isArray(payload.data) ? payload.data : [];
      const sentence = candidates.find(
        (entry) => normalizeReferenceText(entry.text ?? "").length >= TATOEBA_MIN_LENGTH,
      );

      if (!sentence) {
        throw new Error("Tatoeba returned no usable sentence.");
      }

      return {
        provider: "Tatoeba",
        passage: normalizeReferenceText(sentence.text),
        title: `Tatoeba sentence #${sentence.id}`,
        url: `https://tatoeba.org/en/sentences/show/${sentence.id}`,
      };
    });
  } catch {
    return buildFallbackPassage("Tatoeba", TATOEBA_HOME_URL, FALLBACK_JAPANESE_PASSAGES);
  }
}
