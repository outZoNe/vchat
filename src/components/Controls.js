import React from 'react';
import './Controls.css';

export function Controls({ 
  onToggleAudio, 
  onToggleVideo, 
  onToggleScreenShare,
  onLeaveRoom,
  audioEnabled,
  videoEnabled,
  screenShareEnabled,
  sidebarOpen = true
}) {
  return (
    <div className={`controls-panel ${!sidebarOpen ? 'sidebar-collapsed' : ''}`}>
        <button 
          id="toggleAudioBtn" 
          className={`control-btn control-btn-audio ${audioEnabled ? 'enabled' : 'disabled'}`}
          onClick={onToggleAudio}
          aria-label={audioEnabled ? 'Выключить микрофон' : 'Включить микрофон'}
        >
          <span className="control-icon">
            🎤
          </span>
          <span className="control-text">
          {audioEnabled ? 'Микрофон' : 'Микрофон'}
          </span>
        </button>
        <button 
          id="toggleVideoBtn" 
          className={`control-btn control-btn-video ${videoEnabled ? 'enabled' : 'disabled'}`}
          onClick={onToggleVideo}
          aria-label={videoEnabled ? 'Выключить видео' : 'Включить видео'}
        >
          <span className="control-icon">
            {videoEnabled ? '📹' : '📷'}
          </span>
          <span className="control-text">
            {videoEnabled ? 'Видео' : 'Видео'}
          </span>
        </button>
        <button 
          id="shareScreenBtn" 
          className={`control-btn control-btn-screen ${screenShareEnabled ? 'enabled' : 'disabled'}`}
          onClick={onToggleScreenShare}
          disabled={false}
          aria-label={screenShareEnabled ? 'Прекратить трансляцию экрана' : 'Поделиться экраном'}
        >
          <span className="control-icon">
            🖥️
          </span>
          <span className="control-text">
          {screenShareEnabled ? 'Остановить экран' : 'Экран'}
          </span>
        </button>
        {onLeaveRoom && (
          <button 
            id="leaveRoomBtn" 
            className="control-btn control-btn-leave"
            onClick={onLeaveRoom}
            aria-label="Выйти из комнаты"
          >
            <span className="control-icon">
              🚪
            </span>
            <span className="control-text">
              Выйти
            </span>
          </button>
        )}
      </div>
  );
}

