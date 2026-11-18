import { wsUrl } from './config.js';
import { ensureLocalMedia, getMediaState } from './media.js';
import {
  clearMediaTiles,
  pruneStaleMedia,
  publisherIdFrom,
  publisherIdFromTransceiver,
  removePublisherMedia,
  upsertRemoteAudio,
  upsertRemoteTile,
} from './tiles.js';

function preferCodecs(rtc) {
  // kind берём с receiver: у sendonly video до replaceTrack sender.track == null,
  // и в Chrome prefs не ставились → в offer уходили AV1/VP9, SFU их не форвардил.
  const kindOf = (t) => t.receiver?.track?.kind || t.sender?.track?.kind;

  const audioCaps = RTCRtpSender.getCapabilities('audio');
  if (audioCaps) {
    const opus = audioCaps.codecs.filter((c) => c.mimeType.toLowerCase() === 'audio/opus');
    if (opus.length) {
      rtc.getTransceivers().forEach((t) => {
        if (kindOf(t) === 'audio') t.setCodecPreferences(opus);
      });
    }
  }

  const videoCaps = RTCRtpSender.getCapabilities('video');
  if (videoCaps) {
    const preferred = videoCaps.codecs.filter((c) => {
      const m = c.mimeType.toLowerCase();
      return m === 'video/vp8' || m === 'video/h264';
    });
    if (preferred.length) {
      rtc.getTransceivers().forEach((t) => {
        if (kindOf(t) === 'video') t.setCodecPreferences(preferred);
      });
    }
  }
}

function offerRequestId(msg) {
  const rid = msg.requestId ?? msg.request_id;
  return typeof rid === 'number' ? rid : null;
}

export function createSignalingSession(deps) {
  const {
    videoGrid,
    getDisplayName,
    getSessionGen,
    bumpSessionGen,
    getTargetRoom,
    onConnected,
    onNeedReconnect,
    onPresenceMessage,
    refreshLocalTile,
  } = deps;

  let ws = null;
  let pc = null;
  let audioSender = null;
  let videoSender = null;
  let signalQueue = Promise.resolve();
  let makingOffer = false;
  // SFU re-offer открыт: свои offer нельзя, иначе ErrTransactionExists
  let sfuOfferInFlight = false;
  let renegotiateWanted = false;

  function wsSend(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  function enqueueSignal(label, fn) {
    signalQueue = signalQueue
      .then(async () => {
        await fn();
      })
      .catch((err) => {
        console.error(`[signal:${label}]`, err);
      });
    return signalQueue;
  }

  function resetSignalQueue() {
    signalQueue = Promise.resolve();
  }

  async function renegotiateIfNeeded(currentPc, currentGen) {
    if (!currentPc || currentGen !== getSessionGen()) return;

    if (
      currentPc.signalingState !== 'stable'
      || sfuOfferInFlight
      || currentPc._vchat?.pendingRemoteOffer
    ) {
      renegotiateWanted = true;
      return;
    }

    renegotiateWanted = false;
    makingOffer = true;
    try {
      const offer = await currentPc.createOffer();
      if (currentGen !== getSessionGen() || pc !== currentPc) return;
      if (currentPc.signalingState !== 'stable' || sfuOfferInFlight) {
        renegotiateWanted = true;
        return;
      }
      await currentPc.setLocalDescription(offer);
      wsSend({ type: 'offer', sdp: offer.sdp });
    } finally {
      makingOffer = false;
    }
  }

  async function flushRenegotiateIfWanted(currentPc, currentGen) {
    if (!renegotiateWanted) return;
    await renegotiateIfNeeded(currentPc, currentGen);
  }

  // Видео-трансивер уже sendonly с первого offer - обычно хватает replaceTrack.
  // После первого реального трека нужен re-offer: в Chrome без a=ssrc SFU не форвардит.
  async function attachVideoTrack(track) {
    if (!pc) return videoSender;
    const { localStream, screenStream } = getMediaState();
    const publishStream = (screenStream && screenStream.getTrackById(track.id))
      ? screenStream
      : localStream;
    if (!publishStream) return videoSender;

    // Камеру держим в localStream; screen track туда не мешаем (ломает msid в Chrome)
    if (publishStream === localStream && !localStream.getTrackById(track.id)) {
      localStream.addTrack(track);
    }

    if (videoSender) {
      const firstVideo = !videoSender.track;
      await videoSender.replaceTrack(track);
      if (typeof videoSender.setStreams === 'function') {
        videoSender.setStreams(publishStream);
      }
      if (firstVideo) {
        renegotiateWanted = true;
        await enqueueSignal('publish-video', () => renegotiateIfNeeded(pc, getSessionGen()));
      }
      return videoSender;
    }

    videoSender = pc.addTransceiver(track, {
      direction: 'sendonly',
      streams: [publishStream],
    }).sender;
    preferCodecs(pc);
    renegotiateWanted = true;
    await enqueueSignal('publish-video', () => renegotiateIfNeeded(pc, getSessionGen()));
    return videoSender;
  }

  function syncRemoteTracks(currentPc) {
    pruneStaleMedia(videoGrid, currentPc);
    // Только входящие от SFU. У sendonly publish тоже есть receiver.track.
    for (const t of currentPc.getTransceivers()) {
      const dir = t.currentDirection || t.direction;
      if (dir !== 'recvonly' && dir !== 'sendrecv') continue;
      const track = t.receiver?.track;
      if (!track || track.readyState === 'ended') continue;
      // streams в sync нет - publisher из mid/a=msid (Chrome часто не кладёт peer- в track.id)
      const publisher = publisherIdFromTransceiver(currentPc, t);
      if (track.kind === 'audio') upsertRemoteAudio(videoGrid, track, [], publisher);
      else upsertRemoteTile(videoGrid, track, [], publisher);
    }
  }

  function closePeer() {
    if (pc) {
      pc.onicecandidate = pc.ontrack = pc.onconnectionstatechange = null;
      pc.onnegotiationneeded = null;
      pc.close();
      pc = null;
    }
    audioSender = null;
    videoSender = null;
    makingOffer = false;
    sfuOfferInFlight = false;
    renegotiateWanted = false;
    clearMediaTiles(videoGrid);
  }

  async function createPeerConnection(currentGen) {
    const stream = await ensureLocalMedia(() => deps.onControlsChange?.());
    if (currentGen !== getSessionGen()) return null;

    const currentPc = new RTCPeerConnection({
      iceServers: [],
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    });

    let pendingCandidates = [];
    let hasRemoteDesc = false;

    // Publish только sendonly. Видео m-line сразу (стабильный порядок), трек позже через replaceTrack.
    // streams на video нужны Chrome для стабильного a=msid до появления трека.
    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) {
      audioSender = currentPc.addTransceiver(audioTrack, {
        direction: 'sendonly',
        streams: [stream],
      }).sender;
    }
    videoSender = currentPc.addTransceiver('video', {
      direction: 'sendonly',
      streams: [stream],
    }).sender;
    preferCodecs(currentPc);

    currentPc.onicecandidate = (event) => {
      if (currentGen !== getSessionGen()) return;
      if (event.candidate && ws?.readyState === WebSocket.OPEN) {
        wsSend({
          type: 'candidate',
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
        });
      }
    };

    currentPc.ontrack = (event) => {
      if (currentGen !== getSessionGen()) return;
      const track = event.track;
      const streams = event.streams || [];
      const publisher = publisherIdFrom(track, streams)
        || publisherIdFromTransceiver(currentPc, event.transceiver);
      if (track.kind === 'audio') upsertRemoteAudio(videoGrid, track, streams, publisher);
      else upsertRemoteTile(videoGrid, track, streams, publisher);
    };

    // negotiationneeded после remote offer не шлём - иначе сбивается subscribe у опоздавших

    currentPc.onconnectionstatechange = () => {
      if (currentGen !== getSessionGen() || pc !== currentPc) return;
      const state = currentPc.connectionState;
      if (state === 'connected') {
        onConnected();
        // после DTLS SFU начинает форвард; подтянуть уже согласованные треки
        syncRemoteTracks(currentPc);
      } else if (state === 'failed' || state === 'closed') {
        onNeedReconnect(`Обрыв WebRTC (${state})`, currentGen);
      } else if (state === 'disconnected') {
        setTimeout(() => {
          if (currentGen === getSessionGen() && currentPc.connectionState === 'disconnected') {
            onNeedReconnect('Таймаут медиа-канала', currentGen);
          }
        }, 3000);
      }
    };

    currentPc._vchat = {
      pendingCandidates,
      flushCandidates: async () => {
        while (pendingCandidates.length) {
          await currentPc.addIceCandidate(pendingCandidates.shift());
        }
      },
      setHasRemote: (v) => { hasRemoteDesc = v; },
      hasRemote: () => hasRemoteDesc,
      pendingRemoteOffer: null,
    };

    refreshLocalTile?.();
    return currentPc;
  }

  async function publishOffer(currentPc, currentGen) {
    makingOffer = true;
    try {
      const offer = await currentPc.createOffer();
      if (currentGen !== getSessionGen() || pc !== currentPc) return;
      await currentPc.setLocalDescription(offer);
      wsSend({ type: 'offer', sdp: offer.sdp });
    } finally {
      makingOffer = false;
    }
  }

  async function applyRemoteOffer(currentPc, meta, offerMsg, currentGen) {
    if (currentGen !== getSessionGen() || pc !== currentPc) return;

    const rid = offerRequestId(offerMsg);
    if (rid === null) {
      console.error('SFU offer без requestId, answer отправить нельзя', offerMsg);
      return;
    }

    // Ждём свой answer: rollback + subsequent offer ломает m-line order
    if (makingOffer || currentPc.signalingState === 'have-local-offer') {
      meta.pendingRemoteOffer = offerMsg;
      sfuOfferInFlight = true;
      return;
    }

    sfuOfferInFlight = true;
    try {
      await currentPc.setRemoteDescription({ type: 'offer', sdp: offerMsg.sdp });
      meta.setHasRemote(true);
      await meta.flushCandidates();
      const answer = await currentPc.createAnswer();
      await currentPc.setLocalDescription(answer);
      wsSend({
        type: 'answer',
        sdp: answer.sdp,
        requestId: rid,
        request_id: rid,
      });
      // на случай если ontrack уже прошёл или трек был в receiver до события
      syncRemoteTracks(currentPc);
    } finally {
      sfuOfferInFlight = false;
    }
    await flushRenegotiateIfWanted(currentPc, currentGen);
  }

  function handleSignalMessage(msg, currentGen) {
    if (onPresenceMessage(msg)) return;

    if (currentGen !== getSessionGen() || !pc) return;

    enqueueSignal(`msg-${msg.type}`, async () => {
      if (currentGen !== getSessionGen() || !pc) return;
      const currentPc = pc;
      const meta = currentPc._vchat;

      if (msg.type === 'answer') {
        if (currentPc.signalingState === 'have-local-offer') {
          await currentPc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
          meta.setHasRemote(true);
          await meta.flushCandidates();
          syncRemoteTracks(currentPc);
        }
        const queued = meta.pendingRemoteOffer;
        meta.pendingRemoteOffer = null;
        if (queued) await applyRemoteOffer(currentPc, meta, queued, currentGen);
        else await flushRenegotiateIfWanted(currentPc, currentGen);
      } else if (msg.type === 'offer') {
        await applyRemoteOffer(currentPc, meta, msg, currentGen);
      } else if (msg.type === 'candidate' && msg.candidate) {
        const cand = {
          candidate: msg.candidate,
          sdpMid: msg.sdpMid ?? msg.sdp_mid ?? null,
          sdpMLineIndex: msg.sdpMLineIndex ?? msg.sdp_m_line_index ?? null,
        };
        if (meta.hasRemote()) await currentPc.addIceCandidate(cand);
        else meta.pendingCandidates.push(cand);
      }
    });
  }

  function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const socket = new WebSocket(wsUrl);
    ws = socket;

    socket.onopen = () => {
      deps.onWsOpen?.();
    };

    socket.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      handleSignalMessage(msg, getSessionGen());
    };

    socket.onclose = () => {
      if (ws === socket) ws = null;
      onNeedReconnect('Связь с сервером потеряна', getSessionGen());
    };

    socket.onerror = () => {};
  }

  function isOpen() {
    return !!(ws && ws.readyState === WebSocket.OPEN);
  }

  async function enterRoom(roomName, displayName) {
    const currentGen = bumpSessionGen();
    closePeer();
    resetSignalQueue();

    if (!isOpen()) {
      connect();
      return currentGen;
    }

    wsSend({ type: 'join', room: roomName, name: displayName });

    const currentPc = await createPeerConnection(currentGen);
    if (!currentPc || currentGen !== getSessionGen()) return currentGen;
    pc = currentPc;

    await publishOffer(currentPc, currentGen);
    return currentGen;
  }

  return {
    connect,
    isOpen,
    wsSend,
    enterRoom,
    closePeer,
    attachVideoTrack,
    removePublisherMedia: (publisherId) => removePublisherMedia(videoGrid, publisherId),
    pruneStale: () => pruneStaleMedia(videoGrid, pc),
    getVideoSender: () => videoSender,
    setVideoSender: (sender) => { videoSender = sender; },
    getAudioSender: () => audioSender,
    getPc: () => pc,
  };
}
