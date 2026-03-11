import os from 'os';
import mediasoup from 'mediasoup';

class RoomManager {
  constructor() {
    this.workers = [];
    this.webRtcServers = [];
    this.routers = [];
    this.rooms = new Map();
    this.workerRooms = new Map();
    this.deadWorkers = new Set();
    this.restartAttempts = new Map();
    this.maxRestartAttempts = 5;
    this.baseWebRtcPort = parseInt(process.env.MEDIASOUP_MIN_PORT) || 40000;
  }

  async init() {
    const numWorkers = os.cpus().length || 1;

    for (let i = 0; i < numWorkers; i++) {
      await this.createWorker(i, this.baseWebRtcPort + i);
    }

    return this.workers;
  }

  async createWorker(index, port) {
    try {
      const worker = await mediasoup.createWorker({
        logLevel: 'warn',
        logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp'],
      });

      worker.on('died', async () => {
        const attempts = this.restartAttempts.get(index) || 0;
        if (attempts >= this.maxRestartAttempts) {
          return;
        }

        this.deadWorkers.add(index);
        this.restartAttempts.set(index, attempts + 1);

        this.workers[index] = null;
        this.webRtcServers[index] = null;
        this.routers[index] = null;

        setTimeout(
          async () => {
            await this.createWorker(index, port);
          },
          1000 * Math.pow(2, attempts)
        );
      });

      const webRtcServer = await worker.createWebRtcServer({
        listenInfos: [
          {
            protocol: 'udp',
            ip: '0.0.0.0',
            announcedIp: process.env.ANNOUNCED_IP || '127.0.0.1',
            port: port,
          },
          {
            protocol: 'tcp',
            ip: '0.0.0.0',
            announcedIp: process.env.ANNOUNCED_IP || '127.0.0.1',
            port: port,
          },
        ],
      });

      const router = await worker.createRouter({
        mediaCodecs: [
          {
            kind: 'audio',
            mimeType: 'audio/opus',
            clockRate: 48000,
            channels: 2,
            parameters: {
              useinbandfec: 1,
              maxplaybackrate: 48000,
            },
          },
          {
            kind: 'video',
            mimeType: 'video/VP8',
            clockRate: 90000,
            parameters: {
              xGoogleStartBitrate: 1000,
            },
          },
        ],
      });

      this.workers[index] = worker;
      this.webRtcServers[index] = webRtcServer;
      this.routers[index] = router;

      if (!this.workerRooms.has(index)) {
        this.workerRooms.set(index, new Set());
      }

      this.deadWorkers.delete(index);
      this.restartAttempts.delete(index);
    } catch (error) {
      const attempts = this.restartAttempts.get(index) || 0;
      if (attempts < this.maxRestartAttempts) {
        this.restartAttempts.set(index, attempts + 1);
        setTimeout(
          async () => {
            await this.createWorker(index, port);
          },
          1000 * Math.pow(2, attempts)
        );
      }
    }
  }

  async getOrCreateRoom(roomId) {
    if (this.rooms.has(roomId)) {
      const room = this.rooms.get(roomId);

      if (this.deadWorkers.has(room.routerIndex) || !this.workers[room.routerIndex]) {
        this.rooms.delete(roomId);
        return this.createRoom(roomId);
      }

      return {
        router: this.routers[room.routerIndex],
        webRtcServer: this.webRtcServers[room.routerIndex],
        routerIndex: room.routerIndex,
        room,
      };
    }

    return this.createRoom(roomId);
  }

  async createRoom(roomId) {
    const routerIndex = this.getLeastLoadedRouterIndex();
    const router = this.routers[routerIndex];
    const webRtcServer = this.webRtcServers[routerIndex];

    const room = {
      id: roomId,
      routerIndex,
      router,
      webRtcServer,
      peers: new Map(),
      producers: new Map(),
      consumers: new Map(),
      transports: new Map(),
      createdAt: Date.now(),
    };

    this.rooms.set(roomId, room);
    this.workerRooms.get(routerIndex).add(roomId);

    return {
      router,
      webRtcServer,
      routerIndex,
      room,
    };
  }

  async createWebRtcTransport(roomId, peerId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error('Room not found');
    }

    if (this.deadWorkers.has(room.routerIndex) || !this.workers[room.routerIndex]) {
      throw new Error('Worker is dead');
    }

    // максимум 2 транспорта на пира (send + recv)
    const peerTransports = Array.from(room.transports.values()).filter(
      (t) => t.peerId === peerId && !t.transport.closed
    ).length;
    if (peerTransports >= 2) {
      throw new Error('Peer transport limit reached: ' + peerTransports);
    }

    try {
      const transport = await room.router.createWebRtcTransport({
        webRtcServer: room.webRtcServer,
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
        initialAvailableOutgoingBitrate: 1000000,
        enableSctp: false,
        iceConsentTimeout: 30,
      });

      this.addTransport(roomId, transport.id, transport, peerId);
      return transport;
    } catch (error) {
      if (error.message.includes('dead') || error.message.includes('closed')) {
        this.deadWorkers.add(room.routerIndex);
        throw new Error('Worker died during transport creation');
      }
      throw error;
    }
  }

  getLeastLoadedRouterIndex() {
    let minRooms = Infinity;
    let selectedIndex = 0;
    let found = false;

    for (let [index, rooms] of this.workerRooms.entries()) {
      if (this.deadWorkers.has(index)) continue;
      if (!this.workers[index]) continue;
      if (!this.routers[index]) continue;

      if (rooms.size < minRooms) {
        minRooms = rooms.size;
        selectedIndex = index;
        found = true;
      }
    }

    if (!found) {
      for (let i = 0; i < this.workers.length; i++) {
        if (!this.deadWorkers.has(i) && this.workers[i]) {
          return i;
        }
      }
      return 0;
    }

    return selectedIndex;
  }

  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  getRouterForRoom(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    if (this.deadWorkers.has(room.routerIndex) || !this.workers[room.routerIndex]) {
      return null;
    }

    return {
      router: room.router,
      webRtcServer: room.webRtcServer,
      routerIndex: room.routerIndex,
    };
  }

  addPeer(roomId, peerId, peerData) {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error('Room not found');
    }

    room.peers.set(peerId, {
      ...peerData,
      joinedAt: Date.now(),
    });

    return room.peers.get(peerId);
  }

  removePeer(roomId, peerId) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    for (const [id, data] of room.transports) {
      if (data.peerId === peerId) {
        if (!data.transport.closed) data.transport.close();
        room.transports.delete(id);
      }
    }

    for (const [id, data] of room.consumers) {
      if (data.peerId === peerId) {
        if (!data.consumer.closed) data.consumer.close();
        room.consumers.delete(id);
      }
    }

    for (const [id, data] of room.producers) {
      if (data.peerId === peerId) {
        if (!data.producer.closed) data.producer.close();
        room.producers.delete(id);
      }
    }

    room.peers.delete(peerId);

    if (room.peers.size === 0) {
      this.scheduleRoomCleanup(roomId);
    }
  }

  scheduleRoomCleanup(roomId) {
    setTimeout(
      () => {
        const room = this.rooms.get(roomId);
        if (room && room.peers.size === 0) {
          this.deleteRoom(roomId);
        }
      },
      5 * 60 * 1000 // раз в 5 мин
    );
  }

  deleteRoom(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    for (const { transport } of room.transports.values()) {
      if (!transport.closed) {
        transport.close();
      }
    }

    for (const { producer } of room.producers.values()) {
      if (!producer.closed) {
        producer.close();
      }
    }

    for (const { consumer } of room.consumers.values()) {
      if (!consumer.closed) {
        consumer.close();
      }
    }

    this.workerRooms.get(room.routerIndex).delete(roomId);
    this.rooms.delete(roomId);
  }

  addTransport(roomId, transportId, transport, peerId) {
    const room = this.rooms.get(roomId);
    if (room) {
      if (!room.transports.has(transportId)) {
        room.transports.set(transportId, { transport, peerId });
      }
    }
  }

  addProducer(roomId, producerId, producer, peerId) {
    const room = this.rooms.get(roomId);
    if (room) {
      if (!room.producers.has(producerId)) {
        room.producers.set(producerId, { producer, peerId, roomId });
      }
    }
  }

  addConsumer(roomId, consumerId, consumer, peerId) {
    const room = this.rooms.get(roomId);
    if (room) {
      if (!room.consumers.has(consumerId)) {
        room.consumers.set(consumerId, { consumer, peerId, roomId });
      }
    }
  }

  removeProducer(roomId, producerId) {
    const room = this.rooms.get(roomId);
    if (room) {
      room.producers.delete(producerId);
    }
  }

  getStats() {
    const stats = {
      totalWorkers: this.workers.length,
      deadWorkers: Array.from(this.deadWorkers),
      activeWorkers: this.workers.length - this.deadWorkers.size,
      totalRouters: this.routers.length,
      totalWebRtcServers: this.webRtcServers.length,
      totalRooms: this.rooms.size,
      workers: [],
    };

    for (let i = 0; i < this.workers.length; i++) {
      const isDead = this.deadWorkers.has(i);
      const roomsInWorker = isDead ? 0 : this.workerRooms.get(i)?.size || 0;

      let transportsCount = 0;
      if (!isDead) {
        for (const room of this.workerRooms.get(i) || []) {
          const roomData = this.rooms.get(room);
          transportsCount += roomData?.transports.size || 0;
        }
      }

      stats.workers.push({
        index: i,
        webRtcPort: this.baseWebRtcPort + i,
        isDead,
        roomsCount: roomsInWorker,
        transportsCount,
        rooms: isDead ? [] : Array.from(this.workerRooms.get(i) || []),
        workerAlive: !isDead && this.workers[i]?.closed === false,
        webRtcServerAlive: !isDead && this.webRtcServers[i]?.closed === false,
        restartAttempts: this.restartAttempts.get(i) || 0,
      });
    }

    return stats;
  }

  async close() {
    for (const roomId of this.rooms.keys()) {
      this.deleteRoom(roomId);
    }

    for (let i = 0; i < this.routers.length; i++) {
      if (this.routers[i] && !this.routers[i].closed) {
        this.routers[i].close();
      }
    }

    for (let i = 0; i < this.webRtcServers.length; i++) {
      if (this.webRtcServers[i] && !this.webRtcServers[i].closed) {
        this.webRtcServers[i].close();
      }
    }

    for (let i = 0; i < this.workers.length; i++) {
      if (this.workers[i] && !this.workers[i].closed) {
        this.workers[i].close();
      }
    }
  }
}

export default RoomManager;
