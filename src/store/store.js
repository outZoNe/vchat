import { createStore } from 'redux';
import { ACTION_TYPES } from './actionTypes';

// Загружаем имя пользователя из localStorage
const loadUserNameFromStorage = () => {
  try {
    const savedName = localStorage.getItem('userName');
    return savedName || 'Anonymous';
  } catch (error) {
    console.warn('Не удалось загрузить имя из localStorage:', error);
    return 'Anonymous';
  }
};

const loadEchoCancellationFromStorage = () => {
  try {
    const saved = localStorage.getItem('echoCancellation');
    if (saved === null) return true;
    return saved === 'true';
  } catch (error) {
    console.warn('Не удалось загрузить echoCancellation из localStorage:', error);
    return true;
  }
};

const loadKeyFromStorage = (key, defaultValue) => {
  try {
    const saved = localStorage.getItem(key);
    return saved || defaultValue;
  } catch {
    return defaultValue;
  }
};

// Начальное состояние
const initialState = {
  menuIsOpen: true,
  userName: loadUserNameFromStorage(),
  rooms: [],
  wsConnected: false,
  currentRoom: null,
  clientVersion: null,
  serverVersion: null,
  localVideo: { srcObject: null },
  peerId: null,
  globalMuted: false,
  muteMicKey: loadKeyFromStorage('muteMicKey', 'Numpad4'),
  mutePeersKey: loadKeyFromStorage('mutePeersKey', 'Numpad5'),
  switchScreen: loadKeyFromStorage('switchScreen', 'Numpad9'),
  echoCancellation: loadEchoCancellationFromStorage(),
};

// Вспомогательная функция для глубокого обновления вложенных объектов
const deepUpdate = (state, path, value) => {
  const keys = path.split('.');
  const newState = { ...state };
  let current = newState;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    current[key] = { ...current[key] };
    current = current[key];
  }

  current[keys[keys.length - 1]] = value;
  return newState;
};

// Reducer
const counterReducer = (state = initialState, action) => {
  switch (action.type) {
    case ACTION_TYPES.HYDRATE_STATE:
      // Полная замена состояния
      return {
        ...action.payload,
      };
    case ACTION_TYPES.UPDATE_STATE:
      // Универсальное обновление свойств объектов
      // action.payload может быть:
      // 1. { path: 'admin.email', value: 'John' } - обновление по пути
      // 2. { updates: { user: { name: 'John' } } } - обновление объекта
      if (action.payload.path && action.payload.value !== undefined) {
        // Обновление по пути (например, 'admin.email')
        return deepUpdate(state, action.payload.path, action.payload.value);
      } else if (action.payload.updates) {
        // Обновление объекта (слияние)
        return {
          ...state,
          ...action.payload.updates,
        };
      }
      return state;
    default:
      return state;
  }
};

const store = createStore(counterReducer);

// Подписываемся на изменения store для сохранения имени пользователя в localStorage
store.subscribe(() => {
  const state = store.getState();

  // Сохраняем имя пользователя
  try {
    if (state.userName) {
      localStorage.setItem('userName', state.userName);
    }
  } catch (error) {
    console.warn('Не удалось сохранить имя в localStorage:', error);
  }

  // Сохраняем echoCancellation
  try {
    localStorage.setItem('echoCancellation', state.echoCancellation ? 'true' : 'false');
  } catch (error) {
    console.warn('Не удалось сохранить echoCancellation в localStorage:', error);
  }

  try {
    localStorage.setItem('muteMicKey', state.muteMicKey);
    localStorage.setItem('mutePeersKey', state.mutePeersKey);
    localStorage.setItem('switchScreen', state.switchScreen);
  } catch (error) {
    console.warn('Не удалось сохранить горячие клавишы в localStorage:', error);
  }
});

export default store;
