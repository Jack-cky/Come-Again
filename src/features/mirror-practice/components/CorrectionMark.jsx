import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Inline AI correction in the transcript review: shows the suggested wording
// and reveals what the learner actually said (plus the reason) on hover or
// keyboard focus. Tooltip positioning deliberately mirrors sentence
// practice's TranscriptWord and reuses its .word-tooltip styles.
const TOOLTIP_MAX_WIDTH = 256;
const VIEWPORT_PADDING = 16;

export default function CorrectionMark({ suggestion, saidText, reason }) {
  const [isTooltipVisible, setIsTooltipVisible] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ left: 0, top: 0 });
  const markRef = useRef(null);
  const tooltipId = useId();

  const updateTooltipPosition = useCallback(() => {
    const markElement = markRef.current;

    if (!markElement) {
      return;
    }

    // A phrase that wraps across lines has a union bounding box whose centre
    // can sit far from the visible text; anchor to the first line fragment.
    const rect = markElement.getClientRects()[0] ?? markElement.getBoundingClientRect();
    const halfTooltipWidth = Math.min(
      TOOLTIP_MAX_WIDTH / 2,
      Math.max(window.innerWidth / 2 - VIEWPORT_PADDING, 0),
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

  const showTooltip = () => {
    updateTooltipPosition();
    setIsTooltipVisible(true);
  };
  const hideTooltip = () => setIsTooltipVisible(false);

  return (
    <mark
      ref={markRef}
      className="ai-mark"
      tabIndex={0}
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
      aria-describedby={isTooltipVisible ? tooltipId : undefined}
      aria-label={`Suggested wording: ${suggestion}. You said: ${saidText}. ${reason}`}
    >
      {suggestion}
      {isTooltipVisible &&
        createPortal(
          <span
            id={tooltipId}
            className="word-tooltip"
            role="tooltip"
            style={{ left: `${tooltipPosition.left}px`, top: `${tooltipPosition.top}px` }}
          >
            <span className="word-tooltip-row">
              <strong>You said:</strong> {saidText}
            </span>
            <span className="word-tooltip-row">{reason}</span>
          </span>,
          document.body,
        )}
    </mark>
  );
}
