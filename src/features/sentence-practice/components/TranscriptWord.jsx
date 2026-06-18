import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { speakCorrectWord } from "../services/pronunciationService";

const TOOLTIP_MAX_WIDTH = 256;
const VIEWPORT_PADDING = 16;

function getPronunciationTarget(segment) {
  if (segment.correctWord) {
    return segment.correctWord;
  }

  if (segment.kind === "missed") {
    return segment.text.trim();
  }

  return "";
}

export default function TranscriptWord({ segment, languageCode }) {
  const [isTooltipVisible, setIsTooltipVisible] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ left: 0, top: 0 });
  const wordRef = useRef(null);
  const tooltipId = useId();
  const pronunciationTarget = getPronunciationTarget(segment);
  const canSpeak = Boolean(pronunciationTarget);
  const spokenLabel = segment.spokenWord || "(not spoken)";
  const expectedLabel = segment.correctWord || "(none)";

  const updateTooltipPosition = useCallback(() => {
    const wordElement = wordRef.current;

    if (!wordElement) {
      return;
    }

    const rect = wordElement.getBoundingClientRect();
    const halfTooltipWidth = Math.min(
      TOOLTIP_MAX_WIDTH / 2,
      Math.max(window.innerWidth / 2 - VIEWPORT_PADDING, 0)
    );
    const minLeft = VIEWPORT_PADDING + halfTooltipWidth;
    const maxLeft = window.innerWidth - VIEWPORT_PADDING - halfTooltipWidth;
    const centeredLeft = rect.left + rect.width / 2;

    setTooltipPosition({
      left: Math.min(Math.max(centeredLeft, minLeft), maxLeft),
      top: rect.top - 8,
    });
  }, []);

  useEffect(() => {
    if (!isTooltipVisible) {
      return undefined;
    }

    updateTooltipPosition();

    const handleViewportChange = () => {
      updateTooltipPosition();
    };

    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [isTooltipVisible, updateTooltipPosition]);

  const handleSpeak = useCallback(async () => {
    if (!canSpeak || isSpeaking) {
      return;
    }

    setIsSpeaking(true);

    try {
      await speakCorrectWord(pronunciationTarget, languageCode);
    } catch (error) {
      // Ignore playback errors so transcript interaction stays responsive.
    } finally {
      setIsSpeaking(false);
    }
  }, [canSpeak, isSpeaking, languageCode, pronunciationTarget]);

  const handleKeyDown = useCallback(
    (event) => {
      if (!canSpeak) {
        return;
      }

      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handleSpeak();
      }
    },
    [canSpeak, handleSpeak]
  );

  const handleMouseLeave = useCallback(() => {
    setIsTooltipVisible(false);
  }, []);

  return (
    <span
      ref={wordRef}
      className={`transcript-word ${segment.kind}${isSpeaking ? " is-speaking" : ""}`}
      onMouseEnter={() => {
        updateTooltipPosition();
        setIsTooltipVisible(true);
      }}
      onMouseLeave={handleMouseLeave}
      onFocus={() => {
        updateTooltipPosition();
        setIsTooltipVisible(true);
      }}
      onBlur={handleMouseLeave}
      onClick={canSpeak ? handleSpeak : undefined}
      onKeyDown={handleKeyDown}
      role={canSpeak ? "button" : undefined}
      tabIndex={canSpeak ? 0 : undefined}
      aria-describedby={isTooltipVisible ? tooltipId : undefined}
      aria-label={
        canSpeak
          ? `You said ${spokenLabel}. Expected ${expectedLabel}. Click to hear the correct pronunciation.`
          : `You said ${spokenLabel}. Expected ${expectedLabel}.`
      }
    >
      {segment.text}
      {isTooltipVisible &&
        createPortal(
          <span
            id={tooltipId}
            className="word-tooltip"
            role="tooltip"
            style={{ left: `${tooltipPosition.left}px`, top: `${tooltipPosition.top}px` }}
          >
            <span className="word-tooltip-row">
              <strong>You said:</strong> {spokenLabel}
            </span>
            <span className="word-tooltip-row">
              <strong>Expected:</strong> {expectedLabel}
            </span>
            {canSpeak && <span className="word-tooltip-action">Click to hear the pronunciation.</span>}
          </span>,
          document.body
        )}
    </span>
  );
}
