import { DEFAULT_LANGUAGE } from "../constants/languages";

const ENGLISH_PREFIX = "en";
const DICTIONARY_API_BASE_URL =
  import.meta.env.VITE_DICTIONARY_API_BASE_URL ?? "https://api.dictionaryapi.dev/api/v2/entries/en";
const DICTIONARY_REQUEST_TIMEOUT_MS = 5000;
const dictionaryAudioCache = new Map();
let activeDictionaryAudio = null;

function normalizeDictionaryAudioUrl(audioUrl) {
  if (!audioUrl) {
    return "";
  }

  return audioUrl.startsWith("//") ? `https:${audioUrl}` : audioUrl;
}

function stopDictionaryAudio() {
  if (!activeDictionaryAudio) {
    return;
  }

  activeDictionaryAudio.pause();
  activeDictionaryAudio.currentTime = 0;
  activeDictionaryAudio = null;
}

export function stopPronunciation() {
  stopDictionaryAudio();

  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), DICTIONARY_REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function fetchEnglishDictionaryAudio(word) {
  const normalizedWord = word.trim().toLowerCase();

  if (!normalizedWord) {
    return "";
  }

  if (dictionaryAudioCache.has(normalizedWord)) {
    return dictionaryAudioCache.get(normalizedWord);
  }

  try {
    const response = await fetchWithTimeout(`${DICTIONARY_API_BASE_URL}/${encodeURIComponent(normalizedWord)}`);

    if (!response.ok) {
      dictionaryAudioCache.set(normalizedWord, "");
      return "";
    }

    const entries = await response.json();
    const phonetics = entries.flatMap((entry) => entry.phonetics ?? []);
    const preferredAudio = phonetics.find((phonetic) => phonetic.audio?.includes("_gb"));
    const fallbackAudio = phonetics.find((phonetic) => phonetic.audio);
    const audioUrl = normalizeDictionaryAudioUrl(preferredAudio?.audio ?? fallbackAudio?.audio ?? "");
    dictionaryAudioCache.set(normalizedWord, audioUrl);
    return audioUrl;
  } catch (error) {
    dictionaryAudioCache.set(normalizedWord, "");
    return "";
  }
}

function playDictionaryAudio(audioUrl) {
  return new Promise((resolve, reject) => {
    stopDictionaryAudio();

    const audio = new Audio(audioUrl);
    activeDictionaryAudio = audio;

    audio.onended = () => {
      if (activeDictionaryAudio === audio) {
        activeDictionaryAudio = null;
      }
      resolve();
    };

    audio.onerror = () => {
      if (activeDictionaryAudio === audio) {
        activeDictionaryAudio = null;
      }
      reject(new Error("Unable to play dictionary audio."));
    };

    audio.play().catch(reject);
  });
}

function speakWithSynthesis(word, languageCode) {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      reject(new Error("Speech synthesis is unavailable."));
      return;
    }

    stopDictionaryAudio();
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = languageCode || DEFAULT_LANGUAGE;
    utterance.onend = () => resolve();
    utterance.onerror = () => reject(new Error("Unable to speak word."));

    window.speechSynthesis.speak(utterance);
  });
}

export async function speakCorrectWord(word, languageCode) {
  const normalizedWord = word?.trim();

  if (!normalizedWord) {
    return;
  }

  if ((languageCode ?? "").startsWith(ENGLISH_PREFIX)) {
    const audioUrl = await fetchEnglishDictionaryAudio(normalizedWord);

    if (audioUrl) {
      try {
        await playDictionaryAudio(audioUrl);
        return;
      } catch (error) {
        // Fall back to browser speech synthesis below.
      }
    }
  }

  await speakWithSynthesis(normalizedWord, languageCode);
}
