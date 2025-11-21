/**
 * WebSocket Message Handler
 */
export class MessageHandler {
  constructor(clientManager) {
    this.clientManager = clientManager;
  }

  handleMessage(clientId, data) {
    const client = this.clientManager.getClient(clientId);
    if (!client) {
      console.warn(`Client ${clientId} not found`);
      return;
    }

    // Update activity timestamp
    client.updateActivity();

    console.log(`[MessageHandler] Received from ${clientId}: type=${data.type}`, data);

    switch (data.type) {
      case 'pong':
        this.handlePong(client, data);
        break;
      case 'update-username':
        this.handleUpdateUsername(client, data);
        break;
      case 'join-room':
        this.handleJoinRoom(client, data);
        break;
      case 'leave-room':
        this.handleLeaveRoom(client, data);
        break;
      case 'get-room-users':
        this.handleGetRoomUsers(client, data);
        break;
      case 'offer':
      case 'answer':
      case 'candidate':
      case 'screen-stopped':
      case 'video-disabled':
      case 'video-enabled':
        this.handlePeerConnectionMessage(client, data);
        break;
      default:
        console.warn(`Unknown message type: ${data.type}`);
    }
  }

  handlePong(client, data) {
    // Activity already updated, nothing else to do
  }

  handleUpdateUsername(client, data) {
    console.log(`[MessageHandler.handleUpdateUsername] Processing for ${client.id}`, data);

    if (!data.username || typeof data.username !== 'string') {
      console.warn(`[MessageHandler.handleUpdateUsername] Invalid username update from ${client.id}:`, data);
      return;
    }

    const oldUsername = client.username;
    client.updateUsername(data.username);
    console.log(`[MessageHandler.handleUpdateUsername] Updated username for ${client.id}: "${oldUsername}" -> "${data.username}"`);

    // Broadcast only to clients in the same room
    if (client.roomId) {
      const broadcastMessage = {
        type: 'update-username',
        username: data.username,
        from: client.id
      };
      const sentCount = this.clientManager.broadcastToRoom(broadcastMessage, client.roomId, client);
      console.log(`[MessageHandler.handleUpdateUsername] Broadcast username update for ${client.id} ("${data.username}") to ${sentCount} others in room ${client.roomId}`);
    }
  }

  handleJoinRoom(client, data) {
    if (!data.roomId) {
      console.warn(`[MessageHandler.handleJoinRoom] Invalid roomId from ${client.id}`);
      return;
    }

    const oldRoomId = client.roomId;
    
    // If client is already in a room, leave it first
    if (oldRoomId && oldRoomId !== data.roomId) {
      this.clientManager.broadcastToRoom({
        type: 'participant-left',
        id: client.id
      }, oldRoomId);
      console.log(`[MessageHandler.handleJoinRoom] Client ${client.id} left room ${oldRoomId}`);
    }
    
    client.updateRoom(data.roomId);
    console.log(`[MessageHandler.handleJoinRoom] Client ${client.id} joined room: ${data.roomId} (was: ${oldRoomId})`);

    // Send existing participants in this room to the new client
    const existingParticipants = this.clientManager.getClientsInRoom(data.roomId)
      .filter(p => p.id !== client.id);
    client.send({type: 'existing-participants', participants: existingParticipants});
    console.log(`[MessageHandler.handleJoinRoom] Sent ${existingParticipants.length} existing participants in room ${data.roomId} to ${client.id}`);

    // Notify others in the room about the new participant
    this.clientManager.broadcastToRoom({
      type: 'new-participant',
      id: client.id,
      username: client.username
    }, data.roomId, client);

    // Broadcast updated room-users list to all clients so they can see who's in the room
    const usersInRoom = this.clientManager.getClientsInRoom(data.roomId);
    this.clientManager.broadcast({
      type: 'room-users',
      roomId: data.roomId,
      users: usersInRoom
    });
    console.log(`[MessageHandler.handleJoinRoom] Broadcasted room-users update for room ${data.roomId} with ${usersInRoom.length} users to all clients`);
  }

  handleLeaveRoom(client, data) {
    const roomId = client.roomId;
    if (!roomId) {
      console.warn(`[MessageHandler.handleLeaveRoom] Client ${client.id} is not in any room`);
      return;
    }

    // Notify others in the room about participant leaving
    this.clientManager.broadcastToRoom({
      type: 'participant-left',
      id: client.id
    }, roomId);
    
    client.updateRoom(null);
    console.log(`[MessageHandler.handleLeaveRoom] Client ${client.id} left room: ${roomId}`);

    // Broadcast updated room-users list to all clients so they can see updated room status
    const usersInRoom = this.clientManager.getClientsInRoom(roomId);
    this.clientManager.broadcast({
      type: 'room-users',
      roomId: roomId,
      users: usersInRoom
    });
    console.log(`[MessageHandler.handleLeaveRoom] Broadcasted room-users update for room ${roomId} with ${usersInRoom.length} users to all clients`);
  }

  handleGetRoomUsers(client, data) {
    const roomId = data.roomId;
    if (!roomId) {
      console.warn(`[MessageHandler.handleGetRoomUsers] Invalid roomId from ${client.id}`);
      return;
    }

    const users = this.clientManager.getClientsInRoom(roomId);
    client.send({
      type: 'room-users',
      roomId: roomId,
      users: users
    });
  }

  handlePeerConnectionMessage(client, data) {
    // If message has a target, send to specific client
    if (data.to && this.clientManager.getClient(data.to)) {
      const target = this.clientManager.getClient(data.to);
      if (target.send({...data, from: client.id})) {
        console.log(`Sent ${data.type} to ${data.to}`);
      } else {
        console.warn(`Target ${data.to} not ready (state: ${target.ws?.readyState})`);
      }
    } else if (!data.to && client.roomId) {
      // Broadcast to room if client is in a room
      const count = this.clientManager.broadcastToRoom({...data, from: client.id}, client.roomId, client);
      console.log(`Broadcast ${data.type} to ${count} others in room ${client.roomId}`);
    } else if (!data.to) {
      // Fallback: broadcast to all except sender (shouldn't happen if roomId is set)
      const count = this.clientManager.broadcast({...data, from: client.id}, client);
      console.log(`Broadcast ${data.type} to ${count} others (no room)`);
    }
  }
}

