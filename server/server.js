import { WebSocket, WebSocketServer } from 'ws';
import RoomManager from './services/RoomManager.js';
import { AppDataSource } from './db/data-source.js';
import { Message } from './db/entities/Message.js';
import { startApi } from './api.js';

// Init DB + API
await AppDataSource.initialize();
console.log('DB connected');
await startApi();

const wss = new WebSocketServer({ port: 8080 });
const roomManager = new RoomManager();
roomManager.init().catch((e) => console.error('Failed to init mediasoup:', e));

const roomsList = process.env.ROOMS_LIST?.split(',') || [];
const peers = new Map();

const send = (ws, type, data = {}) => {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, ...data }));
};

const tpParams = (t) => ({
  id: t.id,
  iceParameters: t.iceParameters,
  iceCandidates: t.iceCandidates,
  dtlsParameters: t.dtlsParameters,
});

const getRoomsInfo = () =>
  roomsList.map((name) => ({
    name,
    peers: [...peers.values()]
      .filter((p) => p.roomName === name)
      .map((p) => ({ id: p.id, name: p.userName || 'Anonymous' })),
  }));

export const broadcastAllRooms = (data = {}, excludeWs = null) => {
  for (const { ws } of peers.values()) {
    if (ws !== excludeWs) send(ws, 'roomsList', data);
  }
};

export const broadcastToRoom = (roomName, type, data = {}, excludePeer = null) => {
  for (const p of peers.values()) {
    if (p.roomName === roomName && p !== excludePeer) send(p.ws, type, data);
  }
};

const notifyProducerClosed = (producer, peer, roomName) => {
  peer.producers = peer.producers.filter((p) => p !== producer);
  if (roomName) {
    roomManager.removeProducer(roomName, producer.id);
    broadcastToRoom(
      roomName,
      'producerClosed',
      { data: { producerId: producer.id, peerId: peer.id, kind: producer.kind } },
      peer
    );
  }
};

const connectTransport = async (transport, dtlsParameters) => {
  if (!transport || transport.closed || transport.__connected) return;
  try {
    await transport.connect({ dtlsParameters });
    transport.__connected = true;
  } catch (err) {
    if (!String(err?.message || '').includes('connect() already called')) throw err;
  }
};

const cleanupPeer = (peer) => {
  const { roomName } = peer;

  for (const producer of [...peer.producers]) {
    if (!producer?.closed) {
      notifyProducerClosed(producer, peer, roomName);
      producer.close();
    }
  }
  peer.producers = [];

  for (const c of peer.consumers) if (!c.closed) c.close();
  peer.consumers = [];

  if (peer.sendTransport && !peer.sendTransport.closed) peer.sendTransport.close();
  if (peer.recvTransport && !peer.recvTransport.closed) peer.recvTransport.close();
  peer.sendTransport = null;
  peer.recvTransport = null;

  if (roomName) {
    broadcastToRoom(
      roomName,
      'peerLeaved',
      {
        data: {
          peerId: peer.id,
          userName: peer.userName || 'Anonymous',
        },
      },
      peer
    );
    roomManager.removePeer(roomName, peer.id);
  }

  peer.roomName = null;
  peer.userName = null;
};

// раз в 30 сек проверяем "подключен ли клиент", если что, то "кикаем его". Чтобы "небыло" мертвых собеседников...
const HEARTBEAT_INTERVAL = 30_000;

wss.on('connection', (ws) => {
  const peerId = Math.random().toString(36).slice(2);
  const peer = {
    ws,
    id: peerId,
    roomName: null,
    userName: null,
    sendTransport: null,
    recvTransport: null,
    producers: [],
    consumers: [],
  };

  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  peers.set(peerId, peer);
  send(ws, 'roomsList', { rooms: getRoomsInfo() });
  send(ws, 'versions', {
    clientVersion: process.env.REACT_APP_CLIENT_VERSION,
    serverVersion: process.env.SERVER_VERSION,
  });

  ws.on('message', async (message) => {
    try {
      const { type, roomName, userName, data } = JSON.parse(message);

      switch (type) {
        case 'getRouterRtpCapabilities': {
          if (!peer.roomName) return;
          const info = roomManager.getRouterForRoom(peer.roomName);
          if (info) send(ws, 'routerRtpCapabilities', { data: info.router.rtpCapabilities });
          break;
        }

        case 'createSendTransport': {
          if (!peer.roomName) return;
          try {
            if (peer.sendTransport && !peer.sendTransport.closed) {
              send(ws, 'sendTransportCreated', { data: tpParams(peer.sendTransport) });
              break;
            }
            peer.sendTransport = await roomManager.createWebRtcTransport(peer.roomName, peer.id);
            send(ws, 'sendTransportCreated', { data: tpParams(peer.sendTransport) });
          } catch (e) {
            console.error('createSendTransport error:', e);
          }
          break;
        }

        case 'connectSendTransport':
          await connectTransport(peer.sendTransport, data.dtlsParameters);
          break;

        case 'produce': {
          try {
            if (!peer.sendTransport || peer.sendTransport.closed) break;
            let producer;
            try {
              producer = await peer.sendTransport.produce({ kind: data.kind, rtpParameters: data.rtpParameters });
            } catch (err) {
              if (String(err?.message || '').includes('MID already exists')) {
                producer = peer.producers.find((p) => !p.closed && p.kind === data.kind);
                if (producer) {
                  send(ws, 'produced', { data: { id: producer.id } });
                  break;
                }
              }
              throw err;
            }

            peer.producers.push(producer);
            if (peer.roomName) roomManager.addProducer(peer.roomName, producer.id, producer, peer.id);

            producer.on('transportclose', () => notifyProducerClosed(producer, peer, peer.roomName));
            producer.on('close', () => notifyProducerClosed(producer, peer, peer.roomName));

            send(ws, 'produced', { data: { id: producer.id } });

            if (peer.roomName) {
              broadcastToRoom(
                peer.roomName,
                'newProducer',
                {
                  data: {
                    producerId: producer.id,
                    kind: producer.kind,
                    peerId: peer.id,
                    userName: peer.userName || 'Anonymous',
                  },
                },
                peer
              );
            }
          } catch (e) {
            console.error('produce error:', e);
          }
          break;
        }

        case 'createRecvTransport': {
          if (!peer.roomName) return;
          try {
            if (peer.recvTransport && !peer.recvTransport.closed) {
              send(ws, 'recvTransportCreated', { data: tpParams(peer.recvTransport) });
              break;
            }
            peer.recvTransport = await roomManager.createWebRtcTransport(peer.roomName, peer.id);
            send(ws, 'recvTransportCreated', { data: tpParams(peer.recvTransport) });

            const existing = [];
            for (const p of peers.values()) {
              if (p.id !== peer.id && p.roomName === peer.roomName) {
                p.producers.forEach((pr) =>
                  existing.push({ producerId: pr.id, kind: pr.kind, peerId: p.id, userName: p.userName })
                );
              }
            }
            if (existing.length) send(ws, 'existingProducers', { data: existing });

            const existingPeers = [...peers.values()]
              .filter((p) => p.id !== peer.id && p.roomName === peer.roomName)
              .map((p) => ({ peerId: p.id, userName: p.userName || 'Anonymous' }));
            if (existingPeers.length) send(ws, 'existingPeers', { data: existingPeers });
          } catch (e) {
            console.error('createRecvTransport error:', e);
          }
          break;
        }

        case 'connectRecvTransport':
          await connectTransport(peer.recvTransport, data.dtlsParameters);
          break;

        case 'consume': {
          if (!peer.recvTransport || !peer.roomName) return;
          const { producerId, rtpCapabilities } = data;
          const room = roomManager.getRoom(peer.roomName);
          if (!room) return;
          const pd = room.producers.get(producerId);
          if (!pd?.producer) return;
          const pp = [...peers.values()].find((p) => p.id === pd.peerId);
          if (!pp || !room.router?.canConsume({ producerId, rtpCapabilities })) return;

          const consumer = await peer.recvTransport.consume({
            producerId,
            rtpCapabilities,
            paused: pd.producer.kind === 'video',
          });
          peer.consumers.push(consumer);
          roomManager.addConsumer(peer.roomName, consumer.id, consumer, peer.id);

          const removeSelf = () => {
            peer.consumers = peer.consumers.filter((c) => c !== consumer);
          };
          consumer.on('transportclose', removeSelf);
          consumer.on('producerclose', removeSelf);

          send(ws, 'consumerParameters', {
            data: {
              id: consumer.id,
              producerId,
              peerId: pp.id,
              kind: consumer.kind,
              rtpParameters: consumer.rtpParameters,
              userName: pp.userName || 'Anonymous',
            },
          });
          break;
        }

        case 'resumeConsumer': {
          const c = peer.consumers.find((c) => c.id === data.consumerId);
          if (c && !c.closed) await c.resume();
          break;
        }

        case 'producerPaused':
        case 'producerResumed': {
          const producer = peer.producers.find((p) => p.id === data.producerId);
          if (!producer || !peer.roomName) break;
          broadcastToRoom(
            peer.roomName,
            type,
            { data: { producerId: producer.id, peerId: peer.id, kind: producer.kind, userName: peer.userName } },
            peer
          );
          break;
        }

        case 'closeVideoProducer': {
          const producer = peer.producers.find((p) => p.id === data.producerId);
          if (!producer) break;
          producer.close();
          peer.producers = peer.producers.filter((p) => p !== producer);
          if (peer.roomName) {
            roomManager.removeProducer(peer.roomName, producer.id);
            broadcastToRoom(
              peer.roomName,
              'producerClosed',
              { data: { producerId: producer.id, peerId: peer.id, kind: producer.kind } },
              peer
            );
          }
          break;
        }

        case 'joinRoom': {
          if (!roomName) break;
          if (peer.roomName) cleanupPeer(peer);
          peer.roomName = roomName;
          peer.userName = userName || 'Anonymous';
          try {
            await roomManager.getOrCreateRoom(roomName);
            roomManager.addPeer(roomName, peer.id, { userName: peer.userName });
          } catch (e) {
            console.error(`joinRoom ${roomName}:`, e);
          }
          broadcastAllRooms({ rooms: getRoomsInfo() });
          broadcastToRoom(roomName, 'peerJoined', { data: { peerId: peer.id, userName: peer.userName } }, peer);
          send(ws, 'roomJoined', { roomName, peerId: peer.id });
          break;
        }

        case 'leaveRoom':
          cleanupPeer(peer);
          broadcastAllRooms({ rooms: getRoomsInfo() });
          break;

        case 'userNameChanged':
          if (userName.length < 1 || userName.length > 12) {
            send(ws, 'userNameChangedError', { msg: 'Имя должено быть от 1 до 12 символов' });
            break;
          }
          peer.userName = userName || 'Anonymous';
          broadcastAllRooms({ rooms: getRoomsInfo() });
          if (peer.roomName) {
            broadcastToRoom(
              peer.roomName,
              'peerUserNameChanged',
              {
                data: {
                  peerId: peer.id,
                  userName: peer.userName,
                },
              },
              peer
            );
          }
          send(ws, 'userNameUpdated', { roomName, peerId: peer.id });
          break;

        case 'getStats':
          send(ws, 'serverStats', { data: roomManager.getStats() });
          break;

        case 'sendChatMessage': {
          if (!peer.roomName || !data?.text?.trim()) break;
          const msg = AppDataSource.getRepository(Message).create({
            roomName: peer.roomName,
            username: peer.userName || 'Anonymous',
            text: data.text.trim().slice(0, 2000),
          });
          const saved = await AppDataSource.getRepository(Message).save(msg);
          const chatMsg = {
            id: saved.id,
            username: saved.username,
            text: saved.text,
            createdAt: saved.createdAt,
            attachments: [],
          };
          broadcastToRoom(peer.roomName, 'chatMessage', { data: chatMsg });
          break;
        }

        case 'ping':
          send(ws, 'pong');
          break;
        default:
          break;
      }
    } catch (e) {
      send(ws, 'error', { message: 'Invalid message format' });
      console.error('Message handling error:', e);
    }
  });

  ws.on('close', () => {
    cleanupPeer(peer);
    peers.delete(peer.id);
    broadcastAllRooms({ rooms: getRoomsInfo() });
  });

  ws.on('error', (e) => console.error(`WS error ${peerId}:`, e));
});

const heartbeatTimer = setInterval(() => {
  for (const [id, peer] of peers) {
    if (!peer.ws.isAlive) {
      console.info(`[WS] peer ${id} heartbeat timeout, terminating`);
      peer.ws.terminate();
      continue;
    }
    peer.ws.isAlive = false;
    peer.ws.ping();
  }
}, HEARTBEAT_INTERVAL);

const shutdown = async () => {
  clearInterval(heartbeatTimer);
  wss.clients.forEach((c) => c.close());
  await roomManager.close();
  wss.close(() => process.exit(0));
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log(`WS server running!`);
