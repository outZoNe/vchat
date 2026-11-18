export const rooms = [
  'room 1',
  'room 2',
  'room 3',
  'room 4',
  'room 5',
  'room 6',
  'room 7',
  'room 8',
  'room 9',
  'room 10',
];

export const DEFAULT_NAME = 'Anonymous';
export const NAME_KEY = 'vchat_display_name';
export const PEER_VOLUME_KEY = 'vchat_peer_volumes';
export const DEFAULT_PEER_VOLUME = 0.7;
export const MIC_DEVICE_KEY = 'vchat_mic_device';
export const CAMERA_DEVICE_KEY = 'vchat_camera_device';
export const SPEAKER_DEVICE_KEY = 'vchat_speaker_device';
export const RNNOISE_KEY = 'vchat_rnnoise';
export const DEFAULT_RNNOISE = true;

// Same-origin: Caddy проксирует /ws на SFU (localhost и прод без правок)
export const wsUrl = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;
// export const wsUrl = 'ws://192.168.1.101:8080'; // для локального тестирования
