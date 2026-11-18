import { DEFAULT_RNNOISE, RNNOISE_KEY } from './config.js';
import { loadRnnoise } from '../vendor/rnnoise/index.js';

const WORKLET_URL = new URL('../vendor/rnnoise/workletProcessor.js', import.meta.url).href;
const WASM_URL = new URL('../vendor/rnnoise/rnnoise.wasm', import.meta.url).href;
const SIMD_URL = new URL('../vendor/rnnoise/rnnoise_simd.wasm', import.meta.url).href;
const PROCESSOR_NAME = '@sapphi-red/web-noise-suppressor/rnnoise';

/** @type {ArrayBuffer | null} */
let wasmBinary = null;
/** @type {Promise<ArrayBuffer> | null} */
let wasmPromise = null;

export function loadRnnoiseEnabled() {
  const raw = localStorage.getItem(RNNOISE_KEY);
  if (raw === null) return DEFAULT_RNNOISE;
  return raw === '1' || raw === 'true';
}

export function saveRnnoiseEnabled(enabled) {
  localStorage.setItem(RNNOISE_KEY, enabled ? '1' : '0');
  return !!enabled;
}

async function ensureWasm() {
  if (wasmBinary) return wasmBinary;
  if (!wasmPromise) {
    wasmPromise = loadRnnoise({ url: WASM_URL, simdUrl: SIMD_URL })
      .then((buf) => {
        if (!(buf instanceof ArrayBuffer) || buf.byteLength < 1000) {
          throw new Error('RNNoise wasm пустой или повреждён');
        }
        wasmBinary = buf;
        return buf;
      })
      .catch((err) => {
        wasmPromise = null;
        throw err;
      });
  }
  return wasmPromise;
}

function waitForWorkletReady(node, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('RNNoise worklet не ответил вовремя'));
    }, timeoutMs);

    function onMessage(event) {
      if (event.data === 'ready') {
        cleanup();
        resolve();
        return;
      }
      if (event.data && event.data.error) {
        cleanup();
        reject(new Error(event.data.error));
      }
    }

    function cleanup() {
      clearTimeout(timer);
      node.port.onmessage = null;
    }

    node.port.onmessage = onMessage;
  });
}

/**
 * Прогоняет raw mic stream через RNNoise и отдаёт очищенный трек.
 * WASM передаём через MessagePort (processorOptions в Chrome часто зависает).
 */
export async function createRnnoiseTrack(rawStream) {
  const ctx = new AudioContext({ sampleRate: 48000 });
  if (Math.abs(ctx.sampleRate - 48000) > 1) {
    console.warn(`[vchat] RNNoise ожидает 48 kHz, AudioContext=${ctx.sampleRate}`);
  }

  const binary = await ensureWasm();
  await ctx.audioWorklet.addModule(WORKLET_URL);
  if (ctx.state === 'suspended') {
    await ctx.resume();
  }

  const source = ctx.createMediaStreamSource(rawStream);
  const rnnoise = new AudioWorkletNode(ctx, PROCESSOR_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 1,
    processorOptions: { maxChannels: 1 },
  });

  const ready = waitForWorkletReady(rnnoise);
  // Transferable: worklet забирает копию буфера без processorOptions
  const wasmCopy = binary.slice(0);
  rnnoise.port.postMessage({ wasmBinary: wasmCopy, maxChannels: 1 }, [wasmCopy]);

  const dest = ctx.createMediaStreamDestination();
  source.connect(rnnoise);
  rnnoise.connect(dest);

  try {
    await ready;
  } catch (err) {
    try {
      rnnoise.port.postMessage('destroy');
      rnnoise.disconnect();
      source.disconnect();
    } catch {
      // ignore
    }
    await ctx.close().catch(() => {});
    throw err;
  }

  const track = dest.stream.getAudioTracks()[0];
  if (!track || track.readyState !== 'live') {
    rnnoise.port.postMessage('destroy');
    source.disconnect();
    await ctx.close().catch(() => {});
    throw new Error('RNNoise не создал live audio track');
  }

  track.contentHint = 'speech';

  return {
    track,
    stop() {
      try {
        rnnoise.port.postMessage('destroy');
        rnnoise.disconnect();
        source.disconnect();
      } catch {
        // already stopped
      }
      dest.stream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          // ignore
        }
      });
      ctx.close().catch(() => {});
    },
  };
}
