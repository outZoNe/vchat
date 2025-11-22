/**
 * WebRTC Configuration
 */
export const CONFIG = {
  WEBSOCKET: {
    protocol: window.location.protocol === 'https:' ? 'wss:' : 'ws:',
    host: window.location.hostname || 'localhost',
    path: '/ws',
    reconnect: {
      maxAttempts: 10, baseDelay: 500, maxDelay: 30000
    }
  },

  ICE_SERVERS: [{urls: `stun:${process.env.REACT_APP_COTURN_IP || '127.0.0.1'}:3478`}, {
    urls: `turn:${process.env.REACT_APP_COTURN_IP || '127.0.0.1'}:3478`,
    username: process.env.REACT_APP_COTURN_USER || 'vchat',
    credential: process.env.REACT_APP_COTURN_PASSWORD || '123456'
  }],

  MEDIA: {
    audio: {audio: true, video: false}, video: {video: true, audio: false}, screen: {
      video: {
        frameRate: 60, displaySurface: 'monitor'
      }, audio: false
    }
  },

  USERNAME: {
    minLength: 1, maxLength: 15, default: "Anonymous", storageKey: "myUsername"
  },

  HEARTBEAT: {
    interval: 30000, timeout: 90000
  },

  PEER_CONNECTION: {
    offerDelay: 500,
    negotiationDelay: 100,
    // Настройки для максимальной стабильности при плохом интернете
    iceRestartInterval: 3000, // Интервал для ICE restart при проблемах (мс)
    connectionCheckInterval: 2000, // Интервал проверки соединений (мс)
    recoveryAttemptDelay: 1000, // Задержка перед попыткой восстановления (мс)
    maxRecoveryAttempts: 5, // Максимальное количество попыток восстановления подряд
    iceConnectionTimeout: 10000 // Таймаут для установления ICE соединения (мс)
  }
};

