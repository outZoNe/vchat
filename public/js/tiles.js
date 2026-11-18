import { DEFAULT_PEER_VOLUME } from './config.js';
import { applySpeakerToElements, loadSpeakerDeviceId, setAudioSink } from './devices.js';
import { isDeafened } from './media.js';
import { getPeerVolume, setPeerVolume } from './peerVolume.js';
import { getMyClientId } from './presence.js';
import { unwatchAllSpeaking, unwatchSpeaking, watchSpeaking } from './speaking.js';

const PUBLISHER_RE = /peer-(\d+)/;

function peerIdFrom(value) {
  const m = PUBLISHER_RE.exec(value || '');
  return m ? m[1] : null;
}

/** SFU stamps msid as peer-<clientId>-...; в Chrome это часто только в stream.id / SDP, не в track.id */
export function publisherIdFrom(track, streams = []) {
  if (track?._vchatPublisher != null) return String(track._vchatPublisher);

  const ids = [];
  for (const s of streams) {
    if (s?.id) ids.push(s.id);
  }
  if (track?.id) ids.push(track.id);
  if (track?.label) ids.push(track.label);

  for (const id of ids) {
    const peer = peerIdFrom(id);
    if (peer) {
      track._vchatPublisher = peer;
      return peer;
    }
  }
  return null;
}

/** Когда streams пустые (syncRemoteTracks) - достаём peer id из a=msid секции по mid */
export function publisherIdFromTransceiver(pc, transceiver) {
  const track = transceiver?.receiver?.track;
  if (track?._vchatPublisher != null) return String(track._vchatPublisher);

  const fromTrack = publisherIdFrom(track, []);
  if (fromTrack) return fromTrack;

  const mid = transceiver?.mid;
  const sdp = pc?.remoteDescription?.sdp;
  if (mid == null || !sdp) return null;

  const sections = sdp.split(/\r?\n(?=m=)/);
  for (const section of sections) {
    if (!section.startsWith('m=')) continue;
    const midMatch = section.match(/\r?\na=mid:([^\r\n]+)/);
    if (!midMatch || midMatch[1] !== String(mid)) continue;

    const msidLine = section.match(/\r?\na=msid:([^\r\n]+)/);
    if (msidLine) {
      const peer = peerIdFrom(msidLine[1]);
      if (peer) {
        if (track) track._vchatPublisher = peer;
        return peer;
      }
    }

    for (const m of section.matchAll(/\smsid:([^\s]+)/g)) {
      const peer = peerIdFrom(m[1]);
      if (peer) {
        if (track) track._vchatPublisher = peer;
        return peer;
      }
    }
  }
  return null;
}

function isOwnPublisher(publisher) {
  if (publisher == null) return false;
  const me = getMyClientId();
  return me != null && String(publisher) === String(me);
}

function resolvePublisher(track, streams = [], publisherHint = null) {
  if (publisherHint != null) {
    const peer = String(publisherHint);
    if (track) track._vchatPublisher = peer;
    return peer;
  }
  return publisherIdFrom(track, streams);
}

function pickPresenceTile(videoGrid, publisher) {
  let tile = findRemoteTile(videoGrid, publisher);
  if (tile) return tile;

  // Chrome иногда не отдаёт peer-id: если ровно один пустой remote - это он
  const remotes = [...videoGrid.querySelectorAll('.tile.remote[data-publisher]')];
  if (publisher == null) {
    const empty = remotes.filter((el) => !el.classList.contains('has-video'));
    if (empty.length === 1) return empty[0];
    if (remotes.length === 1) return remotes[0];
  }
  return null;
}

function initialOf(name) {
  return (name || '?').charAt(0).toUpperCase();
}

function findRemoteTile(videoGrid, publisher) {
  if (publisher == null) return null;
  return videoGrid.querySelector(
    `.tile.remote[data-publisher="${CSS.escape(String(publisher))}"]`,
  );
}

function clearTileVideo(tile) {
  if (!tile) return;
  tile.classList.remove('has-video', 'screen');
  const video = tile.querySelector('video');
  if (video) video.srcObject = null;
}

function applyPublisherVolume(videoGrid, publisher, volume) {
  if (publisher == null) return;
  const vol = Number.isFinite(volume) ? volume : DEFAULT_PEER_VOLUME;
  videoGrid.querySelectorAll(
    `audio[data-publisher="${CSS.escape(String(publisher))}"]`,
  ).forEach((el) => {
    el.volume = vol;
  });
}

export function setRemoteAudioDeafened(videoGrid, deafened) {
  videoGrid.querySelectorAll('audio[data-publisher]').forEach((el) => {
    el.muted = !!deafened;
  });
}

export function applySpeakerToRemoteAudio(videoGrid, deviceId) {
  return applySpeakerToElements(
    videoGrid.querySelectorAll('audio[data-publisher]'),
    deviceId ?? loadSpeakerDeviceId(),
  );
}

function bindVolumeSlider(videoGrid, tile, slider) {
  slider.addEventListener('input', () => {
    const nickname = tile.querySelector('.tile-label')?.textContent || '';
    const volume = setPeerVolume(nickname, slider.value);
    tile.dataset.volume = String(volume);
    applyPublisherVolume(videoGrid, tile.dataset.publisher, volume);
  });
}

export function ensureLocalTile(videoGrid, { displayName, localStream, screenStream, camEnabled, screenEnabled, myClientId }) {
  let tile = document.getElementById('tile-local');
  if (!tile) {
    tile = document.createElement('div');
    tile.id = 'tile-local';
    tile.className = 'tile local';
    tile.innerHTML = `
      <div class="tile-avatar" id="localAvatar"></div>
      <video id="localVideo" autoplay playsinline muted></video>
      <div class="tile-label" id="localLabel"></div>
    `;
    videoGrid.prepend(tile);
  }

  if (myClientId != null) tile.dataset.publisher = String(myClientId);
  document.getElementById('localLabel').textContent = `${displayName} (вы)`;
  document.getElementById('localAvatar').textContent = initialOf(displayName);

  const video = document.getElementById('localVideo');
  if (localStream || screenStream) {
    const stream = new MediaStream();
    if (screenEnabled && screenStream) {
      screenStream.getVideoTracks().forEach((t) => stream.addTrack(t));
      tile.classList.add('screen', 'has-video');
    } else if (localStream) {
      localStream.getVideoTracks().forEach((t) => stream.addTrack(t));
      tile.classList.toggle('has-video', camEnabled);
      tile.classList.remove('screen');
    }
    video.srcObject = stream;
  }
  return tile;
}

function updateRemoteMicBadge(tile, micEnabled) {
  const badge = tile.querySelector('.tile-mic');
  if (!badge) return;
  const on = micEnabled !== false;
  tile.classList.toggle('mic-off', !on);
  if (!on) tile.classList.remove('speaking');
  badge.textContent = on ? '🎤' : '🔇';
  badge.title = on ? 'Микрофон включён' : 'Микрофон выключен';
}

function ensureRemotePresenceTile(videoGrid, member) {
  const id = `tile-peer-${member.id}`;
  let tile = document.getElementById(id);
  const nickname = member.name || 'Участник';
  const volume = getPeerVolume(nickname);

  if (!tile) {
    tile = document.createElement('div');
    tile.id = id;
    tile.className = 'tile remote';
    tile.dataset.publisher = String(member.id);
    tile.innerHTML = `
      <div class="tile-avatar"></div>
      <video autoplay playsinline></video>
      <div class="tile-mic" aria-hidden="true">🎤</div>
      <div class="tile-label"></div>
      <input type="range" class="tile-volume" min="0" max="1" step="0.01" aria-label="Громкость">
    `;
    const slider = tile.querySelector('.tile-volume');
    slider.value = String(volume);
    bindVolumeSlider(videoGrid, tile, slider);
    videoGrid.appendChild(tile);
  }

  tile.querySelector('.tile-avatar').textContent = initialOf(nickname);
  tile.querySelector('.tile-label').textContent = nickname;
  tile.dataset.volume = String(volume);
  updateRemoteMicBadge(tile, member.micEnabled);
  const slider = tile.querySelector('.tile-volume');
  if (slider && slider.value !== String(volume)) slider.value = String(volume);
  applyPublisherVolume(videoGrid, member.id, volume);
  return tile;
}

/** Тайлы всех участников комнаты сразу (аватар), медиа подцепляется отдельно */
export function syncRoomTiles(videoGrid, {
  members = [],
  myClientId,
  displayName,
  mediaState,
}) {
  const wanted = new Set(['tile-local']);

  ensureLocalTile(videoGrid, {
    displayName,
    myClientId,
    ...mediaState,
  });

  const remotes = members
    .filter((m) => m.id !== myClientId)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));

  for (const member of remotes) {
    ensureRemotePresenceTile(videoGrid, member);
    wanted.add(`tile-peer-${member.id}`);
  }

  videoGrid.querySelectorAll('.tile').forEach((tile) => {
    if (!wanted.has(tile.id)) {
      if (tile.dataset.publisher) unwatchSpeaking(tile.dataset.publisher);
      tile.remove();
    }
  });

  const livePublishers = new Set(
    members.filter((m) => m.id !== myClientId).map((m) => String(m.id)),
  );
  videoGrid.querySelectorAll('audio[data-publisher]').forEach((el) => {
    if (!livePublishers.has(el.dataset.publisher)) {
      unwatchSpeaking(el.dataset.publisher);
      el.remove();
    }
  });
}

export function upsertRemoteTile(videoGrid, track, streams = [], publisherHint = null) {
  const publisher = resolvePublisher(track, streams, publisherHint);
  // SFU может вернуть свой же publish как recv - не рисуем второй блок
  if (isOwnPublisher(publisher)) return;

  if (track.muted) {
    track.onunmute = () => upsertRemoteTile(videoGrid, track, streams, publisher);
    return;
  }

  const tile = pickPresenceTile(videoGrid, publisher);
  // Без presence-тайла не создаём orphan «Участник» - ждём syncRoomTiles
  if (!tile) return;

  if (publisher != null) tile.dataset.publisher = String(publisher);
  tile.classList.add('has-video');

  const video = tile.querySelector('video');
  const stream = video.srcObject instanceof MediaStream
    ? video.srcObject
    : new MediaStream();
  if (!stream.getTrackById(track.id)) {
    stream.getVideoTracks().forEach((t) => stream.removeTrack(t));
    stream.addTrack(track);
  }
  video.srcObject = stream;
  video.play().catch(() => {});

  track.onmute = () => {
    clearTileVideo(tile);
    track.onunmute = () => upsertRemoteTile(videoGrid, track, streams, publisher);
  };
  track.onended = () => clearTileVideo(tile);
}

export function upsertRemoteAudio(videoGrid, track, streams = [], publisherHint = null) {
  const publisher = resolvePublisher(track, streams, publisherHint);
  if (isOwnPublisher(publisher)) return;

  const id = `audio-${track.id}`;
  let audio = document.getElementById(id);
  if (!audio) {
    audio = document.createElement('audio');
    audio.id = id;
    audio.autoplay = true;
    videoGrid.appendChild(audio);
  }
  if (publisher) audio.dataset.publisher = publisher;

  const tile = findRemoteTile(videoGrid, publisher);
  const fromTile = tile?.dataset.volume != null ? Number(tile.dataset.volume) : NaN;
  const nickname = tile?.querySelector('.tile-label')?.textContent || '';
  audio.volume = Number.isFinite(fromTile) ? fromTile : getPeerVolume(nickname);
  audio.muted = isDeafened();
  setAudioSink(audio, loadSpeakerDeviceId());

  const stream = new MediaStream([track]);
  audio.srcObject = stream;
  audio.play().catch(() => {});
  if (publisher && tile) watchSpeaking(publisher, stream, tile);
  track.onended = () => {
    if (publisher) unwatchSpeaking(publisher);
    audio.remove();
  };
}

/** Убрать DOM, чьи треки больше не в активных recv-трансиверах */
export function pruneStaleMedia(videoGrid, pc) {
  if (!pc) {
    unwatchAllSpeaking();
    videoGrid.querySelectorAll('audio[id^="audio-"]').forEach((el) => el.remove());
    videoGrid.querySelectorAll('.tile.remote').forEach((tile) => clearTileVideo(tile));
    return;
  }

  const live = new Set();
  for (const t of pc.getTransceivers()) {
    const dir = t.currentDirection || t.direction;
    if (dir !== 'recvonly' && dir !== 'sendrecv') continue;
    const track = t.receiver?.track;
    if (!track || track.readyState === 'ended') continue;
    live.add(track.id);
  }

  videoGrid.querySelectorAll('audio[id^="audio-"]').forEach((el) => {
    const trackId = el.id.replace(/^audio-/, '');
    if (!live.has(trackId)) {
      if (el.dataset.publisher) unwatchSpeaking(el.dataset.publisher);
      el.remove();
    }
  });

  videoGrid.querySelectorAll('.tile.remote').forEach((tile) => {
    const video = tile.querySelector('video');
    const stream = video?.srcObject;
    if (!(stream instanceof MediaStream)) {
      clearTileVideo(tile);
      return;
    }
    const tracks = stream.getVideoTracks();
    const alive = tracks.some((t) => live.has(t.id) && t.readyState !== 'ended');
    if (!alive) clearTileVideo(tile);

    // legacy tile-{trackId} без presence
    if (tile.id.startsWith('tile-') && !tile.id.startsWith('tile-peer-')) {
      const trackId = tile.id.replace(/^tile-/, '');
      if (!live.has(trackId)) tile.remove();
    }
  });
}

export function removePublisherMedia(videoGrid, publisherId) {
  if (publisherId == null) return;
  const id = String(publisherId);
  unwatchSpeaking(id);
  videoGrid.querySelectorAll(`[data-publisher="${CSS.escape(id)}"]`).forEach((el) => el.remove());
}

export function clearRemoteTiles(videoGrid) {
  unwatchAllSpeaking();
  videoGrid.querySelectorAll('.tile.remote, audio[id^="audio-"]').forEach((el) => el.remove());
}

export function clearMediaTiles(videoGrid) {
  unwatchAllSpeaking();
  videoGrid.innerHTML = '';
}
