import {v4 as uuidv4} from 'uuid';
import {config} from '../config.js';
import {MessageHandler} from './MessageHandler.js';

/**
 * WebSocket Service
 */
export class WebSocketService {
  constructor(wss, clientManager) {
    this.wss = wss;
    this.clientManager = clientManager;
    this.messageHandler = new MessageHandler(clientManager);
    this.setupServer();
  }

  setupServer() {
    this.wss.on('connection', (ws) => {
      this.handleConnection(ws);
    });
  }

  handleConnection(ws) {
    const id = uuidv4();
    const client = this.clientManager.addClient(
      id,
      ws,
      config.client.defaultUsername
    );

    console.log(`Client connected: ${id}, total: ${this.clientManager.size}`);

    // Send client their ID
    client.send({type: 'set-id', id});

    // Don't send existing participants or broadcast new participant here
    // This will be handled when client joins a room via join-room message

    // Setup message handler
    ws.on('message', (msg) => {
      try {
        const data = JSON.parse(msg.toString());
        console.log(`[WebSocketService] Received message from ${id}:`, data.type, data);
        this.messageHandler.handleMessage(id, data);
      } catch (error) {
        console.error(`[WebSocketService] Error handling message from ${id}:`, error);
      }
    });

    // Setup close handler
    ws.on('close', () => {
      this.handleDisconnection(id);
    });

    // Setup error handler
    ws.on('error', (error) => {
      console.error(`WebSocket error for ${id}:`, error);
    });
  }

  handleDisconnection(id) {
    const client = this.clientManager.getClient(id);
    if (client && client.roomId) {
      // Notify clients in the same room about participant leaving
      this.clientManager.broadcastToRoom({type: 'participant-left', id}, client.roomId);
    }
    this.clientManager.removeClient(id);
    console.log(`Client disconnected: ${id}, total: ${this.clientManager.size}`);
  }

  startHeartbeat() {
    setInterval(() => {
      // Cleanup stale clients
      this.clientManager.cleanupStaleClients(config.websocket.heartbeat.timeout);

      // Send heartbeat to all clients
      for (const client of this.clientManager.getAllClients()) {
        try {
          const now = Date.now();
          client.send({type: 'ping', ts: now});
        } catch (error) {
          console.warn(`Heartbeat send failed for ${client.id}:`, error);
        }
      }
    }, config.websocket.heartbeat.interval);
  }
}

