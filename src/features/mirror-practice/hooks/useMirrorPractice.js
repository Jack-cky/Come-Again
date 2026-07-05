import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useIntervalTicker from "../../../shared/hooks/useIntervalTicker";
import {
  createConfiguredRecognition,
  FATAL_RECOGNITION_ERRORS,
  formatTime,
  getSpeechRecognitionClass,
  NON_BLOCKING_RECOGNITION_ERRORS,
} from "../../../shared/speechRecognition";
import { appendCaptionText, buildCaptionLines } from "../utils/captionLines";
import { AUDIO_FRAME_INTERVAL_MS, computeTakeMetrics, measureAudioFrame } from "../utils/takeMetrics";
import { findLatestTakeForLanguage, loadTakeHistory, saveTakeToHistory } from "../utils/takeHistory";

const DEFAULT_CAPTION_TEXT = "Your live transcript appears here whilst you speak.";
const PREFERRED_VIDEO_MIME_TYPES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4",
];
const DEFAULT_VIDEO_WIDTH = 1280;
const DEFAULT_VIDEO_HEIGHT = 720;
const COMPOSED_FRAME_RATE = 30;
const FINAL_SUBTITLE_HOLD_MS = 5200;
const INTERIM_SUBTITLE_THROTTLE_MS = 600;

function isDesktopChromeOrEdgeBrowser() {
  if (typeof navigator === "undefined") {
    return false;
  }

  const userAgent = navigator.userAgent;
  const isMobileDevice =
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isChromeOrEdge = /\b(Chrome|Edg)\/\d+/i.test(userAgent) && !/\b(OPR|Opera)\//i.test(userAgent);

  return !isMobileDevice && isChromeOrEdge;
}

function getSupportedVideoMimeType(MediaRecorderClass) {
  if (typeof MediaRecorderClass?.isTypeSupported !== "function") {
    return "";
  }

  return PREFERRED_VIDEO_MIME_TYPES.find((mimeType) => MediaRecorderClass.isTypeSupported(mimeType)) ?? "";
}

function getFileExtensionFromMimeType(mimeType) {
  return mimeType.includes("mp4") ? "mp4" : "webm";
}

function formatTimestampForFileName(date) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function getTimestampedRecordingFileName(mimeType) {
  return `${formatTimestampForFileName(new Date())}.${getFileExtensionFromMimeType(mimeType)}`;
}

function getTranscriptFileName(recordingFileName) {
  const baseName = recordingFileName.replace(/\.[^.]+$/, "") || formatTimestampForFileName(new Date());
  return `${baseName}.txt`;
}

function getStartErrorMessage(error) {
  if (!(error instanceof Error)) {
    return "Unable to start your session. Check camera and microphone permissions, then try again.";
  }

  if (error.name === "NotAllowedError") {
    return "Camera and microphone access was blocked. Allow both permissions, then try again.";
  }

  if (error.name === "NotFoundError") {
    return "No camera or microphone was found on this device.";
  }

  if (error.name === "NotReadableError") {
    return "The camera or microphone is already in use by another application.";
  }

  return "Unable to start your session. Check camera and microphone permissions, then try again.";
}

function waitForVideoReady(videoElement) {
  if (videoElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const handleLoadedData = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error("video-source-unavailable"));
    };
    const cleanup = () => {
      videoElement.removeEventListener("loadeddata", handleLoadedData);
      videoElement.removeEventListener("error", handleError);
    };

    videoElement.addEventListener("loadeddata", handleLoadedData, { once: true });
    videoElement.addEventListener("error", handleError, { once: true });
  });
}

function getCanvasDimensions(stream) {
  const videoTrack = stream.getVideoTracks()[0];
  const trackSettings = typeof videoTrack?.getSettings === "function" ? videoTrack.getSettings() : null;

  return {
    width: trackSettings?.width || DEFAULT_VIDEO_WIDTH,
    height: trackSettings?.height || DEFAULT_VIDEO_HEIGHT,
  };
}

function drawRoundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

export default function useMirrorPractice(defaultLanguage) {
  const recognitionClass = useMemo(() => getSpeechRecognitionClass(), []);
  const isSupportedDesktopBrowser = useMemo(() => isDesktopChromeOrEdgeBrowser(), []);
  const isSupported = useMemo(() => {
    if (
      !isSupportedDesktopBrowser ||
      !recognitionClass ||
      typeof window === "undefined" ||
      typeof navigator === "undefined"
    ) {
      return false;
    }

    return (
      Boolean(navigator.mediaDevices?.getUserMedia) &&
      typeof window.MediaRecorder !== "undefined" &&
      typeof HTMLCanvasElement !== "undefined" &&
      typeof HTMLCanvasElement.prototype.captureStream === "function"
    );
  }, [isSupportedDesktopBrowser, recognitionClass]);
  const unsupportedMessage = useMemo(() => {
    if (isSupported) {
      return "";
    }

    if (!isSupportedDesktopBrowser) {
      return "Mirror practice is available in desktop Chrome or Edge only. The sentence practice page still works on iPhone and iPad.";
    }

    if (!recognitionClass) {
      return "Live transcription is unavailable in this browser. Open mirror practice in the latest desktop Chrome or Edge.";
    }

    if (typeof navigator !== "undefined" && !navigator.mediaDevices?.getUserMedia) {
      return "Camera or microphone access is unavailable in this browser.";
    }

    if (typeof window !== "undefined" && typeof window.MediaRecorder === "undefined") {
      return "Video recording is unavailable in this browser.";
    }

    if (
      typeof HTMLCanvasElement !== "undefined" &&
      typeof HTMLCanvasElement.prototype.captureStream !== "function"
    ) {
      return "This browser cannot embed captions in the recorded clip.";
    }

    return "Mirror practice is unavailable in this environment.";
  }, [isSupportedDesktopBrowser, isSupported, recognitionClass]);

  const [selectedLanguage, setSelectedLanguage] = useState(defaultLanguage);
  const [captionLines, setCaptionLines] = useState([DEFAULT_CAPTION_TEXT]);
  // Matches the stage <video> elements to the real camera frame so nothing is
  // cropped and the burned-in captions replay exactly where the live ones were.
  const [stageAspectRatio, setStageAspectRatio] = useState(DEFAULT_VIDEO_WIDTH / DEFAULT_VIDEO_HEIGHT);
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedTime, setElapsedTime] = useState("00:00");
  const [errorMessage, setErrorMessage] = useState("");
  const [hasRecording, setHasRecording] = useState(false);
  const [hasCompletedTake, setHasCompletedTake] = useState(false);
  const [recordingUrl, setRecordingUrl] = useState("");
  const [downloadFileName, setDownloadFileName] = useState("");
  const [transcriptEntries, setTranscriptEntries] = useState([]);
  const [takeMetrics, setTakeMetrics] = useState(null);
  const [previousTakeMetrics, setPreviousTakeMetrics] = useState(null);

  const previewVideoRef = useRef(null);
  const recognitionRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const sourceVideoRef = useRef(null);
  const recordingCanvasRef = useRef(null);
  const composedStreamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const recordingMimeTypeRef = useRef("");
  const currentRecordingUrlRef = useRef("");
  const restartTimeoutRef = useRef(null);
  const renderFrameIdRef = useRef(0);
  const subtitleClearTimeoutRef = useRef(null);
  const interimSubtitleFlushTimeoutRef = useRef(null);
  const sessionStartMsRef = useRef(0);
  const userStoppedRecognitionRef = useRef(false);
  const isSessionActiveRef = useRef(false);
  const interimSubtitleRef = useRef("");
  const pendingInterimSubtitleRef = useRef("");
  const lastInterimSubtitlePaintAtRef = useRef(0);
  // Rolling caption source: recent recognised text with committed line breaks
  // ("\n"). Trimmed to the visible lines after every final result so it never
  // grows unbounded and already-shown words never re-wrap.
  const captionBufferRef = useRef("");
  // Mirror of the captionLines state for the canvas render loop.
  const captionLinesRef = useRef([]);
  // Mirror of the transcriptEntries state so stopSession can compute take
  // metrics synchronously without waiting for a state flush.
  const transcriptEntriesRef = useRef([]);
  // Live audio analysis: { audioContext, sourceNode, intervalId }.
  const audioAnalysisRef = useRef(null);
  // One { rms, pitchHz } sample per AUDIO_FRAME_INTERVAL_MS across the take.
  const audioFramesRef = useRef([]);
  // The language recognition was started with. Metrics and history must use
  // this rather than selectedLanguage: the select stays enabled until
  // isRecording flips, and depending on selectedLanguage in stopSession would
  // recreate the recognition effect mid-start and abort the session.
  const sessionLanguageRef = useRef(defaultLanguage);
  // Set by the error paths that end a take (recorder failure, fatal
  // recognition error) so stopSession skips saving a broken take to history.
  const sessionFailedRef = useRef(false);

  const attachPreviewStream = useCallback((stream) => {
    const video = previewVideoRef.current;

    if (!video) {
      return;
    }

    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    video.play().catch(() => undefined);
  }, []);

  const clearPreviewStream = useCallback(() => {
    const video = previewVideoRef.current;

    if (!video) {
      return;
    }

    video.pause();
    video.srcObject = null;
    video.removeAttribute("src");
    video.load();
  }, []);

  const revokeRecordingUrl = useCallback(() => {
    if (currentRecordingUrlRef.current) {
      URL.revokeObjectURL(currentRecordingUrlRef.current);
      currentRecordingUrlRef.current = "";
    }

    setRecordingUrl("");
    setDownloadFileName("");
  }, []);

  const clearRecognitionRestart = useCallback(() => {
    if (restartTimeoutRef.current) {
      window.clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }
  }, []);

  const clearSubtitleHideTimer = useCallback(() => {
    if (subtitleClearTimeoutRef.current) {
      window.clearTimeout(subtitleClearTimeoutRef.current);
      subtitleClearTimeoutRef.current = null;
    }
  }, []);

  const clearInterimSubtitleFlushTimer = useCallback(() => {
    if (interimSubtitleFlushTimeoutRef.current) {
      window.clearTimeout(interimSubtitleFlushTimeoutRef.current);
      interimSubtitleFlushTimeoutRef.current = null;
    }
  }, []);

  const applyCaptionLines = useCallback((lines) => {
    captionLinesRef.current = lines;
    setCaptionLines(lines);
  }, []);

  const commitInterimSubtitle = useCallback(
    (subtitleText) => {
      clearInterimSubtitleFlushTimer();
      pendingInterimSubtitleRef.current = "";
      interimSubtitleRef.current = subtitleText;
      lastInterimSubtitlePaintAtRef.current = subtitleText ? Date.now() : 0;
      applyCaptionLines(buildCaptionLines(appendCaptionText(captionBufferRef.current, subtitleText)));
    },
    [applyCaptionLines, clearInterimSubtitleFlushTimer],
  );

  const showInterimSubtitle = useCallback(
    (subtitleText) => {
      clearSubtitleHideTimer();

      if (!subtitleText) {
        commitInterimSubtitle("");
        return;
      }

      if (subtitleText === interimSubtitleRef.current || subtitleText === pendingInterimSubtitleRef.current) {
        return;
      }

      const elapsedSinceLastPaint = Date.now() - lastInterimSubtitlePaintAtRef.current;

      if (!interimSubtitleRef.current || elapsedSinceLastPaint >= INTERIM_SUBTITLE_THROTTLE_MS) {
        commitInterimSubtitle(subtitleText);
        return;
      }

      pendingInterimSubtitleRef.current = subtitleText;

      if (interimSubtitleFlushTimeoutRef.current) {
        return;
      }

      interimSubtitleFlushTimeoutRef.current = window.setTimeout(() => {
        interimSubtitleFlushTimeoutRef.current = null;

        if (!pendingInterimSubtitleRef.current) {
          return;
        }

        commitInterimSubtitle(pendingInterimSubtitleRef.current);
      }, INTERIM_SUBTITLE_THROTTLE_MS - elapsedSinceLastPaint);
    },
    [clearSubtitleHideTimer, commitInterimSubtitle],
  );

  const showSubtitleThenHide = useCallback(
    (lines) => {
      clearSubtitleHideTimer();
      applyCaptionLines(lines);

      if (!lines.length) {
        return;
      }

      subtitleClearTimeoutRef.current = window.setTimeout(() => {
        // After the hold expires the caption disappears; the next utterance
        // starts a fresh roll-up instead of pulling old words back on screen.
        captionBufferRef.current = "";
        applyCaptionLines([]);
        subtitleClearTimeoutRef.current = null;
      }, FINAL_SUBTITLE_HOLD_MS);
    },
    [applyCaptionLines, clearSubtitleHideTimer],
  );

  const updateElapsed = useCallback(() => {
    if (!sessionStartMsRef.current) {
      setElapsedTime("00:00");
      return;
    }

    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - sessionStartMsRef.current) / 1000));
    setElapsedTime(formatTime(elapsedSeconds));
  }, []);

  const { start: startElapsedTimer, stop: stopElapsedTimer } = useIntervalTicker(updateElapsed);

  const stopCanvasRenderer = useCallback(() => {
    if (renderFrameIdRef.current) {
      window.cancelAnimationFrame(renderFrameIdRef.current);
      renderFrameIdRef.current = 0;
    }
  }, []);

  const releaseCompositionResources = useCallback(() => {
    stopCanvasRenderer();

    if (composedStreamRef.current) {
      composedStreamRef.current.getTracks().forEach((track) => track.stop());
      composedStreamRef.current = null;
    }

    if (sourceVideoRef.current) {
      sourceVideoRef.current.pause();
      sourceVideoRef.current.srcObject = null;
      sourceVideoRef.current = null;
    }

    recordingCanvasRef.current = null;
  }, [stopCanvasRenderer]);

  const stopAudioAnalysis = useCallback(() => {
    const analysis = audioAnalysisRef.current;

    if (!analysis) {
      return;
    }

    window.clearInterval(analysis.intervalId);

    try {
      analysis.sourceNode.disconnect();
    } catch {
      // The node may already be disconnected if the stream ended first.
    }

    analysis.audioContext.close().catch(() => undefined);
    audioAnalysisRef.current = null;
  }, []);

  // Taps the microphone track for loudness and pitch samples that feed the
  // post-take delivery metrics. Best-effort: a failure here must never block
  // the recording itself.
  const startAudioAnalysis = useCallback(
    (stream) => {
      stopAudioAnalysis();

      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;

        if (!AudioContextClass) {
          return;
        }

        const audioContext = new AudioContextClass();
        const sourceNode = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        sourceNode.connect(analyser);

        const sampleBuffer = new Float32Array(analyser.fftSize);
        const intervalId = window.setInterval(() => {
          analyser.getFloatTimeDomainData(sampleBuffer);
          audioFramesRef.current.push(measureAudioFrame(sampleBuffer, audioContext.sampleRate));
        }, AUDIO_FRAME_INTERVAL_MS);

        audioAnalysisRef.current = { audioContext, sourceNode, intervalId };
      } catch {
        audioAnalysisRef.current = null;
      }
    },
    [stopAudioAnalysis],
  );

  // Analysis samples the microphone track, so it must never outlive the
  // stream; folding the teardown in here keeps every release path covered.
  const releaseMediaStream = useCallback(() => {
    stopAudioAnalysis();

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    releaseCompositionResources();
    clearPreviewStream();
  }, [clearPreviewStream, releaseCompositionResources, stopAudioAnalysis]);

  const releaseMediaStreamIfRecorderInactive = useCallback(() => {
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === "inactive") {
      releaseMediaStream();
    }
  }, [releaseMediaStream]);

  const safelyStopRecognition = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch {
      // Ignore InvalidStateError when recognition is already stopped.
    }
  }, []);

  const getBurnedSubtitleLines = useCallback(() => captionLinesRef.current, []);

  const appendTranscriptText = useCallback((textToAppend, confidence) => {
    const trimmedText = textToAppend?.trim();

    if (!trimmedText) {
      return;
    }

    const elapsedSeconds = sessionStartMsRef.current
      ? Math.max(0, Math.floor((Date.now() - sessionStartMsRef.current) / 1000))
      : 0;

    transcriptEntriesRef.current = [
      ...transcriptEntriesRef.current,
      {
        time: elapsedSeconds,
        text: trimmedText,
        confidence: typeof confidence === "number" ? confidence : null,
      },
    ];
    setTranscriptEntries(transcriptEntriesRef.current);
  }, []);

  const downloadTranscript = useCallback(() => {
    if (!transcriptEntries.length || typeof document === "undefined") {
      return;
    }

    const transcriptLines = transcriptEntries.map((entry) => `[${formatTime(entry.time)}] ${entry.text}`);
    const transcriptBlob = new Blob([`${transcriptLines.join("\n")}\n`], {
      type: "text/plain;charset=utf-8",
    });
    const transcriptUrl = URL.createObjectURL(transcriptBlob);
    const downloadLink = document.createElement("a");

    downloadLink.href = transcriptUrl;
    downloadLink.download = getTranscriptFileName(
      downloadFileName || getTimestampedRecordingFileName("video/webm"),
    );
    downloadLink.click();
    URL.revokeObjectURL(transcriptUrl);
  }, [downloadFileName, transcriptEntries]);

  // Per-line caption chips, YouTube style: each line's background hugs its
  // text and lines are anchored to a fixed left edge so words fill left to
  // right without anything shifting. All metrics are fractions of the video
  // width and mirror the cqw-based CSS for .camera-subtitle-overlay, so the
  // burned-in captions render identically to the live DOM overlay.
  const drawSubtitleFrame = useCallback((context, width, height, lines) => {
    if (!lines.length) {
      return;
    }

    let fontSize = width * 0.027;
    const maxTextWidth = width * 0.78 - fontSize * 1.2;

    const applyFont = () => {
      context.font = `700 ${fontSize}px Sora, Avenir Next, Segoe UI, sans-serif`;
    };

    context.textAlign = "left";
    context.textBaseline = "middle";
    applyFont();

    // Lines are pre-wrapped by character budget; if a line still overflows the
    // pixel budget (wide glyphs), shrink the font instead of re-wrapping.
    const longestLineWidth = Math.max(...lines.map((line) => context.measureText(line).width));

    if (longestLineWidth > maxTextWidth) {
      fontSize = Math.max(12, fontSize * (maxTextWidth / longestLineWidth));
      applyFont();
    }

    const paddingX = fontSize * 0.6;
    const paddingY = fontSize * 0.35;
    const chipHeight = fontSize * 1.3 + paddingY * 2;
    const chipRadius = fontSize * 0.35;
    const leftX = width * 0.11;
    const totalHeight = lines.length * chipHeight;
    let chipY = height - width * 0.03 - totalHeight;

    for (const line of lines) {
      const chipWidth = Math.ceil(context.measureText(line).width + paddingX * 2);

      drawRoundedRect(context, leftX, chipY, chipWidth, chipHeight, chipRadius);
      context.fillStyle = "rgba(9, 14, 18, 0.74)";
      context.fill();
      context.fillStyle = "#fffaf0";
      context.fillText(line, leftX + paddingX, chipY + chipHeight / 2);
      chipY += chipHeight;
    }
  }, []);

  const startCanvasRenderer = useCallback(() => {
    const canvas = recordingCanvasRef.current;
    const sourceVideo = sourceVideoRef.current;

    if (!canvas || !sourceVideo) {
      return;
    }

    const context = canvas.getContext("2d");

    if (!context) {
      return;
    }

    const renderFrame = () => {
      if (!recordingCanvasRef.current || !sourceVideoRef.current) {
        return;
      }

      context.clearRect(0, 0, canvas.width, canvas.height);

      if (sourceVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        context.drawImage(sourceVideo, 0, 0, canvas.width, canvas.height);
        const subtitleLines = getBurnedSubtitleLines();

        if (subtitleLines.length) {
          drawSubtitleFrame(context, canvas.width, canvas.height, subtitleLines);
        }
      }

      renderFrameIdRef.current = window.requestAnimationFrame(renderFrame);
    };

    renderFrameIdRef.current = window.requestAnimationFrame(renderFrame);
  }, [drawSubtitleFrame, getBurnedSubtitleLines]);

  const stopSession = useCallback(() => {
    const wasActiveTake = isSessionActiveRef.current;

    clearRecognitionRestart();
    clearSubtitleHideTimer();
    clearInterimSubtitleFlushTimer();
    userStoppedRecognitionRef.current = true;
    isSessionActiveRef.current = false;
    setIsRecording(false);
    setHasCompletedTake(true);
    applyCaptionLines([]);
    captionBufferRef.current = "";
    interimSubtitleRef.current = "";
    pendingInterimSubtitleRef.current = "";
    lastInterimSubtitlePaintAtRef.current = 0;
    safelyStopRecognition();
    stopAudioAnalysis();

    // Compute and persist metrics once per take, and only for takes the user
    // ended themselves — error-terminated takes would pollute the
    // "vs last take" baseline, and a second stopSession call for the same
    // take (recorder error after a fatal recognition error) must not save a
    // duplicate history entry.
    if (wasActiveTake && !sessionFailedRef.current) {
      const summary = computeTakeMetrics({
        transcriptEntries: transcriptEntriesRef.current,
        languageCode: sessionLanguageRef.current,
        audioFrames: audioFramesRef.current,
        fallbackDurationSeconds: sessionStartMsRef.current
          ? (Date.now() - sessionStartMsRef.current) / 1000
          : 0,
      });

      if (summary) {
        const history = loadTakeHistory();
        setPreviousTakeMetrics(findLatestTakeForLanguage(history, sessionLanguageRef.current));
        saveTakeToHistory(summary, history);
      }

      setTakeMetrics(summary);
    }

    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }

    releaseMediaStreamIfRecorderInactive();
    stopElapsedTimer();
  }, [
    applyCaptionLines,
    clearRecognitionRestart,
    clearInterimSubtitleFlushTimer,
    clearSubtitleHideTimer,
    releaseMediaStreamIfRecorderInactive,
    safelyStopRecognition,
    stopAudioAnalysis,
    stopElapsedTimer,
  ]);

  const resetSession = useCallback(() => {
    if (isRecording) {
      return;
    }

    clearRecognitionRestart();
    clearSubtitleHideTimer();
    clearInterimSubtitleFlushTimer();
    userStoppedRecognitionRef.current = true;
    isSessionActiveRef.current = false;
    safelyStopRecognition();
    releaseMediaStream();
    stopElapsedTimer();
    sessionStartMsRef.current = 0;
    recordedChunksRef.current = [];
    recordingMimeTypeRef.current = "";
    interimSubtitleRef.current = "";
    pendingInterimSubtitleRef.current = "";
    lastInterimSubtitlePaintAtRef.current = 0;
    captionBufferRef.current = "";
    captionLinesRef.current = [];
    transcriptEntriesRef.current = [];
    audioFramesRef.current = [];
    setTranscriptEntries([]);
    setTakeMetrics(null);
    setPreviousTakeMetrics(null);
    setCaptionLines([DEFAULT_CAPTION_TEXT]);
    setElapsedTime("00:00");
    setErrorMessage("");
    setHasRecording(false);
    setHasCompletedTake(false);
    revokeRecordingUrl();
  }, [
    clearRecognitionRestart,
    clearInterimSubtitleFlushTimer,
    clearSubtitleHideTimer,
    isRecording,
    releaseMediaStream,
    revokeRecordingUrl,
    safelyStopRecognition,
    stopElapsedTimer,
  ]);

  const startSession = useCallback(async () => {
    if (!isSupported || !recognitionRef.current || isRecording || hasCompletedTake) {
      return;
    }

    clearRecognitionRestart();
    clearSubtitleHideTimer();
    clearInterimSubtitleFlushTimer();
    userStoppedRecognitionRef.current = false;
    isSessionActiveRef.current = true;
    sessionFailedRef.current = false;
    sessionLanguageRef.current = selectedLanguage;
    sessionStartMsRef.current = Date.now();
    recordedChunksRef.current = [];
    recordingMimeTypeRef.current = "";
    interimSubtitleRef.current = "";
    pendingInterimSubtitleRef.current = "";
    lastInterimSubtitlePaintAtRef.current = 0;
    captionBufferRef.current = "";
    transcriptEntriesRef.current = [];
    audioFramesRef.current = [];
    applyCaptionLines([]);
    setTranscriptEntries([]);
    setTakeMetrics(null);
    setPreviousTakeMetrics(null);
    setErrorMessage("");
    setElapsedTime("00:00");
    setHasRecording(false);
    setHasCompletedTake(false);
    revokeRecordingUrl();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: {
          facingMode: "user",
          width: { ideal: DEFAULT_VIDEO_WIDTH },
          height: { ideal: DEFAULT_VIDEO_HEIGHT },
        },
      });

      if (!isSessionActiveRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      mediaStreamRef.current = stream;
      attachPreviewStream(stream);
      startAudioAnalysis(stream);

      const sourceVideo = document.createElement("video");
      sourceVideo.muted = true;
      sourceVideo.playsInline = true;
      sourceVideo.srcObject = stream;
      sourceVideoRef.current = sourceVideo;
      await sourceVideo.play();
      await waitForVideoReady(sourceVideo);

      if (!isSessionActiveRef.current) {
        // Stop was pressed while we were waiting on the video element; the
        // concurrent stopSession() call may have already released
        // mediaStreamRef, so clean up defensively (both calls are idempotent)
        // instead of continuing to start recognition/MediaRecorder.
        sourceVideo.pause();
        sourceVideo.srcObject = null;
        stopAudioAnalysis();
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const { width, height } = getCanvasDimensions(stream);
      setStageAspectRatio(width / height);
      const recordingCanvas = document.createElement("canvas");
      recordingCanvas.width = width;
      recordingCanvas.height = height;
      recordingCanvasRef.current = recordingCanvas;
      startCanvasRenderer();

      const canvasStream = recordingCanvas.captureStream(COMPOSED_FRAME_RATE);
      const microphoneTrack = stream.getAudioTracks()[0];

      if (!microphoneTrack) {
        throw new Error("microphone-track-unavailable");
      }

      const composedStream = new MediaStream([...canvasStream.getVideoTracks(), microphoneTrack.clone()]);
      composedStreamRef.current = composedStream;

      const MediaRecorderClass = window.MediaRecorder;
      const preferredMimeType = getSupportedVideoMimeType(MediaRecorderClass);
      recordingMimeTypeRef.current = preferredMimeType;

      mediaRecorderRef.current = preferredMimeType
        ? new MediaRecorderClass(composedStream, { mimeType: preferredMimeType })
        : new MediaRecorderClass(composedStream);
      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };
      mediaRecorderRef.current.onerror = () => {
        sessionFailedRef.current = true;
        setErrorMessage("Video recording failed. Please try again.");
        stopSession();
      };
      mediaRecorderRef.current.onstop = () => {
        const blobType =
          recordedChunksRef.current.find((chunk) => chunk.type)?.type ?? recordingMimeTypeRef.current;

        if (!recordedChunksRef.current.length) {
          setHasRecording(false);
          mediaRecorderRef.current = null;
          releaseMediaStream();
          return;
        }

        const videoBlob = blobType
          ? new Blob(recordedChunksRef.current, { type: blobType })
          : new Blob(recordedChunksRef.current);
        const nextRecordingUrl = URL.createObjectURL(videoBlob);

        currentRecordingUrlRef.current = nextRecordingUrl;
        setRecordingUrl(nextRecordingUrl);
        setDownloadFileName(getTimestampedRecordingFileName(videoBlob.type || blobType || "video/webm"));
        setHasRecording(true);
        mediaRecorderRef.current = null;
        releaseMediaStream();
      };

      recognitionRef.current.lang = selectedLanguage;
      recognitionRef.current.start();
      mediaRecorderRef.current.start(250);
      setIsRecording(true);
      startElapsedTimer();
      updateElapsed();
    } catch (error) {
      isSessionActiveRef.current = false;
      userStoppedRecognitionRef.current = true;
      setIsRecording(false);
      captionLinesRef.current = [];
      setCaptionLines([DEFAULT_CAPTION_TEXT]);
      setHasRecording(false);
      mediaRecorderRef.current = null;
      releaseMediaStream();
      stopElapsedTimer();
      setErrorMessage(getStartErrorMessage(error));
      safelyStopRecognition();
    }
  }, [
    applyCaptionLines,
    attachPreviewStream,
    clearRecognitionRestart,
    clearInterimSubtitleFlushTimer,
    clearSubtitleHideTimer,
    hasCompletedTake,
    isRecording,
    isSupported,
    releaseMediaStream,
    revokeRecordingUrl,
    safelyStopRecognition,
    selectedLanguage,
    startAudioAnalysis,
    startCanvasRenderer,
    startElapsedTimer,
    stopAudioAnalysis,
    stopElapsedTimer,
    stopSession,
    updateElapsed,
  ]);

  useEffect(() => {
    if (!isSupported) {
      return undefined;
    }

    const recognition = createConfiguredRecognition(recognitionClass);
    recognitionRef.current = recognition;

    recognition.onresult = (event) => {
      // Results finalised after Stop are ignored so the downloaded transcript
      // always matches the metrics computed at the moment the take ended.
      if (userStoppedRecognitionRef.current) {
        return;
      }

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result[0]?.transcript ?? "";

        if (result.isFinal) {
          appendTranscriptText(transcript, result[0]?.confidence);
          clearInterimSubtitleFlushTimer();
          interimSubtitleRef.current = "";
          pendingInterimSubtitleRef.current = "";
          lastInterimSubtitlePaintAtRef.current = 0;
          captionBufferRef.current = appendCaptionText(captionBufferRef.current, transcript);
          const nextCaptionLines = buildCaptionLines(captionBufferRef.current);
          // Keep only the visible lines (with their breaks committed) so the
          // buffer stays small and existing lines never re-wrap.
          captionBufferRef.current = nextCaptionLines.join("\n");
          showSubtitleThenHide(nextCaptionLines);
        } else {
          showInterimSubtitle(transcript.trim());
        }
      }
    };

    recognition.onerror = (event) => {
      if (userStoppedRecognitionRef.current) {
        return;
      }

      if (NON_BLOCKING_RECOGNITION_ERRORS.has(event.error)) {
        clearInterimSubtitleFlushTimer();
        interimSubtitleRef.current = "";
        pendingInterimSubtitleRef.current = "";
        lastInterimSubtitlePaintAtRef.current = 0;
        showSubtitleThenHide(buildCaptionLines(captionBufferRef.current));
        return;
      }

      setErrorMessage(`Recognition error: ${event.error}. Your session has ended.`);

      if (FATAL_RECOGNITION_ERRORS.has(event.error)) {
        sessionFailedRef.current = true;
        stopSession();
      }
    };

    recognition.onend = () => {
      if (!userStoppedRecognitionRef.current && isSessionActiveRef.current) {
        clearRecognitionRestart();
        restartTimeoutRef.current = window.setTimeout(() => {
          if (
            userStoppedRecognitionRef.current ||
            recognitionRef.current !== recognition ||
            !isSessionActiveRef.current
          ) {
            return;
          }

          try {
            recognition.start();
          } catch {
            sessionFailedRef.current = true;
            setErrorMessage("Live transcription stopped unexpectedly. Your session has ended.");
            stopSession();
          }
        }, 250);
      }
    };

    return () => {
      clearRecognitionRestart();
      clearSubtitleHideTimer();
      clearInterimSubtitleFlushTimer();
      userStoppedRecognitionRef.current = true;
      isSessionActiveRef.current = false;
      safelyStopRecognition();
      recognitionRef.current = null;
    };
  }, [
    appendTranscriptText,
    clearRecognitionRestart,
    clearInterimSubtitleFlushTimer,
    clearSubtitleHideTimer,
    isSupported,
    recognitionClass,
    showInterimSubtitle,
    safelyStopRecognition,
    showSubtitleThenHide,
    stopSession,
  ]);

  useEffect(() => {
    return () => {
      clearRecognitionRestart();
      clearSubtitleHideTimer();
      clearInterimSubtitleFlushTimer();
      userStoppedRecognitionRef.current = true;
      isSessionActiveRef.current = false;

      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }

      releaseMediaStream();
      stopElapsedTimer();
      revokeRecordingUrl();
    };
  }, [
    clearRecognitionRestart,
    clearInterimSubtitleFlushTimer,
    clearSubtitleHideTimer,
    releaseMediaStream,
    revokeRecordingUrl,
    stopElapsedTimer,
  ]);

  return {
    isSupported,
    unsupportedMessage,
    selectedLanguage,
    setSelectedLanguage,
    captionLines,
    stageAspectRatio,
    isRecording,
    elapsedTime,
    errorMessage,
    hasRecording,
    hasCompletedTake,
    recordingUrl,
    downloadFileName,
    transcriptEntries,
    takeMetrics,
    previousTakeMetrics,
    previewVideoRef,
    startSession,
    stopSession,
    resetSession,
    downloadTranscript,
  };
}
