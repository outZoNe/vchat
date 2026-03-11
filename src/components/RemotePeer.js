import { Box, Button, Icon, Slider, SliderFilledTrack, SliderThumb, SliderTrack, Tooltip } from '@chakra-ui/react';
import { useEffect, useRef, useState } from 'react';
import { IoMdVideocam } from 'react-icons/io';
import { FaMicrophoneAlt, FaMicrophoneAltSlash, FaUser, FaVolumeMute, FaVolumeUp } from 'react-icons/fa';
import { TbPinned, TbPinnedOff } from 'react-icons/tb';
import { useSelector } from 'react-redux';
import { APP_COLORS } from '../utils/theme';
import { WS } from '../services/WebSocketManager';
import { getAudioContext } from '../utils/helper';

const SPEAKING_THRESHOLD = 0.08;

const iconStyle = {
  position: 'absolute',
  top: 3,
  zIndex: 2,
  boxSize: 6,
  bgColor: APP_COLORS.BACKGROUND_PRIMARY,
  padding: 1,
  borderRadius: '3px',
};

const RemotePeer = ({ peer, isPinned, onTogglePin }) => {
  const globalMuted = useSelector((s) => s.globalMuted);
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const isSpeakingRef = useRef(false);

  const [isVideoEnabled, setIsVideoEnabled] = useState(false);
  const [volume, setVolume] = useState(0.75);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isStreamAudioMuted, setIsStreamAudioMuted] = useState(true);

  const isAudioActive = peer.audioTrack && !peer.audioMuted;

  useEffect(() => {
    if (!peer.userName) return;
    const saved = localStorage.getItem(`volume_${peer.userName}`);
    if (saved !== null) setVolume(parseFloat(saved));
  }, [peer.userName]);

  useEffect(() => {
    if (peer.videoTrack) setIsStreamAudioMuted(true);
  }, [peer.videoTrack]);

  useEffect(() => {
    const audioEl = audioRef.current;
    if (!audioEl || !peer.audioTrack || globalMuted) {
      if (audioEl) {
        audioEl.pause();
        audioEl.srcObject = null;
      }
      return;
    }

    const stream = new MediaStream([peer.audioTrack]);
    audioEl.srcObject = stream;
    audioEl.volume = volume;
    audioEl.play().catch(() => {});

    const audioCtx = getAudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    let rafId,
      smoothedLevel = 0,
      speakingTimeout;

    const tick = () => {
      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const v = dataArray[i] / 255;
        sum += v * v;
      }
      smoothedLevel = 0.8 * smoothedLevel + 0.2 * Math.sqrt(sum / dataArray.length);

      if (smoothedLevel > SPEAKING_THRESHOLD) {
        if (!isSpeakingRef.current) {
          isSpeakingRef.current = true;
          setIsSpeaking(true);
        }
      } else if (isSpeakingRef.current) {
        speakingTimeout = setTimeout(() => {
          isSpeakingRef.current = false;
          setIsSpeaking(false);
        }, 300);
      }
      rafId = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(rafId);
      analyser.disconnect();
      source.disconnect();
      clearTimeout(speakingTimeout);
      audioEl.pause();
      audioEl.srcObject = null;
    };
  }, [peer.audioTrack, globalMuted, volume]);

  useEffect(() => {
    if (!peer.videoTrack) setIsVideoEnabled(false);
    const el = videoRef.current;
    if (!el) return;
    if (!peer.videoTrack || !isVideoEnabled) {
      el.srcObject = null;
      return;
    }
    const tracks = [peer.videoTrack];
    if (peer.screenAudioTrack) tracks.push(peer.screenAudioTrack);
    el.srcObject = new MediaStream(tracks);
    el.play().catch(() => {});
  }, [peer.videoTrack, peer.screenAudioTrack, isVideoEnabled]);

  const handleVolumeChange = (val) => {
    const v = val / 100;
    setVolume(v);
    if (peer.userName) localStorage.setItem(`volume_${peer.userName}`, v);
    if (audioRef.current) audioRef.current.volume = v;
  };

  const toggleVideo = async () => {
    if (!peer.videoConsumer) return;
    try {
      if (isVideoEnabled) {
        await peer.videoConsumer.pause();
        setIsVideoEnabled(false);
      } else {
        WS.send({ type: 'resumeConsumer', data: { consumerId: peer.videoConsumer.id } });
        await peer.videoConsumer.resume();
        setIsVideoEnabled(true);
      }
    } catch (err) {
      console.error('toggleVideo error:', err);
    }
  };

  const toggleFullscreen = () => {
    const el = videoRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.() || el.webkitRequestFullscreen?.() || el.msRequestFullscreen?.();
    } else {
      document.exitFullscreen?.() || document.webkitExitFullscreen?.() || document.msExitFullscreen?.();
    }
  };

  return (
    <Box
      boxShadow="0 4px 12px rgba(0,0,0,0.3)"
      border={`2px solid ${APP_COLORS.BLURPLE}`}
      padding={0}
      display="flex"
      alignItems="center"
      justifyContent="center"
      bg="gray.700"
      borderRadius="10px"
      className={`${isSpeaking ? 'speaking' : ''} peer-container ${isPinned ? 'peer-container-pinned' : ''}`}
    >
      {peer.videoTrack && !isVideoEnabled && (
        <Button
          size="sm"
          position="absolute"
          zIndex={2}
          onClick={toggleVideo}
          color={APP_COLORS.TEXT_PRIMARY}
          bgColor={APP_COLORS.BLURPLE}
          _hover={{ bgColor: APP_COLORS.BLURPLE_HOVER }}
        >
          Показать видео
        </Button>
      )}

      <Tooltip
        label={isAudioActive ? 'Микрофон включен' : 'Микрофон выключен'}
        hasArrow
      >
        <Icon
          as={isAudioActive ? FaMicrophoneAlt : FaMicrophoneAltSlash}
          {...iconStyle}
          left={3}
          color={isAudioActive ? APP_COLORS.GREEN : APP_COLORS.RED}
        />
      </Tooltip>

      {!peer.videoTrack && (
        <FaUser
          size={80}
          color="gray"
          style={{ position: 'absolute' }}
        />
      )}

      <Tooltip
        label={isPinned ? 'Открепить' : 'Закрепить'}
        hasArrow
      >
        <Icon
          as={isPinned ? TbPinnedOff : TbPinned}
          {...iconStyle}
          right={3}
          cursor="pointer"
          color={APP_COLORS.GREEN}
          onClick={onTogglePin}
        />
      </Tooltip>

      {peer.screenAudioTrack && isVideoEnabled && (
        <Tooltip
          label={isStreamAudioMuted ? 'Включить звук стрима' : 'Выключить звук стрима'}
          hasArrow
        >
          <Icon
            as={isStreamAudioMuted ? FaVolumeMute : FaVolumeUp}
            {...iconStyle}
            right="4.25rem"
            cursor="pointer"
            color={isStreamAudioMuted ? APP_COLORS.RED : APP_COLORS.GREEN}
            onClick={() => setIsStreamAudioMuted((m) => !m)}
          />
        </Tooltip>
      )}

      {peer.videoTrack && isVideoEnabled && (
        <Tooltip
          label="Скрыть видео"
          hasArrow
        >
          <Icon
            as={IoMdVideocam}
            {...iconStyle}
            right={10}
            cursor="pointer"
            color={APP_COLORS.GREEN}
            onClick={toggleVideo}
          />
        </Tooltip>
      )}

      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isStreamAudioMuted}
        onClick={toggleFullscreen}
        onPause={(e) => e.target.play().catch(() => {})}
        style={{ width: '100%', height: '100%', borderRadius: '8px', objectFit: 'cover' }}
      />

      <audio
        ref={audioRef}
        autoPlay
        muted={Boolean(globalMuted)}
      />

      <Box
        position="absolute"
        bottom={1}
        width="calc(100% - 30px)"
        zIndex={2}
      >
        <Slider
          value={volume * 100}
          min={0}
          max={100}
          size="sm"
          onChange={handleVolumeChange}
        >
          <SliderTrack>
            <SliderFilledTrack />
          </SliderTrack>
          <SliderThumb />
        </Slider>
      </Box>

      <Box
        position="absolute"
        top={2}
        color="white"
        fontSize="12px"
        bg="rgba(0,0,0,0.4)"
        px={2}
        py={1}
        borderRadius="6px"
      >
        {peer.userName ?? 'Anonymous'}
      </Box>
    </Box>
  );
};

export default RemotePeer;
