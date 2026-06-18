import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FATAL_RECOGNITION_ERRORS,
  formatTime,
  getSpeechRecognitionClass,
  NON_BLOCKING_RECOGNITION_ERRORS,
} from "../../../shared/speechRecognition";

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
const SUBTITLE_MAX_WORDS = 14;
const SUBTITLE_MAX_CHARS = 96;
const SUBTITLE_MAX_UNBROKEN_CHARS = 42;

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

function normalizeSubtitleText(text) {
  return text.trim().replace(/\s+/g, " ");
}

function getYouTubeStyleSubtitleText(text) {
  const normalizedText = normalizeSubtitleText(text);

  if (!normalizedText) {
    return "";
  }

  const words = normalizedText.split(" ");

  if (words.length === 1) {
    return normalizedText.slice(-SUBTITLE_MAX_UNBROKEN_CHARS);
  }

  let subtitleWords = words.slice(-SUBTITLE_MAX_WORDS);

  while (subtitleWords.join(" ").length > SUBTITLE_MAX_CHARS && subtitleWords.length > 1) {
    subtitleWords = subtitleWords.slice(1);
  }

  return subtitleWords.join(" ");
}

function wrapSubtitleLines(context, text, maxWidth) {
  const words = getYouTubeStyleSubtitleText(text).split(/\s+/).filter(Boolean);

  if (!words.length) {
    return [];
  }

  const lines = [];
  let currentLine = words[0];

  for (let index = 1; index < words.length; index += 1) {
    const nextLine = `${currentLine} ${words[index]}`;

    if (context.measureText(nextLine).width <= maxWidth) {
      currentLine = nextLine;
      continue;
    }

    lines.push(currentLine);

    currentLine = words[index];

    if (lines.length < 2) {
      continue;
    }

    break;
  }

  if (lines.length < 2 && currentLine) {
    lines.push(currentLine);
  }

  return lines.slice(0, 2);
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

    if (typeof HTMLCanvasElement !== "undefined" && typeof HTMLCanvasElement.prototype.captureStream !== "function") {
      return "This browser cannot embed captions in the recorded clip.";
    }

    return "Mirror practice is unavailable in this environment.";
  }, [isSupportedDesktopBrowser, isSupported, recognitionClass]);

  const [selectedLanguage, setSelectedLanguage] = useState(defaultLanguage);
  const [captionText, setCaptionText] = useState(DEFAULT_CAPTION_TEXT);
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedTime, setElapsedTime] = useState("00:00");
  const [errorMessage, setErrorMessage] = useState("");
  const [hasRecording, setHasRecording] = useState(false);
  const [hasCompletedTake, setHasCompletedTake] = useState(false);
  const [recordingUrl, setRecordingUrl] = useState("");
  const [downloadFileName, setDownloadFileName] = useState("");
  const [transcriptText, setTranscriptText] = useState("");

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
  const elapsedTimerRef = useRef(null);
  const renderFrameIdRef = useRef(0);
  const subtitleClearTimeoutRef = useRef(null);
  const interimSubtitleFlushTimeoutRef = useRef(null);
  const sessionStartMsRef = useRef(0);
  const userStoppedRecognitionRef = useRef(false);
  const isSessionActiveRef = useRef(false);
  const interimSubtitleRef = useRef("");
  const pendingInterimSubtitleRef = useRef("");
  const lastInterimSubtitlePaintAtRef = useRef(0);
  const finalSubtitleRef = useRef("");
  const finalSubtitleExpiresAtRef = useRef(0);

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

  const commitInterimSubtitle = useCallback((subtitleText) => {
    clearInterimSubtitleFlushTimer();
    pendingInterimSubtitleRef.current = "";
    interimSubtitleRef.current = subtitleText;
    lastInterimSubtitlePaintAtRef.current = subtitleText ? Date.now() : 0;
    setCaptionText(subtitleText);
  }, [clearInterimSubtitleFlushTimer]);

  const showInterimSubtitle = useCallback((subtitleText) => {
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
  }, [clearSubtitleHideTimer, commitInterimSubtitle]);

  const showSubtitleThenHide = useCallback((subtitleText) => {
    clearSubtitleHideTimer();
    setCaptionText(subtitleText);

    if (!subtitleText) {
      return;
    }

    subtitleClearTimeoutRef.current = window.setTimeout(() => {
      setCaptionText("");
      subtitleClearTimeoutRef.current = null;
    }, FINAL_SUBTITLE_HOLD_MS);
  }, [clearSubtitleHideTimer]);

  const updateElapsed = useCallback(() => {
    if (!sessionStartMsRef.current) {
      setElapsedTime("00:00");
      return;
    }

    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - sessionStartMsRef.current) / 1000));
    setElapsedTime(formatTime(elapsedSeconds));
  }, []);

  const startElapsedTimer = useCallback(() => {
    if (elapsedTimerRef.current) {
      return;
    }

    elapsedTimerRef.current = window.setInterval(() => {
      updateElapsed();
    }, 500);
  }, [updateElapsed]);

  const stopElapsedTimer = useCallback(() => {
    if (elapsedTimerRef.current) {
      window.clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }

    updateElapsed();
  }, [updateElapsed]);

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

  const releaseMediaStream = useCallback(() => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    releaseCompositionResources();
    clearPreviewStream();
  }, [clearPreviewStream, releaseCompositionResources]);

  const releaseMediaStreamIfRecorderInactive = useCallback(() => {
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === "inactive") {
      releaseMediaStream();
    }
  }, [releaseMediaStream]);

  const safelyStopRecognition = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch (error) {
      // Ignore InvalidStateError when recognition is already stopped.
    }
  }, []);

  const getBurnedSubtitleText = useCallback(() => {
    const interimSubtitle = interimSubtitleRef.current.trim();

    if (interimSubtitle) {
      return getYouTubeStyleSubtitleText(interimSubtitle);
    }

    if (finalSubtitleRef.current && Date.now() < finalSubtitleExpiresAtRef.current) {
      return getYouTubeStyleSubtitleText(finalSubtitleRef.current);
    }

    return "";
  }, []);

  const appendTranscriptText = useCallback((textToAppend) => {
    if (!textToAppend?.trim()) {
      return;
    }

    setTranscriptText((previousText) => {
      const needsLeadingSpace = previousText.length > 0 && !previousText.endsWith(" ");
      return `${previousText}${needsLeadingSpace ? " " : ""}${textToAppend.trim()}`;
    });
  }, []);

  const downloadTranscript = useCallback(() => {
    const transcript = transcriptText.trim();

    if (!transcript || typeof document === "undefined") {
      return;
    }

    const transcriptBlob = new Blob([`${transcript}\n`], { type: "text/plain;charset=utf-8" });
    const transcriptUrl = URL.createObjectURL(transcriptBlob);
    const downloadLink = document.createElement("a");

    downloadLink.href = transcriptUrl;
    downloadLink.download = getTranscriptFileName(downloadFileName || getTimestampedRecordingFileName("video/webm"));
    downloadLink.click();
    URL.revokeObjectURL(transcriptUrl);
  }, [downloadFileName, transcriptText]);

  const drawSubtitleFrame = useCallback((context, width, height, subtitleText) => {
    const safePadding = Math.max(24, width * 0.03);
    const maxBoxWidth = Math.min(width - safePadding * 2, width * 0.78);
    const fontSize = Math.max(24, Math.min(34, width * 0.027));
    const lineHeight = Math.round(fontSize * 1.35);
    const horizontalPadding = 20;

    context.font = `700 ${fontSize}px Sora, Avenir Next, Segoe UI, sans-serif`;
    context.textAlign = "left";
    context.textBaseline = "middle";

    const lines = wrapSubtitleLines(context, subtitleText, maxBoxWidth - horizontalPadding * 2);

    if (!lines.length) {
      return;
    }

    const longestLineWidth = Math.max(...lines.map((line) => context.measureText(line).width));
    const boxWidth = Math.min(maxBoxWidth, Math.ceil(longestLineWidth + horizontalPadding * 2));
    const boxHeight = lines.length * lineHeight + 26;
    const boxX = (width - boxWidth) / 2;
    const boxY = height - safePadding - boxHeight;

    drawRoundedRect(context, boxX, boxY, boxWidth, boxHeight, 18);
    context.fillStyle = "rgba(9, 14, 18, 0.72)";
    context.fill();
    context.lineWidth = 1;
    context.strokeStyle = "rgba(255, 255, 255, 0.14)";
    context.stroke();

    context.fillStyle = "#fffaf0";
    const textCenterY = boxY + boxHeight / 2;
    const firstLineY = textCenterY - ((lines.length - 1) * lineHeight) / 2;
    const textX = boxX + horizontalPadding;

    lines.forEach((line, index) => {
      context.fillText(line, textX, firstLineY + index * lineHeight);
    });
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
        const subtitleText = getBurnedSubtitleText();

        if (subtitleText) {
          drawSubtitleFrame(context, canvas.width, canvas.height, subtitleText);
        }
      }

      renderFrameIdRef.current = window.requestAnimationFrame(renderFrame);
    };

    renderFrameIdRef.current = window.requestAnimationFrame(renderFrame);
  }, [drawSubtitleFrame, getBurnedSubtitleText]);

  const stopSession = useCallback(() => {
    clearRecognitionRestart();
    clearSubtitleHideTimer();
    clearInterimSubtitleFlushTimer();
    userStoppedRecognitionRef.current = true;
    isSessionActiveRef.current = false;
    setIsRecording(false);
    setHasCompletedTake(true);
    setCaptionText("");
    interimSubtitleRef.current = "";
    pendingInterimSubtitleRef.current = "";
    lastInterimSubtitlePaintAtRef.current = 0;
    safelyStopRecognition();

    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }

    releaseMediaStreamIfRecorderInactive();
    stopElapsedTimer();
  }, [
    clearRecognitionRestart,
    clearInterimSubtitleFlushTimer,
    clearSubtitleHideTimer,
    releaseMediaStreamIfRecorderInactive,
    safelyStopRecognition,
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
    finalSubtitleRef.current = "";
    finalSubtitleExpiresAtRef.current = 0;
    setTranscriptText("");
    setCaptionText(DEFAULT_CAPTION_TEXT);
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
    sessionStartMsRef.current = Date.now();
    recordedChunksRef.current = [];
    recordingMimeTypeRef.current = "";
    interimSubtitleRef.current = "";
    pendingInterimSubtitleRef.current = "";
    lastInterimSubtitlePaintAtRef.current = 0;
    finalSubtitleRef.current = "";
    finalSubtitleExpiresAtRef.current = 0;
    setTranscriptText("");
    setErrorMessage("");
    setCaptionText("");
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

      const sourceVideo = document.createElement("video");
      sourceVideo.muted = true;
      sourceVideo.playsInline = true;
      sourceVideo.srcObject = stream;
      sourceVideoRef.current = sourceVideo;
      await sourceVideo.play();
      await waitForVideoReady(sourceVideo);

      const { width, height } = getCanvasDimensions(stream);
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

      const composedStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        microphoneTrack.clone(),
      ]);
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
        setErrorMessage("Video recording failed. Please try again.");
        stopSession();
      };
      mediaRecorderRef.current.onstop = () => {
        const blobType = recordedChunksRef.current.find((chunk) => chunk.type)?.type ?? recordingMimeTypeRef.current;

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
      setCaptionText(DEFAULT_CAPTION_TEXT);
      setHasRecording(false);
      mediaRecorderRef.current = null;
      releaseMediaStream();
      stopElapsedTimer();
      setErrorMessage(getStartErrorMessage(error));
      safelyStopRecognition();
    }
  }, [
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
    startCanvasRenderer,
    startElapsedTimer,
    stopElapsedTimer,
    stopSession,
    updateElapsed,
  ]);

  useEffect(() => {
    if (!isSupported) {
      return undefined;
    }

    const recognition = new recognitionClass();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognitionRef.current = recognition;

    recognition.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result[0]?.transcript ?? "";

        if (result.isFinal) {
          appendTranscriptText(transcript);
          clearInterimSubtitleFlushTimer();
          interimSubtitleRef.current = "";
          pendingInterimSubtitleRef.current = "";
          lastInterimSubtitlePaintAtRef.current = 0;
          finalSubtitleRef.current = getYouTubeStyleSubtitleText(transcript);
          finalSubtitleExpiresAtRef.current = finalSubtitleRef.current
            ? Date.now() + FINAL_SUBTITLE_HOLD_MS
            : 0;
          showSubtitleThenHide(finalSubtitleRef.current);
        } else {
          const nextCaptionText = getYouTubeStyleSubtitleText(transcript);
          showInterimSubtitle(nextCaptionText);
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
        showSubtitleThenHide(finalSubtitleRef.current);
        return;
      }

      setErrorMessage(`Recognition error: ${event.error}. Your session has ended.`);

      if (FATAL_RECOGNITION_ERRORS.has(event.error)) {
        stopSession();
      }
    };

    recognition.onend = () => {
      if (!userStoppedRecognitionRef.current && isSessionActiveRef.current) {
        clearRecognitionRestart();
        restartTimeoutRef.current = window.setTimeout(() => {
          if (userStoppedRecognitionRef.current || recognitionRef.current !== recognition || !isSessionActiveRef.current) {
            return;
          }

          try {
            recognition.start();
          } catch (error) {
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
    clearRecognitionRestart,
    appendTranscriptText,
    clearInterimSubtitleFlushTimer,
    clearSubtitleHideTimer,
    isSupported,
    recognitionClass,
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
    captionText,
    isRecording,
    elapsedTime,
    errorMessage,
    hasRecording,
    hasCompletedTake,
    recordingUrl,
    downloadFileName,
    transcriptText,
    previewVideoRef,
    startSession,
    stopSession,
    resetSession,
    downloadTranscript,
  };
}
