import { useMemo } from "react";
import { getPreferredLanguage, LANGUAGE_OPTIONS } from "../sentence-practice/constants/languages";
import MetricCard from "../sentence-practice/components/MetricCard";
import useMirrorPractice from "./hooks/useMirrorPractice";
import {
  buildCoachHint,
  describeClarity,
  describePace,
  describePauses,
  describePitchVariety,
} from "./utils/takeMetrics";

export default function MirrorPracticePage() {
  const defaultLanguage = useMemo(() => getPreferredLanguage(), []);
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
    previewVideoRef,
    startSession,
    stopSession,
    resetSession,
    downloadTranscript,
  } = useMirrorPractice(defaultLanguage);

  const sessionStatus = isRecording
    ? { className: "is-live", label: "Recording" }
    : hasRecording
      ? { className: "is-complete", label: "Take complete" }
      : { className: "is-idle", label: "Ready when you are" };

  let workflowGuide = "";

  if (isSupported) {
    if (isRecording) {
      workflowGuide = "Read your passage aloud. Live captions update as you speak.";
    } else if (hasRecording) {
      workflowGuide =
        "Replay your take above, check your delivery metrics, or press Start Over for another take.";
    } else {
      workflowGuide = "Allow camera and microphone access, then press Record when you're framed and ready.";
    }
  } else {
    workflowGuide = unsupportedMessage;
  }

  const showDeliveryPanel = Boolean(hasRecording && !isRecording && takeMetrics);
  const paceInfo = takeMetrics ? describePace(takeMetrics) : null;
  const pauseInfo = takeMetrics ? describePauses(takeMetrics) : null;
  const clarityInfo = takeMetrics ? describeClarity(takeMetrics) : null;
  const varietyInfo = takeMetrics ? describePitchVariety(takeMetrics) : null;
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

  let coachHint =
    "Centre yourself in frame and speak at a steady pace. Live captions help you follow your delivery in real time.";

  if (showDeliveryPanel) {
    coachHint = buildCoachHint(takeMetrics);
  } else if (hasRecording && !isRecording) {
    coachHint =
      "Replay your recording to hear how you sounded and see how you came across on camera, then start over if you want another take.";
  } else if (isRecording) {
    coachHint =
      "Keep your face centred and speak in clear phrases. The timer shows how long you have been recording.";
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
                <video
                  key="playback"
                  className="camera-playback"
                  controls
                  src={recordingUrl}
                  playsInline
                  style={stageVideoStyle}
                />
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
                  {elapsedTime}
                </div>
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

        <aside
          className="card tips-card"
          aria-label={showDeliveryPanel ? "Delivery metrics" : "Session tips"}
        >
          {showDeliveryPanel ? (
            <>
              <div className="card-head">
                <h2>Your delivery</h2>
              </div>
              <div className="delivery-panel">
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
                <div className="stats-grid">
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
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="card-head">
                <h2>Before you begin</h2>
              </div>
              <ul className="tips-checklist">
                <li>Camera and microphone permissions granted</li>
                <li>Quiet room with steady lighting</li>
                <li>Eyes in the upper third of the frame</li>
                <li>Passage or talking points ready to read</li>
              </ul>
            </>
          )}
          <div className="coach-tip" role="status" aria-live="polite">
            <span aria-hidden="true">💡</span>
            <span>
              <strong>Coach tip:</strong> {coachHint}
            </span>
          </div>
        </aside>
      </section>

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
