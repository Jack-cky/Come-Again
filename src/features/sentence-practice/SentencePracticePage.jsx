import { useEffect, useMemo, useRef, useState } from "react";
import MetricCard from "./components/MetricCard";
import TranscriptWord from "./components/TranscriptWord";
import { getPreferredLanguage, LANGUAGE_OPTIONS } from "./constants/languages";
import useSentencePractice from "./hooks/useSentencePractice";
import {
  fetchAdviceSlipPassage,
  fetchTatoebaPassage,
  fetchWikipediaPassage,
} from "./services/passageSources";
import { buildTranscriptSegments, resolveTranscriptMode } from "./utils/textAnalysis";
import { consumePracticeHandoff } from "../../shared/practiceHandoff";
import splitSentences from "../../shared/splitSentences";

// A passage this long with at least this many sentences offers "practise in
// parts" so it can be drilled sentence by sentence.
const PARTS_MIN_CHARS = 200;
const PARTS_MIN_SENTENCES = 3;

const PASSAGE_SOURCES = [
  {
    id: "advice-slip",
    title: "Advice Slip",
    copy: "Short, one-line speaking drill",
    languagePrefixes: ["en"],
    fetch: fetchAdviceSlipPassage,
  },
  {
    id: "wikipedia",
    title: "Wikipedia",
    copy: "Random encyclopedia-style summary",
    languagePrefixes: ["en"],
    fetch: fetchWikipediaPassage,
  },
  {
    id: "tatoeba",
    title: "Tatoeba",
    copy: "Short Japanese example sentence",
    languagePrefixes: ["ja"],
    fetch: fetchTatoebaPassage,
  },
];

export default function SentencePracticePage() {
  const [referenceSource, setReferenceSource] = useState(null);
  const [referenceLoadState, setReferenceLoadState] = useState({
    isLoading: false,
    loadingId: null,
    message: "",
  });
  // Sentence-by-sentence practice over a long passage:
  // { parts, index, fullText } while active, null otherwise.
  const [practiceParts, setPracticeParts] = useState(null);
  const defaultLanguage = useMemo(() => getPreferredLanguage(), []);

  const {
    isSupported,
    phoneticsStatus,
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
    canReset,
    canvasRef,
    startListening,
    stopListening,
    resetSession,
    playRecording,
    pausePlayback,
  } = useSentencePractice(defaultLanguage);

  const isReferenceLoading = referenceLoadState.isLoading;
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Corrected lines handed over from Mirror Practice's AI suggestions become
  // a sentence-by-sentence practice queue. Consumed once, on mount.
  useEffect(() => {
    const handoff = consumePracticeHandoff();

    if (!handoff) {
      return;
    }

    setPracticeParts({ parts: handoff.parts, index: 0, fullText: handoff.parts.join(" ") });
    setReferenceText(handoff.parts[0]);
    setReferenceSource({ provider: "Mirror Practice", title: "Corrected lines from your take", url: "" });
    setReferenceLoadState({
      isLoading: false,
      loadingId: null,
      message:
        handoff.parts.length > 1
          ? `Loaded ${handoff.parts.length} corrected lines from Mirror Practice. Drill them one at a time.`
          : "Loaded your corrected line from Mirror Practice.",
    });

    if (typeof handoff.languageCode === "string" && handoff.languageCode) {
      setSelectedLanguage(handoff.languageCode);
    }
    // Mount-only by design: the handoff is a one-shot read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goToPart = (index) => {
    if (!practiceParts || index < 0 || index >= practiceParts.parts.length) {
      return;
    }

    if (!isListening) {
      resetSession();
    }

    setPracticeParts({ ...practiceParts, index });
    setReferenceText(practiceParts.parts[index]);
  };

  const enterPartsMode = () => {
    const parts = splitSentences(referenceText);

    if (parts.length < 2) {
      return;
    }

    if (!isListening) {
      resetSession();
    }

    setPracticeParts({ parts, index: 0, fullText: referenceText });
    setReferenceText(parts[0]);
  };

  const exitPartsMode = () => {
    if (!practiceParts) {
      return;
    }

    if (!isListening) {
      resetSession();
    }

    setReferenceText(practiceParts.fullText);
    setPracticeParts(null);
  };

  const canPractiseInParts =
    !practiceParts &&
    referenceText.length > PARTS_MIN_CHARS &&
    splitSentences(referenceText).length >= PARTS_MIN_SENTENCES;

  const loadPassage = async (source) => {
    setReferenceLoadState({
      isLoading: true,
      loadingId: source.id,
      message: `Loading a passage from ${source.title}...`,
    });

    const payload = await source.fetch();

    // Bail if the user switched practice modes while the passage was loading.
    if (!isMountedRef.current) {
      return;
    }

    setReferenceText(payload.passage);
    // A freshly loaded passage replaces any active parts queue; keeping the
    // stepper alive would let Previous/Next revert to the stale parts.
    setPracticeParts(null);
    setReferenceSource({
      provider: payload.provider ?? source.title,
      title: payload.title ?? source.title,
      url: payload.url ?? "",
    });
    setReferenceLoadState({
      isLoading: false,
      loadingId: null,
      message: payload.notice ?? `Loaded from ${source.title}.`,
    });
  };

  const handleStartOver = () => {
    const confirmed = window.confirm(
      "Start over?\n\nThis clears your transcript, recording, and session metrics so you can practice a new passage.",
    );

    if (confirmed) {
      void resetSession();
    }
  };

  const availablePassageSources = PASSAGE_SOURCES.filter((source) =>
    source.languagePrefixes.some((prefix) => selectedLanguage.toLowerCase().startsWith(prefix)),
  );

  // phoneticsStatus is an intentional extra dependency in both memos: the
  // functions read the module-level Japanese tokenizer, so the diff must
  // recompute once the reading dictionary finishes loading.
  const transcriptMode = useMemo(
    () => resolveTranscriptMode(referenceText, finalTranscript, selectedLanguage),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [finalTranscript, referenceText, selectedLanguage, phoneticsStatus],
  );

  const transcriptSegments = useMemo(
    () =>
      buildTranscriptSegments(referenceText, finalTranscript, selectedLanguage, {
        includeMissed: hasUserStopped && !isListening,
        mode: transcriptMode,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      finalTranscript,
      hasUserStopped,
      isListening,
      referenceText,
      selectedLanguage,
      transcriptMode,
      phoneticsStatus,
    ],
  );

  const hasHighlightedWords = transcriptSegments.some(
    (segment) => segment.kind === "incorrect" || segment.kind === "missed",
  );

  let sessionStatus = {
    className: "is-idle",
    label: "Ready when you are",
  };

  if (isListening) {
    sessionStatus = {
      className: "is-live",
      label: "Recording",
    };
  } else if (isPlaying) {
    sessionStatus = {
      className: "is-playing",
      label: "Replaying",
    };
  } else if (hasUserStopped && hasRecording) {
    sessionStatus = {
      className: "is-complete",
      label: "Session complete",
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
      workflowGuide =
        "Read the reference passage aloud. Your transcript and accuracy update live as you speak.";
    } else if (isPlaying) {
      workflowGuide =
        "Listen back to your recording. Pause at any time; playback resumes where you left off.";
    } else if (hasUserStopped && hasRecording) {
      workflowGuide =
        "Check the highlighted words above, replay your recording, or press Start Over to try a new passage.";
    } else if (hasUserStopped) {
      workflowGuide = "Review your transcript above, or press Start Over to try another passage.";
    } else if (referenceText.trim()) {
      workflowGuide = "You're all set. Press Record and read the passage aloud.";
    } else {
      workflowGuide = "Load or paste a passage first, then press Record and read it aloud.";
    }
  }

  const referenceCharacterCount = referenceText.replace(/\s+/g, "").length;

  const accuracyTone =
    accuracy === null ? "neutral" : accuracy >= 85 ? "good" : accuracy >= 60 ? "warn" : "risk";
  const confidenceTone =
    confidence === null ? "neutral" : confidence >= 80 ? "good" : confidence >= 55 ? "warn" : "risk";
  const speedTone = charactersPerMinute > 0 && charactersPerMinute < 120 ? "warn" : "neutral";

  let coachHint = "Strong match. Try a longer passage or switch languages to keep building consistency.";

  if (hasUserStopped && hasRecording) {
    coachHint =
      "Replay your recording to hear how you sounded, then focus on any highlighted words you missed or mispronounced.";
  } else if (hasUserStopped) {
    coachHint =
      "Compare your transcript with the reference text. Start over anytime to practice a new passage.";
  } else if (!finalTranscript.trim()) {
    coachHint = referenceText.trim()
      ? "Speak in short, clear phrases. The level bar next to the Record button shows when your voice is picked up."
      : "Load or paste the passage you want to practice. Accuracy scores need something to compare against.";
  } else if (accuracy !== null && accuracy < 60) {
    coachHint =
      "Slow down and match the reference rhythm. Pause briefly between phrases for clearer recognition.";
  } else if (accuracy !== null && accuracy < 85) {
    coachHint = "Good progress. Run through it once more and pay extra attention to the highlighted words.";
  }

  const secondaryStats = [
    {
      label: "Confidence",
      value: confidence === null ? "—" : `${confidence}%`,
      tooltip: "How sure the browser is about what it heard",
      tone: confidenceTone,
    },
    {
      label: "Duration",
      value: elapsedTime,
      tooltip: "Time spent speaking this session",
      tone: isListening ? "good" : "neutral",
    },
    {
      label: "Speed",
      value: String(charactersPerMinute),
      tooltip: "Characters spoken per minute",
      tone: speedTone,
    },
    {
      label: "Characters",
      value: String(characterCount),
      tooltip: "Characters captured in your transcript",
      tone: "neutral",
    },
  ];

  return (
    <main className="page" aria-label="Sentence practice">
      <header className="page-intro">
        <div className="page-intro-copy">
          <h1>Sentence Practice</h1>
          <p>Read a passage aloud and see how closely your speech matches it, word by word.</p>
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
      </header>

      <ol className="flow-steps" aria-label="How it works">
        <li>
          <span aria-hidden="true">1</span> Load or paste a passage
        </li>
        <li>
          <span aria-hidden="true">2</span> Press Record and read aloud
        </li>
        <li>
          <span aria-hidden="true">3</span> Review highlights and replay
        </li>
      </ol>

      {!isSupported && (
        <div className="alert" role="alert">
          Speech recognition is not available in this browser. Open the app in a browser with Web Speech API
          support, such as Chrome, Edge, or Safari, to start practicing.
        </div>
      )}

      {errorMessage && (
        <div className="alert" role="alert">
          {errorMessage}
        </div>
      )}

      <section className="practice-grid">
        <section className="card" aria-label="Reference passage">
          <div className="card-head">
            <h2>Reference passage</h2>
            <span className="card-chip">{referenceCharacterCount} chars</span>
          </div>
          <div className="source-row">
            {availablePassageSources.length ? (
              <>
                <span className="source-row-label">Quick load:</span>
                {availablePassageSources.map((source) => (
                  <button
                    key={source.id}
                    className="source-chip"
                    type="button"
                    title={source.copy}
                    onClick={() => loadPassage(source)}
                    disabled={isListening || isPlaying || isReferenceLoading}
                  >
                    <span aria-hidden="true">✨</span>
                    {isReferenceLoading && referenceLoadState.loadingId === source.id
                      ? "Loading..."
                      : source.title}
                  </button>
                ))}
              </>
            ) : (
              <span className="source-row-label">
                No built-in passages for this language yet. Paste your own text below.
              </span>
            )}
          </div>
          {practiceParts ? (
            <div className="parts-stepper" role="group" aria-label="Practice parts">
              <button
                className="btn btn-ghost"
                type="button"
                disabled={practiceParts.index === 0}
                onClick={() => goToPart(practiceParts.index - 1)}
              >
                <span aria-hidden="true">‹</span> Previous
              </button>
              <span className="parts-stepper-label" role="status" aria-live="polite">
                Part {practiceParts.index + 1} of {practiceParts.parts.length}
              </span>
              <button
                className="btn btn-ghost"
                type="button"
                disabled={practiceParts.index === practiceParts.parts.length - 1}
                onClick={() => goToPart(practiceParts.index + 1)}
              >
                Next <span aria-hidden="true">›</span>
              </button>
              <button className="btn btn-ghost" type="button" onClick={exitPartsMode}>
                Show full passage
              </button>
            </div>
          ) : (
            canPractiseInParts && (
              <div className="parts-stepper">
                <button className="btn btn-ghost" type="button" onClick={enterPartsMode}>
                  <span aria-hidden="true">✂</span> Practise in parts
                </button>
                <span className="parts-stepper-label">
                  Long passage? Drill it sentence by sentence.
                </span>
              </div>
            )
          )}
          <label className="sr-only" htmlFor="reference-text">
            Reference text
          </label>
          <textarea
            id="reference-text"
            value={referenceText}
            onChange={(event) => {
              setReferenceText(event.target.value);
              setReferenceSource(null);
              setPracticeParts(null);
              setReferenceLoadState({ isLoading: false, loadingId: null, message: "" });
            }}
            placeholder="Paste any text you want to practice, or use Quick load above. Your speech will be scored against whatever is written here."
          />
          {(referenceLoadState.message || referenceSource) && (
            <div className="card-foot reference-meta">
              {referenceLoadState.message && (
                <span role="status" aria-live="polite">
                  {referenceLoadState.message}
                </span>
              )}
              {referenceSource && (
                <span className="reference-source">
                  Source:{" "}
                  {referenceSource.url ? (
                    <a href={referenceSource.url} target="_blank" rel="noreferrer">
                      {referenceSource.title}
                    </a>
                  ) : (
                    referenceSource.title
                  )}
                </span>
              )}
            </div>
          )}
        </section>

        <section className="card" aria-label="Your speech">
          <div className="card-head">
            <h2>Your speech</h2>
            <span className="card-chip">{characterCount} chars</span>
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
                      onBeforeSpeak={isPlaying ? pausePlayback : undefined}
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
          {phoneticsStatus === "loading" && (
            <div className="card-foot" role="status">
              Preparing the Japanese reading dictionary. Kanji and kana will be matched by pronunciation once
              it loads (first use only).
            </div>
          )}
          {phoneticsStatus === "failed" && (
            <div className="card-foot" role="status">
              The Japanese reading dictionary could not be downloaded, so matching uses kana folding only,
              and kanji and kana spellings of the same word may be flagged. Check your connection and
              reselect Japanese to retry.
            </div>
          )}
          {hasHighlightedWords && referenceText.trim() && (
            <div className="card-foot transcript-legend">
              <span className="legend-swatch" aria-hidden="true">
                word
              </span>
              Highlighted words were missed or mispronounced. Click one to hear it pronounced correctly.
            </div>
          )}
        </section>
      </section>

      <section className="card results-card" aria-label="Session results">
        <div className="card-head">
          <h2>Results</h2>
        </div>
        <div className="results-body">
          <div className={`accuracy-hero tone-${accuracyTone}`}>
            <span className="accuracy-label">Accuracy</span>
            <span className="accuracy-value">{accuracy === null ? "—" : `${accuracy}%`}</span>
            <div className="accuracy-bar" aria-hidden="true">
              <span style={{ width: `${accuracy ?? 0}%` }} />
            </div>
            <p className="accuracy-caption">How closely your speech matched the passage</p>
          </div>
          <div className="stats-grid">
            {secondaryStats.map((stat) => (
              <MetricCard
                key={stat.label}
                label={stat.label}
                value={stat.value}
                tooltip={stat.tooltip}
                tone={stat.tone}
              />
            ))}
          </div>
        </div>
        <div className="coach-tip" role="status" aria-live="polite">
          <span aria-hidden="true">💡</span>
          <span>
            <strong>Coach tip:</strong> {coachHint}
          </span>
        </div>
      </section>

      <section className="record-dock" aria-label="Recording controls">
        <div className="record-dock-main">
          <button
            className={`record-button ${isListening ? "is-recording" : ""}`}
            type="button"
            onClick={isListening ? stopListening : startListening}
            disabled={!isSupported || (!isListening && hasUserStopped)}
          >
            <span className="record-button-icon" aria-hidden="true">
              {isListening ? "■" : "●"}
            </span>
            {isListening ? "Stop" : "Record"}
          </button>
          <div className="record-dock-status">
            <div className={`status-pill ${sessionStatus.className}`} role="status" aria-live="polite">
              <span className="status-dot" />
              {sessionStatus.label}
            </div>
            <div className="record-dock-meter">
              <span className="record-timer">{elapsedTime}</span>
              <canvas id="level" ref={canvasRef} width="300" height="8" aria-label="Microphone level" />
            </div>
          </div>
          <div className="record-dock-actions">
            <button
              className="btn btn-soft"
              type="button"
              onClick={isPlaying ? pausePlayback : playRecording}
              disabled={!hasRecording || isListening}
            >
              <span aria-hidden="true">{isPlaying ? "⏸" : "▶"}</span>
              {isPlaying ? "Pause" : "Replay"}
            </button>
            <button
              className={`btn ${hasUserStopped && !isListening ? "btn-primary" : "btn-ghost"}`}
              type="button"
              onClick={handleStartOver}
              disabled={!canReset}
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
