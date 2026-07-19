# Known Issues

## Gemini key visibility on GitHub Pages

### Description
The AI corrections feature can use a Gemini free-tier API key, but a static site cannot keep a secret: anything baked into the bundle at build time is readable in devtools. The supported setup is therefore the Cloudflare Worker proxy in `worker/` (`VITE_GEMINI_PROXY_URL`), which keeps the key server-side. The direct-key mode (`VITE_GEMINI_API_KEY`) remains for local development and very limited free-tier use only.

### Affected Areas
- The "AI corrections" button in the transcript review.

### Symptoms
- In direct-key mode, the key string is present in `dist/assets/*.js` when the build had the variable set.
- In proxy mode, no key ships; a scripted client that spoofs the `Origin` header could still spend quota through the proxy.

### Workarounds
- Use the Worker proxy for any deployed build (see `worker/README.md`), and rotate the key if a previous deploy shipped it directly.
- If you stay on the free tier, treat it as a capped development allowance: keep calls sparse, expect daily quota limits, and avoid relying on it for regular production use.
- Keep the key on the free tier with no billing attached, so the worst case is exhausted quota, never a bill.
- If quota abuse appears through the proxy, add rate limiting in the Worker (KV counter or a Cloudflare rate-limiting rule).

### Status
- Mitigated by the Worker proxy; direct-key mode stays a local-development convenience, with only limited free-tier usage tolerated.

## Mirror Practice on iPad

### Description
Mirror Practice is not supported on iPad because all iPad browsers use WebKit, and the feature depends on fragile APIs that do not hold together reliably there.

### Affected Areas
- Live captions via SpeechRecognition.
- Concurrent microphone, camera, and playback audio handling.
- Burned-in caption recording via canvas.captureStream() and MediaRecorder.

### Symptoms
- The camera preview may appear, but live captions fail or the recording ends up empty, silent, or unreliable.
- Switching to Chrome or Edge on iPad does not help, because they still run on WebKit.

### Workarounds
- Use Sentence Practice on iPad instead.
- Use a desktop browser based on Blink, such as Chrome or Edge, for Mirror Practice.

### Status
- Unsupported by design on iPadOS and iPad browsers.

## Japanese Homophones

### Description
The app scores how a phrase sounds, not which kanji the recogniser selects. Some Japanese homophones therefore count as the same spoken answer. For example, 見方 and 味方 are both read みかた, so they are indistinguishable by pronunciation.

### Affected Areas
- Sentence practice pronunciation scoring.
- Transcript feedback when the recogniser chooses a different kanji for the same sound.

### Symptoms
- The recognised text may show a different kanji from the prompt even when the spoken pronunciation is correct.
- The same spoken phrase can be matched against more than one written form when they are homophones.

### Workarounds
- None required. Accepting homophones is the intended behaviour.

### Status
- No change needed.
