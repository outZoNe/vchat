/**
 * Client Model
 */
export class Client {
  constructor(id, ws, username = 'Anonymous', roomId = null) {
    this.id = id;
    this.ws = ws;
    this.username = username;
    this.roomId = roomId;
    this.lastSeen = Date.now();
  }

  updateActivity() {
    this.lastSeen = Date.now();
  }

  updateUsername(username) {
    this.username = username;
  }

  updateRoom(roomId) {
    this.roomId = roomId;
  }

  isStale(now, timeout) {
    return now - this.lastSeen > timeout;
  }

  send(data) {
    if (this.ws && this.ws.readyState === 1) {
      try {
        const json = JSON.stringify(data);
        this.ws.send(json);
        console.log(`[Client.send] Sent ${data.type} to ${this.id}`);
        return true;
      } catch (error) {
        console.error(`[Client.send] Error sending to ${this.id}:`, error);
        return false;
      }
    }
    console.warn(`[Client.send] WebSocket not ready for ${this.id}, state: ${this.ws?.readyState}`);
    return false;
  }

  close() {
    try {
      this.ws.terminate();
    } catch (error) {
      // Ignore errors on close
    }
  }
}

