import { ACTION_TYPES } from './actionTypes';

// Hydration полная замена состояния
export const hydrateState = (newState) => ({
  type: ACTION_TYPES.HYDRATE_STATE,
  payload: newState,
});

// Универсальное обновление свойств объектов
// Вариант 1: Обновление по пути (например, 'admin.email')
export const updateStateByPath = (path, value) => ({
  type: ACTION_TYPES.UPDATE_STATE,
  payload: { path, value },
});

// Вариант 2: Обновление объекта (слияние с текущим состоянием)
export const updateState = (updates) => ({
  type: ACTION_TYPES.UPDATE_STATE,
  payload: { updates },
});
