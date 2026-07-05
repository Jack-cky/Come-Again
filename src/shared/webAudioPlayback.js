// iOS Safari swaps its shared audio session out of "record" mode whenever an
// <audio> element or speechSynthesis utterance plays, which silently breaks
// the next getUserMedia() recording. Routing playback through a single
// persistent AudioContext instead avoids that session-category switch.
let sharedAudioContext = null;
let activeSource = null;
let activeSeekablePlayer = null;

function getAudioContextClass() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.AudioContext || window.webkitAudioContext || null;
}

export function getSharedPlaybackAudioContext() {
  const AudioContextClass = getAudioContextClass();

  if (!AudioContextClass) {
    return null;
  }

  if (!sharedAudioContext || sharedAudioContext.state === "closed") {
    sharedAudioContext = new AudioContextClass();
  }

  if (sharedAudioContext.state === "suspended" && typeof sharedAudioContext.resume === "function") {
    sharedAudioContext.resume().catch(() => undefined);
  }

  return sharedAudioContext;
}

export function stopSharedPlayback() {
  if (activeSource) {
    const source = activeSource;
    activeSource = null;
    source.onended = null;

    try {
      source.stop();
    } catch {
      // Already stopped.
    }

    try {
      source.disconnect();
    } catch {
      // Already disconnected.
    }
  }

  if (activeSeekablePlayer) {
    // Pause rather than stop so a paused recording keeps its resume position
    // when some other clip (e.g. a pronunciation lookup) interrupts it.
    activeSeekablePlayer.pause();
  }
}

function decodeAudioData(context, arrayBuffer) {
  return new Promise((resolve, reject) => {
    const maybePromise = context.decodeAudioData(arrayBuffer, resolve, reject);

    if (maybePromise && typeof maybePromise.then === "function") {
      maybePromise.then(resolve, reject);
    }
  });
}

export async function playArrayBufferOnce(arrayBuffer) {
  const context = getSharedPlaybackAudioContext();

  if (!context) {
    throw new Error("web-audio-unavailable");
  }

  stopSharedPlayback();

  const audioBuffer = await decodeAudioData(context, arrayBuffer);
  const source = context.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(context.destination);
  activeSource = source;

  return new Promise((resolve, reject) => {
    source.onended = () => {
      if (activeSource === source) {
        activeSource = null;
      }
      resolve();
    };

    try {
      source.start();
    } catch (error) {
      if (activeSource === source) {
        activeSource = null;
      }
      reject(error);
    }
  });
}

export async function decodeArrayBufferToAudioBuffer(arrayBuffer) {
  const context = getSharedPlaybackAudioContext();

  if (!context) {
    throw new Error("web-audio-unavailable");
  }

  return decodeAudioData(context, arrayBuffer);
}

// AudioBufferSourceNode can only be started once, so real pause/resume (to
// match the <audio>-element behaviour used on non-iOS) means tracking a
// playback offset and spinning up a fresh source node each time play() is
// called, seeked to that offset.
export function createSeekablePlayer(audioBuffer) {
  const context = getSharedPlaybackAudioContext();
  let source = null;
  let startedAtContextTime = 0;
  let offset = 0;
  let onEndedCallback = null;

  function pause() {
    if (!source) {
      return;
    }

    const elapsed = context.currentTime - startedAtContextTime;
    offset = Math.min(offset + elapsed, audioBuffer.duration);

    const node = source;
    source = null;
    node.onended = null;

    try {
      node.stop();
    } catch {
      // Already stopped.
    }

    if (activeSeekablePlayer === player) {
      activeSeekablePlayer = null;
    }
  }

  function play() {
    if (source || !context) {
      return;
    }

    stopSharedPlayback();

    const node = context.createBufferSource();
    node.buffer = audioBuffer;
    node.connect(context.destination);
    node.onended = () => {
      if (source !== node) {
        return;
      }

      source = null;
      offset = 0;

      if (activeSeekablePlayer === player) {
        activeSeekablePlayer = null;
      }

      onEndedCallback?.();
    };

    node.start(0, Math.min(offset, audioBuffer.duration));
    source = node;
    startedAtContextTime = context.currentTime;
    activeSeekablePlayer = player;
  }

  function stop() {
    pause();
    offset = 0;
  }

  const player = {
    play,
    pause,
    stop,
    get isPlaying() {
      return source !== null;
    },
    set onEnded(callback) {
      onEndedCallback = callback;
    },
  };

  return player;
}
