import React, {forwardRef, useEffect, useState, useRef} from 'react';
import {CONFIG} from '../config';
import './RoomsList.css';

export const RoomsList = forwardRef(function RoomsList({
                                                         onJoinRoom,
                                                         onUsernameSave,
                                                         currentRoom,
                                                         sidebarOpen = true,
                                                         onCloseSidebar,
                                                         wsManager,
                                                         onRoomUsersUpdate,
                                                         onFetchReady,
                                                         connected = false
                                                       }, ref) {
  const [rooms, setRooms] = useState([]);
  const [roomUsers, setRoomUsers] = useState({});
  const [loading, setLoading] = useState(true);
  const [wsConnected, setWsConnected] = useState(false);
  const [usersListReceived, setUsersListReceived] = useState(false);
  const roomUsersHandlerRef = useRef(null);
  const lastFetchTimeRef = useRef({});
  const fetchIntervalRef = useRef(null);

  useEffect(() => {
    const savedUsername = localStorage.getItem(CONFIG.USERNAME.storageKey) || CONFIG.USERNAME.default;
    if (onUsernameSave) {
      onUsernameSave(savedUsername);
    }
  }, [onUsernameSave]);

  useEffect(() => {
    // Парсим список комнат из переменной окружения
    const parseRooms = () => {
      let roomsList = process.env.REACT_APP_ROOMS_LIST;
      if (!roomsList) {
        setRooms([]);
        setLoading(false);
        return;
      }

      // Сначала пробуем распарсить как JSON массив
      try {
        const parsed = JSON.parse(roomsList);
        if (Array.isArray(parsed)) {
          const roomsData = parsed.map(roomName => ({
            id: String(roomName).trim(),
            name: String(roomName).trim()
          })).filter(room => room.id);
          setRooms(roomsData);
          setLoading(false);
          return;
        }
      } catch (e) {
        // Не JSON, продолжаем обработку как строку
      }

      // Убираем комментарий (все после #)
      const commentIndex = roomsList.indexOf('#');
      if (commentIndex !== -1) {
        roomsList = roomsList.substring(0, commentIndex).trim();
      }

      // Разбиваем по запятой и очищаем каждое значение
      const roomsData = roomsList.split(',').map(room => {
        // Убираем пробелы и кавычки из каждого значения
        let trimmed = room.trim();
        return {id: trimmed.replace('"', ''), name: trimmed.replace('"', '')};
      }).filter(room => room.id); // Убираем пустые значения

      setRooms(roomsData);
      setLoading(false);
    };

    parseRooms();
  }, []);

  // Обработчик для получения списка пользователей через WebSocket
  useEffect(() => {
    if (!onRoomUsersUpdate) return;

    const handleRoomUsers = (msg) => {
      if (msg.type === 'room-users' && msg.roomId && Array.isArray(msg.users)) {
        setRoomUsers(prev => ({
          ...prev,
          [msg.roomId]: msg.users || []
        }));
        // Отмечаем, что хотя бы один список пользователей был получен
        setUsersListReceived(true);
      }
    };

    // Сохраняем обработчик в ref
    roomUsersHandlerRef.current = handleRoomUsers;
    
    // Передаем функцию-обертку, которая будет вызывать актуальный обработчик
    // Используем стабильную функцию, которая не меняется при рендерах
    const callback = (msg) => {
      if (roomUsersHandlerRef.current) {
        roomUsersHandlerRef.current(msg);
      }
    };
    
    onRoomUsersUpdate(callback);
    
    // Cleanup: очищаем callback при размонтировании
    // НЕ очищаем callback, так как это может вызвать проблемы при ре-рендерах
    // Вместо этого просто обновляем ref
    return () => {
      roomUsersHandlerRef.current = null;
    };
  }, [onRoomUsersUpdate]);

  // Отслеживаем состояние подключения WebSocket
  useEffect(() => {
    if (!wsManager) return;
    
    const checkConnection = () => {
      const connected = wsManager.ws && wsManager.ws.readyState === WebSocket.OPEN;
      setWsConnected(connected);
      
      // Если WebSocket отключился, сбрасываем флаг получения списка пользователей
      if (!connected) {
        setUsersListReceived(false);
      }
    };
    
    // Проверяем сразу
    checkConnection();
    
    // Проверяем периодически
    const interval = setInterval(checkConnection, 500);
    
    return () => clearInterval(interval);
  }, [wsManager]);

  useEffect(() => {
    if (rooms.length === 0 || !wsManager) return;

    const fetchRoomUsers = () => {
      if (!wsManager.ws || wsManager.ws.readyState !== WebSocket.OPEN) {
        return; // Не отправляем запросы, если WebSocket не подключен
      }

      const now = Date.now();
      const minInterval = 5000; // Минимальный интервал между запросами для одной комнаты - 5 секунд
      
      // Отправляем запросы на получение списка пользователей через WebSocket
      for (const room of rooms) {
        const lastFetch = lastFetchTimeRef.current[room.id] || 0;
        // Отправляем запрос только если прошло достаточно времени с последнего запроса
        if (now - lastFetch >= minInterval) {
          wsManager.send({ type: 'get-room-users', roomId: room.id });
          lastFetchTimeRef.current[room.id] = now;
        }
      }
    };

    // Сохраняем функцию для вызова при подключении WebSocket
    if (onFetchReady) {
      onFetchReady(fetchRoomUsers);
      console.log('Registered fetchRoomUsers callback');
    }

    // Подключаемся к WebSocket, если еще не подключены
    if (!wsManager.ws || wsManager.ws.readyState !== WebSocket.OPEN) {
      wsManager.connect();
      // Запросы будут отправлены автоматически при подключении через onFetchReady
    } else {
      // Если уже подключены, отправляем запросы с небольшой задержкой
      // чтобы избежать конфликтов с запросами при подключении
      setTimeout(() => fetchRoomUsers(), 500);
    }

    // Очищаем предыдущий интервал, если он был
    if (fetchIntervalRef.current) {
      clearInterval(fetchIntervalRef.current);
    }

    // Создаем новый интервал для периодического обновления
    fetchIntervalRef.current = setInterval(() => {
      fetchRoomUsers(); // fetchRoomUsers уже проверяет состояние WebSocket
    }, 10000); // Обновляем каждые 10 секунд

    return () => {
      if (fetchIntervalRef.current) {
        clearInterval(fetchIntervalRef.current);
        fetchIntervalRef.current = null;
      }
      if (onFetchReady) {
        onFetchReady(null);
      }
    };
  }, [rooms, wsManager, onFetchReady]);

  const handleJoinRoom = (roomId) => {
    // Блокируем клик, если WebSocket не подключен или список пользователей не получен
    if (!wsConnected || !usersListReceived) {
      console.log('RoomsList: Cannot join room - WebSocket not connected or users list not received', {
        wsConnected,
        usersListReceived
      });
      return;
    }
    
    console.log('RoomsList: handleJoinRoom called with roomId:', roomId);
    if (onJoinRoom) {
      console.log('RoomsList: calling onJoinRoom');
      onJoinRoom(roomId);
    } else {
      console.warn('RoomsList: onJoinRoom is not set');
    }
  };

  if (loading) {
    return (
      <div className="rooms-sidebar">
        <div className="loading">Загрузка комнат...</div>
      </div>
    );
  }

  return (
    <>
      {sidebarOpen && typeof window !== 'undefined' && window.innerWidth < 768 && onCloseSidebar && (
        <div
          className="sidebar-overlay"
          onClick={onCloseSidebar}
        />
      )}
      <div ref={ref} className={`rooms-sidebar ${!sidebarOpen ? 'collapsed' : ''}`}>
        <div className="rooms-sidebar-content">
          <div className="rooms-list">
            {rooms.length === 0 ? (
              <div className="no-rooms">Нет доступных комнат</div>
            ) : (
              rooms.map(room => (
                <div
                  key={room.id}
                  className={`room-item ${currentRoom === room.id ? 'room-item-active' : ''} ${!wsConnected || !usersListReceived ? 'room-item-disabled' : ''}`}
                  onClick={() => handleJoinRoom(room.id)}
                  title={!wsConnected || !usersListReceived ? 'Подождите подключения...' : ''}
                >
                  <div className="room-item-content">
                    <span className="room-item-name">{room.name}</span>
                    {roomUsers[room.id] && roomUsers[room.id].length > 0 && (
                      <div className="room-item-users">
                        {roomUsers[room.id].map(user => (
                          <span key={user.id} className="room-user-badge">
                            {user.username}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
});

