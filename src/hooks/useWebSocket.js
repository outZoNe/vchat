import {useCallback, useEffect, useRef} from 'react';
import {CONFIG} from '../config';

/**
 * WebSocket Connection Manager Hook
 */
export function useWebSocket(onMessage, onOpen = null) {
  const wsRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef(null);
  const roomIdRef = useRef(null);
  const onOpenRef = useRef(onOpen);

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
    }

    reconnectAttemptsRef.current++;
    const delay = Math.min(
      CONFIG.WEBSOCKET.reconnect.maxDelay,
      CONFIG.WEBSOCKET.reconnect.baseDelay * Math.pow(2, reconnectAttemptsRef.current)
    );

    reconnectTimerRef.current = setTimeout(() => {
      if (reconnectAttemptsRef.current < CONFIG.WEBSOCKET.reconnect.maxAttempts) {
        console.log(`Reconnection attempt ${reconnectAttemptsRef.current}`);
        window.location.reload();
      } else {
        console.error('Max reconnection attempts reached');
      }
    }, delay);
  }, []);

  const connect = useCallback(() => {
    // Не создаем новое соединение, если уже есть активное
    if (wsRef.current && (wsRef.current.readyState === WebSocket.CONNECTING || wsRef.current.readyState === WebSocket.OPEN)) {
      return;
    }

    // Закрываем старое соединение, если оно существует
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch (e) {
        // Игнорируем ошибки при закрытии
      }
    }

    const url = `${CONFIG.WEBSOCKET.protocol}//${CONFIG.WEBSOCKET.host}${CONFIG.WEBSOCKET.path}`;
    wsRef.current = new WebSocket(url);

    wsRef.current.onopen = () => {
      console.log('WebSocket connected');
      reconnectAttemptsRef.current = 0;
      if (onOpenRef.current) {
        onOpenRef.current();
      }
    };

    wsRef.current.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);
        if (onMessage) {
          await onMessage(message);
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };

    wsRef.current.onclose = () => {
      console.log('WebSocket closed, attempting to reconnect...');
      scheduleReconnect();
    };

    wsRef.current.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }, [onMessage, scheduleReconnect]);

  // Обновляем ref при изменении onOpen
  useEffect(() => {
    onOpenRef.current = onOpen;
  }, [onOpen]);

  const send = useCallback((data) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        const json = JSON.stringify(data);
        wsRef.current.send(json);
        // Убираем логи для update-username, чтобы не засорять консоль
        if (data.type !== 'update-username' && data.type !== 'pong') {
          console.log('[WebSocket.send] ✅ Sent:', data.type, data);
        }
        return true;
      } catch (error) {
        console.error('[WebSocket.send] ❌ Error sending message:', error);
        return false;
      }
    }
    if (data.type !== 'update-username' && data.type !== 'pong') {
      console.warn('[WebSocket.send] ⚠️ WebSocket is not open, cannot send message. State:', wsRef.current?.readyState);
    }
    return false;
  }, []);

  const close = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
    }
    if (wsRef.current) {
      wsRef.current.close();
    }
  }, []);

  useEffect(() => {
    return () => {
      close();
    };
  }, [close]);

  return {
    connect,
    send,
    close,
    get ws() {
      return wsRef.current;
    },
    get roomId() {
      return roomIdRef.current;
    },
    set roomId(value) {
      roomIdRef.current = value;
    }
  };
}

