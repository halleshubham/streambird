import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import * as authApi from '../api/auth';
import type { AuthUser } from '../types/api';
import { AuthContext, type AuthStatus } from './AuthContext';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await authApi.me();
      setUser(res.user);
      setAccountId(res.accountId);
      setStatus('authenticated');
    } catch {
      setUser(null);
      setAccountId(null);
      setStatus('anonymous');
    }
  }, []);

  useEffect(() => {
    // Checks the server-side session on mount -- the textbook case for
    // useEffect+setState ("synchronizing with an external system"), not a
    // synchronous mirror of a prop: this can only happen via an async
    // network call, never during render itself.
    // oxlint-disable-next-line react/set-state-in-effect
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, code: string) => {
    const res = await authApi.verifyCode(email, code);
    setUser(res.user);
    setAccountId(res.accountId);
    setStatus('authenticated');
  }, []);

  const setSession = useCallback((user: AuthUser, accountId: string) => {
    setUser(user);
    setAccountId(accountId);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    setUser(null);
    setAccountId(null);
    setStatus('anonymous');
  }, []);

  return (
    <AuthContext.Provider
      value={{ status, user, accountId, login, setSession, logout, refresh }}
    >
      {children}
    </AuthContext.Provider>
  );
}
