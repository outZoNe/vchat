import {useCallback, useRef, useState} from 'react';

/**
 * Хук для управления состоянием комнаты
 */
export function useRoomManagement() {
  const [connected, setConnected] = useState(false);
  const [currentRoom, setCurrentRoom] = useState(null);
  const pendingJoinRoomRef = useRef(null);
  const connectedRef = useRef(connected);
  const currentRoomRef = useRef(currentRoom);

  // Обновляем refs при изменении состояния
  connectedRef.current = connected;
  currentRoomRef.current = currentRoom;

  const handleJoinRoom = useCallback(async (roomId, wsManager, mediaManager, peerConnectionManager, appState) => {
    console.log('useRoomManagement: handleJoinRoom called with roomId:', roomId, 'connected:', connectedRef.current, 'currentRoom:', currentRoomRef.current);

    // Если уже в этой комнате, ничего не делаем
    if (connectedRef.current && currentRoomRef.current === roomId) {
      console.log('useRoomManagement: Already in this room, skipping');
      return;
    }

    const wasConnected = connectedRef.current;
    const oldRoomId = currentRoomRef.current;
    console.log('useRoomManagement: handleJoinRoom - wasConnected:', wasConnected, 'oldRoomId:', oldRoomId);

    // Если уже подключен к другой комнате, выходим из неё
    if (wasConnected && oldRoomId && oldRoomId !== roomId) {
      console.log(`Leaving room ${oldRoomId} to join ${roomId}`);

      // Отключаем камеру и демонстрацию экрана при переключении комнат
      try {
        if (appState.tracks.video && appState.tracks.video.enabled) {
          await mediaManager.disableVideo();
          console.log('useRoomManagement: Disabled video when switching rooms');
        }

        if (appState.tracks.screen) {
          await mediaManager.stopScreenSharing();
          console.log('useRoomManagement: Stopped screen sharing when switching rooms');
        }
      } catch (error) {
        console.error('useRoomManagement: Error disabling video/screen when switching rooms:', error);
      }

      // Отправляем leave-room сообщение
      if (wsManager.ws && wsManager.ws.readyState === WebSocket.OPEN) {
        wsManager.send({type: 'leave-room', roomId: oldRoomId});
      }

      // Закрываем все peer connections
      peerConnectionManager.closeAllPeerConnections();

      // Очищаем remote streams
      appState.setRemoteStreams({});
      appState.setRemoteUsernames({});
    }

    console.log('useRoomManagement: Setting currentRoom to', roomId, 'and connected to true');
    setCurrentRoom(roomId);
    setConnected(true);

    // Store roomId for use in signaling
    wsManager.roomId = roomId;
    console.log('useRoomManagement: Set wsManager.roomId to', roomId);

    // Проверяем реальное состояние WebSocket
    const wsReady = wsManager.ws && wsManager.ws.readyState === WebSocket.OPEN;

    if (!wsReady) {
      console.log('useRoomManagement: WebSocket not connected, connecting... roomId is set to', roomId);
      pendingJoinRoomRef.current = roomId;
      wsManager.connect();

      setTimeout(() => {
        if (wsManager.ws && wsManager.ws.readyState === WebSocket.OPEN && pendingJoinRoomRef.current === roomId) {
          console.log('useRoomManagement: WebSocket was already connected, sending join-room immediately for', roomId);
          wsManager.send({type: 'join-room', roomId});
          pendingJoinRoomRef.current = null;
        }
      }, 50);
    } else {
      console.log('useRoomManagement: WebSocket already connected, sending join-room for', roomId);
      wsManager.send({type: 'join-room', roomId});
      pendingJoinRoomRef.current = null;
    }

    // Auto-enable audio after connection
    try {
      await mediaManager.enableAudio();
      console.log('Microphone enabled automatically after connection');
    } catch (error) {
      console.error('Failed to enable microphone automatically:', error);
    }
  }, []);

  const handleLeaveRoom = useCallback((wsManager, peerConnectionManager, appState) => {
    console.log('useRoomManagement: handleLeaveRoom called, currentRoom:', currentRoomRef.current);

    if (!connectedRef.current || !currentRoomRef.current) {
      console.log('useRoomManagement: Not in a room, nothing to leave');
      return;
    }

    const roomIdToLeave = currentRoomRef.current;

    // Отправляем leave-room сообщение
    if (wsManager.ws && wsManager.ws.readyState === WebSocket.OPEN) {
      wsManager.send({type: 'leave-room', roomId: roomIdToLeave});
      console.log('useRoomManagement: Sent leave-room for', roomIdToLeave);
    }

    // Закрываем все peer connections
    peerConnectionManager.closeAllPeerConnections();

    // Очищаем remote streams
    appState.setRemoteStreams({});
    appState.setRemoteUsernames({});

    // Сбрасываем состояние
    setCurrentRoom(null);
    setConnected(false);
    wsManager.roomId = null;
    pendingJoinRoomRef.current = null;

    console.log('useRoomManagement: Left room', roomIdToLeave);
  }, []);

  return {
    connected,
    currentRoom,
    pendingJoinRoomRef,
    handleJoinRoom,
    handleLeaveRoom
  };
}
