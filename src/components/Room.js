import { useSelector } from 'react-redux';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Box } from '@chakra-ui/react';
import * as mediasoupClient from 'mediasoup-client';
import ControlsPanel from './ControlsPanel';
import { APP_COLORS } from '../utils/theme';
import { WS } from '../services/WebSocketManager';
import RemotePeer from './RemotePeer';
import { FaUser } from 'react-icons/fa';
import { showToast } from '../utils/helper';

const Room = () => {
  const currentRoom = useSelector((s) => s.currentRoom);
  const myUserName = useSelector((s) => s.userName);
  const echoCancellationFlag = useSelector((s) => s.echoCancellation);
  const localVideo = useSelector((s) => s.localVideo);
  const deviceRef = useRef(null);
  const localStreamRef = useRef(null);
  const localAudioRef = useRef(null);
  const localVideoRef = useRef(null);
  const sendTransportRef = useRef(null);
  const recvTransportRef = useRef(null);
  const audioProducerRef = useRef(null);
  const [remotePeers, setRemotePeers] = useState(new Map());
  const [pinnedPeerId, setPinnedPeerId] = useState(null);
  const consumersRef = useRef(new Map());
  const pendingProducersRef = useRef([]);
  const consumedProducerIdsRef = useRef(new Set());
  const echoCancellationRef = useRef(echoCancellationFlag);
  const prevEchoCancellationRef = useRef(echoCancellationFlag);

  useEffect(() => {
    echoCancellationRef.current = echoCancellationFlag;
  }, [echoCancellationFlag]);

  const startLocalStream = useCallback(async () => {
    try {
      localStreamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: echoCancellationRef.current,
          noiseSuppression: echoCancellationRef.current,
          autoGainControl: false,
        },
        video: false,
      });
      if (localAudioRef.current) localAudioRef.current.srcObject = localStreamRef.current;
    } catch (e) {
      showToast({
        title: 'Нет микрофона',
        description: 'Микрофон не найден — вы подключены без звука',
        status: 'warning',
        duration: 5000,
      });
    }
  }, []);

  useEffect(() => {
    if (prevEchoCancellationRef.current === echoCancellationFlag) return;
    prevEchoCancellationRef.current = echoCancellationFlag;

    (async () => {
      const oldTrack = localStreamRef.current?.getAudioTracks()[0];
      if (!oldTrack) return;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: echoCancellationFlag,
            noiseSuppression: echoCancellationFlag,
            autoGainControl: false,
          },
          video: false,
        });
        const newTrack = stream.getAudioTracks()[0];
        newTrack.enabled = oldTrack.enabled;

        if (audioProducerRef.current) {
          await audioProducerRef.current.replaceTrack({ track: newTrack });
        }

        localStreamRef.current.removeTrack(oldTrack);
        oldTrack.stop();
        localStreamRef.current.addTrack(newTrack);
      } catch (e) {
        console.error('Failed to apply echo cancellation:', e);
      }
    })();
  }, [echoCancellationFlag]);

  const stopLocalStream = () => {
    localStreamRef.current?.getTracks()?.forEach((t) => t.stop());
    localStreamRef.current = null;
  };

  const createRecvTransport = (options) => {
    if (!deviceRef.current?.rtpCapabilities) return;
    if (recvTransportRef.current && !recvTransportRef.current.closed) return;
    recvTransportRef.current = deviceRef.current.createRecvTransport(options);
    recvTransportRef.current.on('connect', ({ dtlsParameters }, cb) => {
      WS.send({ type: 'connectRecvTransport', data: { dtlsParameters } });
      cb();
    });
  };

  const consume = async ({ id, producerId, peerId, kind, rtpParameters, userName }) => {
    const consumer = await recvTransportRef.current.consume({ id, producerId, kind, rtpParameters });
    consumersRef.current.set(consumer.id, consumer);
    if (kind === 'video') WS.send({ type: 'resumeConsumer', data: { consumerId: id } });

    setRemotePeers((prev) => {
      const next = new Map(prev);
      const existing = next.get(peerId);

      if (kind === 'audio' && existing?.audioTrack) {
        next.set(peerId, {
          ...existing,
          screenAudioTrack: consumer.track,
          screenAudioConsumer: consumer,
        });
      } else {
        const update = {
          ...(existing ?? { peerId, userName }),
          [`${kind}Track`]: consumer.track,
          [`${kind}Consumer`]: consumer,
        };
        if (kind === 'audio') update.audioMuted = false;
        next.set(peerId, update);
      }
      return next;
    });
  };

  useEffect(() => {
    if (localVideoRef.current) localVideoRef.current.srcObject = localVideo?.srcObject ?? null;
  }, [localVideo]);

  useEffect(() => {
    if (!currentRoom) return;
    let aborted = false;
    let unsubscribe;

    const canConsume = () => recvTransportRef.current && deviceRef.current?.rtpCapabilities;

    const requestConsume = (producerId) => {
      if (consumedProducerIdsRef.current.has(producerId)) return;
      consumedProducerIdsRef.current.add(producerId);
      WS.send({ type: 'consume', data: { producerId, rtpCapabilities: deviceRef.current.rtpCapabilities } });
    };

    const handleProducerDiscovered = (producerId) => {
      if (canConsume()) {
        requestConsume(producerId);
      } else if (!pendingProducersRef.current.some((p) => p.producerId === producerId)) {
        pendingProducersRef.current.push({ producerId });
      }
    };

    (async () => {
      await startLocalStream();
      if (aborted) return;

      WS.send({ type: 'getRouterRtpCapabilities' });

      unsubscribe = WS.subscribe(async (msg) => {
        if (aborted) return;
        const { type, data } = msg;

        switch (type) {
          case 'routerRtpCapabilities':
            deviceRef.current = new mediasoupClient.Device();
            await deviceRef.current.load({ routerRtpCapabilities: data });
            WS.send({ type: 'createSendTransport' });
            break;

          case 'sendTransportCreated':
            if (!deviceRef.current?.rtpCapabilities) break;
            if (sendTransportRef.current && !sendTransportRef.current.closed) break;

            sendTransportRef.current = deviceRef.current.createSendTransport(data);
            sendTransportRef.current.on('connect', ({ dtlsParameters }, cb) => {
              WS.send({ type: 'connectSendTransport', data: { dtlsParameters } });
              cb();
            });
            sendTransportRef.current.on('produce', ({ kind, rtpParameters }, cb) => {
              const off = WS.subscribe((m) => {
                if (m.type === 'produced') {
                  cb({ id: m.data.id });
                  off();
                }
              });
              WS.send({ type: 'produce', data: { kind, rtpParameters } });
            });

            const audioTrack = localStreamRef.current?.getAudioTracks()[0];
            if (audioTrack) {
              audioProducerRef.current = await sendTransportRef.current.produce({ track: audioTrack });
            }
            WS.send({ type: 'createRecvTransport' });
            break;

          case 'recvTransportCreated':
            createRecvTransport(data);
            if (canConsume()) pendingProducersRef.current.forEach((p) => requestConsume(p.producerId));
            pendingProducersRef.current = [];
            break;

          case 'newProducer':
            handleProducerDiscovered(data.producerId);
            break;

          case 'existingProducers':
            data.forEach((p) => handleProducerDiscovered(p.producerId));
            break;

          case 'existingPeers':
            setRemotePeers((prev) => {
              const next = new Map(prev);
              data.forEach(({ peerId, userName }) => {
                if (!next.has(peerId)) {
                  next.set(peerId, { peerId, userName, audioMuted: true });
                }
              });
              return next;
            });
            break;

          case 'peerJoined': {
            const { peerId, userName } = data;
            setRemotePeers((prev) => {
              const next = new Map(prev);
              if (!next.has(peerId)) {
                next.set(peerId, { peerId, userName, audioMuted: true });
              }
              return next;
            });
            break;
          }

          case 'peerLeaved': {
            const { peerId } = data;
            setRemotePeers((prev) => {
              const next = new Map(prev);
              next.delete(peerId);
              return next;
            });
            break;
          }

          case 'consumerParameters':
            await consume(data);
            break;

          case 'producerClosed': {
            const { producerId, peerId, kind } = data;
            consumedProducerIdsRef.current.delete(producerId);

            const consumer = [...consumersRef.current.values()].find((c) => c.producerId === producerId);
            if (consumer) {
              consumer.track.stop();
              consumer.close();
              consumersRef.current.delete(consumer.id);
            }

            setRemotePeers((prev) => {
              const next = new Map(prev);
              const peer = next.get(peerId);
              if (!peer) return next;
              const updated = { ...peer };

              if (kind === 'audio' && consumer) {
                if (peer.screenAudioConsumer?.id === consumer.id) {
                  delete updated.screenAudioTrack;
                  delete updated.screenAudioConsumer;
                } else {
                  delete updated.audioTrack;
                  delete updated.audioConsumer;
                }
              } else {
                delete updated[`${kind}Track`];
                delete updated[`${kind}Consumer`];
              }

              next.set(peerId, updated);
              return next;
            });
            break;
          }

          case 'producerPaused':
          case 'producerResumed': {
            const { peerId, kind } = data;
            const paused = type === 'producerPaused';
            setRemotePeers((prev) => {
              const next = new Map(prev);
              const peer = next.get(peerId);
              if (!peer) return next;
              const updated = { ...peer };
              if (kind === 'audio') updated.audioMuted = paused;
              if (kind === 'video') updated.videoPaused = paused;
              next.set(peerId, updated);
              return next;
            });
            break;
          }

          case 'peerUserNameChanged': {
            const { peerId, userName } = data;
            setRemotePeers((prev) => {
              const next = new Map(prev);
              const peer = next.get(peerId);
              if (peer) next.set(peerId, { ...peer, userName });
              return next;
            });
            break;
          }

          default:
            break;
        }
      });
    })();

    return () => {
      aborted = true;
      unsubscribe?.();
      stopLocalStream();
      sendTransportRef.current?.close();
      recvTransportRef.current?.close();
      audioProducerRef.current?.close();
      consumersRef.current.forEach((c) => c.close());
      consumersRef.current = new Map();
      pendingProducersRef.current = [];
      consumedProducerIdsRef.current = new Set();
      deviceRef.current = null;
      sendTransportRef.current = null;
      recvTransportRef.current = null;
      audioProducerRef.current = null;
      setRemotePeers(new Map());
    };
  }, [currentRoom, startLocalStream]);

  return (
    <Box
      bg={APP_COLORS.BACKGROUND_TERTIARY}
      pb="60px"
      display="flex"
      flexDirection="column"
      alignItems="center"
      gap={4}
    >
      <Box
        display="flex"
        flexWrap="wrap"
        justifyContent="center"
        gap={4}
        width="100%"
        marginTop={4}
      >
        {/* Локальное видео */}
        <Box
          position="relative"
          width="240px"
          height="160px"
          borderRadius="12px"
          overflow="hidden"
          boxShadow="0 4px 12px rgba(0,0,0,0.3)"
          border={`2px solid ${APP_COLORS.BLURPLE}`}
          display="flex"
          alignItems="center"
          justifyContent="center"
          bg="gray.700"
        >
          {localVideo?.srcObject?.getVideoTracks()?.length ? (
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <FaUser
              size={80}
              color="gray"
            />
          )}
          <audio
            ref={localAudioRef}
            autoPlay
            playsInline
            muted
          />
          <Box
            position="absolute"
            top={2}
            color={APP_COLORS.RED}
            fontSize="12px"
            bg="rgba(0,0,0,0.4)"
            px={2}
            py={1}
            borderRadius="6px"
          >
            {myUserName ?? '(Вы)'}
          </Box>
        </Box>

        {[...remotePeers.values()].map((peer) => (
          <RemotePeer
            key={peer.peerId}
            peer={peer}
            isPinned={pinnedPeerId === peer.peerId}
            onTogglePin={() => setPinnedPeerId((prev) => (prev === peer.peerId ? null : peer.peerId))}
          />
        ))}
      </Box>

      <ControlsPanel
        localStreamRef={localStreamRef}
        sendTransportRef={sendTransportRef}
        audioProducerRef={audioProducerRef}
      />
    </Box>
  );
};

export default Room;
