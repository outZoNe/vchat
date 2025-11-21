import {useCallback} from 'react';
import {CONFIG} from '../config';
import {isScreenTrack, isScreenTrackByLabel} from '../utils/trackUtils';
import {handleTrackEvent} from '../utils/trackEventHandler';

/**
 * Peer Connection Management Hook
 */
export function usePeerConnection(appState, wsManager, onRemoteStreamUpdate) {
  const sendOfferAfterTrackChange = useCallback(async (pc) => {
    pc.makingOffer = true;
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      wsManager.send({type: 'offer', offer: pc.localDescription, to: pc.peerId});
    } catch (error) {
      console.error('Error creating offer after track change:', error);
    } finally {
      pc.makingOffer = false;
    }
  }, [wsManager]);

  const addTrackToPeer = useCallback(async (pc, track) => {
    try {
      const kind = track.kind;
      const senders = pc.getSenders();

      // Проверяем, является ли это screen track
      const isScreenTrackValue = isScreenTrack(track, appState);

      console.log('addTrackToPeer:', {
        peerId: pc.peerId,
        kind,
        trackId: track.id,
        trackLabel: track.label,
        isScreenTrack: isScreenTrackValue,
        currentScreenTrack: appState.tracks.screen?.id,
        currentVideoTrack: appState.tracks.video?.id
      });

      if (isScreenTrackValue && kind === 'video') {
        // Для screen track всегда используем отдельный stream
        // Ищем существующий screen sender
        const screenSender = senders.find(s =>
          s.track && s.track.kind === 'video' &&
          s.track === appState.tracks.screen
        );

        // Проверяем, что video sender существует и не будет заменен
        const videoSender = senders.find(s =>
          s.track && s.track.kind === 'video' &&
          s.track !== appState.tracks.screen &&
          s.track === appState.tracks.video
        );

        if (screenSender) {
          await screenSender.replaceTrack(track);
          console.log('replaceTrack: screen on', pc.peerId, 'video sender exists:', !!videoSender);
        } else {
          // Создаем ОТДЕЛЬНЫЙ stream для screen track
          // ВАЖНО: screen track всегда в своем stream, отдельно от video
          const screenStream = new MediaStream([track]);
          pc.addTrack(track, screenStream);
          console.log('addTrack: screen to', pc.peerId, 'in separate stream, video sender exists:', !!videoSender);
        }
      } else if (kind === 'video') {
        // Для video track используем localStream (который содержит audio)
        // ВАЖНО: проверяем, что это НЕ screen track
        // Если это screen track, но не определился выше - это ошибка
        if (track === appState.tracks.screen || (appState.tracks.screen && track.id === appState.tracks.screen.id)) {
          console.error('ERROR: screen track detected in video branch! Adding as screen...', pc.peerId);
          // Добавляем как screen track
          const screenStream = new MediaStream([track]);
          pc.addTrack(track, screenStream);
          console.log('addTrack: screen to', pc.peerId, 'in separate stream (fallback)');
        } else {
          // Дополнительная проверка: если track.label содержит "screen" - это screen track
          if (isScreenTrackByLabel(track)) {
            console.error('ERROR: screen track detected in video branch by label! Adding as screen...', pc.peerId);
            // Добавляем как screen track
            const screenStream = new MediaStream([track]);
            pc.addTrack(track, screenStream);
            console.log('addTrack: screen to', pc.peerId, 'in separate stream (fallback by label)');
          } else {
            // Ищем video sender (не screen)
            const videoSender = senders.find(s => {
              if (!s.track || s.track.kind !== 'video') return false;
              return s.track !== appState.tracks.screen && s.track === appState.tracks.video;
            });

            if (videoSender) {
              await videoSender.replaceTrack(track);
              console.log('replaceTrack: video on', pc.peerId);
            } else {
              // Video track идет в localStream (который может содержать audio)
              let stream = appState.localStream;
              if (!stream) {
                stream = new MediaStream();
              }
              pc.addTrack(track, stream);
              console.log('addTrack: video to', pc.peerId, 'in localStream');
            }
          }
        }
      } else if (kind === 'audio') {
        // Audio track всегда идет в localStream
        const audioSender = senders.find(s => s.track && s.track.kind === 'audio');

        if (audioSender) {
          await audioSender.replaceTrack(track);
          console.log('replaceTrack: audio on', pc.peerId);
        } else {
          let stream = appState.localStream;
          if (!stream) {
            stream = new MediaStream();
          }
          pc.addTrack(track, stream);
          console.log('addTrack: audio to', pc.peerId, 'in localStream');
        }
      }

      if (!pc.polite) {
        await new Promise(resolve => setTimeout(resolve, CONFIG.PEER_CONNECTION.negotiationDelay));
        if (pc.signalingState === 'stable' && !pc.makingOffer && !pc.ignoreOffer) {
          await sendOfferAfterTrackChange(pc);
        }
      }
    } catch (error) {
      console.error('addTrackToPeer error:', error);
    }
  }, [appState, sendOfferAfterTrackChange]);

  const addTrackToAllPeers = useCallback(async (track) => {
    const kind = track.kind;
    const isScreenTrackValue = isScreenTrack(track, appState);

    console.log('addTrackToAllPeers: updating', kind, 'track to', Object.keys(appState.pcs).length, 'peers', {
      trackId: track.id,
      trackLabel: track.label,
      isScreenTrack: isScreenTrackValue,
      currentScreenTrack: appState.tracks.screen?.id,
      currentVideoTrack: appState.tracks.video?.id
    });

    appState.setCurrentTracks(prev => ({...prev, [kind]: track}));

    for (const id in appState.pcs) {
      const pc = appState.pcs[id];
      try {
        await addTrackToPeer(pc, track);
      } catch (error) {
        console.error('addTrackToAllPeers error for', id, error);
      }
    }
  }, [appState, addTrackToPeer]);

  const removeTrackFromAllPeers = useCallback(async (track) => {
    const kind = track.kind;
    console.log('removeTrackFromAllPeers:', kind);

    for (const id in appState.pcs) {
      const pc = appState.pcs[id];
      if (!pc) continue;

      try {
        const senders = pc.getSenders();
        const sender = senders.find(s => s.track && s.track.kind === kind);

        if (sender) {
          await sender.replaceTrack(null);
          console.log('replaceTrack(null):', kind, 'on', id);

          if (!pc.polite) {
            await new Promise(resolve => setTimeout(resolve, CONFIG.PEER_CONNECTION.negotiationDelay));
            if (pc.signalingState === 'stable' && !pc.makingOffer) {
              await sendOfferAfterTrackChange(pc);
            }
          }
        }
      } catch (error) {
        console.error('removeTrackFromAllPeers error:', error);
      }
    }
  }, [appState, sendOfferAfterTrackChange]);

  const createPeerConnection = useCallback(async (id, isCaller) => {
    if (appState.getPeerConnection(id)) {
      return appState.getPeerConnection(id);
    }

    const pc = new RTCPeerConnection({iceServers: CONFIG.ICE_SERVERS});
    pc.peerId = id;
    pc.polite = appState.myId !== null ? appState.myId > id : false;
    pc.makingOffer = false;
    pc.ignoreOffer = false;

    appState.setPeerConnection(id, pc);
    console.log('Creating peer connection for', id, 'polite:', pc.polite);

    setupPeerConnectionHandlers(pc, id, appState, wsManager, addTrackToPeer, onRemoteStreamUpdate);

    // Треки будут добавлены через rebuildAllPeerConnections или handleOffer
    // Не добавляем треки здесь, чтобы избежать конфликтов и race conditions

    return pc;
  }, [appState, addTrackToPeer, wsManager, onRemoteStreamUpdate]);

  const rebuildAllPeerConnections = useCallback(async (newPeerId) => {
    try {
      console.log('Rebuilding all peer connections. New peer:', newPeerId);

      const existing = Object.keys(appState.pcs);
      const allIds = Array.from(new Set([...existing, newPeerId].filter(Boolean)));

      existing.forEach(id => {
        try {
          appState.pcs[id]?.close();
        } catch (error) {
          // Ignore
        }
        appState.removePeerConnection(id);
      });

      // Сначала создаем все connections без отправки offers
      const connections = [];
      for (const id of allIds) {
        if (!id || id === appState.myId) continue;
        const isCaller = appState.myId !== null ? appState.myId < id : false;
        const pc = await createPeerConnection(id, false); // Не отправляем offer сразу
        connections.push({id, pc, isCaller});
        await sleep(100);
      }

      // Ждем немного, чтобы все connections успели инициализироваться
      await sleep(200);

      // Используем tracks вместо currentTracks для более надежной проверки
      const {tracks} = appState;
      console.log('Rebuild: current tracks state:', {
        audio: tracks.audio ? tracks.audio.readyState : 'null',
        video: tracks.video ? (tracks.video.enabled ? 'enabled' : 'disabled') : 'null',
        screen: tracks.screen ? tracks.screen.readyState : 'null'
      });

      // Важно: сначала audio, потом video/screen (screen имеет приоритет над video)
      // Добавляем треки к каждой connection напрямую, чтобы они были включены в offer
      for (const {id, pc} of connections) {
        if (tracks.audio && tracks.audio.readyState === 'live') {
          await addTrackToPeer(pc, tracks.audio);
          await sleep(50);
        }
        // Добавляем video и screen одновременно, если они оба активны
        if (tracks.video && tracks.video.enabled && tracks.video.readyState === 'live') {
          console.log('Rebuild: adding video track to connection for', id);
          await addTrackToPeer(pc, tracks.video);
          await sleep(50);
        }
        if (tracks.screen && tracks.screen.readyState !== 'ended') {
          console.log('Rebuild: adding screen track to connection for', id);
          await addTrackToPeer(pc, tracks.screen);
          await sleep(50);
        }
      }

      // Теперь отправляем offers для caller connections после добавления всех треков
      await sleep(200);
      for (const {id, pc, isCaller} of connections) {
        if (isCaller && pc.signalingState === 'stable' && !pc.makingOffer) {
          try {
            pc.makingOffer = true;
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            wsManager.send({type: 'offer', offer: pc.localDescription, to: id});
            console.log('Rebuild: sent offer with tracks for', id);
          } catch (error) {
            console.error('Rebuild: error creating offer for', id, error);
          } finally {
            pc.makingOffer = false;
          }
        }
      }

      console.log('Rebuild done');
    } catch (error) {
      console.error('rebuildAllPeerConnections error:', error);
    }
  }, [appState, createPeerConnection, addTrackToPeer, wsManager]);

  const closeAllPeerConnections = useCallback(() => {
    console.log('Closing all peer connections');
    const existing = Object.keys(appState.pcs);
    existing.forEach(id => {
      try {
        appState.pcs[id]?.close();
      } catch (error) {
        // Ignore
      }
      appState.removePeerConnection(id);
    });
  }, [appState]);

  return {
    createPeerConnection,
    addTrackToPeer,
    addTrackToAllPeers,
    removeTrackFromAllPeers,
    rebuildAllPeerConnections,
    closeAllPeerConnections
  };
}

function setupPeerConnectionHandlers(pc, id, appState, wsManager, addTrackToPeer, onRemoteStreamUpdate) {
  let audioRestoreTimeout = null;
  // Сохраняем последний video track ID для определения screen track
  let lastVideoTrackId = null;

  const checkAndRestoreAudio = async () => {
    const audioTrack = appState.tracks.audio;
    if (!audioTrack || audioTrack.readyState !== 'live') {
      return;
    }

    const senders = pc.getSenders();
    const audioSender = senders.find(s => s.track && s.track.kind === 'audio');

    if (!audioSender || audioSender.track !== audioTrack) {
      console.log(`[Peer ${id}] Audio sender missing or incorrect, restoring...`);
      try {
        if (!appState.localStream) {
          appState.setLocalStream(new MediaStream());
        }
        const hasAudioInStream = appState.localStream.getAudioTracks().some(t => t === audioTrack);
        if (!hasAudioInStream) {
          appState.localStream.addTrack(audioTrack);
        }

        if (audioSender) {
          await audioSender.replaceTrack(audioTrack);
        } else {
          await addTrackToPeer(pc, audioTrack);
        }

        console.log(`[Peer ${id}] Audio sender restored successfully`);
      } catch (error) {
        console.warn(`[Peer ${id}] Failed to restore audio sender:`, error);
      }
    }
  };

  pc.onnegotiationneeded = async () => {
    try {
      console.log('onnegotiationneeded for', id, 'state:', pc.signalingState);
      if (!pc.polite) {
        console.log('Impolite peer, skipping auto-offer');
        return;
      }

      await checkAndRestoreAudio();

      pc.makingOffer = true;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      wsManager.send({type: 'offer', offer: pc.localDescription, to: id});
      console.log('Polite peer sent offer');

      if (audioRestoreTimeout) {
        clearTimeout(audioRestoreTimeout);
      }
      audioRestoreTimeout = setTimeout(() => {
        checkAndRestoreAudio();
      }, 200);
    } catch (error) {
      console.error('Negotiation error:', error);
    } finally {
      pc.makingOffer = false;
    }
  };

  const audioCheckInterval = setInterval(() => {
    if (pc.connectionState === 'closed' || pc.connectionState === 'failed') {
      clearInterval(audioCheckInterval);
      return;
    }

    const audioTrack = appState.tracks.audio;
    if (audioTrack && audioTrack.readyState === 'live') {
      const senders = pc.getSenders();
      const audioSender = senders.find(s => s.track && s.track.kind === 'audio');

      if (!audioSender || audioSender.track !== audioTrack) {
        console.log(`[Peer ${id}] Periodic check: audio sender needs restoration`);
        checkAndRestoreAudio();
      }
    }
  }, 2000);

  pc._audioCheckInterval = audioCheckInterval;

  pc.ontrack = (event) => {
    console.log(`[Peer ${id}] ontrack event fired`);
    handleTrackEvent(
      event,
      id,
      pc,
      appState,
      onRemoteStreamUpdate,
      () => lastVideoTrackId,
      (trackId) => {
        lastVideoTrackId = trackId;
      }
    );
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      wsManager.send({type: 'candidate', candidate: event.candidate, to: id});
    } else {
      console.log(`[Peer ${id}] ICE gathering complete`);
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log(`[Peer ${id}] ICE connection state changed:`, pc.iceConnectionState, 'connectionState:', pc.connectionState);
    if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
      console.log(`[Peer ${id}] Connection established!`);
    } else if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
      console.warn(`[Peer ${id}] Connection failed or disconnected:`, pc.iceConnectionState);
    }
  };

  pc.onconnectionstatechange = () => {
    console.log(`[Peer ${id}] Connection state changed:`, pc.connectionState);
    if (pc.connectionState === 'connected') {
      console.log(`[Peer ${id}] Peer connection connected!`);
    } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
      console.warn(`[Peer ${id}] Peer connection failed or disconnected:`, pc.connectionState);
    }
  };
}


function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

