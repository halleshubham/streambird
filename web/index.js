(() => {
  const STORAGE_KEY = 'streambird_api_key';

  const els = {
    noAccount: document.getElementById('noAccount'),
    hasAccount: document.getElementById('hasAccount'),
    accountName: document.getElementById('accountName'),
    createAccountBtn: document.getElementById('createAccountBtn'),
    accountStatus: document.getElementById('accountStatus'),
    forgetAccountBtn: document.getElementById('forgetAccountBtn'),
    connectionsPanel: document.getElementById('connectionsPanel'),
    twitchLabel: document.getElementById('twitchLabel'),
    twitchIngest: document.getElementById('twitchIngest'),
    twitchKey: document.getElementById('twitchKey'),
    connectTwitchBtn: document.getElementById('connectTwitchBtn'),
    connectStatus: document.getElementById('connectStatus'),
    connectionsList: document.getElementById('connectionsList'),
    streamPanel: document.getElementById('streamPanel'),
    streamTitle: document.getElementById('streamTitle'),
    destinationCheckboxes: document.getElementById('destinationCheckboxes'),
    createStreamBtn: document.getElementById('createStreamBtn'),
    streamStatus: document.getElementById('streamStatus'),
    resultPanel: document.getElementById('resultPanel'),
    resultStatus: document.getElementById('resultStatus'),
  };

  function getApiKey() {
    return localStorage.getItem(STORAGE_KEY);
  }

  function setStatus(el, text, isError) {
    el.textContent = text;
    el.classList.toggle('error', Boolean(isError));
  }

  async function api(path, options = {}) {
    const apiKey = getApiKey();
    const res = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'x-api-key': apiKey } : {}),
        ...(options.headers || {}),
      },
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const message = (body && (body.message?.message || body.message)) || `Request failed (${res.status})`;
      throw new Error(Array.isArray(message) ? message.join(', ') : message);
    }
    return body;
  }

  function refreshAccountUI() {
    const apiKey = getApiKey();
    if (apiKey) {
      els.noAccount.style.display = 'none';
      els.hasAccount.style.display = 'block';
      setStatus(els.accountStatus, `Using API key: ${apiKey.slice(0, 10)}… (stored in this browser only)`);
      els.connectionsPanel.style.display = 'block';
      els.streamPanel.style.display = 'block';
      loadConnections();
    } else {
      els.noAccount.style.display = 'block';
      els.hasAccount.style.display = 'none';
      els.connectionsPanel.style.display = 'none';
      els.streamPanel.style.display = 'none';
      els.resultPanel.style.display = 'none';
    }
  }

  els.createAccountBtn.addEventListener('click', async () => {
    const name = els.accountName.value.trim() || 'Test account';
    els.createAccountBtn.disabled = true;
    try {
      const account = await api('/accounts', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      localStorage.setItem(STORAGE_KEY, account.apiKey);
      refreshAccountUI();
    } catch (err) {
      setStatus(els.accountStatus, err.message, true);
    } finally {
      els.createAccountBtn.disabled = false;
    }
  });

  els.forgetAccountBtn.addEventListener('click', () => {
    localStorage.removeItem(STORAGE_KEY);
    refreshAccountUI();
  });

  els.connectTwitchBtn.addEventListener('click', async () => {
    els.connectTwitchBtn.disabled = true;
    try {
      await api('/platform-connections/twitch/manual', {
        method: 'POST',
        body: JSON.stringify({
          label: els.twitchLabel.value.trim() || 'Twitch',
          ingestServerUrl: els.twitchIngest.value.trim(),
          streamKey: els.twitchKey.value.trim(),
        }),
      });
      setStatus(els.connectStatus, 'Connected.');
      els.twitchKey.value = '';
      loadConnections();
    } catch (err) {
      setStatus(els.connectStatus, err.message, true);
    } finally {
      els.connectTwitchBtn.disabled = false;
    }
  });

  async function loadConnections() {
    try {
      const connections = await api('/platform-connections');
      els.connectionsList.innerHTML = connections.length
        ? '<label>Connected</label>' + connections.map((c) => `<div>${c.platform}: ${c.label}</div>`).join('')
        : '<p style="color:var(--muted); font-size:13px">No connections yet.</p>';

      els.destinationCheckboxes.innerHTML = connections.length
        ? connections
            .map(
              (c) => `
          <label style="display:flex; align-items:center; gap:8px; font-weight:normal; color:var(--text)">
            <input type="checkbox" value="${c.id}" class="dest-checkbox">
            ${c.platform}: ${c.label}
          </label>`,
            )
            .join('')
        : '<p style="color:var(--muted); font-size:13px">Connect a platform first.</p>';
    } catch (err) {
      setStatus(els.connectStatus, err.message, true);
    }
  }

  els.createStreamBtn.addEventListener('click', async () => {
    const destinationConnectionIds = [...document.querySelectorAll('.dest-checkbox:checked')].map(
      (el) => el.value,
    );
    if (destinationConnectionIds.length === 0) {
      setStatus(els.streamStatus, 'Pick at least one destination.', true);
      return;
    }

    els.createStreamBtn.disabled = true;
    setStatus(els.streamStatus, 'Creating…');

    try {
      const stream = await api('/streams', {
        method: 'POST',
        body: JSON.stringify({
          title: els.streamTitle.value.trim() || 'Untitled stream',
          destinationConnectionIds,
        }),
      });

      setStatus(els.streamStatus, '');
      els.resultPanel.style.display = 'block';
      els.resultStatus.innerHTML = `
        <strong>Stream ID:</strong> ${stream.id}<br>
        <strong>Status:</strong> ${stream.status}<br>
        <strong>Ingest URL (RTMP/OBS):</strong> ${stream.ingestUrl || '—'}<br>
        <strong>WHIP URL:</strong> ${stream.whipUrl || '—'}<br>
        <strong>Studio session:</strong> ${stream.studioSessionId || '—'}<br>
        <strong>Destinations:</strong> ${stream.destinations.map((d) => `${d.status}`).join(', ')}
      `;
    } catch (err) {
      setStatus(els.streamStatus, err.message, true);
    } finally {
      els.createStreamBtn.disabled = false;
    }
  });

  refreshAccountUI();
})();
