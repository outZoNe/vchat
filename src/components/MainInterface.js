import React, { useEffect, useRef } from 'react';
import { VideoContainer } from './VideoContainer';
import { Controls } from './Controls';
import packageJson from '../../package.json';
import './MainInterface.css';

export function MainInterface({
  appState,
  remoteStreams,
  onToggleAudio,
  onToggleVideo,
  onToggleScreenShare,
  onLeaveRoom,
  onUsernameSave,
  sidebarOpen = true,
  connected = false,
  currentRoom = null
}) {
  const localVideoRef = useRef(null);
  const [selectedMainVideo, setSelectedMainVideo] = React.useState(null);

  useEffect(() => {
    if (localVideoRef.current && appState.localStream) {
      localVideoRef.current.srcObject = appState.localStream;
    }
  }, [appState.localStream]);

  // ВАЖНО: проверяем enabled и readyState для правильного определения состояния
  // Используем явную проверку для правильного определения состояния
  const videoTrack = appState.tracks.video;
  const hasActiveVideo = videoTrack && videoTrack.enabled && videoTrack.readyState === 'live';
  const audioEnabled = appState.tracks.audio && appState.tracks.audio.enabled;
  // ВАЖНО: videoEnabled должен проверять enabled, а не только наличие трека
  // Используем явную проверку для правильного определения состояния
  const videoEnabled = !!(videoTrack && videoTrack.enabled);
  const screenShareEnabled = !!appState.tracks.screen;


  // Create separate streams for local video and screen display
  // ВАЖНО: используем hasActiveVideo для определения, нужно ли добавлять video track
  const localVideoStream = React.useMemo(() => {
    const displayStream = new MediaStream();
    if (appState.tracks.audio && appState.tracks.audio.readyState === 'live') {
      displayStream.addTrack(appState.tracks.audio);
    }
    // ВАЖНО: добавляем video track только если он enabled и readyState === 'live'
    if (hasActiveVideo && appState.tracks.video) {
      displayStream.addTrack(appState.tracks.video);
    }
    if (displayStream.getTracks().length > 0) {
      return { video: displayStream, audio: null };
    }
    return null;
  }, [appState.tracks.audio, appState.tracks.video, hasActiveVideo]);

  const localScreenStream = React.useMemo(() => {
    if (appState.tracks.screen && appState.tracks.screen.readyState !== 'ended') {
      const displayStream = new MediaStream();
      if (appState.tracks.audio && appState.tracks.audio.readyState === 'live') {
        displayStream.addTrack(appState.tracks.audio);
      }
      displayStream.addTrack(appState.tracks.screen);
      return { video: displayStream, audio: null };
    }
    return null;
  }, [appState.tracks.audio, appState.tracks.screen]);

  if (!connected) {
    return (
      <div className={`main-interface ${!sidebarOpen ? 'sidebar-collapsed' : ''}`}>
        <div className="welcome-message">
          <h1>Добро пожаловать в VChat!</h1>
          <p>Выберите комнату из списка слева, чтобы начать общение</p>
        </div>
        <div className="links-container">
          <div>
            Исходный код, если хотите: <a href="https://github.com/outZoNe/vchat" target="_blank" rel="noopener noreferrer" className="link">GitHub</a>
          </div>
          <div style={{ marginTop: '8px', fontSize: '0.9em', color: '#666' }}>
            Version: {packageJson.version}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`main-interface ${!sidebarOpen ? 'sidebar-collapsed' : ''} ${connected ? 'has-controls' : ''}`}>
      {connected && (
      <Controls
        onToggleAudio={onToggleAudio}
        onToggleVideo={onToggleVideo}
        onToggleScreenShare={onToggleScreenShare}
        onLeaveRoom={onLeaveRoom}
        audioEnabled={audioEnabled}
        videoEnabled={videoEnabled}
        screenShareEnabled={screenShareEnabled}
        sidebarOpen={sidebarOpen}
      />
      )}
      <div id="videos" className="videos-container">
        {(() => {
          // Собираем все видео контейнеры
          const allContainers = [];

          // Локальное видео с камеры
          if (localVideoStream) {
            allContainers.push({
              key: 'local-video',
              peerId: 'local-video',
              stream: localVideoStream,
              username: `${appState.myUsername} (камера)`,
              isLocal: true,
              hasScreen: false,
              hasVideo: hasActiveVideo,
              priority: hasActiveVideo ? 1 : 3
            });
          }

          // Локальная демонстрация экрана
          if (localScreenStream) {
            allContainers.push({
              key: 'local-screen',
              peerId: 'local-screen',
              stream: localScreenStream,
              username: `${appState.myUsername} (экран)`,
              isLocal: true,
              hasScreen: true,
              hasVideo: false,
              priority: 0 // Экран имеет наивысший приоритет
            });
          }

          // Удаленные потоки
          Object.keys(remoteStreams).forEach(peerId => {
            const streams = remoteStreams[peerId];
            const username = appState.getRemoteUsername(peerId) || 'Anonymous';

            const hasVideo = streams.video && streams.video.getTracks().length > 0 &&
                            streams.video.getVideoTracks().some(track => track.enabled && track.readyState === 'live');
            const hasScreen = streams.screen && streams.screen.getTracks().length > 0;

            // Отображаем screen stream, если есть (приоритет выше)
            if (hasScreen) {
              allContainers.push({
                key: `${peerId}-screen`,
                peerId: `${peerId}-screen`,
                stream: { video: streams.screen, audio: streams.audio },
                username: `${username} (экран)`,
                isLocal: false,
                hasScreen: true,
                hasVideo: false,
                priority: 0 // Экран имеет наивысший приоритет
              });
            }

            // Отображаем video stream, если есть
            if (hasVideo) {
              allContainers.push({
                key: `${peerId}-video`,
                peerId: `${peerId}-video`,
                stream: { video: streams.video, audio: streams.audio },
                username: `${username} (камера)`,
                isLocal: false,
                hasScreen: false,
                hasVideo: true,
                priority: 1
              });
            }

            // Если нет ни video, ни screen, но есть audio, отображаем пустой контейнер
            if (!hasVideo && !hasScreen && streams.audio) {
              allContainers.push({
                key: `${peerId}-audio`,
                peerId: peerId,
                stream: streams,
                username: username,
                isLocal: false,
                hasScreen: false,
                hasVideo: false,
                priority: 2
              });
            }
          });

          // Сортируем: сначала экраны (priority 0), потом видео (priority 1), потом остальные
          allContainers.sort((a, b) => a.priority - b.priority);

          // Определяем главный контейнер: выбранный пользователем или первый с экраном/видео
          let mainContainer = null;
          if (selectedMainVideo) {
            mainContainer = allContainers.find(c => c.key === selectedMainVideo);
            // Если выбранное видео больше не доступно, сбрасываем выбор
            if (!mainContainer || (!mainContainer.hasScreen && !mainContainer.hasVideo)) {
              setSelectedMainVideo(null);
              mainContainer = allContainers.find(c => c.hasScreen || c.hasVideo);
            }
          }
          if (!mainContainer) {
            mainContainer = allContainers.find(c => c.hasScreen || c.hasVideo);
          }
          const otherContainers = allContainers.filter(c => c !== mainContainer);

          // Функция для смены главного видео
          const handleVideoClick = (containerKey) => {
            const clickedContainer = allContainers.find(c => c.key === containerKey);
            // Можно кликать только на контейнеры с экраном или видео
            if (clickedContainer && (clickedContainer.hasScreen || clickedContainer.hasVideo)) {
              if (selectedMainVideo === containerKey) {
                // Если кликнули на уже главное видео, сбрасываем выбор (вернется к автоматическому)
                setSelectedMainVideo(null);
              } else {
                // Делаем выбранное видео главным
                setSelectedMainVideo(containerKey);
              }
            }
          };

          return (
            <>
              {/* Главный контейнер (экран или видео) - большой, на всю область */}
              {mainContainer && (
                <div className="main-video-wrapper">
                  <VideoContainer
                    key={mainContainer.key}
                    peerId={mainContainer.peerId}
                    stream={mainContainer.stream}
                    username={mainContainer.username}
                    isLocal={mainContainer.isLocal}
                    isMain={true}
                    onVideoClick={() => handleVideoClick(mainContainer.key)}
                  />
                </div>
              )}

              {/* Остальные контейнеры - маленькие, в grid */}
              {otherContainers.length > 0 && mainContainer && (
                <div className="other-videos-grid">
                  {otherContainers.map(container => (
                    <VideoContainer
                      key={container.key}
                      peerId={container.peerId}
                      stream={container.stream}
                      username={container.username}
                      isLocal={container.isLocal}
                      isMain={false}
                      onVideoClick={() => handleVideoClick(container.key)}
                    />
                  ))}
                </div>
              )}

              {/* Если нет главного видео, показываем все в строку */}
              {!mainContainer && allContainers.length > 0 && (
                <div className="videos-row">
                  {allContainers.map(container => (
                    <VideoContainer
                      key={container.key}
                      peerId={container.peerId}
                      stream={container.stream}
                      username={container.username}
                      isLocal={container.isLocal}
                      isMain={false}
                      onVideoClick={() => handleVideoClick(container.key)}
                    />
                  ))}
                </div>
              )}
            </>
          );
        })()}
      </div>
    </div>
  );
}

