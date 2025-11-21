import express from 'express';
import http from 'http';
import {WebSocketServer} from 'ws';
import {config} from './config.js';
import {ClientManager} from './services/ClientManager.js';
import {WebSocketService} from './services/WebSocketService.js';

// Initialize Express app
const app = express();
app.use(express.json());

const server = http.createServer(app);

// Initialize WebSocket server
const wss = new WebSocketServer({server, path: config.websocket.path});

// Initialize services
const clientManager = new ClientManager();
const wsService = new WebSocketService(wss, clientManager);

// Start heartbeat
wsService.startHeartbeat();

// Start server
server.listen(config.port, () => {
  console.log(`Server running on PORT: ${config.port}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
