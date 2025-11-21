/**
 * Server Configuration
 */
export const config = {
  port: process.env.PORT || 8080,
  websocket: {
    path: '/ws',
    heartbeat: {
      interval: 30000, // 30 seconds
      timeout: 90000   // 90 seconds
    }
  },
  client: {
    defaultUsername: 'Anonymous'
  }
};

