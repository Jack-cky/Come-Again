# Known Issues

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
