import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAppState } from './hooks/useAppState';
import { useWebSocket } from './hooks/useWebSocket';
import { usePeerConnection } from './hooks/usePeerConnection';
import { useMedia } from './hooks/useMedia';
import { useSignaling } from './hooks/useSignaling';
import { useSidebar } from './hooks/useSidebar';
import { useRoomManagement } from './hooks/useRoomManagement';
import { RoomsList } from './components/RoomsList';
import { MainInterface } from './components/MainInterface';
import { Header } from './components/Header';
import { CONFIG } from './config';
import './App.css';

function App() {
  const appState = useAppState();
  const [remoteStreams, setRemoteStreams] = useState({});
  const signalingRef = useRef(null);
  const wsManagerRef = useRef(null);
  const peerConnectionManagerRef = useRef(null);
  
  // Используем хуки для управления sidebar и комнатами
  const roomManagement = useRoomManagement();
  const { connected, currentRoom } = roomManagement;
  const sidebar = useSidebar(connected);
  const { sidebarOpen, toggleSidebar, closeSidebar, burgerMenuRef } = sidebar;

  const handleRemoteStreamUpdate = useCallback(() => {
    setRemoteStreams(prev => ({ ...prev }));
  }, []);

  const roomsListFetchRef = useRef(null);

  const wsManager = useWebSocket((msg) => {
    if (signalingRef.current) {
      signalingRef.current.handleMessage(msg);
    }
  }, () => {
    console.log('App: WebSocket onOpen callback called, wsManager.roomId =', wsManager.roomId);
    
    // При подключении WebSocket запрашиваем список пользователей в комнатах
    setTimeout(() => {
      if (roomsListFetchRef.current) {
        roomsListFetchRef.current();
      }
    }, 1000);
    
    // Если есть ожидающий join-room или roomId установлен, отправляем его
    setTimeout(() => {
      const roomIdToJoin = roomManagement.pendingJoinRoomRef.current || wsManager.roomId;
      if (roomIdToJoin && wsManager.ws && wsManager.ws.readyState === WebSocket.OPEN) {
        console.log('App: WebSocket connected, sending join-room for', roomIdToJoin);
        wsManager.send({ type: 'join-room', roomId: roomIdToJoin });
        roomManagement.pendingJoinRoomRef.current = null;
      } else {
        console.log('App: No room to join or WebSocket not ready', {
          pendingJoinRoom: roomManagement.pendingJoinRoomRef.current,
          wsManagerRoomId: wsManager.roomId,
          wsReady: wsManager.ws?.readyState
        });
      }
    }, 100);
  });

  wsManagerRef.current = wsManager;

  const peerConnectionManager = usePeerConnection(appState, wsManager, handleRemoteStreamUpdate);
  peerConnectionManagerRef.current = peerConnectionManager;

  const mediaManager = useMedia(appState, wsManager, peerConnectionManager);

  // Callback для обработки room-users сообщений
  // RoomsList установит свой обработчик через onRoomUsersUpdate
  const roomUsersCallbackRef = useRef(null);
  const handleRoomUsers = useCallback((msg) => {
    if (roomUsersCallbackRef.current) {
      roomUsersCallbackRef.current(msg);
    }
  }, []);

  // Стабильная функция для регистрации обработчика room-users
  const handleRoomUsersUpdate = useCallback((callback) => {
    roomUsersCallbackRef.current = callback;
  }, []);

  const signaling = useSignaling(
    appState,
    wsManager,
    peerConnectionManager,
    handleRemoteStreamUpdate,
    handleRoomUsers
  );

  signalingRef.current = signaling;

  const handleJoinRoom = useCallback(async (roomId) => {
    await roomManagement.handleJoinRoom(roomId, wsManager, mediaManager, peerConnectionManager, appState);
  }, [roomManagement, wsManager, mediaManager, peerConnectionManager, appState]);

  const handleLeaveRoom = useCallback(() => {
    roomManagement.handleLeaveRoom(wsManager, peerConnectionManager, appState);
  }, [roomManagement, wsManager, peerConnectionManager, appState]);

  const handleUsernameSave = useCallback((username) => {
    const currentUsername = appState.myUsername;
    appState.setMyUsername(username);
    
    // Отправляем только если username действительно изменился
    if (wsManager.ws && wsManager.ws.readyState === WebSocket.OPEN && username !== currentUsername) {
      wsManager.send({ type: 'update-username', username });
    }
  }, [appState, wsManager]);

  const handleToggleAudio = useCallback(async () => {
    await mediaManager.toggleAudio();
  }, [mediaManager]);

  const handleToggleVideo = useCallback(async () => {
    await mediaManager.toggleVideo();
  }, [mediaManager]);

  const handleToggleScreenShare = useCallback(async () => {
    await mediaManager.toggleScreenShare();
  }, [mediaManager]);

  const handleNoiseSuppressionChange = useCallback((enabled) => {
    mediaManager.setNoiseSuppression(enabled);
  }, [mediaManager]);

  // Enable audio playback on user interaction
  const playbackEnabledRef = useRef(false);
  const handlersInstalledRef = useRef(false);
  useEffect(() => {
    // Устанавливаем обработчики только один раз
    if (handlersInstalledRef.current) return;
    handlersInstalledRef.current = true;

    const enableAudioPlayback = () => {
      // Проверяем через ref, чтобы избежать множественных вызовов
      if (playbackEnabledRef.current) return;
      
      // Проверяем актуальное состояние через appState
      if (appState.playbackEnabled) {
        playbackEnabledRef.current = true;
        return;
      }

      playbackEnabledRef.current = true;
      appState.setPlaybackEnabled(true);
      console.log('User gesture detected — enabling audio playback');

      const audioContext = appState.audioContext || appState.initAudioContext();
      if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume().catch(error =>
          console.warn('audioContext.resume() failed:', error)
        );
      }
    };

    ['click', 'touchstart', 'keydown'].forEach(eventType => {
      document.addEventListener(eventType, enableAudioPlayback, {
        once: true,
        passive: true
      });
    });

    // Cleanup не требуется, так как используется once: true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Пустой массив зависимостей - обработчики устанавливаются только один раз

  // Initialize audio context
  useEffect(() => {
    appState.initAudioContext();
  }, [appState]);

  // Update remote streams from appState
  useEffect(() => {
    setRemoteStreams(appState.remoteStreams);
  }, [appState.remoteStreams]);

  // Периодическая проверка и восстановление соединений
  useEffect(() => {
    if (!connected || !wsManager.ws || wsManager.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    // Отслеживаем время последней попытки восстановления для каждого peer
    const lastRecoveryAttempt = new Map();

    const checkConnections = async () => {
      const pcs = appState.pcs;
      const peerIds = Object.keys(pcs);

      for (const peerId of peerIds) {
        const pc = pcs[peerId];
        if (!pc) continue;

        // Проверяем состояние соединения
        const connectionState = pc.connectionState;
        const signalingState = pc.signalingState;
        const iceConnectionState = pc.iceConnectionState;

        // Если соединение не установлено и signaling в stable, пытаемся восстановить
        if (connectionState !== 'connected' && 
            connectionState !== 'connecting' && 
            signalingState === 'stable' && 
            !pc.makingOffer) {
          
          // Проверяем, не пытались ли мы восстановить соединение недавно
          const lastAttempt = lastRecoveryAttempt.get(peerId);
          const now = Date.now();
          const recoveryDelay = CONFIG.PEER_CONNECTION?.recoveryAttemptDelay || 1000;
          if (lastAttempt && (now - lastAttempt) < recoveryDelay) {
            continue; // Пропускаем, если недавно уже пытались
          }

          lastRecoveryAttempt.set(peerId, now);
          
          // Определяем, нужен ли ICE restart
          const useIceRestart = connectionState === 'failed' || 
                               iceConnectionState === 'failed' ||
                               (iceConnectionState === 'disconnected' && (now - (pc.lastConnectedTime || now)) > 5000);
          
          console.log(`Connection check: attempting to restore connection with ${peerId}`, {
            connectionState,
            signalingState,
            iceConnectionState
          });

          try {
            // Отправляем offer для восстановления соединения с ICE restart при необходимости
            const {tracks} = appState;
            const hasTracks = (tracks.audio && tracks.audio.readyState === 'live') ||
                             (tracks.video && tracks.video.enabled && tracks.video.readyState === 'live') ||
                             (tracks.screen && tracks.screen.readyState !== 'ended');

            if (hasTracks) {
              pc.makingOffer = true;
              const offerOptions = useIceRestart ? { iceRestart: true } : {};
              const offer = await pc.createOffer(offerOptions);
              await pc.setLocalDescription(offer);
              wsManager.send({type: 'offer', offer: pc.localDescription, to: peerId});
              console.log(`Sent recovery offer to ${peerId}${useIceRestart ? ' with ICE restart' : ''}`);
              pc.makingOffer = false;
            }
          } catch (error) {
            console.error(`Error sending recovery offer to ${peerId}:`, error);
            pc.makingOffer = false;
          }
        } else if (connectionState === 'connected') {
          // Если соединение установлено, удаляем из отслеживания
          lastRecoveryAttempt.delete(peerId);
        }
      }
    };

    // КРИТИЧНО: Проверяем соединения чаще для максимальной стабильности
    // Используем конфигурацию из CONFIG для согласованности
    const checkInterval = CONFIG.PEER_CONNECTION?.connectionCheckInterval || 2000;
    const interval = setInterval(checkConnections, checkInterval);

    return () => {
      clearInterval(interval);
    };
  }, [connected, wsManager, appState, peerConnectionManager]);

  return (
    <div className="App">
      <Header 
        onUsernameSave={handleUsernameSave}
        currentUsername={appState.myUsername}
        onToggleSidebar={toggleSidebar}
        sidebarOpen={sidebarOpen}
        burgerMenuRef={burgerMenuRef}
        onNoiseSuppressionChange={handleNoiseSuppressionChange}
      />
      <RoomsList 
        ref={sidebar.sidebarRef}
        onJoinRoom={handleJoinRoom}
        onUsernameSave={handleUsernameSave}
        currentRoom={currentRoom}
        sidebarOpen={sidebarOpen}
        onCloseSidebar={closeSidebar}
        wsManager={wsManager}
        onRoomUsersUpdate={handleRoomUsersUpdate}
        onFetchReady={(fetchFn) => {
          roomsListFetchRef.current = fetchFn;
        }}
        connected={connected}
      />
      <MainInterface
        appState={appState}
        remoteStreams={remoteStreams}
        onToggleAudio={handleToggleAudio}
        onToggleVideo={handleToggleVideo}
        onToggleScreenShare={handleToggleScreenShare}
        onLeaveRoom={handleLeaveRoom}
        onUsernameSave={handleUsernameSave}
        sidebarOpen={sidebarOpen}
        connected={connected}
        currentRoom={currentRoom}
      />
    </div>
  );
}

export default App;
