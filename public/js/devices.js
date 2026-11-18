import {
  CAMERA_DEVICE_KEY,
  MIC_DEVICE_KEY,
  SPEAKER_DEVICE_KEY,
} from './config.js';

function readId(key) {
  const value = localStorage.getItem(key);
  return value && value.trim() ? value.trim() : '';
}

function writeId(key, deviceId) {
  const clean = (deviceId || '').trim();
  if (!clean) localStorage.removeItem(key);
  else localStorage.setItem(key, clean);
  return clean;
}

export function loadMicDeviceId() {
  return readId(MIC_DEVICE_KEY);
}

export function saveMicDeviceId(deviceId) {
  return writeId(MIC_DEVICE_KEY, deviceId);
}

export function loadCameraDeviceId() {
  return readId(CAMERA_DEVICE_KEY);
}

export function saveCameraDeviceId(deviceId) {
  return writeId(CAMERA_DEVICE_KEY, deviceId);
}

export function loadSpeakerDeviceId() {
  return readId(SPEAKER_DEVICE_KEY);
}

export function saveSpeakerDeviceId(deviceId) {
  return writeId(SPEAKER_DEVICE_KEY, deviceId);
}

export async function listMediaDevices(kind) {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === kind && d.deviceId);
}

export async function setAudioSink(el, deviceId) {
  if (!el || typeof el.setSinkId !== 'function') return;
  try {
    await el.setSinkId(deviceId || '');
  } catch (err) {
    console.warn('Не удалось сменить устройство вывода', err);
  }
}

export async function applySpeakerToElements(elements, deviceId) {
  const id = deviceId ?? loadSpeakerDeviceId();
  await Promise.all([...elements].map((el) => setAudioSink(el, id)));
}

/** Меню выбора устройств: заполняет listEl и вызывает onSelect(deviceId) */
export async function fillDeviceMenu(listEl, {
  kind,
  selectedId = '',
  onSelect,
}) {
  const devices = await listMediaDevices(kind);
  listEl.innerHTML = '';

  if (!devices.length) {
    const empty = document.createElement('div');
    empty.className = 'device-menu-empty';
    empty.textContent = 'Устройства не найдены';
    listEl.appendChild(empty);
    return;
  }

  for (const device of devices) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'device-menu-item';
    if (device.deviceId === selectedId) btn.classList.add('selected');
    btn.textContent = device.label || `Устройство ${device.deviceId.slice(0, 8)}`;
    btn.addEventListener('click', () => onSelect?.(device.deviceId, device));
    listEl.appendChild(btn);
  }
}
