import { DEFAULT_NAME, NAME_KEY } from './config.js';

export function loadName() {
  const saved = localStorage.getItem(NAME_KEY);
  if (saved && saved.trim()) return saved.trim().slice(0, 32);
  localStorage.setItem(NAME_KEY, DEFAULT_NAME);
  return DEFAULT_NAME;
}

export function saveName(name) {
  const clean = (name || '').trim().slice(0, 32) || DEFAULT_NAME;
  localStorage.setItem(NAME_KEY, clean);
  return clean;
}
