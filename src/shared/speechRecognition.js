export const NON_BLOCKING_RECOGNITION_ERRORS = new Set(["no-speech", "aborted"]);
export const FATAL_RECOGNITION_ERRORS = new Set([
  "audio-capture",
  "not-allowed",
  "service-not-allowed",
  "language-not-supported",
]);

export function formatTime(seconds) {
  const minutes = String(Math.floor(seconds / 60)).padStart(2, "0");
  const secondsRemainder = String(seconds % 60).padStart(2, "0");
  return `${minutes}:${secondsRemainder}`;
}

export function getSpeechRecognitionClass() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}
