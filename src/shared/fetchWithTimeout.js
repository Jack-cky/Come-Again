const DEFAULT_TIMEOUT_MS = 8000;

// fetch() with an abort-based timeout so a hung public API cannot stall the
// UI indefinitely. Shared by every service that calls an external endpoint.
export default async function fetchWithTimeout(url, { timeoutMs = DEFAULT_TIMEOUT_MS, ...options } = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}
