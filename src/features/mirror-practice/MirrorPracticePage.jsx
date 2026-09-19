import { useEffect, useMemo, useRef, useState } from "react";
import { getPreferredLanguage, LANGUAGE_OPTIONS } from "../sentence-practice/constants/languages";
import MetricCard from "../sentence-practice/components/MetricCard";
import { formatTime } from "../../shared/speechRecognition";
import useMirrorPractice from "./hooks/useMirrorPractice";
import {
  buildCoachHint,
  describeClarity,
  describeFillers,
  describeGazeSteadiness,
  describePace,
  describePauses,
  describePitchVariety,
} from "./utils/takeMetrics";
import { segmentFillers } from "./utils/fillerWords";
import CorrectionMark from "./components/CorrectionMark";
import {
  attachAiSummaryToTake,
  clearTakeHistory,
  findLatestTakeForLanguage,
  loadTakeHistory,
} from "./utils/takeHistory";
import { storePracticeHandoff } from "../../shared/practiceHandoff";
import splitSentences from "../../shared/splitSentences";
import {
  annotateTranscriptEntries,
  fetchTranscriptSuggestions,
  isTranscriptCoachAvailable,
} from "./services/transcriptCoach";

const IDLE_AI_SUGGESTION = { status: "idle", data: null, message: "" };
const MAX_TREND_ROWS = 10;

function formatTakeDate(isoString) {
  const date = new Date(isoString);

  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

// One trends-table cell: the value plus an arrow against the previous take.
// Pace has no arrow (it is a banded metric where neither direction is
// inherently better), so it renders as a plain cell instead.
function TrendCell({ value, previous, unit = "", higherIsBetter }) {
  if (value == null) {
    return <td>—</td>;
  }

  let arrow = null;

  if (previous != null && value !== previous) {
    const improved = higherIsBetter ? value > previous : value < previous;

    arrow = (
      <span
        className={`trend-arrow ${improved ? "is-better" : "is-worse"}`}
        aria-label={improved ? "improved" : "worse"}
      >
        {value > previous ? "▲" : "▼"}
      </span>
    );
  }

  return (
    <td>
      {value}
      {unit} {arrow}
    </td>
  );
}

// Each review mode replays the same recorded take from a different angle:
// full playback, audio only (vocal image), muted video (gesture awareness),
// and the transcript with filler words highlighted.
const REVIEW_MODES = [
  {
    id: "watch",
    label: "▶ Replay",
    prompt: "Replay the full take. Does the delivery match the speaker you want to be?",
  },
  {
    id: "listen",
    label: "🙈 Auditory Image",
    prompt: "Audio only: what do you like about how you sound, and what would you change?",
  },
  {
    id: "muted",
    label: "🙉 Visual Image",
    prompt: "Sound off: watch your posture, gestures and eye line. What does your body say?",
  },
  {
    id: "transcript",
    label: "📝 Transcript",
    prompt: "",
  },
];

export default function MirrorPracticePage({ onPractiseScript }) {
  const defaultLanguage = useMemo(() => getPreferredLanguage(), []);
  // Whichever <video>/<audio> is replaying the take; transcript timestamps seek it.
  const playbackRef = useRef(null);
  const seekPlayback = (seconds) => {
    const media = playbackRef.current;

    if (!media) {
      return;
    }

    media.currentTime = seconds;
    media.play().catch(() => {});
  };
  const {
    isSupported,
    unsupportedMessage,
    selectedLanguage,
    setSelectedLanguage,
    captionLines,
    stageAspectRatio,
    isRecording,
    elapsedTime,
    errorMessage,
    hasRecording,
    hasCompletedTake,
    recordingUrl,
    downloadFileName,
    transcriptEntries,
    takeMetrics,
    previousTakeMetrics,
    isGazeWandering,
    micLevel,
    isMicSilent,
    previewVideoRef,
    startSession,
    stopSession,
    resetSession,
    downloadTranscript,
  } = useMirrorPractice(defaultLanguage);

  const [reviewMode, setReviewMode] = useState("watch");
  const [aiSuggestion, setAiSuggestion] = useState(IDLE_AI_SUGGESTION);
  const [isShowingOriginal, setIsShowingOriginal] = useState(false);
  // Two-step confirm for clearing take history, plus a version counter so
  // the trends table recomputes after a clear.
  const [isClearArmed, setIsClearArmed] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);

  const armOrClearHistory = () => {
    if (!isClearArmed) {
      setIsClearArmed(true);
      window.setTimeout(() => setIsClearArmed(false), 4000);
      return;
    }

    clearTakeHistory();
    setIsClearArmed(false);
    setHistoryVersion((version) => version + 1);
  };

  useEffect(() => {
    if (isRecording) {
      setReviewMode("watch");
      setAiSuggestion(IDLE_AI_SUGGESTION);
      setIsShowingOriginal(false);
    }
  }, [isRecording]);

  const sessionStatus = isRecording
    ? { className: "is-live", label: "Recording" }
    : hasRecording
      ? { className: "is-complete", label: "Take complete" }
      : { className: "is-idle", label: "Ready when you are" };

  let workflowGuide = "";

  if (isSupported) {
    if (isRecording) {
      workflowGuide = "Read your passage aloud or speak off the cuff. Live captions update as you speak.";
    } else if (hasRecording) {
      workflowGuide =
        "Review your take below: replay it, listen to it, or read it. Press Start Over for another take.";
    } else {
      workflowGuide = "Allow camera and microphone access, then press Record when you're framed and ready.";
    }
  } else {
    workflowGuide = unsupportedMessage;
  }

  const showReviewPanel = Boolean(hasRecording && !isRecording);
  const showDeliveryMetrics = Boolean(showReviewPanel && takeMetrics);
  const paceInfo = takeMetrics ? describePace(takeMetrics) : null;
  const pauseInfo = takeMetrics ? describePauses(takeMetrics) : null;
  const clarityInfo = takeMetrics ? describeClarity(takeMetrics) : null;
  const varietyInfo = takeMetrics ? describePitchVariety(takeMetrics) : null;
  const gazeInfo = takeMetrics ? describeGazeSteadiness(takeMetrics) : null;
  const fillersInfo = takeMetrics ? describeFillers(takeMetrics) : null;
  const paceDelta =
    takeMetrics && previousTakeMetrics && previousTakeMetrics.paceUnit === takeMetrics.paceUnit
      ? takeMetrics.paceValue - previousTakeMetrics.paceValue
      : null;
  const paceDeltaText =
    paceDelta === null
      ? "First recorded take in this language"
      : paceDelta === 0
        ? "Same pace as your last take"
        : `${paceDelta > 0 ? "▲" : "▼"} ${Math.abs(paceDelta)} ${takeMetrics.paceUnit} vs your last take`;
  // Fillers are tagged against the language the take was recorded in, not
  // whatever the select currently shows.
  const transcriptLanguage = takeMetrics?.languageCode ?? selectedLanguage;
  const showAiCoach = isTranscriptCoachAvailable() && transcriptEntries.length > 0;
  const transcriptHint =
    reviewMode === "transcript" && showAiCoach
      ? aiSuggestion.status === "ready"
        ? isShowingOriginal
          ? "Showing your original transcript."
          : "✨ Suggestions applied in place. Hover a green phrase to see what you said."
        : "Send this transcript to Gemini for feedback on your performance."
      : "";
  const reviewPrompt = REVIEW_MODES.find((mode) => mode.id === reviewMode)?.prompt || transcriptHint;

  const requestAiSuggestions = async () => {
    setAiSuggestion({ status: "loading", data: null, message: "" });

    try {
      const data = await fetchTranscriptSuggestions({
        transcript: transcriptEntries.map((entry) => entry.text).join(" "),
        languageCode: transcriptLanguage,
      });

      setAiSuggestion({ status: "ready", data, message: "" });
      setIsShowingOriginal(false);
      // Keep the advice with the stored take so the next session can remind
      // the learner what to practise.
      attachAiSummaryToTake(takeMetrics?.recordedAt, data.summary);
    } catch (error) {
      setAiSuggestion({
        status: "error",
        data: null,
        message: error instanceof Error ? error.message : "Could not fetch suggestions. Try again.",
      });
    }
  };

  const annotatedEntries =
    aiSuggestion.status === "ready" && !isShowingOriginal
      ? annotateTranscriptEntries(transcriptEntries, aiSuggestion.data.changes)
      : null;

  // Stored takes for the current language, newest first, for the trends
  // table and the pre-take advice reminder. Refreshes when a take completes
  // (takeMetrics), the language changes, or advice is attached (aiSuggestion).
  const languageTrendTakes = useMemo(() => {
    const languageCode = takeMetrics?.languageCode ?? selectedLanguage;

    return loadTakeHistory()
      .filter((take) => take.languageCode === languageCode)
      .reverse()
      .slice(0, MAX_TREND_ROWS);
  }, [selectedLanguage, takeMetrics, aiSuggestion, historyVersion]);
  const lastAdvice =
    !isRecording && !hasRecording
      ? findLatestTakeForLanguage(loadTakeHistory(), selectedLanguage)?.aiSummary
      : null;

  // Plain text still gets filler marks; once AI suggestions are applied the
  // fillers switch to struck-through, meaning "cut this".
  const renderWithFillerMarks = (text, keyPrefix) =>
    segmentFillers(text, transcriptLanguage).map((segment, segmentIndex) =>
      segment.isFiller ? (
        <mark
          key={`${keyPrefix}-${segmentIndex}`}
          className={`filler-mark${annotatedEntries ? " is-cut" : ""}`}
        >
          {segment.text}
        </mark>
      ) : (
        <span key={`${keyPrefix}-${segmentIndex}`}>{segment.text}</span>
      ),
    );

  let coachHint =
    "Centre yourself in frame and speak at a steady pace. Live captions help you follow your delivery in real time.";

  if (isRecording) {
    coachHint =
      "Keep your face centred and speak in clear phrases. The timer shows how long you have been recording.";
  } else if (hasRecording) {
    coachHint =
      "Replay your recording to hear how you sounded and see how you came across on camera, then start over if you want another take.";
  } else if (!isSupported) {
    coachHint =
      "Open Mirror Practice in desktop Chrome or Edge to record with live captions and replay your take.";
  }

  const visibleCaptionLines = captionLines.filter((line) => line.trim());
  const stageVideoStyle = { aspectRatio: String(stageAspectRatio) };

  return (
    <main className="page mirror-page" aria-label="Mirror practice">
      <header className="page-intro">
        <div className="page-intro-copy">
          <h1>Mirror Practice</h1>
          <p>
            Record yourself on camera with live captions, then replay each take to sharpen clarity and pacing.
          </p>
        </div>
        <label className="language-chip" htmlFor="camera-lang-select">
          <span>Language</span>
          <select
            id="camera-lang-select"
            value={selectedLanguage}
            onChange={(event) => setSelectedLanguage(event.target.value)}
            disabled={isRecording}
          >
            {LANGUAGE_OPTIONS.map((language) => (
              <option key={language.value} value={language.value}>
                {language.label}
              </option>
            ))}
          </select>
        </label>
      </header>

      <ol className="flow-steps" aria-label="How it works">
        <li>
          <span aria-hidden="true">1</span> Frame yourself on camera
        </li>
        <li>
          <span aria-hidden="true">2</span> Press Record and read aloud
        </li>
        <li>
          <span aria-hidden="true">3</span> Replay or download your take
        </li>
      </ol>

      {!isSupported && (
        <div className="alert" role="alert">
          {unsupportedMessage}
        </div>
      )}

      {errorMessage && (
        <div className="alert" role="alert">
          {errorMessage}
        </div>
      )}

      <section className="mirror-grid" aria-label="Mirror practice workspace">
        <section className="card stage-card">
          <div className="stage-frame">
            {hasRecording && !isRecording ? (
              <div className="camera-stage">
                {reviewMode === "listen" ? (
                  <div className="review-listen-panel" style={stageVideoStyle}>
                    <span className="review-listen-icon" aria-hidden="true">
                      🎧
                    </span>
                    <p>Listen without watching. Focus on your vocal image.</p>
                    <audio ref={playbackRef} className="review-audio" controls src={recordingUrl} />
                  </div>
                ) : (
                  <video
                    key="playback"
                    ref={playbackRef}
                    className="camera-playback"
                    controls
                    muted={reviewMode === "muted"}
                    src={recordingUrl}
                    playsInline
                    style={stageVideoStyle}
                  />
                )}
                <div className="camera-stage-chrome">
                  <span className="camera-stage-dot" />
                  <span className="camera-stage-label">Your take</span>
                </div>
                <div className="camera-stage-actions">
                  <a
                    className="btn btn-soft"
                    href={recordingUrl}
                    download={downloadFileName || "come-again-mirror-practice.webm"}
                  >
                    <span aria-hidden="true">⬇</span>
                    Download recording
                  </a>
                  <button
                    className="btn btn-ghost"
                    type="button"
                    onClick={downloadTranscript}
                    disabled={!transcriptEntries.length}
                  >
                    <span aria-hidden="true">⬇</span>
                    Download transcript
                  </button>
                </div>
              </div>
            ) : (
              <div className="camera-stage">
                <video
                  key="preview"
                  ref={previewVideoRef}
                  className="camera-preview"
                  autoPlay
                  muted
                  playsInline
                  style={stageVideoStyle}
                />
                <div className="camera-stage-chrome">
                  <span className={`camera-stage-dot ${isRecording ? "is-live" : ""}`} />
                  <span className="camera-stage-label">
                    {isRecording ? "Live captions" : "Camera preview"}
                  </span>
                </div>
                <div className="camera-duration-overlay" aria-label={`Session duration ${elapsedTime}`}>
                  {isRecording && (
                    <span className="mic-level" aria-hidden="true">
                      {[1, 2, 3, 4, 5].map((step) => (
                        <span key={step} className={`mic-level-bar ${micLevel >= step ? "is-on" : ""}`} />
                      ))}
                    </span>
                  )}
                  {elapsedTime}
                </div>
                {isRecording && isGazeWandering && (
                  <div className="camera-gaze-hint" role="status">
                    <span aria-hidden="true">👀</span> Keep your eyes on one point
                  </div>
                )}
                {isRecording && isMicSilent && (
                  <div className="camera-gaze-hint camera-mic-hint" role="alert">
                    <span aria-hidden="true">🔇</span> No sound detected. Check your microphone.
                  </div>
                )}
                {visibleCaptionLines.length > 0 && (
                  <div
                    className={`camera-subtitle-overlay ${isRecording ? "is-live" : ""}`}
                    aria-live="polite"
                    role="status"
                  >
                    {visibleCaptionLines.map((line, index) => (
                      <div key={index} className="camera-subtitle-line">
                        {line}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="card-foot">
            <strong>Burned-in captions:</strong> your saved video includes subtitles embedded in the clip.
            Transcription quality depends on your browser&apos;s speech recognition.
          </div>
        </section>

        <aside className="card tips-card" aria-label="Session tips">
          <div className="card-head">
            <h2>Before you begin</h2>
          </div>
          <ul className="tips-checklist">
            <li>Camera and microphone permissions granted</li>
            <li>Quiet room with steady lighting</li>
            <li>Eyes in the upper third of the frame</li>
            <li>Passage ready to read, or go impromptu: no plan, no rehearsal</li>
          </ul>
          {lastAdvice && (
            <div className="coach-tip" role="note">
              <span aria-hidden="true">📌</span>
              <span>
                <strong>Last time&apos;s advice:</strong> {lastAdvice}
              </span>
            </div>
          )}
          <div className="coach-tip" role="status" aria-live="polite">
            <span aria-hidden="true">💡</span>
            <span>
              <strong>Coach tip:</strong> {coachHint}
            </span>
          </div>
        </aside>
      </section>

      {showReviewPanel && (
        <section className="card review-card" aria-label="Review your take">
          <div className="card-head">
            <h2>Review your take</h2>
          </div>
          <div className="review-body">
            <div className="review-tabs" role="group" aria-label="Review modes">
              {REVIEW_MODES.map((mode) => (
                <button
                  key={mode.id}
                  className={`btn ${reviewMode === mode.id ? "btn-primary" : "btn-ghost"}`}
                  type="button"
                  aria-pressed={reviewMode === mode.id}
                  onClick={() => setReviewMode(mode.id)}
                >
                  {mode.label}
                </button>
              ))}
              {reviewMode === "transcript" && showAiCoach && (
                <div className="review-tab-actions">
                  {aiSuggestion.status === "ready" ? (
                    <>
                      {onPractiseScript && !isShowingOriginal && (
                        <button
                          className="btn btn-soft"
                          type="button"
                          onClick={() => {
                            // Drill the sentences that earned a correction; if
                            // none match (already-natural take), send the whole
                            // script sentence by sentence.
                            const sentences = splitSentences(aiSuggestion.data.revisedScript);
                            const corrected = sentences.filter((sentence) =>
                              aiSuggestion.data.changes.some(
                                (change) =>
                                  change.suggestion &&
                                  sentence.toLowerCase().includes(change.suggestion.toLowerCase()),
                              ),
                            );

                            storePracticeHandoff(
                              corrected.length ? corrected : sentences,
                              transcriptLanguage,
                            );
                            onPractiseScript();
                          }}
                        >
                          <span aria-hidden="true">📖</span>
                          Practise corrections
                        </button>
                      )}
                      <button
                        className="btn btn-ghost"
                        type="button"
                        aria-pressed={isShowingOriginal}
                        onClick={() => setIsShowingOriginal((showing) => !showing)}
                      >
                        {isShowingOriginal ? (
                          <>
                            <span aria-hidden="true">✨</span> Show improved
                          </>
                        ) : (
                          "Show original"
                        )}
                      </button>
                    </>
                  ) : (
                    <button
                      className="btn btn-soft"
                      type="button"
                      onClick={requestAiSuggestions}
                      disabled={aiSuggestion.status === "loading"}
                    >
                      <span aria-hidden="true">✨</span>
                      {aiSuggestion.status === "loading" ? "Thinking…" : "AI corrections"}
                    </button>
                  )}
                </div>
              )}
            </div>
            {reviewPrompt && (
              <p className="review-prompt" role="status" aria-live="polite">
                {reviewPrompt}
              </p>
            )}
            {reviewMode === "transcript" && (
              <>
                {aiSuggestion.status === "error" && (
                  <p className="review-ai-error" role="alert">
                    {aiSuggestion.message}
                  </p>
                )}
                <div className="review-transcript" role="region" aria-label="Take transcript" tabIndex={0}>
                  {transcriptEntries.length ? (
                    transcriptEntries.map((entry, entryIndex) => (
                      <p key={entryIndex} className="review-transcript-entry">
                        <button
                          type="button"
                          className="review-transcript-time"
                          onClick={() => seekPlayback(entry.time)}
                          title="Jump to this point in the recording"
                        >
                          [{formatTime(entry.time)}]
                        </button>{" "}
                        {annotatedEntries
                          ? annotatedEntries[entryIndex].map((segment, segmentIndex) =>
                              segment.change ? (
                                <CorrectionMark
                                  key={segmentIndex}
                                  suggestion={segment.text}
                                  saidText={segment.saidText}
                                  reason={segment.change.reason}
                                />
                              ) : (
                                <span key={segmentIndex}>
                                  {renderWithFillerMarks(segment.text, `${entryIndex}-${segmentIndex}`)}
                                </span>
                              ),
                            )
                          : renderWithFillerMarks(entry.text, String(entryIndex))}
                      </p>
                    ))
                  ) : (
                    <p className="review-transcript-empty">No speech was recognised in this take.</p>
                  )}
                </div>
                {aiSuggestion.status === "ready" && (
                  <>
                    {!isShowingOriginal && (
                      <p className="review-ai-legend">
                        <mark className="ai-mark">Green</mark> is suggested wording, hover it to see what you
                        said. <mark className="filler-mark is-cut">Struck amber</mark> is a filler to cut.
                      </p>
                    )}
                    {aiSuggestion.data.summary && (
                      <p className="review-ai-summary" role="status">
                        <span aria-hidden="true">💡</span> {aiSuggestion.data.summary}
                      </p>
                    )}
                    {aiSuggestion.data.changes.length > 0 && (
                      <details className="review-ai-details">
                        <summary>What changed and why</summary>
                        <ul className="review-ai-changes">
                          {aiSuggestion.data.changes.map((change, changeIndex) => (
                            <li key={changeIndex}>
                              <span className="review-ai-change-pair">
                                &ldquo;{change.original}&rdquo; <span aria-hidden="true">→</span>{" "}
                                <strong>&ldquo;{change.suggestion}&rdquo;</strong>
                              </span>
                              <span className="review-ai-change-reason">{change.reason}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </>
                )}
              </>
            )}
            {showDeliveryMetrics && (
              <>
                <div className="metric-strip">
                  <div
                    className={`pace-hero tone-${paceInfo.tone}`}
                    role="note"
                    aria-label={`Pace: ${takeMetrics.paceValue} ${takeMetrics.paceUnit}. ${paceInfo.caption}`}
                  >
                    <span className="pace-label">Pace</span>
                    <span className="pace-value">{takeMetrics.paceValue}</span>
                    <span className="pace-unit">{takeMetrics.paceUnit}</span>
                    <p className="pace-caption">{paceInfo.caption}</p>
                    <span className="pace-delta">{paceDeltaText}</span>
                  </div>
                  <MetricCard
                    label="Long pauses"
                    value={pauseInfo.value}
                    tooltip={pauseInfo.caption}
                    tone={pauseInfo.tone}
                  />
                  <MetricCard
                    label="Clarity"
                    value={clarityInfo.value}
                    tooltip={clarityInfo.caption}
                    tone={clarityInfo.tone}
                  />
                  <MetricCard
                    label="Vocal variety"
                    value={varietyInfo.value}
                    tooltip={varietyInfo.caption}
                    tone={varietyInfo.tone}
                  />
                  <MetricCard
                    label="Eye contact"
                    value={gazeInfo.value}
                    tooltip={gazeInfo.caption}
                    tone={gazeInfo.tone}
                  />
                  <MetricCard
                    label="Fillers"
                    value={fillersInfo.value}
                    tooltip={fillersInfo.caption}
                    tone={fillersInfo.tone}
                  />
                </div>
                <div className="coach-tip" role="status" aria-live="polite">
                  <span aria-hidden="true">💡</span>
                  <span>
                    <strong>Coach tip:</strong> {buildCoachHint(takeMetrics)}
                  </span>
                </div>
                {languageTrendTakes.length >= 2 && (
                  <details className="review-trends">
                    <summary>Your recent takes</summary>
                    <div className="review-trends-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>When</th>
                            <th>Pace</th>
                            <th>Long pauses</th>
                            <th>Clarity</th>
                            <th>Eye contact</th>
                            <th>Fillers</th>
                          </tr>
                        </thead>
                        <tbody>
                          {languageTrendTakes.map((take, rowIndex) => {
                            const previous = languageTrendTakes[rowIndex + 1];

                            return (
                              <tr key={take.recordedAt} className={rowIndex === 0 ? "is-latest" : ""}>
                                <td>{formatTakeDate(take.recordedAt)}</td>
                                <td>
                                  {take.paceValue} {take.paceUnit}
                                </td>
                                <TrendCell
                                  value={take.pauseCount}
                                  previous={previous?.pauseCount}
                                  higherIsBetter={false}
                                />
                                <TrendCell
                                  value={take.clarityPercent}
                                  previous={previous?.clarityPercent}
                                  unit="%"
                                  higherIsBetter
                                />
                                <TrendCell
                                  value={take.gazeSteadinessPercent}
                                  previous={previous?.gazeSteadinessPercent}
                                  unit="%"
                                  higherIsBetter
                                />
                                <TrendCell
                                  value={take.fillerWordCount}
                                  previous={previous?.fillerWordCount}
                                  higherIsBetter={false}
                                />
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="review-trends-foot">
                      <button
                        className={`btn btn-ghost ${isClearArmed ? "is-danger" : ""}`}
                        type="button"
                        onClick={armOrClearHistory}
                      >
                        <span aria-hidden="true">🗑</span>
                        {isClearArmed ? "Really clear? This cannot be undone" : "Clear history"}
                      </button>
                    </div>
                  </details>
                )}
              </>
            )}
          </div>
        </section>
      )}

      <section className="record-dock" aria-label="Recording controls">
        <div className="record-dock-main">
          <button
            className={`record-button ${isRecording ? "is-recording" : ""}`}
            type="button"
            onClick={isRecording ? stopSession : startSession}
            disabled={!isSupported || (!isRecording && hasCompletedTake)}
          >
            <span className="record-button-icon" aria-hidden="true">
              {isRecording ? "■" : "●"}
            </span>
            {isRecording ? "Stop" : "Record"}
          </button>
          <div className="record-dock-status">
            <div className={`status-pill ${sessionStatus.className}`} role="status" aria-live="polite">
              <span className="status-dot" />
              {sessionStatus.label}
            </div>
            <span className="record-timer">{elapsedTime}</span>
          </div>
          <div className="record-dock-actions">
            <button
              className={`btn ${hasCompletedTake && !isRecording ? "btn-primary" : "btn-ghost"}`}
              type="button"
              onClick={resetSession}
              disabled={isRecording && !hasRecording}
            >
              <span aria-hidden="true">↺</span>
              Start Over
            </button>
          </div>
        </div>
        {workflowGuide && (
          <p className="record-dock-guide" role="status" aria-live="polite">
            {workflowGuide}
          </p>
        )}
      </section>
    </main>
  );
}
