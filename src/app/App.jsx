import { useState } from "react";
import MirrorPracticePage from "../features/mirror-practice/MirrorPracticePage";
import SentencePracticePage from "../features/sentence-practice/SentencePracticePage";
import ErrorBoundary from "./ErrorBoundary";

const MODES = [
  {
    id: "sentence",
    icon: "📖",
    label: "Sentence Practice",
    hint: "Read a passage, get scored",
  },
  {
    id: "mirror",
    icon: "🎥",
    label: "Mirror Practice",
    hint: "Record yourself on camera",
  },
];

export default function App() {
  const [activeMode, setActiveMode] = useState("sentence");

  const activateMode = (modeId) => {
    setActiveMode(modeId);
    document.getElementById(`mode-tab-${modeId}`)?.focus();
  };

  const handleTabKeyDown = (event) => {
    const currentIndex = MODES.findIndex((mode) => mode.id === activeMode);
    let nextIndex = null;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % MODES.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + MODES.length) % MODES.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = MODES.length - 1;
    }

    if (nextIndex === null) {
      return;
    }

    event.preventDefault();
    activateMode(MODES[nextIndex].id);
  };

  return (
    <div className="app-frame">
      <header className="app-header">
        <div className="app-brand">
          <img className="app-logo" src={`${import.meta.env.BASE_URL}icon.svg`} alt="" />
          <div className="app-brand-copy">
            <span className="app-name">Come Again</span>
            <span className="app-tagline">Speak clearly. Be understood.</span>
          </div>
        </div>
        <div className="mode-switch" role="tablist" aria-label="Practice modes">
          {MODES.map((mode) => {
            const isActive = activeMode === mode.id;

            return (
              <button
                key={mode.id}
                id={`mode-tab-${mode.id}`}
                className={`mode-tab ${isActive ? "is-active" : ""}`}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls={`mode-panel-${mode.id}`}
                tabIndex={isActive ? 0 : -1}
                onClick={() => activateMode(mode.id)}
                onKeyDown={handleTabKeyDown}
              >
                <span className="mode-tab-icon" aria-hidden="true">
                  {mode.icon}
                </span>
                <span className="mode-tab-copy">
                  <span className="mode-tab-label">{mode.label}</span>
                  <span className="mode-tab-hint">{mode.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      </header>
      <div id={`mode-panel-${activeMode}`} role="tabpanel" aria-labelledby={`mode-tab-${activeMode}`}>
        <ErrorBoundary key={activeMode}>
          {activeMode === "mirror" ? (
            <MirrorPracticePage onPractiseScript={() => activateMode("sentence")} />
          ) : (
            <SentencePracticePage />
          )}
        </ErrorBoundary>
      </div>
    </div>
  );
}
