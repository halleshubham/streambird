(() => {
  // Explicit rather than relying on browser defaults -- VDO.Ninja (a mature
  // WebRTC production tool) leans on exactly these three constraints as its
  // primary defense for guests on speakers rather than headphones, alongside
  // a "use headphones" prompt like ours. AEC/NS/AGC defaults vary across
  // browsers; being explicit means we always get them.
  const AUDIO_CONSTRAINTS = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

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
  const monitorAudio = document.getElementById('monitorAudio');
  const monitorStatus = document.getElementById('monitorStatus');
  const monitorVideoGrid = document.getElementById('monitorVideoGrid');

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

  // ---- Room monitor: a second, dedicated peer connection carrying this
  // guest's personal mix-minus audio feed (everyone else's mic, never their
  // own) plus every other participant's video, back from the host. Kept
  // entirely separate from `pc` (this guest's own camera/mic upload) rather
  // than renegotiating one shared connection -- two simple one-directional
  // connections are easier to reason about, and a shared-connection
  // renegotiation is exactly what made an earlier version of this feature
  // unreliable. This replaced two earlier approaches: a Cloudflare-hosted-
  // player iframe (several seconds of HLS/DASH latency put a guest's own
  // voice looping back through their speakers far outside what echo
  // cancellation can handle), and relaying the host's full composited
  // canvas + mixed audio (needed its own video encode and consistently hit
  // ICE/negotiation trouble -- see git history). Mix-minus sidesteps the
  // echo problem entirely, regardless of latency or headphone use: a
  // guest's own voice is never in what they receive, so there's nothing of
  // theirs to loop back.
  //
  // The host fully recreates this connection (new offer) every time the
  // room's video roster changes rather than renegotiating in place -- see
  // host.js's refreshAllMonitorFeeds() for why -- so the video tile grid is
  // wiped and rebuilt from scratch on every offer rather than tracked
  // incrementally.
  const videoTiles = new Map(); // participantId -> { container, videoEl, nameEl }

  function clearVideoTiles() {
    monitorVideoGrid.innerHTML = '';
    videoTiles.clear();
  }

  function renderVideoTile(participantId, displayName, stream) {
    let tile = videoTiles.get(participantId);
    if (!tile) {
      const container = document.createElement('div');
      container.className = 'monitor-video-tile';
      const videoEl = document.createElement('video');
      videoEl.autoplay = true;
      videoEl.playsInline = true;
      videoEl.muted = true; // these are camera feeds, not audio sources -- the mix-minus audio element carries all sound
      const nameEl = document.createElement('span');
      nameEl.className = 'monitor-video-tile-name';
      container.appendChild(videoEl);
      container.appendChild(nameEl);
      monitorVideoGrid.appendChild(container);
      tile = { container, videoEl, nameEl };
      videoTiles.set(participantId, tile);
    }
    tile.nameEl.textContent = displayName;
    if (tile.videoEl.srcObject !== stream) {
      tile.videoEl.srcObject = stream;
      tile.videoEl.play().catch(() => {});
    }
  }

  async function handleMonitorOffer(fromSocketId, payload) {
    const offer = payload.sdp;
    const participantsByMid = payload.participantsByMid || {};

    monitorPanel.style.display = 'block';
    monitorStatus.textContent = 'Room monitor offer received — connecting…';
    clearVideoTiles();

    try {
      monitorPc?.close();
      monitorPc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });

      monitorPc.ontrack = (event) => {
        // Confirmed live: event.streams can be empty if the sender didn't
        // pass an explicit `streams` array to addTransceiver (fixed
        // host-side too, but staying defensive on the receiver is exactly
        // what VDO.Ninja's own ontrack handler does -- never trust
        // event.streams[0] to be populated, fall back to the bare track).
        const incomingStream = event.streams && event.streams[0] ? event.streams[0] : new MediaStream([event.track]);

        if (event.track.kind === 'video') {
          const mid = event.transceiver && event.transceiver.mid;
          const info = mid ? participantsByMid[mid] : null;
          renderVideoTile(info ? info.participantId : event.track.id, info ? info.displayName : 'Participant', incomingStream);
          return;
        }

        if (monitorAudio.srcObject !== incomingStream) {
          monitorAudio.srcObject = incomingStream;
          // Starting muted and unmuting right after is the standard
          // workaround for unmuted-autoplay blocking: browsers always allow
          // muted autoplay, and (unlike *starting* unmuted playback) simply
          // flipping .muted off on already-rolling media generally isn't
          // re-blocked.
          monitorAudio.muted = true;
          monitorAudio
            .play()
            .then(() => {
              monitorAudio.muted = false;
              monitorStatus.textContent = 'Room monitor: connected';
            })
            .catch(() => {
              const resume = () => {
                monitorAudio.muted = false;
                monitorAudio.play().catch(() => {});
                document.removeEventListener('click', resume);
              };
              document.addEventListener('click', resume, { once: true });
              monitorStatus.textContent = 'Tap anywhere to enable the room monitor.';
            });
        }
      };
      monitorPc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('signal', { to: fromSocketId, type: 'monitor-ice-candidate', payload: event.candidate });
        }
      };
      monitorPc.onconnectionstatechange = () => {
        // 'connected' is reported once ontrack's own play()/mute-unmute
        // settles, so as not to clobber a still-pending tap-to-enable
        // prompt with a falsely-reassuring "connected".
        if (monitorPc.connectionState === 'connected') return;
        monitorStatus.textContent = `Room monitor: ${monitorPc.connectionState}`;
      };

      await monitorPc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await monitorPc.createAnswer();
      await monitorPc.setLocalDescription(answer);
      socket.emit('signal', { to: fromSocketId, type: 'monitor-answer', payload: answer });
    } catch (err) {
      monitorStatus.textContent = `Room monitor failed to connect: ${err.message}`;
      console.error('Room monitor negotiation failed', err);
    }
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
    monitorAudio.srcObject = null;
    clearVideoTiles();
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
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: AUDIO_CONSTRAINTS });
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
