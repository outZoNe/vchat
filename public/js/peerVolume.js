import { DEFAULT_PEER_VOLUME, PEER_VOLUME_KEY } from './config.js';

function clampVolume(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_PEER_VOLUME;
  return Math.min(1, Math.max(0, n));
}

function readAll() {
  try {
    const raw = localStorage.getItem(PEER_VOLUME_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function getPeerVolume(nickname) {
  const key = (nickname || '').trim();
  if (!key) return DEFAULT_PEER_VOLUME;
  const all = readAll();
  return key in all ? clampVolume(all[key]) : DEFAULT_PEER_VOLUME;
}

export function setPeerVolume(nickname, volume) {
  const key = (nickname || '').trim();
  if (!key) return clampVolume(volume);
  const all = readAll();
  const next = clampVolume(volume);
  all[key] = next;
  localStorage.setItem(PEER_VOLUME_KEY, JSON.stringify(all));
  return next;
}
