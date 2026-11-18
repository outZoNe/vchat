import {
  loadCameraDeviceId,
  loadMicDeviceId,
  saveCameraDeviceId,
  saveMicDeviceId,
} from './devices.js';
import {
  createRnnoiseTrack,
  loadRnnoiseEnabled,
  saveRnnoiseEnabled,
} from './noiseSuppression.js';

let localStream = null;
/** Сырой микрофон до RNNoise */
let rawMicStream = null;
/** @type {{ track: MediaStreamTrack, stop: () => void } | null} */
let rnnoiseHandle = null;
let screenStream = null;
let micEnabled = true;
let camEnabled = false;
let screenEnabled = false;
let deafenEnabled = false;
let micBeforeDeafen = true;
let rnnoiseEnabled = loadRnnoiseEnabled();

export function getMediaState() {
  return {
    localStream,
    screenStream,
    micEnabled,
    camEnabled,
    screenEnabled,
    deafenEnabled,
    rnnoiseEnabled,
  };
}

export function isDeafened() {
  return deafenEnabled;
}

export function isRnnoiseEnabled() {
  return rnnoiseEnabled;
}

export function updateControlButtons(micBtn, camBtn, screenBtn, deafenBtn) {
  micBtn.classList.toggle('off', !micEnabled);
  micBtn.textContent = micEnabled ? '🎤' : '🔇';
  camBtn.classList.toggle('active-media', camEnabled);
  camBtn.classList.toggle('off', !camEnabled);
  screenBtn.classList.toggle('active-media', screenEnabled);
  if (deafenBtn) {
    deafenBtn.classList.toggle('off', deafenEnabled);
    deafenBtn.textContent = deafenEnabled ? '🔇' : '🎧';
  }
}

function videoConstraints(deviceId) {
  const video = {
    width: { ideal: 1280 },
    height: { ideal: 720 },
  };
  const id = deviceId || loadCameraDeviceId();
  if (id) video.deviceId = { ideal: id };
  return video;
}

function rememberTrackDevice(track, saveFn) {
  const id = track?.getSettings?.().deviceId;
  if (id) saveFn(id);
}

function stopRnnoise() {
  if (rnnoiseHandle) {
    rnnoiseHandle.stop();
    rnnoiseHandle = null;
  }
}

function stopRawMic() {
  if (rawMicStream) {
    rawMicStream.getTracks().forEach((t) => t.stop());
    rawMicStream = null;
  }
}

function replaceLocalAudioTrack(nextTrack) {
  if (!localStream) {
    localStream = new MediaStream([nextTrack]);
    return;
  }
  localStream.getAudioTracks().forEach((t) => {
    localStream.removeTrack(t);
    // processed track from destination; raw tracks stop via stopRawMic
    if (t !== nextTrack) t.stop();
  });
  localStream.addTrack(nextTrack);
}

function applyMicEnabledToTracks() {
  rawMicStream?.getAudioTracks().forEach((t) => {
    t.enabled = micEnabled;
  });
  localStream?.getAudioTracks().forEach((t) => {
    t.enabled = micEnabled;
  });
}

async function openRawMic(deviceId, { useBrowserNs }) {
  const audio = {
    echoCancellation: true,
    noiseSuppression: useBrowserNs,
    autoGainControl: true,
  };
  const id = deviceId || loadMicDeviceId();
  if (id) audio.deviceId = { ideal: id };

  const stream = await navigator.mediaDevices.getUserMedia({
    audio,
    video: false,
  });
  rememberTrackDevice(stream.getAudioTracks()[0], saveMicDeviceId);
  return stream;
}

/** Захват микрофона и опциональный RNNoise; возвращает publish-трек */
async function acquireMicTrack(deviceId) {
  stopRnnoise();
  stopRawMic();

  let publishTrack;
  if (rnnoiseEnabled) {
    rawMicStream = await openRawMic(deviceId, { useBrowserNs: false });
    try {
      rnnoiseHandle = await createRnnoiseTrack(rawMicStream);
      publishTrack = rnnoiseHandle.track;
      console.info('[vchat] RNNoise включён');
    } catch (err) {
      console.warn('[vchat] RNNoise недоступен, браузерный NS', err);
      stopRnnoise();
      stopRawMic();
      rawMicStream = await openRawMic(deviceId, { useBrowserNs: true });
      publishTrack = rawMicStream.getAudioTracks()[0];
    }
  } else {
    rawMicStream = await openRawMic(deviceId, { useBrowserNs: true });
    publishTrack = rawMicStream.getAudioTracks()[0];
  }

  publishTrack.enabled = micEnabled;
  rawMicStream.getAudioTracks().forEach((t) => {
    t.enabled = micEnabled;
  });
  return publishTrack;
}

export async function ensureLocalMedia(onControlsChange) {
  if (localStream && localStream.getAudioTracks().some((t) => t.readyState === 'live')) {
    return localStream;
  }

  const audioTrack = await acquireMicTrack();
  replaceLocalAudioTrack(audioTrack);

  micEnabled = !deafenEnabled;
  applyMicEnabledToTracks();
  camEnabled = false;
  onControlsChange?.();
  return localStream;
}

/** Выключает камеру и демонстрацию экрана, микрофон не трогает */
export function stopLocalVideo(onControlsChange) {
  if (screenStream) {
    screenStream.getTracks().forEach((t) => t.stop());
    screenStream = null;
  }
  screenEnabled = false;

  if (localStream) {
    localStream.getVideoTracks().forEach((t) => {
      localStream.removeTrack(t);
      t.stop();
    });
  }
  camEnabled = false;
  onControlsChange?.();
}

export function stopAllLocalMedia(onControlsChange) {
  stopLocalVideo(null);
  stopRnnoise();
  stopRawMic();
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  micEnabled = true;
  deafenEnabled = false;
  micBeforeDeafen = true;
  onControlsChange?.();
}

export function toggleMic(onControlsChange) {
  if (!localStream && !rawMicStream) return;
  micEnabled = !micEnabled;
  // Включение микрофона снимает deafen - снова слышим собеседников
  if (micEnabled && deafenEnabled) {
    deafenEnabled = false;
  }
  applyMicEnabledToTracks();
  onControlsChange?.();
}

export function toggleDeafen(onControlsChange) {
  if (!deafenEnabled) {
    micBeforeDeafen = micEnabled;
    deafenEnabled = true;
    micEnabled = false;
  } else {
    deafenEnabled = false;
    micEnabled = micBeforeDeafen;
  }
  applyMicEnabledToTracks();
  onControlsChange?.();
}

async function acquireCameraTrack(deviceId) {
  const preferredId = deviceId || loadCameraDeviceId();
  const live = localStream?.getVideoTracks().find((t) => t.readyState === 'live');
  if (live && !deviceId) {
    const currentId = live.getSettings?.().deviceId;
    if (!preferredId || currentId === preferredId) return live;
  }

  const fresh = await navigator.mediaDevices.getUserMedia({
    video: videoConstraints(preferredId),
  });
  const camTrack = fresh.getVideoTracks()[0];
  rememberTrackDevice(camTrack, saveCameraDeviceId);

  if (!localStream) {
    localStream = new MediaStream([camTrack]);
    return camTrack;
  }

  localStream.getVideoTracks().forEach((t) => {
    localStream.removeTrack(t);
    t.stop();
  });
  localStream.addTrack(camTrack);
  return camTrack;
}

export async function stopScreenShare(videoSender, onChange) {
  if (screenStream) {
    screenStream.getTracks().forEach((t) => t.stop());
    screenStream = null;
  }
  screenEnabled = false;

  const camTrack = localStream?.getVideoTracks().find((t) => t.readyState === 'live') || null;
  if (videoSender) {
    if (camTrack) {
      camTrack.enabled = camEnabled;
      await videoSender.replaceTrack(camTrack);
    } else {
      await videoSender.replaceTrack(null);
    }
  }
  onChange?.();
}

export async function toggleCamera({ pc, videoSender, attachVideoTrack, onChange }) {
  if (!pc || !localStream) return videoSender;

  if (camEnabled) {
    camEnabled = false;
    localStream.getVideoTracks().forEach((t) => {
      t.enabled = false;
    });
    if (videoSender && !screenEnabled) {
      const camTrack = localStream.getVideoTracks().find((t) => t.readyState === 'live');
      if (camTrack) await videoSender.replaceTrack(camTrack);
    }
    onChange?.();
    return videoSender;
  }

  if (screenEnabled) {
    await stopScreenShare(videoSender, null);
  }

  const camTrack = await acquireCameraTrack();
  camTrack.enabled = true;
  camEnabled = true;
  const sender = await attachVideoTrack(camTrack);
  onChange?.();
  return sender;
}

export async function toggleScreen({ pc, videoSender, attachVideoTrack, onChange }) {
  if (!pc) return videoSender;

  if (screenEnabled) {
    await stopScreenShare(videoSender, onChange);
    return videoSender;
  }

  if (camEnabled) {
    camEnabled = false;
    localStream?.getVideoTracks().forEach((t) => {
      t.enabled = false;
    });
  }

  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    });
  } catch (err) {
    console.warn('Демонстрация экрана отменена', err);
    return videoSender;
  }

  const screenTrack = screenStream.getVideoTracks()[0];
  screenTrack.onended = () => {
    stopScreenShare(videoSender, onChange);
  };
  screenEnabled = true;
  const sender = await attachVideoTrack(screenTrack);
  onChange?.();
  return sender;
}

export async function switchMicrophone(deviceId, audioSender, onControlsChange) {
  saveMicDeviceId(deviceId);
  const nextTrack = await acquireMicTrack(deviceId);
  replaceLocalAudioTrack(nextTrack);

  if (audioSender) {
    await audioSender.replaceTrack(nextTrack);
  }
  onControlsChange?.();
  return nextTrack;
}

export async function setRnnoiseEnabled(enabled, audioSender, onControlsChange) {
  const next = saveRnnoiseEnabled(enabled);
  if (next === rnnoiseEnabled) return rnnoiseEnabled;
  rnnoiseEnabled = next;

  const hasLiveMic = rawMicStream?.getAudioTracks().some((t) => t.readyState === 'live')
    || localStream?.getAudioTracks().some((t) => t.readyState === 'live');
  if (!hasLiveMic) {
    onControlsChange?.();
    return rnnoiseEnabled;
  }

  const nextTrack = await acquireMicTrack(loadMicDeviceId());
  replaceLocalAudioTrack(nextTrack);
  if (audioSender) {
    await audioSender.replaceTrack(nextTrack);
  }
  onControlsChange?.();
  return rnnoiseEnabled;
}

export async function switchCamera(deviceId, {
  pc,
  videoSender,
  attachVideoTrack,
  onChange,
}) {
  saveCameraDeviceId(deviceId);
  if (!pc || !localStream) return videoSender;

  const camTrack = await acquireCameraTrack(deviceId);
  camTrack.enabled = camEnabled;

  if (!camEnabled || screenEnabled) {
    onChange?.();
    return videoSender;
  }

  const sender = await attachVideoTrack(camTrack);
  onChange?.();
  return sender;
}
