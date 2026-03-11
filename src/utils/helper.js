import { useToast } from '@chakra-ui/react';

export const APP_NAME = 'VChat';
export const FILE_PATH = {
  NEW_PEER_SOUND: './audio/join.mp3',
  LEAVE_SOUND: './audio/leave.mp3',
};

export const playSound = (path) => {
  const sound = new Audio(path);
  sound.currentTime = 0;
  sound.volume = 0.75;
  sound.play().catch((err) => {
    console.error(err);
  });
};

let toastRef = null;

// Хук для инициализации глобального toast-(а)
export const useGlobalToast = () => {
  const toast = useToast();
  toastRef = toast; // сохраняем ссылку
  return toast;
};

// Функция для вызова toast-(а) из любого места
export const showToast = ({
  title,
  description,
  status = 'info', // info | warning | error | success
  duration = 3000,
  isClosable = true,
  position = 'top-right',
}) => {
  if (!toastRef) return; // если ещё не инициализирован
  toastRef({
    title,
    description,
    status,
    duration,
    isClosable,
    position,
  });
};

const KEY_CODE_TO_ACCELERATOR = {
  Numpad0: 'num0',
  Numpad1: 'num1',
  Numpad2: 'num2',
  Numpad3: 'num3',
  Numpad4: 'num4',
  Numpad5: 'num5',
  Numpad6: 'num6',
  Numpad7: 'num7',
  Numpad8: 'num8',
  Numpad9: 'num9',
  NumpadAdd: 'numadd',
  NumpadSubtract: 'numsub',
  NumpadMultiply: 'nummult',
  NumpadDivide: 'numdiv',
  NumpadDecimal: 'numdec',
  NumpadEnter: 'Enter',
  Space: 'Space',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Escape: 'Escape',
  Tab: 'Tab',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
};

export const keyCodeToAccelerator = (code) => {
  if (KEY_CODE_TO_ACCELERATOR[code]) return KEY_CODE_TO_ACCELERATOR[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (/^F\d{1,2}$/.test(code)) return code;
  return code;
};

let sharedAudioCtx;
export const getAudioContext = () => {
  if (!sharedAudioCtx) {
    sharedAudioCtx = new AudioContext();
  }

  return sharedAudioCtx;
};
