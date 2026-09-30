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
  const monitorPanel = document.getElementById('monitorPanel');
  const monitorVideo = document.getElementById('monitorVideo');

  if (!token) {
    joinStatus.textContent = 'This link is missing an invite token.';
    joinStatus.classList.add('error');
    joinBtn.disabled = true;
    return;
  }

  let pc = null;
  let monitorPc = null;
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

  async function handleIceCandidate(payload) {
    if (!pc) return;
    try {
      await pc.addIceCandidate(new RTCIceCandidate(payload));
    } catch (err) {
      console.warn('Failed to add ICE candidate', err);
    }
  }

  // ---- Room monitor: a second, dedicated peer connection carrying the
  // host's composited canvas + mixed audio back to this guest. Kept
  // entirely separate from `pc` (this guest's own camera/mic upload) rather
  // than renegotiating one shared connection -- two simple one-directional
  // connections are easier to reason about, and a shared-connection
  // renegotiation is exactly what made the earlier version of this feature
  // unreliable. This also replaces the previous Cloudflare-hosted-player
  // iframe approach: that player's several-second HLS/DASH latency put any
  // guest's own voice looping back through their speakers far outside what
  // browser echo cancellation can cancel (AEC only handles delays up to
  // roughly a few hundred ms) -- a real WebRTC feed keeps that loop at
  // normal WebRTC latency, where AEC actually has a chance.
  async function handleMonitorOffer(fromSocketId, offer) {
    monitorPc?.close();
    monitorPc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });

    monitorPc.ontrack = (event) => {
      if (monitorVideo.srcObject !== event.streams[0]) {
        monitorVideo.srcObject = event.streams[0];
        // Unmuted autoplay can be blocked without a fresh-enough user
        // gesture -- the join button click that got us here usually still
        // counts, but fall back to a one-tap prompt if a browser disagrees
        // rather than silently leaving the guest with no audio at all.
        monitorVideo.play().catch(() => {
          const resume = () => {
            monitorVideo.play().catch(() => {});
            document.removeEventListener('click', resume);
          };
          document.addEventListener('click', resume, { once: true });
          callStatus.textContent = 'Tap anywhere to enable room monitor audio.';
        });
      }
    };
    monitorPc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('signal', { to: fromSocketId, type: 'monitor-ice-candidate', payload: event.candidate });
      }
    };

    await monitorPc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await monitorPc.createAnswer();
    await monitorPc.setLocalDescription(answer);
    socket.emit('signal', { to: fromSocketId, type: 'monitor-answer', payload: answer });

    monitorPanel.style.display = 'block';
  }

  async function handleMonitorIceCandidate(payload) {
    if (!monitorPc) return;
    try {
      await monitorPc.addIceCandidate(new RTCIceCandidate(payload));
    } catch (err) {
      console.warn('Failed to add ICE candidate for the room monitor', err);
    }
  }

  function stopLocalMedia() {
    leaving = true;
    if (pc) {
      pc.close();
      pc = null;
    }
    if (monitorPc) {
      monitorPc.close();
      monitorPc = null;
    }
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
    }
    socket?.disconnect();
    monitorVideo.srcObject = null;
    monitorPanel.style.display = 'none';
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

    let invite;
    try {
      invite = await validateInvite();
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
      } else if (msg.type === 'monitor-offer') {
        await handleMonitorOffer(msg.from, msg.payload);
      } else if (msg.type === 'monitor-ice-candidate') {
        await handleMonitorIceCandidate(msg.payload);
      } else if (msg.type === 'kicked') {
        handleKicked();
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
