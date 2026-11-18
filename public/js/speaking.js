const SPEAKING_THRESHOLD = 0.04;
const SILENCE_HOLD_MS = 280;

/** @type {AudioContext | null} */
let audioCtx = null;
/** @type {Map<string, { analyser: AnalyserNode, source: MediaStreamAudioSourceNode, data: Uint8Array, tile: HTMLElement, lastSpeakAt: number }>} */
const watchers = new Map();
let rafId = 0;

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function levelFromAnalyser(analyser, data) {
  analyser.getByteTimeDomainData(data);
  let sum = 0;
  for (let i = 0; i < data.length; i += 1) {
    const v = (data[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / data.length);
}

function tick(now) {
  for (const entry of watchers.values()) {
    const level = levelFromAnalyser(entry.analyser, entry.data);
    if (level >= SPEAKING_THRESHOLD && !entry.tile.classList.contains('mic-off')) {
      entry.lastSpeakAt = now;
      entry.tile.classList.add('speaking');
    } else if (now - entry.lastSpeakAt > SILENCE_HOLD_MS) {
      entry.tile.classList.remove('speaking');
    }
  }
  rafId = watchers.size ? requestAnimationFrame(tick) : 0;
}

function ensureLoop() {
  if (!rafId && watchers.size) {
    rafId = requestAnimationFrame(tick);
  }
}

export function watchSpeaking(publisherId, stream, tile) {
  if (publisherId == null || !(stream instanceof MediaStream) || !tile) return;
  const key = String(publisherId);
  unwatchSpeaking(key);

  const ctx = getAudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.5;
  source.connect(analyser);

  watchers.set(key, {
    analyser,
    source,
    data: new Uint8Array(analyser.fftSize),
    tile,
    lastSpeakAt: 0,
  });
  ensureLoop();
}

export function unwatchSpeaking(publisherId) {
  if (publisherId == null) return;
  const key = String(publisherId);
  const entry = watchers.get(key);
  if (!entry) return;
  try {
    entry.source.disconnect();
    entry.analyser.disconnect();
  } catch {
    // already disconnected
  }
  entry.tile.classList.remove('speaking');
  watchers.delete(key);
  if (!watchers.size && rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
}

export function unwatchAllSpeaking() {
  for (const key of [...watchers.keys()]) {
    unwatchSpeaking(key);
  }
}
