(() => {
  const token = new URLSearchParams(location.search).get('token');
  const joinStatus = document.getElementById('joinStatus');
  const callStatus = document.getElementById('callStatus');
  const joinPanel = document.getElementById('joinPanel');
  const callPanel = document.getElementById('callPanel');
  const localVideo = document.getElementById('localVideo');
  const joinBtn = document.getElementById('joinBtn');
  const toggleMicBtn = document.getElementById('toggleMicBtn');
  const toggleCameraBtn = document.getElementById('toggleCameraBtn');
  const leaveBtn = document.getElementById('leaveBtn');
  const broadcastVideo = document.getElementById('broadcastVideo');
  const broadcastPanel = document.getElementById('broadcastPanel');
  const broadcastStatus = document.getElementById('broadcastStatus');

  if (!token) {
    joinStatus.textContent = 'This link is missing an invite token.';
    joinStatus.classList.add('error');
    joinBtn.disabled = true;
    return;
  }

  let pc = null;
  let hostSocketId = null;
  let socket = null;
  let localStream = null;
  let micEnabled = true;
  let cameraEnabled = true;
  let leaving = false;

  async function validateInvite() {
    const res = await fetch(`/api/studio-sessions/invites/${encodeURIComponent(token)}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || `This invite is no longer valid (${res.status}).`);
    }
    return res.json();
  }

  function setupPeerConnection(localStream) {
    const conn = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    for (const track of localStream.getTracks()) {
      conn.addTrack(track, localStream);
    }

    conn.onicecandidate = (event) => {
      if (event.candidate && hostSocketId) {
        socket.emit('signal', {
          to: hostSocketId,
          type: 'ice-candidate',
          payload: event.candidate,
        });
      }
    };

    conn.onconnectionstatechange = () => {
      // pc.close() (deliberate leave, or a kick) fires this asynchronously,
      // after the current call stack finishes -- without this guard, it
      // overwrites handleKicked()'s/leaveBtn's own message with a generic
      // "Connection: closed" moments after it's shown.
      if (leaving) return;
      callStatus.textContent = `Connection: ${conn.connectionState}`;
    };

    // Fires once the host renegotiates in its "backstage" monitor feed (the
    // composited canvas + mixed audio) -- the guest never adds any tracks
    // beyond its own camera/mic, so any track arriving here is that feed.
    conn.ontrack = (event) => {
      broadcastVideo.srcObject = event.streams[0];
      broadcastPanel.style.display = 'block';
    };

    return conn;
  }

  async function handleRequestOffer(fromSocketId, localStream) {
    hostSocketId = fromSocketId;
    pc = setupPeerConnection(localStream);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('signal', { to: hostSocketId, type: 'offer', payload: offer });
  }

  async function handleAnswer(payload) {
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(payload));
    callStatus.textContent = 'Connected — you are live in the studio.';
  }

  // The host only ever sends an 'offer' here as a renegotiation, to add its
  // backstage monitor feed after the initial connection is up -- respond
  // with our own answer on the same pc, same as any WebRTC renegotiation.
  async function handleHostOffer(payload) {
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(payload));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('signal', { to: hostSocketId, type: 'answer', payload: answer });
  }

  async function handleIceCandidate(payload) {
    if (!pc) return;
    try {
      await pc.addIceCandidate(new RTCIceCandidate(payload));
    } catch (err) {
      console.warn('Failed to add ICE candidate', err);
    }
  }

  function stopLocalMedia() {
    leaving = true;
    if (pc) {
      pc.close();
      pc = null;
    }
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
    }
    socket?.disconnect();
  }

  function handleKicked() {
    callStatus.textContent = 'You were removed from the room by the host.';
    callStatus.classList.add('error');
    stopLocalMedia();
    toggleMicBtn.disabled = true;
    toggleCameraBtn.disabled = true;
    leaveBtn.disabled = true;
  }

  toggleMicBtn.addEventListener('click', () => {
    if (!localStream) return;
    micEnabled = !micEnabled;
    localStream.getAudioTracks().forEach((t) => { t.enabled = micEnabled; });
    toggleMicBtn.textContent = micEnabled ? 'Mute mic' : 'Unmute mic';
  });

  toggleCameraBtn.addEventListener('click', () => {
    if (!localStream) return;
    cameraEnabled = !cameraEnabled;
    localStream.getVideoTracks().forEach((t) => { t.enabled = cameraEnabled; });
    toggleCameraBtn.textContent = cameraEnabled ? 'Disable camera' : 'Enable camera';
  });

  leaveBtn.addEventListener('click', () => {
    callStatus.textContent = 'You left the room.';
    stopLocalMedia();
    toggleMicBtn.disabled = true;
    toggleCameraBtn.disabled = true;
    leaveBtn.disabled = true;
  });

  joinBtn.addEventListener('click', async () => {
    joinBtn.disabled = true;
    joinStatus.textContent = 'Checking invite…';

    try {
      await validateInvite();
    } catch (err) {
      joinStatus.textContent = err.message;
      joinStatus.classList.add('error');
      joinBtn.disabled = false;
      return;
    }

    const displayName = document.getElementById('displayName').value.trim() || 'Guest';

    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch (err) {
      joinStatus.textContent = `Could not access camera/mic: ${err.message}`;
      joinStatus.classList.add('error');
      joinBtn.disabled = false;
      return;
    }

    localVideo.srcObject = localStream;
    joinPanel.style.display = 'none';
    callPanel.style.display = 'block';
    callStatus.textContent = 'Joining…';

    socket = io('/studio', { auth: { role: 'guest', token, displayName } });

    socket.on('joined', () => {
      callStatus.textContent = 'Joined — waiting for the host to connect…';
    });

    socket.on('signal', async (msg) => {
      if (msg.type === 'request-offer') {
        await handleRequestOffer(msg.from, localStream);
      } else if (msg.type === 'answer') {
        await handleAnswer(msg.payload);
      } else if (msg.type === 'ice-candidate') {
        await handleIceCandidate(msg.payload);
      } else if (msg.type === 'kicked') {
        handleKicked();
      } else if (msg.type === 'offer') {
        await handleHostOffer(msg.payload);
      } else if (msg.type === 'broadcast-toggle') {
        broadcastStatus.textContent = msg.payload.enabled ? '' : 'Host has paused the broadcast preview.';
      }
    });

    socket.on('error', (err) => {
      callStatus.textContent = `Error: ${err.message}`;
      callStatus.classList.add('error');
    });

    socket.on('disconnect', () => {
      callStatus.textContent = 'Disconnected from the studio.';
    });
  });
})();
