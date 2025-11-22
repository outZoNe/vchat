import {useCallback} from 'react';
import {CONFIG} from '../config';

/**
 * WebSocket Signaling Handler Hook
 */
export function useSignaling(appState, wsManager, peerConnectionManager, onRemoteStreamUpdate, onRoomUsers = null) {
  const playSound = useCallback((soundFile) => {
    try {
      const audio = new Audio(`/audio/${soundFile}`);
      audio.volume = 0.5;
      audio.play().catch(error => {
        console.warn(`Failed to play sound ${soundFile}:`, error);
      });
    } catch (error) {
      console.warn(`Error creating audio for ${soundFile}:`, error);
    }
  }, []);

  const handleSetId = useCallback(async (msg) => {
    // Проверяем, не был ли уже установлен ID (защита от повторных вызовов)
    if (appState.myId === msg.id) {
      return;
    }

    appState.setMyId(msg.id);
    console.log('My ID:', msg.id);

    const savedUsername = localStorage.getItem(CONFIG.USERNAME.storageKey) || CONFIG.USERNAME.default;
    appState.setMyUsername(savedUsername);

    // Отправляем join-room и username после установки ID
    // Используем функцию с повторными попытками, если WebSocket еще не подключен
    const sendAfterConnect = (attempt = 0) => {
      if (wsManager.ws && wsManager.ws.readyState === WebSocket.OPEN) {
        // Отправляем join-room если roomId установлен
        // Проверяем, что мы еще не в этой комнате (защита от повторной отправки)
        const currentRoomId = wsManager.roomId;
        console.log('sendAfterConnect: currentRoomId =', currentRoomId, 'attempt =', attempt);
        if (currentRoomId) {
          // Отправляем только один раз - сервер сам обработает повторные запросы
          const success = wsManager.send({type: 'join-room', roomId: currentRoomId});
          console.log('Sent join-room:', currentRoomId, 'success:', success);
        } else {
          console.log('No roomId set, skipping join-room');
        }

        // Отправляем username (можно отправлять несколько раз, это нормально)
        if (savedUsername) {
          wsManager.send({type: 'update-username', username: savedUsername});
        }
      } else if (attempt < 10) {
        // Увеличиваем количество попыток до 10, чтобы дождаться установки roomId
        console.log('WebSocket not ready, retrying... attempt', attempt);
        setTimeout(() => sendAfterConnect(attempt + 1), 200);
      }
    };

    // Увеличиваем задержку перед отправкой, чтобы дать время установить roomId
    setTimeout(() => sendAfterConnect(), 500);
  }, [appState, wsManager]);

  const handleExistingParticipants = useCallback(async (msg) => {
    console.log('Received existing participants:', msg.participants);

    if (!msg.participants || msg.participants.length === 0) {
      console.log('No existing participants');
      return;
    }

    // Сохраняем username для каждого участника
    msg.participants.forEach(participant => {
      if (participant.id && participant.username) {
        appState.setRemoteUsername(participant.id, participant.username);
      }
    });

    // Создаем peer connections для всех существующих участников
    console.log('Creating peer connections for', msg.participants.length, 'existing participants');
    console.log('My ID:', appState.myId);

    // Получаем ID всех участников
    const participantIds = msg.participants
      .map(p => p.id)
      .filter(id => id && id !== appState.myId);

    console.log('Participant IDs to connect to:', participantIds);

    // Создаем peer connections для каждого участника
    // ВАЖНО: добавляем небольшую задержку между созданием соединений, чтобы избежать перегрузки
    for (let i = 0; i < participantIds.length; i++) {
      const participantId = participantIds[i];
      try {
        // Проверяем, нет ли уже peer connection для этого участника
        if (!appState.pcs[participantId]) {
          const isCaller = appState.myId && appState.myId < participantId;
          console.log(`Creating peer connection for ${participantId}, isCaller: ${isCaller}, myId: ${appState.myId}`);

          const pc = await peerConnectionManager.createPeerConnection(participantId, isCaller);
          
          // Небольшая задержка между созданием соединений (кроме первого)
          if (i > 0) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }

          // Добавляем треки, если они есть
          const {tracks} = appState;
          if (tracks.audio && tracks.audio.readyState === 'live') {
            await peerConnectionManager.addTrackToPeer(pc, tracks.audio);
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          if (tracks.video && tracks.video.enabled && tracks.video.readyState === 'live') {
            await peerConnectionManager.addTrackToPeer(pc, tracks.video);
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          if (tracks.screen && tracks.screen.readyState !== 'ended') {
            await peerConnectionManager.addTrackToPeer(pc, tracks.screen);
            await new Promise(resolve => setTimeout(resolve, 50));
          }

          // ВАЖНО: Всегда отправляем offer после добавления треков, чтобы гарантировать установку соединения
          // Если мы caller, отправляем сразу
          // Если мы polite, отправляем с задержкой, чтобы избежать glare
          const sendOffer = async () => {
            if (pc.signalingState === 'stable' && !pc.makingOffer) {
              try {
                pc.makingOffer = true;
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                wsManager.send({type: 'offer', offer: pc.localDescription, to: participantId});
                console.log(`Sent offer to existing participant ${participantId} (isCaller: ${isCaller}, polite: ${pc.polite})`);
              } catch (error) {
                console.error('Error creating offer for existing participant:', participantId, error);
              } finally {
                pc.makingOffer = false;
              }
            }
          };

          if (isCaller) {
            // Caller отправляет offer сразу
            await sendOffer();
          } else {
            // Polite peer отправляет offer с задержкой, чтобы избежать glare
            setTimeout(async () => {
              await sendOffer();
            }, 300);
          }

          // ВАЖНО: Добавляем fallback механизм - если соединение не установилось через 2 секунды,
          // отправляем offer еще раз (на случай, если первый offer был потерян или не обработан)
          setTimeout(async () => {
            if (pc.connectionState !== 'connected' && pc.connectionState !== 'connecting' && 
                pc.signalingState === 'stable' && !pc.makingOffer) {
              console.log(`Connection not established for ${participantId}, sending fallback offer`);
              await sendOffer();
            }
          }, 2000);
        } else {
          console.log(`Peer connection for ${participantId} already exists`);
        }
      } catch (error) {
        console.error('Error creating peer connection for existing participant:', participantId, error);
      }
      
      // Небольшая задержка перед следующим участником
      if (i < participantIds.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    console.log('Finished creating peer connections for existing participants');

    // Запрашиваем обновленный список пользователей в комнате
    if (wsManager.roomId && wsManager.ws && wsManager.ws.readyState === WebSocket.OPEN) {
      setTimeout(() => {
        wsManager.send({type: 'get-room-users', roomId: wsManager.roomId});
      }, 500);
    }
  }, [appState, peerConnectionManager, wsManager]);

  const handlePing = useCallback((msg) => {
    wsManager.send({type: 'pong', ts: msg.ts});
  }, [wsManager]);

  const handleUpdateUsername = useCallback((msg) => {
    // Игнорируем сообщения от самого себя
    if (msg.from === appState.myId) {
      return;
    }

    if (!msg.from || !msg.username) {
      return;
    }

    // Обновляем только если username действительно изменился
    const currentUsername = appState.getRemoteUsername(msg.from);
    if (currentUsername === msg.username) {
      return;
    }

    appState.setRemoteUsername(msg.from, msg.username);
  }, [appState]);

  const handleNewParticipant = useCallback(async (msg) => {
    console.log('New participant joined:', msg.id);

    if (msg.username) {
      appState.setRemoteUsername(msg.id, msg.username);
    } else {
      appState.setRemoteUsername(msg.id, CONFIG.USERNAME.default);
    }

    playSound('join.mp3');
    
    // Создаем соединение только с новым участником, не перестраивая все соединения
    // Это предотвращает разрыв существующих соединений между другими участниками
    try {
      // Проверяем, нет ли уже peer connection для этого участника
      if (!appState.pcs[msg.id]) {
        const isCaller = appState.myId && appState.myId < msg.id;
        console.log(`Creating peer connection for new participant ${msg.id}, isCaller: ${isCaller}, myId: ${appState.myId}`);

        const pc = await peerConnectionManager.createPeerConnection(msg.id, isCaller);

        // Добавляем треки, если они есть
        // ВАЖНО: добавляем треки последовательно с небольшими задержками,
        // чтобы избежать race conditions и проблем с renegotiation
        const {tracks} = appState;
        if (tracks.audio && tracks.audio.readyState === 'live') {
          await peerConnectionManager.addTrackToPeer(pc, tracks.audio);
          await new Promise(resolve => setTimeout(resolve, 50)); // Небольшая задержка
        }
        if (tracks.video && tracks.video.enabled && tracks.video.readyState === 'live') {
          await peerConnectionManager.addTrackToPeer(pc, tracks.video);
          await new Promise(resolve => setTimeout(resolve, 50)); // Небольшая задержка
        }
        if (tracks.screen && tracks.screen.readyState !== 'ended') {
          await peerConnectionManager.addTrackToPeer(pc, tracks.screen);
          await new Promise(resolve => setTimeout(resolve, 50)); // Небольшая задержка
        }
        
        // ВАЖНО: проверяем, что localStream правильно инициализирован и содержит все треки
        // Это гарантирует, что все соединения используют один и тот же stream
        if (appState.localStream) {
          const audioInStream = appState.localStream.getAudioTracks().some(t => t === tracks.audio);
          if (tracks.audio && tracks.audio.readyState === 'live' && !audioInStream) {
            appState.localStream.addTrack(tracks.audio);
            console.log('Added audio track to localStream for new participant');
          }
        }

        // ВАЖНО: Всегда отправляем offer после добавления треков, чтобы гарантировать установку соединения
        // Если мы caller, отправляем сразу
        // Если мы polite, отправляем с задержкой, чтобы избежать glare
        const sendOffer = async () => {
          if (pc.signalingState === 'stable' && !pc.makingOffer) {
            try {
              pc.makingOffer = true;
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              wsManager.send({type: 'offer', offer: pc.localDescription, to: msg.id});
              console.log(`Sent offer to new participant ${msg.id} (isCaller: ${isCaller}, polite: ${pc.polite})`);
            } catch (error) {
              console.error('Error creating offer for new participant:', msg.id, error);
            } finally {
              pc.makingOffer = false;
            }
          }
        };

        if (isCaller) {
          // Caller отправляет offer сразу
          await sendOffer();
        } else {
          // Polite peer отправляет offer с задержкой, чтобы избежать glare
          setTimeout(async () => {
            await sendOffer();
          }, 300);
        }

        // ВАЖНО: Добавляем fallback механизм - если соединение не установилось через 2 секунды,
        // отправляем offer еще раз (на случай, если первый offer был потерян или не обработан)
        setTimeout(async () => {
          if (pc.connectionState !== 'connected' && pc.connectionState !== 'connecting' && 
              pc.signalingState === 'stable' && !pc.makingOffer) {
            console.log(`Connection not established for new participant ${msg.id}, sending fallback offer`);
            await sendOffer();
          }
        }, 2000);
      } else {
        console.log(`Peer connection for new participant ${msg.id} already exists`);
      }
    } catch (error) {
      console.error('Error creating peer connection for new participant:', msg.id, error);
    }
  }, [appState, peerConnectionManager, wsManager, playSound]);

  const handleOffer = useCallback(async (msg) => {
    console.log('Received offer from:', msg.from);
    const pc = await peerConnectionManager.createPeerConnection(msg.from, false);

    try {
      const offerCollision = pc.makingOffer || pc.signalingState !== 'stable';
      pc.ignoreOffer = !pc.polite && offerCollision;

      if (pc.ignoreOffer) {
        console.log('Ignored offer (glare) from', msg.from, 'polite:', pc.polite, 'makingOffer:', pc.makingOffer, 'signalingState:', pc.signalingState);
        const buffer = appState.iceCandidateBuffer[msg.from];
        if (buffer) {
          appState.setIceCandidateBuffer(prev => {
            const newBuffer = {...prev};
            delete newBuffer[msg.from];
            return newBuffer;
          });
        }
        return;
      }

      console.log('Accepting offer from', msg.from, 'signalingState:', pc.signalingState, 'connectionState:', pc.connectionState);
      
      // КРИТИЧНО: Проверяем существующие senders перед setRemoteDescription
      // Это важно для сохранения порядка m-lines в SDP
      const existingSenders = pc.getSenders();
      const existingSenderTracks = existingSenders
        .filter(s => s.track)
        .map(s => ({ kind: s.track.kind, trackId: s.track.id }));
      
      console.log(`[Peer ${msg.from}] Existing senders before setRemoteDescription:`, existingSenderTracks);
      
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(msg.offer));
        console.log('Set remote description from offer, signalingState:', pc.signalingState);
      } catch (error) {
        // КРИТИЧНО: Если порядок m-lines не совпадает, пытаемся восстановить соединение
        if (error.name === 'InvalidAccessError' && error.message.includes('m-lines')) {
          console.error(`[Peer ${msg.from}] CRITICAL: m-lines order mismatch error!`, error);
          console.error(`[Peer ${msg.from}] Attempting to recover by closing and recreating connection...`);
          
          // Закрываем текущее соединение
          try {
            pc.close();
          } catch (closeError) {
            console.warn(`[Peer ${msg.from}] Error closing connection:`, closeError);
          }
          
          // Удаляем соединение из состояния
          appState.removePeerConnection(msg.from);
          
          // Создаем новое соединение и отправляем offer
          setTimeout(async () => {
            try {
              const newPc = await peerConnectionManager.createPeerConnection(msg.from, false);
              const {tracks} = appState;
              
              // Добавляем треки в правильном порядке
              if (tracks.audio && tracks.audio.readyState === 'live') {
                await peerConnectionManager.addTrackToPeer(newPc, tracks.audio);
                await new Promise(resolve => setTimeout(resolve, 50));
              }
              if (tracks.video && tracks.video.enabled && tracks.video.readyState === 'live') {
                await peerConnectionManager.addTrackToPeer(newPc, tracks.video);
                await new Promise(resolve => setTimeout(resolve, 50));
              }
              if (tracks.screen && tracks.screen.readyState !== 'ended') {
                await peerConnectionManager.addTrackToPeer(newPc, tracks.screen);
                await new Promise(resolve => setTimeout(resolve, 50));
              }
              
              // Отправляем новый offer
              if (newPc.signalingState === 'stable' && !newPc.makingOffer) {
                newPc.makingOffer = true;
                const offer = await newPc.createOffer();
                await newPc.setLocalDescription(offer);
                wsManager.send({type: 'offer', offer: newPc.localDescription, to: msg.from});
                console.log(`[Peer ${msg.from}] Sent recovery offer after m-lines order mismatch`);
                newPc.makingOffer = false;
              }
            } catch (recoveryError) {
              console.error(`[Peer ${msg.from}] Error during recovery:`, recoveryError);
            }
          }, 500);
          
          return; // Прерываем обработку текущего offer
        } else {
          // Другие ошибки просто пробрасываем
          throw error;
        }
      }

      await processBufferedIceCandidates(msg.from, pc, appState);
      
      // КРИТИЧНО: Проверяем, что мы в правильном состоянии для добавления треков
      // Мы должны быть в состоянии 'have-remote-offer' после setRemoteDescription
      if (pc.signalingState !== 'have-remote-offer') {
        console.warn(`[Peer ${msg.from}] Warning: signalingState is ${pc.signalingState}, expected 'have-remote-offer'`);
      }

      // КРИТИЧНО: Добавляем треки перед созданием answer в фиксированном порядке
      // Порядок должен быть: audio, video, screen (если screen есть, video идет после screen)
      // Это важно для сохранения порядка m-lines в SDP между переговорами
      const {tracks} = appState;
      
      // Проверяем текущие senders после setRemoteDescription
      const currentSenders = pc.getSenders();
      const currentSenderTracks = currentSenders
        .filter(s => s.track)
        .map(s => ({ kind: s.track.kind, trackId: s.track.id }));
      
      console.log(`[Peer ${msg.from}] Current senders after setRemoteDescription:`, currentSenderTracks);
      
      // КРИТИЧНО: Если у нас уже есть senders, проверяем порядок
      // Порядок m-lines должен оставаться постоянным между переговорами
      if (existingSenderTracks.length > 0 && currentSenderTracks.length > 0) {
        const existingOrder = existingSenderTracks.map(s => s.kind).join(',');
        const currentOrder = currentSenderTracks.map(s => s.kind).join(',');
        if (existingOrder !== currentOrder) {
          console.warn(`[Peer ${msg.from}] WARNING: Sender order changed! Existing: ${existingOrder}, Current: ${currentOrder}`);
          console.warn(`[Peer ${msg.from}] This may cause 'm-lines order mismatch' error. Attempting to maintain order...`);
        }
      }
      
      // 1. Audio (всегда первый)
      if (tracks.audio && tracks.audio.readyState === 'live') {
        const audioSender = currentSenders.find(s => s.track && s.track.kind === 'audio');
        if (!audioSender) {
          await peerConnectionManager.addTrackToPeer(pc, tracks.audio);
          await new Promise(resolve => setTimeout(resolve, 50));
        } else if (audioSender.track !== tracks.audio) {
          await audioSender.replaceTrack(tracks.audio);
          console.log('Replaced audio track in handleOffer');
        }
      }
      
      // 2. Video (второй, если нет screen)
      if (tracks.video && tracks.video.enabled && tracks.video.readyState === 'live' && 
          !tracks.screen) {
        const videoSender = currentSenders.find(s => 
          s.track && s.track.kind === 'video' && 
          s.track !== appState.tracks.screen && 
          s.track === tracks.video
        );
        if (!videoSender) {
          console.log('Adding video track to new peer connection in handleOffer');
          await peerConnectionManager.addTrackToPeer(pc, tracks.video);
          await new Promise(resolve => setTimeout(resolve, 50));
        } else if (videoSender.track !== tracks.video) {
          await videoSender.replaceTrack(tracks.video);
          console.log('Replaced video track in handleOffer');
        }
      }
      
      // 3. Screen (третий, если есть)
      if (tracks.screen && tracks.screen.readyState !== 'ended') {
        const screenSender = currentSenders.find(s => 
          s.track && s.track.kind === 'video' && 
          s.track === tracks.screen
        );
        if (!screenSender) {
          console.log('Adding screen track to new peer connection in handleOffer');
          await peerConnectionManager.addTrackToPeer(pc, tracks.screen);
          await new Promise(resolve => setTimeout(resolve, 50));
        } else if (screenSender.track !== tracks.screen) {
          await screenSender.replaceTrack(tracks.screen);
          console.log('Replaced screen track in handleOffer');
        }
      }
      
      // 4. Video (четвертый, если есть screen - video идет после screen для сохранения порядка)
      if (tracks.video && tracks.video.enabled && tracks.video.readyState === 'live' && 
          tracks.screen) {
        const videoSender = currentSenders.find(s => 
          s.track && s.track.kind === 'video' && 
          s.track !== appState.tracks.screen && 
          s.track === tracks.video
        );
        if (!videoSender) {
          console.log('Adding video track to new peer connection in handleOffer (after screen)');
          await peerConnectionManager.addTrackToPeer(pc, tracks.video);
          await new Promise(resolve => setTimeout(resolve, 50));
        } else if (videoSender.track !== tracks.video) {
          await videoSender.replaceTrack(tracks.video);
          console.log('Replaced video track in handleOffer (after screen)');
        }
      }

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      wsManager.send({type: 'answer', answer: pc.localDescription, to: msg.from});
      
      console.log(`[Peer ${msg.from}] Answer created and sent successfully`);
      
      // Проверяем receivers после создания answer
      // Это важно, так как иногда ontrack event может не сработать сразу
      setTimeout(() => {
        const receivers = pc.getReceivers();
        const audioReceiver = receivers.find(r => r.track && r.track.kind === 'audio');
        const videoReceivers = receivers.filter(r => r.track && r.track.kind === 'video');
        
        if (!audioReceiver && (pc.connectionState === 'connected' || pc.connectionState === 'connecting')) {
          console.warn(`[Peer ${msg.from}] No audio receiver found after answer, may need renegotiation`);
        } else if (audioReceiver && audioReceiver.track) {
          console.log(`[Peer ${msg.from}] Audio receiver found after answer, trackId: ${audioReceiver.track.id}, readyState: ${audioReceiver.track.readyState}`);
        }
        
        // КРИТИЧНО: Проверяем video receivers (могут быть video и screen)
        console.log(`[Peer ${msg.from}] Video receivers after answer:`, videoReceivers.length, videoReceivers.map(r => ({
          trackId: r.track?.id,
          label: r.track?.label,
          readyState: r.track?.readyState
        })));
        
        // Проверяем remoteStreams - должны быть все треки, включая screen
        const remoteStreams = appState.remoteStreams[msg.from];
        if (remoteStreams) {
          console.log(`[Peer ${msg.from}] Remote streams after answer:`, {
            hasAudio: !!remoteStreams.audio,
            hasVideo: !!remoteStreams.video,
            hasScreen: !!remoteStreams.screen,
            videoTracks: remoteStreams.video?.getVideoTracks().length || 0,
            screenTracks: remoteStreams.screen?.getVideoTracks().length || 0
          });
        } else {
          console.warn(`[Peer ${msg.from}] No remote streams found after answer`);
        }
      }, 1000);
    } catch (error) {
      console.error('Error handling offer:', error);
    }
  }, [appState, wsManager, peerConnectionManager]);

  const handleAnswer = useCallback(async (msg) => {
    console.log('Received answer from:', msg.from);
    const pc = appState.getPeerConnection(msg.from);
    if (!pc) {
      console.warn('No peer connection found for answer from:', msg.from);
      return;
    }

    try {
      console.log('Processing answer, signalingState:', pc.signalingState, 'connectionState:', pc.connectionState);
      if (pc.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(msg.answer));
        console.log('Set remote description from answer, signalingState:', pc.signalingState);
        await processBufferedIceCandidates(msg.from, pc, appState);
        console.log('Processed buffered ICE candidates for:', msg.from);
        
        // Проверяем receivers после установки remote description
        // Это важно, так как иногда ontrack event может не сработать сразу
        setTimeout(() => {
          const receivers = pc.getReceivers();
          const audioReceiver = receivers.find(r => r.track && r.track.kind === 'audio');
          if (!audioReceiver && (pc.connectionState === 'connected' || pc.connectionState === 'connecting')) {
            console.warn(`[Peer ${msg.from}] No audio receiver found after answer, may need renegotiation`);
          } else if (audioReceiver && audioReceiver.track) {
            console.log(`[Peer ${msg.from}] Audio receiver found after answer, trackId: ${audioReceiver.track.id}, readyState: ${audioReceiver.track.readyState}`);
          }
        }, 1000);
      } else {
        console.warn('Received answer but signalingState != have-local-offer:', pc.signalingState, 'from:', msg.from);
      }
    } catch (error) {
      console.error('Error handling answer:', error, 'from:', msg.from);
    }
  }, [appState]);

  const handleCandidate = useCallback(async (msg) => {
    if (!msg.candidate || typeof msg.candidate !== 'object' || !msg.from) {
      return;
    }

    const pc = appState.getPeerConnection(msg.from);

    if (pc && pc.ignoreOffer) {
      console.log('Dropping candidate while ignoreOffer=true from', msg.from);
      return;
    }

    if (!pc || !pc.remoteDescription || !pc.remoteDescription.type) {
      // Buffer candidate
      appState.setIceCandidateBuffer(prev => {
        const newBuffer = {...prev};
        if (!newBuffer[msg.from]) {
          newBuffer[msg.from] = [];
        }
        newBuffer[msg.from].push(msg.candidate);
        return newBuffer;
      });
      return;
    }

    try {
      if (msg.candidate.candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
      }
    } catch (error) {
      console.warn('Error adding ICE candidate:', error);
    }
  }, [appState]);

  const handleParticipantLeft = useCallback((msg) => {
    playSound('leave.mp3');
    appState.removePeerConnection(msg.id);
    appState.setRemoteStreams(prev => {
      const newStreams = {...prev};
      delete newStreams[msg.id];
      return newStreams;
    });
    if (onRemoteStreamUpdate) {
      onRemoteStreamUpdate();
    }
  }, [appState, playSound, onRemoteStreamUpdate]);

  const handleScreenStopped = useCallback((msg) => {
    console.log('Received screen-stopped from', msg.from);
    appState.setRemoteStreams(prev => {
      const newStreams = {...prev};
      if (newStreams[msg.from]) {
        const currentVideo = newStreams[msg.from].video;
        const currentAudio = newStreams[msg.from].audio;
        const currentScreen = newStreams[msg.from].screen;

        // Проверяем, не является ли video stream на самом деле screen stream
        // Screen stream обычно содержит только video track без audio
        const videoTracks = currentVideo?.getVideoTracks() || [];
        const videoAudioTracks = currentVideo?.getAudioTracks() || [];
        const hasOnlyVideoInVideoStream = videoTracks.length > 0 && videoAudioTracks.length === 0;

        // Если video stream содержит только video track без audio, и нет screen stream,
        // это может быть screen stream, который был неправильно определен как video stream
        // В этом случае очищаем video stream тоже
        const shouldClearVideo = hasOnlyVideoInVideoStream && !currentScreen;

        // Останавливаем все video tracks в screen stream
        if (currentScreen) {
          currentScreen.getVideoTracks().forEach(track => {
            try {
              track.enabled = false;
              track.stop();
            } catch (error) {
              console.warn('Error stopping screen track:', error);
            }
          });
        }

        // Если video stream на самом деле является screen stream, очищаем его тоже
        if (shouldClearVideo && currentVideo) {
          currentVideo.getVideoTracks().forEach(track => {
            try {
              track.enabled = false;
              track.stop();
            } catch (error) {
              console.warn('Error stopping video track (was screen):', error);
            }
          });
        }

        newStreams[msg.from] = {
          audio: currentAudio,
          video: shouldClearVideo ? null : currentVideo, // Очищаем video, если это был screen
          screen: null
        };

        console.log('Screen stopped for', msg.from, {
          hasVideo: !shouldClearVideo && !!currentVideo,
          hasAudio: !!currentAudio,
          videoTrackId: currentVideo?.getVideoTracks()?.[0]?.id,
          screenTrackId: currentScreen?.getVideoTracks()?.[0]?.id,
          videoWasScreen: shouldClearVideo,
          videoHadOnlyVideo: hasOnlyVideoInVideoStream
        });
      }
      return newStreams;
    });
    if (onRemoteStreamUpdate) {
      onRemoteStreamUpdate();
    }
  }, [appState, onRemoteStreamUpdate]);

  const handleVideoDisabled = useCallback((msg) => {
    console.log('Received video-disabled from', msg.from);
    appState.setRemoteStreams(prev => {
      const newStreams = {...prev};
      if (newStreams[msg.from]) {
        // ВАЖНО: удаляем video stream полностью, чтобы VideoContainer обновился
        const audioStream = newStreams[msg.from].audio;
        const screenStream = newStreams[msg.from].screen;
        const oldVideoStream = newStreams[msg.from].video;

        // Останавливаем все video tracks в старом stream
        if (oldVideoStream) {
          oldVideoStream.getVideoTracks().forEach(track => {
            try {
              track.enabled = false;
              track.stop();
            } catch (error) {
              console.warn('Error stopping video track:', error);
            }
          });
        }

        // Устанавливаем video в null, чтобы VideoContainer скрыл видео
        newStreams[msg.from] = {
          audio: audioStream,
          video: null, // Устанавливаем в null, чтобы VideoContainer обновился
          screen: screenStream
        };

        console.log('Updated remote streams after video disabled for', msg.from, {
          hasAudio: !!audioStream,
          hasVideo: false,
          hasScreen: !!screenStream,
          oldVideoStreamId: oldVideoStream?.id
        });
      }
      return newStreams;
    });
    if (onRemoteStreamUpdate) {
      onRemoteStreamUpdate();
    }
  }, [appState, onRemoteStreamUpdate]);

  const handleVideoEnabled = useCallback((msg) => {
    console.log('Received video-enabled from', msg.from);
    appState.setRemoteStreams(prev => {
      const newStreams = {...prev};
      if (newStreams[msg.from] && newStreams[msg.from].video) {
        // Включаем video track
        const videoTrack = newStreams[msg.from].video.getVideoTracks()[0];
        if (videoTrack) {
          videoTrack.enabled = true;
          console.log('Video track enabled for', msg.from);
        }
      }
      return newStreams;
    });
    if (onRemoteStreamUpdate) {
      onRemoteStreamUpdate();
    }
  }, [appState, onRemoteStreamUpdate]);

  const handleMessage = useCallback(async (msg) => {
    try {
      // Логируем все сообщения для отладки
      if (msg.type === 'video-disabled' || msg.type === 'video-enabled') {
        console.log('Received message:', msg.type, 'from', msg.from);
      }

      switch (msg.type) {
        case 'set-id':
          await handleSetId(msg);
          break;
        case 'existing-participants':
          handleExistingParticipants(msg);
          break;
        case 'ping':
          handlePing(msg);
          break;
        case 'update-username':
          handleUpdateUsername(msg);
          break;
        case 'new-participant':
          await handleNewParticipant(msg);
          break;
        case 'offer':
          await handleOffer(msg);
          break;
        case 'answer':
          await handleAnswer(msg);
          break;
        case 'candidate':
          await handleCandidate(msg);
          break;
        case 'participant-left':
          handleParticipantLeft(msg);
          break;
        case 'screen-stopped':
          handleScreenStopped(msg);
          break;
        case 'video-disabled':
          handleVideoDisabled(msg);
          break;
        case 'video-enabled':
          handleVideoEnabled(msg);
          break;
        case 'room-users':
          console.log('useSignaling: received room-users:', msg);
          if (onRoomUsers) {
            onRoomUsers(msg);
          } else {
            console.warn('useSignaling: onRoomUsers callback is not set');
          }
          break;
        default:
          console.warn('Unknown message type:', msg.type);
      }
    } catch (error) {
      console.error('Error handling WebSocket message:', error, msg);
    }
  }, [
    handleSetId,
    handleExistingParticipants,
    handlePing,
    handleUpdateUsername,
    handleNewParticipant,
    handleOffer,
    handleAnswer,
    handleCandidate,
    handleParticipantLeft,
    handleScreenStopped,
    handleVideoDisabled,
    handleVideoEnabled,
    onRoomUsers
  ]);

  return {handleMessage};
}

async function processBufferedIceCandidates(peerId, pc, appState) {
  const buffer = appState.iceCandidateBuffer[peerId];
  if (!buffer || buffer.length === 0) return;

  for (const candidateInit of buffer) {
    if (!candidateInit || !candidateInit.candidate) continue;
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidateInit));
    } catch (error) {
      console.warn('Discarding buffered ICE candidate:', error);
    }
  }
  appState.setIceCandidateBuffer(prev => {
    const newBuffer = {...prev};
    delete newBuffer[peerId];
    return newBuffer;
  });
}

