import { APP_COLORS, SIZES } from '../utils/theme';
import {
  Box,
  Center,
  Divider,
  HStack,
  Icon,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  Tooltip,
  useBreakpointValue,
  useMediaQuery,
} from '@chakra-ui/react';
import { FaCaretUp, FaMicrophoneAlt, FaMicrophoneAltSlash, FaSignOutAlt } from 'react-icons/fa';
import { FaVideoSlash } from 'react-icons/fa6';
import { IoMdVideocam } from 'react-icons/io';
import { MdScreenShare, MdStopScreenShare } from 'react-icons/md';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSignaling } from '../hooks/useSignaling';
import { useDispatch, useSelector } from 'react-redux';
import { WS } from '../services/WebSocketManager';
import { updateStateByPath } from '../store/actions';
import { keyCodeToAccelerator } from '../utils/helper';
import ScreenPicker from './ScreenPicker';

const VIDEO_BUTTONS = [
  { mode: 'camera', on: IoMdVideocam, off: FaVideoSlash, labelOn: 'Выключить камеру', labelOff: 'Включить камеру' },
  {
    mode: 'screen',
    on: MdStopScreenShare,
    off: MdScreenShare,
    labelOn: 'Остановить демонстрацию',
    labelOff: 'Демонстрация экрана',
  },
];

const DeviceMenu = ({ devices, selectedId, onSelect, onOpen }) => (
  <Menu
    placement="top"
    onOpen={onOpen}
  >
    <MenuButton
      as={Box}
      cursor="pointer"
      display="inline-flex"
      alignItems="center"
    >
      <Icon
        as={FaCaretUp}
        boxSize={3}
        color={APP_COLORS.TEXT_SECONDARY}
        _hover={{ color: APP_COLORS.TEXT_PRIMARY }}
      />
    </MenuButton>
    <MenuList
      bg={APP_COLORS.BACKGROUND_SECONDARY}
      borderColor={APP_COLORS.BACKGROUND_TERTIARY}
      minW="200px"
    >
      {devices.length === 0 && (
        <MenuItem
          isDisabled
          color={APP_COLORS.TEXT_SECONDARY}
          fontSize="sm"
        >
          Устройства не найдены
        </MenuItem>
      )}
      {devices.map((d, i) => (
        <MenuItem
          key={d.deviceId}
          bg={selectedId === d.deviceId ? APP_COLORS.BACKGROUND_PRIMARY : 'transparent'}
          _hover={{ bg: APP_COLORS.BLURPLE }}
          color={APP_COLORS.TEXT_PRIMARY}
          fontSize="sm"
          onClick={() => onSelect(d.deviceId)}
        >
          {d.label || `Устройство ${i + 1}`}
        </MenuItem>
      ))}
    </MenuList>
  </Menu>
);

const ControlsPanel = ({ localStreamRef, sendTransportRef, audioProducerRef }) => {
  const dispatch = useDispatch();
  const globalMuted = useSelector((s) => s.globalMuted);
  const currentRoom = useSelector((s) => s.currentRoom);
  const localVideo = useSelector((s) => s.localVideo);
  const muteMicKey = useSelector((s) => s.muteMicKey);
  const mutePeersKey = useSelector((s) => s.mutePeersKey);
  const switchScreen = useSelector((s) => s.switchScreen);
  const menuIsOpen = useSelector((s) => s.menuIsOpen);
  const echoCancellation = useSelector((s) => s.echoCancellation);
  const [isDesktop] = useMediaQuery(`(min-width: ${SIZES.BREAKPOINT_DESKTOP}px)`);

  const [isAudio, setAudio] = useState(true);
  const [videoMode, setVideoMode] = useState(null);
  const [devices, setDevices] = useState([]);
  const [selectedMicId, setSelectedMicId] = useState('');
  const [selectedCameraId, setSelectedCameraId] = useState('');
  const [screenPickerOpen, setScreenPickerOpen] = useState(false);
  const [desktopSources, setDesktopSources] = useState([]);
  const videoProducerRef = useRef(null);
  const screenAudioProducerRef = useRef(null);
  const prevRoomRef = useRef(currentRoom);
  const { leaveRoom } = useSignaling();

  useEffect(() => {
    if (prevRoomRef.current !== null && prevRoomRef.current !== currentRoom) {
      if (localVideo?.srcObject) {
        localVideo.srcObject.getTracks().forEach((t) => t.stop());
      }
      dispatch(updateStateByPath('localVideo', { srcObject: null }));
      videoProducerRef.current = null;
      setVideoMode(null);
    }
    prevRoomRef.current = currentRoom;
  }, [currentRoom, dispatch, localVideo]);

  const audioDevices = devices.filter((d) => d.kind === 'audioinput');
  const videoDevices = devices.filter((d) => d.kind === 'videoinput');

  const refreshDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(all);
    } catch {
      setDevices([]);
    }
  }, []);

  // Авто выбор микрофона из всех, что нашел браузер
  useEffect(() => {
    if (selectedMicId) return;
    const id = localStreamRef.current?.getAudioTracks()[0]?.getSettings()?.deviceId;
    if (id) setSelectedMicId(id);
  }, [devices, localStreamRef, selectedMicId]);

  const setMicEnabled = useCallback(
    async (enabled) => {
      const track = localStreamRef.current?.getAudioTracks()[0];
      if (!track || !audioProducerRef.current) return;

      await audioProducerRef.current[enabled ? 'resume' : 'pause']();
      track.enabled = enabled;
      setAudio(enabled);
      WS.send({
        type: enabled ? 'producerResumed' : 'producerPaused',
        data: { producerId: audioProducerRef.current.id },
      });
    },
    [audioProducerRef, localStreamRef]
  );

  const toggleMic = useCallback(async () => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    await setMicEnabled(!track.enabled);
  }, [localStreamRef, setMicEnabled]);

  const switchMic = useCallback(
    async (deviceId) => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: deviceId },
            echoCancellation,
            noiseSuppression: echoCancellation,
            autoGainControl: false,
          },
        });
        const newTrack = stream.getAudioTracks()[0];
        newTrack.enabled = isAudio;

        if (audioProducerRef.current) {
          await audioProducerRef.current.replaceTrack({ track: newTrack });
        }

        const oldTrack = localStreamRef.current?.getAudioTracks()[0];
        if (oldTrack) {
          localStreamRef.current.removeTrack(oldTrack);
          oldTrack.stop();
        }
        localStreamRef.current?.addTrack(newTrack);

        setSelectedMicId(deviceId);
      } catch (e) {
        console.error('Failed to switch mic:', e);
      }
    },
    [audioProducerRef, echoCancellation, isAudio, localStreamRef]
  );

  // Динамически обновляем микрофон. Если пользователь например "выдернул его из ПК"
  useEffect(() => {
    const handleDeviceChange = async () => {
      await refreshDevices();

      const currentTrack = localStreamRef.current?.getAudioTracks()[0];
      if (currentTrack && currentTrack.readyState !== 'ended') return;

      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        const mic = all.find((d) => d.kind === 'audioinput');
        if (mic) await switchMic(mic.deviceId);
      } catch {}
    };

    refreshDevices().catch();
    navigator.mediaDevices?.addEventListener('devicechange', handleDeviceChange);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', handleDeviceChange);
  }, [refreshDevices, localStreamRef, switchMic]);

  const stopVideo = useCallback(() => {
    if (videoProducerRef.current) {
      videoProducerRef.current.close();
      WS.send({
        type: 'closeVideoProducer',
        data: { producerId: videoProducerRef.current.id },
      });
      videoProducerRef.current = null;
    }
    if (screenAudioProducerRef.current) {
      screenAudioProducerRef.current.close();
      WS.send({
        type: 'closeVideoProducer',
        data: { producerId: screenAudioProducerRef.current.id },
      });
      screenAudioProducerRef.current = null;
    }
    if (localVideo?.srcObject) {
      localVideo.srcObject.getTracks().forEach((t) => t.stop());
      dispatch(updateStateByPath('localVideo', { srcObject: null }));
    }
    setVideoMode(null);
  }, [dispatch, localVideo.srcObject]);

  const startScreenFromSource = useCallback(
    async (source) => {
      stopVideo();
      if (!localVideo) return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { mandatory: { chromeMediaSource: 'desktop' } },
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: source.id,
            },
          },
        });

        const videoTrack = stream.getVideoTracks()[0];
        dispatch(updateStateByPath('localVideo', { srcObject: new MediaStream([videoTrack]) }));
        videoProducerRef.current = await sendTransportRef.current.produce({ track: videoTrack });

        const audioTrack = stream.getAudioTracks()[0];
        if (audioTrack && sendTransportRef.current) {
          screenAudioProducerRef.current = await sendTransportRef.current.produce({ track: audioTrack });
        }

        setVideoMode('screen');
      } catch (e) {
        console.error(e);
      }
    },
    [dispatch, localVideo, sendTransportRef, stopVideo]
  );

  const openScreenPicker = useCallback(async () => {
    if (!window.electronAPI) return;
    const sources = await window.electronAPI.getDesktopSources();
    setDesktopSources(sources);
    setScreenPickerOpen(true);
  }, []);

  const handleScreenSelected = useCallback(
    (source) => {
      setScreenPickerOpen(false);
      startScreenFromSource(source);
    },
    [startScreenFromSource]
  );

  const startVideo = useCallback(
    async (mode) => {
      stopVideo();
      if (!localVideo) {
        console.warn('localVideo is null, cannot start', mode);
        return;
      }
      try {
        let stream;
        if (mode === 'camera') {
          stream = await navigator.mediaDevices.getUserMedia({
            video: selectedCameraId ? { deviceId: { exact: selectedCameraId } } : true,
          });
        } else if (mode === 'screen' && window.electronAPI) {
          openScreenPicker();
          return;
        } else {
          stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'monitor' } });
        }

        const videoTrack = stream.getVideoTracks()[0];
        dispatch(updateStateByPath('localVideo', { srcObject: new MediaStream([videoTrack]) }));
        videoProducerRef.current = await sendTransportRef.current.produce({ track: videoTrack });

        const audioTrack = stream.getAudioTracks()[0];
        if (audioTrack && sendTransportRef.current) {
          screenAudioProducerRef.current = await sendTransportRef.current.produce({ track: audioTrack });
        }

        setVideoMode(mode);
      } catch (e) {
        console.error(e);
      }
    },
    [dispatch, localVideo, openScreenPicker, selectedCameraId, sendTransportRef, stopVideo]
  );

  const startScreenQuick = useCallback(async () => {
    if (window.electronAPI) {
      const source = await window.electronAPI.getActiveWindowSource();
      if (source) {
        await startScreenFromSource(source);
        return;
      }
    }
    await startVideo('screen');
  }, [startScreenFromSource, startVideo]);

  const switchCamera = useCallback(
    async (deviceId) => {
      setSelectedCameraId(deviceId);
      if (videoMode !== 'camera') return;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId } } });
        const newTrack = stream.getVideoTracks()[0];

        if (videoProducerRef.current) {
          await videoProducerRef.current.replaceTrack({ track: newTrack });
        }

        if (localVideo?.srcObject) {
          localVideo.srcObject.getTracks().forEach((t) => t.stop());
        }
        dispatch(updateStateByPath('localVideo', { srcObject: new MediaStream([newTrack]) }));
      } catch (e) {
        console.error('Failed to switch camera:', e);
      }
    },
    [dispatch, localVideo, videoMode]
  );

  useEffect(() => {
    const handleKeyDown = async (e) => {
      if (e.repeat || ['INPUT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable) return;

      switch (e.code) {
        case muteMicKey:
          toggleMic().catch();
          break;
        case mutePeersKey:
          dispatch(updateStateByPath('globalMuted', !globalMuted));
          await setMicEnabled(globalMuted);
          break;
        case switchScreen:
          videoMode === 'screen' ? stopVideo() : await startScreenQuick();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    dispatch,
    globalMuted,
    muteMicKey,
    mutePeersKey,
    setMicEnabled,
    startScreenQuick,
    stopVideo,
    switchScreen,
    toggleMic,
    videoMode,
  ]);

  // Electron: глобальные горячие клавиши через IPC
  useEffect(() => {
    if (!window.electronAPI) return;

    window.electronAPI.registerShortcuts({
      muteMic: keyCodeToAccelerator(muteMicKey),
      mutePeers: keyCodeToAccelerator(mutePeersKey),
      switchScreen: keyCodeToAccelerator(switchScreen),
    });

    return window.electronAPI.onHotkeyPressed(async (action, data) => {
      switch (action) {
        case 'muteMic':
          toggleMic().catch();
          break;
        case 'mutePeers':
          dispatch(updateStateByPath('globalMuted', !globalMuted));
          await setMicEnabled(globalMuted);
          break;
        case 'switchScreen':
          if (videoMode === 'screen') {
            stopVideo();
          } else if (data) {
            await startScreenFromSource(data);
          } else {
            await startVideo('screen');
          }
          break;
        default:
          break;
      }
    });
  }, [
    dispatch,
    globalMuted,
    muteMicKey,
    mutePeersKey,
    setMicEnabled,
    startScreenFromSource,
    startVideo,
    stopVideo,
    switchScreen,
    toggleMic,
    videoMode,
  ]);

  const controlsGap = useBreakpointValue({ base: 4, md: 12 });

  return (
    <HStack
      position="fixed"
      bottom={0}
      left={isDesktop && menuIsOpen ? SIZES.SIDEBAR_WIDTH : '0px'}
      right={0}
      transition="left 0.2s ease"
      gap={controlsGap}
      bg={APP_COLORS.BACKGROUND_PRIMARY}
      p="12px"
      display={currentRoom ? 'flex' : 'none'}
      zIndex={1000}
      justifyContent="center"
      className="no-select"
    >
      <HStack spacing={1}>
        <Tooltip
          label={isAudio ? 'Микрофон включен' : 'Микрофон выключен'}
          hasArrow
        >
          <Icon
            as={isAudio ? FaMicrophoneAlt : FaMicrophoneAltSlash}
            cursor="pointer"
            boxSize={6}
            color={!isAudio ? APP_COLORS.RED : ''}
            onClick={toggleMic}
          />
        </Tooltip>
        <DeviceMenu
          devices={audioDevices}
          selectedId={selectedMicId}
          onSelect={switchMic}
          onOpen={refreshDevices}
        />
      </HStack>

      {VIDEO_BUTTONS.map(({ mode, on, off, labelOn, labelOff }) => (
        <HStack
          key={mode}
          spacing={1}
        >
          <Tooltip
            label={videoMode === mode ? labelOn : labelOff}
            hasArrow
          >
            <Icon
              as={videoMode === mode ? on : off}
              cursor="pointer"
              boxSize={6}
              color={videoMode === mode ? '' : APP_COLORS.RED}
              onClick={() => (videoMode === mode ? stopVideo() : startVideo(mode))}
            />
          </Tooltip>
          {mode === 'camera' && (
            <DeviceMenu
              devices={videoDevices}
              selectedId={selectedCameraId}
              onSelect={switchCamera}
              onOpen={refreshDevices}
            />
          )}
        </HStack>
      ))}

      <Center
        height="20px"
        paddingX={3}
      >
        <Divider
          orientation="vertical"
          borderColor={APP_COLORS.TEXT_SECONDARY}
          style={{
            borderStyle: 'groove',
          }}
        />
      </Center>

      <Tooltip
        label="Отключиться"
        hasArrow
      >
        <Icon
          as={FaSignOutAlt}
          cursor="pointer"
          boxSize={6}
          color={APP_COLORS.RED}
          _hover={{ color: APP_COLORS.RED_HOVER }}
          onClick={leaveRoom}
        />
      </Tooltip>

      <ScreenPicker
        isOpen={screenPickerOpen}
        onClose={() => setScreenPickerOpen(false)}
        onSelect={handleScreenSelected}
        sources={desktopSources}
      />
    </HStack>
  );
};

export default ControlsPanel;
