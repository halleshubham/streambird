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
    toggleBackstageBtn: document.getElementById('toggleBackstageBtn'),
    studioStatus: document.getElementById('studioStatus'),
    inviteStatus: document.getElementById('inviteStatus'),
    participantList: document.getElementById('participantList'),
    logoInput: document.getElementById('logoInput'),
    newsInput: document.getElementById('newsInput'),
    nameFontSizeInput: document.getElementById('nameFontSizeInput'),
  };

  const ctx = els.canvas.getContext('2d');

  /** @type {{stream: any, hostToken: string} | null} */
  let session = null;
  let socket = null;

  /**
   * socketId -> { pc, videoEl, displayName, audioSourceNode, audioTrack,
   * videoTrack, audioEnabled, videoEnabled } ; 'local' is the host's own
   * camera (no pc — it never negotiates with itself).
   */
  const participants = new Map();

  // peer-joined arrives before the guest's offer (and thus before a
  // participants entry exists for them), but it's the only event carrying
  // their chosen display name — stash it here until handleGuestOffer creates
  // the real entry.
  const pendingDisplayNames = new Map();

  let audioContext = null;
  let audioDestination = null;

  let layoutMode = 'grid';
  let drawing = false;

  const branding = {
    logoImg: null,
    newsText: '',
    nameFontSize: 14,
  };
  let newsScrollX = null;
  let lastFrameTime = null;

  let whipPc = null;
  let whipResourceUrl = null;
  let keyFrameInterval = null;
  let endingStream = false;

  // The "backstage" feed is the composited canvas + mixed audio relayed back
  // to each guest as a live monitor of what's actually going out -- the same
  // MediaStreamTrack objects are added as a sender to every guest's
  // RTCPeerConnection, so toggling .enabled once mutes/unmutes it for all of
  // them at once without a per-guest loop over the media itself.
  let backstageStream = null;
  let backstageEnabled = true;

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

      const videoTrack = localStream.getVideoTracks()[0];
      const audioTrack = localStream.getAudioTracks()[0];
      participants.set('local', {
        videoEl,
        displayName: 'Host',
        videoTrack,
        audioTrack,
        audioEnabled: true,
        videoEnabled: true,
      });
      connectAudioTrack(audioTrack);
      renderParticipantList();
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

    // Without these, a dropped connection (e.g. a backend redeploy -- this
    // gateway's state is in-memory only, so a restart drops every open
    // socket) left the page silently showing "Connected to the studio as
    // host." forever with zero indication anything had gone wrong, which
    // is exactly why a guest joining afterward saw "waiting for the host"
    // and stayed stuck: the host's signaling socket was gone, and nothing
    // ever surfaced that. socket.io-client auto-reconnects and resends the
    // same auth payload, so 'joined' firing again after 'disconnect' is
    // the normal, expected recovery path here, not an error on its own --
    // except for the endBtn handler's own deliberate socket.disconnect(),
    // which never reconnects (that's the point), so it's excluded via
    // endingStream rather than shown as a scary, misleading "reconnecting".
    socket.on('disconnect', (reason) => {
      if (endingStream) return;
      setStatus(els.studioStatus, `Lost connection to studio signaling (${reason}) — reconnecting…`, true);
    });
    socket.on('connect_error', (err) => {
      setStatus(els.studioStatus, `Signaling connection failed: ${err.message}`, true);
    });

    socket.on('peer-joined', ({ socketId, displayName }) => {
      setStatus(els.studioStatus, `${displayName} joined — requesting their video…`);
      pendingDisplayNames.set(socketId, displayName || 'Guest');
      socket.emit('signal', { to: socketId, type: 'request-offer', payload: {} });
    });

    socket.on('peer-left', ({ socketId }) => {
      const p = participants.get(socketId);
      if (p) {
        p.pc?.close();
        p.audioSourceNode?.disconnect();
        participants.delete(socketId);
        renderParticipantList();
      }
      pendingDisplayNames.delete(socketId);
    });

    socket.on('signal', async (msg) => {
      if (msg.type === 'offer') {
        await handleGuestOffer(msg.from, msg.payload);
      } else if (msg.type === 'answer') {
        // Only reachable via a renegotiation we started (addBackstageFeed) --
        // the initial guest<->host offer/answer is handled entirely inside
        // handleGuestOffer, which sends its own answer directly.
        const p = participants.get(msg.from);
        if (p?.pc) {
          try {
            await p.pc.setRemoteDescription(new RTCSessionDescription(msg.payload));
          } catch (err) {
            console.warn('Failed to apply renegotiation answer from guest', err);
          }
        }
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

    const displayName = pendingDisplayNames.get(fromSocketId) || 'Guest';
    pendingDisplayNames.delete(fromSocketId);
    participants.set(fromSocketId, {
      pc,
      videoEl,
      displayName,
      audioEnabled: true,
      videoEnabled: true,
    });
    renderParticipantList();

    pc.ontrack = (event) => {
      const p = participants.get(fromSocketId);
      if (event.track.kind === 'video') {
        videoEl.srcObject = event.streams[0];
        videoEl.play().catch(() => {});
        if (p) {
          p.videoTrack = event.track;
          event.track.enabled = p.videoEnabled;
        }
      } else if (event.track.kind === 'audio') {
        connectAudioTrack(event.track);
        if (p) {
          p.audioTrack = event.track;
          event.track.enabled = p.audioEnabled;
        }
      }
      renderParticipantList();
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

    // JSEP forbids adding new m-lines to that same answer -- this guest's
    // backstage monitor feed needs its own follow-up offer/answer cycle,
    // which addBackstageFeed kicks off once the initial connection is set.
    addBackstageFeed(fromSocketId, pc);
  }

  // ---- 3b. Per-participant controls (mute / camera / drop) ----

  function renderParticipantList() {
    els.participantList.innerHTML = '';
    for (const [id, p] of participants) {
      const row = document.createElement('div');
      row.className = 'participant-row';

      const name = document.createElement('span');
      name.textContent = p.displayName;
      row.appendChild(name);

      const audioBtn = document.createElement('button');
      audioBtn.textContent = p.audioEnabled === false ? 'Unmute' : 'Mute';
      audioBtn.addEventListener('click', () => toggleParticipantAudio(id));
      row.appendChild(audioBtn);

      const videoBtn = document.createElement('button');
      videoBtn.textContent = p.videoEnabled === false ? 'Enable camera' : 'Disable camera';
      videoBtn.addEventListener('click', () => toggleParticipantVideo(id));
      row.appendChild(videoBtn);

      if (id !== 'local') {
        const dropBtn = document.createElement('button');
        dropBtn.className = 'danger';
        dropBtn.textContent = 'Remove from room';
        dropBtn.addEventListener('click', () => dropParticipant(id));
        row.appendChild(dropBtn);
      }

      els.participantList.appendChild(row);
    }
  }

  function toggleParticipantAudio(id) {
    const p = participants.get(id);
    if (!p) return;
    p.audioEnabled = !p.audioEnabled;
    if (p.audioTrack) p.audioTrack.enabled = p.audioEnabled;
    renderParticipantList();
  }

  function toggleParticipantVideo(id) {
    const p = participants.get(id);
    if (!p) return;
    p.videoEnabled = !p.videoEnabled;
    if (p.videoTrack) p.videoTrack.enabled = p.videoEnabled;
    renderParticipantList();
  }

  // Guests only — the host can't drop themself (use "End stream" for that).
  // Closing our side of the peer connection stops compositing them
  // immediately; the 'kicked' signal lets the guest's own page notice and
  // leave cleanly instead of just seeing a connection drop.
  function dropParticipant(id) {
    if (id === 'local') return;
    const p = participants.get(id);
    if (!p) return;
    socket?.emit('signal', { to: id, type: 'kicked', payload: {} });
    p.pc?.close();
    p.audioSourceNode?.disconnect();
    participants.delete(id);
    renderParticipantList();
  }

  // ---- 3c. Backstage broadcast (relay the composited canvas + mixed audio back to guests) ----

  function ensureBackstageStream() {
    if (backstageStream) return backstageStream;
    const videoTrack = els.canvas.captureStream(30).getVideoTracks()[0];
    ensureAudioMix();
    const audioTrack = audioDestination.stream.getAudioTracks()[0];
    videoTrack.enabled = backstageEnabled;
    audioTrack.enabled = backstageEnabled;
    backstageStream = new MediaStream([videoTrack, audioTrack]);
    return backstageStream;
  }

  function addBackstageFeed(socketId, pc) {
    const stream = ensureBackstageStream();
    for (const track of stream.getTracks()) {
      pc.addTrack(track, stream);
    }
    renegotiate(socketId, pc);
  }

  async function renegotiate(socketId, pc) {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('signal', { to: socketId, type: 'offer', payload: offer });
    } catch (err) {
      console.warn('Renegotiation with guest failed', err);
    }
  }

  els.toggleBackstageBtn.addEventListener('click', () => {
    backstageEnabled = !backstageEnabled;
    if (backstageStream) {
      backstageStream.getTracks().forEach((t) => { t.enabled = backstageEnabled; });
    }
    els.toggleBackstageBtn.textContent = backstageEnabled
      ? 'Hide broadcast from guests'
      : 'Show broadcast to guests';

    for (const socketId of participants.keys()) {
      if (socketId === 'local') continue;
      socket?.emit('signal', { to: socketId, type: 'broadcast-toggle', payload: { enabled: backstageEnabled } });
    }
  });

  // ---- 4. Audio mixing ----

  function ensureAudioMix() {
    if (!audioContext) {
      audioContext = new AudioContext();
      audioDestination = audioContext.createMediaStreamDestination();
    }
  }

  function connectAudioTrack(track) {
    if (!track) return;
    ensureAudioMix();
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

    function frame(now) {
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

      drawLogo(w);
      drawNewsline(w, h, now);

      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function drawLogo(canvasW) {
    if (!branding.logoImg) return;
    const maxH = 60;
    const scale = maxH / branding.logoImg.naturalHeight;
    const w = branding.logoImg.naturalWidth * scale;
    ctx.drawImage(branding.logoImg, 16, 16, w, maxH);
  }

  function drawNewsline(w, h, now) {
    if (!branding.newsText) return;
    const barH = 36;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(0, h - barH, w, barH);

    ctx.font = '18px sans-serif';
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    const textWidth = ctx.measureText(branding.newsText).width;

    if (newsScrollX === null) newsScrollX = w;
    const dt = lastFrameTime === null ? 0 : now - lastFrameTime;
    lastFrameTime = now;

    const speedPxPerMs = 0.08;
    newsScrollX -= dt * speedPxPerMs;
    if (newsScrollX + textWidth < 0) newsScrollX = w;

    ctx.fillText(branding.newsText, newsScrollX, h - barH / 2);
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
    ctx.font = `${branding.nameFontSize}px sans-serif`;
    ctx.fillText(p.displayName, x + 6, y + h - 6);
  }

  // ---- 5b. Branding overlays (logo, news ticker, name label size) ----

  els.logoInput.addEventListener('change', () => {
    const file = els.logoInput.files?.[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      branding.logoImg = img;
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  });

  els.newsInput.addEventListener('input', () => {
    branding.newsText = els.newsInput.value.trim();
    newsScrollX = null;
  });

  els.nameFontSizeInput.addEventListener('input', () => {
    const size = parseInt(els.nameFontSizeInput.value, 10);
    if (Number.isFinite(size) && size > 0) branding.nameFontSize = size;
  });

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
      const videoTransceiver = whipPc.addTransceiver(videoTrack, { direction: 'sendonly' });
      if (audioTrack) whipPc.addTransceiver(audioTrack, { direction: 'sendonly' });

      // Cloudflare's WHIP ingest accepts VP8 at the SDP/ICE/transport level
      // (the connection "succeeds" and RTP flows) but its live-transcode
      // pipeline -- the one that feeds the preview and RTMP-relay outputs --
      // only processes H264. Without forcing this, Chrome's default codec
      // offer order can pick VP8, which negotiates fine but silently never
      // reaches anything downstream. Force H264 first, keep the rest as a
      // fallback in case a given browser doesn't support it at all.
      if (typeof RTCRtpSender.getCapabilities === 'function') {
        const { codecs } = RTCRtpSender.getCapabilities('video');
        const h264 = codecs.filter((c) => c.mimeType.toLowerCase() === 'video/h264');
        const rest = codecs.filter((c) => c.mimeType.toLowerCase() !== 'video/h264');
        if (h264.length > 0) {
          videoTransceiver.setCodecPreferences([...h264, ...rest]);
        }
      }

      const offer = await whipPc.createOffer();
      await whipPc.setLocalDescription(offer);
      await waitForIceGatheringComplete(whipPc);

      const res = await fetch(session.stream.whipUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: whipPc.localDescription.sdp,
      });
      if (!res.ok) throw new Error(`WHIP publish failed (${res.status})`);

      // Cloudflare's WHIP Location header is relative (e.g.
      // "/<uid>/webRTC/publish/<session>") -- resolving it with plain
      // fetch(location) would resolve against *this page's* origin
      // (streambird.shackyapps.in), not Cloudflare's, which is why the
      // end-stream teardown DELETE was hitting our own backend and 404ing.
      // Resolve it against the WHIP endpoint's own origin instead.
      const location = res.headers.get('Location');
      whipResourceUrl = location ? new URL(location, session.stream.whipUrl).toString() : null;
      const answerSdp = await res.text();
      await whipPc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

      // WebRTC encoders default to a long keyframe interval (keyframes are
      // much larger than delta frames, and low-latency P2P contexts lean on
      // retransmission instead of frequent keyframes) -- observed here as
      // one roughly every ~47s. Cloudflare's own WebRTC preview tolerates
      // that fine (it just waits for the next one), but RTMP broadcast
      // destinations (Twitch, YouTube) expect a keyframe every ~2s for
      // their ingest/transcode pipeline to recognize and process the
      // stream at all -- without this, the WHIP ingest and Cloudflare
      // preview both work perfectly while every RTMP output silently never
      // connects. Two different browsers/versions have shipped two
      // different APIs for requesting one explicitly -- try both,
      // whichever exists.
      const sender = videoTransceiver.sender;
      keyFrameInterval = setInterval(() => {
        if (typeof sender.generateKeyFrame === 'function') {
          sender.generateKeyFrame().catch(() => {});
          return;
        }
        const params = sender.getParameters();
        if (params.encodings && params.encodings.length > 0) {
          sender.setParameters(params, { encodingOptions: [{ keyFrame: true }] }).catch(() => {});
        }
      }, 2000);

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
    endingStream = true;
    setStatus(els.studioStatus, 'Ending stream…');

    if (keyFrameInterval) {
      clearInterval(keyFrameInterval);
      keyFrameInterval = null;
    }

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
