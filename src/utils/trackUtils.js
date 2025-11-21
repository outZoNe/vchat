/**
 * Утилиты для работы с медиа-треками
 */

/**
 * Проверяет, является ли трек screen track по его label
 */
export function isScreenTrackByLabel(track) {
  if (!track || !track.label) return false;
  const label = track.label.toLowerCase();
  return (label.includes('screen') || label.includes('display') || label.includes('monitor') || label.includes('desktop') || label.includes('window'));
}

/**
 * Проверяет, является ли stream screen stream (содержит только video без audio)
 */
export function isScreenStream(stream) {
  if (!stream) return false;
  const hasOnlyVideo = stream.getTracks().every(t => t.kind === 'video');
  const hasAudio = stream.getAudioTracks().length > 0;
  return hasOnlyVideo && !hasAudio;
}

/**
 * Определяет, является ли трек screen track
 */
export function isScreenTrack(track, appState) {
  if (!track) {
    return false;
  }

  // Проверка по ссылке на track
  if (track === appState.tracks.screen) {
    return true;
  }

  // Проверка по ID
  if (appState.tracks.screen && track.id === appState.tracks.screen.id) {
    return true;
  }

  // Проверка по label
  if (track.kind === 'video' && isScreenTrackByLabel(track)) {
    return true;
  }

  return false;
}
