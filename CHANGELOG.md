# Changelog

## [1.0.2] - 2026-07-05

Broader speaking-practice polish with better playback handling and a refreshed interface.

### Added
- Added Tatoeba passage source with offline fallbacks.
- Added dictionary audio for English words and a shared Web Audio path for iOS replay.
- Added saved video replay, transcript download, and burned-in captions for Mirror Practice.
- Added post-take delivery metrics to Mirror Practice: speaking pace with per-language targets, long pauses, clarity, and vocal variety, plus a coach tip built from the weakest metric.
- Added a local Mirror Practice take history so each take shows its pace change against the previous take in the same language.
- Added a compact app header, clearer mode tabs, a how-it-works strip, and a sticky recorder dock.

### Changed
- Redesigned Mirror Practice captions as per-line chips with matching live and burned-in geometry.
- Removed the gap between stacked Mirror Practice caption lines in both the live overlay and the burned-in recording.
- Reworked Mirror Practice captions to roll up like YouTube subtitles in a fixed-width box.
- Updated sentence-practice analysis so Japanese homophones match by pronunciation while kuromoji loads.
- Reworked transcript analysis for more accurate word-level and character-level matching across languages.
- Expanded the sentence-practice flow with clearer states, guidance, and practice metrics.
- Refreshed the global styling and tightened layout across both practice modes.
- Updated the runtime and deployment settings for the current workflow.
- Surfaced passage sources as quick-load chips instead of a dropdown.
- Highlighted accuracy with a progress bar and visible captions instead of hover tooltips.
- Reworked Mirror Practice around a camera stage and a slim checklist panel.

### Fixed
- Improved audio session handling so playback disrupts recording less often on iOS browsers.

## [1.0.1] - 2026-06-18

Initial repository.
