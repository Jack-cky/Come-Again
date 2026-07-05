import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useIntervalTicker from "../../../shared/hooks/useIntervalTicker";
import {
  createConfiguredRecognition,
  FATAL_RECOGNITION_ERRORS,
  formatTime,
  getSpeechRecognitionClass,
  NON_BLOCKING_RECOGNITION_ERRORS,
} from "../../../shared/speechRecognition";
import { useJapanesePhonetics } from "../services/japanesePhonetics";
import { stopPronunciation } from "../services/pronunciationService";
import { computeAccuracy } from "../utils/textAnalysis";
import {
  createSeekablePlayer,
  decodeArrayBufferToAudioBuffer,
  stopSharedPlayback,
} from "../../../shared/webAudioPlayback";

const DEFAULT_INTERIM_TRANSCRIPT = "Your words will appear here as you speak.";
const PREFERRED_RECORDING_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/aac",
  "audio/mpeg",
];
const IOS_RECOGNITION_SETTLE_MS = 150;
const IOS_TRANSCRIPTION_FALLBACK_MESSAGE =
  "Live transcription is unavailable on this iPad. Audio recording is still running.";

function isIOSDevice() {
  if (typeof navigator === "undefined") {
    return false;
  }

  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function getSupportedRecordingMimeType(MediaRecorderClass) {
  if (typeof MediaRecorderClass?.isTypeSupported !== "function") {
    return "";
  }

  return (
    PREFERRED_RECORDING_MIME_TYPES.find((mimeType) => MediaRecorderClass.isTypeSupported(mimeType)) ?? ""
  );
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

export default function useSentencePractice(defaultLanguage) {
  const recognitionClass = useMemo(() => getSpeechRecognitionClass(), []);
  const isIOS = useMemo(() => isIOSDevice(), []);
  const isSupported = useMemo(() => {
    if (!recognitionClass || typeof window === "undefined" || typeof navigator === "undefined") {
      return false;
    }

    return Boolean(navigator.mediaDevices?.getUserMedia) && typeof window.MediaRecorder !== "undefined";
  }, [recognitionClass]);
  const shouldAutoRestartRecognition = useMemo(() => !isIOS, [isIOS]);

  const [selectedLanguage, setSelectedLanguage] = useState(defaultLanguage);
  const [referenceText, setReferenceText] = useState("");
  const [finalTranscript, setFinalTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState(DEFAULT_INTERIM_TRANSCRIPT);
  const [isListening, setIsListening] = useState(false);
  const [accuracy, setAccuracy] = useState(null);
  const [confidence, setConfidence] = useState(null);
  const [elapsedTime, setElapsedTime] = useState("00:00");
  const [charactersPerMinute, setCharactersPerMinute] = useState(0);
  const [characterCount, setCharacterCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [hasRecording, setHasRecording] = useState(false);
  const [hasUserStopped, setHasUserStopped] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  const canvasRef = useRef(null);
  const recognitionRef = useRef(null);
  const isListeningRef = useRef(false);
  const userStoppedRef = useRef(false);
  const sessionStartMsRef = useRef(0);
  const lastFinalResultMsRef = useRef(0);
  const totalCharactersRef = useRef(0);
  const sumConfidenceRef = useRef(0);
  const finalResultCountRef = useRef(0);
  const restartTimeoutRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserNodeRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const meterAnimationFrameIdRef = useRef(0);
  const mediaStreamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const pendingRecorderStopRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const recordingMimeTypeRef = useRef("");
  const audioBlobRef = useRef(null);
  const currentAudioRef = useRef(null);
  const currentAudioUrlRef = useRef("");
  const seekablePlayerRef = useRef(null);
  const nonFatalErrorOccurredRef = useRef(false);

  // Downloads the Japanese reading dictionary lazily; accuracy and the
  // transcript diff recompute once it is ready so kanji/kana spellings match.
  const phoneticsStatus = useJapanesePhonetics(selectedLanguage);

  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  useEffect(() => {
    setAccuracy(computeAccuracy(referenceText, finalTranscript, selectedLanguage));
    // phoneticsStatus is an intentional extra dependency: computeAccuracy
    // reads the module-level Japanese tokenizer, so the score must recompute
    // when the dictionary finishes loading.
  }, [referenceText, finalTranscript, selectedLanguage, phoneticsStatus]);

  const updateElapsed = useCallback(() => {
    if (!sessionStartMsRef.current) {
      setElapsedTime("00:00");
      setCharactersPerMinute(0);
      setCharacterCount(0);
      return;
    }

    const now = Date.now();
    const effectiveEnd = isListeningRef.current ? now : lastFinalResultMsRef.current || now;
    const elapsedMs = Math.max(0, effectiveEnd - sessionStartMsRef.current);
    const elapsedSeconds = Math.floor(elapsedMs / 1000);
    const elapsedMinutes = elapsedMs / 60000;

    setElapsedTime(formatTime(elapsedSeconds));
    setCharactersPerMinute(elapsedMinutes > 0 ? Math.round(totalCharactersRef.current / elapsedMinutes) : 0);
    setCharacterCount(totalCharactersRef.current);
  }, []);

  const { start: startElapsedTimer, stop: stopElapsedTimer } = useIntervalTicker(updateElapsed);

  const clearRecognitionRestart = useCallback(() => {
    if (restartTimeoutRef.current) {
      window.clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }
  }, []);

  const drawMeter = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = analyserNodeRef.current;

    if (!canvas || !analyser) {
      return;
    }

    const context = canvas.getContext("2d");

    if (!context) {
      return;
    }

    const values = new Uint8Array(analyser.frequencyBinCount);

    const renderFrame = () => {
      const activeAnalyser = analyserNodeRef.current;

      if (!activeAnalyser) {
        return;
      }

      activeAnalyser.getByteTimeDomainData(values);
      let sumSquares = 0;

      for (let index = 0; index < values.length; index += 1) {
        const normalized = (values[index] - 128) / 128;
        sumSquares += normalized * normalized;
      }

      const rms = Math.sqrt(sumSquares / values.length);
      const level = Math.min(1, rms * 4);

      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#e5e7eb";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#10b981";
      context.fillRect(0, 0, canvas.width * level, canvas.height);
      meterAnimationFrameIdRef.current = window.requestAnimationFrame(renderFrame);
    };

    renderFrame();
  }, []);

  const releaseMediaStream = useCallback(() => {
    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
  }, []);

  const releaseMediaStreamIfRecorderInactive = useCallback(() => {
    // Safari can flip MediaRecorder.state to inactive before delivering the
    // final onstop/dataavailable callbacks, so do not release the stream until
    // the tracked stop promise has settled.
    if (pendingRecorderStopRef.current) {
      return;
    }

    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === "inactive") {
      releaseMediaStream();
    }
  }, [releaseMediaStream]);

  const stopMeter = useCallback(() => {
    if (meterAnimationFrameIdRef.current) {
      window.cancelAnimationFrame(meterAnimationFrameIdRef.current);
      meterAnimationFrameIdRef.current = 0;
    }

    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.disconnect();
      } catch {
        // ignore
      }
      sourceNodeRef.current = null;
    }

    analyserNodeRef.current = null;

    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      const currentAudioContext = audioContextRef.current;

      if (isIOS) {
        audioContextRef.current = null;
        currentAudioContext.close().catch(() => undefined);
      } else {
        currentAudioContext.suspend().catch(() => undefined);
      }
    }

    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (canvas && context) {
      context.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, [isIOS]);

  const startMeter = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      return;
    }

    try {
      // On iOS Safari, always request a fresh stream; reusing a stream from a
      // previous MediaRecorder session can leave the recording pipeline silent.
      if (isIOS && mediaStreamRef.current) {
        releaseMediaStream();
      }

      const hasLiveStream = mediaStreamRef.current?.getTracks().some((track) => track.readyState === "live");

      if (mediaStreamRef.current && !hasLiveStream) {
        releaseMediaStream();
      }

      const stream = hasLiveStream
        ? mediaStreamRef.current
        : await navigator.mediaDevices.getUserMedia({ audio: true });

      mediaStreamRef.current = stream;

      if (userStoppedRef.current || !isListeningRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        return;
      }

      const AudioContextClass = window.AudioContext || window.webkitAudioContext;

      if (!AudioContextClass) {
        return;
      }

      if (!audioContextRef.current || audioContextRef.current.state === "closed") {
        audioContextRef.current = new AudioContextClass();
      }

      if (sourceNodeRef.current && audioContextRef.current.state !== "closed") {
        if (
          audioContextRef.current.state === "suspended" &&
          typeof audioContextRef.current.resume === "function"
        ) {
          audioContextRef.current.resume().catch(() => undefined);
          if (!userStoppedRef.current && isListeningRef.current) {
            drawMeter();
          }
        }
        return;
      }

      if (
        audioContextRef.current.state === "suspended" &&
        typeof audioContextRef.current.resume === "function"
      ) {
        audioContextRef.current.resume().catch(() => undefined);
      }

      if (userStoppedRef.current || !isListeningRef.current) {
        return;
      }

      sourceNodeRef.current = audioContextRef.current.createMediaStreamSource(mediaStreamRef.current);
      analyserNodeRef.current = audioContextRef.current.createAnalyser();
      analyserNodeRef.current.fftSize = 512;
      sourceNodeRef.current.connect(analyserNodeRef.current);
      drawMeter();
    } catch {
      setErrorMessage("Microphone level meter is unavailable. Check browser permissions.");
    }
  }, [drawMeter, isIOS, releaseMediaStream]);

  const detachRecorderHandlers = useCallback((recorder) => {
    if (!recorder) {
      return;
    }

    try {
      recorder.ondataavailable = null;
      recorder.onerror = null;
      recorder.onstop = null;
    } catch {
      // ignore
    }
  }, []);

  const stopRecordingAndWait = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    const pendingStop = pendingRecorderStopRef.current;

    if (!recorder) {
      if (pendingStop?.promise) {
        await pendingStop.promise;
      }
      return;
    }

    if (pendingStop?.recorder === recorder) {
      await pendingStop.promise;
      return;
    }

    if (recorder.state === "inactive") {
      if (mediaRecorderRef.current === recorder) {
        mediaRecorderRef.current = null;
      }
      return;
    }

    let resolveStop;
    const stopPromise = new Promise((resolve) => {
      resolveStop = resolve;
    });

    const settleStop = () => {
      if (pendingRecorderStopRef.current?.recorder === recorder) {
        pendingRecorderStopRef.current = null;
      }
      resolveStop();
    };

    pendingRecorderStopRef.current = {
      recorder,
      promise: stopPromise,
    };

    const originalOnStop = recorder.onstop;
    const originalOnError = recorder.onerror;

    recorder.onstop = (event) => {
      originalOnStop?.call(recorder, event);
      settleStop();
    };

    recorder.onerror = (event) => {
      originalOnError?.call(recorder, event);
      settleStop();
    };

    try {
      recorder.stop();
    } catch {
      settleStop();
    }

    await stopPromise;
  }, []);

  const stopRecording = useCallback(() => {
    void stopRecordingAndWait();
  }, [stopRecordingAndWait]);

  const startRecording = useCallback(async () => {
    if (!mediaStreamRef.current || typeof window.MediaRecorder === "undefined") {
      setErrorMessage("Audio recording is unavailable in this browser.");
      return false;
    }

    const existingRecorder = mediaRecorderRef.current;

    if (existingRecorder) {
      await stopRecordingAndWait();

      if (mediaRecorderRef.current === existingRecorder) {
        detachRecorderHandlers(existingRecorder);
        mediaRecorderRef.current = null;
      }
    }

    const MediaRecorderClass = window.MediaRecorder;
    const preferredMimeType = getSupportedRecordingMimeType(MediaRecorderClass);

    try {
      recordedChunksRef.current = [];
      recordingMimeTypeRef.current = preferredMimeType;
      audioBlobRef.current = null;
      seekablePlayerRef.current = null;
      setHasRecording(false);

      const newRecorder = preferredMimeType
        ? new MediaRecorderClass(mediaStreamRef.current, { mimeType: preferredMimeType })
        : new MediaRecorderClass(mediaStreamRef.current);
      mediaRecorderRef.current = newRecorder;
      newRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };
      newRecorder.onerror = () => {
        audioBlobRef.current = null;
        seekablePlayerRef.current = null;
        setHasRecording(false);
        setErrorMessage("Audio recording failed. Please try again.");
      };
      newRecorder.onstop = () => {
        const blobType =
          recordedChunksRef.current.find((chunk) => chunk.type)?.type ?? recordingMimeTypeRef.current;

        if (!recordedChunksRef.current.length) {
          audioBlobRef.current = null;
          seekablePlayerRef.current = null;
          setHasRecording(false);
          if (mediaRecorderRef.current === newRecorder) {
            mediaRecorderRef.current = null;
            releaseMediaStream();
          }
          return;
        }

        audioBlobRef.current = blobType
          ? new Blob(recordedChunksRef.current, { type: blobType })
          : new Blob(recordedChunksRef.current);
        // A fresh take invalidates any decoded player from a previous recording.
        seekablePlayerRef.current = null;
        setHasRecording(true);
        if (mediaRecorderRef.current === newRecorder) {
          mediaRecorderRef.current = null;
          releaseMediaStream();
        }
      };

      if (isIOS) {
        newRecorder.start();
      } else {
        newRecorder.start(250);
      }

      return true;
    } catch {
      mediaRecorderRef.current = null;
      audioBlobRef.current = null;
      seekablePlayerRef.current = null;
      setHasRecording(false);
      setErrorMessage("Audio recording failed to start in this browser.");
      releaseMediaStream();
      return false;
    }
  }, [detachRecorderHandlers, isIOS, releaseMediaStream, stopRecordingAndWait]);

  const appendFinalTranscript = useCallback((textToAppend) => {
    if (!textToAppend?.trim()) {
      return;
    }

    setFinalTranscript((previousTranscript) => {
      const needsLeadingSpace = previousTranscript.length > 0 && !previousTranscript.endsWith(" ");
      return `${previousTranscript}${needsLeadingSpace ? " " : ""}${textToAppend.trim()}`;
    });
  }, []);

  const safelyStopRecognition = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch {
      // Ignore InvalidStateError when recognition is already stopped.
    }
  }, []);

  const stopCurrentAudio = useCallback(() => {
    setIsPlaying(false);
    stopSharedPlayback();
    // Full reset (not just pause) since this runs at session boundaries where
    // any in-progress playback position should not carry over.
    seekablePlayerRef.current?.stop();

    if (currentAudioRef.current) {
      const audio = currentAudioRef.current;
      audio.onended = null;
      audio.pause();
      audio.currentTime = 0;
      audio.removeAttribute("src");
      audio.load();
      currentAudioRef.current = null;
    }

    if (currentAudioUrlRef.current) {
      URL.revokeObjectURL(currentAudioUrlRef.current);
      currentAudioUrlRef.current = "";
    }
  }, []);

  // Clears the whole session unconditionally; the page confirms with the
  // user first so this hook stays free of UI concerns.
  const resetSession = useCallback(async () => {
    stopCurrentAudio();
    stopPronunciation();
    clearRecognitionRestart();

    userStoppedRef.current = true;
    isListeningRef.current = false;
    setIsListening(false);
    safelyStopRecognition();
    stopMeter();
    stopElapsedTimer();
    await stopRecordingAndWait();
    mediaRecorderRef.current = null;
    releaseMediaStream();
    recognitionRef.current = null;
    setFinalTranscript("");
    setInterimTranscript(DEFAULT_INTERIM_TRANSCRIPT);
    setConfidence(null);
    setElapsedTime("00:00");
    setCharactersPerMinute(0);
    setCharacterCount(0);
    setErrorMessage("");
    setHasRecording(false);
    setHasUserStopped(false);
    totalCharactersRef.current = 0;
    sumConfidenceRef.current = 0;
    finalResultCountRef.current = 0;
    sessionStartMsRef.current = 0;
    lastFinalResultMsRef.current = 0;
    nonFatalErrorOccurredRef.current = false;
    audioBlobRef.current = null;
    seekablePlayerRef.current = null;
    recordedChunksRef.current = [];
    recordingMimeTypeRef.current = "";
  }, [
    clearRecognitionRestart,
    releaseMediaStream,
    safelyStopRecognition,
    stopCurrentAudio,
    stopRecordingAndWait,
    stopElapsedTimer,
    stopMeter,
  ]);

  const initializeRecognition = useCallback(() => {
    if (!recognitionClass) {
      recognitionRef.current = null;
      return;
    }

    try {
      const oldRecognition = recognitionRef.current;
      if (oldRecognition) {
        oldRecognition.onresult = null;
        oldRecognition.onerror = null;
        oldRecognition.onend = null;
        oldRecognition.stop();
      }
    } catch {
      // ignore
    }

    const recognition = createConfiguredRecognition(recognitionClass);
    recognitionRef.current = recognition;

    recognition.onresult = (event) => {
      if (recognitionRef.current !== recognition) {
        return;
      }

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result[0]?.transcript ?? "";

        if (result.isFinal) {
          appendFinalTranscript(transcript);
          totalCharactersRef.current += transcript.replace(/\s+/g, "").length;
          lastFinalResultMsRef.current = Date.now();

          const confidenceScore = result[0]?.confidence;

          if (typeof confidenceScore === "number" && !Number.isNaN(confidenceScore)) {
            sumConfidenceRef.current += confidenceScore;
            finalResultCountRef.current += 1;
            const average = sumConfidenceRef.current / finalResultCountRef.current;
            setConfidence(Math.round(Math.max(0, Math.min(1, average)) * 100));
          }

          setInterimTranscript("");
          updateElapsed();
        } else {
          setInterimTranscript(transcript);
        }
      }
    };

    recognition.onerror = (event) => {
      if (recognitionRef.current !== recognition) {
        return;
      }

      if (userStoppedRef.current) {
        return;
      }

      if (NON_BLOCKING_RECOGNITION_ERRORS.has(event.error)) {
        nonFatalErrorOccurredRef.current = true;
        setInterimTranscript("Listening... Speak the reference passage clearly.");
        return;
      }

      if (FATAL_RECOGNITION_ERRORS.has(event.error)) {
        if (isIOS && mediaRecorderRef.current?.state === "recording") {
          clearRecognitionRestart();
          setErrorMessage(IOS_TRANSCRIPTION_FALLBACK_MESSAGE);
          setInterimTranscript(IOS_TRANSCRIPTION_FALLBACK_MESSAGE);
          nonFatalErrorOccurredRef.current = false;
          return;
        }

        clearRecognitionRestart();
        userStoppedRef.current = true;
        isListeningRef.current = false;
        setIsListening(false);
        stopRecording();
        stopMeter();
        releaseMediaStreamIfRecorderInactive();
        stopElapsedTimer();
      }

      setErrorMessage(`Recognition error: ${event.error}. Please try again.`);
      setInterimTranscript(`❌ Recognition error: ${event.error}. Please try again.`);
    };

    recognition.onend = () => {
      if (recognitionRef.current !== recognition) {
        return;
      }

      if (!userStoppedRef.current && shouldAutoRestartRecognition) {
        clearRecognitionRestart();
        restartTimeoutRef.current = window.setTimeout(() => {
          if (userStoppedRef.current || recognitionRef.current !== recognition) {
            return;
          }

          try {
            recognition.start();
            isListeningRef.current = true;
            setIsListening(true);
          } catch {
            isListeningRef.current = false;
            setIsListening(false);
            setErrorMessage(
              "Speech recognition stopped unexpectedly. Please press Start Recording to try again.",
            );
          }
        }, 250);
        return;
      }

      if (isIOS && !userStoppedRef.current && mediaRecorderRef.current?.state === "recording") {
        setErrorMessage(IOS_TRANSCRIPTION_FALLBACK_MESSAGE);
        setInterimTranscript(IOS_TRANSCRIPTION_FALLBACK_MESSAGE);
        nonFatalErrorOccurredRef.current = false;
        return;
      }

      if (!userStoppedRef.current && !nonFatalErrorOccurredRef.current) {
        setErrorMessage(
          "Speech recognition stopped unexpectedly on this device. Please press Start Recording to try again.",
        );
        stopRecording();
        stopMeter();
        releaseMediaStreamIfRecorderInactive();
        stopElapsedTimer();
      }

      nonFatalErrorOccurredRef.current = false;
      isListeningRef.current = false;
      setIsListening(false);
    };
  }, [
    appendFinalTranscript,
    clearRecognitionRestart,
    isIOS,
    recognitionClass,
    releaseMediaStreamIfRecorderInactive,
    shouldAutoRestartRecognition,
    stopElapsedTimer,
    stopMeter,
    stopRecording,
    updateElapsed,
  ]);

  const startListening = useCallback(async () => {
    if (hasUserStopped) {
      return;
    }

    stopCurrentAudio();
    clearRecognitionRestart();
    setErrorMessage("");
    setHasUserStopped(false);
    userStoppedRef.current = false;
    isListeningRef.current = true;
    setIsListening(true);
    setInterimTranscript("Listening... Speak the reference passage clearly.");

    if (!recognitionRef.current || isIOS) {
      initializeRecognition();
    }

    if (!recognitionRef.current) {
      userStoppedRef.current = true;
      isListeningRef.current = false;
      setIsListening(false);
      setErrorMessage("Speech recognition is not available.");
      return;
    }

    recognitionRef.current.lang = selectedLanguage;

    try {
      if (!sessionStartMsRef.current) {
        sessionStartMsRef.current = Date.now();
      }

      await stopRecordingAndWait();

      if (userStoppedRef.current || !isListeningRef.current) {
        return;
      }

      await startMeter();
      if (userStoppedRef.current || !isListeningRef.current) {
        return;
      }

      if (!(await startRecording())) {
        throw new Error("recording-start-failed");
      }

      if (isIOS) {
        await delay(IOS_RECOGNITION_SETTLE_MS);

        if (userStoppedRef.current || !isListeningRef.current) {
          return;
        }
      }

      recognitionRef.current.start();
      startElapsedTimer();
      updateElapsed();
    } catch (error) {
      if (
        isIOS &&
        mediaRecorderRef.current?.state === "recording" &&
        !(error instanceof Error && error.message === "recording-start-failed")
      ) {
        startElapsedTimer();
        updateElapsed();
        setErrorMessage(IOS_TRANSCRIPTION_FALLBACK_MESSAGE);
        setInterimTranscript(IOS_TRANSCRIPTION_FALLBACK_MESSAGE);
        return;
      }

      userStoppedRef.current = true;
      isListeningRef.current = false;
      setIsListening(false);
      safelyStopRecognition();
      stopRecording();
      stopMeter();
      releaseMediaStreamIfRecorderInactive();
      setErrorMessage(
        error instanceof Error && error.message === "recording-start-failed"
          ? "Failed to start audio recording. Check browser permissions and try again."
          : "Failed to start speech recognition. Please try again.",
      );
    }
  }, [
    clearRecognitionRestart,
    hasUserStopped,
    isIOS,
    initializeRecognition,
    releaseMediaStreamIfRecorderInactive,
    safelyStopRecognition,
    selectedLanguage,
    startElapsedTimer,
    startMeter,
    startRecording,
    stopCurrentAudio,
    stopRecordingAndWait,
    stopMeter,
    stopRecording,
    updateElapsed,
  ]);

  const stopListening = useCallback(() => {
    clearRecognitionRestart();
    userStoppedRef.current = true;
    isListeningRef.current = false;
    setHasUserStopped(true);
    setIsListening(false);
    setInterimTranscript("");
    safelyStopRecognition();
    stopRecording();
    stopMeter();
    releaseMediaStreamIfRecorderInactive();
    stopElapsedTimer();
  }, [
    clearRecognitionRestart,
    releaseMediaStreamIfRecorderInactive,
    safelyStopRecognition,
    stopElapsedTimer,
    stopMeter,
    stopRecording,
  ]);

  const playRecording = useCallback(async () => {
    if (!audioBlobRef.current || isListeningRef.current) {
      return;
    }

    stopPronunciation();

    // iOS Safari treats <audio> playback as a session-category change that can
    // silently break the next getUserMedia() recording, so route playback
    // through the same persistent Web Audio graph used for pronunciation
    // playback instead. A seekable player (offset-tracked, one source node
    // per play() call) gives real pause/resume here, matching the <audio>
    // element behaviour used below on non-iOS.
    if (isIOS) {
      const blobAtRequestStart = audioBlobRef.current;
      // Flip the button immediately, matching the <audio>-element path below;
      // reverted if decoding fails or the request goes stale before it settles.
      setIsPlaying(true);

      try {
        if (!seekablePlayerRef.current) {
          const arrayBuffer = await blobAtRequestStart.arrayBuffer();
          const audioBuffer = await decodeArrayBufferToAudioBuffer(arrayBuffer);

          // Bail if a reset/new recording/new session moved on while decoding.
          if (audioBlobRef.current !== blobAtRequestStart || isListeningRef.current) {
            setIsPlaying(false);
            return;
          }

          const player = createSeekablePlayer(audioBuffer);
          player.onEnded = () => setIsPlaying(false);
          seekablePlayerRef.current = player;
        }

        seekablePlayerRef.current.play();
      } catch {
        seekablePlayerRef.current = null;
        setIsPlaying(false);
        setErrorMessage("Unable to play the audio recording in this browser.");
      }

      return;
    }

    const existingAudio = currentAudioRef.current;

    if (existingAudio?.paused && existingAudio.src) {
      setIsPlaying(true);
      existingAudio.play().catch(() => {
        stopCurrentAudio();
        setErrorMessage("Unable to play the audio recording in this browser.");
      });
      return;
    }

    stopCurrentAudio();

    const blobUrl = URL.createObjectURL(audioBlobRef.current);
    currentAudioUrlRef.current = blobUrl;
    const audio = new Audio(blobUrl);
    currentAudioRef.current = audio;
    setIsPlaying(true);

    audio.onended = () => {
      stopCurrentAudio();
    };

    audio.play().catch(() => {
      stopCurrentAudio();
      setErrorMessage("Unable to play the audio recording in this browser.");
    });
  }, [isIOS, stopCurrentAudio]);

  const pausePlayback = useCallback(() => {
    if (isIOS) {
      seekablePlayerRef.current?.pause();
      setIsPlaying(false);
      return;
    }

    const audio = currentAudioRef.current;

    if (!audio) {
      setIsPlaying(false);
      return;
    }

    audio.pause();
    setIsPlaying(false);
  }, [isIOS]);

  useEffect(() => {
    if (!isSupported) {
      return undefined;
    }

    initializeRecognition();

    return () => {
      clearRecognitionRestart();
      userStoppedRef.current = true;
      isListeningRef.current = false;
      safelyStopRecognition();
      recognitionRef.current = null;
    };
  }, [clearRecognitionRestart, initializeRecognition, isSupported, safelyStopRecognition]);

  useEffect(() => {
    return () => {
      clearRecognitionRestart();
      stopRecording();
      stopMeter();
      releaseMediaStream();
      stopElapsedTimer();
      stopCurrentAudio();
      stopPronunciation();
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        audioContextRef.current.close().catch(() => undefined);
      }
    };
  }, [
    clearRecognitionRestart,
    releaseMediaStream,
    stopCurrentAudio,
    stopElapsedTimer,
    stopMeter,
    stopRecording,
  ]);

  return {
    isSupported,
    phoneticsStatus,
    selectedLanguage,
    setSelectedLanguage,
    referenceText,
    setReferenceText,
    finalTranscript,
    interimTranscript,
    isListening,
    accuracy,
    confidence,
    elapsedTime,
    charactersPerMinute,
    characterCount,
    errorMessage,
    hasRecording,
    hasUserStopped,
    isPlaying,
    canReset: !isListening && (Boolean(finalTranscript.trim()) || hasRecording || hasUserStopped),
    canvasRef,
    startListening,
    stopListening,
    resetSession,
    playRecording,
    pausePlayback,
  };
}
