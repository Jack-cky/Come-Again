import { useMemo } from "react";
import { getPreferredLanguage, LANGUAGE_OPTIONS } from "../sentence-practice/constants/languages";
import useMirrorPractice from "./hooks/useMirrorPractice";

export default function MirrorPracticePage() {
  const defaultLanguage = useMemo(() => getPreferredLanguage(), []);
  const {
    isSupported,
    unsupportedMessage,
    selectedLanguage,
    setSelectedLanguage,
    captionText,
    isRecording,
    elapsedTime,
    errorMessage,
    hasRecording,
    hasCompletedTake,
    recordingUrl,
    downloadFileName,
    transcriptText,
    previewVideoRef,
    startSession,
    stopSession,
    resetSession,
    downloadTranscript,
  } = useMirrorPractice(defaultLanguage);

  const sessionStatus = isRecording
    ? { className: "is-live", label: "Recording in progress" }
    : hasRecording
      ? { className: "is-complete", label: "Review results and replay" }
      : { className: "is-idle", label: "Ready when you are" };

  let workflowGuide = "";

  if (isSupported) {
    if (isRecording) {
      workflowGuide = "Read your passage aloud. Live captions update as you speak.";
    } else if (hasRecording) {
      workflowGuide = "Replay your recording, download it if you wish, or start over for another take.";
    } else {
      workflowGuide = "Choose a language, allow camera and microphone access, then press Start Recording.";
    }
  } else {
    workflowGuide = unsupportedMessage;
  }

  let coachHint =
    "Centre yourself in frame and speak at a steady pace. Live captions help you follow your delivery in real time.";

  if (hasRecording && !isRecording) {
    coachHint =
      "Replay your recording to hear how you sounded and see how you came across on camera, then start over if you want another take.";
  } else if (isRecording) {
    coachHint =
      "Keep your face centred and speak in clear phrases. The duration timer shows how long you have been recording.";
  } else if (!isSupported) {
    coachHint = "Open mirror practice in desktop Chrome or Edge to record with live captions and replay your take.";
  }

  const overlaySubtitle = captionText.trim();
  const currentStep = hasRecording ? 3 : isRecording ? 2 : 1;
  const guidanceCards = [
    { label: "1", title: "Frame", copy: "Centre your eyes in the upper third of the frame before you begin." },
    { label: "2", title: "Speak", copy: "Read aloud at a steady pace whilst live captions follow your speech." },
    { label: "3", title: "Review", copy: "Stop when you are finished, then replay your recording or download the clip." },
  ];

  return (
    <main className="app-shell mirror-practice-shell">
      <header className="hero">
        <div className="hero-meta">
          <div className={`status-pill ${sessionStatus.className}`} role="status" aria-live="polite">
            <span className="status-dot" />
            {sessionStatus.label}
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
        </div>
        <div className="brand-lockup">
          <div>
            <div className="hero-badge">Non-Verbal Congruence Practice</div>
            <h1>Mirror Dialogue</h1>
          </div>
        </div>
        <p>
          Read aloud on camera, follow live captions as you speak, and replay each take to sharpen your clarity,
          pacing, and pronunciation.
        </p>
        <div className="hero-controls">
          <div className="hero-actions" aria-label="Session controls">
            <button
              className="btn btn-primary"
              type="button"
              onClick={startSession}
                disabled={!isSupported || isRecording || hasCompletedTake}
            >
              <span className="btn-icon" aria-hidden="true">●</span>
              Start Recording
            </button>
            <button className="btn btn-danger" type="button" onClick={stopSession} disabled={!isRecording}>
              <span className="btn-icon" aria-hidden="true">■</span>
              Stop Recording
            </button>
            <button className="btn btn-ghost" type="button" onClick={resetSession} disabled={isRecording && !hasRecording}>
              <span className="btn-icon" aria-hidden="true">↺</span>
              Start Over
            </button>
          </div>
          {workflowGuide && (
            <p className="workflow-guide" role="status" aria-live="polite">
              {workflowGuide}
            </p>
          )}
        </div>
      </header>

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

      <section className="camera-studio-layout" aria-label="Mirror practice workspace">
        <aside className="camera-side-panel" aria-label="Session steps">
          <div>
            <h2>How it works</h2>
            <p>Set yourself up, read aloud on camera, then review how you sound and look.</p>
          </div>

          <ol className="camera-step-list">
            {guidanceCards.map((card, index) => (
              <li key={card.title} className={currentStep === index + 1 ? "is-current" : ""}>
                <span>{card.label}</span>
                <div>
                  <strong>{card.title}</strong>
                  <p>{card.copy}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="camera-readiness-card">
            <span className="camera-readiness-label">Before you begin</span>
            <ul>
              <li>Camera and microphone permissions granted</li>
              <li>Quiet room with steady lighting</li>
              <li>Face centred with captions visible</li>
            </ul>
          </div>
        </aside>

        <section className="camera-stage-panel">
          <div className="camera-stage-frame">
            {hasRecording && !isRecording ? (
              <div className="camera-stage camera-stage-review">
                <video key="playback" className="camera-playback" controls src={recordingUrl} playsInline />
                <div className="camera-stage-chrome">
                  <span className="camera-stage-dot" />
                  <span className="camera-stage-label">Replaying your recording</span>
                </div>
                <div className="camera-stage-actions">
                  <a className="camera-download-link" href={recordingUrl} download={downloadFileName || "come-again-mirror-practice.webm"}>
                    Download recording
                  </a>
                  <button
                    className="camera-download-link camera-download-button"
                    type="button"
                    onClick={downloadTranscript}
                    disabled={!transcriptText.trim()}
                  >
                    Download transcript
                  </button>
                </div>
              </div>
            ) : (
              <div className="camera-stage">
                <video key="preview" ref={previewVideoRef} className="camera-preview" autoPlay muted playsInline />
                <div className="camera-stage-chrome">
                  <span className={`camera-stage-dot ${isRecording ? "is-live" : ""}`} />
                  <span className="camera-stage-label">{isRecording ? "Live captions" : "Camera preview"}</span>
                </div>
                <div className="camera-duration-overlay" aria-label={`Session duration ${elapsedTime}`}>
                  <span className="camera-duration-label">Duration</span>
                  <span className="camera-duration-value">{elapsedTime}</span>
                </div>
                {overlaySubtitle && (
                  <div className={`camera-subtitle-overlay ${isRecording ? "is-live" : ""}`} aria-live="polite" role="status">
                    <div className="camera-subtitle-line camera-subtitle-line-interim">{overlaySubtitle}</div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="camera-stage-footer">
            <div className="camera-stage-note">
              <strong>Burned-in captions:</strong> Your saved video includes subtitles embedded in the clip. Transcription
              quality still depends on your browser&apos;s speech recognition.
            </div>
          </div>
        </section>
      </section>

      <section className="camera-bottom-note coach-tip" role="status" aria-live="polite">
        <strong>Coach tip:</strong> {coachHint}
      </section>
    </main>
  );
}
