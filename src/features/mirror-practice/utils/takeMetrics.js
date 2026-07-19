import { tokenizeByWords } from "../../sentence-practice/utils/textAnalysis";
import { countFillers } from "./fillerWords";

// The hook samples the live microphone on this interval; every duration-based
// metric below (pace, pauses, vocal variety) is derived from these frames.
export const AUDIO_FRAME_INTERVAL_MS = 100;

// Gaze samples arrive from the canvas render loop on this interval — sparse
// enough that FaceLandmarker never competes with the 30fps compositing.
export const GAZE_SAMPLE_INTERVAL_MS = 100;
// A sample further than this from the take's median gaze point counts as
// looking away. Shared by the post-take score and the live nudge so the two
// always agree. ponytail: calibration knob, tune together with
// EYE_RANGE_DEGREES in gazeTracker.js against real takes.
export const GAZE_STEADY_RADIUS_DEGREES = 7;
const MIN_GAZE_SAMPLES = 20;

const MIN_PITCH_HZ = 60;
const MAX_PITCH_HZ = 400;
// Autocorrelation peaks below this fraction of the zero-lag energy are too
// ambiguous to trust as a fundamental frequency, so the frame counts as
// unvoiced rather than polluting the vocal-variety spread.
const PITCH_CLARITY_THRESHOLD = 0.5;
const SILENT_FRAME_RMS = 0.012;
const LONG_PAUSE_SECONDS = 2;
const LONG_PAUSE_FRAMES = Math.round((LONG_PAUSE_SECONDS * 1000) / AUDIO_FRAME_INTERVAL_MS);
const MIN_VOICED_FRAMES = 15;
const PITCH_REFERENCE_HZ = 110;
const OCTAVE_SEMITONES = 12;

const PACE_PROFILES = [
  { prefixes: ["ja"], unit: "chars/min", goodMin: 200, goodMax: 350, warnMin: 150, warnMax: 400 },
  { prefixes: ["zh", "yue"], unit: "chars/min", goodMin: 150, goodMax: 270, warnMin: 110, warnMax: 320 },
  { prefixes: ["ko"], unit: "wpm", goodMin: 80, goodMax: 140, warnMin: 65, warnMax: 160 },
];
const DEFAULT_PACE_PROFILE = { prefixes: [], unit: "wpm", goodMin: 110, goodMax: 170, warnMin: 90, warnMax: 200 };

function getPaceProfile(languageCode) {
  const code = (languageCode ?? "").toLowerCase();
  return (
    PACE_PROFILES.find((profile) => profile.prefixes.some((prefix) => code.startsWith(prefix))) ??
    DEFAULT_PACE_PROFILE
  );
}

function countPaceUnits(text, languageCode, profile) {
  if (profile.unit === "chars/min") {
    return (text.match(/[\p{L}\p{N}]/gu) ?? []).length;
  }

  return tokenizeByWords(text, languageCode).length;
}

// Reused across calls: measureAudioFrame runs ~10×/s during recording and a
// fresh per-call array would generate ~60KB/s of short-lived garbage on the
// main thread that also composites the recording. Every lag in the scanned
// window is overwritten each call, so no clearing is needed.
let correlationScratch = new Float64Array(0);

// One pass of time-domain analysis per sampled frame: RMS loudness plus an
// autocorrelation pitch estimate. Called from the recording hook on the live
// stream, so it must stay cheap enough to run every AUDIO_FRAME_INTERVAL_MS.
export function measureAudioFrame(samples, sampleRate) {
  let energy = 0;

  for (let i = 0; i < samples.length; i += 1) {
    energy += samples[i] * samples[i];
  }

  const rms = Math.sqrt(energy / samples.length);

  if (rms < SILENT_FRAME_RMS) {
    return { rms, pitchHz: 0 };
  }

  const minLag = Math.floor(sampleRate / MAX_PITCH_HZ);
  const maxLag = Math.min(Math.floor(sampleRate / MIN_PITCH_HZ), samples.length - 1);

  if (correlationScratch.length < maxLag + 1) {
    correlationScratch = new Float64Array(maxLag + 1);
  }

  const correlations = correlationScratch;
  let bestLag = 0;
  let bestCorrelation = 0;

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let correlation = 0;

    for (let i = 0; i + lag < samples.length; i += 1) {
      correlation += samples[i] * samples[i + lag];
    }

    correlation /= samples.length - lag;
    correlations[lag] = correlation;

    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestLag = lag;
    }
  }

  const zeroLag = energy / samples.length;

  if (!bestLag || !zeroLag || bestCorrelation / zeroLag < PITCH_CLARITY_THRESHOLD) {
    return { rms, pitchHz: 0 };
  }

  // The autocorrelation of a periodic signal peaks at every multiple of the
  // true period, and the global maximum can land on a multiple, halving or
  // thirding the reported pitch. Prefer the smallest lag whose peak is nearly
  // as strong, then climb to its local maximum.
  let chosenLag = bestLag;

  for (let lag = minLag; lag < bestLag; lag += 1) {
    if (correlations[lag] >= bestCorrelation * 0.9) {
      while (lag + 1 <= maxLag && correlations[lag + 1] > correlations[lag]) {
        lag += 1;
      }

      chosenLag = lag;
      break;
    }
  }

  return { rms, pitchHz: sampleRate / chosenLag };
}

function percentile(sortedValues, fraction) {
  if (!sortedValues.length) {
    return 0;
  }

  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.round(fraction * (sortedValues.length - 1))));
  return sortedValues[index];
}

// The speech/silence threshold adapts to the take: it sits at a fraction of
// the loud-end (p85) level because mic gain varies wildly between setups and
// a fixed threshold alone would misclassify quiet speakers. The absolute
// floor guards takes that are mostly silence, where p85 is itself noise.
function analyzeSpeechActivity(audioFrames) {
  if (!audioFrames.length) {
    return null;
  }

  const sortedRms = audioFrames.map((frame) => frame.rms).sort((a, b) => a - b);
  const speechLevel = percentile(sortedRms, 0.85);
  const threshold = Math.max(0.006, speechLevel * 0.18);
  const isSpeech = audioFrames.map((frame) => frame.rms >= threshold);
  const firstSpeech = isSpeech.indexOf(true);
  const lastSpeech = isSpeech.lastIndexOf(true);

  if (firstSpeech === -1) {
    return null;
  }

  const frameSeconds = AUDIO_FRAME_INTERVAL_MS / 1000;
  let pauseCount = 0;
  let longestPauseFrames = 0;
  let longPauseFrames = 0;
  let silenceRun = 0;

  for (let i = firstSpeech; i <= lastSpeech; i += 1) {
    if (!isSpeech[i]) {
      silenceRun += 1;
      continue;
    }

    if (silenceRun >= LONG_PAUSE_FRAMES) {
      pauseCount += 1;
      longPauseFrames += silenceRun;
    }

    longestPauseFrames = Math.max(longestPauseFrames, silenceRun);
    silenceRun = 0;
  }

  return {
    threshold,
    pauseCount,
    longestPauseSeconds: Math.round(longestPauseFrames * frameSeconds * 10) / 10,
    activeSeconds: (lastSpeech - firstSpeech + 1) * frameSeconds,
    longPauseSeconds: longPauseFrames * frameSeconds,
  };
}

function computePitchVarietySemitones(audioFrames, speechThreshold) {
  const voicedSemitones = audioFrames
    .filter(
      (frame) =>
        frame.rms >= speechThreshold && frame.pitchHz >= MIN_PITCH_HZ && frame.pitchHz <= MAX_PITCH_HZ,
    )
    .map((frame) => OCTAVE_SEMITONES * Math.log2(frame.pitchHz / PITCH_REFERENCE_HZ));

  if (voicedSemitones.length < MIN_VOICED_FRAMES) {
    return null;
  }

  // Drop frames an octave or more from the median: autocorrelation
  // occasionally locks onto a harmonic, and octave errors land exactly
  // ±12 semitones out, so the bound must be strict to exclude them.
  const sorted = [...voicedSemitones].sort((a, b) => a - b);
  const median = percentile(sorted, 0.5);
  const usable = voicedSemitones.filter((semitone) => Math.abs(semitone - median) < OCTAVE_SEMITONES);

  if (usable.length < MIN_VOICED_FRAMES) {
    return null;
  }

  const mean = usable.reduce((sum, semitone) => sum + semitone, 0) / usable.length;
  const variance = usable.reduce((sum, semitone) => sum + (semitone - mean) ** 2, 0) / usable.length;

  return Math.round(Math.sqrt(variance) * 10) / 10;
}

// Median gaze point of the take so far, or null while there are too few
// samples to trust one. The median (not the mean) keeps a brief glance away
// from dragging the anchor point with it.
export function computeGazeMedian(gazeSamples) {
  if (!gazeSamples || gazeSamples.length < MIN_GAZE_SAMPLES) {
    return null;
  }

  const sortedX = gazeSamples.map((sample) => sample.x).sort((a, b) => a - b);
  const sortedY = gazeSamples.map((sample) => sample.y).sort((a, b) => a - b);

  return { x: percentile(sortedX, 0.5), y: percentile(sortedY, 0.5) };
}

export function isGazeOffPoint(sample, medianPoint) {
  return Math.hypot(sample.x - medianPoint.x, sample.y - medianPoint.y) > GAZE_STEADY_RADIUS_DEGREES;
}

function computeGazeSteadiness(gazeSamples) {
  const medianPoint = computeGazeMedian(gazeSamples);

  if (!medianPoint) {
    return null;
  }

  const steadyCount = gazeSamples.filter((sample) => !isGazeOffPoint(sample, medianPoint)).length;

  return Math.round((steadyCount / gazeSamples.length) * 100);
}

export function computeTakeMetrics({
  transcriptEntries,
  languageCode,
  audioFrames,
  gazeSamples,
  fallbackDurationSeconds,
}) {
  const spokenText = (transcriptEntries ?? [])
    .map((entry) => entry.text)
    .join(" ")
    .trim();

  if (!spokenText) {
    return null;
  }

  const profile = getPaceProfile(languageCode);
  const unitCount = countPaceUnits(spokenText, languageCode, profile);

  if (!unitCount) {
    return null;
  }

  const activity = analyzeSpeechActivity(audioFrames ?? []);
  const durationSeconds = Math.max(activity?.activeSeconds ?? fallbackDurationSeconds ?? 0, 1);
  // Pace is measured over speaking time: long pauses are reported as their
  // own metric, so leaving them in the divisor would penalise the same
  // silence twice and misgrade a pausing problem as a pace problem.
  const paceSeconds = Math.max(durationSeconds - (activity?.longPauseSeconds ?? 0), 1);
  const confidences = (transcriptEntries ?? [])
    .map((entry) => entry.confidence)
    .filter((confidence) => typeof confidence === "number" && confidence > 0);
  const clarityPercent = confidences.length
    ? Math.round((confidences.reduce((sum, confidence) => sum + confidence, 0) / confidences.length) * 100)
    : null;

  return {
    recordedAt: new Date().toISOString(),
    languageCode,
    durationSeconds: Math.round(durationSeconds),
    paceValue: Math.round((unitCount * 60) / paceSeconds),
    paceUnit: profile.unit,
    pauseCount: activity ? activity.pauseCount : null,
    longestPauseSeconds: activity ? activity.longestPauseSeconds : null,
    clarityPercent,
    pitchVarietySemitones: activity ? computePitchVarietySemitones(audioFrames, activity.threshold) : null,
    gazeSteadinessPercent: computeGazeSteadiness(gazeSamples ?? []),
    fillerWordCount: countFillers(spokenText, languageCode),
  };
}

export function describePace(summary) {
  const profile = getPaceProfile(summary.languageCode);
  const { paceValue, paceUnit } = summary;
  const inGoodBand = paceValue >= profile.goodMin && paceValue <= profile.goodMax;
  const inWarnBand = paceValue >= profile.warnMin && paceValue <= profile.warnMax;
  const tone = inGoodBand ? "good" : inWarnBand ? "warn" : "risk";
  const target = `${profile.goodMin}–${profile.goodMax} ${paceUnit}`;

  if (inGoodBand) {
    return { tone, caption: `Right in the ${target} sweet spot for a listenable delivery.` };
  }

  if (paceValue < profile.goodMin) {
    return {
      tone,
      caption: `${inWarnBand ? "A touch slow" : "Quite slow"}. Aim for ${target}.`,
    };
  }

  return {
    tone,
    caption: `${inWarnBand ? "A touch fast" : "Quite fast"}. Aim for ${target}.`,
  };
}

export function describePauses(summary) {
  if (summary.pauseCount == null) {
    return { tone: "neutral", value: "—", caption: "Pause timing was unavailable for this take." };
  }

  if (summary.pauseCount === 0) {
    return {
      tone: "good",
      value: "0",
      caption: `No pauses over ${LONG_PAUSE_SECONDS}s. You kept your momentum.`,
    };
  }

  const pausesPerMinute = summary.pauseCount / Math.max(summary.durationSeconds / 60, 1 / 60);
  const tone = pausesPerMinute <= 1.5 ? "good" : pausesPerMinute <= 3 ? "warn" : "risk";

  return {
    tone,
    value: String(summary.pauseCount),
    caption: `Over ${LONG_PAUSE_SECONDS}s each, the longest ${summary.longestPauseSeconds}s. Keep momentum through transitions.`,
  };
}

export function describeClarity(summary) {
  if (summary.clarityPercent == null) {
    return { tone: "neutral", value: "—", caption: "Recognition confidence was unavailable for this take." };
  }

  const tone = summary.clarityPercent >= 80 ? "good" : summary.clarityPercent >= 60 ? "warn" : "risk";

  return {
    tone,
    value: `${summary.clarityPercent}%`,
    caption: "How confidently speech recognition understood you. Higher means clearer enunciation.",
  };
}

export function describePitchVariety(summary) {
  const semitones = summary.pitchVarietySemitones;

  if (semitones == null) {
    return { tone: "neutral", value: "—", caption: "Not enough voiced audio to measure pitch variety." };
  }

  const tone = semitones >= 2 ? "good" : semitones >= 1.2 ? "warn" : "risk";
  const value = tone === "good" ? "Varied" : tone === "warn" ? "Somewhat flat" : "Monotone";

  return {
    tone,
    value,
    caption: `Pitch spread of ${semitones} semitones across the take. Variation keeps listeners engaged.`,
  };
}

export function describeGazeSteadiness(summary) {
  const percent = summary.gazeSteadinessPercent;

  if (percent == null) {
    return { tone: "neutral", value: "—", caption: "Eye contact was not measured for this take." };
  }

  const tone = percent >= 80 ? "good" : percent >= 60 ? "warn" : "risk";

  return {
    tone,
    value: `${percent}%`,
    caption: `You held one focal point for ${percent}% of the take. Steady eye contact reads as confidence.`,
  };
}

export function describeFillers(summary) {
  const count = summary.fillerWordCount;

  if (count == null) {
    return { tone: "neutral", value: "—", caption: "Filler-word spotting is not available for this language yet." };
  }

  if (count === 0) {
    return { tone: "good", value: "0", caption: "No filler words caught. Clean, purposeful wording." };
  }

  const perMinute = count / Math.max(summary.durationSeconds / 60, 1 / 60);
  const tone = perMinute <= 2 ? "good" : perMinute <= 5 ? "warn" : "risk";

  return {
    tone,
    value: String(count),
    caption:
      "Filler words and phrases caught by recognition. Open the transcript review to see them highlighted.",
  };
}

export function buildCoachHint(summary) {
  const pace = describePace(summary);

  if (pace.tone !== "good") {
    return `Work on pace next take: ${pace.caption}`;
  }

  const pauses = describePauses(summary);

  if (pauses.tone === "warn" || pauses.tone === "risk") {
    return `Tighten the gaps next take: ${summary.pauseCount} ${summary.pauseCount === 1 ? "pause" : "pauses"} ran over ${LONG_PAUSE_SECONDS}s. Glance ahead in your passage so transitions stay smooth.`;
  }

  const clarity = describeClarity(summary);

  if (clarity.tone === "warn" || clarity.tone === "risk") {
    return "Focus on clarity next take: finish word endings and keep a steady distance from the microphone.";
  }

  const gaze = describeGazeSteadiness(summary);

  if (gaze.tone === "warn" || gaze.tone === "risk") {
    return "Anchor your eyes next take: pick one point at camera height and keep returning to it. Wandering eyes read as nerves.";
  }

  const fillers = describeFillers(summary);

  if (fillers.tone === "warn" || fillers.tone === "risk") {
    return `Trim the fillers next take: ${summary.fillerWordCount} caught. Pause silently instead of bridging with "um" or "you know".`;
  }

  const variety = describePitchVariety(summary);

  if (variety.tone === "warn" || variety.tone === "risk") {
    return "Add vocal variety next take: lift key words and let your pitch move. Flat delivery loses listeners.";
  }

  return "Strong take: pace, momentum, clarity, and tone are all on track. Record another to keep the trend moving.";
}
