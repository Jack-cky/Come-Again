const STORAGE_KEY = "come-again.mirror-take-history";
const MAX_STORED_TAKES = 20;

// Guards every consumer against corrupt writes and older schema shapes: an
// entry with a missing or non-numeric paceValue would otherwise surface as
// "NaN wpm vs your last take" in the delta line.
function isValidStoredTake(entry) {
  return (
    Boolean(entry) &&
    typeof entry === "object" &&
    typeof entry.languageCode === "string" &&
    typeof entry.paceUnit === "string" &&
    Number.isFinite(entry.paceValue)
  );
}

export function loadTakeHistory() {
  if (typeof localStorage === "undefined") {
    return [];
  }

  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isValidStoredTake) : [];
  } catch {
    return [];
  }
}

export function findLatestTakeForLanguage(history, languageCode) {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index]?.languageCode === languageCode) {
      return history[index];
    }
  }

  return null;
}

export function saveTakeToHistory(summary, history = loadTakeHistory()) {
  if (typeof localStorage === "undefined") {
    return;
  }

  try {
    const nextHistory = [...history, summary].slice(-MAX_STORED_TAKES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextHistory));
  } catch {
    // Storage may be full or blocked; take history is best-effort.
  }
}
