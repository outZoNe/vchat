import { Client } from '../models/Client.js';

/**
 * Client Manager Service
 */
export class ClientManager {
  constructor() {
    this.clients = new Map();
  }

  addClient(id, ws, username, roomId = null) {
    const client = new Client(id, ws, username, roomId);
    this.clients.set(id, client);
    return client;
  }

  getClient(id) {
    return this.clients.get(id);
  }

  removeClient(id) {
    const client = this.clients.get(id);
    if (client) {
      client.close();
      this.clients.delete(id);
    }
  }

  getAllClients() {
    return Array.from(this.clients.values());
  }

  getClientIds() {
    return Array.from(this.clients.keys());
  }

  getExistingParticipants(excludeId, roomId = null) {
    return this.getAllClients()
      .filter(client => {
        if (client.id === excludeId) return false;
        if (roomId !== null) return client.roomId === roomId;
        return true;
      })
      .map(client => ({
        id: client.id,
        username: client.username
      }));
  }

  getClientsInRoom(roomId) {
    return this.getAllClients()
      .filter(client => client.roomId === roomId)
      .map(client => ({
        id: client.id,
        username: client.username
      }));
  }

  broadcastToRoom(data, roomId, excludeClient = null) {
    const json = JSON.stringify(data);
    let sentCount = 0;

    for (const client of this.clients.values()) {
      if (client !== excludeClient && client.roomId === roomId) {
        const success = client.send(data);
        if (success) {
          sentCount++;
        }
      }
    }

    return sentCount;
  }

  broadcast(data, excludeClient = null) {
    const json = JSON.stringify(data);
    let sentCount = 0;

    console.log(`[ClientManager.broadcast] Broadcasting ${data.type} to ${this.clients.size} clients (excluding: ${excludeClient?.id || 'none'})`);

    for (const client of this.clients.values()) {
      if (client !== excludeClient) {
        const success = client.send(data);
        if (success) {
          sentCount++;
          console.log(`[ClientManager.broadcast] Sent ${data.type} to ${client.id}`);
        } else {
          console.warn(`[ClientManager.broadcast] Failed to send ${data.type} to ${client.id}`);
        }
      }
    }

    console.log(`[ClientManager.broadcast] Sent to ${sentCount} clients`);
    return sentCount;
  }

  cleanupStaleClients(timeout) {
    const now = Date.now();
    const staleIds = [];

    for (const [id, client] of this.clients) {
      if (client.isStale(now, timeout)) {
        staleIds.push(id);
      }
    }

    staleIds.forEach(id => {
      console.log(`Closing stale connection for client ${id}`);
      this.removeClient(id);
    });

    return staleIds.length;
  }

  get size() {
    return this.clients.size;
  }
}

