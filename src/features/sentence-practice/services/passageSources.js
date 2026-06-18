const WIKIPEDIA_HOME_URL = "https://en.wikipedia.org/";
const ADVICE_SLIP_HOME_URL = "https://api.adviceslip.com/";
const WIKIPEDIA_RANDOM_SUMMARY_URL =
  import.meta.env.VITE_WIKIPEDIA_RANDOM_SUMMARY_URL ?? "https://en.wikipedia.org/api/rest_v1/page/random/summary";
const ADVICE_SLIP_URL = import.meta.env.VITE_ADVICE_SLIP_URL ?? "https://api.adviceslip.com/advice";
const REQUEST_TIMEOUT_MS = 8000;
const PASSAGE_FETCH_RETRY_COUNT = 1;
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

function normalizeReferenceText(text) {
  return text.replace(/\s+/g, " ").trim();
}

function getRandomFallbackPassage() {
  const index = Math.floor(Math.random() * FALLBACK_PRACTICE_PASSAGES.length);
  return FALLBACK_PRACTICE_PASSAGES[index];
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

async function fetchResponseWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function buildFallbackPassage(provider, sourceUrl) {
  const fallback = getRandomFallbackPassage();
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
  } catch (error) {
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
  } catch (error) {
    return buildFallbackPassage("Advice Slip", ADVICE_SLIP_HOME_URL);
  }
}
