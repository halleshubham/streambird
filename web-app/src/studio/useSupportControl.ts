import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api } from '../api/client';
import { getStream } from '../api/streams';
import type { Stream } from '../types/api';
import type { SupportCommandType, SupportState } from './supportControl';

/** POST /streams/:id/support-control-token (act-mode support sessions only; the response is the one place the token appears). */
interface ControlTokenResponse {
  controlToken: string;
  expiresAt: string;
  studioSessionId: string;
}

export type CommandStatus = 'sending' | 'applied' | 'failed';
export interface CommandEntry {
  id: string;
  type: SupportCommandType;
  label: string;
  status: CommandStatus;
  error?: string;
  at: number;
}

export type ControlPhase = 'loading' | 'not-live' | 'error' | 'ready';

const ACK_TIMEOUT_MS = 12_000;

/**
 * The control page's connection to the host studio, through the signaling server: a "support" socket (no camera, no
 * mic, no WebRTC, never the host token), the host's latest state snapshot, and a command channel with per-command
 * status. The server is the authority (whitelist, support-session re-check on every command); this only sends.
 */
export function useSupportControl(streamId: string | undefined) {
  const [phase, setPhase] = useState<ControlPhase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState<Stream | null>(null);
  const [connected, setConnected] = useState(false);
  const [hostConnected, setHostConnected] = useState(false);
  const [state, setState] = useState<SupportState | null>(null);
  const [ended, setEnded] = useState<string | null>(null);
  const [log, setLog] = useState<CommandEntry[]>([]);
  const [attempt, setAttempt] = useState(0);
  const socketRef = useRef<Socket | null>(null);
  const revRef = useRef(-1);
  const seqRef = useRef(0);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const patchEntry = useCallback((id: string, patch: Partial<CommandEntry>) => {
    setLog((cur) => cur.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    if (patch.status && patch.status !== 'sending') {
      const t = timersRef.current.get(id);
      if (t) clearTimeout(t);
      timersRef.current.delete(id);
    }
  }, []);

  useEffect(() => {
    if (!streamId) {
      setPhase('error');
      setError('Missing streamId in the URL.');
      return;
    }
    let cancelled = false;
    const timers = timersRef.current;
    setPhase('loading');
    setError(null);
    revRef.current = -1;
    (async () => {
      try {
        const row = await getStream(streamId);
        if (cancelled) return;
        setStream(row);
        if (row.status !== 'live') {
          setPhase('not-live');
          return;
        }
        const first = await mintToken(streamId);
        if (cancelled) return;
        let firstToken: ControlTokenResponse | null = first;
        const socket = io('/studio', {
          // A (re)connect asks for a fresh token: a token lives at most 10 minutes, the socket itself no longer needs it once connected.
          auth: (cb) => {
            const use = (t: ControlTokenResponse) => cb({ role: 'support', sessionId: t.studioSessionId, controlToken: t.controlToken });
            if (firstToken) {
              const t = firstToken;
              firstToken = null;
              use(t);
            } else {
              // A failed re-mint must not leave a dead page: the server refuses the empty auth, and the page shows the error with Retry.
              mintToken(streamId).then(use, (e: unknown) => {
                setError(e instanceof Error ? e.message : 'Could not renew the control token');
                cb({ role: 'support' });
              });
            }
          },
        });
        socketRef.current = socket;
        socket.on('support:joined', (m: { hostConnected: boolean }) => {
          setConnected(true);
          setError(null);
          setHostConnected(!!m.hostConnected);
        });
        socket.on('support:host', (m: { connected: boolean }) => setHostConnected(!!m.connected));
        socket.on('support:state', (m: { rev: number; state: SupportState }) => {
          // Defensive (the server already rebuilt it from a strict shape): never let a malformed snapshot reach the panels.
          if (typeof m?.rev !== 'number' || !isUsableState(m.state)) return;
          if (m.rev < revRef.current) return; // an older snapshot overtaken by a newer one
          revRef.current = m.rev;
          setState(m.state);
        });
        socket.on('support:ack', (m: { id: string; ok: boolean; error?: string }) => patchEntry(m.id, { status: m.ok ? 'applied' : 'failed', error: m.ok ? undefined : m.error }));
        socket.on('support:ended', (m: { reason?: string }) => setEnded(m?.reason ?? 'ended'));
        socket.on('disconnect', () => {
          setConnected(false);
          setHostConnected(false);
        });
        socket.on('error', (e: { message?: string }) => setError(e?.message ?? 'Connection refused'));
        socket.on('connect_error', (e: Error) => setError(e.message));
        setPhase('ready');
      } catch (err) {
        if (cancelled) return;
        setPhase('error');
        setError(err instanceof Error ? err.message : 'Could not open the control page.');
      }
    })();
    return () => {
      cancelled = true;
      socketRef.current?.disconnect();
      socketRef.current = null;
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, [streamId, patchEntry, attempt]);

  const send = useCallback(
    (type: SupportCommandType, payload: Record<string, unknown>, label: string) => {
      const socket = socketRef.current;
      const id = `c${Date.now().toString(36)}${(seqRef.current++).toString(36)}`;
      setLog((cur) => [{ id, type, label, status: 'sending' as CommandStatus, at: Date.now() }, ...cur].slice(0, 12));
      if (!socket || !socket.connected) {
        patchEntry(id, { status: 'failed', error: 'Not connected to the studio' });
        return;
      }
      timersRef.current.set(
        id,
        setTimeout(() => patchEntry(id, { status: 'failed', error: 'No answer from the host studio' }), ACK_TIMEOUT_MS),
      );
      // The ack only says "relayed" or "refused"; the host's own result follows as support:ack.
      socket.emit('support:command', { id, type, payload }, (res: { ok: boolean; error?: string } | undefined) => {
        if (res && res.ok === false) patchEntry(id, { status: 'failed', error: res.error ?? 'Refused' });
      });
    },
    [patchEntry],
  );

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { phase, error, stream, connected, hostConnected, state, ended, log, send, retry };
}

function isUsableState(s: unknown): s is SupportState {
  const o = s as Partial<SupportState> | null;
  return !!o && o.v === 1 && typeof o.layout === 'string' && !!o.ads && !!o.clock && Array.isArray(o.kits) && !!o.ticker && !!o.lowerThird && !!o.logo && !!o.wallpaper;
}

function mintToken(streamId: string): Promise<ControlTokenResponse> {
  return api.post<ControlTokenResponse>(`/streams/${streamId}/support-control-token`);
}
