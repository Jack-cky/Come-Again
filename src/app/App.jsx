import { useState } from "react";
import MirrorPracticePage from "../features/mirror-practice/MirrorPracticePage";
import SentencePracticePage from "../features/sentence-practice/SentencePracticePage";

export default function App() {
  const [activeMode, setActiveMode] = useState("sentence");
  const isMirrorMode = activeMode === "mirror";

  return (
    <div className="app-frame">
      <nav
        className="mode-switch"
        aria-label="Practice modes"
        style={{ "--mode-switch-index": isMirrorMode ? 1 : 0 }}
      >
        <button
          className={`mode-switch-button ${activeMode === "sentence" ? "is-active" : ""}`}
          type="button"
          onClick={() => setActiveMode("sentence")}
          aria-pressed={activeMode === "sentence"}
        >
          Sentence Practice
        </button>
        <button
          className={`mode-switch-button ${isMirrorMode ? "is-active" : ""}`}
          type="button"
          onClick={() => setActiveMode("mirror")}
          aria-pressed={isMirrorMode}
        >
          Mirror Practice
        </button>
      </nav>
      {isMirrorMode ? <MirrorPracticePage /> : <SentencePracticePage />}
    </div>
  );
}
