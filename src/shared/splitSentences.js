// Splits text into practice-sized sentences on Latin and CJK terminators.
// Text without terminal punctuation comes back as a single part.
export default function splitSentences(text) {
  return ((text ?? "").match(/[^.!?。！？]+[.!?。！？]*/g) ?? [])
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}
