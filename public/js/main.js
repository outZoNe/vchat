import {
  fillDeviceMenu,
  loadCameraDeviceId,
  loadMicDeviceId,
  loadSpeakerDeviceId,
  saveSpeakerDeviceId,
} from './devices.js';
import { loadName, saveName } from './identity.js';
import {
  getMediaState,
  isDeafened,
  isRnnoiseEnabled,
  setRnnoiseEnabled,
  stopAllLocalMedia,
  stopLocalVideo,
  switchCamera,
  switchMicrophone,
  toggleCamera,
  toggleDeafen,
  toggleMic,
  toggleScreen,
  updateControlButtons,
} from './media.js';
import {
  getMembers,
  getMyClientId,
  getTargetRoom,
  markRoomReconnecting,
  removeMember,
  renderRooms,
  setMyClientId,
  setPresenceSnapshot,
  setRoomMembers,
  setTargetRoom,
  upsertMember,
} from './presence.js';
import { createSignalingSession } from './signaling.js';
import {
  applySpeakerToRemoteAudio,
  setRemoteAudioDeafened,
  syncRoomTiles,
} from './tiles.js';

const roomsList = document.getElementById('roomsList');
const leaveBtn = document.getElementById('leaveBtn');
const settingsBtn = document.getElementById('settingsBtn');
const headerName = document.getElementById('headerName');
const emptyState = document.getElementById('emptyState');
const videoGrid = document.getElementById('videoGrid');
const controls = document.getElementById('controls');
const sidebarToggle = document.getElementById('sidebarToggle');
const sidebarBackdrop = document.getElementById('sidebarBackdrop');
const mobileSidebarQuery = window.matchMedia('(max-width: 767px)');
const micBtn = document.getElementById('micBtn');
const camBtn = document.getElementById('camBtn');
const screenBtn = document.getElementById('screenBtn');
const deafenBtn = document.getElementById('deafenBtn');
const micPickerBtn = document.getElementById('micPickerBtn');
const camPickerBtn = document.getElementById('camPickerBtn');
const speakerPickerBtn = document.getElementById('speakerPickerBtn');
const micMenu = document.getElementById('micMenu');
const camMenu = document.getElementById('camMenu');
const speakerMenu = document.getElementById('speakerMenu');
const settingsModal = document.getElementById('settingsModal');
const nameInput = document.getElementById('nameInput');
const rnnoiseInput = document.getElementById('rnnoiseInput');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const cancelSettingsBtn = document.getElementById('cancelSettingsBtn');
const modalBackdrop = document.getElementById('modalBackdrop');

let displayName = loadName();
let sessionGen = 0;
let reconnectTimer = null;
let reconnectAttempts = 0;
let openMenu = null;

headerName.textContent = displayName;

function isMobileSidebar() {
  return mobileSidebarQuery.matches;
}

function setSidebarOpen(open) {
  document.body.classList.toggle('sidebar-open', open);
  sidebarToggle.setAttribute('aria-expanded', String(open));
  if (open) sidebarBackdrop.removeAttribute('hidden');
  else sidebarBackdrop.setAttribute('hidden', '');
}

function toggleSidebar() {
  setSidebarOpen(!document.body.classList.contains('sidebar-open'));
}

function closeSidebar() {
  setSidebarOpen(false);
}

function syncSidebarForViewport() {
  // На десктопе меню открыто по умолчанию, на мобилке скрыто
  setSidebarOpen(!isMobileSidebar());
}

function showInRoomUi(inRoom) {
  emptyState.classList.toggle('hidden', inRoom);
  videoGrid.classList.toggle('hidden', !inRoom);
  controls.classList.toggle('hidden', !inRoom);
  if (!inRoom) closeDeviceMenus();
}

function publishMicState() {
  const { micEnabled } = getMediaState();
  signaling.wsSend({ type: 'setMic', enabled: micEnabled });
}

function refreshControls() {
  updateControlButtons(micBtn, camBtn, screenBtn, deafenBtn);
  setRemoteAudioDeafened(videoGrid, isDeafened());
}

function refreshStage() {
  const room = getTargetRoom();
  if (!room) return;
  syncRoomTiles(videoGrid, {
    members: getMembers(room),
    myClientId: getMyClientId(),
    displayName,
    mediaState: getMediaState(),
  });
}

function refreshLocalTile() {
  refreshStage();
}

function refreshRooms() {
  renderRooms(roomsList, selectRoom);
}

function handlePresenceMessage(msg) {
  switch (msg.type) {
    case 'hello':
      setMyClientId(msg.clientId ?? msg.client_id);
      refreshRooms();
      refreshStage();
      return true;
    case 'roomsSnapshot':
      setPresenceSnapshot(msg.rooms || {});
      refreshRooms();
      refreshStage();
      return true;
    case 'roomSnapshot':
      setRoomMembers(msg.room, msg.members || []);
      refreshRooms();
      if (msg.room === getTargetRoom()) refreshStage();
      return true;
    case 'roomCount':
      // имена приходят через Member*; счётчик в UI из length списка
      return true;
    case 'memberJoined':
      upsertMember(msg.room, msg.member);
      refreshRooms();
      if (msg.room === getTargetRoom()) refreshStage();
      return true;
    case 'memberLeft':
      removeMember(msg.room, msg.id);
      if (msg.room === getTargetRoom()) {
        signaling?.removePublisherMedia?.(msg.id);
        refreshStage();
      }
      refreshRooms();
      return true;
    case 'memberUpdated':
      upsertMember(msg.room, msg.member);
      refreshRooms();
      if (msg.room === getTargetRoom()) refreshStage();
      return true;
    default:
      return false;
  }
}

const signaling = createSignalingSession({
  videoGrid,
  getDisplayName: () => displayName,
  getSessionGen: () => sessionGen,
  bumpSessionGen: () => {
    sessionGen += 1;
    return sessionGen;
  },
  getTargetRoom,
  onControlsChange: refreshControls,
  onConnected: () => {
    reconnectAttempts = 0;
  },
  onNeedReconnect: (reason, expectedGen) => scheduleReconnect(reason, expectedGen),
  onPresenceMessage: handlePresenceMessage,
  refreshLocalTile,
  onWsOpen: () => {
    reconnectAttempts = 0;
    const room = getTargetRoom();
    if (room) enterRoomMedia(room);
  },
});

async function enterRoomMedia(roomName) {
  showInRoomUi(true);
  refreshStage();

  try {
    await signaling.enterRoom(roomName, displayName);
    refreshStage();
    publishMicState();
    await applySpeakerToRemoteAudio(videoGrid, loadSpeakerDeviceId());
  } catch (err) {
    console.error(err);
    scheduleReconnect('Ошибка доступа к камере/микрофону', sessionGen);
  }
}

function selectRoom(room) {
  if (isMobileSidebar()) closeSidebar();
  if (!room || getTargetRoom() === room) return;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempts = 0;
  stopLocalVideo(refreshControls);
  setTargetRoom(room);
  refreshRooms();
  enterRoomMedia(room);
}

function manualLeave() {
  setTargetRoom(null);
  reconnectAttempts = 0;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  sessionGen += 1;
  signaling.wsSend({ type: 'leave' });
  signaling.closePeer();
  stopAllLocalMedia(refreshControls);
  showInRoomUi(false);
  refreshRooms();
}

function scheduleReconnect(reasonText, expectedGen) {
  if (expectedGen !== sessionGen) return;

  sessionGen += 1;
  signaling.closePeer();

  const room = getTargetRoom();
  if (room) markRoomReconnecting(room);

  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 5000);
  reconnectAttempts += 1;
  console.warn(reasonText);

  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    signaling.connect();
  }, delay);
}

function openSettings() {
  nameInput.value = displayName;
  rnnoiseInput.checked = isRnnoiseEnabled();
  settingsModal.classList.remove('hidden');
  nameInput.focus();
  nameInput.select();
}

function closeSettings() {
  settingsModal.classList.add('hidden');
}

async function saveSettings() {
  displayName = saveName(nameInput.value);
  headerName.textContent = displayName;
  signaling.wsSend({ type: 'setName', name: displayName });
  try {
    await setRnnoiseEnabled(
      rnnoiseInput.checked,
      signaling.getAudioSender(),
      refreshControls,
    );
  } catch (err) {
    console.error('Не удалось переключить шумоподавление', err);
  }
  refreshLocalTile();
  closeSettings();
}

async function onToggleCamera() {
  const sender = await toggleCamera({
    pc: signaling.getPc(),
    videoSender: signaling.getVideoSender(),
    attachVideoTrack: (track) => signaling.attachVideoTrack(track),
    onChange: () => {
      refreshControls();
      refreshLocalTile();
    },
  });
  signaling.setVideoSender(sender);
}

async function onToggleScreen() {
  const sender = await toggleScreen({
    pc: signaling.getPc(),
    videoSender: signaling.getVideoSender(),
    attachVideoTrack: (track) => signaling.attachVideoTrack(track),
    onChange: () => {
      refreshControls();
      refreshLocalTile();
    },
  });
  signaling.setVideoSender(sender);
}

function closeDeviceMenus() {
  for (const { menu, button } of [
    { menu: micMenu, button: micPickerBtn },
    { menu: camMenu, button: camPickerBtn },
    { menu: speakerMenu, button: speakerPickerBtn },
  ]) {
    menu.classList.add('hidden');
    button.setAttribute('aria-expanded', 'false');
  }
  openMenu = null;
}

async function openDevicePicker({ kind, menu, button, selectedId, onSelect }) {
  const alreadyOpen = openMenu === menu && !menu.classList.contains('hidden');
  closeDeviceMenus();
  if (alreadyOpen) return;

  await fillDeviceMenu(menu, {
    kind,
    selectedId,
    onSelect: async (deviceId) => {
      closeDeviceMenus();
      await onSelect(deviceId);
    },
  });
  menu.classList.remove('hidden');
  button.setAttribute('aria-expanded', 'true');
  openMenu = menu;
}

async function onSelectMic(deviceId) {
  try {
    await switchMicrophone(deviceId, signaling.getAudioSender(), refreshControls);
  } catch (err) {
    console.error('Не удалось переключить микрофон', err);
  }
}

async function onSelectCamera(deviceId) {
  try {
    const sender = await switchCamera(deviceId, {
      pc: signaling.getPc(),
      videoSender: signaling.getVideoSender(),
      attachVideoTrack: (track) => signaling.attachVideoTrack(track),
      onChange: () => {
        refreshControls();
        refreshLocalTile();
      },
    });
    signaling.setVideoSender(sender);
  } catch (err) {
    console.error('Не удалось переключить камеру', err);
  }
}

async function onSelectSpeaker(deviceId) {
  saveSpeakerDeviceId(deviceId);
  try {
    await applySpeakerToRemoteAudio(videoGrid, deviceId);
  } catch (err) {
    console.error('Не удалось переключить динамики', err);
  }
}

micBtn.addEventListener('click', () => {
  toggleMic(refreshControls);
  publishMicState();
});
camBtn.addEventListener('click', () => onToggleCamera());
screenBtn.addEventListener('click', () => onToggleScreen());
deafenBtn.addEventListener('click', () => {
  toggleDeafen(refreshControls);
  publishMicState();
});
leaveBtn.addEventListener('click', () => manualLeave());

micPickerBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  openDevicePicker({
    kind: 'audioinput',
    menu: micMenu,
    button: micPickerBtn,
    selectedId: loadMicDeviceId(),
    onSelect: onSelectMic,
  });
});

camPickerBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  openDevicePicker({
    kind: 'videoinput',
    menu: camMenu,
    button: camPickerBtn,
    selectedId: loadCameraDeviceId(),
    onSelect: onSelectCamera,
  });
});

speakerPickerBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  openDevicePicker({
    kind: 'audiooutput',
    menu: speakerMenu,
    button: speakerPickerBtn,
    selectedId: loadSpeakerDeviceId(),
    onSelect: onSelectSpeaker,
  });
});

document.addEventListener('click', (e) => {
  if (!openMenu) return;
  if (e.target.closest('.ctrl-group')) return;
  closeDeviceMenus();
});

sidebarToggle.addEventListener('click', () => toggleSidebar());
sidebarBackdrop.addEventListener('click', () => closeSidebar());
mobileSidebarQuery.addEventListener('change', () => syncSidebarForViewport());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isMobileSidebar() && document.body.classList.contains('sidebar-open')) {
    closeSidebar();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDeviceMenus();
});

settingsBtn.addEventListener('click', () => openSettings());
cancelSettingsBtn.addEventListener('click', () => closeSettings());
modalBackdrop.addEventListener('click', () => closeSettings());
saveSettingsBtn.addEventListener('click', () => saveSettings());
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveSettings();
  if (e.key === 'Escape') closeSettings();
});

syncSidebarForViewport();
refreshRooms();
showInRoomUi(false);
refreshControls();
signaling.connect();
