import {useCallback, useRef} from 'react';
import {CONFIG} from '../config';

/**
 * Media Management Hook
 */
export function useMedia(appState, wsManager, peerConnectionManager) {
  const noiseSuppressionEnabledRef = useRef(
    localStorage.getItem('noiseSuppressionEnabled') === 'true'
  );

  const getAudioConstraints = useCallback(() => {
    const noiseSuppressionEnabled = localStorage.getItem('noiseSuppressionEnabled') === 'true';

    return {
      audio: {
        echoCancellation: true,
        noiseSuppression: noiseSuppressionEnabled,
        autoGainControl: true,
        sampleRate: 48000,
        channelCount: 1
      },
      video: false
    };
  }, []);

  const recreateAudioTrack = useCallback(async () => {
    try {
      const wasEnabled = appState.tracks.audio?.enabled ?? false;

      if (appState.tracks.audio) {
        appState.tracks.audio.stop();
        if (appState.localStream) {
          appState.localStream.removeTrack(appState.tracks.audio);
        }

        for (const id in appState.pcs) {
          const pc = appState.pcs[id];
          if (!pc) continue;

          try {
            const sender = pc.getSenders().find(s => s.track === appState.tracks.audio);
            if (sender) {
              await sender.replaceTrack(null);
            }
          } catch (error) {
            console.warn('Failed to remove audio sender:', error);
          }
        }
      }

      const constraints = getAudioConstraints();
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const audioTrack = stream.getAudioTracks()[0];

      if (!audioTrack) {
        throw new Error('No audio track from getUserMedia');
      }

      appState.setTracks(prev => ({...prev, audio: audioTrack}));
      if (!appState.localStream) {
        appState.setLocalStream(new MediaStream());
      } else {
        appState.localStream.addTrack(audioTrack);
      }

      audioTrack.enabled = wasEnabled;

      await peerConnectionManager.addTrackToAllPeers(audioTrack);

      const noiseSuppressionEnabled = localStorage.getItem('noiseSuppressionEnabled') === 'true';
      console.log('Audio track recreated with noise suppression:', noiseSuppressionEnabled);
    } catch (error) {
      console.error('Failed to recreate audio track:', error);
      alert(`Ошибка при изменении настроек аудио: ${error.message}`);
    }
  }, [appState, getAudioConstraints, peerConnectionManager]);

  const enableAudio = useCallback(async () => {
    console.log('Requesting audio...');
    const constraints = getAudioConstraints();
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    const audioTrack = stream.getAudioTracks()[0];

    if (!audioTrack) {
      throw new Error('No audio track from getUserMedia');
    }

    let localStream = appState.localStream;
    if (!localStream) {
      localStream = new MediaStream();
      appState.setLocalStream(localStream);
    }
    localStream.addTrack(audioTrack);

    appState.setTracks(prev => ({...prev, audio: audioTrack}));
    appState.setCurrentTracks(prev => ({...prev, audio: audioTrack}));

    await peerConnectionManager.addTrackToAllPeers(audioTrack);

    return {enabled: true};
  }, [appState, getAudioConstraints, peerConnectionManager]);

  const toggleAudio = useCallback(async () => {
    try {
      if (!appState.tracks.audio) {
        await enableAudio();
      } else {
        const newEnabled = !appState.tracks.audio.enabled;
        appState.tracks.audio.enabled = newEnabled;
        // Force state update to trigger re-render
        appState.setTracks(prev => ({...prev, audio: appState.tracks.audio}));
        return {enabled: newEnabled};
      }
    } catch (error) {
      console.error('Microphone toggle error:', error);
      alert(`Ошибка доступа к микрофону: ${error.message}`);
      return {enabled: false};
    }
  }, [appState, enableAudio]);

  const enableVideo = useCallback(async () => {
    console.log('Requesting video...');
    const stream = await navigator.mediaDevices.getUserMedia(CONFIG.MEDIA.video);
    const videoTrack = stream.getVideoTracks()[0];

    if (!videoTrack) {
      throw new Error('No video track from getUserMedia');
    }

    let localStream = appState.localStream;
    if (!localStream) {
      localStream = new MediaStream();
      appState.setLocalStream(localStream);
    }
    localStream.addTrack(videoTrack);

    appState.setTracks(prev => ({...prev, video: videoTrack}));
    appState.setCurrentTracks(prev => ({...prev, video: videoTrack}));

    await peerConnectionManager.addTrackToAllPeers(videoTrack);

    // Отправляем событие удаленным пирам
    wsManager.send({type: 'video-enabled', from: appState.myId});

    return {enabled: true};
  }, [appState, peerConnectionManager, wsManager]);

  const disableVideo = useCallback(async () => {
    try {
      if (!appState.tracks.video) return;

      const videoTrack = appState.tracks.video;

      // Останавливаем track, чтобы освободить камеру
      try {
        videoTrack.stop();
      } catch (error) {
        console.warn('Error stopping video track:', error);
      }

      // Удаляем track из localStream
      if (appState.localStream) {
        appState.localStream.removeTrack(videoTrack);
      }

      // Удаляем track из всех peer connections
      for (const id in appState.pcs) {
        const pc = appState.pcs[id];
        if (!pc || pc.connectionState === 'closed' || pc.connectionState === 'failed') {
          continue;
        }

        try {
          const sender = pc.getSenders().find(s => s.track === videoTrack);
          if (sender) {
            await sender.replaceTrack(null);
          }
        } catch (error) {
          console.warn(`Failed to remove video sender for peer ${id}:`, error);
        }
      }

      // Очищаем track из состояния
      appState.setTracks(prev => ({...prev, video: null}));
      appState.setCurrentTracks(prev => ({...prev, video: null}));

      // Отправляем событие удаленным пирам
      wsManager.send({type: 'video-disabled', from: appState.myId});

      return {enabled: false};
    } catch (error) {
      console.error('Disable video error:', error);
      return {enabled: false};
    }
  }, [appState, wsManager]);

  const toggleVideo = useCallback(async () => {
    try {
      if (!appState.tracks.video) {
        await enableVideo();
        return {enabled: true};
      } else {
        // Если видео включено, отключаем его
        if (appState.tracks.video.enabled) {
          return await disableVideo();
        } else {
          // Если видео отключено, включаем его (создаем новый track)
          await enableVideo();
          return {enabled: true};
        }
      }
    } catch (error) {
      console.error('Video toggle error:', error);
      alert(`Ошибка доступа к камере: ${error.message}`);
      return {enabled: false};
    }
  }, [appState, enableVideo, disableVideo]);

  const stopScreenSharing = useCallback(async () => {
    try {
      if (!appState.tracks.screen) return;

      const screenTrack = appState.tracks.screen;
      screenTrack.onended = null;

      const audioTrack = appState.tracks.audio;
      if (audioTrack && audioTrack.readyState === 'live') {
        if (!appState.localStream) {
          appState.setLocalStream(new MediaStream());
        }
        const hasAudioInStream = appState.localStream.getAudioTracks().some(t => t === audioTrack);
        if (!hasAudioInStream) {
          appState.localStream.addTrack(audioTrack);
        }
      }

      try {
        screenTrack.stop();
      } catch (error) {
        // Ignore
      }

      for (const id in appState.pcs) {
        const pc = appState.pcs[id];
        if (!pc || pc.connectionState === 'closed' || pc.connectionState === 'failed') {
          continue;
        }

        try {
          const sender = pc.getSenders().find(s => s.track === screenTrack);
          if (sender) {
            await sender.replaceTrack(null);

            await new Promise(resolve => setTimeout(resolve, 50));

            const sendersAfter = pc.getSenders();
            const audioSenderAfter = sendersAfter.find(s => s.track && s.track.kind === 'audio');

            if (!audioSenderAfter || audioSenderAfter.track !== audioTrack) {
              if (audioSenderAfter) {
                await audioSenderAfter.replaceTrack(audioTrack);
              } else {
                await peerConnectionManager.addTrackToPeer(pc, audioTrack);
              }
            }
          }
        } catch (error) {
          console.warn(`Failed to remove screen sender for peer ${id}:`, error);
        }
      }

      appState.setTracks(prev => ({...prev, screen: null}));
      appState.setCurrentTracks(prev => ({...prev, screen: null}));

      await new Promise(resolve => setTimeout(resolve, 150));

      wsManager.send({type: 'screen-stopped', from: appState.myId});
    } catch (error) {
      console.error('stopScreenSharing error:', error);
    }
  }, [appState, wsManager, peerConnectionManager]);

  const startScreenSharing = useCallback(async () => {
    console.log('Requesting screen...');
    const stream = await navigator.mediaDevices.getDisplayMedia(CONFIG.MEDIA.screen);
    const screenTrack = stream.getVideoTracks()[0];

    if (!screenTrack) {
      throw new Error('No screen track from getDisplayMedia');
    }

    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length > 0) {
      console.log('Removing audio tracks from screen sharing stream');
      audioTracks.forEach(track => {
        try {
          track.stop();
          stream.removeTrack(track);
        } catch (error) {
          console.warn('Failed to remove audio track from screen stream:', error);
        }
      });
    }

    // ВАЖНО: сначала обновляем состояние, чтобы screen track был доступен при проверке
    appState.setTracks(prev => ({...prev, screen: screenTrack}));
    appState.setCurrentTracks(prev => ({...prev, screen: screenTrack}));

    // Ждем немного, чтобы состояние обновилось
    await new Promise(resolve => setTimeout(resolve, 10));

    if (!appState.localStream) {
      appState.setLocalStream(new MediaStream());
    }

    const audioTrack = appState.tracks.audio;
    if (audioTrack && audioTrack.readyState === 'live') {
      const hasAudioInStream = appState.localStream.getAudioTracks().some(t => t === audioTrack);
      if (!hasAudioInStream) {
        appState.localStream.addTrack(audioTrack);
      }
    }

    // ВАЖНО: передаем screen track напрямую, чтобы он правильно определился
    console.log('Adding screen track to all peers:', {
      trackId: screenTrack.id,
      trackLabel: screenTrack.label,
      currentScreenTrack: appState.tracks.screen?.id
    });

    await peerConnectionManager.addTrackToAllPeers(screenTrack);

    screenTrack.onended = () => {
      console.log('Screen track ended');
      stopScreenSharing().catch(error =>
        console.error('stopScreenSharing failed:', error)
      );
    };

    return {enabled: true};
  }, [appState, peerConnectionManager, stopScreenSharing]);

  const toggleScreenShare = useCallback(async () => {
    try {
      if (appState.tracks.screen) {
        await stopScreenSharing();
        return {enabled: false};
      } else {
        await startScreenSharing();
        return {enabled: true};
      }
    } catch (error) {
      console.error('Screen share error:', error);
      alert(`Ошибка при общем доступе к экрану: ${error.message}`);
      return {enabled: false};
    }
  }, [appState, startScreenSharing, stopScreenSharing]);

  const setNoiseSuppression = useCallback((enabled) => {
    localStorage.setItem('noiseSuppressionEnabled', enabled.toString());
    noiseSuppressionEnabledRef.current = enabled;
    if (appState.tracks.audio) {
      recreateAudioTrack();
    }
  }, [appState, recreateAudioTrack]);

  return {
    enableAudio,
    toggleAudio,
    enableVideo,
    disableVideo,
    toggleVideo,
    toggleScreenShare,
    stopScreenSharing,
    setNoiseSuppression,
    noiseSuppressionEnabled: noiseSuppressionEnabledRef.current
  };
}

