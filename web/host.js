(() => {
  const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

  const els = {
    loadStatus: document.getElementById('loadStatus'),
    loadPanel: document.getElementById('loadPanel'),
    studioPanel: document.getElementById('studioPanel'),
    canvas: document.getElementById('canvas'),
    startCameraBtn: document.getElementById('startCameraBtn'),
    createInviteBtn: document.getElementById('createInviteBtn'),
    toggleLayoutBtn: document.getElementById('toggleLayoutBtn'),
    goLiveBtn: document.getElementById('goLiveBtn'),
    endBtn: document.getElementById('endBtn'),
    studioStatus: document.getElementById('studioStatus'),
    inviteStatus: document.getElementById('inviteStatus'),
  };

  const ctx = els.canvas.getContext('2d');

  /** @type {{stream: any, hostToken: string} | null} */
  let session = null;
  let socket = null;

  /** socketId -> { pc, videoEl, displayName, audioSourceNode } ; 'local' is the host's own camera. */
  const participants = new Map();

  let audioContext = null;
  let audioDestination = null;

  let layoutMode = 'grid';
  let drawing = false;

  let whipPc = null;
  let whipResourceUrl = null;

  function setStatus(el, text, isError) {
    el.textContent = text;
    el.classList.toggle('error', Boolean(isError));
  }

  // ---- 1. Load the stream (studioSessionId, ingest info) ----
  //
  // Auth is the sb_session cookie (credentials:'include'), same as the
  // React dashboard — no API key pasted here. streamId comes from the URL
  // the create-stream flow navigates to (?streamId=...), not a form field.

  async function loadStream() {
    const streamId = new URLSearchParams(location.search).get('streamId');
    if (!streamId) {
      setStatus(els.loadStatus, 'Missing streamId in the URL.', true);
      return;
    }

    setStatus(els.loadStatus, 'Loading…');

    try {
      const res = await fetch(`/api/streams/${encodeURIComponent(streamId)}`, {
        credentials: 'include',
      });
      if (res.status === 401) {
        setStatus(els.loadStatus, '');
        els.loadStatus.innerHTML = 'You need to be logged in. <a href="/login">Log in</a>';
        return;
      }
      if (!res.ok) throw new Error(`Failed to load stream (${res.status})`);
      const stream = await res.json();
      if (!stream.studioSessionId) throw new Error('This stream has no studio session.');

      const hostTokenRes = await fetch(`/api/studio-sessions/${stream.studioSessionId}/host-token`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!hostTokenRes.ok) throw new Error(`Failed to authorize studio access (${hostTokenRes.status})`);
      const { token: hostToken } = await hostTokenRes.json();

      session = { stream, hostToken };
      els.loadPanel.style.display = 'none';
      els.studioPanel.style.display = 'block';
      els.goLiveBtn.disabled = !stream.whipUrl;
      els.endBtn.disabled = false;

      connectSignaling();
      startDrawLoop();
    } catch (err) {
      setStatus(els.loadStatus, err.message, true);
    }
  }

  loadStream();

  // ---- 2. Host's own camera ----

  els.startCameraBtn.addEventListener('click', async () => {
    els.startCameraBtn.disabled = true;
    try {
      const localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      const videoEl = document.createElement('video');
      videoEl.srcObject = localStream;
      videoEl.muted = true;
      videoEl.autoplay = true;
      videoEl.playsInline = true;
      await videoEl.play();

      participants.set('local', { videoEl, displayName: 'Host' });
      connectAudioTrack(localStream.getAudioTracks()[0]);
    } catch (err) {
      setStatus(els.studioStatus, `Could not start camera: ${err.message}`, true);
      els.startCameraBtn.disabled = false;
    }
  });

  // ---- 3. Signaling ----

  function connectSignaling() {
    socket = io('/studio', {
      auth: {
        role: 'host',
        sessionId: session.stream.studioSessionId,
        hostToken: session.hostToken,
        displayName: 'Host',
      },
    });

    socket.on('joined', () => setStatus(els.studioStatus, 'Connected to the studio as host.'));

    socket.on('peer-joined', ({ socketId, displayName }) => {
      setStatus(els.studioStatus, `${displayName} joined — requesting their video…`);
      socket.emit('signal', { to: socketId, type: 'request-offer', payload: {} });
    });

    socket.on('peer-left', ({ socketId }) => {
      const p = participants.get(socketId);
      if (p) {
        p.pc?.close();
        p.audioSourceNode?.disconnect();
        participants.delete(socketId);
      }
    });

    socket.on('signal', async (msg) => {
      if (msg.type === 'offer') {
        await handleGuestOffer(msg.from, msg.payload);
      } else if (msg.type === 'ice-candidate') {
        const p = participants.get(msg.from);
        if (p?.pc) {
          try {
            await p.pc.addIceCandidate(new RTCIceCandidate(msg.payload));
          } catch (err) {
            console.warn('Failed to add ICE candidate from guest', err);
          }
        }
      }
    });

    socket.on('error', (err) => setStatus(els.studioStatus, `Error: ${err.message}`, true));
  }

  async function handleGuestOffer(fromSocketId, offer) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const videoEl = document.createElement('video');
    videoEl.muted = true;
    videoEl.autoplay = true;
    videoEl.playsInline = true;

    participants.set(fromSocketId, { pc, videoEl, displayName: 'Guest' });

    pc.ontrack = (event) => {
      if (event.track.kind === 'video') {
        videoEl.srcObject = event.streams[0];
        videoEl.play().catch(() => {});
      } else if (event.track.kind === 'audio') {
        connectAudioTrack(event.track);
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('signal', { to: fromSocketId, type: 'ice-candidate', payload: event.candidate });
      }
    };

    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('signal', { to: fromSocketId, type: 'answer', payload: answer });
  }

  // ---- 4. Audio mixing ----

  function connectAudioTrack(track) {
    if (!track) return;
    if (!audioContext) {
      audioContext = new AudioContext();
      audioDestination = audioContext.createMediaStreamDestination();
    }
    const source = audioContext.createMediaStreamSource(new MediaStream([track]));
    source.connect(audioDestination);
  }

  // ---- 5. Canvas compositing ----

  els.toggleLayoutBtn.addEventListener('click', async () => {
    layoutMode = layoutMode === 'grid' ? 'spotlight' : 'grid';
    setStatus(els.studioStatus, `Layout: ${layoutMode}`);

    if (session) {
      try {
        await fetch(`/api/studio-sessions/${session.stream.studioSessionId}/layout`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ layoutConfig: { layout: layoutMode, overlays: [] } }),
        });
      } catch (err) {
        console.warn('Failed to persist layout change', err);
      }
    }
  });

  function startDrawLoop() {
    if (drawing) return;
    drawing = true;

    function frame() {
      const w = els.canvas.width;
      const h = els.canvas.height;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);

      const entries = [...participants.values()].filter((p) => p.videoEl.readyState >= 2);

      if (entries.length > 0) {
        if (layoutMode === 'spotlight') {
          drawSpotlight(entries, w, h);
        } else {
          drawGrid(entries, w, h);
        }
      }

      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function drawGrid(entries, w, h) {
    const cols = Math.ceil(Math.sqrt(entries.length));
    const rows = Math.ceil(entries.length / cols);
    const cellW = w / cols;
    const cellH = h / rows;

    entries.forEach((p, i) => {
      const x = (i % cols) * cellW;
      const y = Math.floor(i / cols) * cellH;
      drawCell(p, x, y, cellW, cellH);
    });
  }

  function drawSpotlight(entries, w, h) {
    drawCell(entries[0], 0, 0, w, h);
    const thumbSize = w / 6;
    entries.slice(1).forEach((p, i) => {
      drawCell(p, w - thumbSize - 8, 8 + i * (thumbSize * 0.6 + 8), thumbSize, thumbSize * 0.6);
    });
  }

  function drawCell(p, x, y, w, h) {
    ctx.drawImage(p.videoEl, x, y, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(x, y + h - 24, w, 24);
    ctx.fillStyle = '#fff';
    ctx.font = '14px sans-serif';
    ctx.fillText(p.displayName, x + 6, y + h - 6);
  }

  // ---- 6. Guest invites ----

  els.createInviteBtn.addEventListener('click', async () => {
    if (!session) return;
    try {
      const res = await fetch(`/api/studio-sessions/${session.stream.studioSessionId}/invites`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresInMinutes: 60 }),
      });
      if (!res.ok) throw new Error(`Failed to create invite (${res.status})`);
      const { joinUrl } = await res.json();
      setStatus(els.inviteStatus, `Guest link (60 min): ${joinUrl}`);
    } catch (err) {
      setStatus(els.inviteStatus, err.message, true);
    }
  });

  // ---- 7. WHIP publish (the composited canvas + mixed audio, to Cloudflare) ----

  els.goLiveBtn.addEventListener('click', async () => {
    if (!session?.stream.whipUrl) {
      setStatus(els.studioStatus, 'This stream has no WHIP URL — see the plan\'s empirical Cloudflare spike.', true);
      return;
    }

    els.goLiveBtn.disabled = true;
    setStatus(els.studioStatus, 'Starting publish…');

    try {
      const videoTrack = els.canvas.captureStream(30).getVideoTracks()[0];
      const audioTrack = audioDestination
        ? audioDestination.stream.getAudioTracks()[0]
        : null;

      whipPc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      whipPc.addTrack(videoTrack);
      if (audioTrack) whipPc.addTrack(audioTrack);

      const offer = await whipPc.createOffer();
      await whipPc.setLocalDescription(offer);
      await waitForIceGatheringComplete(whipPc);

      const res = await fetch(session.stream.whipUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: whipPc.localDescription.sdp,
      });
      if (!res.ok) throw new Error(`WHIP publish failed (${res.status})`);

      whipResourceUrl = res.headers.get('Location');
      const answerSdp = await res.text();
      await whipPc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

      setStatus(els.studioStatus, 'LIVE — publishing to Cloudflare.');
    } catch (err) {
      setStatus(els.studioStatus, `Failed to go live: ${err.message}`, true);
      els.goLiveBtn.disabled = false;
    }
  });

  function waitForIceGatheringComplete(pc) {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      const check = () => {
        if (pc.iceGatheringState === 'complete') {
          pc.removeEventListener('icegatheringstatechange', check);
          resolve();
        }
      };
      pc.addEventListener('icegatheringstatechange', check);
      // WHIP is a single HTTP exchange, not trickle ICE — cap the wait so a
      // slow/blocked STUN lookup can't hang "Go live" forever.
      setTimeout(resolve, 3000);
    });
  }

  // ---- 8. End the stream ----

  els.endBtn.addEventListener('click', async () => {
    els.endBtn.disabled = true;
    setStatus(els.studioStatus, 'Ending stream…');

    if (whipResourceUrl) {
      try {
        await fetch(whipResourceUrl, { method: 'DELETE' });
      } catch (err) {
        console.warn('Best-effort WHIP teardown failed (backend end() will still tear down the relay)', err);
      }
    }

    try {
      const res = await fetch(`/api/streams/${session.stream.id}/end`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`Failed to end stream (${res.status})`);
      setStatus(els.studioStatus, 'Stream ended.');
    } catch (err) {
      setStatus(els.studioStatus, err.message, true);
    }

    whipPc?.close();
    for (const p of participants.values()) p.pc?.close();
    socket?.disconnect();
  });
})();
