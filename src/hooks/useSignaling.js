import { useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { WS } from '../services/WebSocketManager';
import { updateState } from '../store/actions';

export const useSignaling = () => {
  const dispatch = useDispatch();
  const userName = useSelector((state) => state.userName);

  const leaveRoom = useCallback(() => {
    WS.send({ type: 'leaveRoom' });
    dispatch(updateState({ currentRoom: null }));
  }, [dispatch]);

  const joinRoom = useCallback(
    (roomName) => {
      WS.send({
        type: 'joinRoom',
        roomName: roomName,
        userName: userName || 'Anonymous',
      });
    },
    [userName]
  );

  return {
    sendMessage: WS.send.bind(WS),
    joinRoom,
    leaveRoom,
    ws: WS.ws,
  };
};
