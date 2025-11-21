import {useCallback, useRef, useState} from 'react';

/**
 * Application State Management Hook
 */
export function useAppState() {
  const [pcs, setPcs] = useState({});
  const [localStream, setLocalStream] = useState(null);
  const [tracks, setTracks] = useState({audio: null, video: null, screen: null});
  const [currentTracks, setCurrentTracks] = useState({audio: null, video: null, screen: null});
  const [iceCandidateBuffer, setIceCandidateBuffer] = useState({});
  const [remoteUsernames, setRemoteUsernames] = useState({});
  const [remoteStreams, setRemoteStreams] = useState({});
  const [myId, setMyId] = useState(null);
  const [myUsername, setMyUsername] = useState("Anonymous");
  const [playbackEnabled, setPlaybackEnabled] = useState(false);
  const audioContextRef = useRef(null);

  const initAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      audioContextRef.current = AudioContextClass ? new AudioContextClass() : null;
    }
    return audioContextRef.current;
  }, []);

  const getPeerConnection = useCallback((id) => {
    return pcs[id];
  }, [pcs]);

  const setPeerConnection = useCallback((id, pc) => {
    setPcs(prev => ({...prev, [id]: pc}));
  }, []);

  const removePeerConnection = useCallback((id) => {
    setPcs(prev => {
      const newPcs = {...prev};
      if (newPcs[id]) {
        const pc = newPcs[id];
        if (pc._audioCheckInterval) {
          clearInterval(pc._audioCheckInterval);
          delete pc._audioCheckInterval;
        }
        pc.close();
        delete newPcs[id];
      }
      return newPcs;
    });
    setIceCandidateBuffer(prev => {
      const newBuffer = {...prev};
      delete newBuffer[id];
      return newBuffer;
    });
    setRemoteUsernames(prev => {
      const newUsernames = {...prev};
      delete newUsernames[id];
      return newUsernames;
    });
  }, []);

  const setRemoteUsername = useCallback((peerId, username) => {
    setRemoteUsernames(prev => ({...prev, [peerId]: username}));
  }, []);

  const getRemoteUsername = useCallback((peerId) => {
    return remoteUsernames[peerId];
  }, [remoteUsernames]);

  const clearAll = useCallback(() => {
    Object.keys(pcs).forEach(id => {
      const pc = pcs[id];
      if (pc._audioCheckInterval) {
        clearInterval(pc._audioCheckInterval);
      }
      pc.close();
    });
    setPcs({});
    setLocalStream(null);
    setTracks({audio: null, video: null, screen: null});
    setCurrentTracks({audio: null, video: null, screen: null});
    setIceCandidateBuffer({});
    setRemoteUsernames({});
  }, [pcs]);

  return {
    pcs,
    setPcs,
    localStream,
    setLocalStream,
    tracks,
    setTracks,
    currentTracks,
    setCurrentTracks,
    iceCandidateBuffer,
    setIceCandidateBuffer,
    remoteUsernames,
    setRemoteUsernames,
    remoteStreams,
    setRemoteStreams,
    myId,
    setMyId,
    myUsername,
    setMyUsername,
    playbackEnabled,
    setPlaybackEnabled,
    audioContext: audioContextRef.current,
    initAudioContext,
    getPeerConnection,
    setPeerConnection,
    removePeerConnection,
    setRemoteUsername,
    getRemoteUsername,
    clearAll
  };
}

