/**
 * Обработчик track events для peer connections
 */
import {isScreenStream, isScreenTrackByLabel} from './trackUtils';

/**
 * Обрабатывает track event от peer connection
 */
export function handleTrackEvent(event, peerId, pc, appState, onRemoteStreamUpdate, getLastVideoTrackId = null, setLastVideoTrackId = null) {
  try {
    console.log('ontrack event received:', {
      peer: peerId,
      kind: event.track.kind,
      trackId: event.track.id,
      streamId: event.streams?.[0]?.id,
      trackLabel: event.track.label,
      trackEnabled: event.track.enabled,
      trackReadyState: event.track.readyState,
      connectionState: pc.connectionState,
      signalingState: pc.signalingState
    });

    const track = event.track;
    const stream = event.streams?.[0] || new MediaStream([track]);

    // ВАЖНО: Читаем актуальное состояние из appState, а не из currentStreams
    // Это нужно для правильного определения типа трека, когда оба трека активны
    // Используем актуальное состояние для определения типа трека
    const currentStreams = appState.remoteStreams[peerId] || {
      audio: null,
      video: null,
      screen: null
    };

    let audioStream = currentStreams.audio;
    let videoStream = currentStreams.video;
    let screenStream = currentStreams.screen;

    // ВАЖНО: Проверяем наличие video stream из актуального состояния
    const hadVideoBefore = !!(videoStream && videoStream.getVideoTracks().length > 0);
    const videoTrackId = videoStream?.getVideoTracks()?.[0]?.id;
    const screenTrackId = screenStream?.getVideoTracks()?.[0]?.id;

    if (track.kind === 'audio') {
      audioStream = handleAudioTrack(track, audioStream, peerId);
    } else if (track.kind === 'video') {
      const result = handleVideoTrack(
        track,
        stream,
        peerId,
        videoStream,
        screenStream,
        currentStreams,
        videoTrackId,
        screenTrackId,
        hadVideoBefore,
        getLastVideoTrackId,
        setLastVideoTrackId,
        appState
      );
      videoStream = result.videoStream;
      screenStream = result.screenStream;
    }

    // Обновляем стримы в состоянии
    updateRemoteStreams(
      peerId,
      audioStream,
      videoStream,
      screenStream,
      currentStreams,
      hadVideoBefore,
      appState,
      onRemoteStreamUpdate
    );
  } catch (error) {
    console.error('Error handling track event:', error);
  }
}

/**
 * Обрабатывает audio track
 */
function handleAudioTrack(track, audioStream, peerId) {
  if (audioStream) {
    const existingTrack = audioStream.getTracks().find(t => t.id === track.id);
    if (!existingTrack) {
      audioStream.addTrack(track);
      console.log('Added audio track to existing stream for', peerId);
    }
  } else {
    audioStream = new MediaStream([track]);
    console.log('Created new audio stream for', peerId);
  }
  return audioStream;
}

/**
 * Обрабатывает video track (определяет screen или video)
 */
function handleVideoTrack(
  track,
  stream,
  peerId,
  videoStream,
  screenStream,
  currentStreams,
  videoTrackId,
  screenTrackId,
  hadVideoBefore,
  getLastVideoTrackId,
  setLastVideoTrackId,
  appState
) {
  const isScreenByLabel = isScreenTrackByLabel(track);
  const streamHasOnlyVideo = isScreenStream(stream);

  // ВАЖНО: Получаем актуальное состояние из appState ПЕРЕД определением типа трека
  // Это критично для правильного определения screen track, когда оба трека активны
  const actualState = getActualStreamState(peerId, currentStreams, appState);

  // ВАЖНО: Используем актуальное состояние для определения hadVideoBefore
  // Если в actualState есть video stream, значит video уже был до этого
  const actualHadVideoBefore = !!(actualState.videoStream && actualState.videoTrackId);
  // Также проверяем currentStreams, так как состояние может обновляться асинхронно
  const currentStreamsHasVideo = !!(currentStreams.video && currentStreams.video.getVideoTracks().length > 0);
  const effectiveHadVideoBefore = actualHadVideoBefore || currentStreamsHasVideo || hadVideoBefore;

  // ВАЖНО: Используем актуальное состояние из appState для определения типа трека
  // Если в actualState есть video stream, используем его track ID
  // Также проверяем currentStreams, так как состояние может обновляться асинхронно
  const currentVideoTrackId = actualState.videoTrackId ||
    currentStreams.video?.getVideoTracks()?.[0]?.id ||
    videoStream?.getVideoTracks()?.[0]?.id ||
    videoTrackId;
  const currentScreenTrackId = screenStream?.getVideoTracks()?.[0]?.id || screenTrackId;

  // ВАЖНО: Если actualState содержит video stream, используем его для проверки
  // Это нужно для правильного определения screen track, когда оба трека активны
  const hasActualVideoStream = !!(actualState.videoStream && actualState.videoTrackId);

  // ВАЖНО: Используем актуальный video stream для проверки
  // Приоритет: actualState.videoStream > currentStreams.video > videoStream
  const effectiveVideoStream = actualState.videoStream || currentStreams.video || videoStream;

  // ВАЖНО: Используем lastVideoTrackId для определения screen track
  // Если track ID отличается от lastVideoTrackId и track приходит в stream без audio - это screen
  const lastVideoTrackId = getLastVideoTrackId ? getLastVideoTrackId() : null;

  // ВАЖНО: Если это первый video track и он еще не сохранен в appState,
  // но currentVideoTrackId существует, используем его как fallback
  // Это нужно для случая, когда первый track обработан, но еще не сохранен в appState
  const effectiveLastVideoTrackId = lastVideoTrackId || currentVideoTrackId;

  // ВАЖНО: Если это первый video track (нет lastVideoTrackId и нет currentVideoTrackId),
  // устанавливаем lastVideoTrackId сразу, чтобы второй track мог правильно определиться как screen
  if (!effectiveLastVideoTrackId && !hasActualVideoStream && !currentStreamsHasVideo && setLastVideoTrackId) {
    // Это первый video track - устанавливаем lastVideoTrackId сразу
    setLastVideoTrackId(track.id);
    console.log('Setting lastVideoTrackId immediately for first video track:', track.id);
  }

  // Определяем, является ли это screen track
  // ВАЖНО: Передаем информацию о наличии video stream из актуального состояния
  const isScreenTrack = determineIfScreenTrack(
    track,
    stream,
    isScreenByLabel,
    streamHasOnlyVideo,
    effectiveVideoStream, // Используем актуальный video stream
    screenStream,
    currentStreams,
    currentVideoTrackId,
    currentScreenTrackId,
    videoTrackId,
    screenTrackId,
    actualState,
    hasActualVideoStream,
    effectiveLastVideoTrackId // Передаем effectiveLastVideoTrackId для проверки
  );

  if (isScreenTrack) {
    console.log('Processing as SCREEN track for', peerId, {
      trackId: track.id,
      streamId: stream.id,
      hadVideoBefore: effectiveHadVideoBefore,
      hasVideoStream: !!effectiveVideoStream,
      hasScreenStream: !!screenStream,
      actualVideoTrackId: actualState.videoTrackId
    });
    screenStream = updateScreenStream(track, screenStream, peerId, effectiveVideoStream || videoStream);
    // ВАЖНО: сохраняем video stream, если он был
    if (effectiveHadVideoBefore && !videoStream) {
      console.warn('Video stream was lost during screen processing, restoring...', peerId);
      videoStream = actualState.videoStream || currentStreams.video;
    }
  } else {
    console.log('Processing as VIDEO track for', peerId, {
      trackId: track.id,
      streamId: stream.id,
      hadVideoBefore: effectiveHadVideoBefore,
      hasVideoStream: !!effectiveVideoStream,
      hasScreenStream: !!screenStream,
      actualVideoTrackId: actualState.videoTrackId
    });
    videoStream = updateVideoStream(
      track,
      stream,
      videoStream,
      peerId,
      screenStream,
      streamHasOnlyVideo,
      setLastVideoTrackId
    );
    // ВАЖНО: сохраняем screen stream, если он был
    if (screenStream && !screenStream.getVideoTracks().some(t => t.id === track.id)) {
      // Screen stream не должен быть затронут
      console.log('Screen stream preserved during video processing for', peerId);
    }
  }

  // Восстанавливаем video stream, если он был потерян
  if (effectiveHadVideoBefore && !videoStream) {
    console.warn('Video stream was lost, restoring...', peerId);
    videoStream = actualState.videoStream || currentStreams.video;
  }

  // Восстанавливаем screen stream, если он был потерян
  if (screenStream && !screenStream.getVideoTracks().length) {
    console.warn('Screen stream was lost, restoring...', peerId);
    screenStream = currentStreams.screen;
  }

  return {videoStream, screenStream};
}

/**
 * Получает актуальное состояние стримов из appState
 */
function getActualStreamState(peerId, currentStreams, appState) {
  try {
    // ВАЖНО: Читаем актуальное состояние из appState напрямую
    // Это нужно для правильного определения типа трека, когда оба трека активны
    const actualState = appState.remoteStreams[peerId];
    if (actualState && actualState.video) {
      const videoTracks = actualState.video.getVideoTracks();
      if (videoTracks.length > 0) {
        const result = {
          videoStream: actualState.video,
          videoTrackId: videoTracks[0].id,
          videoStreamId: actualState.video.id
        };
        console.log('getActualStreamState: found video stream in appState for', peerId, {
          videoTrackId: result.videoTrackId,
          videoStreamId: result.videoStreamId
        });
        return result;
      }
    }
    // Если в appState нет video stream, проверяем currentStreams
    if (currentStreams && currentStreams.video) {
      const videoTracks = currentStreams.video.getVideoTracks();
      if (videoTracks.length > 0) {
        const result = {
          videoStream: currentStreams.video,
          videoTrackId: videoTracks[0].id,
          videoStreamId: currentStreams.video.id
        };
        console.log('getActualStreamState: found video stream in currentStreams for', peerId, {
          videoTrackId: result.videoTrackId,
          videoStreamId: result.videoStreamId
        });
        return result;
      }
    }
    console.log('getActualStreamState: no video stream found for', peerId);
    return {};
  } catch (e) {
    console.warn('Error reading actual state:', e);
    return {};
  }
}

/**
 * Определяет, является ли track screen track
 */
function determineIfScreenTrack(
  track,
  stream,
  isScreenByLabel,
  streamHasOnlyVideo,
  videoStream,
  screenStream,
  currentStreams,
  currentVideoTrackId,
  currentScreenTrackId,
  videoTrackId,
  screenTrackId,
  actualState,
  hasActualVideoStream = false,
  lastVideoTrackId = null
) {
  // Проверка по track ID - сначала проверяем, не является ли это обновлением существующего track
  const isScreenByTrackId = (screenTrackId && track.id === screenTrackId) ||
    (currentScreenTrackId && track.id === currentScreenTrackId);
  const isVideoTrackUpdate = (videoTrackId && track.id === videoTrackId) ||
    (actualState.videoTrackId && track.id === actualState.videoTrackId);

  // ВАЖНО: Сначала проверяем по track ID - это самый надежный способ

  // Если это обновление существующего video track - это НЕ screen
  if (isVideoTrackUpdate) {
    console.log('Track is video update by track ID:', track.id, 'videoTrackId:', videoTrackId);
    return false;
  }

  // Если это обновление существующего screen track - это screen
  if (isScreenByTrackId) {
    console.log('Track is screen by track ID:', track.id, 'screenTrackId:', screenTrackId);
    return true;
  }

  // Проверка по label (надежный способ для определения screen при отправке)
  // НО: на стороне получателя label может быть "remote video" для обоих типов
  // Поэтому полагаемся на label только если нет других признаков
  if (isScreenByLabel) {
    // Дополнительная проверка: если уже есть video stream с другим track ID - это точно screen
    if (videoStream) {
      const videoTrackIdFromStream = videoStream.getVideoTracks()?.[0]?.id;
      if (videoTrackIdFromStream && track.id !== videoTrackIdFromStream) {
        console.log('Track is screen by label and different from video track:', track.id);
        return true;
      }
    } else {
      // Если нет video stream, но label указывает на screen - это screen
      console.log('Track is screen by label (no video stream):', track.id);
      return true;
    }
  }

  // Проверка: если уже есть screen stream и track в том же stream - это screen
  if (screenStream && stream.id === screenStream.id) {
    console.log('Track is screen by stream ID:', stream.id);
    return true;
  }

  // ВАЖНО: Если уже есть video stream, новый track в другом stream без audio может быть screen
  // НО только если:
  // 1. Stream ID отличается от video stream ID
  // 2. Track ID отличается от video track ID
  // 3. Stream содержит только video без audio
  // 4. Video stream действительно существует и активен
  if (videoStream && videoStream.getVideoTracks().length > 0 && streamHasOnlyVideo && stream.id !== videoStream.id) {
    const videoTrackIdFromStream = videoStream.getVideoTracks()?.[0]?.id;
    // Если track ID отличается от video track ID - это screen
    if (videoTrackIdFromStream && track.id !== videoTrackIdFromStream) {
      console.log('Track is screen: different stream and track ID from video:', {
        trackId: track.id,
        videoTrackId: videoTrackIdFromStream,
        streamId: stream.id,
        videoStreamId: videoStream.id,
        hasVideoStream: true
      });
      return true;
    }
  }

  // ВАЖНО: Проверка по lastVideoTrackId - это самый надежный способ для определения screen track
  // когда первый video stream еще не сохранен в appState
  // Если track ID отличается от lastVideoTrackId и track приходит в stream без audio - это screen
  if (lastVideoTrackId && lastVideoTrackId !== track.id && streamHasOnlyVideo) {
    console.log('Track is screen: different track ID from lastVideoTrackId:', {
      trackId: track.id,
      lastVideoTrackId: lastVideoTrackId,
      streamId: stream.id
    });
    return true;
  }

  // ВАЖНО: Если actualState содержит video stream с другим track ID
  // и приходит track в stream без audio - это screen
  // Это ключевая проверка для случая, когда оба трека активны одновременно
  // Проверяем ПЕРВОЙ, до других проверок, так как это самый надежный способ
  if (hasActualVideoStream && actualState.videoTrackId &&
    actualState.videoTrackId !== track.id) {
    // Если stream содержит только video без audio И stream ID отличается - это screen
    if (streamHasOnlyVideo) {
      if (actualState.videoStreamId && stream.id !== actualState.videoStreamId) {
        console.log('Track is screen: different track ID and stream ID from actual video state:', {
          trackId: track.id,
          actualVideoTrackId: actualState.videoTrackId,
          streamId: stream.id,
          actualVideoStreamId: actualState.videoStreamId
        });
        return true;
      } else if (!actualState.videoStreamId) {
        // Если videoStreamId не определен, но track ID отличается и stream без audio - это screen
        console.log('Track is screen: different track ID from actual video (no stream ID):', {
          trackId: track.id,
          actualVideoTrackId: actualState.videoTrackId,
          streamId: stream.id
        });
        return true;
      }
    }
  }

  // Если currentVideoTrackId существует и отличается от текущего track.id И это stream без audio
  // И track ID не совпадает с video track ID - это screen
  if (currentVideoTrackId && currentVideoTrackId !== track.id && streamHasOnlyVideo) {
    // Проверяем, что это не обновление video track
    if (videoTrackId && track.id !== videoTrackId && actualState.videoTrackId && track.id !== actualState.videoTrackId) {
      console.log('Track is screen: different track ID from current video:', {
        trackId: track.id,
        currentVideoTrackId,
        videoTrackId,
        actualVideoTrackId: actualState.videoTrackId
      });
      return true;
    }
  }

  // По умолчанию - это video (не screen)
  console.log('Track is video (default):', track.id);
  return false;
}

/**
 * Обновляет screen stream
 */
function updateScreenStream(track, screenStream, peerId, videoStream) {
  if (screenStream) {
    const existingTrack = screenStream.getTracks().find(t => t.id === track.id);
    if (!existingTrack) {
      screenStream.getTracks().forEach(t => {
        if (t.kind === 'video') screenStream.removeTrack(t);
      });
      screenStream.addTrack(track);
      console.log('Updated screen track in stream for', peerId, 'video stream preserved:', !!videoStream);
    }
  } else {
    screenStream = new MediaStream([track]);
    console.log('Created new screen stream for', peerId, 'video stream preserved:', !!videoStream);
  }
  return screenStream;
}

/**
 * Обновляет video stream
 */
function updateVideoStream(track, stream, videoStream, peerId, screenStream, streamHasOnlyVideo, setLastVideoTrackId) {
  if (videoStream) {
    const existingTrack = videoStream.getTracks().find(t => t.id === track.id);
    if (!existingTrack) {
      if (stream.id === videoStream.id) {
        // Обновляем track в том же stream
        videoStream.getTracks().forEach(t => {
          if (t.kind === 'video') videoStream.removeTrack(t);
        });
        videoStream.addTrack(track);
        console.log('Updated video track in stream for', peerId, 'screen stream preserved:', !!screenStream);
        if (setLastVideoTrackId) {
          setLastVideoTrackId(track.id);
        }
      } else {
        // Если это другой stream, проверяем, не является ли это screen
        // Если stream содержит только video без audio И уже есть screen stream - это может быть обновление screen
        // Но если screen stream не существует, это может быть новый video track в отдельном stream
        // ВАЖНО: не заменяем video stream, если это screen track
        if (screenStream && streamHasOnlyVideo) {
          console.log('Video track in different stream - likely screen, preserving video stream for', peerId);
          return videoStream; // Не обновляем video stream
        } else {
          // Если нет screen stream, это может быть новый video track
          // Но лучше не создавать новый video stream, если уже есть video
          console.log('Video track in different stream - preserving existing video stream for', peerId);
          return videoStream;
        }
      }
    } else {
      // Track уже существует в stream - это обновление
      console.log('Video track already exists in stream for', peerId);
    }
  } else {
    // Создаем новый video stream
    // ВАЖНО: если уже есть screen stream и приходит track в stream без audio - это может быть screen
    // Но если это не screen (определено выше), создаем video stream
    if (screenStream && streamHasOnlyVideo) {
      // Если уже есть screen и приходит track в stream без audio - это может быть обновление screen
      console.log('Video track received but screen stream exists - likely screen update for', peerId);
      return videoStream; // Не создаем video stream
    } else {
      videoStream = new MediaStream([track]);
      console.log('Created new video stream for', peerId, 'screen stream exists:', !!screenStream);
      if (setLastVideoTrackId) {
        setLastVideoTrackId(track.id);
      }
    }
  }
  return videoStream;
}

/**
 * Обновляет remote streams в appState
 */
function updateRemoteStreams(
  peerId,
  audioStream,
  videoStream,
  screenStream,
  currentStreams,
  hadVideoBefore,
  appState,
  onRemoteStreamUpdate
) {
  appState.setRemoteStreams(prev => {
    const current = prev[peerId] || {audio: null, video: null, screen: null};

    // ВАЖНО: Сохраняем существующие стримы, если они были потеряны
    // Если videoStream не был обновлен (null), используем текущий
    let finalVideoStream = videoStream !== null ? videoStream : current.video;
    // Если screenStream не был обновлен (null), используем текущий
    let finalScreenStream = screenStream !== null ? screenStream : current.screen;
    let finalAudioStream = audioStream !== null ? audioStream : current.audio;

    // ВАЖНО: Если был video stream до обработки, он должен остаться
    if (hadVideoBefore && !finalVideoStream) {
      console.warn('CRITICAL: Preserving existing video stream for', peerId);
      finalVideoStream = current.video;
    }

    // ВАЖНО: Если был screen stream до обработки, он должен остаться
    if (current.screen && !finalScreenStream) {
      console.warn('CRITICAL: Preserving existing screen stream for', peerId);
      finalScreenStream = current.screen;
    }

    // Проверяем, что video и screen streams не имеют одинаковый track ID
    if (finalVideoStream && finalScreenStream) {
      const videoTrackId = finalVideoStream.getVideoTracks()?.[0]?.id;
      const screenTrackId = finalScreenStream.getVideoTracks()?.[0]?.id;
      if (videoTrackId === screenTrackId) {
        console.error('ERROR: video and screen streams have the same track!', peerId, {
          videoTrackId,
          screenTrackId
        });
        // Если track ID совпадают, оставляем video, удаляем screen
        // (это не должно происходить, но на всякий случай)
        finalScreenStream = null;
      }
    }

    const updatedStreams = {
      audio: finalAudioStream,
      video: finalVideoStream,
      screen: finalScreenStream
    };

    console.log('Updating remote streams for', peerId, {
      hasVideo: !!updatedStreams.video,
      hasScreen: !!updatedStreams.screen,
      videoTracks: updatedStreams.video?.getVideoTracks().length || 0,
      screenTracks: updatedStreams.screen?.getVideoTracks().length || 0
    });

    if (onRemoteStreamUpdate) {
      setTimeout(() => onRemoteStreamUpdate(), 0);
    }

    return {
      ...prev,
      [peerId]: updatedStreams
    };
  });
}

