import { useEffect, useMemo, useRef, useState } from "react";
import MetricCard from "./components/MetricCard";
import TranscriptWord from "./components/TranscriptWord";
import { getPreferredLanguage, LANGUAGE_OPTIONS } from "./constants/languages";
import useSentencePractice from "./hooks/useSentencePractice";
import {
  fetchAdviceSlipPassage,
  fetchWikipediaPassage,
} from "./services/passageSources";
import { buildTranscriptSegments, resolveTranscriptMode } from "./utils/textAnalysis";

export default function SentencePracticePage() {
  const [referenceSource, setReferenceSource] = useState(null);
  const [referenceLoadState, setReferenceLoadState] = useState({
    isLoading: false,
    message: "",
  });
  const [isPlaybackTooltipVisible, setIsPlaybackTooltipVisible] = useState(false);
  const sourceDropdownRef = useRef(null);
  const defaultLanguage = useMemo(() => getPreferredLanguage(), []);

  const {
    isSupported,
    selectedLanguage,
    setSelectedLanguage,
    referenceText,
    setReferenceText,
    finalTranscript,
    interimTranscript,
    isListening,
    accuracy,
    confidence,
    elapsedTime,
    charactersPerMinute,
    characterCount,
    errorMessage,
    hasRecording,
    hasUserStopped,
    isPlaying,
    canPlaybackRecording,
    canReset,
    canvasRef,
    startListening,
    stopListening,
    resetSession,
    playRecording,
    pausePlayback,
  } = useSentencePractice(defaultLanguage);

  const isReferenceLoading = referenceLoadState.isLoading;
  const referenceSourceLabel = referenceSource?.provider ?? "Choose a source";
  const playbackDisabledMessage =
    "Playback is disabled on mobile devices because it can break the next recording after replay.";

  useEffect(() => {
    const closeSourceDropdown = () => {
      sourceDropdownRef.current?.removeAttribute("open");
    };

    const handlePointerDown = (event) => {
      if (!sourceDropdownRef.current?.hasAttribute("open")) {
        return;
      }

      if (sourceDropdownRef.current.contains(event.target)) {
        return;
      }

      closeSourceDropdown();
    };

    const handleKeyDown = (event) => {
      if (event.key !== "Escape") {
        return;
      }

      closeSourceDropdown();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (canPlaybackRecording) {
      setIsPlaybackTooltipVisible(false);
    }
  }, [canPlaybackRecording]);

  const createLoadPassageHandler = (loadPassage) => async (event) => {
    event.currentTarget.closest("details")?.removeAttribute("open");
    await loadPassage();
  };

  const loadWikipediaPassage = async () => {
    setReferenceLoadState({ isLoading: true, message: "Loading a Wikipedia passage..." });

    const payload = await fetchWikipediaPassage();

    setReferenceText(payload.passage);
    setReferenceSource({
      provider: payload.provider ?? "Wikipedia",
      title: payload.title ?? "Wikipedia",
      url: payload.url ?? "",
    });
    setReferenceLoadState({
      isLoading: false,
      message: payload.notice ?? "Loaded from Wikipedia.",
    });
  };

  const loadAdviceSlipPassage = async () => {
    setReferenceLoadState({ isLoading: true, message: "Loading a short Advice Slip passage..." });

    const payload = await fetchAdviceSlipPassage();

    setReferenceText(payload.passage);
    setReferenceSource({
      provider: payload.provider ?? "Advice Slip",
      title: payload.title,
      url: payload.url ?? "",
    });
    setReferenceLoadState({
      isLoading: false,
      message: payload.notice ?? "Loaded from Advice Slip.",
    });
  };

  const transcriptMode = useMemo(
    () => resolveTranscriptMode(referenceText, finalTranscript, selectedLanguage),
    [finalTranscript, referenceText, selectedLanguage]
  );

  const transcriptSegments = useMemo(
    () =>
      buildTranscriptSegments(referenceText, finalTranscript, selectedLanguage, {
        includeMissed: hasUserStopped && !isListening,
        mode: transcriptMode,
      }),
    [finalTranscript, hasUserStopped, isListening, referenceText, selectedLanguage, transcriptMode]
  );

  const hasHighlightedWords = transcriptSegments.some(
    (segment) => segment.kind === "incorrect" || segment.kind === "missed"
  );

  let sessionStatus = {
    className: "is-idle",
    label: "Ready when you are",
  };

  if (isListening) {
    sessionStatus = {
      className: "is-live",
      label: "Recording in progress",
    };
  } else if (isPlaying) {
    sessionStatus = {
      className: "is-playing",
      label: "Replaying your recording",
    };
  } else if (hasUserStopped && hasRecording) {
    sessionStatus = {
      className: "is-complete",
      label: "Review results and replay",
    };
  } else if (hasUserStopped) {
    sessionStatus = {
      className: "is-idle",
      label: "Recording finished",
    };
  }

  let workflowGuide = "";

  if (isSupported) {
    if (isListening) {
      workflowGuide = "Read the reference passage aloud. Your transcript and accuracy update live as you speak.";
    } else if (isPlaying) {
      workflowGuide = "Listen back to your recording. Pause at any time; playback resumes where you left off.";
    } else if (hasUserStopped && hasRecording) {
      workflowGuide = "Check highlighted words in your transcript, then replay your recording or start over.";
    } else if (hasUserStopped) {
      workflowGuide = "Review your transcript below, or start over to try another passage.";
    } else if (referenceText.trim()) {
      workflowGuide = "Press Start Recording when you're ready, then read the reference passage aloud.";
    } else {
      workflowGuide = "Choose a language, paste a passage to practice, then press Start Recording.";
    }
  }

  const referenceCharacterCount = referenceText.replace(/\s+/g, "").length;

  const accuracyTone = accuracy === null ? "neutral" : accuracy >= 85 ? "good" : accuracy >= 60 ? "warn" : "risk";
  const confidenceTone =
    confidence === null ? "neutral" : confidence >= 80 ? "good" : confidence >= 55 ? "warn" : "risk";
  const speedTone = charactersPerMinute > 0 && charactersPerMinute < 120 ? "warn" : "neutral";

  let coachHint = "Strong match. Try a longer passage or switch languages to keep building consistency.";

  if (hasUserStopped && hasRecording) {
    coachHint =
      "Replay your recording to hear how you sounded, then focus on any underlined words you missed or mispronounced.";
  } else if (hasUserStopped) {
    coachHint = "Compare the live transcript with the reference text. Start over anytime to practice a new passage.";
  } else if (!finalTranscript.trim()) {
    coachHint = referenceText.trim()
      ? "Speak in short, clear phrases. The microphone level bar shows when your voice is being picked up."
      : "Paste the passage you want to practice before recording — accuracy scores need something to compare against.";
  } else if (accuracy !== null && accuracy < 60) {
    coachHint = "Slow down and match the reference rhythm. Pause briefly between phrases for clearer recognition.";
  } else if (accuracy !== null && accuracy < 85) {
    coachHint = "Good progress. Run through it once more and pay extra attention to the underlined mismatched words.";
  }

  const metrics = [
    {
      label: "Accuracy",
      value: accuracy === null ? "—" : `${accuracy}%`,
      tooltip: "Percentage of your speech that matches the reference passage",
      tone: accuracyTone,
    },
    {
      label: "Confidence",
      value: confidence === null ? "—" : `${confidence}%`,
      tooltip: "How confident the browser is in what it heard you say",
      tone: confidenceTone,
    },
    {
      label: "Duration",
      value: elapsedTime,
      tooltip: "How long you have been speaking during this session",
      tone: isListening ? "good" : "neutral",
    },
    {
      label: "Speed",
      value: String(charactersPerMinute),
      tooltip: "How fast you are speaking, measured in characters per minute",
      tone: speedTone,
    },
    {
      label: "Characters",
      value: String(characterCount),
      tooltip: "Number of characters captured in your live transcript",
      tone: "neutral",
    },
  ];

  return (
    <main className="app-shell">
      <header className="hero">
        <div className="hero-meta">
          <div className={`status-pill ${sessionStatus.className}`} role="status" aria-live="polite">
            <span className="status-dot" />
            {sessionStatus.label}
          </div>
          <label className="language-chip" htmlFor="lang-select">
            <span>Language</span>
            <select
              id="lang-select"
              value={selectedLanguage}
              onChange={(event) => setSelectedLanguage(event.target.value)}
              disabled={isListening}
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
              <div className="hero-badge">Real-Time Pronunciation Studio</div>
              <h1>Come Again</h1>
            </div>
        </div>
        <p>
          Read a passage aloud, see how closely your speech matches the text, and replay your recording to fine-tune
          pronunciation.
        </p>
        <div className="hero-controls">
          <div className="hero-actions" aria-label="Session controls">
            <button
              className="btn btn-primary"
              type="button"
              onClick={startListening}
              disabled={!isSupported || isListening || hasUserStopped}
            >
              <span className="btn-icon" aria-hidden="true">●</span>
              Start Recording
            </button>
            <button className="btn btn-danger" type="button" onClick={stopListening} disabled={!isListening}>
              <span className="btn-icon" aria-hidden="true">■</span>
              Stop Recording
            </button>
            <span
              className={`control-tooltip-anchor ${!canPlaybackRecording ? "is-disabled-control" : ""}`}
              tabIndex={!canPlaybackRecording ? 0 : undefined}
              aria-describedby={!canPlaybackRecording && isPlaybackTooltipVisible ? "playback-disabled-tooltip" : undefined}
              onMouseEnter={!canPlaybackRecording ? () => setIsPlaybackTooltipVisible(true) : undefined}
              onMouseLeave={!canPlaybackRecording ? () => setIsPlaybackTooltipVisible(false) : undefined}
              onFocus={!canPlaybackRecording ? () => setIsPlaybackTooltipVisible(true) : undefined}
              onBlur={!canPlaybackRecording ? () => setIsPlaybackTooltipVisible(false) : undefined}
              onClick={!canPlaybackRecording ? () => setIsPlaybackTooltipVisible((visible) => !visible) : undefined}
              onKeyDown={!canPlaybackRecording ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setIsPlaybackTooltipVisible((visible) => !visible);
                }

                if (event.key === "Escape") {
                  setIsPlaybackTooltipVisible(false);
                }
              } : undefined}
            >
              <button
                className={`btn ${isPlaying ? "btn-danger" : "btn-soft"}`}
                type="button"
                onClick={isPlaying ? pausePlayback : playRecording}
                disabled={!canPlaybackRecording || !hasRecording || isListening}
              >
                <span className="btn-icon" aria-hidden="true">{isPlaying ? "■" : "▶"}</span>
                {isPlaying ? "Pause Playback" : "Play Recording"}
              </button>
              {!canPlaybackRecording && isPlaybackTooltipVisible && (
                <span id="playback-disabled-tooltip" className="control-tooltip" role="tooltip">
                  {playbackDisabledMessage}
                </span>
              )}
            </span>
            <button className="btn btn-ghost" type="button" onClick={resetSession} disabled={!canReset}>
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
          Speech recognition is not available in this browser. Open the app in a browser with Web Speech API support,
          such as Chrome, Edge, or Safari, to start practicing.
        </div>
      )}

      {errorMessage && (
        <div className="alert" role="alert">
          {errorMessage}
        </div>
      )}

      <section className="metrics" aria-label="Session metrics">
        {metrics.map((metric) => (
          <MetricCard
            key={metric.label}
            label={metric.label}
            value={metric.value}
            tooltip={metric.tooltip}
            tone={metric.tone}
          />
        ))}
      </section>

      <section className="workspace-grid">
        <div className="panel text-section">
          <div className="panel-head">
            <h2>Reference Text</h2>
            <div className="reference-toolbar-actions">
              <details className="source-dropdown" ref={sourceDropdownRef}>
                <summary
                  className={`source-dropdown-trigger ${
                    isListening || isPlaying || isReferenceLoading ? "is-disabled" : ""
                  }`}
                  aria-label="Choose a passage source"
                >
                  <span className="source-dropdown-copy">
                    <span className="source-dropdown-label">Load Passage</span>
                    <span className="source-dropdown-value">{isReferenceLoading ? "Loading..." : referenceSourceLabel}</span>
                  </span>
                  <span className="source-dropdown-caret" aria-hidden="true">
                    ▾
                  </span>
                </summary>
                <div className="source-dropdown-menu" role="menu" aria-label="Passage sources">
                  <button
                    className="source-dropdown-item"
                    type="button"
                     onClick={createLoadPassageHandler(loadAdviceSlipPassage)}
                    disabled={isListening || isPlaying || isReferenceLoading}
                    role="menuitem"
                  >
                    <span className="source-dropdown-item-title">Advice Slip</span>
                    <span className="source-dropdown-item-copy">Short, one-line speaking drill</span>
                  </button>
                  <button
                    className="source-dropdown-item"
                    type="button"
                     onClick={createLoadPassageHandler(loadWikipediaPassage)}
                    disabled={isListening || isPlaying || isReferenceLoading}
                    role="menuitem"
                  >
                    <span className="source-dropdown-item-title">Wikipedia</span>
                    <span className="source-dropdown-item-copy">Random encyclopedia-style summary</span>
                  </button>
                </div>
              </details>
              <span className="panel-count">{referenceCharacterCount} chars</span>
            </div>
          </div>
          <label className="sr-only" htmlFor="reference-text">
            Reference text
          </label>
          <textarea
            id="reference-text"
            value={referenceText}
            onChange={(event) => {
              setReferenceText(event.target.value);
              setReferenceSource(null);
              setReferenceLoadState({ isLoading: false, message: "" });
            }}
            placeholder="Paste your target text here to track accuracy in real time. This helps measure how accurately speech recognition captures your expected content."
          />
          {referenceLoadState.message && (
            <div className="reference-status" role="status" aria-live="polite">
              {referenceLoadState.message}
            </div>
          )}
          {referenceSource && (
            <div className="reference-source">
              <span>Source:</span>
              {referenceSource.url ? (
                <a href={referenceSource.url} target="_blank" rel="noreferrer">
                  {referenceSource.title}
                </a>
              ) : (
                <span>{referenceSource.title}</span>
              )}
            </div>
          )}
          <div className="hint">
            <strong>Tip:</strong> Use Advice Slip or Wikipedia for live English passages. Punctuation does not affect matching.
          </div>
        </div>

        <div className="panel text-section">
          <div className="panel-head">
            <h2>Live Transcript</h2>
            <span className="panel-count">{characterCount} chars</span>
          </div>
          <div className="transcript">
            <div className="final" aria-live="off">
              {transcriptSegments.map((segment, index) => {
                if (segment.kind === "missed" || segment.kind === "incorrect") {
                  return (
                    <TranscriptWord
                      key={`${segment.kind}-${index}`}
                      segment={segment}
                      languageCode={selectedLanguage}
                    />
                  );
                }

                return <span key={`normal-${index}`}>{segment.text}</span>;
              })}
            </div>
            <div className="interim" role="status" aria-live="polite">
              {interimTranscript}
            </div>
          </div>
          {hasHighlightedWords && referenceText.trim() && (
            <div className="hint">
              <strong>Legend:</strong> Highlighted words were missed or mispronounced. Hover to compare, and click to
              hear the correct pronunciation.
            </div>
          )}
        </div>
      </section>

      <div className="coach-tip" role="status" aria-live="polite">
        <strong>Coach tip:</strong> {coachHint}
      </div>

      <div className="level-wrap" aria-label="Microphone level">
        <span className="hint level-label">Microphone level</span>
        <canvas id="level" ref={canvasRef} width="300" height="8" />
      </div>
    </main>
  );
}
