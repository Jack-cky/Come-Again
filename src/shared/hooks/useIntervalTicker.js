import { useCallback, useEffect, useRef } from "react";

// Runs `onTick` on an interval while started, plus once more on stop so the
// final value is flushed — the shared pattern behind both practice modes'
// session timers. The latest callback is always used without restarting the
// interval, and the interval is cleared automatically on unmount.
export default function useIntervalTicker(onTick, intervalMs = 500) {
  const intervalRef = useRef(null);
  const onTickRef = useRef(onTick);

  useEffect(() => {
    onTickRef.current = onTick;
  }, [onTick]);

  const start = useCallback(() => {
    if (intervalRef.current) {
      return;
    }

    intervalRef.current = window.setInterval(() => {
      onTickRef.current();
    }, intervalMs);
  }, [intervalMs]);

  const stop = useCallback(() => {
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    onTickRef.current();
  }, []);

  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  return { start, stop };
}
