import React, { useRef, useEffect, useState } from 'react';
import './VideoContainer.css';

export function VideoContainer({ peerId, stream, username, isLocal, isMain = false, onVolumeChange, onVideoClick }) {
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const containerRef = useRef(null);
  const [volume, setVolume] = useState(100);

  useEffect(() => {
    // Сохраняем громкость по username, чтобы она сохранялась между сессиями
    // Используем username вместо peerId, так как peerId меняется при каждом подключении
    if (!isLocal && username) {
      const savedVolume = localStorage.getItem(`volume-${username}`);
      if (savedVolume) {
        const vol = parseFloat(savedVolume);
        setVolume(vol);
        if (onVolumeChange) {
          onVolumeChange(vol);
        }
      }
    }
  }, [username, isLocal, onVolumeChange]);

  useEffect(() => {
    if (!videoRef.current) return;
    
    // Если stream.video равен null или undefined, очищаем видео
    if (!stream?.video) {
      if (videoRef.current.srcObject) {
        console.log('VideoContainer: clearing video stream for', peerId, {
          reason: 'stream.video is null'
        });
        videoRef.current.srcObject = null;
      }
      return;
    }
    
    // Проверяем, есть ли активные video tracks
    const videoTracks = stream.video.getVideoTracks() || [];
    const hasActiveTracks = videoTracks.length > 0 && videoTracks.some(track => track.enabled && track.readyState === 'live');
    
    if (hasActiveTracks) {
      const currentSrcObject = videoRef.current.srcObject;
      const trackId = videoTracks[0]?.id;
      
      // Проверяем, что это действительно другой stream или другой track
      if (currentSrcObject !== stream.video) {
        console.log('VideoContainer: setting video stream for', peerId, {
          trackId,
          streamId: stream.video.id,
          currentStreamId: currentSrcObject?.id,
          enabled: videoTracks[0]?.enabled,
          readyState: videoTracks[0]?.readyState
        });
        videoRef.current.srcObject = stream.video;
        videoRef.current.play().catch(error => {
          console.warn('video.play() failed:', error);
        });
      }
    } else {
      // Если нет активных tracks, очищаем video element
      if (videoRef.current.srcObject) {
        console.log('VideoContainer: clearing video stream for', peerId, {
          reason: 'no active tracks',
          tracksCount: videoTracks.length,
          tracksEnabled: videoTracks.map(t => ({ id: t.id, enabled: t.enabled, readyState: t.readyState }))
        });
        videoRef.current.srcObject = null;
      }
    }
  }, [stream?.video, peerId]);

  useEffect(() => {
    if (!audioRef.current || isLocal) return;
    
    if (stream?.audio && stream.audio.getTracks().length > 0) {
      const currentSrcObject = audioRef.current.srcObject;
      if (currentSrcObject !== stream.audio) {
        audioRef.current.srcObject = stream.audio;
      }
      audioRef.current.volume = volume / 100;
      audioRef.current.play().catch(() => {
        // Ignore autoplay restrictions
      });
    } else if (audioRef.current.srcObject) {
      audioRef.current.srcObject = null;
    }
  }, [stream?.audio, volume, isLocal]);

  const toggleFullscreen = () => {
    if (!videoRef.current) return;

    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      if (videoRef.current.requestFullscreen) {
        videoRef.current.requestFullscreen();
      } else if (videoRef.current.webkitRequestFullscreen) {
        videoRef.current.webkitRequestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
    }
  };


  const handleVolumeChange = (e) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    // Сохраняем громкость по username, чтобы она сохранялась между сессиями
    // Используем username вместо peerId, так как peerId меняется при каждом подключении
    if (!isLocal && username) {
      localStorage.setItem(`volume-${username}`, newVolume.toString());
    }
    if (audioRef.current) {
      audioRef.current.volume = newVolume / 100;
    }
    if (onVolumeChange) {
      onVolumeChange(newVolume);
    }
  };

  const hasActiveVideo = stream?.video && stream.video.getVideoTracks && stream.video.getVideoTracks().some(track => track.enabled && track.readyState === 'live');

  const handleContainerClick = (e) => {
    // Если кликнули на видео или контейнер (но не на элементы управления), вызываем onVideoClick
    if (onVideoClick && !isMain) {
      // Проверяем, что клик не был на элементах управления (слайдер, кнопки и т.д.)
      if (!e.target.closest('.volume-slider') && !e.target.closest('input') && e.target.tagName !== 'VIDEO') {
        // Для видео fullscreen обрабатывается отдельно, поэтому пропускаем клики на video
        onVideoClick();
      }
    } else if (onVideoClick && isMain) {
      // Для главного видео можно кликнуть на контейнер (но не на само видео, там fullscreen)
      if (e.target === containerRef.current || (e.target.closest('.video-container') && e.target.tagName !== 'VIDEO')) {
        if (!e.target.closest('.volume-slider') && !e.target.closest('input')) {
          onVideoClick();
        }
      }
    }
  };

  return (
    <div
      ref={containerRef}
      className={`video-container ${isMain ? 'video-container-main' : ''} ${!hasActiveVideo ? 'video-container-no-video' : ''} ${onVideoClick ? 'video-container-clickable' : ''}`}
      id={isLocal ? 'local-container' : `container-${peerId}`}
      onClick={handleContainerClick}
    >
      <div style={{ position: 'relative', width: '100%', height: isMain ? 'calc(100% - 38px)' : 'calc(100% - 38px)', flexShrink: isMain ? 1 : 0, flex: isMain ? 1 : 'none', minHeight: isMain ? 0 : 'auto' }}>
        {!hasActiveVideo && (
          <img
            src="/img/anime-tyan.jpg"
            alt={isLocal ? "Me" : username}
            className={isLocal ? "local-video-placeholder" : "video-placeholder"}
          />
        )}
        <video
          ref={videoRef}
          id={isLocal ? 'localVideo' : `remoteVideo-${peerId}`}
          autoPlay
          muted={isLocal}
          playsInline
          style={{
            display: hasActiveVideo ? 'block' : 'none',
            width: '100%',
            height: '100%',
            objectFit: isMain ? 'contain' : 'cover',
            zIndex: hasActiveVideo ? 2 : 0
          }}
          onClick={(e) => {
            // Если это не главное видео, при клике делаем его главным
            if (!isMain && onVideoClick) {
              e.stopPropagation();
              onVideoClick();
            } else {
              // Иначе открываем fullscreen
              toggleFullscreen(e);
            }
          }}
        />
      </div>
      <div className="username-label" id={isLocal ? 'localUsernameLabel' : `label-${peerId}`}>
        {username || 'Anonymous'}
      </div>
      {!isLocal && (
        <>
          <input
            type="range"
            className="volume-slider"
            id={`volumeSlider-${peerId}`}
            min="0"
            max="100"
            value={volume}
            onChange={handleVolumeChange}
            style={{ '--volume-percent': `${volume}%` }}
            aria-label="Громкость"
          />
          <audio
            ref={audioRef}
            id={`remoteAudio-${peerId}`}
            autoPlay
            playsInline
            style={{ display: 'none' }}
          />
        </>
      )}
    </div>
  );
}

