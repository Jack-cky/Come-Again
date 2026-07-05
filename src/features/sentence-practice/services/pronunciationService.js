import fetchWithTimeout from "../../../shared/fetchWithTimeout";
import { playArrayBufferOnce, stopSharedPlayback } from "../../../shared/webAudioPlayback";
import { DEFAULT_LANGUAGE, isEnglishLanguage } from "../constants/languages";

const DICTIONARY_API_BASE_URL = "https://api.dictionaryapi.dev/api/v2/entries/en";
const DICTIONARY_REQUEST_TIMEOUT_MS = 5000;
const dictionaryAudioCache = new Map();

function normalizeDictionaryAudioUrl(audioUrl) {
  if (!audioUrl) {
    return "";
  }

  return audioUrl.startsWith("//") ? `https:${audioUrl}` : audioUrl;
}

export function stopPronunciation() {
  stopSharedPlayback();

  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

function fetchDictionaryResponse(url) {
  return fetchWithTimeout(url, { timeoutMs: DICTIONARY_REQUEST_TIMEOUT_MS });
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
    const response = await fetchDictionaryResponse(
      `${DICTIONARY_API_BASE_URL}/${encodeURIComponent(normalizedWord)}`,
    );

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
  } catch {
    dictionaryAudioCache.set(normalizedWord, "");
    return "";
  }
}

async function playDictionaryAudio(audioUrl) {
  const response = await fetchDictionaryResponse(audioUrl);

  if (!response.ok) {
    throw new Error("Unable to fetch dictionary audio.");
  }

  const arrayBuffer = await response.arrayBuffer();
  await playArrayBufferOnce(arrayBuffer);
}

function speakWithSynthesis(word, languageCode) {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      reject(new Error("Speech synthesis is unavailable."));
      return;
    }

    stopSharedPlayback();
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

  if (isEnglishLanguage(languageCode)) {
    const audioUrl = await fetchEnglishDictionaryAudio(normalizedWord);

    if (audioUrl) {
      try {
        await playDictionaryAudio(audioUrl);
        return;
      } catch {
        // Fall back to browser speech synthesis below.
      }
    }
  }

  await speakWithSynthesis(normalizedWord, languageCode);
}
