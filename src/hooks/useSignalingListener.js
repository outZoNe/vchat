import { useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { WS } from '../services/WebSocketManager';
import { updateState } from '../store/actions';
import { FILE_PATH, playSound, showToast } from '../utils/helper';

export const useSignalingListener = () => {
  const dispatch = useDispatch();

  const wsUrl = (() => {
    const protocol = process.env.REACT_APP_WS_PROTOCOL || (window.location.protocol === 'https:' ? 'wss' : 'ws');
    const host = process.env.REACT_APP_DOMAIN || window.location.hostname || 'localhost';
    const port = process.env.REACT_APP_PORT || '443';

    return host.includes(':') ? `${protocol}://${host}/ws` : `${protocol}://${host}:${port}/ws`;
  })();

  useEffect(() => {
    WS.connect(wsUrl);

    const unsub = WS.subscribe((data) => {
      switch (data.type) {
        case 'wsConnected':
          dispatch(updateState({ wsConnected: data.value }));
          break;
        case 'versions':
          dispatch(updateState({ clientVersion: data.clientVersion, serverVersion: data.serverVersion }));
          break;
        case 'roomsList':
          dispatch(updateState({ rooms: data.rooms }));
          break;
        case 'roomJoined':
          dispatch(updateState({ currentRoom: data.roomName, peerId: data.peerId }));
          break;
        case 'peerJoined':
          playSound(FILE_PATH.NEW_PEER_SOUND);
          break;
        case 'peerLeaved':
          playSound(FILE_PATH.LEAVE_SOUND);
          break;
        case 'error':
          console.error('Server error:', data.message);
          break;
        case 'userNameChangedError':
          showToast({
            title: 'Ошибка',
            description: data?.msg || 'Ошибка',
            status: 'error',
          });
          break;
        case 'userNameUpdated':
          showToast({
            title: 'Успешно',
            description: 'Имя успешно обновлено',
            status: 'info',
          });
          break;
        case 'ping':
          break;
        default:
          break;
      }
    });

    return () => unsub();
  }, [wsUrl, dispatch]);
};
